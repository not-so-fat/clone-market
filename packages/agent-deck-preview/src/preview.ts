import { BotTemplateManifestSchema, type BotTemplateManifest } from "@clone-market/core";

import {
  AGENT_DECK_PREVIEW_SCHEMA_VERSION,
  type AgentDeckRegistrationPreview,
  type McpServiceCandidate,
  type PlaybookCandidate,
} from "./types.js";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function primaryCandidate(manifest: BotTemplateManifest): PlaybookCandidate {
  const memories = [...manifest.memories].sort((left, right) => compareText(left.id, right.id));
  const supportingContext = {
    memoryIds: memories.map(({ id }) => id),
    memoryNames: memories.map(({ name }) => name),
  };
  if (manifest.instructions === undefined) {
    return {
      kind: "playbook",
      id: "primary",
      title: `${manifest.template.name} — Primary instructions`,
      sourceComponent: { type: "instructions", id: "manifest.instructions" },
      readiness: "cannot_produce",
      reviewReasons: ["Bot-level instructions are not public from Grok, so a primary playbook cannot be produced."],
      supportingContext,
    };
  }
  return {
    kind: "playbook",
    id: "primary",
    title: `${manifest.template.name} — Primary instructions`,
    sourceComponent: { type: "instructions", id: "manifest.instructions" },
    readiness: "ready",
    reviewReasons: memories.length === 0
      ? ["Bot-level instructions are public and complete."]
      : [
          `Bot-level instructions are public and complete with ${memories.length} public ${memories.length === 1 ? "memory" : "memories"} as supporting context.`,
        ],
    supportingContext,
  };
}

function skillCandidates(manifest: BotTemplateManifest): PlaybookCandidate[] {
  return [...manifest.skills]
    .sort((left, right) => compareText(left.id, right.id))
    .map((skill) => ({
      kind: "playbook" as const,
      id: `skill:${skill.id}`,
      title: skill.name,
      sourceComponent: { type: "skill" as const, id: skill.id },
      readiness: skill.instructions === undefined ? "needs_review" as const : "ready" as const,
      reviewReasons: skill.instructions === undefined
        ? ["Skill instructions are not public from Grok; review the public description before registering."]
        : ["Public skill description and instructions are available."],
      supportingContext: { memoryIds: [], memoryNames: [] },
    }));
}

function routineCandidates(manifest: BotTemplateManifest): PlaybookCandidate[] {
  return [...manifest.routines]
    .sort((left, right) => compareText(left.id, right.id))
    .map((routine) => ({
      kind: "playbook" as const,
      id: `routine:${routine.id}`,
      title: routine.name,
      sourceComponent: { type: "routine" as const, id: routine.id },
      readiness: "ready" as const,
      reviewReasons: ["Public routine instructions are available."],
      supportingContext: { memoryIds: [], memoryNames: [] },
    }));
}

function mcpCandidates(manifest: BotTemplateManifest): McpServiceCandidate[] {
  return [...manifest.integrations]
    .sort((left, right) => compareText(left.id, right.id))
    .map((integration) => ({
      kind: "mcp-service" as const,
      id: `integration:${integration.id}`,
      title: integration.name,
      sourceComponent: { type: "integration" as const, id: integration.id },
      readiness: "cannot_produce" as const,
      reviewReasons: [
        "Grok does not expose an MCP endpoint, package, or credential for this integration, so Clone Market cannot identify a service to register.",
      ],
      connection: { required: integration.required, credentialState: "unknown" as const },
    }));
}

/**
 * Build a deterministic, read-only preview of the Agent Deck playbooks and MCP
 * services that would be registered for a normalized manifest.
 *
 * Pure: no Agent Deck calls, no service calls, no invented endpoints, packages,
 * or credentials. Every manifest component is accounted for as a candidate,
 * primary supporting context, or an explicit unavailable item.
 */
export function previewAgentDeckRegistration(input: unknown): AgentDeckRegistrationPreview {
  const manifest = BotTemplateManifestSchema.parse(input);
  return {
    schemaVersion: AGENT_DECK_PREVIEW_SCHEMA_VERSION,
    source: { ...manifest.source },
    manifestId: manifest.id,
    retrievedAt: manifest.retrievedAt,
    provenanceUrl: manifest.provenanceUrl,
    template: {
      name: manifest.template.name,
      creator: manifest.template.creator.name,
      summary: manifest.template.summary,
    },
    playbooks: [primaryCandidate(manifest), ...skillCandidates(manifest), ...routineCandidates(manifest)],
    mcpServices: mcpCandidates(manifest),
    unavailable: [...manifest.unavailableFields].sort(compareText).map((field) => ({
      field,
      detail: `${field} is not public from Grok.`,
    })),
  };
}
