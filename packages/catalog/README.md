# `@clone-market/catalog`

This package reconciles complete public template indexes into a source-neutral SQLite catalog. `CatalogService` depends only on the core `SourceAdapter` and `CatalogRepository` ports. It deliberately calls `listTemplates` only: fetching and normalizing a full third-party manifest remains a private, user-initiated import concern.

## Storage boundary

The repository persists only template identity, public source URL, name/summary, creator, categories, Featured state, first/last-seen times, retrieval times, presence, and the strict `CatalogSourceMetadata` allowlist (`installCount` in V0). The allowlist is validated both in the service and at the repository boundary. Instructions, memories, skills, routines, integrations, credentials, fetched documents, and full manifests are not schema columns and unknown fields are rejected rather than silently discarded.

Identity is `(source, source_template_id)`. Each complete reconciliation atomically adds new rows, updates changed rows, marks omitted rows missing, and marks returned rows reappeared. Snapshots are written only for those four transitions, so replaying an unchanged index updates observation stamps without duplicating records or snapshots.

## Database and migrations

Pass a database path to `SqliteCatalogRepository` or `runCatalogReconciliation`. Applications should use a local application-data path (for example, `$XDG_DATA_HOME/clone-market/catalog.sqlite`); the package does not assume or write a global location. Parent directories are created automatically. Tests may use `:memory:`.

Migrations are ordered, transactional, and applied automatically using SQLite `user_version`. Checked-in SQL lives in `migrations/`. Production migration policy is forward-only: make a filesystem-level backup of the SQLite database before deploying a new package version. Down SQL is documented and provided for disposable local/test databases, but application code never auto-downgrades a database because doing so can destroy catalog history.

## Harness

`runCatalogReconciliation({ adapter, databasePath })` accepts any configured core `SourceAdapter`, reconciles every returned page, closes the database, and resolves to a JSON-serializable report with `added`, `changed`, `removed`, `reappeared`, and `unchanged` counts. Use `CatalogService` with a repository directly for filtered listing, identity lookup, and source history reads.
