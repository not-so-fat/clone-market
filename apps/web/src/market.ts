import { randomUUID } from "node:crypto";
import type { CatalogEntry, CatalogRepository, ClonePlan, SourceAdapter, SourceIdentity, VerifyResult } from "@clone-market/core";
import type { EvidenceService, AdoptionEvidenceQuery } from "@clone-market/evidence";
import { planClone, type ClonePolicy, type CompatibilityPlan, type TargetCapabilities } from "@clone-market/compatibility";
import {
  BotmancersTargetAdapter,
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
};

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export class MarketError extends Error {
  constructor(readonly code: "not_found" | "source_drift" | "target_unavailable" | "unsafe_plan" | "stale_plan" | "approval_required", message: string) {
    super(message);
  }
}

export class MarketService {
  readonly #deps: Dependencies;
  readonly #now: () => string;

  constructor(dependencies: Dependencies) {
    this.#deps = dependencies;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
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

  #freshness(snapshot: AdoptionEvidenceQuery["snapshot"] | undefined): CatalogItem["evidenceState"] {
    if (!snapshot) return "missing";
    return Date.parse(this.#now()) - Date.parse(snapshot.evidenceThrough) > STALE_AFTER_MS ? "stale" : "fresh";
  }

  async catalog(filters: CatalogFilters = {}): Promise<{ items: CatalogItem[]; total: number }> {
    const all = await this.#allCatalog();
    const enriched = await Promise.all(all.map(async (entry) => {
      const adoption = await this.#deps.evidence.getLatest(entry.id);
      return { ...entry, ...(adoption ? { adoption: adoption.snapshot } : {}), evidenceState: this.#freshness(adoption?.snapshot) };
    }));
    let items = enriched.filter((entry) => {
      const evidenceMatches = !filters.evidenceState
        || entry.evidenceState === filters.evidenceState
        || entry.adoption?.label === filters.evidenceState
        || (filters.evidenceState === "listed" && entry.adoption === undefined);
      return (!filters.category || entry.categories.includes(filters.category)) && evidenceMatches;
    });
    if (filters.capability || filters.integration) {
      const matches = await Promise.all(items.map(async (entry) => {
        const detail = await this.detail(entry.provenance.source);
        const capability = filters.capability;
        const hasCapability = !capability
          || (capability === "instructions" && detail.manifest.instructions !== undefined)
          || (capability === "memory" && detail.manifest.memories.length > 0)
          || (capability === "skill" && detail.manifest.skills.length > 0)
          || (capability === "routine" && detail.manifest.routines.length > 0);
        return hasCapability && (!filters.integration || detail.manifest.integrations.some(({ id }) => id === filters.integration));
      }));
      items = items.filter((_entry, index) => matches[index]);
    }
    return { items, total: items.length };
  }

  async detail(source: SourceIdentity, retrievedAt = this.#now()) {
    const entry = await this.#deps.catalog.getTemplate(source);
    if (!entry) throw new MarketError("not_found", "Template is not in the catalog");
    try {
      const adapter = this.#deps.source(source.provider);
      const raw = await adapter.fetchTemplate(source);
      const manifest = await adapter.normalizeTemplate(raw, retrievedAt);
      const history = await this.#deps.catalog.getSourceHistory(source);
      const evidence = await this.#deps.evidence.getLatest(entry.id);
      return { entry, history, manifest, evidence };
    } catch (error) {
      throw new MarketError("source_drift", error instanceof Error ? error.message : "Source detail changed");
    }
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
    const target = new BotmancersTargetAdapter({ client: this.#deps.botmancers, manifest, compatibilityPlan: compatibility, now: this.#now });
    const draft = createBotmancersClonePlan({ manifest, compatibilityPlan: compatibility, createdAt: reviewedAt });
    try {
      const preview = await target.preview(draft);
      return { manifest, compatibility, plan: withReviewedPlanDigest(draft, preview), preview };
    } catch (error) {
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
    const operation = { operationId: randomUUID(), idempotencyKey: `${input.planDigest}:${randomUUID()}` };
    const target = new BotmancersTargetAdapter({ client: this.#deps.botmancers, manifest: review.manifest, compatibilityPlan: review.compatibility, now: this.#now });
    try {
      const result = await target.apply(review.plan, operation);
      return { result, operation, planDigest: review.plan.id };
    } catch (error) {
      throw new MarketError("target_unavailable", error instanceof Error ? error.message : "Botmancers apply failed");
    }
  }

  async verify(input: ReviewInput & { planDigest: string; reviewedAt: string; targetReference: string }): Promise<VerifyResult> {
    const review = await this.#review(input, input.reviewedAt);
    if (review.plan.id !== input.planDigest) throw new MarketError("stale_plan", "The reviewed plan changed before verification");
    const operation = { operationId: randomUUID(), idempotencyKey: `verify:${input.planDigest}:${input.targetReference}` };
    const target = new BotmancersTargetAdapter({ client: this.#deps.botmancers, manifest: review.manifest, compatibilityPlan: review.compatibility, now: this.#now });
    try {
      return await target.verify({ plan: review.plan, targetReference: input.targetReference }, operation);
    } catch (error) {
      throw new MarketError("target_unavailable", error instanceof Error ? error.message : "Botmancers verification failed");
    }
  }
}
