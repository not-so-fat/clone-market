export type DemoEvidenceRow = {
  schemaVersion: "1.0.0";
  id: string;
  templateId: string;
  provenance: {
    schemaVersion: "1.0.0";
    source: { provider: string; externalId: string };
    retrievedAt: string;
    url: string;
  };
  author: { id: string; name: string };
  publishedAt: string;
  collectedAt: string;
  type: string;
  claim: string;
  engagement: Record<string, number>;
  creatorRelationship: "independent";
  confidence: number;
  reviewState: "reviewed";
};

export declare function demoEvidenceRows(now?: string): DemoEvidenceRow[];

export type DemoSeedResult = {
  catalog: {
    total: number;
    added: number;
    changed: number;
    removed: number;
    reappeared: number;
    unchanged: number;
  };
  evidence: {
    rows: number;
    snapshotId: string;
    label: string;
  };
};

export declare function prepareDemoDatabases(input: {
  catalogPath: string;
  evidencePath: string;
  artifactDir: string;
  grokBaseUrl: string;
  now?: string;
  fetchClient?: (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}): Promise<DemoSeedResult>;
