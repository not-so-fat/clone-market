import { previewAgentDeckRegistration, type AgentDeckRegistrationPreview } from "@clone-market/agent-deck-preview";
import type { BotTemplateManifest, CatalogEntry } from "@clone-market/core";
import { describe, expect, it } from "vitest";

import type { CatalogItem } from "./market.js";
import {
  GROK_MARKETPLACE_URL,
  renderAgentDeckPreview,
  renderAgentDeckPreviewError,
  renderGrokUrlError,
  renderSearchError,
  renderSearchResults,
  renderTrialHome,
} from "./presentation.js";

const NOW = "2026-10-07T12:00:00.000Z";
const source = { provider: "grok-marketplace", externalId: "bot-alpha-1" };

function manifest(overrides: Record<string, unknown> = {}): BotTemplateManifest {
  return {
    schemaVersion: "1.0.0",
    id: "grok-marketplace:bot-alpha-1:manifest",
    source,
    retrievedAt: NOW,
    provenanceUrl: "https://x.ai/bot/marketplace/bots/alpha",
    template: {
      schemaVersion: "1.0.0",
      id: "grok-marketplace:bot-alpha-1",
      name: "Alpha Bot",
      summary: "Alpha summary.",
      creator: { id: "creator-1", name: "Ada" },
      categories: ["research"],
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      featured: false,
      provenance: { schemaVersion: "1.0.0", source, retrievedAt: NOW, url: "https://x.ai/bot/marketplace/bots/alpha" },
    },
    instructions: "Research carefully.",
    memories: [{ id: "memory-1", name: "Notes", content: "facts" }],
    skills: [{ id: "skill-1", name: "Skill One", description: "Does one thing." }],
    routines: [{ id: "routine-1", name: "Routine One", instructions: "Run daily." }],
    integrations: [{ id: "calendar", name: "Calendar", required: true }],
    unavailableFields: ["template.creator.id"],
    ...overrides,
  } as BotTemplateManifest;
}

function catalogItem(overrides: Partial<CatalogEntry> = {}): CatalogItem {
  const item = manifest().template;
  return {
    ...item,
    ...overrides,
    present: true,
    lastRetrievedAt: NOW,
    sourceMetadata: { installCount: 0 },
    evidenceState: "fresh",
  };
}

function candidateIds(html: string): { playbooks: string[]; services: string[] } {
  return {
    playbooks: [...html.matchAll(/data-playbook-id="([^"]+)"/g)].map((match) => match[1]!),
    services: [...html.matchAll(/data-mcp-id="([^"]+)"/g)].map((match) => match[1]!),
  };
}

describe("trial home [agent]", () => {
  it("explains Clone Market, links the marketplace, and presents two primary actions plus browse-all", () => {
    const html = renderTrialHome();
    expect(GROK_MARKETPLACE_URL).toBe("https://x.ai/bot/marketplace");
    expect(html).toContain("read-only preview");
    expect(html).toContain("would register");
    expect(html).toContain(`href="${GROK_MARKETPLACE_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('name="url"');
    expect(html).toContain('name="q"');
    expect(html).toContain("Paste a URL to preview");
    expect(html).toContain("Search the marketplace");
    expect(html).toContain('href="/catalog"');
    expect(html).toContain("Browse the complete catalog");
  });

  it("links every search result to the shared registration preview route", () => {
    const html = renderSearchResults("alpha", [catalogItem(), catalogItem({ id: "grok-marketplace:bot-beta-2" })], 2);
    expect(html).toContain("2 matches");
    expect(html).toContain("complete catalog traversal");
    expect(html).toContain("/templates/grok-marketplace/bot-alpha-1/agent-deck-preview");
    expect(html).toContain("Would register");
  });

  it("renders explicit recoverable URL, search, and empty states without claiming registration", () => {
    for (
      const html of [
        renderGrokUrlError({ code: "unsupported_grok_url", message: "Only public Grok Bot URLs are supported." }),
        renderSearchError({ code: "stored_data_unavailable", message: "The catalog database is locked." }),
        renderSearchResults("nope", [], 0),
      ]
    ) {
      expect(html).not.toContain("registered");
      expect(html.toLowerCase()).not.toContain("success");
    }
    expect(renderGrokUrlError({ code: "not_found", message: "Not in catalog." })).toContain("No preview was fetched");
    expect(renderSearchResults("nope", [], 0)).toContain("No matches");
  });
});

describe("Agent Deck preview rendering [agent]", () => {
  it("renders deep-equal Would register playbook and MCP sections with provenance", () => {
    const preview = previewAgentDeckRegistration(manifest());
    const html = renderAgentDeckPreview(preview);
    expect(html).toContain("Would register");
    expect(html).toContain("Playbooks (3)");
    expect(html).toContain("MCP services (1)");
    expect(candidateIds(html)).toEqual({
      playbooks: ["primary", "skill:skill-1", "routine:routine-1"],
      services: ["integration:calendar"],
    });
    expect(html).toContain("skill:skill-1");
    expect(html).toContain("Needs review");
    expect(html).toContain("integration:calendar");
    expect(html).toContain("Required · credential state unknown");
    expect(html).toContain("cannot identify a service");
    expect(html).toContain("https://x.ai/bot/marketplace/bots/alpha");
    expect(html).toContain(NOW);
    expect(html).toContain("grok-marketplace:bot-alpha-1:manifest");
    expect(html).toContain("template.creator.id");
    expect(html).toContain("Supporting context: 1 public memory (Notes).");
    expect(html).toContain("Back to trial home");
    expect(html).toContain("Open the original Grok template");
    expect(html).not.toContain("registered");
    expect(html.toLowerCase()).not.toContain("success");
    expect(renderAgentDeckPreview(previewAgentDeckRegistration(manifest()))).toBe(html);
  });

  it("renders explicit empty states for zero playbooks or zero MCP candidates", () => {
    const preview = previewAgentDeckRegistration(manifest()) as unknown as {
      -readonly [key in keyof AgentDeckRegistrationPreview]: AgentDeckRegistrationPreview[key];
    };
    const html = renderAgentDeckPreview({ ...preview, playbooks: [], mcpServices: [] });
    expect(html).toContain("Playbooks (0)");
    expect(html).toContain("MCP services (0)");
    expect(html).toContain("No playbook candidates");
    expect(html).toContain("No MCP service candidates");
    expect(html).not.toContain("registered");
    expect(html.toLowerCase()).not.toContain("success");
  });

  it("renders source drift and request failures as recoverable errors", () => {
    for (
      const error of [
        { code: "source_drift", message: "The public source changed its detail shape." },
        { code: "not_found", message: "Template is not in the catalog." },
      ]
    ) {
      const html = renderAgentDeckPreviewError(error, source);
      expect(html).toContain(error.code);
      expect(html).toContain(error.message);
      expect(html).toContain("Retry the preview");
      expect(html).toContain("/templates/grok-marketplace/bot-alpha-1/agent-deck-preview");
      expect(html).not.toContain("registered");
      expect(html.toLowerCase()).not.toContain("success");
    }
  });
});
