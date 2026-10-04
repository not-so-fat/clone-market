import { createHash } from "node:crypto";

import {
  validateClonePlan,
  type CompatibilityPlan,
  type ComponentAssessment,
} from "@clone-market/compatibility";
import {
  BotTemplateManifestSchema,
  OperationIdentitySchema,
  SCHEMA_VERSION,
  type ApplyResult,
  type BotTemplateManifest,
  type ClonePlan,
  type CompatibilityAssessment,
  type OperationIdentity,
  type PreviewResult,
  type TargetAdapter,
  type VerifyResult,
} from "@clone-market/core";

import type { BotmancersClient } from "./client.js";
import { CapabilityVersionError, OperationIdentityError, PlanApprovalError } from "./errors.js";
import { BOTMANCERS_IMPORT_SCHEMA_VERSION, type BotmancersCapabilities, type BotmancersImportPayload } from "./types.js";

const DIGEST_PREFIX = "sha256:";

export interface BotmancersTargetAdapterOptions {
  readonly client: BotmancersClient;
  readonly manifest: BotTemplateManifest;
  readonly compatibilityPlan: CompatibilityPlan;
  readonly now?: () => string;
}

export interface BotmancersComponentRow {
  readonly componentType: ComponentAssessment["componentType"];
  readonly componentId: string;
  readonly classification: ComponentAssessment["classification"];
  readonly rationaleCode: ComponentAssessment["rationaleCode"];
  readonly translated: boolean;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function assertOperation(operation: OperationIdentity): void {
  if (!OperationIdentitySchema.safeParse(operation).success) throw new OperationIdentityError();
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function coreAssessment(assessment: ComponentAssessment): CompatibilityAssessment {
  return {
    schemaVersion: SCHEMA_VERSION,
    componentType: assessment.componentType,
    componentId: assessment.componentId,
    classification: assessment.classification,
    reason: assessment.rationaleCode,
    requiredCapabilities: [...assessment.requiredCapabilities],
  };
}

export function createBotmancersClonePlan(input: {
  readonly manifest: BotTemplateManifest;
  readonly compatibilityPlan: CompatibilityPlan;
  readonly createdAt: string;
  readonly id?: string;
}): ClonePlan {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id ?? "unreviewed",
    manifestId: input.manifest.id,
    source: { ...input.manifest.source },
    retrievedAt: input.manifest.retrievedAt,
    provenanceUrl: input.manifest.provenanceUrl,
    target: { ...input.compatibilityPlan.target },
    createdAt: input.createdAt,
    assessments: input.compatibilityPlan.assessments.map(coreAssessment),
  };
}

export function withReviewedPlanDigest(plan: ClonePlan, preview: PreviewResult): ClonePlan {
  return { ...plan, id: preview.planId };
}

function planWithoutId(plan: ClonePlan): Omit<ClonePlan, "id"> {
  const { id: _id, ...rest } = plan;
  return rest;
}

function planDigest(manifest: BotTemplateManifest, compatibilityPlan: CompatibilityPlan, plan: ClonePlan): string {
  const reviewedMaterial = canonicalJson({
    manifest,
    compatibilityPlan,
    plan: planWithoutId(plan),
  });
  return `${DIGEST_PREFIX}${createHash("sha256").update(reviewedMaterial).digest("hex")}`;
}

function translatedInstructions(manifest: BotTemplateManifest, compatibilityPlan: CompatibilityPlan): string | undefined {
  const assessment = compatibilityPlan.assessments.find(
    ({ componentType, componentId }) => componentType === "instructions" && componentId === "manifest.instructions",
  );
  return assessment !== undefined && (assessment.classification === "exact" || assessment.classification === "compatible")
    ? manifest.instructions
    : undefined;
}

function payloadFor(
  manifest: BotTemplateManifest,
  compatibilityPlan: CompatibilityPlan,
  reviewedPlanDigest: string,
): BotmancersImportPayload {
  const instructions = translatedInstructions(manifest, compatibilityPlan);
  return {
    schemaVersion: BOTMANCERS_IMPORT_SCHEMA_VERSION,
    bot: {
      name: manifest.template.name,
      description: manifest.template.summary,
      ...(instructions === undefined ? {} : { instructions }),
    },
    provenance: {
      source: { ...manifest.source },
      manifestId: manifest.id,
      retrievedAt: manifest.retrievedAt,
      url: manifest.provenanceUrl,
      reviewedPlanDigest,
    },
  };
}

function componentRows(plan: CompatibilityPlan): BotmancersComponentRow[] {
  return plan.assessments.map((assessment) => ({
    componentType: assessment.componentType,
    componentId: assessment.componentId,
    classification: assessment.classification,
    rationaleCode: assessment.rationaleCode,
    translated:
      assessment.componentType === "instructions" &&
      (assessment.classification === "exact" || assessment.classification === "compatible"),
  }));
}

function validatePlanShape(manifest: BotTemplateManifest, compatibilityPlan: CompatibilityPlan, plan: ClonePlan): void {
  const expected = createBotmancersClonePlan({ manifest, compatibilityPlan, createdAt: plan.createdAt, id: plan.id });
  if (!same(planWithoutId(plan), planWithoutId(expected))) {
    throw new PlanApprovalError("invalid_plan", "Core clone plan does not match the manifest and Botmancers compatibility plan");
  }
}

function assertApplicable(compatibilityPlan: CompatibilityPlan): void {
  if (compatibilityPlan.assessments.some(({ classification }) => classification === "unsafe")) {
    throw new PlanApprovalError("unsafe_plan", "Botmancers apply refuses unresolved unsafe components");
  }
  if (compatibilityPlan.assessments.some(({ classification }) => classification === "partial")) {
    throw new PlanApprovalError("partial_plan", "Botmancers apply requires partial mappings to be resolved before approval");
  }
  const globalActions = compatibilityPlan.requiredUserActions.filter(({ componentType }) => componentType === undefined);
  if (globalActions.length > 0) {
    throw new PlanApprovalError("invalid_plan", "Botmancers apply requires permission and redistribution actions to be resolved");
  }
}

function supportedCapabilities(capabilities: BotmancersCapabilities): boolean {
  return capabilities.schemaVersion === "1.0.0";
}

function assertCapabilities(capabilities: BotmancersCapabilities, compatibilityPlan: CompatibilityPlan): void {
  if (!supportedCapabilities(capabilities)) {
    const received = typeof (capabilities as { schemaVersion?: unknown }).schemaVersion === "string"
      ? (capabilities as { schemaVersion: string }).schemaVersion
      : null;
    throw new CapabilityVersionError(received);
  }
  if (!same(capabilities.target, compatibilityPlan.target)) {
    throw new PlanApprovalError("invalid_plan", "Botmancers capabilities do not match the compatibility plan target");
  }
}

function differences(expected: unknown, actual: unknown, path = "$"): Array<{ path: string; expected: unknown; actual: unknown }> {
  if (same(expected, actual)) return [];
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    return Array.from({ length }, (_, index) => differences(expected[index], actual[index], `${path}[${index}]`)).flat();
  }
  if (typeof expected === "object" && expected !== null && typeof actual === "object" && actual !== null && !Array.isArray(expected) && !Array.isArray(actual)) {
    const left = expected as Record<string, unknown>;
    const right = actual as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])]
      .sort()
      .flatMap((key) => differences(left[key], right[key], `${path}.${key}`));
  }
  return [{ path, expected, actual }];
}

export class BotmancersTargetAdapter implements TargetAdapter {
  readonly target = "botmancers";
  readonly #client: BotmancersClient;
  readonly #manifest: BotTemplateManifest;
  readonly #compatibilityPlan: CompatibilityPlan;
  readonly #now: () => string;

  constructor(options: BotmancersTargetAdapterOptions) {
    this.#client = options.client;
    this.#manifest = BotTemplateManifestSchema.parse(options.manifest);
    this.#compatibilityPlan = structuredClone(options.compatibilityPlan);
    if (this.#compatibilityPlan.schemaVersion !== "1.0.0" || this.#compatibilityPlan.manifestId !== this.#manifest.id) {
      throw new PlanApprovalError("invalid_plan", "Compatibility plan version or manifest identity does not match the manifest");
    }
    const validation = validateClonePlan(this.#manifest, this.#compatibilityPlan);
    if (!validation.valid) {
      throw new PlanApprovalError(
        "invalid_plan",
        `Compatibility plan does not cover the manifest: ${validation.issues.map(({ code, componentKey }) => `${componentKey}:${code}`).join(", ")}`,
      );
    }
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async preview(plan: ClonePlan): Promise<PreviewResult> {
    const compatibilityPlan = this.#compatibilityPlan;
    assertCapabilities(await this.#client.getCapabilities(), compatibilityPlan);
    validatePlanShape(this.#manifest, compatibilityPlan, plan);
    const digest = planDigest(this.#manifest, compatibilityPlan, plan);
    const payload = payloadFor(this.#manifest, compatibilityPlan, digest);
    return {
      schemaVersion: SCHEMA_VERSION,
      planId: digest,
      summary: `Botmancers compatibility: ${compatibilityPlan.summary.exact} exact, ${compatibilityPlan.summary.compatible} compatible, ${compatibilityPlan.summary.partial} partial, ${compatibilityPlan.summary.unavailable} unavailable, ${compatibilityPlan.summary.unsafe} unsafe`,
      artifacts: [
        { path: "botmancers/components.json", content: canonicalJson(componentRows(compatibilityPlan)) },
        { path: "botmancers/import.json", content: canonicalJson(payload) },
      ],
      warnings: compatibilityPlan.warnings.map(({ code, componentType, componentId }) =>
        [code, componentType, componentId].filter((value) => value !== undefined).join(":"),
      ),
    };
  }

  async apply(plan: ClonePlan, operation: OperationIdentity): Promise<ApplyResult> {
    assertOperation(operation);
    if (!plan.id.startsWith(DIGEST_PREFIX)) {
      throw new PlanApprovalError("missing_plan_digest", "Apply requires the stable digest returned by preview");
    }
    const compatibilityPlan = this.#compatibilityPlan;
    assertCapabilities(await this.#client.getCapabilities(), compatibilityPlan);
    validatePlanShape(this.#manifest, compatibilityPlan, plan);
    assertApplicable(compatibilityPlan);
    const digest = planDigest(this.#manifest, compatibilityPlan, plan);
    if (plan.id !== digest) throw new PlanApprovalError("changed_plan_digest", "The reviewed plan changed after preview");
    const imported = await this.#client.importBot(payloadFor(this.#manifest, compatibilityPlan, digest), operation);
    return {
      schemaVersion: SCHEMA_VERSION,
      status: "succeeded",
      operationId: operation.operationId,
      targetReference: imported.id,
      completedAt: this.#now(),
    };
  }

  async verify(input: { plan: ClonePlan; targetReference: string }, operation: OperationIdentity): Promise<VerifyResult> {
    assertOperation(operation);
    if (input.targetReference.length === 0) {
      throw new PlanApprovalError("invalid_plan", "Verify requires a Botmancers target reference");
    }
    if (!input.plan.id.startsWith(DIGEST_PREFIX)) {
      throw new PlanApprovalError("missing_plan_digest", "Verify requires a reviewed plan digest");
    }
    const compatibilityPlan = this.#compatibilityPlan;
    validatePlanShape(this.#manifest, compatibilityPlan, input.plan);
    const digest = planDigest(this.#manifest, compatibilityPlan, input.plan);
    if (input.plan.id !== digest) {
      throw new PlanApprovalError("changed_plan_digest", "The reviewed plan changed after preview");
    }
    const record = await this.#client.getImport(input.targetReference);
    const expected = payloadFor(this.#manifest, compatibilityPlan, input.plan.id);
    const mismatches = [
      ...(record.id === input.targetReference ? [] : [{ path: "$.id", expected: input.targetReference, actual: record.id }]),
      ...differences(expected, record.payload),
    ];
    return {
      schemaVersion: SCHEMA_VERSION,
      status: mismatches.length === 0 ? "passed" : "failed",
      operationId: operation.operationId,
      targetReference: input.targetReference,
      checkedAt: this.#now(),
      checks: mismatches.length === 0
        ? [{ name: "saved-import-payload", passed: true, detail: "Saved Botmancers import matches the reviewed plan" }]
        : mismatches.map((difference) => ({
            name: difference.path,
            passed: false,
            detail: `Expected ${JSON.stringify(difference.expected)}, received ${JSON.stringify(difference.actual)}`,
          })),
    };
  }
}
