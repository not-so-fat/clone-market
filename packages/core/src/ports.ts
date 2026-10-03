import type {
  AdoptionSnapshot,
  ApplyResult,
  BotTemplateManifest,
  ClonePlan,
  Evidence,
  OperationIdentity,
  PreviewResult,
  SourceIdentity,
  Template,
  VerifyResult,
} from "./schemas.js";

export interface SourceAdapter {
  readonly source: string;
  listTemplates(input?: { cursor?: string; limit?: number }): Promise<{
    templates: Template[];
    nextCursor?: string;
  }>;
  fetchTemplate(source: SourceIdentity): Promise<unknown>;
  normalizeTemplate(input: unknown, retrievedAt: string): Promise<BotTemplateManifest>;
}

export interface CatalogRepository {
  getTemplate(id: string): Promise<Template | undefined>;
  saveTemplate(template: Template): Promise<void>;
  listTemplates(input?: { cursor?: string; limit?: number }): Promise<{
    templates: Template[];
    nextCursor?: string;
  }>;
}

export interface EvidenceRepository {
  listEvidence(templateId: string): Promise<Evidence[]>;
  saveEvidence(evidence: Evidence): Promise<void>;
  getLatestAdoptionSnapshot(templateId: string): Promise<AdoptionSnapshot | undefined>;
  saveAdoptionSnapshot(snapshot: AdoptionSnapshot): Promise<void>;
}

export interface CapabilityDeclaration {
  id: string;
  version?: string;
  available: boolean;
  detail?: string;
}

export interface CapabilityProvider {
  readonly target: string;
  getCapabilities(): Promise<readonly CapabilityDeclaration[]>;
}

export interface TargetAdapter {
  readonly target: string;
  /** Computes artifacts only. Implementations must not mutate the target. */
  preview(plan: ClonePlan): Promise<PreviewResult>;
  /** Applies an approved plan. The idempotency key makes retries safe. */
  apply(plan: ClonePlan, operation: OperationIdentity): Promise<ApplyResult>;
  /** Runs target checks under an explicit, traceable operation identity. */
  verify(
    input: { plan: ClonePlan; targetReference: string },
    operation: OperationIdentity,
  ): Promise<VerifyResult>;
}
