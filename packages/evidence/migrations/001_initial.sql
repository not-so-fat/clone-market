CREATE TABLE evidence_clusters (
  cluster_id INTEGER PRIMARY KEY,
  template_id TEXT NOT NULL,
  cluster_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (template_id, cluster_key)
);

CREATE TABLE evidence_rows (
  row_id INTEGER PRIMARY KEY,
  evidence_id TEXT NOT NULL UNIQUE,
  template_id TEXT NOT NULL,
  cluster_id INTEGER NOT NULL REFERENCES evidence_clusters(cluster_id),
  schema_version TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  source_external_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  source_retrieved_at TEXT NOT NULL,
  author_id TEXT,
  author_name TEXT NOT NULL,
  published_at TEXT NOT NULL,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN (
    'creator_promo', 'shared_without_use', 'trying_or_installed',
    'repeated_use', 'concrete_outcome', 'complaint_or_failure'
  )),
  claim TEXT NOT NULL,
  engagement_json TEXT NOT NULL CHECK (json_valid(engagement_json)),
  creator_relationship TEXT NOT NULL CHECK (creator_relationship IN ('creator', 'affiliated', 'independent', 'unknown')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  collected_at TEXT NOT NULL,
  review_state TEXT NOT NULL CHECK (review_state IN ('pending', 'reviewed', 'rejected')),
  UNIQUE (template_id, canonical_url)
);
CREATE INDEX evidence_rows_template ON evidence_rows (template_id, published_at, row_id);
CREATE INDEX evidence_rows_cluster ON evidence_rows (cluster_id, row_id);

CREATE TABLE adoption_snapshots (
  snapshot_id INTEGER PRIMARY KEY,
  snapshot_key TEXT NOT NULL UNIQUE,
  template_id TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  evidence_through TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  derivation_json TEXT NOT NULL CHECK (json_valid(derivation_json))
);
CREATE INDEX adoption_snapshots_latest ON adoption_snapshots (template_id, calculated_at DESC, snapshot_id DESC);
