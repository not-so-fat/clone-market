import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { DEMO_CHOSEN_EXTERNAL_ID, DEMO_CHOSEN_PROVIDER } from "./constants.mjs";
import type { DemoHandle } from "./launcher.mjs";
import { runDemo } from "./launcher.mjs";
import { allocatePort, expectConnectionRefused } from "./test-helpers.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const temporary: string[] = [];
const distDirs: string[] = [];
const handles: DemoHandle[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.stop().catch(() => undefined);
    await handle.done.catch(() => undefined);
  }
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
  for (const path of distDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

type SentinelState = {
  path: string;
  existed: boolean;
  bytes: Buffer;
  checksum: string;
  mtimeMs: number;
};

function checksum(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function listFilesRecursive(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = join(directory, entry.name);
    return entry.isDirectory() ? listFilesRecursive(full) : [full];
  }).sort();
}

describe("demo operator isolation [agent]", () => {
  it("leaves operator configuration and data untouched while serving from the demo root", async () => {
    const dataDir = join(ROOT, "data");
    const dataDirExisted = existsSync(dataDir);
    const dataListingBefore = dataDirExisted ? listFilesRecursive(dataDir) : [];

    const operatorPaths: Array<{ path: string; content: string }> = [
      {
        path: join(ROOT, "apps", "web", ".env.local"),
        content: [
          "CLONE_MARKET_CATALOG_DB=/nonexistent/isolation-sentinel.sqlite",
          "CLONE_MARKET_EVIDENCE_DB=/nonexistent/isolation-sentinel.sqlite",
          "CLONE_MARKET_ARTIFACT_DIR=/nonexistent/isolation-sentinel",
          "CLONE_MARKET_GROK_BASE_URL=http://127.0.0.1:9/",
          "CLONE_MARKET_BOTMANCERS_BASE_URL=http://127.0.0.1:9/",
          "CLONE_MARKET_BOTMANCERS_UI_BASE_URL=http://127.0.0.1:9/",
          "",
        ].join("\n"),
      },
      { path: join(dataDir, "catalog.sqlite"), content: "isolation-sentinel-catalog" },
      { path: join(dataDir, "evidence.sqlite"), content: "isolation-sentinel-evidence" },
      { path: join(dataDir, "artifacts", "isolation-sentinel.txt"), content: "isolation-sentinel-artifact" },
    ];
    const sentinels: SentinelState[] = operatorPaths.map(({ path, content }) => {
      const existed = existsSync(path);
      if (!existed) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
      }
      const bytes = readFileSync(path);
      return { path, existed, bytes, checksum: checksum(bytes), mtimeMs: statSync(path).mtimeMs };
    });

    try {
      const demoRoot = mkdtempSync(join(tmpdir(), "demo-isolation-"));
      temporary.push(demoRoot);
      const webPort = await allocatePort();
      const fixturePort = await allocatePort();
      let stdout = "";
      const handle = await runDemo({
        root: ROOT,
        demoRoot,
        webPort,
        fixturePort,
        demoDistDir: ".next-demo-isolation",
        skipBuild: true,
        readyTimeoutMs: 240_000,
        stdout: (chunk) => {
          stdout += chunk;
        },
        stderr: () => undefined,
      });
      handles.push(handle);
      distDirs.push(handle.plan.nextDistDir);

      // The demo serves from its isolated databases and fixture source even
      // when a bogus operator .env.local is present: operator values are
      // never depended upon.
      const preview = await fetch(
        `${handle.plan.webUrl}api/v1/templates/${DEMO_CHOSEN_PROVIDER}/${DEMO_CHOSEN_EXTERNAL_ID}/agent-deck-preview`,
      );
      expect(preview.status).toBe(200);
      const payload = await preview.json() as { playbooks: unknown[]; mcpServices: unknown[] };
      expect(payload.playbooks.length).toBeGreaterThan(0);
      expect(payload.mcpServices.length).toBeGreaterThan(0);
      // The Agent Deck preview never touches Botmancers, so prove the bogus
      // sentinel Botmancers URL was ignored with the clone preview, which
      // calls botmancers.getCapabilities(): a leaked http://127.0.0.1:9/
      // endpoint would fail with 503 target_unavailable instead of 200.
      const clonePreview = await fetch(
        `${handle.plan.webUrl}api/v1/templates/${DEMO_CHOSEN_PROVIDER}/${DEMO_CHOSEN_EXTERNAL_ID}/clone/preview`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            policy: {
              schemaVersion: "1.0.0",
              creatorPermission: "granted",
              redistribution: "private_only",
              destination: "private",
              instructionForm: "plain_text",
            },
          }),
        },
      );
      expect(clonePreview.status).toBe(200);
      expect(stdout).toContain(`Browser URL: ${handle.plan.webUrl}`);

      expect(existsSync(handle.plan.catalogPath)).toBe(true);
      expect(existsSync(handle.plan.evidencePath)).toBe(true);
      expect(statSync(handle.plan.artifactDir).isDirectory()).toBe(true);

      await handle.stop();
      expect((await handle.done).code).toBe(0);
      await expectConnectionRefused(handle.plan.webUrl);
      await expectConnectionRefused(handle.plan.fixtureBaseUrl);

      for (const sentinel of sentinels) {
        const bytes = readFileSync(sentinel.path);
        expect(bytes).toEqual(sentinel.bytes);
        expect(checksum(bytes)).toBe(sentinel.checksum);
        expect(statSync(sentinel.path).mtimeMs).toBe(sentinel.mtimeMs);
      }
      // When data/ did not exist, only the test's own sentinel files may be present.
      const dataListingAfter = listFilesRecursive(dataDir);
      const expectedAfter = dataDirExisted
        ? dataListingBefore
        : sentinels.filter((sentinel) => sentinel.path.startsWith(`${dataDir}/`)).map((sentinel) => sentinel.path).sort();
      expect(dataListingAfter).toEqual(expectedAfter);
    } finally {
      for (const sentinel of sentinels) {
        if (!sentinel.existed) rmSync(sentinel.path, { force: true });
      }
      if (!dataDirExisted) rmSync(dataDir, { recursive: true, force: true });
    }
  }, { timeout: 300_000 });
});
