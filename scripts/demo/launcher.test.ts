import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEMO_CHOSEN_EXTERNAL_ID,
  DEMO_CHOSEN_PROVIDER,
  DEMO_READONLY_STATEMENT,
  DEMO_SAMPLE_GROK_URL,
  DEMO_SAMPLE_SEARCH_QUERY,
} from "./constants.mjs";
import type { DemoHandle } from "./launcher.mjs";
import { runDemo } from "./launcher.mjs";
import { allocatePort, countCatalogTemplates, expectConnectionRefused, listEvidenceRows } from "./test-helpers.js";

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

async function launch(tag: string, demoRoot: string) {
  const webPort = await allocatePort();
  const fixturePort = await allocatePort();
  let stdout = "";
  let stderr = "";
  const handle = await runDemo({
    root: ROOT,
    demoRoot,
    webPort,
    fixturePort,
    demoDistDir: `.next-demo-${tag}`,
    skipBuild: true,
    readyTimeoutMs: 240_000,
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
  });
  handles.push(handle);
  distDirs.push(handle.plan.nextDistDir);
  return { handle, stdout: () => stdout, stderr: () => stderr };
}

type PreviewPayload = {
  playbooks: Array<{ id: string }>;
  mcpServices: Array<{ id: string }>;
};

describe("demo launcher [agent]", () => {
  it("seeds, launches, prints the ready banner, and shuts down cleanly", async () => {
    const demoRoot = mkdtempSync(join(tmpdir(), "demo-launch-"));
    temporary.push(demoRoot);
    const { handle, stdout } = await launch("launcher", demoRoot);

    expect(handle.seed.catalog.total).toBeGreaterThan(0);
    expect(handle.seed.evidence.rows).toBe(3);
    expect(handle.seed.evidence.label).toBe("observed_use");
    expect(await countCatalogTemplates(handle.plan.catalogPath)).toBe(handle.seed.catalog.total);
    expect(await listEvidenceRows(handle.plan.evidencePath, `${DEMO_CHOSEN_PROVIDER}:${DEMO_CHOSEN_EXTERNAL_ID}`)).toEqual([
      "try-1",
      "try-2",
      "repeat-1",
    ]);
    expect(readdirSync(handle.plan.artifactDir)).toEqual([]);

    const banner = stdout();
    expect(banner).toContain(`Browser URL: ${handle.plan.webUrl}`);
    expect(banner).toContain(DEMO_SAMPLE_GROK_URL);
    expect(banner).toContain(DEMO_SAMPLE_SEARCH_QUERY);
    expect(banner).toContain(DEMO_READONLY_STATEMENT);

    const home = await fetch(handle.plan.webUrl);
    expect(home.status).toBe(200);
    const homeHtml = await home.text();
    expect(homeHtml).toContain("Paste a URL");
    expect(homeHtml).toContain("Search the marketplace");

    const search = await fetch(`${handle.plan.webUrl}?q=${encodeURIComponent(DEMO_SAMPLE_SEARCH_QUERY)}`);
    expect(search.status).toBe(200);
    const searchHtml = await search.text();
    expect(searchHtml).toContain("Projects Manager");
    expect(searchHtml).toContain("agent-deck-preview");

    const submitted = await fetch(`${handle.plan.webUrl}?url=${encodeURIComponent(DEMO_SAMPLE_GROK_URL)}`, {
      redirect: "manual",
    });
    expect([301, 302, 303, 307, 308]).toContain(submitted.status);
    const location = submitted.headers.get("location");
    expect(location).toContain(`/templates/${DEMO_CHOSEN_PROVIDER}/${DEMO_CHOSEN_EXTERNAL_ID}/agent-deck-preview`);
    const previewPage = await fetch(new URL(location ?? "", handle.plan.webUrl));
    expect(previewPage.status).toBe(200);
    expect(await previewPage.text()).toContain("<h1>Would register</h1>");

    const previewApi = await fetch(
      `${handle.plan.webUrl}api/v1/templates/${DEMO_CHOSEN_PROVIDER}/${DEMO_CHOSEN_EXTERNAL_ID}/agent-deck-preview`,
    );
    expect(previewApi.status).toBe(200);
    const payload = await previewApi.json() as PreviewPayload;
    expect(payload.playbooks.length).toBeGreaterThan(0);
    expect(payload.mcpServices.length).toBeGreaterThan(0);

    await handle.stop();
    const done = await handle.done;
    expect(done.code).toBe(0);
    await expectConnectionRefused(handle.plan.webUrl);
    await expectConnectionRefused(handle.plan.fixtureBaseUrl);
  }, { timeout: 300_000 });

  it("relaunches idempotently against the same demo directory", async () => {
    const demoRoot = mkdtempSync(join(tmpdir(), "demo-relaunch-"));
    temporary.push(demoRoot);

    const first = await launch("relaunch-a", demoRoot);
    const firstTotal = first.handle.seed.catalog.total;
    const firstSnapshot = first.handle.seed.evidence.snapshotId;
    expect(firstTotal).toBeGreaterThan(0);
    await first.handle.stop();
    expect((await first.handle.done).code).toBe(0);

    const second = await launch("relaunch-b", demoRoot);
    expect(second.handle.seed.catalog.total).toBe(firstTotal);
    expect(second.handle.seed.catalog.added).toBe(0);
    expect(second.handle.seed.catalog.unchanged).toBe(firstTotal);
    expect(second.handle.seed.evidence.snapshotId).toBe(firstSnapshot);
    expect(await countCatalogTemplates(second.handle.plan.catalogPath)).toBe(firstTotal);
    expect(await listEvidenceRows(second.handle.plan.evidencePath, `${DEMO_CHOSEN_PROVIDER}:${DEMO_CHOSEN_EXTERNAL_ID}`)).toEqual([
      "try-1",
      "try-2",
      "repeat-1",
    ]);
    expect(readdirSync(second.handle.plan.artifactDir)).toEqual([]);
    expect(second.stdout()).toContain(`Browser URL: ${second.handle.plan.webUrl}`);

    const home = await fetch(second.handle.plan.webUrl);
    expect(home.status).toBe(200);

    await second.handle.stop();
    expect((await second.handle.done).code).toBe(0);
    await expectConnectionRefused(second.handle.plan.webUrl);
    await expectConnectionRefused(second.handle.plan.fixtureBaseUrl);
  }, { timeout: 420_000 });
});
