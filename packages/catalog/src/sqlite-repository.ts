import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import {
  CatalogRecordSchema,
  type CatalogChangeType,
  type CatalogEntry,
  type CatalogHistoryEntry,
  type CatalogQuery,
  type CatalogReconciliationInput,
  type CatalogReconciliationReport,
  type CatalogRecord,
  type CatalogRepository,
  type SourceIdentity,
} from "@clone-market/core";

import { migrations } from "./migrations.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

type Row = Record<string, unknown>;

function integer(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : Number(value);
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Catalog database contains a non-text value");
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function allowedContent(record: CatalogRecord): object {
  const { template, sourceMetadata } = record;
  return {
    schemaVersion: template.schemaVersion,
    id: template.id,
    name: template.name,
    summary: template.summary,
    creator: template.creator,
    categories: template.categories,
    featured: template.featured,
    source: template.provenance.source,
    sourceUrl: template.provenance.url,
    sourceMetadata,
  };
}

function contentHash(record: CatalogRecord): string {
  return createHash("sha256").update(canonical(allowedContent(record))).digest("hex");
}

function rowToEntry(row: Row): CatalogEntry {
  const creatorId = row.creator_id;
  const creator = creatorId === null
    ? { name: text(row.creator_name) }
    : { id: text(creatorId), name: text(row.creator_name) };
  return {
    schemaVersion: text(row.schema_version) as CatalogEntry["schemaVersion"],
    id: text(row.template_id),
    name: text(row.name),
    summary: text(row.summary),
    creator,
    categories: JSON.parse(text(row.categories_json)) as string[],
    firstSeenAt: text(row.first_seen_at),
    lastSeenAt: text(row.last_seen_at),
    featured: integer(row.featured) === 1,
    provenance: {
      schemaVersion: text(row.schema_version) as CatalogEntry["schemaVersion"],
      source: { provider: text(row.source), externalId: text(row.source_template_id) },
      retrievedAt: text(row.source_retrieved_at),
      url: text(row.source_url),
    },
    present: integer(row.present) === 1,
    lastRetrievedAt: text(row.last_retrieved_at),
    sourceMetadata: JSON.parse(text(row.source_metadata_json)) as CatalogEntry["sourceMetadata"],
  };
}

function positiveLimit(value: number | undefined): number {
  const limit = value ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError("limit must be an integer from 1 to 500");
  return limit;
}

function offset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const parsed = Number(cursor);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new RangeError("cursor must be a non-negative integer offset");
  return parsed;
}

export class SqliteCatalogRepository implements CatalogRepository {
  readonly #database: DatabaseSyncType;

  constructor(location: string) {
    if (location !== ":memory:") mkdirSync(dirname(location), { recursive: true });
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
    if (current > latest) {
      throw new Error(`Catalog database version ${current} is newer than supported version ${latest}`);
    }
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

  async reconcile(input: CatalogReconciliationInput): Promise<CatalogReconciliationReport> {
    if (input.source.length === 0) throw new TypeError("source must not be empty");
    if (!Number.isFinite(Date.parse(input.retrievedAt))) throw new TypeError("retrievedAt must be an ISO timestamp");

    const records = input.records.map((record) => CatalogRecordSchema.parse(record));
    const externalIds = new Set<string>();
    for (const record of records) {
      const identity = record.template.provenance.source;
      if (identity.provider !== input.source) throw new TypeError(`Template source ${identity.provider} does not match ${input.source}`);
      if (externalIds.has(identity.externalId)) throw new TypeError(`Duplicate source template identifier ${identity.externalId}`);
      externalIds.add(identity.externalId);
    }

    const report: CatalogReconciliationReport = {
      source: input.source,
      retrievedAt: input.retrievedAt,
      total: records.length,
      added: 0,
      changed: 0,
      removed: 0,
      reappeared: 0,
      unchanged: 0,
    };

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      for (const record of records) this.#upsert(record, input.retrievedAt, report);
      const current = this.#database.prepare(
        "SELECT * FROM catalog_templates WHERE source = ? AND present = 1",
      ).all(input.source) as Row[];
      for (const row of current) {
        if (externalIds.has(text(row.source_template_id))) continue;
        this.#database.prepare(
          "UPDATE catalog_templates SET present = 0, last_retrieved_at = ? WHERE catalog_id = ?",
        ).run(input.retrievedAt, row.catalog_id);
        report.removed += 1;
        this.#snapshot(integer(row.catalog_id), "removed", input.retrievedAt);
      }
      this.#database.prepare(`
        INSERT INTO catalog_retrievals (
          source, retrieved_at, item_count, added_count, changed_count,
          removed_count, reappeared_count, unchanged_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        report.source, report.retrievedAt, report.total, report.added, report.changed,
        report.removed, report.reappeared, report.unchanged,
      );
      this.#database.exec("COMMIT");
      return report;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #upsert(record: CatalogRecord, retrievedAt: string, report: CatalogReconciliationReport): void {
    const template = record.template;
    const source = template.provenance.source;
    const hash = contentHash(record);
    const existing = this.#database.prepare(
      "SELECT * FROM catalog_templates WHERE source = ? AND source_template_id = ?",
    ).get(source.provider, source.externalId) as Row | undefined;

    if (existing === undefined) {
      const inserted = this.#database.prepare(`
        INSERT INTO catalog_templates (
          source, source_template_id, template_id, schema_version, source_url, name, summary,
          creator_id, creator_name, categories_json, featured, first_seen_at, last_seen_at,
          source_retrieved_at, last_retrieved_at, present, source_metadata_json, content_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        source.provider, source.externalId, template.id, template.schemaVersion, template.provenance.url,
        template.name, template.summary, template.creator.id ?? null, template.creator.name,
        JSON.stringify(template.categories), template.featured ? 1 : 0, template.provenance.retrievedAt,
        template.provenance.retrievedAt, template.provenance.retrievedAt, retrievedAt,
        JSON.stringify(record.sourceMetadata), hash,
      );
      report.added += 1;
      this.#snapshot(integer(inserted.lastInsertRowid), "added", retrievedAt);
      return;
    }

    const wasPresent = integer(existing.present) === 1;
    const changed = text(existing.content_hash) !== hash;
    this.#database.prepare(`
      UPDATE catalog_templates SET
        template_id = ?, schema_version = ?, source_url = ?, name = ?, summary = ?, creator_id = ?,
        creator_name = ?, categories_json = ?, featured = ?, last_seen_at = ?, source_retrieved_at = ?,
        last_retrieved_at = ?, present = 1, source_metadata_json = ?, content_hash = ?
      WHERE catalog_id = ?
    `).run(
      template.id, template.schemaVersion, template.provenance.url, template.name, template.summary,
      template.creator.id ?? null, template.creator.name, JSON.stringify(template.categories),
      template.featured ? 1 : 0, template.provenance.retrievedAt, template.provenance.retrievedAt,
      retrievedAt, JSON.stringify(record.sourceMetadata), hash, existing.catalog_id,
    );

    if (!wasPresent) {
      report.reappeared += 1;
      this.#snapshot(integer(existing.catalog_id), "reappeared", retrievedAt);
    } else if (changed) {
      report.changed += 1;
      this.#snapshot(integer(existing.catalog_id), "changed", retrievedAt);
    } else {
      report.unchanged += 1;
    }
  }

  #snapshot(catalogId: number, change: CatalogChangeType, capturedAt: string): void {
    const row = this.#database.prepare("SELECT * FROM catalog_templates WHERE catalog_id = ?").get(catalogId) as Row;
    this.#database.prepare(`
      INSERT INTO catalog_snapshots (catalog_id, change_type, captured_at, content_hash, snapshot_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(catalogId, change, capturedAt, row.content_hash, JSON.stringify(rowToEntry(row)));
  }

  async getTemplate(source: SourceIdentity): Promise<CatalogEntry | undefined> {
    const row = this.#database.prepare(
      "SELECT * FROM catalog_templates WHERE source = ? AND source_template_id = ?",
    ).get(source.provider, source.externalId) as Row | undefined;
    return row === undefined ? undefined : rowToEntry(row);
  }

  async listTemplates(input: CatalogQuery = {}): Promise<{ templates: CatalogEntry[]; nextCursor?: string }> {
    const limit = positiveLimit(input.limit);
    const start = offset(input.cursor);
    const conditions: string[] = [];
    const parameters: unknown[] = [];
    if (input.source !== undefined) { conditions.push("source = ?"); parameters.push(input.source); }
    if (input.creator !== undefined) {
      conditions.push("(creator_id = ? OR creator_name = ?)");
      parameters.push(input.creator, input.creator);
    }
    if (input.featured !== undefined) { conditions.push("featured = ?"); parameters.push(input.featured ? 1 : 0); }
    if (input.present !== undefined) { conditions.push("present = ?"); parameters.push(input.present ? 1 : 0); }
    if (input.category !== undefined) {
      conditions.push("EXISTS (SELECT 1 FROM json_each(categories_json) WHERE json_each.value = ?)");
      parameters.push(input.category);
    }
    const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
    const rows = this.#database.prepare(`
      SELECT * FROM catalog_templates ${where}
      ORDER BY name COLLATE NOCASE, source, source_template_id
      LIMIT ? OFFSET ?
    `).all(...parameters, limit + 1, start) as Row[];
    const hasMore = rows.length > limit;
    const templates = rows.slice(0, limit).map(rowToEntry);
    return hasMore ? { templates, nextCursor: String(start + limit) } : { templates };
  }

  async getSourceHistory(source: SourceIdentity): Promise<CatalogHistoryEntry[]> {
    const rows = this.#database.prepare(`
      SELECT snapshots.change_type, snapshots.captured_at, snapshots.content_hash, snapshots.snapshot_json
      FROM catalog_snapshots AS snapshots
      JOIN catalog_templates AS templates ON templates.catalog_id = snapshots.catalog_id
      WHERE templates.source = ? AND templates.source_template_id = ?
      ORDER BY snapshots.snapshot_id
    `).all(source.provider, source.externalId) as Row[];
    return rows.map((row) => ({
      change: text(row.change_type) as CatalogChangeType,
      capturedAt: text(row.captured_at),
      contentHash: text(row.content_hash),
      entry: JSON.parse(text(row.snapshot_json)) as CatalogEntry,
    }));
  }
}
