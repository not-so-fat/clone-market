import { createHash } from "node:crypto";

import { AdoptionSnapshotSchema, SCHEMA_VERSION, type EvidenceType } from "@clone-market/core";

import type { AdoptionDerivation, RuleContribution, StoredEvidence } from "./types.js";

const USAGE_TYPES = new Set<EvidenceType>([
  "trying_or_installed", "repeated_use", "concrete_outcome", "complaint_or_failure",
]);
const QUALITY_TYPES = new Set<EvidenceType>(["repeated_use", "concrete_outcome"]);
const TYPE_PRIORITY: Record<EvidenceType, number> = {
  creator_promo: 0,
  shared_without_use: 1,
  trying_or_installed: 2,
  complaint_or_failure: 3,
  repeated_use: 4,
  concrete_outcome: 5,
};
const RELATIONSHIP_PRIORITY: Record<StoredEvidence["creatorRelationship"], number> = {
  creator: 0,
  affiliated: 1,
  unknown: 2,
  independent: 3,
};
const VELOCITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type ClassifierOptions = {
  calculatedAt: string;
  provenanceUrl?: string;
};

function timestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be an ISO timestamp`);
  return parsed;
}

function representative(rows: StoredEvidence[]): StoredEvidence {
  return [...rows].sort((left, right) =>
    RELATIONSHIP_PRIORITY[right.creatorRelationship] - RELATIONSHIP_PRIORITY[left.creatorRelationship]
    || TYPE_PRIORITY[right.type] - TYPE_PRIORITY[left.type]
    || right.confidence - left.confidence
    || timestamp(left.publishedAt, "publishedAt") - timestamp(right.publishedAt, "publishedAt")
    || left.id.localeCompare(right.id),
  )[0]!;
}

function contribution(
  rule: RuleContribution["rule"], rows: StoredEvidence[], threshold: number, explanation: string,
): RuleContribution {
  return {
    rule,
    passed: rows.length >= threshold,
    count: rows.length,
    threshold,
    evidenceIds: rows.map(({ id }) => id).sort(),
    explanation,
  };
}

function averageConfidence(rows: StoredEvidence[]): number {
  if (rows.length === 0) return 0;
  return Math.round((rows.reduce((total, row) => total + row.confidence, 0) / rows.length) * 1_000_000) / 1_000_000;
}

/** Derives a snapshot from reviewed rows. One representative per cluster can contribute to counts. */
export function deriveAdoptionSnapshot(
  templateId: string,
  evidence: readonly StoredEvidence[],
  options: ClassifierOptions,
): AdoptionDerivation {
  const calculatedTime = timestamp(options.calculatedAt, "calculatedAt");
  const eligible = evidence.filter((row) =>
    row.templateId === templateId
    && row.reviewState === "reviewed"
    && timestamp(row.collectedAt, "collectedAt") <= calculatedTime
    && timestamp(row.publishedAt, "publishedAt") <= calculatedTime,
  );
  const clusters = new Map<string, StoredEvidence[]>();
  for (const row of eligible) {
    const rows = clusters.get(row.clusterKey) ?? [];
    rows.push(row);
    clusters.set(row.clusterKey, rows);
  }
  const counted = [...clusters.values()].map(representative).sort((left, right) =>
    timestamp(left.publishedAt, "publishedAt") - timestamp(right.publishedAt, "publishedAt")
    || left.id.localeCompare(right.id),
  );
  const organic = counted.filter(({ creatorRelationship, type }) =>
    creatorRelationship === "independent" && type !== "creator_promo",
  );
  const usage = organic.filter(({ type }) => USAGE_TYPES.has(type));
  const quality = usage.filter(({ type }) => QUALITY_TYPES.has(type));
  const recentOrganic = organic.filter((row) => {
    const published = timestamp(row.publishedAt, "publishedAt");
    return published <= calculatedTime && published > calculatedTime - VELOCITY_WINDOW_MS;
  });

  const contributions: RuleContribution[] = [
    contribution("reviewed_evidence", counted, 1, "Reviewed evidence is deduplicated to one representative per cluster."),
    contribution("independent_usage", usage, 3, "Observed use requires three independent usage-report clusters."),
    contribution("quality_usage", quality, 1, "Observed use also requires repeated use or a concrete outcome."),
    contribution("recent_organic_velocity", recentOrganic, 3, "Strong velocity is three independent organic clusters published in the trailing 30 days."),
    contribution("multiple_organic_references", organic, 2, "Discussed requires at least two independent organic reference clusters."),
    contribution("listed_only", counted, 0, "Marketplace presence or creator promotion remains Listed."),
  ];

  const observed = usage.length >= 3 && quality.length >= 1;
  const emerging = usage.length >= 2 || recentOrganic.length >= 3;
  const discussed = organic.length >= 2;
  const label = observed ? "observed_use" : emerging ? "emerging" : discussed ? "discussed" : "listed";
  const labelRows = label === "observed_use" || (label === "emerging" && usage.length >= 2)
    ? usage
    : label === "emerging"
      ? recentOrganic
      : label === "discussed"
        ? organic
        : counted;
  const evidenceThrough = counted.length === 0 ? options.calculatedAt : counted.reduce(
    (latest, row) => timestamp(row.collectedAt, "collectedAt") > timestamp(latest, "collectedAt")
      ? row.collectedAt
      : latest,
    counted[0]!.collectedAt,
  );
  const digest = createHash("sha256")
    .update(`${templateId}\0${options.calculatedAt}\0${counted.map(({ id }) => id).join("\0")}`)
    .digest("hex").slice(0, 24);
  const provenanceUrl = options.provenanceUrl ?? `https://clone.market/templates/${encodeURIComponent(templateId)}/evidence`;
  const snapshot = AdoptionSnapshotSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: `adoption-${digest}`,
    templateId,
    calculatedAt: options.calculatedAt,
    evidenceThrough,
    uniqueMentions: counted.length,
    independentUsageReports: usage.length,
    repeatedUseReports: usage.filter(({ type }) => type === "repeated_use").length,
    outcomeReports: usage.filter(({ type }) => type === "concrete_outcome").length,
    sourceBreadth: new Set(counted.map(({ provenance }) => provenance.source.provider)).size,
    velocity: recentOrganic.length,
    label,
    confidence: averageConfidence(labelRows),
    provenance: {
      schemaVersion: SCHEMA_VERSION,
      source: { provider: "clone-market-evidence", externalId: templateId },
      retrievedAt: options.calculatedAt,
      url: provenanceUrl,
    },
  });
  return { snapshot, countedEvidenceIds: labelRows.map(({ id }) => id).sort(), contributions };
}
