# Clone Market product brief

**Status:** V0 implementation assembled; offline acceptance harness proven; live operator proof pending

**Updated:** 2026-10-03

**Decision:** Build a complete, source-linked index of public Grok Bot templates, progressively enrich every template with public adoption evidence, and support private compatibility-aware imports without republishing creators' configurations.

**Proven offline (fixture / stub):** complete captured Marketplace reconciliation without a hard-coded catalog cap; evidence-backed adoption labels with inspectable contributions; reviewed Botmancers preview → explicit approval → apply → read-after-write verification; idempotent target-operation replay; typed non-mutating failures for source drift, Botmancers unavailability, and changed plan digests. See `docs/acceptance-v0.md` and `npm run smoke:v0`.

**Still operator / external:** live Marketplace traversal against today’s public HTML/RSC surface; browser recording of catalog → inspector → preview → apply → verify plus Botmancers return; continuous freshness of public evidence rows.

## Value

Clone Market helps an agent user discover useful public agent templates, see the evidence behind their relevance, understand what will transfer, and privately recreate the compatible parts in the agent environment they already use.

## User story

As an agent user exploring the Grok Bot Marketplace, I want to compare every available public template and prepare a private, target-compatible import for Botmancer, Agent Deck, or a coding agent so that I can reuse a proven workflow without manually reverse-engineering its configuration.

Acceptance:

- The full public Marketplace catalog is represented; research sampling never becomes a catalog cap.
- Each listing identifies its source, creator, retrieval time, and available configuration components.
- Popularity claims are replaced by inspectable public-adoption signals with evidence links and confidence.
- Before cloning, the user sees an exact, compatible, partial, or inspiration-only assessment.
- Full configurations and generated clones remain private unless the creator permits redistribution.

## Existing substrate

As observed on 2026-10-02:

- The public Grok Bot Marketplace page exposed 89 structured template records in its server-rendered payload.
- The Marketplace exposed four editorially Featured templates but no reliable public usage leaderboard.
- An `installCount` field was present but returned `0` for all 89 listings, so it cannot support popularity claims.
- Public detail pages exposed combinations of identity, description, memories, skills, routines, and integrations.
- No documented Marketplace API was found. The available read surface is undocumented HTML / React Server Component data and must be treated as changeable.
- xAI's third-party Bot terms prohibit redistributing, re-sharing, or re-exporting a Bot or its configuration without creator permission.

Sources:

- https://x.ai/bot/marketplace
- https://docs.x.ai/grok-bot/bots
- https://x.ai/legal/bot-sharing-terms
- https://x.ai/bot/marketplace/bots/projects-manager
- https://x.ai/bot/marketplace/bots/tinkabot
- https://x.ai/bot/marketplace/bots/dr-eggbot-v2
- https://x.ai/bot/marketplace/bots/last30days

## Product surfaces

### 1. Market

Index every public template and support search and filtering by category, creator, capability, integration, and evidence state.

The initial discovery labels are:

- **Featured by Grok Bot** — exact editorial placement.
- **Trending externally** — recent independent public references.
- **Observed use** — public evidence that independent users installed or used the template.
- **Repeated use** — evidence of continued use or a concrete outcome.
- **Clone Market activity** — first-party views, saves, clone attempts, successful imports, and later repeat use, only when available and collected with appropriate consent.

### 2. Template inspector

Show:

- source, creator, categories, and retrieval history;
- public memories, skills, routines, and integration requirements available at request time;
- observed-adoption evidence and confidence;
- source changes between snapshots;
- compatibility by target runtime; and
- redistribution or permission status.

### 3. Private clone flow

1. The user selects a template and target runtime.
2. Clone Market fetches the current public source on demand.
3. The importer normalizes the source into a versioned `BotTemplateManifest`.
4. The compatibility layer classifies each component as exact, compatible, partial, unavailable, or unsafe.
5. The user reviews the plan and approves generation.
6. A target adapter writes a versioned private import artifact through a caller-provided output sink.
7. Clone Market verifies the artifact before any consumer applies or activates it.

A future Botmancer integration may expose **Import from Grok Marketplace** and consume the verified artifact. That consumer UI and its persistence API belong to the Botmancer repository and do not block Clone Market V0.

## Complete coverage, progressive enrichment

Clone Market does not limit the catalog to a manually selected sample.

- Every publicly listed template enters the catalog when discovered.
- Every catalog item receives baseline metadata and source history.
- Evidence collection runs across the complete catalog.
- Enrichment depth grows progressively: templates with new mentions, source changes, weak identity matches, or user interest move to the front of the research queue.
- A small sample may validate a parser or evidence rubric, but never defines product coverage.

## Observed-adoption model

True Grok Bot usage is not publicly observable. Clone Market therefore stores evidence rather than presenting guessed usage.

### Evidence types

- `creator_promo`
- `shared_without_use`
- `trying_or_installed`
- `repeated_use`
- `concrete_outcome`
- `complaint_or_failure`

Creator promotion contributes to visibility, not independent adoption. Reposts and quote-post chains are deduplicated into evidence clusters.

### Evidence sources

- Exact Marketplace or import-link references on X
- Exact Bot name plus creator references
- Reddit, YouTube, blogs, newsletters, and GitHub
- Marketplace Featured placement
- Later, privacy-preserving Clone Market activity

### Public labels

Use transparent labels rather than one opaque score:

- **Observed use:** at least three independent usage reports, including at least one repeated-use or concrete-outcome report.
- **Emerging:** at least two independent usage reports or strong recent mention velocity.
- **Discussed:** multiple organic references without credible use evidence.
- **Listed:** only Marketplace presence or creator promotion.

Each label must open to the evidence rows that produced it.

## Core data objects

### `Template`

Marketplace identity, creator, source URLs, categories, first/last seen, Featured state, and allowed centrally stored metadata.

### `BotTemplateManifest`

A versioned normalization of the configuration fetched for one private import: identity, instructions when present, memories, skills, routines, integrations, source provenance, and unavailable fields.

### `Evidence`

Template, source URL, author, publication date, evidence type, claim, engagement snapshot, creator relationship, confidence, and collection date.

### `AdoptionSnapshot`

Dated derived counts and labels: unique mentions, independent usage reports, repeated-use reports, outcome reports, source breadth, velocity, and confidence.

## Reusable API boundaries

The ingestion and import primitives are reusable product infrastructure. Clone Market's catalog UI and Botmancer's import flow are consumers; neither owns the underlying contracts.

1. **Core contracts** define versioned, serializable `Template`, `BotTemplateManifest`, `Evidence`, `AdoptionSnapshot`, provenance, and compatibility types. Core has no network, storage, UI, Grok, or Botmancer dependency.
2. **Source adapters** implement a common interface for listing templates, fetching one current public template, and normalizing it into core contracts. Grok-specific parsing and schema-drift detection stay inside the Grok adapter.
3. **Catalog and evidence services** persist allowed metadata, source snapshots, evidence rows, and derived adoption labels through repository interfaces rather than source-specific storage calls.
4. **Compatibility planning** compares a manifest with declared target capabilities and returns a reviewable clone plan. It does not generate target files or execute imported instructions.
5. **Target adapters** preview a clone plan, apply it to a caller-provided artifact sink, and verify the resulting artifact for Botmancer, Agent Deck, or a coding agent. They do not require the consumer product to be installed or reachable. Target-specific generation never leaks into the manifest or source adapter.
6. **Product surfaces** compose these APIs. They may add transport layers such as CLI, HTTP, or UI, but reusable modules remain transport-neutral and callable independently.

Dependency direction is one way: product surfaces depend on target adapters and services; target adapters and services depend on core contracts; source adapters depend on core contracts. Source adapters and target adapters never depend on each other.

Every public contract carries a schema version and source provenance. Side-effecting operations are explicit, reviewable, and idempotent where retries are possible.

## V0

V0 proves the end-to-end contract, not merely scraping:

1. Ingest the complete current Marketplace index.
2. Fetch and normalize any public template detail page on demand.
3. Detect source-schema drift and fail visibly.
4. Display Featured placement and evidence-backed adoption labels without claiming private usage.
5. Produce a private Botmancers-compatible import preview and versioned artifact for one template.
6. Identify missing integrations, memories, routines, and target-runtime behavior.
7. Verify the generated artifact without executing imported instructions against real credentials.

Offline fixture acceptance covers items 1–7 against captured Marketplace HTML and an in-process Botmancers stub. Live Marketplace + local Botmancers proof is the operator sequence in `docs/acceptance-v0.md`.

### Remaining unsupported components and external uncertainties

- Skills, routines, and integrations that Botmancers marks unsupported remain unavailable omissions (not silently rewritten).
- Marketplace `installCount` remains all-zero in observed public payloads and is never used for adoption labels.
- Public Grok schema may drift without notice; drift fails visibly rather than guessing.
- Agent Deck and coding-agent targets are out of V0 scope.
- Live Botmancers API/UI availability and auth are external to Clone Market.

## Negative space

V0 will not:

- claim to know private Grok usage, installs, ratings, or retention;
- centrally mirror full third-party configurations;
- publish derived clones without creator permission;
- execute imported instructions before review;
- promise identical behavior across different models, tools, credentials, memories, or runtimes; or
- support every target runtime before the normalized manifest and first target-artifact path are proven.

## Open decisions

| Decision | Interim rule | Closing event |
| --- | --- | --- |
| Which source fields may be stored centrally? | Store source-linked catalog metadata; fetch full configuration only for a private, user-initiated import. | Terms and legal review of the proposed schema. |
| Manual research or X API for adoption evidence? | Begin with manually reviewed exact-link/name searches and preserve evidence rows. | Review precision, coverage, and cost after the first 100 evidence rows. |
| Source-specific or format-first package boundary? | Implement a versioned manifest plus a Grok adapter, even if they initially share one repository. | A second source adapter or first incompatible Grok schema change forces the seam. |
| First clone target? | A Botmancers-compatible artifact and local import path first; keep broader consumer hosting behind a separate boundary. | Offline V0 acceptance green; live operator proof recorded per `docs/acceptance-v0.md`. |

## Success measures

- Catalog coverage: percentage of current public Marketplace templates indexed.
- Freshness: time from Marketplace change to catalog update.
- Evidence coverage: percentage of templates with a current search and confidence stamp.
- Import clarity: percentage of components correctly classified before generation.
- Clone success: previews that produce a runnable private target.
- Repeat value: imported capabilities used again after initial verification, when consented telemetry exists.
