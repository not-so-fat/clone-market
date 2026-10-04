import { describe, expect, it } from "vitest";
import type { AdoptionSnapshot, BotTemplateManifest, CatalogEntry, CatalogRepository, SourceAdapter } from "@clone-market/core";
import type { AdoptionEvidenceQuery, StoredEvidence } from "@clone-market/evidence";
import { BotmancersHttpClient } from "@clone-market/target-botmancers";
import { MarketService } from "./market.js";
import { createV1Handlers } from "./http.js";
import { renderCatalog, renderEvidence, renderReview } from "./presentation.js";

const NOW = "2026-10-03T12:00:00.000Z";
const source = { provider: "grok-marketplace", externalId: "template-1" };
const entry: CatalogEntry = {
  schemaVersion: "1.0.0", id: "template-1", name: "Signal Scout", summary: "Finds useful signals.", creator: { name: "Ada" }, categories: ["research"], firstSeenAt: NOW, lastSeenAt: NOW, featured: true,
  provenance: { schemaVersion: "1.0.0", source, retrievedAt: NOW, url: "https://example.test/template-1" }, present: true, lastRetrievedAt: NOW, sourceMetadata: { installCount: 12 },
};
const manifest: BotTemplateManifest = {
  schemaVersion: "1.0.0", id: "manifest-1", source, retrievedAt: NOW, provenanceUrl: "https://example.test/template-1", template: { schemaVersion: entry.schemaVersion, id: entry.id, name: entry.name, summary: entry.summary, creator: entry.creator, categories: entry.categories, firstSeenAt: entry.firstSeenAt, lastSeenAt: entry.lastSeenAt, featured: entry.featured, provenance: entry.provenance },
  instructions: "Research carefully.", memories: [{ id: "memory-1", name: "Notes", content: "facts" }], skills: [], routines: [], integrations: [{ id: "unsupported-api", name: "Unsupported API", required: true }], unavailableFields: ["skills.instructions"],
};
const capabilities = {
  schemaVersion: "1.0.0", target: { provider: "botmancers", runtime: "cloud", version: "1" }, instructionForms: { exact: ["plain_text"], compatible: [] }, memories: "native", skills: "unsupported", routines: "manual", integrations: [], credentials: [], executionModes: ["manual"], safety: { disallowedExecutionBehaviors: ["shell"] },
} as const;
const policy = { schemaVersion: "1.0.0", creatorPermission: "granted", redistribution: "private_only", destination: "private", instructionForm: "plain_text" } as const;

function repository(items: CatalogEntry[] = [entry]): CatalogRepository & { writes: unknown[] } {
  const writes: unknown[] = [];
  return {
    writes,
    async reconcile(input) { writes.push(input); return { source: input.source, retrievedAt: input.retrievedAt, total: input.records.length, added: 0, changed: 0, removed: 0, reappeared: 0, unchanged: input.records.length }; },
    async getTemplate(identity) { return items.find((item) => item.provenance.source.provider === identity.provider && item.provenance.source.externalId === identity.externalId); },
    async listTemplates(input = {}) { const start = Number(input.cursor ?? 0); const limit = input.limit ?? 50; const templates = items.slice(start, start + limit); return start + limit < items.length ? { templates, nextCursor: String(start + limit) } : { templates }; },
    async getSourceHistory() { return [{ change: "added", capturedAt: NOW, contentHash: "hash", entry }]; },
  };
}

function adapter(overrides: Partial<SourceAdapter> = {}): SourceAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    source: "grok-marketplace", calls,
    async listTemplates() { return { templates: [entry] }; },
    async fetchTemplate() { calls.push("fetchTemplate"); return { private: "request-only" }; },
    async normalizeTemplate() { calls.push("normalizeTemplate"); return manifest; },
    ...overrides,
  };
}

function snapshot(label: AdoptionSnapshot["label"], evidenceThrough = NOW): AdoptionSnapshot {
  return { schemaVersion: "1.0.0", id: `snapshot-${label}`, templateId: entry.id, calculatedAt: NOW, evidenceThrough, uniqueMentions: 1, independentUsageReports: 1, repeatedUseReports: 0, outcomeReports: 0, sourceBreadth: 1, velocity: 1, label, confidence: .8, provenance: { schemaVersion: "1.0.0", source: { provider: "clone-market-evidence", externalId: entry.id }, retrievedAt: NOW, url: "https://example.test/evidence" } };
}

function evidence(label: AdoptionSnapshot["label"]): AdoptionEvidenceQuery {
  const row: StoredEvidence = { schemaVersion: "1.0.0", id: `row-${label}`, templateId: entry.id, provenance: { schemaVersion: "1.0.0", source: { provider: "x", externalId: "post" }, retrievedAt: NOW, url: "https://example.test/post" }, author: { name: "Reviewer" }, publishedAt: NOW, collectedAt: NOW, type: "trying_or_installed", claim: "I use it", engagement: {}, creatorRelationship: "independent", confidence: .8, reviewState: "reviewed", canonicalUrl: "https://example.test/post", clusterKey: "post" };
  return { snapshot: snapshot(label), countedEvidenceIds: [row.id], contributions: [{ rule: "reviewed_evidence", passed: true, count: 1, threshold: 1, evidenceIds: [row.id], explanation: "Exact contributing row." }], evidence: [row] };
}

function client(state: { posts: number; payload?: unknown; fail?: boolean }) {
  return new BotmancersHttpClient({ maxRetries: 0, fetch: async (url, init) => {
    if (state.fail) throw new Error("target offline");
    if (url.endsWith("/v1/capabilities")) return { ok: true, status: 200, async json() { return capabilities; } };
    if (init.method === "POST") { state.posts += 1; state.payload = JSON.parse(init.body ?? "null"); return { ok: true, status: 200, async json() { return { id: "bot-1" }; } }; }
    return { ok: true, status: 200, async json() { return { id: "bot-1", payload: state.payload }; } };
  } });
}

function service(options: { repo?: ReturnType<typeof repository>; sourceAdapter?: ReturnType<typeof adapter>; state?: { posts: number; payload?: unknown; fail?: boolean }; evidence?: AdoptionEvidenceQuery } = {}) {
  const repo = options.repo ?? repository();
  const sourceAdapter = options.sourceAdapter ?? adapter();
  const state = options.state ?? { posts: 0 };
  const market = new MarketService({ catalog: repo, evidence: { async getLatest() { return options.evidence; } }, source() { return sourceAdapter; }, botmancers: client(state), now: () => NOW });
  return { market, repo, sourceAdapter, state };
}

describe("catalog and inspector", () => {
  it("traverses and renders every repository page without a fixed result cap", async () => {
    const items = Array.from({ length: 205 }, (_, index) => ({ ...entry, id: `template-${index}`, name: `Template ${String(index).padStart(3, "0")}`, provenance: { ...entry.provenance, source: { ...source, externalId: `template-${index}` } } }));
    const { market } = service({ repo: repository(items) });
    const result = await market.catalog();
    expect(result.total).toBe(205);
    expect((renderCatalog(result.items).match(/class="template-card"/g) ?? [])).toHaveLength(205);
  });

  it("uses the SourceAdapter public interface and does not persist a fetched manifest", async () => {
    const context = service();
    const before = JSON.stringify(await context.repo.getTemplate(source));
    const detail = await context.market.detail(source);
    expect(context.sourceAdapter.calls).toEqual(["fetchTemplate", "normalizeTemplate"]);
    expect(detail.manifest.id).toBe("manifest-1");
    expect(context.repo.writes).toEqual([]);
    expect(JSON.stringify(await context.repo.getTemplate(source))).toBe(before);
  });

  it.each(["listed", "discussed", "emerging", "observed_use"] as const)("opens %s to its exact evidence rows and rule contributions", (label) => {
    const html = renderEvidence(evidence(label));
    expect(html).toContain(`data-evidence-id="row-${label}"`);
    expect(html).toContain('data-rule="reviewed_evidence"');
    expect(html).toContain("Exact contributing row.");
  });
});

describe("reviewed clone routes", () => {
  it("keeps preview side-effect free, shows unsupported rows, and applies only the displayed approved digest", async () => {
    const context = service();
    const handlers = createV1Handlers(context.market);
    const params = { provider: source.provider, externalId: source.externalId };
    const preview = await handlers.preview({ params, body: { policy } });
    expect(preview.status).toBe(200);
    expect(context.state.posts).toBe(0);
    const review = preview.body as Awaited<ReturnType<MarketService["preview"]>>;
    expect(renderReview(review)).toContain("unavailable");
    const denied = await handlers.apply({ params, body: { policy, planDigest: review.plan.id, approved: false } });
    expect(denied.status).toBe(403);
    expect(context.state.posts).toBe(0);
    const stale = await handlers.apply({ params, body: { policy, planDigest: "sha256:changed", approved: true } });
    expect(stale.status).toBe(409);
    expect(context.state.posts).toBe(0);
    const applied = await handlers.apply({ params, body: { policy, planDigest: review.plan.id, approved: true } });
    expect(applied.status).toBe(200);
    expect(context.state.posts).toBe(1);
    const verified = await handlers.verify({ params, body: { policy, planDigest: review.plan.id, targetReference: "bot-1" } });
    expect(verified.status).toBe(200);
    expect((verified.body as { status: string }).status).toBe("passed");
  });

  it("returns recoverable source-drift and target-unavailable failures without mutation", async () => {
    const drift = service({ sourceAdapter: adapter({ async normalizeTemplate() { throw new Error("schema changed"); } }) });
    const driftResponse = await createV1Handlers(drift.market).preview({ params: { provider: source.provider, externalId: source.externalId }, body: { policy } });
    expect(driftResponse).toMatchObject({ status: 503, body: { error: { code: "source_drift", recoverable: true } } });
    expect(drift.state.posts).toBe(0);
    const offline = service({ state: { posts: 0, fail: true } });
    const offlineResponse = await createV1Handlers(offline.market).preview({ params: { provider: source.provider, externalId: source.externalId }, body: { policy } });
    expect(offlineResponse).toMatchObject({ status: 503, body: { error: { code: "target_unavailable", recoverable: true } } });
    expect(offline.state.posts).toBe(0);
  });
});
