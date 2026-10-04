import { BotmancersHttpError, BotmancersResponseError } from "./errors.js";
import type { OperationIdentity } from "@clone-market/core";
import type {
  BotmancersCapabilities,
  BotmancersFetch,
  BotmancersHttpResponse,
  BotmancersImportPayload,
  BotmancersImportRecord,
} from "./types.js";

const DEFAULT_TRANSIENT_STATUSES = [408, 425, 429, 500, 502, 503, 504] as const;

export interface BotmancersHttpClientOptions {
  readonly fetch?: BotmancersFetch;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryBaseMs?: number;
  readonly transientStatuses?: readonly number[];
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

function positiveInteger(value: number, name: string, allowZero = false): number {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new RangeError(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
  return value;
}

function defaultFetch(url: string, init: Parameters<BotmancersFetch>[1]): Promise<BotmancersHttpResponse> {
  return fetch(url, init);
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export class BotmancersHttpClient {
  readonly #fetch: BotmancersFetch;
  readonly #baseUrl: URL;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #retryBaseMs: number;
  readonly #transientStatuses: ReadonlySet<number>;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: BotmancersHttpClientOptions = {}) {
    this.#fetch = options.fetch ?? defaultFetch;
    this.#baseUrl = new URL(options.baseUrl ?? "https://api.botmancers.com/");
    if (this.#baseUrl.username !== "" || this.#baseUrl.password !== "") {
      throw new TypeError("baseUrl must not contain credentials");
    }
    if (!this.#baseUrl.pathname.endsWith("/")) this.#baseUrl.pathname += "/";
    this.#timeoutMs = positiveInteger(options.timeoutMs ?? 10_000, "timeoutMs");
    this.#maxRetries = positiveInteger(options.maxRetries ?? 2, "maxRetries", true);
    this.#retryBaseMs = positiveInteger(options.retryBaseMs ?? 250, "retryBaseMs", true);
    this.#transientStatuses = new Set(options.transientStatuses ?? DEFAULT_TRANSIENT_STATUSES);
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async #request(path: string, init: { method: "GET" | "POST"; body?: unknown; operation?: OperationIdentity }): Promise<unknown> {
    let lastStatus: number | undefined;
    let lastCause: unknown;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const headers: Record<string, string> = { accept: "application/json" };
        let body: string | undefined;
        if (init.body !== undefined) {
          headers["content-type"] = "application/json";
          body = JSON.stringify(init.body);
        }
        if (init.operation !== undefined) {
          headers["idempotency-key"] = init.operation.idempotencyKey;
          headers["x-operation-id"] = init.operation.operationId;
        }
        const request = this.#fetch(new URL(path, this.#baseUrl).toString(), {
          method: init.method,
          headers,
          ...(body === undefined ? {} : { body }),
          signal: controller.signal,
        });
        const timeoutFailure = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error(`Botmancers request timed out after ${this.#timeoutMs}ms`));
          }, this.#timeoutMs);
        });
        const response = await Promise.race([request, timeoutFailure]);
        lastStatus = response.status;
        if (response.ok) {
          try {
            return await response.json();
          } catch (error) {
            throw new BotmancersResponseError("Botmancers response body must be valid JSON");
          }
        }
        const retryable = this.#transientStatuses.has(response.status);
        if (!retryable || attempt === this.#maxRetries) {
          throw new BotmancersHttpError({ status: response.status, attempts: attempt + 1, retryable });
        }
      } catch (error) {
        if (error instanceof BotmancersHttpError || error instanceof BotmancersResponseError) throw error;
        lastCause = error;
        if (attempt === this.#maxRetries) {
          throw new BotmancersHttpError({
            ...(lastStatus === undefined ? {} : { status: lastStatus }),
            attempts: attempt + 1,
            retryable: true,
            cause: error,
          });
        }
      } finally {
        clearTimeout(timeout);
      }
      await this.#sleep(this.#retryBaseMs * 2 ** attempt);
    }
    throw new BotmancersHttpError({ attempts: this.#maxRetries + 1, retryable: true, cause: lastCause });
  }

  async getCapabilities(): Promise<BotmancersCapabilities> {
    const result = await this.#request("v1/capabilities", { method: "GET" });
    if (object(result) === undefined) throw new BotmancersResponseError("Capability response must be an object");
    return result as BotmancersCapabilities;
  }

  async importBot(payload: BotmancersImportPayload, operation: OperationIdentity): Promise<{ id: string }> {
    const result = object(await this.#request("v1/imports", { method: "POST", body: payload, operation }));
    if (typeof result?.id !== "string" || result.id.length === 0) throw new BotmancersResponseError("Import response must contain an id");
    return { id: result.id };
  }

  async getImport(id: string): Promise<BotmancersImportRecord> {
    const result = object(await this.#request(`v1/imports/${encodeURIComponent(id)}`, { method: "GET" }));
    if (typeof result?.id !== "string" || object(result.payload) === undefined) {
      throw new BotmancersResponseError("Import read response must contain an id and payload");
    }
    return result as unknown as BotmancersImportRecord;
  }
}
