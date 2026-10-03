import { EvidenceSchema } from "@clone-market/core";

import type { EvidenceImportRow, ImportDiagnostic, ImportResult } from "./types.js";
import type { EvidenceStore } from "./types.js";

export type ImportFormat = "json" | "csv";

export function parseCsv(input: string): Record<string, string>[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { record.push(field); field = ""; }
    else if (character === "\n") { record.push(field); records.push(record); record = []; field = ""; }
    else if (character !== "\r") field += character;
  }
  if (quoted) throw new TypeError("CSV contains an unterminated quoted field");
  if (field.length > 0 || record.length > 0) { record.push(field); records.push(record); }
  const header = records.shift();
  if (header === undefined || header.length === 0) return [];
  return records.filter((values) => values.some((value) => value.length > 0)).map((values) =>
    Object.fromEntries(header.map((name, index) => [name.trim(), values[index] ?? ""])),
  );
}

function csvRow(row: Record<string, string>): unknown {
  let engagement: unknown = {};
  if (row.engagement !== undefined && row.engagement.length > 0) engagement = JSON.parse(row.engagement);
  const author = row.authorId === undefined || row.authorId.length === 0
    ? { name: row.authorName }
    : { id: row.authorId, name: row.authorName };
  return {
    schemaVersion: row.schemaVersion,
    id: row.id,
    templateId: row.templateId,
    provenance: {
      schemaVersion: row.schemaVersion,
      source: { provider: row.sourceProvider, externalId: row.sourceExternalId },
      retrievedAt: row.sourceRetrievedAt,
      url: row.sourceUrl,
    },
    author,
    publishedAt: row.publishedAt,
    collectedAt: row.collectedAt,
    type: row.type,
    claim: row.claim,
    engagement,
    creatorRelationship: row.creatorRelationship,
    confidence: row.confidence === undefined || row.confidence.length === 0 ? undefined : Number(row.confidence),
    reviewState: row.reviewState,
    ...(row.clusterKey === undefined || row.clusterKey.length === 0 ? {} : { clusterKey: row.clusterKey }),
  };
}

export function parseEvidenceDocument(input: string, format: ImportFormat): unknown[] {
  if (format === "csv") return parseCsv(input).map(csvRow);
  const parsed: unknown = JSON.parse(input);
  if (!Array.isArray(parsed)) throw new TypeError("JSON evidence import must be an array of rows");
  return parsed;
}

export function validateEvidenceRows(input: readonly unknown[]): {
  rows: EvidenceImportRow[];
  diagnostics: ImportDiagnostic[];
} {
  const rows: EvidenceImportRow[] = [];
  const diagnostics: ImportDiagnostic[] = [];
  for (const [index, value] of input.entries()) {
    const rowNumber = index + 1;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      diagnostics.push({ row: rowNumber, path: "", code: "invalid_row", message: "Row must be an object" });
      continue;
    }
    const object = value as Record<string, unknown>;
    const { reviewState, clusterKey, ...contract } = object;
    const result = EvidenceSchema.safeParse(contract);
    if (!result.success) {
      for (const issue of result.error.issues) {
        diagnostics.push({
          row: rowNumber,
          path: issue.path.map(String).join("."),
          code: issue.code,
          message: issue.message,
        });
      }
    }
    if (!(["pending", "reviewed", "rejected"] as unknown[]).includes(reviewState)) {
      diagnostics.push({ row: rowNumber, path: "reviewState", code: "invalid_review_state", message: "Expected pending, reviewed, or rejected" });
    }
    if (clusterKey !== undefined && (typeof clusterKey !== "string" || clusterKey.trim().length === 0 || clusterKey.length > 512)) {
      diagnostics.push({ row: rowNumber, path: "clusterKey", code: "invalid_cluster_key", message: "Expected 1 to 512 characters" });
    }
    const engagement = contract.engagement;
    if (engagement !== null && typeof engagement === "object" && !Array.isArray(engagement)
      && Object.keys(engagement).some((key) => key.toLowerCase() === "installcount")) {
      diagnostics.push({
        row: rowNumber, path: "engagement.installCount", code: "forbidden_metric",
        message: "installCount is catalog metadata, not evidence of use",
      });
    }
    if (result.success && diagnostics.every((diagnostic) => diagnostic.row !== rowNumber)) {
      rows.push({
        ...result.data,
        reviewState: reviewState as EvidenceImportRow["reviewState"],
        ...(typeof clusterKey === "string" ? { clusterKey } : {}),
      });
    }
  }
  return { rows, diagnostics };
}

export async function importEvidence(
  repository: EvidenceStore,
  input: string,
  options: { format: ImportFormat; dryRun?: boolean },
): Promise<ImportResult> {
  let raw: unknown[];
  try {
    raw = parseEvidenceDocument(input, options.format);
  } catch (error) {
    return {
      valid: false, dryRun: options.dryRun ?? false, total: 0, inserted: 0, duplicates: 0, rows: [],
      diagnostics: [{ row: 0, path: "", code: "invalid_document", message: error instanceof Error ? error.message : String(error) }],
    };
  }
  const validated = validateEvidenceRows(raw);
  if (validated.diagnostics.length > 0) {
    return {
      valid: false, dryRun: options.dryRun ?? false, total: raw.length, inserted: 0, duplicates: 0,
      diagnostics: validated.diagnostics, rows: [],
    };
  }
  return repository.importReviewed(validated.rows, options.dryRun === undefined ? {} : { dryRun: options.dryRun });
}
