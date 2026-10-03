import { readFile } from "node:fs/promises";

import { BotTemplateManifestSchema, type SourceAdapter, type SourceIdentity } from "@clone-market/core";
import { describe, expect, it } from "vitest";

import { GrokMarketplaceAdapter, SourceRequestError, SourceSchemaDriftError, runLiveSmoke, type FetchClient, type FetchResponse } from "./index.js";
import { parseDetail, parseIndex, type RawGrokDocument } from "./parsing.js";

const retrievedAt = "2026-10-02T18:30:00.000Z";
const fixtureUrl = new URL("../test/fixtures/", import.meta.url);

async function fixture(name: string): Promise<string> {
  return readFile(new URL(name, fixtureUrl), "utf8");
}

function document(body: string, externalId = "index"): RawGrokDocument {
  return {
    body,
    retrievedAt,
    source: { provider: "grok-marketplace", externalId },
    url: externalId === "index" ? "https://x.ai/bot/marketplace/" : `https://x.ai/bot/marketplace/bots/${externalId}`,
  };
}

function response(body: string, status = 200): FetchResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

describe("captured Marketplace index", () => {
  it("reconciles all 89 unique identifiers and Featured placement without a default cap", async () => {
    const body = await fixture("marketplace-index-2026-10-02.html");
    const parsed = parseIndex(document(body));

    expect(parsed).toHaveLength(89);
    expect(new Set(parsed.map(({ template }) => template.provenance.source.externalId))).toHaveLength(89);
    expect(parsed.filter(({ template }) => template.featured).map(({ template }) => template.provenance.source.externalId)).toEqual([
      "bot-projects-manager-20261002", "bot-tinkabot-20261002",
      "bot-dr-eggbot-v2-20261002", "bot-last30days-20261002",
    ]);
    expect(parsed.every(({ installCount }) => installCount === 0)).toBe(true);

    const fetch: FetchClient = async () => response(body);
    const adapter = new GrokMarketplaceAdapter({ fetch, now: () => retrievedAt });
    const contract: SourceAdapter = adapter;
    const result = await contract.listTemplates();
    expect(result.templates).toHaveLength(89);
    expect(result.nextCursor).toBeUndefined();

    const source = result.templates[0]?.provenance.source as SourceIdentity;
    expect(adapter.getSourceMetadata(source)).toEqual({
      source,
      url: "https://x.ai/bot/marketplace/bots/projects-manager",
      retrievedAt,
      installCount: 0,
    });
    expect(adapter.getSourceMetadata(source)).not.toHaveProperty("adoption");
    expect(adapter.getSourceMetadata(source)).not.toHaveProperty("popularity");
  });

  it("reconciles the complete index before applying explicit pagination", async () => {
    const body = await fixture("marketplace-index-2026-10-02.html");
    const adapter = new GrokMarketplaceAdapter({ fetch: async () => response(body), now: () => retrievedAt });
    const first = await adapter.listTemplates({ limit: 40 });
    expect(first.nextCursor).toBe("40");
    const second = await adapter.listTemplates({ cursor: first.nextCursor!, limit: 40 });
    expect(second.nextCursor).toBe("80");
    const third = await adapter.listTemplates({ cursor: second.nextCursor!, limit: 40 });
    expect([...first.templates, ...second.templates, ...third.templates]).toHaveLength(89);
    expect(third.nextCursor).toBeUndefined();
  });
});

describe("detail normalization", () => {
  it("normalizes every public component and validates the versioned manifest", async () => {
    const parsed = parseDetail(document(await fixture("template-full-featured.html"), "project-steward"));
    expect(BotTemplateManifestSchema.parse(parsed.manifest)).toEqual(parsed.manifest);
    expect(parsed.manifest).toMatchSnapshot();
    expect(parsed.installCount).toBe(0);
  });

  it("marks absent public fields unavailable instead of inventing values", async () => {
    const parsed = parseDetail(document(await fixture("template-missing-fields.html"), "minimal-helper"));
    expect(BotTemplateManifestSchema.parse(parsed.manifest)).toEqual(parsed.manifest);
    expect(parsed.manifest).toMatchSnapshot();
    expect(parsed.manifest.unavailableFields).toEqual([
      "template.summary", "template.categories", "template.creator.id",
      "instructions", "memories", "skills", "routines", "integrations",
    ]);
    expect(parsed.manifest.memories).toEqual([]);
    expect(parsed.manifest.skills).toEqual([]);
    expect(parsed.manifest.routines).toEqual([]);
    expect(parsed.manifest.integrations).toEqual([]);
  });

  it("fetches and normalizes through the injected client boundary", async () => {
    const body = await fixture("template-full-featured.html");
    const adapter = new GrokMarketplaceAdapter({ fetch: async () => response(body), now: () => retrievedAt });
    const manifest = await adapter.getTemplate({ provider: adapter.source, externalId: "project-steward" });
    expect(manifest.source.externalId).toBe("project-steward");
    expect(adapter.getSourceMetadata(manifest.source)?.installCount).toBe(0);
  });

  it("rejects a detail payload whose id does not match the requested source", async () => {
    const body = await fixture("template-full-featured.html");
    const adapter = new GrokMarketplaceAdapter({ fetch: async () => response(body), now: () => retrievedAt });
    await expect(adapter.getTemplate({ provider: adapter.source, externalId: "wrong-id" })).rejects.toMatchObject({
      diagnostic: {
        code: "source_schema_drift",
        path: "$rsc.0.0.marketplaceBot.id",
        expected: "requested source identifier wrong-id",
        source: { provider: "grok-marketplace", externalId: "wrong-id" },
        retrievedAt,
      },
    });
  });

  it("uses the documented host and mapped public slug for detail requests", async () => {
    const index = await fixture("marketplace-index-2026-10-02.html");
    const detail = await fixture("template-full-featured.html");
    const urls: string[] = [];
    const adapter = new GrokMarketplaceAdapter({
      fetch: async (url) => { urls.push(url); return response(urls.length === 1 ? index : detail); },
      now: () => retrievedAt,
    });
    const listed = await adapter.listTemplates({ limit: 1 });
    await adapter.fetchTemplate(listed.templates[0]!.provenance.source);
    expect(urls).toEqual([
      "https://x.ai/bot/marketplace/",
      "https://x.ai/bot/marketplace/bots/projects-manager",
    ]);
  });
});

describe("schema drift diagnostics", () => {
  it("rejects duplicate source IDs without returning a partial index", async () => {
    const valid = await fixture("marketplace-index-2026-10-02.html");
    const duplicate = valid.replace('"id": "bot-tinkabot-20261002"', '"id": "bot-projects-manager-20261002"');
    const adapter = new GrokMarketplaceAdapter({ fetch: async () => response(duplicate), now: () => retrievedAt });
    await expect(adapter.listTemplates()).rejects.toMatchObject({
      diagnostic: { code: "source_schema_drift", path: "$rsc.0.0.marketplaceBots.1.id", expected: "unique source identifier", retrievedAt },
    });
    expect(adapter.getSourceMetadata({ provider: adapter.source, externalId: "bot-projects-manager-20261002" })).toBeUndefined();
  });

  it("identifies a malformed record field and preserves retrieval metadata", async () => {
    const valid = await fixture("marketplace-index-2026-10-02.html");
    const malformed = valid.replace('"installCount": 0', '"installCount": "unknown"');
    expect(() => parseIndex(document(malformed))).toThrowError(SourceSchemaDriftError);
    try {
      parseIndex(document(malformed));
    } catch (error) {
      expect(error).toMatchObject({
        diagnostic: {
          code: "source_schema_drift",
          path: "$rsc.0.0.marketplaceBots.0.installCount",
          expected: "non-negative integer",
          actual: "string",
          source: { provider: "grok-marketplace", externalId: "index" },
          url: "https://x.ai/bot/marketplace/",
          retrievedAt,
        },
      });
    }
  });

  it("turns an intentionally changed RSC shape into a visible typed failure", async () => {
    const changed = document(await fixture("template-changed-rsc.html"), "changed-shape");
    expect(() => parseDetail(changed)).toThrowError(SourceSchemaDriftError);
    try {
      parseDetail(changed);
    } catch (error) {
      expect(error).toMatchObject({
        diagnostic: { code: "source_schema_drift", path: "$", expected: expect.stringContaining("RSC property"), source: changed.source, url: changed.url, retrievedAt },
      });
    }
  });
});

describe("responsible request controls", () => {
  it("retries transient failures with exponential backoff and a configurable user agent", async () => {
    const body = await fixture("marketplace-index-2026-10-02.html");
    const statuses = [503, 429, 200];
    const delays: number[] = [];
    const headers: Record<string, string>[] = [];
    const adapter = new GrokMarketplaceAdapter({
      fetch: async (_url, init) => {
        headers.push(init.headers);
        const status = statuses.shift() ?? 500;
        return response(body, status);
      },
      userAgent: "clone-market-test/1.0",
      retryBaseMs: 10,
      maxRetries: 2,
      sleep: async (milliseconds) => { delays.push(milliseconds); },
      now: () => retrievedAt,
    });

    await expect(adapter.listTemplates()).resolves.toMatchObject({ templates: expect.any(Array) });
    expect(delays).toEqual([10, 20]);
    expect(headers).toHaveLength(3);
    expect(headers[0]).toMatchObject({ "user-agent": "clone-market-test/1.0" });
  });

  it("does not retry permanent HTTP failures", async () => {
    let calls = 0;
    const adapter = new GrokMarketplaceAdapter({ fetch: async () => { calls += 1; return response("not found", 404); } });
    await expect(adapter.listTemplates()).rejects.toBeInstanceOf(SourceRequestError);
    expect(calls).toBe(1);
  });

  it("times out hung requests, aborts them, and frees the limiter slot", async () => {
    const signals: AbortSignal[] = [];
    const adapter = new GrokMarketplaceAdapter({
      fetch: async (_url, init) => {
        signals.push(init.signal);
        return new Promise<FetchResponse>(() => undefined);
      },
      concurrency: 1,
      maxRetries: 0,
      requestTimeoutMs: 5,
    });
    await expect(adapter.listTemplates()).rejects.toMatchObject({ attempts: 1 });
    await expect(adapter.listTemplates()).rejects.toMatchObject({ attempts: 1 });
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("bounds concurrent source requests", async () => {
    const body = await fixture("template-full-featured.html");
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const fetch: FetchClient = async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return response(body);
    };
    const adapter = new GrokMarketplaceAdapter({ fetch, concurrency: 2, now: () => retrievedAt });
    const requests = ["one", "two", "three"].map((externalId) => adapter.fetchTemplate({ provider: adapter.source, externalId }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(maximum).toBe(2);
    releases.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
    releases.splice(0).forEach((release) => release());
    await expect(Promise.all(requests)).resolves.toHaveLength(3);
    expect(maximum).toBe(2);
  });
});

describe("operator live smoke", () => {
  it("records the live count and index/detail provenance through the same adapter", async () => {
    const index = await fixture("marketplace-index-2026-10-02.html");
    const detail = (await fixture("template-full-featured.html"))
      .replaceAll("project-steward-public", "projects-manager")
      .replaceAll("project-steward", "bot-projects-manager-20261002");
    let calls = 0;
    const adapter = new GrokMarketplaceAdapter({
      fetch: async () => response(calls++ === 0 ? index : detail),
      now: () => retrievedAt,
    });
    await expect(runLiveSmoke(adapter)).resolves.toEqual({
      status: "passed",
      index: {
        count: 89,
        featuredCount: 4,
        url: "https://x.ai/bot/marketplace/",
        retrievedAt,
      },
      detail: {
        source: { provider: "grok-marketplace", externalId: "bot-projects-manager-20261002" },
        url: "https://x.ai/bot/marketplace/bots/projects-manager",
        retrievedAt,
      },
    });
  });

  it("reports a source block as inconclusive", async () => {
    const adapter = new GrokMarketplaceAdapter({ fetch: async () => response("blocked", 403), maxRetries: 0 });
    await expect(runLiveSmoke(adapter)).resolves.toMatchObject({
      status: "inconclusive",
      reason: "source_request_failed",
      source: { url: "https://x.ai/bot/marketplace/", status: 403, attempts: 1 },
    });
  });
});
