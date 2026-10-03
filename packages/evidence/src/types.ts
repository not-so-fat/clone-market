import type { AdoptionSnapshot, Evidence } from "@clone-market/core";

export type ReviewState = "pending" | "reviewed" | "rejected";

export type EvidenceImportRow = Evidence & {
  reviewState: ReviewState;
  /** Optional reviewer-supplied key joining reposts, quotes, or syndicated copies. */
  clusterKey?: string;
};

export type StoredEvidence = Evidence & {
  reviewState: ReviewState;
  canonicalUrl: string;
  clusterKey: string;
};

export type RuleName =
  | "reviewed_evidence"
  | "independent_usage"
  | "quality_usage"
  | "recent_organic_velocity"
  | "multiple_organic_references"
  | "listed_only";

export type RuleContribution = {
  rule: RuleName;
  passed: boolean;
  count: number;
  threshold: number;
  evidenceIds: string[];
  explanation: string;
};

export type AdoptionDerivation = {
  snapshot: AdoptionSnapshot;
  countedEvidenceIds: string[];
  contributions: RuleContribution[];
};

export type AdoptionEvidenceQuery = AdoptionDerivation & {
  /** All stored rows, including duplicates by cluster and non-reviewed rows. */
  evidence: StoredEvidence[];
};

export type ImportDiagnostic = {
  row: number;
  path: string;
  code: string;
  message: string;
};

export type ImportPreviewRow = {
  row: number;
  evidenceId: string;
  canonicalUrl: string;
  clusterKey: string;
  action: "insert" | "update" | "duplicate_url";
};

export type ImportResult = {
  valid: boolean;
  dryRun: boolean;
  total: number;
  inserted: number;
  updated?: number;
  duplicates: number;
  diagnostics: ImportDiagnostic[];
  rows: ImportPreviewRow[];
};

export interface EvidenceStore {
  listEvidence(templateId: string): Promise<StoredEvidence[]>;
  importReviewed(rows: EvidenceImportRow[], options?: { dryRun?: boolean }): Promise<ImportResult>;
  getLatestAdoptionSnapshot(templateId: string): Promise<AdoptionSnapshot | undefined>;
  saveAdoptionSnapshot(snapshot: AdoptionSnapshot): Promise<void>;
  saveDerivation(derivation: AdoptionDerivation): Promise<void>;
  getLatestDerivation(templateId: string): Promise<AdoptionDerivation | undefined>;
}

export type ClusterKeyResolver = (row: EvidenceImportRow, canonicalUrl: string) => string;
