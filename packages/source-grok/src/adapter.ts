import {
  BotTemplateManifestSchema,
  TemplateSchema,
  type BotTemplateManifest,
  type SourceAdapter,
  type SourceIdentity,
} from "@clone-market/core";

import { SourceRequestError, SourceSchemaDriftError, type GrokRetrievalMetadata } from "./errors.js";
import { parseDetail, parseIndex, type RawGrokDocument } from "./parsing.js";

export type FetchResponse = { ok: boolean; status: number; text(): Promise<string> };
export type FetchClient = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<FetchResponse>;

export type GrokSourceMetadata = GrokRetrievalMetadata & { installCount: number };

export type GrokMarketplaceAdapterOptions = {
  fetch: FetchClient;
  baseUrl?: string;
  userAgent?: string;
  concurrency?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  requestTimeoutMs?: number;
  now?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
};

class Limiter {
  readonly #maximum: number;
  #active = 0;
  readonly #waiting: Array<() => void> = [];

  constructor(maximum: number) {
    this.#maximum = maximum;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#active < this.#maximum) this.#active += 1;
    else await new Promise<void>((resolve) => this.#waiting.push(resolve));
    try {
      return await operation();
    } finally {
      const next = this.#waiting.shift();
      if (next === undefined) this.#active -= 1;
      else next();
    }
  }
}

function positiveInteger(value: number, name: string, allowZero = false): number {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) throw new RangeError(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  return value;
}

function transient(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function defaultFetch(url: string, init: { headers: Record<string, string>; signal: AbortSignal }): Promise<FetchResponse> {
  return fetch(url, init);
}

export class GrokMarketplaceAdapter implements SourceAdapter {
  readonly source = "grok-marketplace";
  readonly #fetch: FetchClient;
  readonly #baseUrl: URL;
  readonly #userAgent: string;
  readonly #maxRetries: number;
  readonly #retryBaseMs: number;
  readonly #requestTimeoutMs: number;
  readonly #now: () => string;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #limiter: Limiter;
  readonly #metadata = new Map<string, GrokSourceMetadata>();
  readonly #slugs = new Map<string, string>();

  constructor(options?: Partial<GrokMarketplaceAdapterOptions>) {
    this.#fetch = options?.fetch ?? defaultFetch;
    this.#baseUrl = new URL(options?.baseUrl ?? "https://x.ai/bot/marketplace/");
    if (!this.#baseUrl.pathname.endsWith("/")) this.#baseUrl.pathname += "/";
    this.#userAgent = options?.userAgent ?? "clone-market-source-grok/0.1 (+https://github.com/not-so-fat/clone-market)";
    this.#maxRetries = positiveInteger(options?.maxRetries ?? 2, "maxRetries", true);
    this.#retryBaseMs = positiveInteger(options?.retryBaseMs ?? 250, "retryBaseMs", true);
    this.#requestTimeoutMs = positiveInteger(options?.requestTimeoutMs ?? 10_000, "requestTimeoutMs");
    this.#now = options?.now ?? (() => new Date().toISOString());
    this.#sleep = options?.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#limiter = new Limiter(positiveInteger(options?.concurrency ?? 4, "concurrency"));
  }

  async #request(url: URL, identity: SourceIdentity): Promise<RawGrokDocument> {
    return this.#limiter.run(async () => {
      let lastCause: unknown;
      let lastStatus: number | undefined;
      for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
        try {
          const controller = new AbortController();
          let timeout: ReturnType<typeof setTimeout> | undefined;
          const timeoutFailure = new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              controller.abort();
              reject(new Error(`Request timed out after ${this.#requestTimeoutMs}ms`));
            }, this.#requestTimeoutMs);
          });
          const request = this.#fetch(url.toString(), {
            headers: { "user-agent": this.#userAgent, accept: "text/html, text/x-component" },
            signal: controller.signal,
          }).then(async (response) => ({ response, body: response.ok ? await response.text() : undefined }));
          const { response, body } = await Promise.race([request, timeoutFailure]).finally(() => clearTimeout(timeout));
          lastStatus = response.status;
          if (response.ok) return { body: body ?? "", url: url.toString(), retrievedAt: this.#now(), source: identity };
          if (!transient(response.status)) throw new SourceRequestError({ url: url.toString(), attempts: attempt + 1, status: response.status });
        } catch (error) {
          if (error instanceof SourceRequestError) throw error;
          lastCause = error;
        }
        if (attempt < this.#maxRetries) await this.#sleep(this.#retryBaseMs * 2 ** attempt);
      }
      throw new SourceRequestError({ url: url.toString(), attempts: this.#maxRetries + 1, ...(lastStatus === undefined ? {} : { status: lastStatus }), cause: lastCause });
    });
  }

  #remember(externalId: string, installCount: number, metadata: GrokRetrievalMetadata): void {
    this.#metadata.set(externalId, {
      source: { provider: this.source, externalId },
      url: metadata.url,
      retrievedAt: metadata.retrievedAt,
      installCount,
    });
  }

  getSourceMetadata(source: SourceIdentity): GrokSourceMetadata | undefined {
    const metadata = source.provider === this.source ? this.#metadata.get(source.externalId) : undefined;
    return metadata === undefined ? undefined : { ...metadata, source: { ...metadata.source } };
  }

  async listTemplates(input?: { cursor?: string; limit?: number }) {
    const document = await this.#request(this.#baseUrl, { provider: this.source, externalId: "index" });
    const parsed = parseIndex(document);
    for (const item of parsed) {
      const externalId = item.template.provenance.source.externalId;
      this.#slugs.set(externalId, item.slug);
      this.#remember(externalId, item.installCount, item.template.provenance);
    }
    const offset = input?.cursor === undefined ? 0 : Number(input.cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError("cursor must be a non-negative integer offset");
    const limit = input?.limit === undefined ? parsed.length : positiveInteger(input.limit, "limit");
    const templates = parsed.slice(offset, offset + limit).map(({ template }) => TemplateSchema.parse(template));
    const nextOffset = offset + templates.length;
    return nextOffset < parsed.length ? { templates, nextCursor: String(nextOffset) } : { templates };
  }

  async fetchTemplate(source: SourceIdentity): Promise<RawGrokDocument> {
    if (source.provider !== this.source) throw new RangeError(`Expected source provider ${this.source}`);
    const slug = this.#slugs.get(source.externalId) ?? source.externalId;
    return this.#request(new URL(`bots/${encodeURIComponent(slug)}`, this.#baseUrl), source);
  }

  async normalizeTemplate(input: unknown, retrievedAt: string): Promise<BotTemplateManifest> {
    if (input === null || typeof input !== "object" || !("body" in input) || !("url" in input)) {
      throw new SourceSchemaDriftError({ code: "source_schema_drift", source: { provider: this.source, externalId: "unknown" }, url: this.#baseUrl.toString(), retrievedAt, path: "$", expected: "fetched Grok document", actual: input === null ? "null" : typeof input });
    }
    const candidate = input as Partial<RawGrokDocument>;
    const document: RawGrokDocument = {
      body: typeof candidate.body === "string" ? candidate.body : "",
      url: typeof candidate.url === "string" ? candidate.url : this.#baseUrl.toString(),
      retrievedAt,
      source: candidate.source ?? { provider: this.source, externalId: "unknown" },
    };
    const parsed = parseDetail(document);
    this.#remember(parsed.manifest.source.externalId, parsed.installCount, { source: parsed.manifest.source, url: parsed.manifest.provenanceUrl, retrievedAt });
    return BotTemplateManifestSchema.parse(parsed.manifest);
  }

  async getTemplate(source: SourceIdentity): Promise<BotTemplateManifest> {
    if (source.provider !== this.source) throw new RangeError(`Expected source provider ${this.source}`);
    if (!this.#slugs.has(source.externalId)) await this.listTemplates();
    if (!this.#slugs.has(source.externalId)) throw new RangeError(`Unknown ${this.source} source identifier ${source.externalId}`);
    const document = await this.fetchTemplate(source);
    return this.normalizeTemplate(document, document.retrievedAt);
  }
}
