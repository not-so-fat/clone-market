import type { SourceIdentity } from "@clone-market/core";

export const AGENT_DECK_PREVIEW_SCHEMA_VERSION = "1.0.0" as const;

/** Readiness of one registration candidate. Nothing is registered; this describes what would happen. */
export type AgentDeckReadiness = "ready" | "needs_review" | "cannot_produce";

export interface PlaybookSourceComponent {
  readonly type: "instructions" | "skill" | "routine";
  readonly id: string;
}

export interface PlaybookCandidate {
  readonly kind: "playbook";
  /** Deterministic candidate id: `primary`, `skill:<skill-id>`, or `routine:<routine-id>`. */
  readonly id: string;
  readonly title: string;
  readonly sourceComponent: PlaybookSourceComponent;
  readonly readiness: AgentDeckReadiness;
  readonly reviewReasons: readonly string[];
  /** Public memories attached to the primary candidate as supporting context. Never standalone playbooks. */
  readonly supportingContext: {
    readonly memoryIds: readonly string[];
    readonly memoryNames: readonly string[];
  };
}

export interface McpServiceCandidate {
  readonly kind: "mcp-service";
  /** Deterministic candidate id: `integration:<integration-id>`. */
  readonly id: string;
  readonly title: string;
  readonly sourceComponent: { readonly type: "integration"; readonly id: string };
  readonly readiness: AgentDeckReadiness;
  readonly reviewReasons: readonly string[];
  readonly connection: {
    /** Whether the Grok manifest marks the integration required. */
    readonly required: boolean;
    /**
     * Grok does not expose credential details, so this is always `unknown`.
     * Deliberately not an endpoint, package, or credential value.
     */
    readonly credentialState: "unknown";
  };
}

export interface UnavailablePreviewItem {
  readonly field: string;
  readonly detail: string;
}

export interface AgentDeckRegistrationPreview {
  readonly schemaVersion: typeof AGENT_DECK_PREVIEW_SCHEMA_VERSION;
  readonly source: SourceIdentity;
  readonly manifestId: string;
  readonly retrievedAt: string;
  readonly provenanceUrl: string;
  readonly template: {
    readonly name: string;
    readonly creator: string;
    readonly summary: string;
  };
  readonly playbooks: readonly PlaybookCandidate[];
  readonly mcpServices: readonly McpServiceCandidate[];
  /** Source fields Grok did not expose, kept visible so nothing silently disappears. */
  readonly unavailable: readonly UnavailablePreviewItem[];
}
