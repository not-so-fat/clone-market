import { readFile } from "node:fs/promises";

import { BotTemplateManifestSchema, SCHEMA_VERSION, type BotTemplateManifest } from "@clone-market/core";
import { describe, expect, it } from "vitest";

import {
  canonicalPlanJson,
  CLONE_POLICY_SCHEMA_VERSION,
  planClone,
  TARGET_CAPABILITIES_SCHEMA_VERSION,
  validateClonePlan,
  type ClonePolicy,
  type CompatibilityPlan,
  type TargetCapabilities,
} from "./index.js";

const timestamp = "2026-10-03T12:00:00.000Z";
const source = { provider: "fixture-source", externalId: "template-1" };
const manifest: BotTemplateManifest = BotTemplateManifestSchema.parse({
  schemaVersion: SCHEMA_VERSION,
  id: "manifest-1",
  source,
  retrievedAt: timestamp,
  provenanceUrl: "https://example.com/templates/1",
  template: {
    schemaVersion: SCHEMA_VERSION,
    id: "template-1",
    name: "Project helper",
    summary: "Coordinates project work.",
    creator: { id: "creator-1", name: "Creator" },
    categories: ["productivity"],
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    featured: false,
    provenance: {
      schemaVersion: SCHEMA_VERSION,
      source,
      retrievedAt: timestamp,
      url: "https://example.com/templates/1",
    },
  },
  instructions: "Coordinate the project.",
  memories: [{ id: "preferences", name: "Preferences", content: "Be concise." }],
  skills: [{ id: "planning", name: "Planning", description: "Plans tasks", instructions: "Make a plan." }],
  routines: [{ id: "standup", name: "Standup", instructions: "Summarize progress." }],
  integrations: [{ id: "issues", name: "Issue tracker", required: true }],
  unavailableFields: [],
});

const baseCapabilities: TargetCapabilities = {
  schemaVersion: TARGET_CAPABILITIES_SCHEMA_VERSION,
  target: { provider: "fixture", runtime: "agent" },
  instructionForms: { exact: ["plain_text"], compatible: [] },
  memories: "native",
  skills: "native",
  routines: "native",
  integrations: [{ id: "issues", support: "exact", requiredCredentials: [] }],
  credentials: [],
  executionModes: ["interactive"],
  safety: { disallowedExecutionBehaviors: ["destructive_shell"] },
};

const basePolicy: ClonePolicy = {
  schemaVersion: CLONE_POLICY_SCHEMA_VERSION,
  creatorPermission: "granted",
  redistribution: "allowed",
  destination: "private",
  instructionForm: "plain_text",
};

function planned(capabilities: TargetCapabilities, policy: ClonePolicy = basePolicy): CompatibilityPlan {
  const result = planClone(manifest, capabilities, policy);
  expect(result.status).toBe("planned");
  if (result.status !== "planned") throw new Error(`Expected a plan, received ${result.status}`);
  return result.plan;
}

describe("capability-only target variation", () => {
  it("produces a full plan for the Botmancers fixture", () => {
    const plan = planned({ ...baseCapabilities, target: { provider: "botmancers-fixture", runtime: "agent" } });

    expect(plan.assessments.map(({ componentType, classification, rationaleCode }) => ({ componentType, classification, rationaleCode }))).toEqual([
      { componentType: "instructions", classification: "exact", rationaleCode: "instruction_form_exact" },
      { componentType: "memory", classification: "exact", rationaleCode: "memory_native" },
      { componentType: "skill", classification: "exact", rationaleCode: "skill_native" },
      { componentType: "routine", classification: "exact", rationaleCode: "routine_native" },
      { componentType: "integration", classification: "exact", rationaleCode: "integration_exact" },
    ]);
    expect(plan.readiness).toBe("apply_ready");
  });

  it("produces compatible and partial entries for a generic coding-agent fixture", () => {
    const plan = planned({
      ...baseCapabilities,
      target: { provider: "generic-fixture", runtime: "coding-agent" },
      instructionForms: { exact: [], compatible: ["plain_text"] },
      memories: "embedded",
      skills: "embedded",
      routines: "manual",
      integrations: [{ id: "issues", support: "compatible", requiredCredentials: [] }],
    });

    expect(plan.assessments.map(({ classification }) => classification)).toEqual(["compatible", "compatible", "compatible", "partial", "compatible"]);
    expect(plan.assessments[3]).toMatchObject({ rationaleCode: "routine_manual", requiredActionIds: ["action-001"] });
    expect(plan.requiredUserActions).toContainEqual(expect.objectContaining({ id: "action-001", code: "review_manual_conversion" }));
    expect(plan.readiness).toBe("action_required");
    expect(plan).toMatchSnapshot();
  });

  it("contains no product-name conditionals in planner source", async () => {
    const sourceText = await readFile(new URL("./planner.ts", import.meta.url), "utf8");
    expect(sourceText).not.toMatch(/botmancers|coding-agent|grok/i);
  });
});

describe("deterministic, exhaustive plans", () => {
  it("repeats byte-equivalent canonical output and matches the stable full fixture", () => {
    const first = planned(baseCapabilities);
    const second = planned({
      ...baseCapabilities,
      instructionForms: { exact: [...baseCapabilities.instructionForms.exact].reverse(), compatible: [] },
      credentials: [...baseCapabilities.credentials].reverse(),
      executionModes: [...baseCapabilities.executionModes].reverse(),
    });

    expect(canonicalPlanJson(first)).toBe(canonicalPlanJson(second));
    expect(first).toMatchSnapshot();
  });

  it.each([
    ["exact", "memory_native", "native"],
    ["compatible", "memory_embedded", "embedded"],
    ["partial", "memory_manual", "manual"],
    ["unavailable", "memory_unsupported", "unsupported"],
  ] as const)("classifies memory support as %s with %s", (classification, rationaleCode, memories) => {
    const plan = planned({ ...baseCapabilities, memories });
    expect(plan.assessments.find(({ componentType }) => componentType === "memory")).toMatchObject({ classification, rationaleCode });
    expect(validateClonePlan(manifest, plan)).toEqual({ valid: true });
  });

  it("fails validation when a source component is unclassified, duplicated, or mismatched", () => {
    const plan = planned(baseCapabilities);
    const withoutMemory = { ...plan, assessments: plan.assessments.filter(({ componentType }) => componentType !== "memory") };
    expect(validateClonePlan(manifest, withoutMemory)).toMatchObject({ valid: false, issues: [{ code: "unclassified_component", componentKey: "memory:preferences" }] });

    const duplicate = { ...plan, assessments: [...plan.assessments, plan.assessments[0]!] };
    expect(validateClonePlan(manifest, duplicate)).toMatchObject({ valid: false, issues: expect.arrayContaining([{ code: "duplicate_classification", componentKey: "instructions:manifest.instructions" }]) });

    const mismatched = { ...plan, assessments: plan.assessments.map((entry, index) => index === 0 ? { ...entry, classification: "partial" as const } : entry) };
    expect(validateClonePlan(manifest, mismatched)).toMatchObject({ valid: false, issues: [{ code: "classification_rationale_mismatch", componentKey: "instructions:manifest.instructions" }] });
  });
});

describe("unavailable and unsafe plans", () => {
  it("returns a stable unavailable plan with unresolved actions", () => {
    const plan = planned({
      ...baseCapabilities,
      instructionForms: { exact: [], compatible: [] },
      memories: "unsupported",
      skills: "unsupported",
      routines: "unsupported",
      integrations: [],
    });

    expect(plan.summary).toEqual({ exact: 0, compatible: 0, partial: 0, unavailable: 5, unsafe: 0 });
    expect(plan.requiredUserActions).not.toHaveLength(0);
    expect(plan.omittedComponents).toHaveLength(5);
    expect(plan.readiness).toBe("action_required");
    expect(plan).toMatchSnapshot();
  });

  it("never marks missing credentials apply-ready", () => {
    const plan = planned({
      ...baseCapabilities,
      integrations: [{ id: "issues", support: "exact", requiredCredentials: ["issues-token"] }],
    });

    expect(plan.assessments.at(-1)).toMatchObject({ classification: "unavailable", rationaleCode: "credential_missing" });
    expect(plan.requiredUserActions).toContainEqual(expect.objectContaining({ code: "provide_credential", status: "unresolved", subject: "issues-token" }));
    expect(plan.readiness).toBe("action_required");
  });

  it("makes an unsupported execution mode unavailable and actionable", () => {
    const plan = planned(baseCapabilities, {
      ...basePolicy,
      componentRequirements: [{ componentType: "skill", componentId: "planning", executionModes: ["autonomous"] }],
    });

    expect(plan.assessments.find(({ componentType }) => componentType === "skill")).toMatchObject({
      classification: "unavailable",
      rationaleCode: "execution_mode_unsupported",
    });
    expect(plan.requiredUserActions).toContainEqual(expect.objectContaining({ code: "choose_supported_execution_mode", subject: "autonomous" }));
    expect(plan.readiness).toBe("action_required");
  });

  it("returns a stable unsafe plan with an unresolved action", () => {
    const policy: ClonePolicy = {
      ...basePolicy,
      componentRequirements: [{ componentType: "routine", componentId: "standup", executionBehaviors: ["destructive_shell"] }],
    };
    const plan = planned(baseCapabilities, policy);

    expect(plan.assessments.find(({ componentType }) => componentType === "routine")).toMatchObject({ classification: "unsafe", rationaleCode: "execution_behavior_disallowed" });
    expect(plan.requiredUserActions).toContainEqual(expect.objectContaining({ code: "remove_disallowed_execution_behavior", status: "unresolved" }));
    expect(plan.readiness).toBe("blocked");
    expect(plan).toMatchSnapshot();
  });

  it("applies creator and redistribution policy without rewriting components", () => {
    const denied = planned(baseCapabilities, { ...basePolicy, creatorPermission: "denied" });
    expect(denied.summary.unsafe).toBe(5);
    expect(denied.requiredUserActions).toContainEqual(expect.objectContaining({ code: "obtain_creator_permission" }));

    const shared = planned(baseCapabilities, { ...basePolicy, redistribution: "private_only", destination: "shared" });
    expect(shared.summary.unsafe).toBe(5);
    expect(shared.requiredUserActions).toContainEqual(expect.objectContaining({ code: "choose_private_destination" }));
  });
});

describe("versioned inputs", () => {
  it.each([
    ["manifest", { ...manifest, schemaVersion: "2.0.0" }, baseCapabilities, basePolicy],
    ["capabilities", manifest, { ...baseCapabilities, schemaVersion: "2.0.0" }, basePolicy],
    ["policy", manifest, baseCapabilities, { ...basePolicy, schemaVersion: "2.0.0" }],
  ] as const)("returns a typed unsupported-version result for %s", (input, manifestInput, capabilitiesInput, policyInput) => {
    expect(planClone(manifestInput, capabilitiesInput, policyInput)).toEqual({
      status: "unsupported_version",
      input,
      receivedVersion: "2.0.0",
      supportedVersions: ["1.0.0"],
    });
  });
});
