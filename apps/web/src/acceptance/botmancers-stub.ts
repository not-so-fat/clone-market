import {
  BotmancersHttpClient,
  type BotmancersCapabilities,
  type BotmancersFetch,
  type BotmancersImportPayload,
} from "@clone-market/target-botmancers";

export { botmancersBotUrl as botmancersReturnUrl } from "../botmancers-url.js";

export const ACCEPTANCE_CAPABILITIES: BotmancersCapabilities = {
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

type Call = {
  method: "GET" | "POST";
  path: string;
  idempotencyKey?: string;
  operationId?: string;
};

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** In-process Botmancers API with deterministic idempotent import identity. */
export class BotmancersAcceptanceStub {
  readonly calls: Call[] = [];
  readonly imports = new Map<string, BotmancersImportPayload>();
  readonly identities = new Map<string, string>();
  capabilities: unknown = structuredClone(ACCEPTANCE_CAPABILITIES);
  offline = false;
  importFailureStatus?: number;

  readonly fetch: BotmancersFetch = async (url, init) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    this.calls.push({
      method: init.method,
      path,
      ...(init.headers["idempotency-key"] === undefined ? {} : { idempotencyKey: init.headers["idempotency-key"] }),
      ...(init.headers["x-operation-id"] === undefined ? {} : { operationId: init.headers["x-operation-id"] }),
    });
    if (this.offline) throw new Error("Botmancers unavailable");
    if (path === "/v1/capabilities" && init.method === "GET") return response(200, this.capabilities);
    if (path === "/v1/imports" && init.method === "POST") {
      if (this.importFailureStatus !== undefined) return response(this.importFailureStatus, { error: "rejected" });
      const key = init.headers["idempotency-key"] ?? "";
      let id = this.identities.get(key);
      if (id === undefined) {
        id = `bot-${this.identities.size + 1}`;
        this.identities.set(key, id);
        this.imports.set(id, JSON.parse(init.body ?? "null") as BotmancersImportPayload);
      }
      return response(200, { id });
    }
    const match = /^\/v1\/imports\/([^/]+)$/.exec(path);
    if (match?.[1] !== undefined && init.method === "GET") {
      const id = decodeURIComponent(match[1]);
      const payload = this.imports.get(id);
      if (payload === undefined) return response(404, { error: "not_found" });
      return response(200, { id, payload });
    }
    return response(404, { error: "not_found" });
  };

  client(): BotmancersHttpClient {
    return new BotmancersHttpClient({
      fetch: this.fetch,
      baseUrl: "https://botmancers.acceptance.test/",
      maxRetries: 0,
      retryBaseMs: 0,
      sleep: async () => undefined,
    });
  }

  botCount(): number {
    return this.imports.size;
  }

  operationIds(): string[] {
    return this.calls.map((call) => call.operationId).filter((value): value is string => value !== undefined);
  }
}
