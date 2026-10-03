import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import {
  AdoptionSnapshotSchema,
  EvidenceSchema,
  type AdoptionSnapshot,
  type Evidence,
  type EvidenceRepository as CoreEvidenceRepository,
} from "@clone-market/core";

import { migrations } from "./migrations.js";
import type {
  AdoptionDerivation,
  ClusterKeyResolver,
  EvidenceImportRow,
  EvidenceStore,
  ImportPreviewRow,
  ImportResult,
  StoredEvidence,
} from "./types.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type Row = Record<string, unknown>;

function string(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Evidence database contains a non-text value");
  return value;
}

function integer(value: unknown): number {
  return Number(value);
}

export function canonicalizeEvidenceUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || ["ref", "source"].includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function storedEvidence(row: Row): StoredEvidence {
  const authorId = row.author_id;
  return {
    schemaVersion: string(row.schema_version) as Evidence["schemaVersion"],
    id: string(row.evidence_id),
    templateId: string(row.template_id),
    provenance: {
      schemaVersion: string(row.schema_version) as Evidence["schemaVersion"],
      source: { provider: string(row.source_provider), externalId: string(row.source_external_id) },
      retrievedAt: string(row.source_retrieved_at),
      url: string(row.source_url),
    },
    author: authorId === null ? { name: string(row.author_name) } : { id: string(authorId), name: string(row.author_name) },
    publishedAt: string(row.published_at),
    collectedAt: string(row.collected_at),
    type: string(row.evidence_type) as Evidence["type"],
    claim: string(row.claim),
    engagement: JSON.parse(string(row.engagement_json)) as Record<string, number>,
    creatorRelationship: string(row.creator_relationship) as Evidence["creatorRelationship"],
    confidence: Number(row.confidence),
    reviewState: string(row.review_state) as StoredEvidence["reviewState"],
    canonicalUrl: string(row.canonical_url),
    clusterKey: string(row.cluster_key),
  };
}

export type SqliteEvidenceRepositoryOptions = {
  canonicalizeUrl?: (url: string) => string;
  clusterKey?: ClusterKeyResolver;
};

export class SqliteEvidenceRepository implements EvidenceStore, CoreEvidenceRepository {
  readonly #database: DatabaseSyncType;
  readonly #canonicalizeUrl: (url: string) => string;
  readonly #clusterKey: ClusterKeyResolver;

  constructor(location: string, options: SqliteEvidenceRepositoryOptions = {}) {
    if (location !== ":memory:") mkdirSync(dirname(location), { recursive: true });
    this.#canonicalizeUrl = options.canonicalizeUrl ?? canonicalizeEvidenceUrl;
    this.#clusterKey = options.clusterKey ?? ((row, canonicalUrl) => row.clusterKey ?? canonicalUrl);
    this.#database = new DatabaseSync(location);
    try {
      this.#database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
      this.#migrate();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  #migrate(): void {
    const current = integer((this.#database.prepare("PRAGMA user_version").get() as Row).user_version);
    const latest = migrations.at(-1)?.version ?? 0;
    if (current > latest) throw new Error(`Evidence database version ${current} is newer than supported version ${latest}`);
    for (const migration of migrations) {
      if (migration.version <= current) continue;
      this.#database.exec("BEGIN IMMEDIATE");
      try {
        this.#database.exec(migration.up);
        this.#database.exec(`PRAGMA user_version = ${migration.version}`);
        this.#database.exec("COMMIT");
      } catch (error) {
        this.#database.exec("ROLLBACK");
        throw error;
      }
    }
  }

  close(): void {
    this.#database.close();
  }

  async listEvidence(templateId: string): Promise<StoredEvidence[]> {
    return (this.#database.prepare(`
      SELECT rows.*, clusters.cluster_key FROM evidence_rows AS rows
      JOIN evidence_clusters AS clusters ON clusters.cluster_id = rows.cluster_id
      WHERE rows.template_id = ? ORDER BY rows.published_at, rows.evidence_id
    `).all(templateId) as Row[]).map(storedEvidence);
  }

  async saveEvidence(evidence: Evidence): Promise<void> {
    const result = await this.importReviewed([{ ...EvidenceSchema.parse(evidence), reviewState: "reviewed" }]);
    if (!result.valid) throw new TypeError(result.diagnostics.map(({ message }) => message).join("; "));
  }

  async importReviewed(rows: EvidenceImportRow[], options: { dryRun?: boolean } = {}): Promise<ImportResult> {
    const prepared = rows.map((input, index) => {
      const { reviewState: _reviewState, clusterKey: _clusterKey, ...contract } = input;
      const evidence = EvidenceSchema.parse(contract);
      const canonicalUrl = this.#canonicalizeUrl(evidence.provenance.url);
      const clusterKey = this.#clusterKey(input, canonicalUrl).trim();
      if (clusterKey.length === 0 || clusterKey.length > 512) throw new TypeError(`Row ${index + 1}: clusterKey must contain 1 to 512 characters`);
      return { input, evidence, canonicalUrl, clusterKey, row: index + 1 };
    });
    const seenUrls = new Set<string>();
    const seenIds = new Set<string>();
    const preview: ImportPreviewRow[] = [];
    for (const item of prepared) {
      const urlKey = `${item.evidence.templateId}\0${item.canonicalUrl}`;
      const existingUrl = this.#database.prepare(
        "SELECT evidence_id FROM evidence_rows WHERE template_id = ? AND canonical_url = ?",
      ).get(item.evidence.templateId, item.canonicalUrl);
      const existingId = this.#database.prepare("SELECT canonical_url FROM evidence_rows WHERE evidence_id = ?").get(item.evidence.id) as Row | undefined;
      if ((existingId !== undefined && string(existingId.canonical_url) !== item.canonicalUrl) || seenIds.has(item.evidence.id)) {
        throw new TypeError(`Row ${item.row}: evidence id ${item.evidence.id} is already used for another row`);
      }
      seenIds.add(item.evidence.id);
      const duplicate = existingUrl !== undefined || seenUrls.has(urlKey);
      seenUrls.add(urlKey);
      preview.push({
        row: item.row, evidenceId: item.evidence.id, canonicalUrl: item.canonicalUrl,
        clusterKey: item.clusterKey, action: duplicate ? "duplicate_url" : "insert",
      });
    }
    const inserted = preview.filter(({ action }) => action === "insert").length;
    const result: ImportResult = {
      valid: true, dryRun: options.dryRun ?? false, total: rows.length, inserted,
      duplicates: rows.length - inserted, diagnostics: [], rows: preview,
    };
    if (options.dryRun) return result;

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      for (const [index, item] of prepared.entries()) {
        if (preview[index]!.action === "duplicate_url") continue;
        this.#database.prepare(`
          INSERT OR IGNORE INTO evidence_clusters (template_id, cluster_key, created_at) VALUES (?, ?, ?)
        `).run(item.evidence.templateId, item.clusterKey, item.evidence.collectedAt);
        const cluster = this.#database.prepare(
          "SELECT cluster_id FROM evidence_clusters WHERE template_id = ? AND cluster_key = ?",
        ).get(item.evidence.templateId, item.clusterKey) as Row;
        const e = item.evidence;
        this.#database.prepare(`
          INSERT INTO evidence_rows (
            evidence_id, template_id, cluster_id, schema_version, source_provider, source_external_id,
            source_url, canonical_url, source_retrieved_at, author_id, author_name, published_at,
            evidence_type, claim, engagement_json, creator_relationship, confidence, collected_at, review_state
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          e.id, e.templateId, cluster.cluster_id, e.schemaVersion, e.provenance.source.provider,
          e.provenance.source.externalId, e.provenance.url, item.canonicalUrl, e.provenance.retrievedAt,
          e.author.id ?? null, e.author.name, e.publishedAt, e.type, e.claim, JSON.stringify(e.engagement),
          e.creatorRelationship, e.confidence, e.collectedAt, item.input.reviewState,
        );
      }
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  async getLatestAdoptionSnapshot(templateId: string): Promise<AdoptionSnapshot | undefined> {
    const row = this.#database.prepare(`
      SELECT snapshot_json FROM adoption_snapshots WHERE template_id = ?
      ORDER BY calculated_at DESC, snapshot_id DESC LIMIT 1
    `).get(templateId) as Row | undefined;
    return row === undefined ? undefined : AdoptionSnapshotSchema.parse(JSON.parse(string(row.snapshot_json)));
  }

  async saveAdoptionSnapshot(snapshot: AdoptionSnapshot): Promise<void> {
    const parsed = AdoptionSnapshotSchema.parse(snapshot);
    this.#database.prepare(`
      INSERT OR REPLACE INTO adoption_snapshots
        (snapshot_key, template_id, calculated_at, evidence_through, snapshot_json, derivation_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(parsed.id, parsed.templateId, parsed.calculatedAt, parsed.evidenceThrough, JSON.stringify(parsed), "null");
  }

  async saveDerivation(derivation: AdoptionDerivation): Promise<void> {
    const snapshot = AdoptionSnapshotSchema.parse(derivation.snapshot);
    this.#database.prepare(`
      INSERT OR REPLACE INTO adoption_snapshots
        (snapshot_key, template_id, calculated_at, evidence_through, snapshot_json, derivation_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.id, snapshot.templateId, snapshot.calculatedAt, snapshot.evidenceThrough,
      JSON.stringify(snapshot), JSON.stringify(derivation),
    );
  }

  async getLatestDerivation(templateId: string): Promise<AdoptionDerivation | undefined> {
    const row = this.#database.prepare(`
      SELECT derivation_json FROM adoption_snapshots WHERE template_id = ?
      ORDER BY calculated_at DESC, snapshot_id DESC LIMIT 1
    `).get(templateId) as Row | undefined;
    if (row === undefined) return undefined;
    const parsed = JSON.parse(string(row.derivation_json)) as AdoptionDerivation | null;
    return parsed ?? undefined;
  }
}
