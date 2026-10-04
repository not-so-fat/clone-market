import { readFile, writeFile, mkdir } from "node:fs/promises";

import type { AdoptionSnapshot, BotTemplateManifest, CatalogEntry, CatalogRepository, SourceAdapter } from "@clone-market/core";
import type { AdoptionEvidenceQuery } from "@clone-market/evidence";
import { BotmancersHttpClient } from "@clone-market/target-botmancers";
import { describe, expect, it } from "vitest";

import { createV1Handlers } from "./http.js";
import { MarketService, type ReviewResponse } from "./market.js";
import { renderCatalog, renderEvidence, renderReview, renderVerification } from "./presentation.js";

const NOW = "2026-10-03T12:00:00.000Z";
const labels = ["listed", "discussed", "emerging", "observed_use"] as const;
const names = ["Atlas Guide", "Discussion Mapper", "Momentum Scout", "Outcome Keeper"];
const entries: CatalogEntry[] = labels.map((label, index) => ({
  schemaVersion: "1.0.0", id: `template-${index + 1}`, name: names[index]!, summary: `Fixture template representing ${label}.`,
  creator: { name: `Creator ${index + 1}` }, categories: ["research"], firstSeenAt: NOW, lastSeenAt: NOW,
  featured: index === 0, provenance: { schemaVersion: "1.0.0", source: { provider: "grok-marketplace", externalId: `template-${index + 1}` }, retrievedAt: NOW, url: `https://example.test/template-${index + 1}` },
  present: true, lastRetrievedAt: NOW, sourceMetadata: { installCount: index },
}));
const selected = entries[3]!;

function evidence(entry: CatalogEntry, label: AdoptionSnapshot["label"]): AdoptionEvidenceQuery {
  const row = { schemaVersion: "1.0.0" as const, id: `evidence-${label}`, templateId: entry.id, provenance: { schemaVersion: "1.0.0" as const, source: { provider: "fixture-social", externalId: label }, retrievedAt: NOW, url: `https://example.test/evidence/${label}` }, author: { name: "Public reviewer" }, publishedAt: NOW, collectedAt: NOW, type: "concrete_outcome" as const, claim: `Public ${label} evidence`, engagement: {}, creatorRelationship: "independent" as const, confidence: .9, reviewState: "reviewed" as const, canonicalUrl: `https://example.test/evidence/${label}`, clusterKey: label };
  return {
    snapshot: { schemaVersion: "1.0.0", id: `snapshot-${label}`, templateId: entry.id, calculatedAt: NOW, evidenceThrough: NOW, uniqueMentions: 1, independentUsageReports: 1, repeatedUseReports: 0, outcomeReports: 1, sourceBreadth: 1, velocity: 1, label, confidence: .9, provenance: { schemaVersion: "1.0.0", source: { provider: "clone-market-evidence", externalId: entry.id }, retrievedAt: NOW, url: `https://example.test/evidence/${label}` } },
    countedEvidenceIds: [row.id], contributions: [{ rule: "quality_usage", passed: true, count: 1, threshold: 1, evidenceIds: [row.id], explanation: "Concrete public outcome contributed to this fixture label." }], evidence: [row],
  };
}

const evidenceById = new Map(entries.map((entry, index) => [entry.id, evidence(entry, labels[index]!) ]));
const manifest: BotTemplateManifest = {
  schemaVersion: "1.0.0", id: "fixture-reviewed-manifest", source: selected.provenance.source, retrievedAt: NOW, provenanceUrl: selected.provenance.url,
  template: { schemaVersion: selected.schemaVersion, id: selected.id, name: selected.name, summary: selected.summary, creator: selected.creator, categories: selected.categories, firstSeenAt: selected.firstSeenAt, lastSeenAt: selected.lastSeenAt, featured: selected.featured, provenance: selected.provenance },
  instructions: "Summarize verified outcomes.", memories: [], skills: [], routines: [], integrations: [{ id: "unsupported-crm", name: "Unsupported CRM", required: true }], unavailableFields: [],
};
const capabilities = { schemaVersion: "1.0.0", target: { provider: "botmancers", runtime: "cloud", version: "1" }, instructionForms: { exact: ["plain_text"], compatible: [] }, memories: "native", skills: "unsupported", routines: "manual", integrations: [], credentials: [], executionModes: ["manual"], safety: { disallowedExecutionBehaviors: ["shell"] } } as const;
const policy = { schemaVersion: "1.0.0", creatorPermission: "granted", redistribution: "private_only", destination: "private", instructionForm: "plain_text" } as const;

function fixtureService() {
  const repository: CatalogRepository = {
    async reconcile(input) { return { source: input.source, retrievedAt: input.retrievedAt, total: input.records.length, added: 0, changed: 0, removed: 0, reappeared: 0, unchanged: input.records.length }; },
    async getTemplate(identity) { return entries.find(({ provenance }) => provenance.source.externalId === identity.externalId); },
    async listTemplates() { return { templates: entries }; },
    async getSourceHistory() { return [{ change: "added", capturedAt: NOW, contentHash: "fixture-hash", entry: selected }]; },
  };
  const adapter: SourceAdapter = { source: "grok-marketplace", async listTemplates() { return { templates: entries }; }, async fetchTemplate() { return { fixture: true }; }, async normalizeTemplate() { return manifest; } };
  let payload: unknown;
  const botmancers = new BotmancersHttpClient({ maxRetries: 0, fetch: async (url, init) => {
    if (url.endsWith("/v1/capabilities")) return { ok: true, status: 200, async json() { return capabilities; } };
    if (init.method === "POST") { payload = JSON.parse(init.body ?? "null"); return { ok: true, status: 200, async json() { return { id: "fixture-bot-1" }; } }; }
    return { ok: true, status: 200, async json() { return { id: "fixture-bot-1", payload }; } };
  } });
  return new MarketService({ catalog: repository, evidence: { async getLatest(id) { return evidenceById.get(id); } }, source() { return adapter; }, botmancers, now: () => NOW });
}

function document(input: { catalog: string; evidence: string; review: string; verification: string; digest: string }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NOT-351 operator proof</title><link rel="stylesheet" href="../../app/styles.css"><style>body{padding:24px}.proof-head{max-width:1100px;margin:auto}.smoke-steps{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:20px 0}.smoke-steps li{list-style:none;padding:10px;border:1px solid #cabd9f;border-radius:8px}.smoke-steps li::before{content:'✓ ';color:#38765a}.proof-section{margin:36px auto;max-width:1100px}.catalog-grid{grid-template-columns:repeat(4,minmax(0,1fr))}@media(max-width:600px){body{padding:12px}.smoke-steps{grid-template-columns:1fr}.catalog-grid{grid-template-columns:1fr}.proof-section{margin:22px auto}.review table{font-size:12px}}</style></head><body data-smoke-status="pending"><main><header class="proof-head"><p class="eyebrow">Fixture-backed browser smoke · NOT-351</p><h1>Catalog → inspector → preview → apply → verify</h1><p>Adoption labels describe public evidence only. They never imply private usage.</p><ol class="smoke-steps"><li>Catalog</li><li>Inspector</li><li>Preview</li><li>Applied</li><li>Verified</li></ol><p><strong>Reviewed digest:</strong> <code>${input.digest}</code></p></header><section class="proof-section" id="catalog"><h2>Complete catalog labels</h2>${input.catalog}</section><section class="proof-section" id="inspector"><p class="eyebrow">Inspector</p><h2>${selected.name}</h2><p>Creator permission: Unknown — not provided by the public source. Redistribution grant: Not provided; private import only.</p><p>Retrieval history: added · ${NOW}</p>${input.evidence}</section><section class="proof-section" id="review">${input.review}</section><section class="proof-section" id="verification">${input.verification}</section></main><script>requestAnimationFrame(()=>{document.body.dataset.smokeStatus='complete';document.title='PASS · NOT-351 operator proof'})</script></body></html>`;
}

describe("fixture-backed operator artifact", () => {
  it("walks catalog through verification and keeps deterministic browser evidence current", async () => {
    const market = fixtureService();
    const handlers = createV1Handlers(market);
    const params = { provider: selected.provenance.source.provider, externalId: selected.provenance.source.externalId };
    const catalog = await market.catalog();
    const detail = await handlers.detail({ params });
    const preview = await handlers.preview({ params, body: { policy } });
    const review = preview.body as ReviewResponse;
    const applied = await handlers.apply({ params, body: { policy, planDigest: review.plan.id, reviewedAt: review.plan.createdAt, approved: true } });
    const targetReference = (applied.body as { result: { targetReference: string } }).result.targetReference;
    const verified = await handlers.verify({ params, body: { policy, planDigest: review.plan.id, reviewedAt: review.plan.createdAt, targetReference } });
    expect([detail.status, preview.status, applied.status, verified.status]).toEqual([200, 200, 200, 200]);
    expect(review.compatibility.assessments).toEqual(expect.arrayContaining([expect.objectContaining({ componentId: "unsupported-crm", classification: "unavailable" })]));
    expect(verified.body).toMatchObject({ status: "passed" });

    const html = document({ catalog: renderCatalog(catalog.items), evidence: renderEvidence(evidenceById.get(selected.id)), review: renderReview(review), verification: renderVerification(verified.body as any), digest: review.plan.id });
    const artifact = { ticket: "NOT-351", generatedAt: NOW, flow: ["catalog", "inspector", "preview", "apply", "verify"], statuses: { detail: detail.status, preview: preview.status, apply: applied.status, verify: verified.status }, unsupportedBeforeApproval: review.compatibility.assessments.filter(({ classification }) => classification === "unavailable").map(({ componentId }) => componentId), verification: (verified.body as { status: string }).status, planDigest: review.plan.id };
    const artifactDirectory = new URL("../artifacts/not-351/", import.meta.url);
    if (process.env.UPDATE_OPERATOR_ARTIFACTS === "1") {
      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(new URL("browser-smoke.html", artifactDirectory), html);
      await writeFile(new URL("browser-smoke.json", artifactDirectory), `${JSON.stringify(artifact, null, 2)}\n`);
    } else {
      expect(await readFile(new URL("browser-smoke.html", artifactDirectory), "utf8")).toBe(html);
      expect(JSON.parse(await readFile(new URL("browser-smoke.json", artifactDirectory), "utf8"))).toEqual(artifact);
    }
  });
});
