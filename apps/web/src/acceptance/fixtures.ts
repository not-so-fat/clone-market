import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { runCatalogReconciliation } from "@clone-market/catalog";
import { SCHEMA_VERSION, type Evidence, type EvidenceType, type SourceIdentity } from "@clone-market/core";
import {
  EvidenceService,
  SqliteEvidenceRepository,
  type EvidenceImportRow,
} from "@clone-market/evidence";
import {
  GrokMarketplaceAdapter,
  type FetchClient,
  type FetchResponse,
} from "@clone-market/source-grok";

export const ACCEPTANCE_NOW = "2026-10-03T18:00:00.000Z";
export const CHOSEN_SOURCE: SourceIdentity = {
  provider: "grok-marketplace",
  externalId: "bot-projects-manager-20261002",
};
export const CHOSEN_TEMPLATE_ID = `grok-marketplace:${CHOSEN_SOURCE.externalId}`;

const fixtureRoot = new URL("../../../../packages/source-grok/test/fixtures/", import.meta.url);

async function fixture(name: string): Promise<string> {
  return readFile(new URL(name, fixtureRoot), "utf8");
}

function httpResponse(body: string, status = 200): FetchResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

export type FixtureSourceMode = "happy" | "detail_drift" | "detail_unavailable";

/** Fixture-backed Grok adapter: complete captured index + remapped non-sensitive detail. */
export async function createFixtureGrokAdapter(mode: FixtureSourceMode = "happy"): Promise<GrokMarketplaceAdapter> {
  const index = await fixture("marketplace-index-2026-10-02.html");
  const detail = (await fixture("template-full-featured.html"))
    .replaceAll("project-steward-public", "projects-manager")
    .replaceAll("project-steward", "bot-projects-manager-20261002");
  const drifted = await fixture("template-changed-rsc.html");
  const fetch: FetchClient = async (url) => {
    if (url.endsWith("/bot/marketplace/") || url.endsWith("/bot/marketplace")) return httpResponse(index);
    if (mode === "detail_unavailable") return httpResponse("gateway timeout", 503);
    if (mode === "detail_drift") return httpResponse(drifted);
    if (url.includes("/bots/projects-manager") || url.includes(`/bots/${CHOSEN_SOURCE.externalId}`)) {
      return httpResponse(detail);
    }
    return httpResponse("not found", 404);
  };
  const adapter = new GrokMarketplaceAdapter({ fetch, now: () => ACCEPTANCE_NOW, maxRetries: 0, retryBaseMs: 0 });
  // MarketService calls fetchTemplate directly; warm slug→id maps the way getTemplate would.
  await adapter.listTemplates();
  return adapter;
}

function evidenceRow(input: {
  id: string;
  templateId: string;
  type: EvidenceType;
  claim: string;
  publishedAt: string;
}): EvidenceImportRow {
  const url = `https://social.example/posts/${input.id}`;
  const evidence: Evidence = {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    templateId: input.templateId,
    provenance: {
      schemaVersion: SCHEMA_VERSION,
      source: { provider: "fixture-social", externalId: input.id },
      retrievedAt: ACCEPTANCE_NOW,
      url,
    },
    author: { id: `author-${input.id}`, name: `Author ${input.id}` },
    publishedAt: input.publishedAt,
    collectedAt: ACCEPTANCE_NOW,
    type: input.type,
    claim: input.claim,
    engagement: {},
    creatorRelationship: "independent",
    confidence: 0.85,
  };
  return { ...evidence, reviewState: "reviewed" };
}

/** Seed observed-use evidence for the chosen public template (never installCount / private usage). */
export async function seedAcceptanceEvidence(databasePath: string): Promise<{
  service: EvidenceService;
  close: () => void;
}> {
  const repository = new SqliteEvidenceRepository(databasePath);
  const rows = [
    evidenceRow({
      id: "try-1",
      templateId: CHOSEN_TEMPLATE_ID,
      type: "trying_or_installed",
      claim: "Installed Projects Manager for planning.",
      publishedAt: "2026-09-01T10:00:00.000Z",
    }),
    evidenceRow({
      id: "try-2",
      templateId: CHOSEN_TEMPLATE_ID,
      type: "complaint_or_failure",
      claim: "Used it but one routine failed.",
      publishedAt: "2026-09-02T10:00:00.000Z",
    }),
    evidenceRow({
      id: "repeat-1",
      templateId: CHOSEN_TEMPLATE_ID,
      type: "repeated_use",
      claim: "Still using it every week.",
      publishedAt: "2026-09-03T10:00:00.000Z",
    }),
  ];
  const imported = await repository.importReviewed(rows);
  if (!imported.valid) {
    repository.close();
    throw new Error(`Evidence seed failed: ${JSON.stringify(imported.diagnostics)}`);
  }
  const service = new EvidenceService(repository);
  await service.derive(CHOSEN_TEMPLATE_ID, { calculatedAt: ACCEPTANCE_NOW });
  return { service, close: () => repository.close() };
}

export async function reconcileFixtureCatalog(databasePath: string) {
  const adapter = await createFixtureGrokAdapter("happy");
  return runCatalogReconciliation({
    adapter,
    databasePath,
    now: () => ACCEPTANCE_NOW,
  });
}

export function sourceGrokFixtureDirectory(): string {
  return fileURLToPath(fixtureRoot);
}
