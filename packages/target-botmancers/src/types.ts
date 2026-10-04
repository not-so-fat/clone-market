import type { TargetCapabilities } from "@clone-market/compatibility";
import type { SourceIdentity } from "@clone-market/core";

export const BOTMANCERS_IMPORT_SCHEMA_VERSION = "1.0.0" as const;

export type BotmancersCapabilities = TargetCapabilities;

/** Declared V0 Botmancers capability surface used when no import API is configured. */
export const DECLARED_BOTMANCERS_CAPABILITIES: BotmancersCapabilities = {
  schemaVersion: "1.0.0",
  target: { provider: "botmancers", runtime: "cloud", version: "1" },
  instructionForms: { exact: ["plain_text"], compatible: [] },
  memories: "native",
  skills: "unsupported",
  routines: "unsupported",
  integrations: [],
  credentials: [],
  executionModes: ["manual"],
  safety: { disallowedExecutionBehaviors: ["shell"] },
};

export interface BotmancersImportPayload {
  readonly schemaVersion: typeof BOTMANCERS_IMPORT_SCHEMA_VERSION;
  readonly bot: {
    readonly name: string;
    readonly description: string;
    readonly instructions?: string;
  };
  readonly provenance: {
    readonly source: SourceIdentity;
    readonly manifestId: string;
    readonly retrievedAt: string;
    readonly url: string;
    readonly reviewedPlanDigest: string;
  };
}

export interface BotmancersImportRecord {
  readonly id: string;
  readonly payload: BotmancersImportPayload;
}

export interface BotmancersHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type BotmancersFetch = (
  url: string,
  init: {
    readonly method: "GET" | "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly signal: AbortSignal;
  },
) => Promise<BotmancersHttpResponse>;
