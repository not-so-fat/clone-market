import { createHash } from "node:crypto";
import type { CatalogEntry, CatalogRepository, ClonePlan, SourceAdapter, SourceIdentity, VerifyResult } from "@clone-market/core";
import { classifyEvidenceFreshness, type EvidenceService, type AdoptionEvidenceQuery } from "@clone-market/evidence";
import { planClone, type ClonePolicy, type CompatibilityPlan, type TargetCapabilities } from "@clone-market/compatibility";
import {
  BotmancersTargetAdapter,
  PlanApprovalError,
  createBotmancersClonePlan,
  withReviewedPlanDigest,
  type BotmancersHttpClient,
} from "@clone-market/target-botmancers";

export type CatalogFilters = {
  category?: string;
  capability?: string;
  integration?: string;
  evidenceState?: "fresh" | "stale" | "missing" | "listed" | "discussed" | "emerging" | "observed_use";
};

export type CatalogItem = CatalogEntry & {
  adoption?: AdoptionEvidenceQuery["snapshot"];
  evidenceState: "fresh" | "stale" | "missing";
};

export type CatalogFilterWarning = {
  source: SourceIdentity;
  code: "source_drift";
  message: string;
};

export type ReviewInput = {
  source: SourceIdentity;
  policy: ClonePolicy;
};

export type Review = {
  manifest: Awaited<ReturnType<MarketService["detail"]>>["manifest"];
  compatibility: CompatibilityPlan;
  plan: ClonePlan;
  preview: Awaited<ReturnType<BotmancersTargetAdapter["preview"]>>;
};

export type ReviewResponse = Omit<Review, "manifest">;

type Dependencies = {
  catalog: CatalogRepository;
  evidence: Pick<EvidenceService, "getLatest">;
  source(source: string): SourceAdapter;
  botmancers: BotmancersHttpClient;
  now?: () => string;
  manifestFilterConcurrency?: number;
};

type VerificationError = {
  code: MarketError["code"];
  message: string;
  recoverable: true;
};

function approvalError(error: PlanApprovalError): MarketError {
  const code = error.code === "changed_plan_digest"
    ? "stale_plan"
    : error.code === "missing_plan_digest"
      ? "approval_required"
      : "unsafe_plan";
  return new MarketError(code, error.message);
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, operation: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await operation(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export class MarketError extends Error {
  constructor(readonly code: "not_found" | "source_drift" | "stored_data_unavailable" | "target_unavailable" | "unsafe_plan" | "stale_plan" | "approval_required", message: string) {
    super(message);
  }
}

export class MarketService {
  readonly #deps: Dependencies;
  readonly #now: () => string;
  readonly #manifestFilterConcurrency: number;

  constructor(dependencies: Dependencies) {
    this.#deps = dependencies;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
    this.#manifestFilterConcurrency = Math.max(1, Math.floor(dependencies.manifestFilterConcurrency ?? 8));
  }

  async #allCatalog(): Promise<CatalogEntry[]> {
    const templates: CatalogEntry[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.#deps.catalog.listTemplates({ ...(cursor ? { cursor } : {}), limit: 100 });
      templates.push(...page.templates);
      if (page.nextCursor && seen.has(page.nextCursor)) throw new Error("Catalog returned a repeated cursor");
      if (page.nextCursor) seen.add(page.nextCursor);
      cursor = page.nextCursor;
    } while (cursor);
    return templates;
  }

  async catalog(filters: CatalogFilters = {}): Promise<{ items: CatalogItem[]; total: number; filterWarnings: CatalogFilterWarning[] }> {
    const all = await this.#allCatalog();
    const enriched = await Promise.all(all.map(async (entry) => {
      const adoption = await this.#deps.evidence.getLatest(entry.id);
      return { ...entry, ...(adoption ? { adoption: adoption.snapshot } : {}), evidenceState: classifyEvidenceFreshness(adoption?.snapshot, this.#now()) };
    }));
    let items = enriched.filter((entry) => {
      const evidenceMatches = !filters.evidenceState
        || entry.evidenceState === filters.evidenceState
        || entry.adoption?.label === filters.evidenceState
        || (filters.evidenceState === "listed" && entry.adoption === undefined);
      return (!filters.category || entry.categories.includes(filters.category)) && evidenceMatches;
    });
    const filterWarnings: CatalogFilterWarning[] = [];
    if (filters.capability || filters.integration) {
      const checked = await mapConcurrent(items, this.#manifestFilterConcurrency, async (entry) => {
        let manifest;
        try {
          manifest = await this.manifest(entry.provenance.source);
        } catch (error) {
          const marketError = error instanceof MarketError ? error : new MarketError("source_drift", "Source detail changed");
          return { matches: false, warning: { source: entry.provenance.source, code: "source_drift" as const, message: marketError.message } };
        }
        const capability = filters.capability;
        const hasCapability = !capability
          || (capability === "instructions" && manifest.instructions !== undefined)
          || (capability === "memory" && manifest.memories.length > 0)
          || (capability === "skill" && manifest.skills.length > 0)
          || (capability === "routine" && manifest.routines.length > 0);
        return { matches: hasCapability && (!filters.integration || manifest.integrations.some(({ id }) => id === filters.integration)) };
      });
      for (const result of checked) if (result.warning) filterWarnings.push(result.warning);
      items = items.filter((_entry, index) => checked[index]?.matches);
    }
    return { items, total: items.length, filterWarnings };
  }

  async inspect(source: SourceIdentity) {
    try {
      const entry = await this.#deps.catalog.getTemplate(source);
      if (!entry) throw new MarketError("not_found", "Template is not in the catalog");
      const history = await this.#deps.catalog.getSourceHistory(source);
      const evidence = await this.#deps.evidence.getLatest(entry.id);
      return { entry, history, evidence };
    } catch (error) {
      if (error instanceof MarketError) throw error;
      throw new MarketError("stored_data_unavailable", error instanceof Error ? error.message : "Stored catalog detail is unavailable");
    }
  }

  async manifest(source: SourceIdentity, retrievedAt = this.#now()) {
    let entry: CatalogEntry | undefined;
    try {
      entry = await this.#deps.catalog.getTemplate(source);
    } catch (error) {
      throw new MarketError("stored_data_unavailable", error instanceof Error ? error.message : "Stored catalog detail is unavailable");
    }
    if (!entry) throw new MarketError("not_found", "Template is not in the catalog");
    try {
      const adapter = this.#deps.source(source.provider);
      const raw = await adapter.fetchTemplate(source);
      return await adapter.normalizeTemplate(raw, retrievedAt);
    } catch (error) {
      throw new MarketError("source_drift", error instanceof Error ? error.message : "Source detail changed");
    }
  }

  async detail(source: SourceIdentity, retrievedAt = this.#now()) {
    const [inspection, manifest] = await Promise.all([this.inspect(source), this.manifest(source, retrievedAt)]);
    return {
      ...inspection,
      manifest,
      permissions: {
        creatorPermission: "unknown" as const,
        redistribution: "not_granted" as const,
        basis: "The public source does not provide a reusable-content permission grant.",
      },
    };
  }

  async evidence(source: SourceIdentity) {
    return (await this.inspect(source)).evidence;
  }

  async #review(input: ReviewInput, reviewedAt = this.#now()): Promise<Review> {
    const { manifest } = await this.detail(input.source, reviewedAt);
    let capabilities: TargetCapabilities;
    try {
      capabilities = await this.#deps.botmancers.getCapabilities();
    } catch (error) {
      throw new MarketError("target_unavailable", error instanceof Error ? error.message : "Botmancers is unavailable");
    }
    const result = planClone(manifest, capabilities, input.policy);
    if (result.status !== "planned") throw new MarketError("unsafe_plan", `Unable to plan clone: ${result.status}`);
    const compatibility = result.plan;
    const draft = createBotmancersClonePlan({ manifest, compatibilityPlan: compatibility, createdAt: reviewedAt });
    try {
      const target = new BotmancersTargetAdapter({ client: this.#deps.botmancers, manifest, compatibilityPlan: compatibility, now: this.#now });
      const preview = await target.preview(draft);
      return { manifest, compatibility, plan: withReviewedPlanDigest(draft, preview), preview };
    } catch (error) {
      if (error instanceof PlanApprovalError) throw approvalError(error);
      throw new MarketError("target_unavailable", error instanceof Error ? error.message : "Botmancers is unavailable");
    }
  }

  preview(input: ReviewInput) {
    return this.#review(input);
  }

  async apply(input: ReviewInput & { planDigest: string; reviewedAt: string; approved: boolean }) {
    if (!input.approved) throw new MarketError("approval_required", "Explicit approval is required");
    const review = await this.#review(input, input.reviewedAt);
    if (review.plan.id !== input.planDigest) throw new MarketError("stale_plan", "The source or target plan changed; review the new preview");
    if (review.compatibility.summary.unsafe > 0) throw new MarketError("unsafe_plan", "Unsafe components cannot be applied");
    if (review.compatibility.summary.partial > 0) throw new MarketError("unsafe_plan", "Partial mappings must be resolved before apply");
    const operationHash = createHash("sha256")
      .update(`apply\0${input.source.provider}\0${input.source.externalId}\0${input.planDigest}`)
      .digest("hex");
    const operation = { operationId: `apply-${operationHash.slice(0, 24)}`, idempotencyKey: `clone-market:apply:${operationHash}` };
    const target = new BotmancersTargetAdapter({ client: this.#deps.botmancers, manifest: review.manifest, compatibilityPlan: review.compatibility, now: this.#now });
    try {
      const result = await target.apply(review.plan, operation);
      if (result.status !== "succeeded") return { result, operation, planDigest: review.plan.id };
      const verificationOperationHash = createHash("sha256")
        .update(`verify\0${review.plan.id}\0${result.targetReference}`)
        .digest("hex");
      const verificationOperation = {
        operationId: `verify-${verificationOperationHash.slice(0, 24)}`,
        idempotencyKey: `clone-market:verify:${verificationOperationHash}`,
      };
      try {
        const verification = await target.verify({ plan: review.plan, targetReference: result.targetReference }, verificationOperation);
        return { result, operation, planDigest: review.plan.id, verification };
      } catch (error) {
        const mapped = error instanceof PlanApprovalError
          ? approvalError(error)
          : new MarketError("target_unavailable", error instanceof Error ? error.message : "Botmancers verification failed");
        const verificationError: VerificationError = { code: mapped.code, message: mapped.message, recoverable: true };
        return { result, operation, planDigest: review.plan.id, verificationError };
      }
    } catch (error) {
      if (error instanceof PlanApprovalError) throw approvalError(error);
      throw new MarketError("target_unavailable", error instanceof Error ? error.message : "Botmancers apply failed");
    }
  }

  async verify(input: ReviewInput & { planDigest: string; reviewedAt: string; targetReference: string }): Promise<VerifyResult> {
    const review = await this.#review(input, input.reviewedAt);
    if (review.plan.id !== input.planDigest) throw new MarketError("stale_plan", "The reviewed plan changed before verification");
    const operationHash = createHash("sha256")
      .update(`verify\0${input.planDigest}\0${input.targetReference}`)
      .digest("hex");
    const operation = { operationId: `verify-${operationHash.slice(0, 24)}`, idempotencyKey: `clone-market:verify:${operationHash}` };
    const target = new BotmancersTargetAdapter({ client: this.#deps.botmancers, manifest: review.manifest, compatibilityPlan: review.compatibility, now: this.#now });
    try {
      return await target.verify({ plan: review.plan, targetReference: input.targetReference }, operation);
    } catch (error) {
      if (error instanceof PlanApprovalError) throw approvalError(error);
      throw new MarketError("target_unavailable", error instanceof Error ? error.message : "Botmancers verification failed");
    }
  }
}
