import type { AdoptionSnapshot, SourceIdentity, VerifyResult } from "@clone-market/core";
import type { RuleContribution, StoredEvidence } from "@clone-market/evidence";

import type { PeerRepoCheck } from "./peer-repo.js";

export type AcceptanceStatus = "passed" | "failed";

export type FailureCaseId =
  | "source_schema_drift"
  | "botmancers_unavailable"
  | "botmancers_unavailable_apply"
  | "changed_plan_after_preview"
  | "idempotent_retry";

export type FailureCaseReport = {
  id: FailureCaseId;
  status: AcceptanceStatus;
  expectedCode: string;
  httpStatus?: number;
  mutating: false;
  detail: string;
};

export type AcceptanceErrorReport = {
  code: string;
  message: string;
};

export type V0AcceptanceReport = {
  schemaVersion: "1.0.0";
  suite: "v0-acceptance";
  generatedAt: string;
  mode: "fixture" | "live";
  status: AcceptanceStatus;
  exitCode: number;
  error?: AcceptanceErrorReport;
  databases: {
    catalogPath: string;
    evidencePath: string;
    retainedAfterRun: boolean;
  };
  source: {
    retrievedAt: string;
    /** Observed Marketplace index size for this run — never a product hard-cap. */
    count: number;
    url: string;
  };
  reconciliation: {
    added: number;
    changed: number;
    removed: number;
    reappeared: number;
    unchanged: number;
    unexplainedOmissions: SourceIdentity[];
  };
  template?: {
    source: SourceIdentity;
    provenanceUrl: string;
    retrievedAt: string;
    name: string;
  };
  evidence?: {
    label: AdoptionSnapshot["label"];
    snapshot: AdoptionSnapshot;
    contributions: RuleContribution[];
    evidenceRows: StoredEvidence[];
    usesInstallCount: boolean;
    usesPrivateUsage: boolean;
  };
  compatibility?: {
    planDigest: string;
    summary: {
      exact: number;
      compatible: number;
      partial: number;
      unavailable: number;
      unsafe: number;
    };
  };
  approval?: {
    approved: true;
    reviewedAt: string;
    planDigest: string;
  };
  target?: {
    operationId: string;
    botmancersBotId: string;
    verification: VerifyResult;
    returnUrl: string;
    replaySameBot?: boolean;
  };
  browser: {
    status: "operator_required" | "recorded";
    notes: string;
  };
  failureCases: FailureCaseReport[];
  peerRepositories: {
    botmancers: PeerRepoCheck;
  };
};

export function rollupStatus(parts: AcceptanceStatus[]): AcceptanceStatus {
  return parts.includes("failed") ? "failed" : "passed";
}
