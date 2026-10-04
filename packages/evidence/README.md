# `@clone-market/evidence`

Source-neutral storage and deterministic labels for reviewed public adoption evidence.
The package records what public sources say; it does not infer private Grok usage,
rank templates, collect telemetry, or automate searches.

## Classification

Only rows with `reviewState: "reviewed"` and dates no later than the derivation time
are eligible. Canonical URLs are stored once, and rows sharing a configurable
cluster key contribute one representative, so repost and quote chains cannot inflate
counts. Engagement values are retained as a source snapshot but never affect labels.

Rules are evaluated in this order:

1. `observed_use`: three independent usage clusters, including at least one
   `repeated_use` or `concrete_outcome` cluster.
2. `emerging`: two independent usage clusters, or strong recent mention velocity.
   V0 defines strong velocity as three independent organic clusters published in
   the trailing 30 days.
3. `discussed`: two independent organic reference clusters.
4. `listed`: Marketplace presence, creator promotion, or evidence below the other
   thresholds.

`complaint_or_failure` is a usage report because it explicitly describes attempted
use, but it does not satisfy the repeated-use/concrete-outcome requirement. Creator
and affiliated rows never count as independent. Every result contains the stored
evidence, selected evidence IDs, and each rule's threshold, count, and contributing
IDs.

## Import

The CLI accepts a JSON array of core `Evidence` objects extended with `reviewState`
and optional `clusterKey`:

```sh
clone-market-evidence-import \
  --database ./evidence.sqlite \
  --file ./reviewed-evidence.json \
  --dry-run
```

Import stores reviewed rows only. Derive an inspectable adoption snapshot (required before live labels appear):

```sh
clone-market-evidence-derive \
  --database ./evidence.sqlite \
  --template-id grok-marketplace:bot-projects-manager-20261002
```

From the Clone Market repo root: `npm run evidence:derive -- --database PATH --template-id ID`. Live `smoke:v0:live` also derives missing snapshots on the operator evidence DB.

CSV uses these columns:

```text
schemaVersion,id,templateId,sourceProvider,sourceExternalId,sourceUrl,sourceRetrievedAt,authorId,authorName,publishedAt,collectedAt,type,claim,engagement,creatorRelationship,confidence,reviewState,clusterKey
```

`engagement` is a JSON object in the CSV cell. Validation is atomic and reports
row numbers and field paths. A dry run returns insert/dedup actions but writes no
evidence rows. `installCount` is rejected because it is catalog metadata rather
than evidence of use.

Library consumers can call `importEvidence`, `EvidenceService.derive`, and
`EvidenceService.getLatest`. The SQLite adapter implements both the core
`EvidenceRepository` port and the richer package `EvidenceStore` port.
