import { describe, expect, it } from "vitest";

import {
  ApplyResultSchema,
  BotTemplateManifestSchema,
  ClonePlanSchema,
  jsonSchemas,
  SCHEMA_VERSION,
  validateContract,
  type ContractName,
} from "./index.js";

const timestamp = "2026-10-03T12:00:00.000Z";
const source = { provider: "grok-marketplace", externalId: "projects-manager" };
const provenance = {
  schemaVersion: SCHEMA_VERSION,
  source,
  retrievedAt: timestamp,
  url: "https://example.com/templates/projects-manager",
};
const template = {
  schemaVersion: SCHEMA_VERSION,
  id: "template-1",
  name: "Projects Manager",
  summary: "Keeps projects moving.",
  creator: { id: "creator-1", name: "Creator" },
  categories: ["productivity"],
  firstSeenAt: timestamp,
  lastSeenAt: timestamp,
  featured: true,
  provenance,
};
const manifest = {
  schemaVersion: SCHEMA_VERSION,
  id: "manifest-1",
  source,
  retrievedAt: timestamp,
  provenanceUrl: provenance.url,
  template,
  instructions: "Help manage a project.",
  memories: [{ id: "memory-1", name: "Preferences", content: "Concise updates" }],
  skills: [{ id: "skill-1", name: "Planning", description: "Plans work" }],
  routines: [{ id: "routine-1", name: "Standup", instructions: "Summarize progress" }],
  integrations: [{ id: "integration-1", name: "Issues", required: false }],
  unavailableFields: [],
};
const assessment = {
  schemaVersion: SCHEMA_VERSION,
  componentType: "skill",
  componentId: "skill-1",
  classification: "compatible",
  reason: "Target supports instructions.",
  requiredCapabilities: ["instructions"],
};
const plan = {
  schemaVersion: SCHEMA_VERSION,
  id: "plan-1",
  manifestId: manifest.id,
  source,
  retrievedAt: timestamp,
  provenanceUrl: provenance.url,
  target: { provider: "fixture", runtime: "test" },
  createdAt: timestamp,
  assessments: [assessment],
};

const validContracts: Record<ContractName, unknown> = {
  provenance,
  template,
  botTemplateManifest: manifest,
  evidence: {
    schemaVersion: SCHEMA_VERSION,
    id: "evidence-1",
    templateId: template.id,
    provenance,
    author: { name: "Independent User" },
    publishedAt: timestamp,
    collectedAt: timestamp,
    type: "repeated_use",
    claim: "Used this template for weekly planning.",
    engagement: { likes: 3 },
    creatorRelationship: "independent",
    confidence: 0.9,
  },
  adoptionSnapshot: {
    schemaVersion: SCHEMA_VERSION,
    id: "snapshot-1",
    templateId: template.id,
    calculatedAt: timestamp,
    evidenceThrough: timestamp,
    uniqueMentions: 4,
    independentUsageReports: 3,
    repeatedUseReports: 1,
    outcomeReports: 0,
    sourceBreadth: 2,
    velocity: 1.5,
    label: "observed_use",
    confidence: 0.8,
    provenance,
  },
  compatibilityAssessment: assessment,
  clonePlan: plan,
  previewResult: {
    schemaVersion: SCHEMA_VERSION,
    planId: plan.id,
    summary: "One private target artifact",
    artifacts: [{ path: "agent.md", content: "Generated preview" }],
    warnings: [],
  },
  applyResult: {
    schemaVersion: SCHEMA_VERSION,
    status: "succeeded",
    operationId: "operation-1",
    targetReference: "target-1",
    completedAt: timestamp,
  },
  verifyResult: {
    schemaVersion: SCHEMA_VERSION,
    status: "passed",
    operationId: "operation-2",
    targetReference: "target-1",
    checkedAt: timestamp,
    checks: [{ name: "loads", passed: true, detail: "Target loaded" }],
  },
};

describe("versioned runtime contracts", () => {
  it.each(Object.entries(validContracts))("parses valid %s fixtures", (name, fixture) => {
    expect(validateContract(name as ContractName, fixture)).toMatchObject({ success: true });
  });

  it("returns stable errors for unknown schema versions", () => {
    const result = validateContract("botTemplateManifest", { ...manifest, schemaVersion: "2.0.0" });

    expect(result).toEqual({
      success: false,
      error: {
        code: "invalid_contract",
        contract: "botTemplateManifest",
        issues: [
          {
            code: "unsupported_schema_version",
            path: "schemaVersion",
            message: `Unsupported schema version; expected ${SCHEMA_VERSION}`,
          },
        ],
      },
    });
  });

  it("returns stable errors for malformed provenance URLs", () => {
    const result = validateContract("provenance", { ...provenance, url: "not a URL" });

    expect(result).toEqual({
      success: false,
      error: {
        code: "invalid_contract",
        contract: "provenance",
        issues: [{ code: "invalid_url", path: "url", message: "Expected an absolute URL" }],
      },
    });
  });

  it("requires source identity, retrieval time, and provenance URL on manifests and plans", () => {
    expect(BotTemplateManifestSchema.parse(manifest)).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
      source,
      retrievedAt: timestamp,
      provenanceUrl: provenance.url,
    });
    expect(ClonePlanSchema.parse(plan)).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
      source,
      retrievedAt: timestamp,
      provenanceUrl: provenance.url,
    });
  });

  it("requires operation IDs in operation results", () => {
    expect(() =>
      ApplyResultSchema.parse({
        ...(validContracts.applyResult as Record<string, unknown>),
        operationId: undefined,
      }),
    ).toThrow();
  });

  it("exports a JSON Schema for every public contract", () => {
    expect(Object.keys(jsonSchemas)).toEqual(Object.keys(validContracts));
    for (const schema of Object.values(jsonSchemas)) {
      expect(schema).toMatchObject({ $schema: "https://json-schema.org/draft/2020-12/schema" });
    }
  });
});
