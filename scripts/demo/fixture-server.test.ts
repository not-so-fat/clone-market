import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { GrokMarketplaceAdapter } from "@clone-market/source-grok";
import { DEMO_CHOSEN_EXTERNAL_ID, DEMO_CHOSEN_PROVIDER, DEMO_CHOSEN_SLUG } from "./constants.mjs";
import type { FixtureServer } from "./fixture-server.mjs";
import { loadFixtureDocuments, startFixtureServer } from "./fixture-server.mjs";
import { expectConnectionRefused } from "./test-helpers.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HOST = "127.0.0.1";

const open: FixtureServer[] = [];
afterEach(async () => {
  for (const fixture of open.splice(0)) await fixture.close().catch(() => undefined);
});

describe("demo fixture source [agent]", () => {
  it("serves the captured index and detail fixtures with 404s elsewhere", async () => {
    const documents = await loadFixtureDocuments(ROOT);
    const fixture = await startFixtureServer({ port: 0, host: HOST, root: ROOT, documents });
    open.push(fixture);
    expect(fixture.port).toBeGreaterThan(0);
    expect(fixture.baseUrl).toBe(`http://${HOST}:${fixture.port}/bot/marketplace/`);

    const index = await fetch(fixture.baseUrl);
    expect(index.status).toBe(200);
    expect(await index.text()).toBe(documents.indexHtml);

    const detail = await fetch(`${fixture.baseUrl}bots/${DEMO_CHOSEN_SLUG}`);
    expect(detail.status).toBe(200);
    expect(await detail.text()).toBe(documents.detailHtml);

    expect((await fetch(`${fixture.baseUrl}bots/no-such-bot`)).status).toBe(404);
    expect((await fetch(fixture.baseUrl, { method: "POST" })).status).toBe(404);
    expect(fixture.requests.map((request) => request.path)).toEqual([
      "/bot/marketplace/",
      `/bot/marketplace/bots/${DEMO_CHOSEN_SLUG}`,
      "/bot/marketplace/bots/no-such-bot",
      "/bot/marketplace/",
    ]);

    await fixture.close();
    await expectConnectionRefused(fixture.baseUrl);
  });

  it("lets a fresh adapter resolve a stored ID to its public slug detail", async () => {
    const fixture = await startFixtureServer({ port: 0, host: HOST, root: ROOT });
    open.push(fixture);
    const adapter = new GrokMarketplaceAdapter({ baseUrl: fixture.baseUrl, maxRetries: 0, retryBaseMs: 0 });
    const raw = await adapter.fetchTemplate({ provider: DEMO_CHOSEN_PROVIDER, externalId: DEMO_CHOSEN_EXTERNAL_ID });
    expect(fixture.requests.map((request) => request.path)).toEqual([
      "/bot/marketplace/",
      `/bot/marketplace/bots/${DEMO_CHOSEN_SLUG}`,
    ]);
    const manifest = await adapter.normalizeTemplate(raw, "2026-10-03T18:00:00.000Z");
    expect(manifest.source).toEqual({ provider: DEMO_CHOSEN_PROVIDER, externalId: DEMO_CHOSEN_EXTERNAL_ID });
    expect(manifest.template.name).toContain("Projects Manager");
  });
});
