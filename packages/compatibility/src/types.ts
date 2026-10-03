import type { CompatibilityClassification, TargetIdentity } from "@clone-market/core";

export const TARGET_CAPABILITIES_SCHEMA_VERSION = "1.0.0" as const;
export const CLONE_POLICY_SCHEMA_VERSION = "1.0.0" as const;
export const COMPATIBILITY_PLAN_SCHEMA_VERSION = "1.0.0" as const;

export type SourceComponentType = "instructions" | "memory" | "skill" | "routine" | "integration";
export type ComponentSupport = "native" | "embedded" | "manual" | "unsupported";
export type IntegrationSupport = "exact" | "compatible" | "partial";

export interface TargetCapabilities {
  readonly schemaVersion: typeof TARGET_CAPABILITIES_SCHEMA_VERSION;
  readonly target: TargetIdentity;
  readonly instructionForms: {
    readonly exact: readonly string[];
    readonly compatible: readonly string[];
  };
  readonly memories: ComponentSupport;
  readonly skills: ComponentSupport;
  readonly routines: ComponentSupport;
  readonly integrations: readonly {
    readonly id: string;
    readonly support: IntegrationSupport;
    readonly requiredCredentials: readonly string[];
  }[];
  readonly credentials: readonly string[];
  readonly executionModes: readonly string[];
  readonly safety: {
    readonly disallowedExecutionBehaviors: readonly string[];
  };
}

export interface ComponentRequirement {
  readonly componentType: SourceComponentType;
  readonly componentId: string;
  readonly executionModes?: readonly string[];
  readonly executionBehaviors?: readonly string[];
}

export interface ClonePolicy {
  readonly schemaVersion: typeof CLONE_POLICY_SCHEMA_VERSION;
  readonly creatorPermission: "granted" | "unknown" | "denied";
  readonly redistribution: "allowed" | "private_only" | "unknown" | "prohibited";
  readonly destination: "private" | "shared";
  readonly instructionForm: string;
  readonly componentRequirements?: readonly ComponentRequirement[];
  readonly disallowedExecutionBehaviors?: readonly string[];
}

export type RationaleCode =
  | "instruction_form_exact"
  | "instruction_form_compatible"
  | "instruction_form_unsupported"
  | "memory_native"
  | "memory_embedded"
  | "memory_manual"
  | "memory_unsupported"
  | "skill_native"
  | "skill_embedded"
  | "skill_manual"
  | "skill_unsupported"
  | "routine_native"
  | "routine_embedded"
  | "routine_manual"
  | "routine_unsupported"
  | "integration_exact"
  | "integration_compatible"
  | "integration_partial"
  | "integration_unsupported"
  | "credential_missing"
  | "execution_mode_unsupported"
  | "execution_behavior_disallowed"
  | "creator_permission_denied"
  | "redistribution_prohibited";

export type UserActionCode =
  | "confirm_creator_permission"
  | "obtain_creator_permission"
  | "obtain_redistribution_permission"
  | "choose_private_destination"
  | "confirm_redistribution_permission"
  | "provide_credential"
  | "choose_supported_execution_mode"
  | "remove_disallowed_execution_behavior"
  | "review_manual_conversion"
  | "provide_supported_component";

export interface RequiredUserAction {
  readonly id: string;
  readonly code: UserActionCode;
  readonly status: "unresolved";
  readonly componentType?: SourceComponentType;
  readonly componentId?: string;
  readonly subject?: string;
}

export interface ComponentAssessment {
  readonly componentType: SourceComponentType;
  readonly componentId: string;
  readonly classification: CompatibilityClassification;
  readonly rationaleCode: RationaleCode;
  readonly requiredCapabilities: readonly string[];
  readonly requiredActionIds: readonly string[];
}

export interface OmittedComponent {
  readonly componentType: SourceComponentType;
  readonly componentId: string;
  readonly rationaleCode: RationaleCode;
}

export interface PlanWarning {
  readonly code: "creator_permission_unconfirmed" | "redistribution_unconfirmed" | "component_degraded";
  readonly componentType?: SourceComponentType;
  readonly componentId?: string;
}

export interface CompatibilityPlan {
  readonly schemaVersion: typeof COMPATIBILITY_PLAN_SCHEMA_VERSION;
  readonly manifestId: string;
  readonly target: TargetIdentity;
  readonly assessments: readonly ComponentAssessment[];
  readonly requiredUserActions: readonly RequiredUserAction[];
  readonly omittedComponents: readonly OmittedComponent[];
  readonly warnings: readonly PlanWarning[];
  readonly summary: Readonly<Record<CompatibilityClassification, number>>;
  readonly readiness: "apply_ready" | "action_required" | "blocked";
}

export type UnsupportedVersionResult = {
  readonly status: "unsupported_version";
  readonly input: "manifest" | "capabilities" | "policy";
  readonly receivedVersion: string | null;
  readonly supportedVersions: readonly ["1.0.0"];
};

export type InvalidInputResult = {
  readonly status: "invalid_input";
  readonly input: "manifest" | "capabilities" | "policy";
  readonly issues: readonly { readonly code: string; readonly path: string }[];
};

export type PlanCloneResult =
  | { readonly status: "planned"; readonly plan: CompatibilityPlan }
  | UnsupportedVersionResult
  | InvalidInputResult;

export type PlanValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly issues: readonly { readonly code: string; readonly componentKey: string }[] };
