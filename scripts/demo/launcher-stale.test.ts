import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { DEMO_CHOSEN_EXTERNAL_ID, DEMO_CHOSEN_PROVIDER, DEMO_SEED_NOW } from "./constants.mjs";
import type { DemoHandle } from "./launcher.mjs";
import { runDemo } from "./launcher.mjs";
import { allocatePort, expectConnectionRefused, openMarketService } from "./test-helpers.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STALE_SENTINEL = "stale-sentinel-do-not-serve";

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

function runTsc(cwd: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-b"], {
    cwd,
    timeout: 300_000,
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

function listFilesRecursive(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    return entry.isDirectory() ? listFilesRecursive(full) : [full];
  }).sort();
}

describe("demo stale-artifact regression [agent]", () => {
  it("regenerates stale package output from the current checkout (isolated copy)", async () => {
    // Proves the exact `tsc -b` regeneration mechanism on identical tsconfigs
    // inside a throwaway copy, so parallel tests never observe a rewrite.
    const copyRoot = mkdtempSync(join(tmpdir(), "demo-stale-copy-"));
    temporary.push(copyRoot);
    for (const entry of ["packages", "fixtures", "tsconfig.json", "tsconfig.base.json"]) {
      cpSync(join(ROOT, entry), join(copyRoot, entry), {
        recursive: true,
        filter: (source) =>
          !/(^|\/)node_modules(\/|$)/.test(source) && !/(^|\/)dist(\/|$)/.test(source) && !source.endsWith(".tsbuildinfo"),
      });
    }
    symlinkSync(join(ROOT, "node_modules"), join(copyRoot, "node_modules"), "dir");

    const adapterDist = join(copyRoot, "packages", "source-grok", "dist", "adapter.js");
    const adapterSrc = join(copyRoot, "packages", "source-grok", "src", "adapter.ts");
    const first = runTsc(copyRoot);
    expect(first.status, first.output).toBe(0);
    expect(existsSync(adapterDist)).toBe(true);

    // Simulate a pulled fix landing on top of stale generated output: the
    // output is backdated and the current source gains a marker.
    const backdate = new Date("2020-01-01T00:00:00.000Z");
    utimesSync(adapterDist, backdate, backdate);
    expect(statSync(adapterDist).mtimeMs).toBeLessThanOrEqual(backdate.getTime());
    writeFileSync(adapterSrc, `${readFileSync(adapterSrc, "utf8")}\n// stale-test-marker: current checkout source\n`);

    const second = runTsc(copyRoot);
    expect(second.status, second.output).toBe(0);
    expect(statSync(adapterDist).mtimeMs).toBeGreaterThan(backdate.getTime());
    // The regenerated output reflects the current source, not the stale bundle.
    const regenerated = readFileSync(adapterDist, "utf8");
    expect(regenerated).toContain("stale-test-marker: current checkout source");
    expect(regenerated).toContain("encodeURIComponent(slug)");
  }, { timeout: 420_000 });

  it("serves the current fixture contract despite stale normal-cache sentinels", async () => {
    const webDir = join(ROOT, "apps", "web");
    const normalNextDir = join(webDir, ".next");
    const normalExisted = existsSync(normalNextDir);
    const normalBefore = normalExisted ? listFilesRecursive(normalNextDir) : [];
    mkdirSync(normalNextDir, { recursive: true });
    writeFileSync(join(normalNextDir, "STALE_SENTINEL.txt"), STALE_SENTINEL);

    const demoDistDirName = ".next-demo-stale";
    const demoDistDir = join(webDir, demoDistDirName);
    mkdirSync(demoDistDir, { recursive: true });
    writeFileSync(join(demoDistDir, "STALE_SENTINEL.txt"), STALE_SENTINEL);
    distDirs.push(demoDistDir);

    try {
      const demoRoot = mkdtempSync(join(tmpdir(), "demo-stale-"));
      temporary.push(demoRoot);
      const webPort = await allocatePort();
      const fixturePort = await allocatePort();
      let stderr = "";
      const handle = await runDemo({
        root: ROOT,
        demoRoot,
        webPort,
        fixturePort,
        demoDistDir: demoDistDirName,
        skipBuild: false,
        readyTimeoutMs: 240_000,
        stdout: () => undefined,
        stderr: (chunk) => {
          stderr += chunk;
        },
      });
      handles.push(handle);
      expect(stderr).toContain("Building workspace packages");

      // The normal development cache is never read or written.
      expect(readFileSync(join(normalNextDir, "STALE_SENTINEL.txt"), "utf8")).toBe(STALE_SENTINEL);
      expect(listFilesRecursive(normalNextDir)).toEqual([...normalBefore, join(normalNextDir, "STALE_SENTINEL.txt")].sort());
      // The demo cache was rebuilt fresh instead of reusing stale output.
      expect(existsSync(join(demoDistDir, "STALE_SENTINEL.txt"))).toBe(false);
      expect(readdirSync(demoDistDir).length).toBeGreaterThan(0);

      const direct = openMarketService({
        catalogPath: handle.plan.catalogPath,
        evidencePath: handle.plan.evidencePath,
        grokBaseUrl: handle.plan.fixtureBaseUrl,
        now: () => DEMO_SEED_NOW,
      });
      let expected: { playbooks: string[]; mcpServices: string[] };
      try {
        const preview = await direct.service.agentDeckPreview({
          provider: DEMO_CHOSEN_PROVIDER,
          externalId: DEMO_CHOSEN_EXTERNAL_ID,
        });
        expected = {
          playbooks: preview.playbooks.map((candidate) => candidate.id),
          mcpServices: preview.mcpServices.map((candidate) => candidate.id),
        };
      } finally {
        direct.close();
      }
      expect(expected.playbooks.length).toBeGreaterThan(0);

      const response = await fetch(
        `${handle.plan.webUrl}api/v1/templates/${DEMO_CHOSEN_PROVIDER}/${DEMO_CHOSEN_EXTERNAL_ID}/agent-deck-preview`,
      );
      expect(response.status).toBe(200);
      const payload = await response.json() as { playbooks: Array<{ id: string }>; mcpServices: Array<{ id: string }> };
      expect(JSON.stringify(payload)).not.toContain("stale-sentinel");
      expect(payload.playbooks.map((candidate) => candidate.id)).toEqual(expected.playbooks);
      expect(payload.mcpServices.map((candidate) => candidate.id)).toEqual(expected.mcpServices);

      const page = await fetch(
        `${handle.plan.webUrl}templates/${DEMO_CHOSEN_PROVIDER}/${DEMO_CHOSEN_EXTERNAL_ID}/agent-deck-preview`,
      );
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("<h1>Would register</h1>");

      await handle.stop();
      expect((await handle.done).code).toBe(0);
      await expectConnectionRefused(handle.plan.webUrl);
      await expectConnectionRefused(handle.plan.fixtureBaseUrl);
    } finally {
      rmSync(join(normalNextDir, "STALE_SENTINEL.txt"), { force: true });
      if (!normalExisted) rmSync(normalNextDir, { recursive: true, force: true });
    }
  }, { timeout: 420_000 });
});
