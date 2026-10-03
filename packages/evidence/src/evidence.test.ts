import { readFile } from "node:fs/promises";

import { SCHEMA_VERSION, type Evidence, type EvidenceType } from "@clone-market/core";
import { describe, expect, it } from "vitest";

import { deriveAdoptionSnapshot } from "./classifier.js";
import type { StoredEvidence } from "./types.js";

const calculatedAt = "2026-10-03T12:00:00.000Z";

function evidence(
  id: string,
  type: EvidenceType,
  relationship: Evidence["creatorRelationship"] = "independent",
  overrides: Partial<StoredEvidence> = {},
): StoredEvidence {
  const url = `https://social.example/posts/${id}`;
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    templateId: "template-1",
    provenance: {
      schemaVersion: SCHEMA_VERSION,
      source: { provider: "fixture-social", externalId: id },
      retrievedAt: "2026-10-01T12:00:00.000Z",
      url,
    },
    author: { id: `author-${id}`, name: `Author ${id}` },
    publishedAt: "2026-09-15T12:00:00.000Z",
    collectedAt: "2026-10-01T12:00:00.000Z",
    type,
    claim: `Claim ${id}`,
    engagement: {},
    creatorRelationship: relationship,
    confidence: 0.8,
    reviewState: "reviewed",
    canonicalUrl: url,
    clusterKey: id,
    ...overrides,
  };
}

describe("deterministic adoption classification", () => {
  it.each([
    ["one promotion", [evidence("promo-1", "creator_promo", "creator")]],
    ["many promotions", [1, 2, 3, 4].map((number) => evidence(`promo-${number}`, "creator_promo", "creator"))],
    ["promotion engagement", [evidence("promo-engaged", "creator_promo", "creator", { engagement: { likes: 50_000, reposts: 10_000 } })]],
  ])("creator-only evidence remains Listed: %s", (_name, rows) => {
    expect(deriveAdoptionSnapshot("template-1", rows, { calculatedAt }).snapshot).toMatchObject({
      label: "listed",
      independentUsageReports: 0,
    });
  });

  it.each([
    ["observed-positive.json", "observed_use", 3],
    ["observed-one-short.json", "emerging", 2],
  ] as const)("applies the observed-use threshold to %s", async (fixture, label, usageCount) => {
    const raw = JSON.parse(await readFile(new URL(`../test/fixtures/${fixture}`, import.meta.url), "utf8")) as Array<{
      id: string; type: EvidenceType; claim: string; publishedAt: string;
    }>;
    const rows = raw.map((row) => evidence(row.id, row.type, "independent", row));
    const result = deriveAdoptionSnapshot("template-1", rows, { calculatedAt });
    expect(result.snapshot.label).toBe(label);
    expect(result.snapshot.independentUsageReports).toBe(usageCount);
    expect(result.contributions.find(({ rule }) => rule === "quality_usage")).toMatchObject({ passed: true, count: 1 });
  });

  it("returns deterministic Discussed inputs and decisions", () => {
    const result = deriveAdoptionSnapshot("template-1", [
      evidence("share-1", "shared_without_use", "independent", { publishedAt: "2026-01-01T00:00:00.000Z" }),
      evidence("share-2", "shared_without_use", "independent", { publishedAt: "2026-02-01T00:00:00.000Z" }),
    ], { calculatedAt });
    expect(result).toMatchObject({
      snapshot: { label: "discussed", uniqueMentions: 2, independentUsageReports: 0, velocity: 0, confidence: 0.8 },
      countedEvidenceIds: ["share-1", "share-2"],
      contributions: expect.arrayContaining([
        expect.objectContaining({ rule: "independent_usage", passed: false, count: 0, evidenceIds: [] }),
        expect.objectContaining({ rule: "multiple_organic_references", passed: true, count: 2, evidenceIds: ["share-1", "share-2"] }),
      ]),
    });
  });

  it("returns deterministic Emerging inputs from usage and velocity", () => {
    const usage = deriveAdoptionSnapshot("template-1", [
      evidence("try-1", "trying_or_installed"), evidence("try-2", "trying_or_installed"),
    ], { calculatedAt });
    expect(usage).toMatchObject({
      snapshot: { label: "emerging", independentUsageReports: 2 },
      countedEvidenceIds: ["try-1", "try-2"],
    });
    const velocity = deriveAdoptionSnapshot("template-1", [
      evidence("share-1", "shared_without_use"), evidence("share-2", "shared_without_use"),
      evidence("share-3", "shared_without_use"),
    ], { calculatedAt });
    expect(velocity).toMatchObject({
      snapshot: { label: "emerging", velocity: 3, independentUsageReports: 0 },
      countedEvidenceIds: ["share-1", "share-2", "share-3"],
      contributions: expect.arrayContaining([
        expect.objectContaining({ rule: "recent_organic_velocity", passed: true, threshold: 3 }),
      ]),
    });
  });

  it("counts clustered rows once and ignores engagement as evidence of use", () => {
    const result = deriveAdoptionSnapshot("template-1", [
      evidence("original", "shared_without_use", "independent", { clusterKey: "chain-1" }),
      evidence("quote", "trying_or_installed", "independent", {
        clusterKey: "chain-1", engagement: { likes: 1_000_000 },
      }),
    ], { calculatedAt });
    expect(result.snapshot).toMatchObject({ label: "listed", uniqueMentions: 1, independentUsageReports: 1 });
    expect(result.contributions.find(({ rule }) => rule === "reviewed_evidence")?.evidenceIds).toEqual(["quote"]);
  });
});
