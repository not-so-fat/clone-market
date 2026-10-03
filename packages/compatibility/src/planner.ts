import { BotTemplateManifestSchema, SCHEMA_VERSION, type BotTemplateManifest } from "@clone-market/core";

import {
  CLONE_POLICY_SCHEMA_VERSION,
  COMPATIBILITY_PLAN_SCHEMA_VERSION,
  TARGET_CAPABILITIES_SCHEMA_VERSION,
  type ClonePolicy,
  type CompatibilityPlan,
  type ComponentAssessment,
  type ComponentRequirement,
  type InvalidInputResult,
  type OmittedComponent,
  type PlanCloneResult,
  type PlanValidationResult,
  type PlanWarning,
  type RationaleCode,
  type RequiredUserAction,
  type SourceComponentType,
  type TargetCapabilities,
  type UnsupportedVersionResult,
  type UserActionCode,
} from "./types.js";

type SourceComponent = { type: SourceComponentType; id: string };
type MutableAssessment = {
  componentType: SourceComponentType;
  componentId: string;
  classification: ComponentAssessment["classification"];
  rationaleCode: RationaleCode;
  requiredCapabilities: readonly string[];
  actionKeys: string[];
};

const typeOrder: Readonly<Record<SourceComponentType, number>> = {
  instructions: 0,
  memory: 1,
  skill: 2,
  routine: 3,
  integration: 4,
};

const rationaleClassifications: Readonly<Record<RationaleCode, ComponentAssessment["classification"]>> = {
  instruction_form_exact: "exact",
  instruction_form_compatible: "compatible",
  instruction_form_unsupported: "unavailable",
  memory_native: "exact",
  memory_embedded: "compatible",
  memory_manual: "partial",
  memory_unsupported: "unavailable",
  skill_native: "exact",
  skill_embedded: "compatible",
  skill_manual: "partial",
  skill_unsupported: "unavailable",
  routine_native: "exact",
  routine_embedded: "compatible",
  routine_manual: "partial",
  routine_unsupported: "unavailable",
  integration_exact: "exact",
  integration_compatible: "compatible",
  integration_partial: "partial",
  integration_unsupported: "unavailable",
  credential_missing: "unavailable",
  execution_mode_unsupported: "unavailable",
  execution_behavior_disallowed: "unsafe",
  creator_permission_denied: "unsafe",
  redistribution_prohibited: "unsafe",
};

function versionOf(input: unknown): string | null {
  if (typeof input !== "object" || input === null || !("schemaVersion" in input)) return null;
  return typeof input.schemaVersion === "string" ? input.schemaVersion : null;
}

function unsupported(input: UnsupportedVersionResult["input"], receivedVersion: string | null): UnsupportedVersionResult {
  return { status: "unsupported_version", input, receivedVersion, supportedVersions: ["1.0.0"] };
}

function invalid(input: InvalidInputResult["input"], issues: InvalidInputResult["issues"]): InvalidInputResult {
  return { status: "invalid_input", input, issues };
}

function strings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

function capabilitiesIssues(input: unknown): InvalidInputResult["issues"] {
  const issues: { code: string; path: string }[] = [];
  if (typeof input !== "object" || input === null) return [{ code: "invalid_type", path: "" }];
  const value = input as Record<string, unknown>;
  const target = value.target as Record<string, unknown> | undefined;
  if (!target || typeof target.provider !== "string" || target.provider.length === 0 || typeof target.runtime !== "string" || target.runtime.length === 0) {
    issues.push({ code: "invalid_target", path: "target" });
  }
  const forms = value.instructionForms as Record<string, unknown> | undefined;
  if (!forms || !strings(forms.exact)) issues.push({ code: "invalid_array", path: "instructionForms.exact" });
  if (!forms || !strings(forms.compatible)) issues.push({ code: "invalid_array", path: "instructionForms.compatible" });
  for (const key of ["memories", "skills", "routines"] as const) {
    if (!["native", "embedded", "manual", "unsupported"].includes(String(value[key]))) {
      issues.push({ code: "invalid_support", path: key });
    }
  }
  if (!Array.isArray(value.integrations)) {
    issues.push({ code: "invalid_array", path: "integrations" });
  } else {
    const ids = new Set<string>();
    for (const [index, entry] of value.integrations.entries()) {
      const integration = entry as Record<string, unknown> | null;
      if (!integration || typeof integration.id !== "string" || !["exact", "compatible", "partial"].includes(String(integration.support)) || !strings(integration.requiredCredentials)) {
        issues.push({ code: "invalid_integration", path: `integrations.${index}` });
      } else if (ids.has(integration.id)) {
        issues.push({ code: "duplicate_integration", path: `integrations.${index}.id` });
      } else {
        ids.add(integration.id);
      }
    }
  }
  if (!strings(value.credentials)) issues.push({ code: "invalid_array", path: "credentials" });
  if (!strings(value.executionModes)) issues.push({ code: "invalid_array", path: "executionModes" });
  const safety = value.safety as Record<string, unknown> | undefined;
  if (!safety || !strings(safety.disallowedExecutionBehaviors)) {
    issues.push({ code: "invalid_array", path: "safety.disallowedExecutionBehaviors" });
  }
  return issues;
}

function policyIssues(input: unknown): InvalidInputResult["issues"] {
  if (typeof input !== "object" || input === null) return [{ code: "invalid_type", path: "" }];
  const value = input as Record<string, unknown>;
  const issues: { code: string; path: string }[] = [];
  if (!["granted", "unknown", "denied"].includes(String(value.creatorPermission))) issues.push({ code: "invalid_value", path: "creatorPermission" });
  if (!["allowed", "private_only", "unknown", "prohibited"].includes(String(value.redistribution))) issues.push({ code: "invalid_value", path: "redistribution" });
  if (!["private", "shared"].includes(String(value.destination))) issues.push({ code: "invalid_value", path: "destination" });
  if (typeof value.instructionForm !== "string" || value.instructionForm.length === 0) issues.push({ code: "invalid_value", path: "instructionForm" });
  if (value.componentRequirements !== undefined && !Array.isArray(value.componentRequirements)) {
    issues.push({ code: "invalid_array", path: "componentRequirements" });
  } else if (Array.isArray(value.componentRequirements)) {
    const keys = new Set<string>();
    for (const [index, entry] of value.componentRequirements.entries()) {
      const requirement = entry as Record<string, unknown> | null;
      const type = requirement?.componentType;
      const id = requirement?.componentId;
      if (!requirement || !["instructions", "memory", "skill", "routine", "integration"].includes(String(type)) || typeof id !== "string" || id.length === 0 || (requirement.executionModes !== undefined && !strings(requirement.executionModes)) || (requirement.executionBehaviors !== undefined && !strings(requirement.executionBehaviors))) {
        issues.push({ code: "invalid_requirement", path: `componentRequirements.${index}` });
      } else {
        const key = `${String(type)}:${id}`;
        if (keys.has(key)) issues.push({ code: "duplicate_requirement", path: `componentRequirements.${index}` });
        keys.add(key);
      }
    }
  }
  if (value.disallowedExecutionBehaviors !== undefined && !strings(value.disallowedExecutionBehaviors)) issues.push({ code: "invalid_array", path: "disallowedExecutionBehaviors" });
  return issues;
}

function sourceComponents(manifest: BotTemplateManifest): SourceComponent[] {
  const components: SourceComponent[] = [];
  if (manifest.instructions !== undefined) components.push({ type: "instructions", id: "manifest.instructions" });
  components.push(...manifest.memories.map(({ id }) => ({ type: "memory" as const, id })));
  components.push(...manifest.skills.map(({ id }) => ({ type: "skill" as const, id })));
  components.push(...manifest.routines.map(({ id }) => ({ type: "routine" as const, id })));
  components.push(...manifest.integrations.map(({ id }) => ({ type: "integration" as const, id })));
  return components.sort(compareComponents);
}

function compareComponents(left: SourceComponent, right: SourceComponent): number {
  return typeOrder[left.type] - typeOrder[right.type] || compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function componentKey(component: SourceComponent): string {
  return `${component.type}:${component.id}`;
}

function actionKey(code: UserActionCode, component?: SourceComponent, subject?: string): string {
  return JSON.stringify([code, component?.type ?? null, component?.id ?? null, subject ?? null]);
}

function supportAssessment(type: "memory" | "skill" | "routine", support: TargetCapabilities["memories"]): MutableAssessment {
  const classification = support === "native" ? "exact" : support === "embedded" ? "compatible" : support === "manual" ? "partial" : "unavailable";
  return {
    componentType: type,
    componentId: "",
    classification,
    rationaleCode: `${type}_${support}` as RationaleCode,
    requiredCapabilities: [`${type}:${support}`],
    actionKeys: [],
  };
}

function assessBase(component: SourceComponent, capabilities: TargetCapabilities, policy: ClonePolicy): MutableAssessment {
  if (component.type === "instructions") {
    const exact = capabilities.instructionForms.exact.includes(policy.instructionForm);
    const compatible = capabilities.instructionForms.compatible.includes(policy.instructionForm);
    return {
      componentType: component.type,
      componentId: component.id,
      classification: exact ? "exact" : compatible ? "compatible" : "unavailable",
      rationaleCode: exact ? "instruction_form_exact" : compatible ? "instruction_form_compatible" : "instruction_form_unsupported",
      requiredCapabilities: [`instruction-form:${policy.instructionForm}`],
      actionKeys: exact || compatible ? [] : [actionKey("provide_supported_component", component, policy.instructionForm)],
    };
  }
  if (component.type === "memory" || component.type === "skill" || component.type === "routine") {
    const support = component.type === "memory" ? capabilities.memories : component.type === "skill" ? capabilities.skills : capabilities.routines;
    const assessed = supportAssessment(component.type, support);
    assessed.componentId = component.id;
    if (assessed.classification === "partial") assessed.actionKeys.push(actionKey("review_manual_conversion", component));
    if (assessed.classification === "unavailable") assessed.actionKeys.push(actionKey("provide_supported_component", component));
    return assessed;
  }
  const integration = capabilities.integrations.find(({ id }) => id === component.id);
  if (!integration) {
    return {
      componentType: component.type,
      componentId: component.id,
      classification: "unavailable",
      rationaleCode: "integration_unsupported",
      requiredCapabilities: [`integration:${component.id}`],
      actionKeys: [actionKey("provide_supported_component", component)],
    };
  }
  const missing = [...new Set(integration.requiredCredentials)].filter((credential) => !capabilities.credentials.includes(credential)).sort();
  if (missing.length > 0) {
    return {
      componentType: component.type,
      componentId: component.id,
      classification: "unavailable",
      rationaleCode: "credential_missing",
      requiredCapabilities: [`integration:${component.id}`, ...missing.map((id) => `credential:${id}`)],
      actionKeys: missing.map((id) => actionKey("provide_credential", component, id)),
    };
  }
  return {
    componentType: component.type,
    componentId: component.id,
    classification: integration.support,
    rationaleCode: `integration_${integration.support}`,
    requiredCapabilities: [`integration:${component.id}`],
    actionKeys: integration.support === "partial" ? [actionKey("review_manual_conversion", component)] : [],
  };
}

function requirementFor(component: SourceComponent, policy: ClonePolicy): ComponentRequirement | undefined {
  return policy.componentRequirements?.find((requirement) => requirement.componentType === component.type && requirement.componentId === component.id);
}

function overrideAssessment(component: SourceComponent, base: MutableAssessment, capabilities: TargetCapabilities, policy: ClonePolicy): MutableAssessment {
  if (policy.creatorPermission === "denied") {
    return { ...base, classification: "unsafe", rationaleCode: "creator_permission_denied", actionKeys: [actionKey("obtain_creator_permission")] };
  }
  if (policy.redistribution === "prohibited" || (policy.redistribution === "private_only" && policy.destination === "shared")) {
    const action = policy.redistribution === "prohibited" ? actionKey("obtain_redistribution_permission") : actionKey("choose_private_destination");
    return { ...base, classification: "unsafe", rationaleCode: "redistribution_prohibited", actionKeys: [action] };
  }
  const requirement = requirementFor(component, policy);
  const disallowed = new Set([...(capabilities.safety.disallowedExecutionBehaviors), ...(policy.disallowedExecutionBehaviors ?? [])]);
  const unsafeBehavior = [...(requirement?.executionBehaviors ?? [])].sort().find((behavior) => disallowed.has(behavior));
  if (unsafeBehavior) {
    return {
      ...base,
      classification: "unsafe",
      rationaleCode: "execution_behavior_disallowed",
      requiredCapabilities: [...base.requiredCapabilities, `execution-behavior:${unsafeBehavior}`].sort(),
      actionKeys: [actionKey("remove_disallowed_execution_behavior", component, unsafeBehavior)],
    };
  }
  const unsupportedMode = [...(requirement?.executionModes ?? [])].sort().find((mode) => !capabilities.executionModes.includes(mode));
  if (unsupportedMode) {
    return {
      ...base,
      classification: "unavailable",
      rationaleCode: "execution_mode_unsupported",
      requiredCapabilities: [...base.requiredCapabilities, `execution-mode:${unsupportedMode}`].sort(),
      actionKeys: [actionKey("choose_supported_execution_mode", component, unsupportedMode)],
    };
  }
  return base;
}

function materializeAction(key: string, id: string): RequiredUserAction {
  const [code, componentType, componentId, subject] = JSON.parse(key) as [UserActionCode, SourceComponentType | null, string | null, string | null];
  if (componentType === null || componentId === null) return { id, code, status: "unresolved", ...(subject ? { subject } : {}) };
  return {
    id,
    code,
    status: "unresolved",
    componentType,
    componentId,
    ...(subject ? { subject } : {}),
  };
}

export function planClone(manifestInput: unknown, capabilitiesInput: unknown, policyInput: unknown): PlanCloneResult {
  const manifestVersion = versionOf(manifestInput);
  if (manifestVersion !== SCHEMA_VERSION) return unsupported("manifest", manifestVersion);
  const capabilitiesVersion = versionOf(capabilitiesInput);
  if (capabilitiesVersion !== TARGET_CAPABILITIES_SCHEMA_VERSION) return unsupported("capabilities", capabilitiesVersion);
  const policyVersion = versionOf(policyInput);
  if (policyVersion !== CLONE_POLICY_SCHEMA_VERSION) return unsupported("policy", policyVersion);

  const manifestResult = BotTemplateManifestSchema.safeParse(manifestInput);
  if (!manifestResult.success) return invalid("manifest", manifestResult.error.issues.map((issue) => ({ code: issue.code, path: issue.path.map(String).join(".") })));
  const capabilityProblems = capabilitiesIssues(capabilitiesInput);
  if (capabilityProblems.length > 0) return invalid("capabilities", capabilityProblems);
  const policyProblems = policyIssues(policyInput);
  if (policyProblems.length > 0) return invalid("policy", policyProblems);

  const manifest = manifestResult.data;
  const capabilities = capabilitiesInput as TargetCapabilities;
  const policy = policyInput as ClonePolicy;
  const components = sourceComponents(manifest);
  const duplicate = components.find((component, index) => components.findIndex((candidate) => componentKey(candidate) === componentKey(component)) !== index);
  if (duplicate) return invalid("manifest", [{ code: "duplicate_component", path: componentKey(duplicate) }]);

  const actionKeys = new Set<string>();
  if (policy.creatorPermission === "unknown") actionKeys.add(actionKey("confirm_creator_permission"));
  if (policy.creatorPermission === "denied") actionKeys.add(actionKey("obtain_creator_permission"));
  if (policy.redistribution === "unknown") actionKeys.add(actionKey("confirm_redistribution_permission"));
  if (policy.redistribution === "prohibited") actionKeys.add(actionKey("obtain_redistribution_permission"));
  if (policy.redistribution === "private_only" && policy.destination === "shared") actionKeys.add(actionKey("choose_private_destination"));

  const mutable = components.map((component) => overrideAssessment(component, assessBase(component, capabilities, policy), capabilities, policy));
  for (const assessment of mutable) for (const key of assessment.actionKeys) actionKeys.add(key);
  const sortedActionKeys = [...actionKeys].sort();
  const actionIds = new Map(sortedActionKeys.map((key, index) => [key, `action-${String(index + 1).padStart(3, "0")}`]));
  const requiredUserActions = sortedActionKeys.map((key) => materializeAction(key, actionIds.get(key) as string));
  const assessments: ComponentAssessment[] = mutable.map(({ actionKeys: keys, ...assessment }) => ({
    ...assessment,
    requiredCapabilities: [...assessment.requiredCapabilities].sort(),
    requiredActionIds: keys.sort().map((key) => actionIds.get(key) as string),
  }));
  const omittedComponents: OmittedComponent[] = assessments
    .filter(({ classification }) => classification === "unavailable" || classification === "unsafe")
    .map(({ componentType, componentId, rationaleCode }) => ({ componentType, componentId, rationaleCode }));
  const warnings: PlanWarning[] = [];
  if (policy.creatorPermission === "unknown") warnings.push({ code: "creator_permission_unconfirmed" });
  if (policy.redistribution === "unknown") warnings.push({ code: "redistribution_unconfirmed" });
  warnings.push(...assessments.filter(({ classification }) => classification === "partial").map(({ componentType, componentId }) => ({ code: "component_degraded" as const, componentType, componentId })));
  const summary = { exact: 0, compatible: 0, partial: 0, unavailable: 0, unsafe: 0 };
  for (const assessment of assessments) summary[assessment.classification] += 1;
  const readiness = summary.unsafe > 0 ? "blocked" : requiredUserActions.length > 0 || summary.unavailable > 0 ? "action_required" : "apply_ready";
  const plan: CompatibilityPlan = {
    schemaVersion: COMPATIBILITY_PLAN_SCHEMA_VERSION,
    manifestId: manifest.id,
    target: capabilities.target,
    assessments,
    requiredUserActions,
    omittedComponents,
    warnings,
    summary,
    readiness,
  };
  const validation = validateClonePlan(manifest, plan);
  if (!validation.valid) return invalid("manifest", validation.issues.map(({ code, componentKey: path }) => ({ code, path })));
  return { status: "planned", plan };
}

export function validateClonePlan(manifest: BotTemplateManifest, plan: CompatibilityPlan): PlanValidationResult {
  const expected = new Set(sourceComponents(manifest).map(componentKey));
  const seen = new Set<string>();
  const issues: { code: string; componentKey: string }[] = [];
  for (const assessment of plan.assessments) {
    const key = componentKey({ type: assessment.componentType, id: assessment.componentId });
    if (seen.has(key)) issues.push({ code: "duplicate_classification", componentKey: key });
    seen.add(key);
    if (!expected.has(key)) issues.push({ code: "unknown_component", componentKey: key });
    if (rationaleClassifications[assessment.rationaleCode] !== assessment.classification) {
      issues.push({ code: "classification_rationale_mismatch", componentKey: key });
    }
  }
  for (const key of expected) if (!seen.has(key)) issues.push({ code: "unclassified_component", componentKey: key });
  return issues.length === 0 ? { valid: true } : { valid: false, issues: issues.sort((a, b) => compareText(a.componentKey, b.componentKey) || compareText(a.code, b.code)) };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareText(left, right)).map(([key, entry]) => [key, canonicalize(entry)]));
}

export function canonicalPlanJson(plan: CompatibilityPlan): string {
  return JSON.stringify(canonicalize(plan));
}
