import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BotTemplateManifest, CatalogEntry, CatalogRepository, SourceAdapter } from "@clone-market/core";
import { SqliteCatalogRepository } from "@clone-market/catalog";
import { EvidenceService, SqliteEvidenceRepository } from "@clone-market/evidence";
import { DeclaredBotmancersCapabilitiesClient } from "@clone-market/target-botmancers";
import { MemoryArtifactSink } from "./artifact-sink.js";
import { MarketError, MarketService } from "./market.js";
import { createV1Handlers } from "./http.js";
import { renderAgentDeckPreview } from "./presentation.js";

const NOW = "2026-10-07T12:00:00.000Z";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function entry(externalId: string, slug: string, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  const source = { provider: "grok-marketplace", externalId };
  return {
    schemaVersion: "1.0.0",
    id: `grok-marketplace:${externalId}`,
    name: `Bot ${externalId}`,
    summary: `Summary for ${externalId}.`,
    creator: { name: "Ada" },
    categories: ["research"],
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    featured: false,
    provenance: { schemaVersion: "1.0.0", source, retrievedAt: NOW, url: `https://x.ai/bot/marketplace/bots/${slug}` },
    present: true,
    lastRetrievedAt: NOW,
    sourceMetadata: { installCount: 0 },
    ...overrides,
  };
}

function manifestFor(source: { provider: string; externalId: string }): BotTemplateManifest {
  const item = entry(source.externalId, source.externalId);
  return {
    schemaVersion: "1.0.0",
    id: `grok-marketplace:${source.externalId}:manifest`,
    source,
    retrievedAt: NOW,
    provenanceUrl: item.provenance.url,
    template: {
      schemaVersion: item.schemaVersion,
      id: item.id,
      name: item.name,
      summary: item.summary,
      creator: item.creator,
      categories: item.categories,
      firstSeenAt: item.firstSeenAt,
      lastSeenAt: item.lastSeenAt,
      featured: item.featured,
      provenance: item.provenance,
    },
    instructions: `Instructions for ${source.externalId}.`,
    memories: [{ id: "memory-1", name: "Notes", content: `facts for ${source.externalId}` }],
    skills: [{ id: "skill-1", name: "Skill One", description: "Does one thing.", instructions: "Do it." }],
    routines: [{ id: "routine-1", name: "Routine One", instructions: "Run daily." }],
    integrations: [{ id: "calendar", name: "Calendar", required: true }],
    unavailableFields: [],
  };
}

function repository(items: CatalogEntry[]): CatalogRepository & { writes: unknown[] } {
  const writes: unknown[] = [];
  return {
    writes,
    async reconcile(input) {
      writes.push(input);
      return { source: input.source, retrievedAt: input.retrievedAt, total: input.records.length, added: 0, changed: 0, removed: 0, reappeared: 0, unchanged: input.records.length };
    },
    async getTemplate(identity) {
      return items.find((item) => item.provenance.source.provider === identity.provider && item.provenance.source.externalId === identity.externalId);
    },
    async listTemplates(input = {}) {
      const start = Number(input.cursor ?? 0);
      const limit = input.limit ?? 50;
      const templates = items.slice(start, start + limit);
      return start + limit < items.length ? { templates, nextCursor: String(start + limit) } : { templates };
    },
    async getSourceHistory() { return []; },
  };
}

function adapter(): SourceAdapter & { calls: string[]; requested: Array<{ provider: string; externalId: string }> } {
  const calls: string[] = [];
  const requested: Array<{ provider: string; externalId: string }> = [];
  return {
    source: "grok-marketplace",
    calls,
    requested,
    async listTemplates() { return { templates: [] }; },
    async fetchTemplate(identity) {
      calls.push("fetchTemplate");
      requested.push({ ...identity });
      return { identity };
    },
    async normalizeTemplate(input, retrievedAt) {
      calls.push("normalizeTemplate");
      const identity = (input as { identity: { provider: string; externalId: string } }).identity;
      return { ...manifestFor(identity), retrievedAt };
    },
  };
}

function service(items: CatalogEntry[]) {
  const repo = repository(items);
  const sourceAdapter = adapter();
  const market = new MarketService({
    catalog: repo,
    evidence: { async getLatest() { return undefined; } },
    source() { return sourceAdapter; },
    botmancers: new DeclaredBotmancersCapabilitiesClient(),
    artifacts: new MemoryArtifactSink(),
    now: () => NOW,
  });
  return { market, repo, sourceAdapter };
}

describe("Grok URL resolution [agent]", () => {
  const alpha = entry("bot-alpha-1", "alpha", { name: "Alpha Bot" });

  it("resolves a canonical Grok Bot URL to its catalog source identity", async () => {
    const context = service([alpha]);
    const handlers = createV1Handlers(context.market);
    const resolved = await context.market.resolveGrokBotUrl("https://x.ai/bot/marketplace/bots/alpha");
    expect(resolved.source).toEqual({ provider: "grok-marketplace", externalId: "bot-alpha-1" });
    const response = await handlers.resolveGrokBot({ query: { url: "https://x.ai/bot/marketplace/bots/alpha/" } });
    expect(response.status).toBe(200);
    expect((response.body as { source: unknown }).source).toEqual({ provider: "grok-marketplace", externalId: "bot-alpha-1" });
  });

  it.each([
    ["not a url", "invalid_grok_url", 400],
    ["https://example.com/bot/marketplace/bots/alpha", "unsupported_grok_url", 400],
    ["https://x.ai/other/path", "unsupported_grok_url", 400],
    ["https://x.ai/bot/marketplace/bots/unknown-slug", "not_found", 404],
  ] as const)("rejects %s with %s without fetching a manifest", async (url, code, status) => {
    const context = service([alpha]);
    const handlers = createV1Handlers(context.market);
    await expect(context.market.resolveGrokBotUrl(url)).rejects.toMatchObject({ code });
    const response = await handlers.resolveGrokBot({ query: { url } });
    expect(response.status).toBe(status);
    expect(response.body).toMatchObject({ error: { code, recoverable: true } });
    expect(context.sourceAdapter.calls).toEqual([]);
  });

  it("reports an unknown slug distinctly from malformed input", async () => {
    const context = service([alpha]);
    const error = await context.market.resolveGrokBotUrl("https://x.ai/bot/marketplace/bots/ghost").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(MarketError);
    expect((error as MarketError).code).toBe("not_found");
    expect((error as MarketError).message).toContain("ghost");
    expect(context.sourceAdapter.calls).toEqual([]);
  });
});

describe("marketplace search [agent]", () => {
  it("matches name, creator, and summary across complete paginated traversal without a result cap", async () => {
    const items = Array.from({ length: 205 }, (_, index) => entry(`bot-${index}`, `slug-${index}`));
    items[5] = entry("bot-5", "slug-5", { name: "Zebra Finder" });
    items[50] = entry("bot-50", "slug-50", { creator: { name: "Zebra Keeper" } });
    items[150] = entry("bot-150", "slug-150", { summary: "Tracks zebra migrations across the savanna." });
    const context = service(items);
    const result = await context.market.searchCatalog("zebra");
    expect(result.total).toBe(3);
    expect(result.items.map(({ id }) => id).sort()).toEqual([
      "grok-marketplace:bot-150",
      "grok-marketplace:bot-5",
      "grok-marketplace:bot-50",
    ]);
    const response = await createV1Handlers(context.market).searchCatalog({ query: { q: "  ZEBRA " } });
    expect(response.status).toBe(200);
    expect((response.body as { total: number }).total).toBe(3);
  });

  it("returns every match when the query is broad", async () => {
    const items = Array.from({ length: 205 }, (_, index) => entry(`bot-${index}`, `slug-${index}`));
    const context = service(items);
    expect((await context.market.searchCatalog("Bot bot-1")).total).toBeGreaterThan(100);
    expect((await context.market.searchCatalog("summary for")).total).toBe(205);
  });

  it("returns an explicit empty result for blank queries", async () => {
    const context = service([entry("bot-alpha-1", "alpha")]);
    expect(await context.market.searchCatalog("   ")).toEqual({ items: [], total: 0, query: "" });
  });
});

describe("Agent Deck preview operation [agent]", () => {
  const alpha = entry("bot-alpha-1", "alpha", { name: "Alpha Bot" });

  it("fetches the current manifest on demand and returns a deterministic preview", async () => {
    const context = service([alpha]);
    const handlers = createV1Handlers(context.market);
    const source = { provider: "grok-marketplace", externalId: "bot-alpha-1" };
    const first = await context.market.agentDeckPreview(source);
    const second = await context.market.agentDeckPreview(source);
    expect(first).toEqual(second);
    expect(first.source).toEqual(source);
    expect(first.playbooks.map(({ id }) => id)).toEqual(["primary", "skill:skill-1", "routine:routine-1"]);
    expect(first.mcpServices.map(({ id }) => id)).toEqual(["integration:calendar"]);
    expect(context.sourceAdapter.calls).toEqual(["fetchTemplate", "normalizeTemplate", "fetchTemplate", "normalizeTemplate"]);
    expect(context.repo.writes).toEqual([]);
    const response = await handlers.agentDeckPreview({ params: source });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(first);
  });

  it("makes URL submission and search selection converge on the same preview", async () => {
    const context = service([alpha, entry("bot-beta-2", "beta", { name: "Beta Bot" })]);
    const resolved = await context.market.resolveGrokBotUrl("https://x.ai/bot/marketplace/bots/alpha");
    const searched = await context.market.searchCatalog("Alpha Bot");
    expect(searched.total).toBe(1);
    const selected = searched.items[0]!.provenance.source;
    expect(selected).toEqual(resolved.source);
    const fromUrl = await context.market.agentDeckPreview(resolved.source);
    const fromSearch = await context.market.agentDeckPreview(selected);
    expect(fromSearch).toEqual(fromUrl);
    expect(context.sourceAdapter.requested).toEqual([resolved.source, resolved.source]);
  });

  it("renders deep-equal Would register sections for both entry paths", async () => {
    const context = service([alpha, entry("bot-beta-2", "beta", { name: "Beta Bot" })]);
    const resolved = await context.market.resolveGrokBotUrl("https://x.ai/bot/marketplace/bots/alpha");
    const searched = await context.market.searchCatalog("Alpha Bot");
    const fromUrl = renderAgentDeckPreview(await context.market.agentDeckPreview(resolved.source));
    const fromSearch = renderAgentDeckPreview(await context.market.agentDeckPreview(searched.items[0]!.provenance.source));
    expect(fromUrl).toBe(fromSearch);
    expect(fromUrl).toContain("Would register");
    const playbooks = (html: string) => [...html.matchAll(/data-playbook-id="([^"]+)"/g)].map((match) => match[1]);
    const services = (html: string) => [...html.matchAll(/data-mcp-id="([^"]+)"/g)].map((match) => match[1]);
    expect(playbooks(fromUrl)).toEqual(playbooks(fromSearch));
    expect(services(fromUrl)).toEqual(services(fromSearch));
    expect(playbooks(fromUrl).length).toBeGreaterThan(0);
  });

  it("maps source drift and unknown templates to recoverable preview errors", async () => {
    const broken = service([alpha]);
    broken.sourceAdapter.normalizeTemplate = async () => { throw new Error("detail schema changed"); };
    const drift = await createV1Handlers(broken.market).agentDeckPreview({ params: alpha.provenance.source });
    expect(drift).toMatchObject({ status: 503, body: { error: { code: "source_drift", recoverable: true } } });
    const missing = await createV1Handlers(service([]).market).agentDeckPreview({ params: alpha.provenance.source });
    expect(missing).toMatchObject({ status: 404, body: { error: { code: "not_found", recoverable: true } } });
  });

  it("persists no manifest or preview content in the catalog or evidence databases", async () => {
    const directory = await mkdtemp(join(tmpdir(), "clone-market-agent-deck-"));
    temporaryDirectories.push(directory);
    const catalogPath = join(directory, "catalog.sqlite");
    const evidencePath = join(directory, "evidence.sqlite");
    const catalog = new SqliteCatalogRepository(catalogPath);
    await catalog.reconcile({
      source: "grok-marketplace",
      retrievedAt: NOW,
      records: [{
        template: {
          schemaVersion: alpha.schemaVersion,
          id: alpha.id,
          name: alpha.name,
          summary: alpha.summary,
          creator: alpha.creator,
          categories: alpha.categories,
          firstSeenAt: alpha.firstSeenAt,
          lastSeenAt: alpha.lastSeenAt,
          featured: alpha.featured,
          provenance: alpha.provenance,
        },
        sourceMetadata: alpha.sourceMetadata,
      }],
    });
    const evidenceRepository = new SqliteEvidenceRepository(evidencePath);
    const sourceAdapter = adapter();
    const market = new MarketService({
      catalog,
      evidence: new EvidenceService(evidenceRepository),
      source() { return sourceAdapter; },
      botmancers: new DeclaredBotmancersCapabilitiesClient(),
      now: () => NOW,
    });
    const handlers = createV1Handlers(market);
    const resolved = await market.resolveGrokBotUrl("https://x.ai/bot/marketplace/bots/alpha");
    expect((await handlers.searchCatalog({ query: { q: "Alpha" } })).status).toBe(200);
    const preview = await market.agentDeckPreview(resolved.source);
    expect(preview.playbooks.length).toBeGreaterThan(0);
    catalog.close();
    evidenceRepository.close();

    for (const path of [catalogPath, evidencePath]) {
      const database = new DatabaseSync(path, { readOnly: true });
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
      const serialized = JSON.stringify(tables.flatMap(({ name }) => database.prepare(`SELECT * FROM ${name}`).all()));
      for (const requestScopedValue of [
        preview.manifestId,
        `Instructions for ${resolved.source.externalId}.`,
        `facts for ${resolved.source.externalId}`,
        "skill:skill-1",
        "integration:calendar",
      ]) {
        expect(serialized).not.toContain(requestScopedValue);
      }
      database.close();
    }
  });
});
