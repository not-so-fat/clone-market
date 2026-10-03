export type Migration = { version: number; up: string; down: string };

export const migrations: readonly Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE catalog_templates (
        catalog_id INTEGER PRIMARY KEY,
        source TEXT NOT NULL,
        source_template_id TEXT NOT NULL,
        template_id TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        source_url TEXT NOT NULL,
        name TEXT NOT NULL,
        summary TEXT NOT NULL,
        creator_id TEXT,
        creator_name TEXT NOT NULL,
        categories_json TEXT NOT NULL CHECK (json_valid(categories_json)),
        featured INTEGER NOT NULL CHECK (featured IN (0, 1)),
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        source_retrieved_at TEXT NOT NULL,
        last_retrieved_at TEXT NOT NULL,
        present INTEGER NOT NULL CHECK (present IN (0, 1)),
        source_metadata_json TEXT NOT NULL CHECK (json_valid(source_metadata_json)),
        content_hash TEXT NOT NULL,
        UNIQUE (source, source_template_id)
      );
      CREATE INDEX catalog_templates_listing ON catalog_templates (source, present, name, catalog_id);

      CREATE TABLE catalog_snapshots (
        snapshot_id INTEGER PRIMARY KEY,
        catalog_id INTEGER NOT NULL REFERENCES catalog_templates(catalog_id) ON DELETE CASCADE,
        change_type TEXT NOT NULL CHECK (change_type IN ('added', 'changed', 'removed', 'reappeared')),
        captured_at TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
      );
      CREATE INDEX catalog_snapshots_history ON catalog_snapshots (catalog_id, snapshot_id);

      CREATE TABLE catalog_retrievals (
        retrieval_id INTEGER PRIMARY KEY,
        source TEXT NOT NULL,
        retrieved_at TEXT NOT NULL,
        item_count INTEGER NOT NULL,
        added_count INTEGER NOT NULL,
        changed_count INTEGER NOT NULL,
        removed_count INTEGER NOT NULL,
        reappeared_count INTEGER NOT NULL,
        unchanged_count INTEGER NOT NULL
      );
      CREATE INDEX catalog_retrievals_source ON catalog_retrievals (source, retrieval_id);
    `,
    down: `
      DROP TABLE IF EXISTS catalog_retrievals;
      DROP TABLE IF EXISTS catalog_snapshots;
      DROP TABLE IF EXISTS catalog_templates;
    `,
  },
];
