import type { SourceIdentity } from "@clone-market/core";
import type { ClonePolicy } from "@clone-market/compatibility";
import { MarketError, type CatalogFilters, type MarketService } from "./market.js";

export type ApiRequest = { params?: Record<string, string>; query?: Record<string, string | undefined>; body?: unknown };
export type ApiResponse = { status: number; body: unknown };

function source(request: ApiRequest): SourceIdentity {
  const provider = request.params?.provider;
  const externalId = request.params?.externalId;
  if (!provider || !externalId) throw new TypeError("provider and externalId are required");
  return { provider, externalId };
}

function reviewBody(request: ApiRequest): { policy: ClonePolicy; planDigest?: string; reviewedAt?: string; approved?: boolean; targetReference?: string } {
  if (typeof request.body !== "object" || request.body === null) throw new TypeError("JSON body is required");
  return request.body as { policy: ClonePolicy; planDigest?: string; reviewedAt?: string; approved?: boolean; targetReference?: string };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new TypeError(`${name} is required`);
  return value;
}

async function response(operation: () => Promise<unknown>): Promise<ApiResponse> {
  try {
    return { status: 200, body: await operation() };
  } catch (error) {
    if (error instanceof MarketError) {
      const status = error.code === "not_found" ? 404 : error.code === "approval_required" ? 403 : error.code === "stale_plan" ? 409 : 503;
      return { status, body: { error: { code: error.code, message: error.message, recoverable: true } } };
    }
    return { status: 400, body: { error: { code: "invalid_request", message: error instanceof Error ? error.message : "Invalid request", recoverable: true } } };
  }
}

export function createV1Handlers(market: MarketService) {
  return {
    catalog: (request: ApiRequest = {}) => response(() => market.catalog(request.query as CatalogFilters)),
    detail: (request: ApiRequest) => response(() => market.detail(source(request))),
    evidence: (request: ApiRequest) => response(async () => {
      const detail = await market.detail(source(request));
      return detail.evidence ?? { snapshot: undefined, countedEvidenceIds: [], contributions: [], evidence: [] };
    }),
    preview: (request: ApiRequest) => response(async () => {
      const body = reviewBody(request);
      const { manifest: _requestScopedManifest, ...review } = await market.preview({ source: source(request), policy: body.policy });
      return review;
    }),
    apply: (request: ApiRequest) => response(() => {
      const body = reviewBody(request);
      return market.apply({ source: source(request), policy: body.policy, planDigest: required(body.planDigest, "planDigest"), reviewedAt: required(body.reviewedAt, "reviewedAt"), approved: body.approved === true });
    }),
    verify: (request: ApiRequest) => response(() => {
      const body = reviewBody(request);
      return market.verify({ source: source(request), policy: body.policy, planDigest: required(body.planDigest, "planDigest"), reviewedAt: required(body.reviewedAt, "reviewedAt"), targetReference: required(body.targetReference, "targetReference") });
    }),
  };
}
