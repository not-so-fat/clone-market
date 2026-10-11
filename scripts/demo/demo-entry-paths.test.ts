import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEMO_CHOSEN_EXTERNAL_ID,
  DEMO_CHOSEN_PROVIDER,
  DEMO_CHOSEN_SLUG,
  DEMO_SAMPLE_GROK_URL,
  DEMO_SAMPLE_SEARCH_QUERY,
  DEMO_SEED_NOW,
} from "./constants.mjs";
import type { FixtureServer } from "./fixture-server.mjs";
import { startFixtureServer } from "./fixture-server.mjs";
import { prepareDemoDatabases } from "./seed.mjs";
import { openMarketService } from "./test-helpers.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HOST = "127.0.0.1";

const temporary: string[] = [];
const open: FixtureServer[] = [];
afterEach(async () => {
  for (const fixture of open.splice(0)) await fixture.close().catch(() => undefined);
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("demo URL and search entry paths [agent]", () => {
  it("traverse the fixture HTTP boundary and produce equal previews", async () => {
    const demoRoot = mkdtempSync(join(tmpdir(), "demo-entry-"));
    temporary.push(demoRoot);
    const catalogPath = join(demoRoot, "catalog.sqlite");
    const evidencePath = join(demoRoot, "evidence.sqlite");
    const artifactDir = join(demoRoot, "artifacts");
    const fixture = await startFixtureServer({ port: 0, host: HOST, root: ROOT });
    open.push(fixture);

    const seed = await prepareDemoDatabases({ catalogPath, evidencePath, artifactDir, grokBaseUrl: fixture.baseUrl });
    expect(seed.catalog.total).toBeGreaterThan(0);
    expect(seed.evidence.rows).toBe(3);

    const source = { provider: DEMO_CHOSEN_PROVIDER, externalId: DEMO_CHOSEN_EXTERNAL_ID };

    const viaUrl = openMarketService({ catalogPath, evidencePath, grokBaseUrl: fixture.baseUrl, now: () => DEMO_SEED_NOW });
    const urlStart = fixture.requests.length;
    const resolved = await viaUrl.service.resolveGrokBotUrl(DEMO_SAMPLE_GROK_URL);
    expect(resolved.source).toEqual(source);
    const previewUrl = await viaUrl.service.agentDeckPreview(resolved.source);
    const urlSequence = fixture.requests.slice(urlStart).map((request) => request.path);
    viaUrl.close();

    const viaSearch = openMarketService({ catalogPath, evidencePath, grokBaseUrl: fixture.baseUrl, now: () => DEMO_SEED_NOW });
    const searchStart = fixture.requests.length;
    const found = await viaSearch.service.searchCatalog(DEMO_SAMPLE_SEARCH_QUERY);
    expect(found.total).toBeGreaterThan(0);
    const chosen = found.items.find((item) => item.provenance.source.externalId === DEMO_CHOSEN_EXTERNAL_ID);
    if (chosen === undefined) throw new Error("seeded Projects Manager template missing from search results");
    const previewSearch = await viaSearch.service.agentDeckPreview(chosen.provenance.source);
    const searchSequence = fixture.requests.slice(searchStart).map((request) => request.path);
    viaSearch.close();

    const expectedSequence = ["/bot/marketplace/", `/bot/marketplace/bots/${DEMO_CHOSEN_SLUG}`];
    expect(urlSequence).toEqual(expectedSequence);
    expect(searchSequence).toEqual(expectedSequence);

    expect(previewUrl.playbooks.length).toBeGreaterThan(0);
    expect(previewUrl.mcpServices.length).toBeGreaterThan(0);
    expect(previewSearch.playbooks.map((candidate) => candidate.id)).toEqual(
      previewUrl.playbooks.map((candidate) => candidate.id),
    );
    expect(previewSearch.mcpServices.map((candidate) => candidate.id)).toEqual(
      previewUrl.mcpServices.map((candidate) => candidate.id),
    );
    expect(previewSearch).toEqual(previewUrl);
  }, { timeout: 120_000 });
});
