import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AdoptionSnapshot, BotTemplateManifest, CatalogEntry, CatalogRepository, SourceAdapter } from "@clone-market/core";
import { SqliteCatalogRepository } from "@clone-market/catalog";
import { EvidenceService, SqliteEvidenceRepository, type AdoptionEvidenceQuery, type StoredEvidence } from "@clone-market/evidence";
import { BotmancersHttpClient, DeclaredBotmancersCapabilitiesClient } from "@clone-market/target-botmancers";
import { MemoryArtifactSink } from "./artifact-sink.js";
import { MarketService, type ReviewResponse } from "./market.js";
import { createV1Handlers } from "./http.js";
import { renderCatalog, renderEvidence, renderReview } from "./presentation.js";

const NOW = "2026-10-03T12:00:00.000Z";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
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
    async normalizeTemplate(_input, retrievedAt) {
      calls.push("normalizeTemplate");
      return { ...manifest, retrievedAt, template: { ...manifest.template, provenance: { ...manifest.template.provenance, retrievedAt } } };
    },
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

type ClientState = { posts: number; payload?: unknown; fail?: boolean; failImports?: boolean; failReads?: boolean; idempotencyKeys?: string[]; capabilityResponses?: unknown[] };

function client(state: ClientState) {
  return new BotmancersHttpClient({ maxRetries: 0, fetch: async (url, init) => {
    if (state.fail) throw new Error("target offline");
    if (url.endsWith("/v1/capabilities")) return { ok: true, status: 200, async json() { return state.capabilityResponses?.shift() ?? capabilities; } };
    if (init.method === "POST") {
      if (state.failImports) throw new Error("target import failed");
      state.posts += 1;
      state.idempotencyKeys?.push(init.headers["idempotency-key"]!);
      state.payload = JSON.parse(init.body ?? "null");
      return { ok: true, status: 200, async json() { return { id: "bot-1" }; } };
    }
    if (state.failReads) throw new Error("target read failed");
    return { ok: true, status: 200, async json() { return { id: "bot-1", payload: state.payload }; } };
  } });
}

function service(options: { repo?: ReturnType<typeof repository>; sourceAdapter?: ReturnType<typeof adapter>; state?: ClientState; evidence?: AdoptionEvidenceQuery; now?: () => string; manifestFilterConcurrency?: number; artifacts?: MemoryArtifactSink; botmancers?: ReturnType<typeof client> | DeclaredBotmancersCapabilitiesClient } = {}) {
  const repo = options.repo ?? repository();
  const sourceAdapter = options.sourceAdapter ?? adapter();
  const state = options.state ?? { posts: 0 };
  const artifacts = options.artifacts ?? new MemoryArtifactSink();
  const market = new MarketService({ catalog: repo, evidence: { async getLatest() { return options.evidence; } }, source() { return sourceAdapter; }, botmancers: options.botmancers ?? client(state), artifacts, now: options.now ?? (() => NOW), manifestFilterConcurrency: options.manifestFilterConcurrency });
  return { market, repo, sourceAdapter, state, artifacts };
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

  it("keeps live capability-filter drift isolated to the affected template", async () => {
    const second = { ...entry, id: "template-2", name: "Drifted template", provenance: { ...entry.provenance, source: { ...source, externalId: "template-2" } } };
    const sourceAdapter = adapter({
      async fetchTemplate(identity) {
        if (identity.externalId === "template-2") throw new Error("detail schema changed");
        return { identity };
      },
    });
    const { market } = service({ repo: repository([entry, second]), sourceAdapter });
    const result = await market.catalog({ capability: "instructions" });
    expect(result.items.map(({ id }) => id)).toEqual([entry.id]);
    expect(result.filterWarnings).toEqual([{ source: second.provenance.source, code: "source_drift", message: "detail schema changed" }]);
  });

  it("bounds concurrent live manifest requests for capability filters", async () => {
    const items = Array.from({ length: 12 }, (_, index) => ({ ...entry, id: `template-${index}`, provenance: { ...entry.provenance, source: { ...source, externalId: `template-${index}` } } }));
    let active = 0;
    let maximum = 0;
    const sourceAdapter = adapter({
      async fetchTemplate(identity) {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return { identity };
      },
    });
    const { market } = service({ repo: repository(items), sourceAdapter, manifestFilterConcurrency: 3 });
    expect((await market.catalog({ capability: "instructions" })).items).toHaveLength(items.length);
    expect(maximum).toBe(3);
  });

  it("maps a catalog database failure during manifest lookup precisely", async () => {
    const repo = repository();
    repo.getTemplate = async () => { throw new Error("catalog locked"); };
    const response = await createV1Handlers(service({ repo }).market).detail({ params: { provider: source.provider, externalId: source.externalId } });
    expect(response).toMatchObject({ status: 503, body: { error: { code: "stored_data_unavailable", message: "catalog locked" } } });
  });

  it("serves stored evidence without fetching the live Grok manifest", async () => {
    const sourceAdapter = adapter({ async fetchTemplate() { throw new Error("Grok offline"); } });
    const context = service({ sourceAdapter, evidence: evidence("discussed") });
    const response = await createV1Handlers(context.market).evidence({ params: { provider: source.provider, externalId: source.externalId } });
    expect(response.status).toBe(200);
    expect((response.body as AdoptionEvidenceQuery).snapshot.label).toBe("discussed");
    expect(sourceAdapter.calls).toEqual([]);
  });

  it("does not persist request-scoped manifest content in either real SQLite database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "clone-market-web-boundary-"));
    temporaryDirectories.push(directory);
    const catalogPath = join(directory, "catalog.sqlite");
    const evidencePath = join(directory, "evidence.sqlite");
    const catalog = new SqliteCatalogRepository(catalogPath);
    await catalog.reconcile({ source: source.provider, retrievedAt: NOW, records: [{ template: {
      schemaVersion: entry.schemaVersion, id: entry.id, name: entry.name, summary: entry.summary,
      creator: entry.creator, categories: entry.categories, firstSeenAt: entry.firstSeenAt,
      lastSeenAt: entry.lastSeenAt, featured: entry.featured, provenance: entry.provenance,
    }, sourceMetadata: entry.sourceMetadata }] });
    const evidenceRepository = new SqliteEvidenceRepository(evidencePath);
    const state = { posts: 0 };
    const market = new MarketService({ catalog, evidence: new EvidenceService(evidenceRepository), source() { return adapter(); }, botmancers: client(state), now: () => NOW });
    const handlers = createV1Handlers(market);
    const params = { provider: source.provider, externalId: source.externalId };
    expect((await handlers.detail({ params })).status).toBe(200);
    const preview = await handlers.preview({ params, body: { policy } });
    const review = preview.body as ReviewResponse;
    expect((await handlers.apply({ params, body: { policy, planDigest: review.plan.id, reviewedAt: review.plan.createdAt, approved: true } })).status).toBe(200);
    catalog.close();
    evidenceRepository.close();

    for (const path of [catalogPath, evidencePath]) {
      const database = new DatabaseSync(path, { readOnly: true });
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
      const persisted = tables.flatMap(({ name }) => database.prepare(`SELECT * FROM ${name}`).all());
      const serialized = JSON.stringify(persisted);
      for (const requestScopedValue of [manifest.id, manifest.instructions, manifest.memories[0]!.content, manifest.integrations[0]!.id]) {
        expect(serialized).not.toContain(requestScopedValue);
      }
      database.close();
    }
  });

  it.each(["listed", "discussed", "emerging", "observed_use"] as const)("opens %s to its exact evidence rows and rule contributions", (label) => {
    const html = renderEvidence(evidence(label));
    expect(html).toContain(`data-evidence-id="row-${label}"`);
    expect(html).toContain('data-rule="reviewed_evidence"');
    expect(html).toContain("Exact contributing row.");
  });

  it("links an adoption label to its evidence rows and shows the evidence-through timestamp", async () => {
    const { market } = service({ evidence: evidence("observed_use") });
    const html = renderCatalog((await market.catalog()).items);
    expect(html).toContain('href="/templates/grok-marketplace/template-1#evidence"');
    expect(html).toContain(`fresh · through ${NOW}`);
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
    const review = preview.body as ReviewResponse;
    expect(review).not.toHaveProperty("manifest");
    expect(renderReview(review)).toContain("unavailable");
    const reviewedAt = review.plan.createdAt;
    const denied = await handlers.apply({ params, body: { policy, planDigest: review.plan.id, reviewedAt, approved: false } });
    expect(denied.status).toBe(403);
    expect(context.state.posts).toBe(0);
    const stale = await handlers.apply({ params, body: { policy, planDigest: "sha256:changed", reviewedAt, approved: true } });
    expect(stale.status).toBe(409);
    expect(context.state.posts).toBe(0);
    const applied = await handlers.apply({ params, body: { policy, planDigest: review.plan.id, reviewedAt, approved: true } });
    expect(applied.status).toBe(200);
    expect(context.state.posts).toBe(1);
    expect(applied.body).toMatchObject({ verification: { status: "passed", targetReference: "bot-1" } });
    const verified = await handlers.verify({ params, body: { policy, planDigest: review.plan.id, reviewedAt, targetReference: "bot-1" } });
    expect(verified.status).toBe(200);
    expect((verified.body as { status: string }).status).toBe("passed");
  });

  it("maps target plan rejection separately from target availability", async () => {
    const changedCapabilities = { ...capabilities, target: { ...capabilities.target, version: "2" } };
    const context = service({ state: { posts: 0, capabilityResponses: [capabilities, changedCapabilities] } });
    const response = await createV1Handlers(context.market).preview({ params: { provider: source.provider, externalId: source.externalId }, body: { policy } });
    expect(response).toMatchObject({ status: 503, body: { error: { code: "unsafe_plan", recoverable: true } } });
    expect(context.state.posts).toBe(0);
  });

  it("verifies in the apply request so later source drift cannot invite a duplicate clone", async () => {
    let drifted = false;
    const sourceAdapter = adapter({
      async normalizeTemplate(input, retrievedAt) {
        if (drifted) throw new Error("source changed after import");
        return adapter().normalizeTemplate(input, retrievedAt);
      },
    });
    const context = service({ sourceAdapter });
    const handlers = createV1Handlers(context.market);
    const params = { provider: source.provider, externalId: source.externalId };
    const preview = await handlers.preview({ params, body: { policy } });
    const review = preview.body as ReviewResponse;
    const body = { policy, planDigest: review.plan.id, reviewedAt: review.plan.createdAt, approved: true };
    const applied = await handlers.apply({ params, body });
    expect(applied).toMatchObject({ status: 200, body: { verification: { status: "passed" } } });
    drifted = true;
    const laterVerification = await handlers.verify({ params, body: { policy, planDigest: review.plan.id, reviewedAt: review.plan.createdAt, targetReference: "bot-1" } });
    expect(laterVerification).toMatchObject({ status: 503, body: { error: { code: "source_drift" } } });
    expect(context.state.posts).toBe(1);
  });

  it("returns a created clone with a verification-only error instead of inviting re-apply", async () => {
    const state: ClientState = { posts: 0 };
    const context = service({ state });
    const handlers = createV1Handlers(context.market);
    const params = { provider: source.provider, externalId: source.externalId };
    const preview = await handlers.preview({ params, body: { policy } });
    const review = preview.body as ReviewResponse;
    state.failReads = true;
    const applied = await handlers.apply({ params, body: { policy, planDigest: review.plan.id, reviewedAt: review.plan.createdAt, approved: true } });
    expect(applied).toMatchObject({
      status: 200,
      body: {
        result: { status: "succeeded", targetReference: "bot-1" },
        verificationError: { code: "target_unavailable", recoverable: true },
      },
    });
    expect(state.posts).toBe(1);
  });

  it("keeps an unchanged reviewed digest applicable across later server clock ticks", async () => {
    const times = [NOW, "2026-10-03T12:01:00.000Z", "2026-10-03T12:02:00.000Z"];
    let index = 0;
    const context = service({ now: () => times[Math.min(index++, times.length - 1)]! });
    const handlers = createV1Handlers(context.market);
    const params = { provider: source.provider, externalId: source.externalId };
    const preview = await handlers.preview({ params, body: { policy } });
    const review = preview.body as ReviewResponse;
    const applied = await handlers.apply({ params, body: { policy, planDigest: review.plan.id, reviewedAt: review.plan.createdAt, approved: true } });
    expect(applied.status).toBe(200);
    expect(context.state.posts).toBe(1);
  });

  it("reuses a deterministic Botmancers idempotency key for an approved-plan retry", async () => {
    const state: ClientState = { posts: 0, idempotencyKeys: [] };
    const context = service({ state });
    const handlers = createV1Handlers(context.market);
    const params = { provider: source.provider, externalId: source.externalId };
    const preview = await handlers.preview({ params, body: { policy } });
    const review = preview.body as ReviewResponse;
    const body = { policy, planDigest: review.plan.id, reviewedAt: review.plan.createdAt, approved: true };
    expect((await handlers.apply({ params, body })).status).toBe(200);
    expect((await handlers.apply({ params, body })).status).toBe(200);
    expect(state.idempotencyKeys).toHaveLength(2);
    expect(new Set(state.idempotencyKeys).size).toBe(1);
  });

  it("renders exact, compatible, partial, unavailable, and unsafe review rows", async () => {
    const context = service();
    const response = await createV1Handlers(context.market).preview({ params: { provider: source.provider, externalId: source.externalId }, body: { policy } });
    const review = response.body as ReviewResponse;
    const classifications = ["exact", "compatible", "partial", "unavailable", "unsafe"] as const;
    const html = renderReview({
      ...review,
      compatibility: {
        ...review.compatibility,
        assessments: classifications.map((classification, index) => ({
          componentType: "integration" as const,
          componentId: `component-${index}`,
          classification,
          rationaleCode: classification === "exact" ? "integration_exact" as const
            : classification === "compatible" ? "integration_compatible" as const
              : classification === "partial" ? "integration_partial" as const
                : classification === "unavailable" ? "integration_unsupported" as const
                  : "creator_permission_denied" as const,
          requiredCapabilities: [],
          requiredActionIds: [],
        })),
        summary: { exact: 1, compatible: 1, partial: 1, unavailable: 1, unsafe: 1 },
      },
    });
    for (const classification of classifications) expect(html).toContain(`class="${classification}"`);
    expect(html).toContain("Unsafe plan");
    expect(html).toContain("Partial compatibility");
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

    const applyFailure = service({ state: { posts: 0 } });
    const handlers = createV1Handlers(applyFailure.market);
    const params = { provider: source.provider, externalId: source.externalId };
    const preview = await handlers.preview({ params, body: { policy } });
    const review = preview.body as ReviewResponse;
    applyFailure.state.failImports = true;
    const failedApply = await handlers.apply({ params, body: { policy, planDigest: review.plan.id, reviewedAt: review.plan.createdAt, approved: true } });
    expect(failedApply).toMatchObject({ status: 503, body: { error: { code: "target_unavailable", recoverable: true } } });
    expect(applyFailure.state.posts).toBe(0);
  });

  it("exports a Botmancers-compatible artifact, verifies it offline, and repeats with the same digest", async () => {
    const artifacts = new MemoryArtifactSink();
    const context = service({ artifacts });
    const handlers = createV1Handlers(context.market);
    const params = { provider: source.provider, externalId: source.externalId };
    const preview = await handlers.preview({ params, body: { policy } });
    const review = preview.body as ReviewResponse;
    const body = { policy, planDigest: review.plan.id, reviewedAt: review.plan.createdAt, approved: true };
    const first = await handlers.exportArtifact({ params, body });
    const second = await handlers.exportArtifact({ params, body });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(context.state.posts).toBe(0);
    const firstBody = first.body as { identity: string; created: boolean; digest: string; verification: { status: string } };
    const secondBody = second.body as { identity: string; created: boolean; digest: string };
    expect(firstBody.created).toBe(true);
    expect(secondBody.created).toBe(false);
    expect(firstBody.digest).toBe(secondBody.digest);
    expect(firstBody.digest.startsWith("sha256:")).toBe(true);
    expect(firstBody.verification.status).toBe("passed");
    expect(artifacts.store.size).toBe(1);
    const verified = await handlers.verifyArtifact({ params, body: { policy, planDigest: review.plan.id, reviewedAt: review.plan.createdAt, artifactIdentity: firstBody.identity } });
    expect(verified).toMatchObject({ status: 200, body: { status: "passed", targetReference: firstBody.identity } });
  });

  it("does not export when the artifact sink is unavailable, and rejects a tampered artifact", async () => {
    const unavailable = new MemoryArtifactSink();
    unavailable.unavailable = true;
    const blocked = service({ artifacts: unavailable });
    const blockedHandlers = createV1Handlers(blocked.market);
    const params = { provider: source.provider, externalId: source.externalId };
    const preview = await blockedHandlers.preview({ params, body: { policy } });
    const review = preview.body as ReviewResponse;
    const body = { policy, planDigest: review.plan.id, reviewedAt: review.plan.createdAt, approved: true };
    const missingSink = await blockedHandlers.exportArtifact({ params, body });
    expect(missingSink).toMatchObject({ status: 503, body: { error: { code: "sink_unavailable", recoverable: true } } });
    expect(unavailable.store.size).toBe(0);

    const artifacts = new MemoryArtifactSink();
    const context = service({ artifacts });
    const handlers = createV1Handlers(context.market);
    const ready = await handlers.preview({ params, body: { policy } });
    const readyReview = ready.body as ReviewResponse;
    const exported = await handlers.exportArtifact({
      params,
      body: { policy, planDigest: readyReview.plan.id, reviewedAt: readyReview.plan.createdAt, approved: true },
    });
    expect(exported.status).toBe(200);
    const identity = (exported.body as { identity: string }).identity;
    const stored = artifacts.store.get(identity)!;
    stored.set("botmancers/import.json", `${stored.get("botmancers/import.json")} `);
    const tampered = await handlers.verifyArtifact({
      params,
      body: { policy, planDigest: readyReview.plan.id, reviewedAt: readyReview.plan.createdAt, artifactIdentity: identity },
    });
    expect(tampered.status).toBe(200);
    expect(tampered.body).toMatchObject({ status: "failed" });
    expect(JSON.stringify(tampered.body)).toContain("artifact-digest");
  });

  it("previews and exports with declared capabilities and no Botmancers HTTP", async () => {
    const artifacts = new MemoryArtifactSink();
    const context = service({ artifacts, botmancers: new DeclaredBotmancersCapabilitiesClient() });
    const handlers = createV1Handlers(context.market);
    const params = { provider: source.provider, externalId: source.externalId };
    const preview = await handlers.preview({ params, body: { policy } });
    expect(preview.status).toBe(200);
    const review = preview.body as ReviewResponse;
    const exported = await handlers.exportArtifact({
      params,
      body: { policy, planDigest: review.plan.id, reviewedAt: review.plan.createdAt, approved: true },
    });
    expect(exported.status).toBe(200);
    expect((exported.body as { verification: { status: string } }).verification.status).toBe("passed");
    expect(context.state.posts).toBe(0);
  });
});
