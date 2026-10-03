import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SCHEMA_VERSION } from "@clone-market/core";
import { afterEach, describe, expect, it } from "vitest";

import { runEvidenceImportCli } from "./cli.js";
import { importEvidence } from "./importer.js";
import { EvidenceService } from "./service.js";
import { SqliteEvidenceRepository } from "./sqlite-repository.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const temporaryDirectories: string[] = [];
const collectedAt = "2026-10-02T12:00:00.000Z";

async function temporaryPath(name = "evidence.sqlite"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "clone-market-evidence-"));
  temporaryDirectories.push(directory);
  return join(directory, name);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function raw(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    templateId: "template-1",
    provenance: {
      schemaVersion: SCHEMA_VERSION,
      source: { provider: "fixture", externalId: id },
      retrievedAt: collectedAt,
      url: `https://example.test/posts/${id}`,
    },
    author: { id: `author-${id}`, name: `Author ${id}` },
    publishedAt: "2026-10-01T12:00:00.000Z",
    collectedAt,
    type: "shared_without_use",
    claim: `Claim ${id}`,
    engagement: {},
    creatorRelationship: "independent",
    confidence: 0.8,
    reviewState: "reviewed",
    ...overrides,
  };
}

describe("SQLite evidence repository", () => {
  it("deduplicates canonical URLs and cluster chains for independent counts", async () => {
    const repository = new SqliteEvidenceRepository(":memory:");
    const first = raw("original", {
      provenance: {
        schemaVersion: SCHEMA_VERSION,
        source: { provider: "fixture", externalId: "original" },
        retrievedAt: collectedAt,
        url: "https://EXAMPLE.test/posts/chain/?utm_source=newsletter&b=2&a=1#thread",
      },
      clusterKey: "quote-chain",
    });
    const duplicateUrl = raw("duplicate-url", {
      provenance: {
        schemaVersion: SCHEMA_VERSION,
        source: { provider: "fixture", externalId: "duplicate-url" },
        retrievedAt: collectedAt,
        url: "https://example.test/posts/chain?a=1&b=2",
      },
      clusterKey: "other-key",
    });
    const quote = raw("quote", {
      provenance: {
        schemaVersion: SCHEMA_VERSION,
        source: { provider: "fixture", externalId: "quote" },
        retrievedAt: collectedAt,
        url: "https://example.test/posts/quote",
      },
      clusterKey: "quote-chain",
    });
    const imported = await importEvidence(repository, JSON.stringify([first, duplicateUrl, quote]), { format: "json" });
    expect(imported).toMatchObject({ valid: true, inserted: 2, duplicates: 1 });
    expect(imported.rows.map(({ action }) => action)).toEqual(["insert", "duplicate_url", "insert"]);

    const query = await new EvidenceService(repository).derive("template-1", { calculatedAt: "2026-10-03T12:00:00.000Z" });
    expect(query.evidence).toHaveLength(2);
    expect(query.snapshot).toMatchObject({ label: "listed", uniqueMentions: 1 });
    expect(query.contributions.find(({ rule }) => rule === "reviewed_evidence")).toMatchObject({ count: 1 });
    await expect(new EvidenceService(repository).getLatest("template-1")).resolves.toEqual(query);
    repository.close();
  });

  it("uses a configured cluster-key resolver and excludes non-reviewed rows", async () => {
    const repository = new SqliteEvidenceRepository(":memory:", {
      clusterKey: (row) => `${row.templateId}:${row.author.id ?? row.author.name}`,
    });
    const pending = raw("pending", { reviewState: "pending" });
    const first = raw("first", { author: { id: "same-author", name: "Same Author" } });
    const second = raw("second", {
      author: { id: "same-author", name: "Same Author" },
      type: "trying_or_installed",
    });
    await importEvidence(repository, JSON.stringify([pending, first, second]), { format: "json" });
    const query = await new EvidenceService(repository).derive("template-1", { calculatedAt: "2026-10-03T12:00:00.000Z" });
    expect(query.evidence).toHaveLength(3);
    expect(query.snapshot).toMatchObject({ uniqueMentions: 1, independentUsageReports: 1, label: "listed" });
    expect(query.contributions.find(({ rule }) => rule === "reviewed_evidence")?.evidenceIds).toEqual(["second"]);
    repository.close();
  });

  it("normalizes imported timestamps and selects the latest snapshot by instant", async () => {
    const repository = new SqliteEvidenceRepository(":memory:");
    await importEvidence(repository, JSON.stringify([raw("offset-row", {
      publishedAt: "2026-10-01T05:00:00-07:00",
      collectedAt: "2026-10-02T05:00:00-07:00",
    })]), { format: "json" });
    await expect(repository.listEvidence("template-1")).resolves.toMatchObject([
      { publishedAt: "2026-10-01T12:00:00.000Z", collectedAt: "2026-10-02T12:00:00.000Z" },
    ]);
    const service = new EvidenceService(repository);
    const earlier = await service.derive("template-1", { calculatedAt: "2026-10-03T16:30:00Z" });
    const later = await service.derive("template-1", { calculatedAt: "2026-10-03T10:00:00-07:00" });
    expect(earlier.snapshot.id).not.toBe(later.snapshot.id);
    await expect(repository.getLatestAdoptionSnapshot("template-1")).resolves.toMatchObject({ id: later.snapshot.id });
    repository.close();
  });

  it("creates the required row, cluster, and snapshot migration columns", async () => {
    const path = await temporaryPath();
    const repository = new SqliteEvidenceRepository(path);
    repository.close();
    const database = new DatabaseSync(path);
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
    const rowColumns = database.prepare("PRAGMA table_info(evidence_rows)").all() as Array<{ name: string }>;
    expect(tables.map(({ name }) => name)).toEqual(["adoption_snapshots", "evidence_clusters", "evidence_rows"]);
    expect(rowColumns.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "template_id", "source_url", "author_id", "published_at", "evidence_type", "claim",
      "engagement_json", "creator_relationship", "confidence", "collected_at", "review_state", "cluster_id",
    ]));
    database.close();
  });
});

describe("reviewed evidence import CLI", () => {
  it("returns row-level diagnostics for invalid type, provenance, date, confidence, and installCount", async () => {
    const path = await temporaryPath();
    const file = await temporaryPath("invalid.json");
    const unknownType = raw("unknown", { type: "viral_post" });
    const missingProvenance = raw("missing-provenance");
    delete missingProvenance.provenance;
    const invalidDate = raw("bad-date", { publishedAt: "yesterday" });
    const invalidConfidence = raw("bad-confidence", { confidence: 1.5 });
    const forbiddenMetric = raw("install-count", { engagement: { installCount: 42 } });
    writeFileSync(file, JSON.stringify([unknownType, missingProvenance, invalidDate, invalidConfidence, forbiddenMetric]));
    let stdout = "";
    const exit = await runEvidenceImportCli(
      ["--database", path, "--file", file],
      { stdout: (value) => { stdout += value; }, stderr: () => undefined },
    );
    const result = JSON.parse(stdout) as { diagnostics: Array<{ row: number; path: string; code: string }> };
    expect(exit).toBe(1);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 1, path: "type" }),
      expect.objectContaining({ row: 2, path: "provenance" }),
      expect.objectContaining({ row: 3, path: "publishedAt" }),
      expect.objectContaining({ row: 4, path: "confidence" }),
      expect.objectContaining({ row: 5, path: "engagement.installCount", code: "forbidden_metric" }),
    ]));
    const repository = new SqliteEvidenceRepository(path);
    await expect(repository.listEvidence("template-1")).resolves.toEqual([]);
    repository.close();
  });

  it("previews valid JSON without writing evidence rows", async () => {
    const path = await temporaryPath();
    const file = await temporaryPath("valid.json");
    writeFileSync(file, JSON.stringify([raw("dry-run")]));
    let stdout = "";
    const exit = await runEvidenceImportCli(
      ["--database", path, "--file", file, "--dry-run"],
      { stdout: (value) => { stdout += value; }, stderr: () => undefined },
    );
    expect(exit).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ valid: true, dryRun: true, inserted: 1 });
    expect(existsSync(path)).toBe(false);
    const repository = new SqliteEvidenceRepository(path);
    await expect(repository.listEvidence("template-1")).resolves.toEqual([]);
    repository.close();
  });

  it("dry-runs against an existing database without changing it", async () => {
    const path = await temporaryPath();
    const file = await temporaryPath("existing-dry-run.json");
    const repository = new SqliteEvidenceRepository(path);
    await importEvidence(repository, JSON.stringify([raw("already-there")]), { format: "json" });
    repository.close();
    writeFileSync(file, JSON.stringify([raw("already-there"), raw("would-insert")]));
    let stdout = "";
    const exit = await runEvidenceImportCli(
      ["--database", path, "--file", file, "--dry-run"],
      { stdout: (value) => { stdout += value; }, stderr: () => undefined },
    );
    expect(exit).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ valid: true, dryRun: true, inserted: 1, updated: 1 });
    const reopened = new SqliteEvidenceRepository(path);
    await expect(reopened.listEvidence("template-1")).resolves.toMatchObject([{ id: "already-there" }]);
    reopened.close();
  });

  it("does not create a database when validation fails", async () => {
    const path = await temporaryPath();
    const file = await temporaryPath("invalid-no-database.json");
    writeFileSync(file, JSON.stringify([raw("invalid", { publishedAt: "not-a-date" })]));
    const exit = await runEvidenceImportCli(
      ["--database", path, "--file", file],
      { stdout: () => undefined, stderr: () => undefined },
    );
    expect(exit).toBe(1);
    expect(existsSync(path)).toBe(false);
  });

  it("returns malformed CSV engagement as a row-level diagnostic", async () => {
    const repository = new SqliteEvidenceRepository(":memory:");
    const csv = [
      "schemaVersion,id,templateId,sourceProvider,sourceExternalId,sourceUrl,sourceRetrievedAt,authorId,authorName,publishedAt,collectedAt,type,claim,engagement,creatorRelationship,confidence,reviewState",
      `${SCHEMA_VERSION},csv-bad,template-1,blog,post-bad,https://example.test/posts/csv-bad,${collectedAt},author-1,Reviewer,2026-10-01T12:00:00.000Z,${collectedAt},trying_or_installed,Installed it,{bad-json},independent,0.9,reviewed`,
    ].join("\n");
    const result = await importEvidence(repository, csv, { format: "csv" });
    expect(result).toMatchObject({ valid: false, diagnostics: [expect.objectContaining({ row: 1, path: "engagement" })] });
    repository.close();
  });

  it("imports reviewed CSV rows", async () => {
    const repository = new SqliteEvidenceRepository(":memory:");
    const csv = [
      "schemaVersion,id,templateId,sourceProvider,sourceExternalId,sourceUrl,sourceRetrievedAt,authorId,authorName,publishedAt,collectedAt,type,claim,engagement,creatorRelationship,confidence,reviewState,clusterKey",
      `${SCHEMA_VERSION},csv-1,template-1,blog,post-1,https://example.test/posts/csv-1,${collectedAt},author-1,Reviewer,2026-10-01T12:00:00.000Z,${collectedAt},trying_or_installed,Installed it,"{""likes"":2}",independent,0.9,reviewed,`,
    ].join("\n");
    await expect(importEvidence(repository, csv, { format: "csv" })).resolves.toMatchObject({ valid: true, inserted: 1 });
    await expect(repository.listEvidence("template-1")).resolves.toMatchObject([
      { id: "csv-1", engagement: { likes: 2 }, reviewState: "reviewed" },
    ]);
    repository.close();
  });

  it("returns evidence-id conflicts as row-level diagnostics", async () => {
    const repository = new SqliteEvidenceRepository(":memory:");
    await importEvidence(repository, JSON.stringify([raw("same-id")]), { format: "json" });
    const conflicting = raw("same-id", {
      provenance: {
        schemaVersion: SCHEMA_VERSION,
        source: { provider: "fixture", externalId: "other" },
        retrievedAt: collectedAt,
        url: "https://example.test/posts/other",
      },
    });
    await expect(importEvidence(repository, JSON.stringify([conflicting]), { format: "json" })).resolves.toMatchObject({
      valid: false,
      diagnostics: [expect.objectContaining({ row: 1, path: "id", code: "evidence_id_conflict" })],
    });
    repository.close();
  });

  it("promotes a pending row to reviewed when the same evidence is re-imported", async () => {
    const repository = new SqliteEvidenceRepository(":memory:");
    await importEvidence(repository, JSON.stringify([raw("review-later", { reviewState: "pending" })]), { format: "json" });
    const result = await importEvidence(repository, JSON.stringify([raw("review-later", { reviewState: "reviewed" })]), { format: "json" });
    expect(result.rows).toEqual([expect.objectContaining({ action: "update" })]);
    await expect(repository.listEvidence("template-1")).resolves.toMatchObject([
      { id: "review-later", reviewState: "reviewed" },
    ]);
    repository.close();
  });

  it("stores evidence received through the core port as pending review", async () => {
    const repository = new SqliteEvidenceRepository(":memory:");
    const { reviewState: _reviewState, ...evidence } = raw("core-port");
    await repository.saveEvidence(evidence as never);
    await expect(repository.listEvidence("template-1")).resolves.toMatchObject([
      { id: "core-port", reviewState: "pending" },
    ]);
    repository.close();
  });
});

describe("package boundary", () => {
  it("depends only on core and contains no source, target, browser, parser, or UI dependency", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies)).toEqual(["@clone-market/core"]);
    expect(Object.keys(manifest.dependencies)).not.toEqual(expect.arrayContaining([
      "@clone-market/source-grok", "playwright", "puppeteer", "react",
    ]));
  });
});
