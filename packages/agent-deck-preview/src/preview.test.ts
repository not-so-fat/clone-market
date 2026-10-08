import type { BotTemplateManifest } from "@clone-market/core";
import { describe, expect, it } from "vitest";

import { previewAgentDeckRegistration } from "./index.js";

const NOW = "2026-10-07T12:00:00.000Z";
const source = { provider: "grok-marketplace", externalId: "bot-trial-1" };

function template(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0.0",
    id: "grok-marketplace:bot-trial-1",
    name: "Trial Bot",
    summary: "A public trial bot.",
    creator: { id: "creator-1", name: "Ada" },
    categories: ["research"],
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    featured: false,
    provenance: {
      schemaVersion: "1.0.0",
      source,
      retrievedAt: NOW,
      url: "https://x.ai/bot/marketplace/bots/trial-bot",
    },
    ...overrides,
  };
}

function manifest(overrides: Record<string, unknown> = {}): BotTemplateManifest {
  return {
    schemaVersion: "1.0.0",
    id: "grok-marketplace:bot-trial-1:manifest",
    source,
    retrievedAt: NOW,
    provenanceUrl: "https://x.ai/bot/marketplace/bots/trial-bot",
    template: template(),
    instructions: "Research carefully.",
    memories: [
      { id: "memory-b", name: "Beta notes", content: "b" },
      { id: "memory-a", name: "Alpha notes", content: "a" },
    ],
    skills: [
      { id: "skill-b", name: "Beta skill", description: "Beta.", instructions: "Do beta." },
      { id: "skill-a", name: "Alpha skill", description: "Alpha." },
    ],
    routines: [{ id: "routine-a", name: "Morning routine", instructions: "Run every morning." }],
    integrations: [
      { id: "calendar", name: "Calendar", required: true },
      { id: "drive", name: "Drive", required: false },
    ],
    unavailableFields: [],
    ...overrides,
  } as BotTemplateManifest;
}

describe("Agent Deck registration preview [agent]", () => {
  it("emits one primary playbook, one per skill and routine, and one MCP candidate per integration", () => {
    const preview = previewAgentDeckRegistration(manifest());
    expect(preview.schemaVersion).toBe("1.0.0");
    expect(preview.source).toEqual(source);
    expect(preview.manifestId).toContain("bot-trial-1");
    expect(preview.retrievedAt).toBe(NOW);
    expect(preview.provenanceUrl).toBe("https://x.ai/bot/marketplace/bots/trial-bot");
    expect(preview.playbooks.map(({ id }) => id)).toEqual([
      "primary",
      "skill:skill-a",
      "skill:skill-b",
      "routine:routine-a",
    ]);
    expect(preview.playbooks[0]).toMatchObject({
      kind: "playbook",
      sourceComponent: { type: "instructions", id: "manifest.instructions" },
      readiness: "ready",
    });
    expect(preview.mcpServices.map(({ id }) => id)).toEqual(["integration:calendar", "integration:drive"]);
    expect(preview.mcpServices[0]).toMatchObject({
      kind: "mcp-service",
      title: "Calendar",
      sourceComponent: { type: "integration", id: "calendar" },
      connection: { required: true, credentialState: "unknown" },
    });
    expect(preview).toMatchSnapshot();
  });

  it("marks a skill without public instructions as needs_review", () => {
    const preview = previewAgentDeckRegistration(manifest());
    const withoutInstructions = preview.playbooks.find(({ id }) => id === "skill:skill-a");
    const withInstructions = preview.playbooks.find(({ id }) => id === "skill:skill-b");
    expect(withoutInstructions?.readiness).toBe("needs_review");
    expect(withoutInstructions?.reviewReasons.join(" ")).toContain("not public");
    expect(withInstructions?.readiness).toBe("ready");
  });

  it("keeps public memories as supporting context on the primary candidate only", () => {
    const preview = previewAgentDeckRegistration(manifest());
    expect(preview.playbooks[0]?.supportingContext).toEqual({
      memoryIds: ["memory-a", "memory-b"],
      memoryNames: ["Alpha notes", "Beta notes"],
    });
    for (const candidate of preview.playbooks.slice(1)) {
      expect(candidate.supportingContext).toEqual({ memoryIds: [], memoryNames: [] });
      expect(candidate.sourceComponent.type).not.toBe("memory");
    }
    expect(preview.playbooks.some(({ sourceComponent }) => sourceComponent.type === "memory")).toBe(false);
  });

  it("reports a missing-instructions manifest as a cannot_produce primary with visible unavailable fields", () => {
    const preview = previewAgentDeckRegistration(
      manifest({
        instructions: undefined,
        memories: [],
        skills: [],
        routines: [],
        integrations: [],
        unavailableFields: ["instructions", "memories", "skills", "routines", "integrations"],
      }),
    );
    expect(preview.playbooks).toHaveLength(1);
    expect(preview.playbooks[0]).toMatchObject({ id: "primary", readiness: "cannot_produce" });
    expect(preview.mcpServices).toEqual([]);
    expect(preview.unavailable.map(({ field }) => field)).toEqual([
      "instructions",
      "integrations",
      "memories",
      "routines",
      "skills",
    ]);
    expect(preview).toMatchSnapshot();
  });

  it("never invents an MCP endpoint, package, or credential for an integration", () => {
    const preview = previewAgentDeckRegistration(manifest());
    const forbiddenKeys = new Set(["endpoint", "package", "credential", "credentials", "token", "secret", "url"]);
    const keysOf = (value: unknown): string[] => {
      if (value === null || typeof value !== "object") return [];
      if (Array.isArray(value)) return value.flatMap(keysOf);
      return Object.entries(value).flatMap(([key, entry]) => [key, ...keysOf(entry)]);
    };
    for (const candidate of preview.mcpServices) {
      expect(candidate.readiness).toBe("cannot_produce");
      expect(candidate.reviewReasons.join(" ")).toContain("cannot identify a service");
      const { reviewReasons: _disclosure, ...structural } = candidate;
      for (const key of keysOf(structural)) expect(forbiddenKeys.has(key)).toBe(false);
    }
  });

  it("accounts for every manifest component as a candidate, supporting context, or unavailable item", () => {
    const input = manifest();
    const preview = previewAgentDeckRegistration(input);
    const candidateComponents = new Set([
      ...preview.playbooks.map(({ sourceComponent }) => `${sourceComponent.type}:${sourceComponent.id}`),
      ...preview.mcpServices.map(({ sourceComponent }) => `${sourceComponent.type}:${sourceComponent.id}`),
    ]);
    expect(candidateComponents.has("instructions:manifest.instructions")).toBe(true);
    for (const skill of input.skills) expect(candidateComponents.has(`skill:${skill.id}`)).toBe(true);
    for (const routine of input.routines) expect(candidateComponents.has(`routine:${routine.id}`)).toBe(true);
    for (const integration of input.integrations) expect(candidateComponents.has(`integration:${integration.id}`)).toBe(true);
    const supporting = new Set(preview.playbooks[0]?.supportingContext.memoryIds ?? []);
    for (const memory of input.memories) expect(supporting.has(memory.id)).toBe(true);

    const sparse = manifest({
      instructions: undefined,
      memories: [],
      skills: [],
      routines: [],
      integrations: [],
      unavailableFields: ["instructions", "memories", "skills", "routines", "integrations"],
    });
    const sparsePreview = previewAgentDeckRegistration(sparse);
    const unavailable = new Set(sparsePreview.unavailable.map(({ field }) => field));
    for (const field of sparse.unavailableFields) expect(unavailable.has(field)).toBe(true);
    expect(sparsePreview.playbooks).toHaveLength(1);
  });

  it("produces deep-equal output for repeated identical input regardless of component order", () => {
    const input = manifest();
    const reordered = manifest({
      memories: [...input.memories].reverse(),
      skills: [...input.skills].reverse(),
      integrations: [...input.integrations].reverse(),
    });
    expect(previewAgentDeckRegistration(structuredClone(input))).toEqual(previewAgentDeckRegistration(input));
    expect(previewAgentDeckRegistration(reordered)).toEqual(previewAgentDeckRegistration(input));
  });
});
