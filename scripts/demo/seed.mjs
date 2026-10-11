// Idempotent demo seeding for `npm run demo`. Reconciles the fixture catalog
// through the local fixture HTTP boundary (default adapter fetch, exactly like
// the product runtime) and imports the reviewed acceptance evidence rows.
// Reruns upsert: no duplicated catalog templates, evidence rows, snapshots,
// or artifacts.
//
// Workspace packages are imported dynamically so the launcher can rebuild
// packages/*/dist from the current checkout before this module touches them.

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DEMO_CHOSEN_TEMPLATE_ID, DEMO_SEED_NOW } from "./constants.mjs";
import { DemoError } from "./errors.mjs";

/**
 * Reviewed evidence rows for the chosen template. Identical in meaning to
 * apps/web/src/acceptance/fixtures.ts (never installCount / private usage).
 */
export function demoEvidenceRows(now = DEMO_SEED_NOW) {
  return [
    {
      id: "try-1",
      type: "trying_or_installed",
      claim: "Installed Projects Manager for planning.",
      publishedAt: "2026-09-01T10:00:00.000Z",
    },
    {
      id: "try-2",
      type: "complaint_or_failure",
      claim: "Used it but one routine failed.",
      publishedAt: "2026-09-02T10:00:00.000Z",
    },
    {
      id: "repeat-1",
      type: "repeated_use",
      claim: "Still using it every week.",
      publishedAt: "2026-09-03T10:00:00.000Z",
    },
  ].map((row) => ({
    schemaVersion: "1.0.0",
    id: row.id,
    templateId: DEMO_CHOSEN_TEMPLATE_ID,
    provenance: {
      schemaVersion: "1.0.0",
      source: { provider: "fixture-social", externalId: row.id },
      retrievedAt: now,
      url: `https://social.example/posts/${row.id}`,
    },
    author: { id: `author-${row.id}`, name: `Author ${row.id}` },
    publishedAt: row.publishedAt,
    collectedAt: now,
    type: row.type,
    claim: row.claim,
    engagement: {},
    creatorRelationship: "independent",
    confidence: 0.85,
    reviewState: "reviewed",
  }));
}

/**
 * Seed the isolated demo databases. All writes stay under the given paths;
 * operator databases are never referenced.
 *
 * @param {object} input
 * @param {string} input.catalogPath isolated catalog SQLite path
 * @param {string} input.evidencePath isolated evidence SQLite path
 * @param {string} input.artifactDir isolated artifact directory (created empty)
 * @param {string} input.grokBaseUrl fixture source base URL
 * @param {string} [input.now] fixed seed clock (default DEMO_SEED_NOW)
 * @param {Function} [input.fetchClient] fetch override for tests (default: global fetch over HTTP)
 */
export async function prepareDemoDatabases(input) {
  const { catalogPath, evidencePath, artifactDir, grokBaseUrl } = input;
  const now = input.now ?? DEMO_SEED_NOW;
  try {
    await mkdir(artifactDir, { recursive: true });
    await mkdir(dirname(catalogPath), { recursive: true });
    await mkdir(dirname(evidencePath), { recursive: true });

    const [{ GrokMarketplaceAdapter }, { runCatalogReconciliation }, { EvidenceService, SqliteEvidenceRepository }] = await Promise.all([
      import("@clone-market/source-grok"),
      import("@clone-market/catalog"),
      import("@clone-market/evidence"),
    ]);

    const adapter = new GrokMarketplaceAdapter({
      baseUrl: grokBaseUrl,
      now: () => now,
      maxRetries: 0,
      retryBaseMs: 0,
      ...(input.fetchClient === undefined ? {} : { fetch: input.fetchClient }),
    });
    const catalog = await runCatalogReconciliation({
      adapter,
      databasePath: catalogPath,
      now: () => now,
    });

    const repository = new SqliteEvidenceRepository(evidencePath);
    try {
      const imported = await repository.importReviewed(demoEvidenceRows(now));
      if (!imported.valid) {
        throw new Error(`Evidence seed failed: ${JSON.stringify(imported.diagnostics)}`);
      }
      const service = new EvidenceService(repository);
      const derivation = await service.derive(DEMO_CHOSEN_TEMPLATE_ID, { calculatedAt: now });
      return {
        catalog: {
          total: catalog.total,
          added: catalog.added,
          changed: catalog.changed,
          removed: catalog.removed,
          reappeared: catalog.reappeared,
          unchanged: catalog.unchanged,
        },
        evidence: {
          rows: imported.total - imported.duplicates,
          snapshotId: derivation.snapshot.id,
          label: derivation.snapshot.label,
        },
      };
    } finally {
      repository.close();
    }
  } catch (error) {
    if (error instanceof DemoError) throw error;
    throw new DemoError(
      "demo_seed_failed",
      `Demo seeding cannot complete (${error instanceof Error ? error.message : "unknown error"}).`,
      `remove the demo directory and retry; if it persists, run npm run build and check ${catalogPath} is writable.`,
    );
  }
}
