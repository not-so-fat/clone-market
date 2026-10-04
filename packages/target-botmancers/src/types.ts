import type { TargetCapabilities } from "@clone-market/compatibility";
import type { SourceIdentity } from "@clone-market/core";

export const BOTMANCERS_IMPORT_SCHEMA_VERSION = "1.0.0" as const;

export type BotmancersCapabilities = TargetCapabilities;

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
