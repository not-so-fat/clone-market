import type { SourceIdentity } from "@clone-market/core";

export type GrokRetrievalMetadata = {
  source: SourceIdentity;
  url: string;
  retrievedAt: string;
};

export type SourceSchemaDriftDiagnostic = GrokRetrievalMetadata & {
  code: "source_schema_drift";
  path: string;
  expected: string;
  actual: string;
};

export class SourceSchemaDriftError extends Error {
  readonly diagnostic: SourceSchemaDriftDiagnostic;

  constructor(diagnostic: SourceSchemaDriftDiagnostic) {
    super(`Grok Marketplace schema drift at ${diagnostic.path}: expected ${diagnostic.expected}, received ${diagnostic.actual}`);
    this.name = "SourceSchemaDriftError";
    this.diagnostic = diagnostic;
  }
}

export class SourceRequestError extends Error {
  readonly url: string;
  readonly status?: number;
  readonly attempts: number;

  constructor(input: { url: string; attempts: number; status?: number; cause?: unknown }) {
    super(`Grok Marketplace request failed after ${input.attempts} attempt(s)${input.status === undefined ? "" : ` with status ${input.status}`}`, { cause: input.cause });
    this.name = "SourceRequestError";
    this.url = input.url;
    this.attempts = input.attempts;
    if (input.status !== undefined) this.status = input.status;
  }
}
