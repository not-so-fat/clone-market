import { z } from "zod/v4";

export const SCHEMA_VERSION = "1.0.0" as const;
const schemaVersion = z.literal(SCHEMA_VERSION);
const identifier = z.string().min(1).max(256);
const timestamp = z.iso.datetime({ offset: true });
const url = z.url();

export const SourceIdentitySchema = z
  .object({
    provider: identifier,
    externalId: identifier,
  })
  .strict()
  .meta({ id: "SourceIdentity" });

export const ProvenanceSchema = z
  .object({
    schemaVersion,
    source: SourceIdentitySchema,
    retrievedAt: timestamp,
    url,
  })
  .strict()
  .meta({ id: "Provenance" });

export const TemplateSchema = z
  .object({
    schemaVersion,
    id: identifier,
    name: z.string().min(1),
    summary: z.string(),
    creator: z.object({ id: identifier.optional(), name: z.string().min(1) }).strict(),
    categories: z.array(z.string().min(1)),
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    featured: z.boolean(),
    provenance: ProvenanceSchema,
  })
  .strict()
  .meta({ id: "Template" });

/** Public index metadata that is safe to retain centrally. Unknown keys are rejected. */
export const CatalogSourceMetadataSchema = z
  .object({ installCount: z.number().int().nonnegative().optional() })
  .strict()
  .meta({ id: "CatalogSourceMetadata" });

export const CatalogRecordSchema = z
  .object({
    template: TemplateSchema,
    sourceMetadata: CatalogSourceMetadataSchema,
  })
  .strict()
  .meta({ id: "CatalogRecord" });

export const ManifestMemorySchema = z
  .object({ id: identifier, name: z.string().min(1), content: z.string() })
  .strict();
export const ManifestSkillSchema = z
  .object({ id: identifier, name: z.string().min(1), description: z.string(), instructions: z.string().optional() })
  .strict();
export const ManifestRoutineSchema = z
  .object({ id: identifier, name: z.string().min(1), instructions: z.string() })
  .strict();
export const ManifestIntegrationSchema = z
  .object({ id: identifier, name: z.string().min(1), required: z.boolean() })
  .strict();

export const BotTemplateManifestSchema = z
  .object({
    schemaVersion,
    id: identifier,
    source: SourceIdentitySchema,
    retrievedAt: timestamp,
    provenanceUrl: url,
    template: TemplateSchema,
    instructions: z.string().optional(),
    memories: z.array(ManifestMemorySchema),
    skills: z.array(ManifestSkillSchema),
    routines: z.array(ManifestRoutineSchema),
    integrations: z.array(ManifestIntegrationSchema),
    unavailableFields: z.array(z.string().min(1)),
  })
  .strict()
  .meta({ id: "BotTemplateManifest" });

export const EvidenceTypeSchema = z.enum([
  "creator_promo",
  "shared_without_use",
  "trying_or_installed",
  "repeated_use",
  "concrete_outcome",
  "complaint_or_failure",
]);

export const EvidenceSchema = z
  .object({
    schemaVersion,
    id: identifier,
    templateId: identifier,
    provenance: ProvenanceSchema,
    author: z.object({ id: identifier.optional(), name: z.string().min(1) }).strict(),
    publishedAt: timestamp,
    collectedAt: timestamp,
    type: EvidenceTypeSchema,
    claim: z.string().min(1),
    engagement: z.record(z.string(), z.number().int().nonnegative()),
    creatorRelationship: z.enum(["creator", "affiliated", "independent", "unknown"]),
    confidence: z.number().min(0).max(1),
  })
  .strict()
  .meta({ id: "Evidence" });

export const AdoptionSnapshotSchema = z
  .object({
    schemaVersion,
    id: identifier,
    templateId: identifier,
    calculatedAt: timestamp,
    evidenceThrough: timestamp,
    uniqueMentions: z.number().int().nonnegative(),
    independentUsageReports: z.number().int().nonnegative(),
    repeatedUseReports: z.number().int().nonnegative(),
    outcomeReports: z.number().int().nonnegative(),
    sourceBreadth: z.number().int().nonnegative(),
    velocity: z.number().nonnegative(),
    label: z.enum(["observed_use", "emerging", "discussed", "listed"]),
    confidence: z.number().min(0).max(1),
    provenance: ProvenanceSchema,
  })
  .strict()
  .meta({ id: "AdoptionSnapshot" });

export const CompatibilityClassificationSchema = z.enum([
  "exact",
  "compatible",
  "partial",
  "unavailable",
  "unsafe",
]);

export const CompatibilityAssessmentSchema = z
  .object({
    schemaVersion,
    componentType: z.enum(["instructions", "memory", "skill", "routine", "integration"]),
    componentId: identifier,
    classification: CompatibilityClassificationSchema,
    reason: z.string().min(1),
    requiredCapabilities: z.array(identifier),
  })
  .strict()
  .meta({ id: "CompatibilityAssessment" });

export const TargetIdentitySchema = z
  .object({ provider: identifier, runtime: identifier, version: z.string().min(1).optional() })
  .strict();

export const ClonePlanSchema = z
  .object({
    schemaVersion,
    id: identifier,
    manifestId: identifier,
    source: SourceIdentitySchema,
    retrievedAt: timestamp,
    provenanceUrl: url,
    target: TargetIdentitySchema,
    createdAt: timestamp,
    assessments: z.array(CompatibilityAssessmentSchema),
  })
  .strict()
  .meta({ id: "ClonePlan" });

export const OperationIdentitySchema = z
  .object({
    operationId: identifier,
    idempotencyKey: z.string().min(1).max(512),
  })
  .strict();

export const PreviewResultSchema = z
  .object({
    schemaVersion,
    planId: identifier,
    summary: z.string(),
    artifacts: z.array(z.object({ path: z.string().min(1), content: z.string() }).strict()),
    warnings: z.array(z.string()),
  })
  .strict()
  .meta({ id: "PreviewResult" });

export const ApplyResultSchema = z
  .discriminatedUnion("status", [
    z
      .object({
        schemaVersion,
        status: z.literal("succeeded"),
        operationId: identifier,
        targetReference: identifier,
        completedAt: timestamp,
      })
      .strict(),
    z
      .object({
        schemaVersion,
        status: z.literal("failed"),
        operationId: identifier,
        error: z.object({ code: identifier, message: z.string().min(1), retryable: z.boolean() }).strict(),
      })
      .strict(),
  ])
  .meta({ id: "ApplyResult" });

export const VerifyResultSchema = z
  .object({
    schemaVersion,
    status: z.enum(["passed", "failed"]),
    operationId: identifier,
    targetReference: identifier,
    checkedAt: timestamp,
    checks: z.array(z.object({ name: z.string().min(1), passed: z.boolean(), detail: z.string() }).strict()),
  })
  .strict()
  .meta({ id: "VerifyResult" });

export type SourceIdentity = z.infer<typeof SourceIdentitySchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Template = z.infer<typeof TemplateSchema>;
export type CatalogSourceMetadata = z.infer<typeof CatalogSourceMetadataSchema>;
export type CatalogRecord = z.infer<typeof CatalogRecordSchema>;
export type CatalogEntry = Template & {
  present: boolean;
  lastRetrievedAt: string;
  sourceMetadata: CatalogSourceMetadata;
};
export type CatalogChangeType = "added" | "changed" | "removed" | "reappeared";
export type CatalogHistoryEntry = {
  change: CatalogChangeType;
  capturedAt: string;
  contentHash: string;
  entry: CatalogEntry;
};
export type CatalogQuery = {
  cursor?: string;
  limit?: number;
  source?: string;
  category?: string;
  creator?: string;
  featured?: boolean;
  present?: boolean;
};
export type CatalogReconciliationInput = {
  source: string;
  retrievedAt: string;
  records: CatalogRecord[];
};
export type CatalogReconciliationReport = {
  source: string;
  retrievedAt: string;
  total: number;
  added: number;
  changed: number;
  removed: number;
  reappeared: number;
  unchanged: number;
};
export type BotTemplateManifest = z.infer<typeof BotTemplateManifestSchema>;
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type AdoptionSnapshot = z.infer<typeof AdoptionSnapshotSchema>;
export type CompatibilityClassification = z.infer<typeof CompatibilityClassificationSchema>;
export type CompatibilityAssessment = z.infer<typeof CompatibilityAssessmentSchema>;
export type TargetIdentity = z.infer<typeof TargetIdentitySchema>;
export type ClonePlan = z.infer<typeof ClonePlanSchema>;
export type OperationIdentity = z.infer<typeof OperationIdentitySchema>;
export type PreviewResult = z.infer<typeof PreviewResultSchema>;
export type ApplyResult = z.infer<typeof ApplyResultSchema>;
export type VerifyResult = z.infer<typeof VerifyResultSchema>;

export const contractSchemas = {
  provenance: ProvenanceSchema,
  template: TemplateSchema,
  botTemplateManifest: BotTemplateManifestSchema,
  evidence: EvidenceSchema,
  adoptionSnapshot: AdoptionSnapshotSchema,
  compatibilityAssessment: CompatibilityAssessmentSchema,
  clonePlan: ClonePlanSchema,
  previewResult: PreviewResultSchema,
  applyResult: ApplyResultSchema,
  verifyResult: VerifyResultSchema,
} as const;

export type ContractName = keyof typeof contractSchemas;
export type ContractValidationIssue = {
  code: "unsupported_schema_version" | "invalid_url" | "invalid_value";
  path: string;
  message: string;
};
export type ContractValidationError = {
  code: "invalid_contract";
  contract: ContractName;
  issues: ContractValidationIssue[];
};

function stableIssue(issue: z.core.$ZodIssue): ContractValidationIssue {
  const path = issue.path.map(String).join(".");
  const isVersion = issue.path.at(-1) === "schemaVersion";
  const isUrl = issue.code === "invalid_format" && "format" in issue && issue.format === "url";
  return {
    code: isVersion ? "unsupported_schema_version" : isUrl ? "invalid_url" : "invalid_value",
    path,
    message: isVersion
      ? `Unsupported schema version; expected ${SCHEMA_VERSION}`
      : isUrl
        ? "Expected an absolute URL"
        : "Contract value is invalid",
  };
}

export function validateContract(
  contract: ContractName,
  input: unknown,
): { success: true; data: z.infer<(typeof contractSchemas)[ContractName]> } | { success: false; error: ContractValidationError } {
  const result = contractSchemas[contract].safeParse(input);
  if (result.success) return result;
  return {
    success: false,
    error: {
      code: "invalid_contract",
      contract,
      issues: result.error.issues.map(stableIssue),
    },
  };
}
