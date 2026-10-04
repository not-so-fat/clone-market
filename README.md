# Clone Market

Discover public agent templates, understand how they work, and privately clone the compatible parts into your own agent stack.

Clone Market begins with the public Grok Bot Marketplace and is designed around a reusable source-adapter and manifest layer so additional agent marketplaces can be supported later.

## Product

- [Product brief](docs/product-brief.md)
- [V0 acceptance runbook](docs/acceptance-v0.md)

## Development

Clone Market uses Node.js 22.5 or newer (for the built-in SQLite API), TypeScript 5, npm workspaces, and Vitest.

| Command | Purpose |
| --- | --- |
| `npm ci` | Reproduce the dependency tree from `package-lock.json`. |
| `npm run typecheck` | Build and type-check the core package and external consumer fixture. |
| `npm test` | Run contract, public-consumer, package-boundary, and offline V0 acceptance tests (network-free). |
| `npm run lint` | Check package boundaries and TypeScript source hygiene. |
| `npm run smoke:v0` | Opt-in offline V0 acceptance harness; writes a machine-readable report under `.temporal/logs/`. |
| `npm run smoke:v0:live` | **[operator]** Live Marketplace + local Botmancers acceptance; requires `CLONE_MARKET_ACCEPTANCE_LIVE=1`. |

The reusable contracts live in `@clone-market/core`. Product surfaces, source,
storage, and target implementations consume that package; they do not own
its transport-neutral contracts. The source-neutral index catalog and SQLite
adapter live in `@clone-market/catalog`. See [ADR 0001](docs/decisions/0001-package-graph.md).
Reviewed public signals, deduplication, and inspectable adoption-label derivation
live in `@clone-market/evidence`. The Next.js catalog, inspector, and reviewed
Botmancers clone flow live in `@clone-market/web`.

## Status

Foundation contracts, the Grok Marketplace source adapter, the central public
index catalog, reviewed public-evidence labels, the Botmancers target adapter,
and the Clone Market web surface are implemented. Offline V0 acceptance
(`npm run smoke:v0`) proves complete fixture-catalog reconciliation, evidence-backed
labels whose contributions are checked for `installCount` and private-usage signals,
preview → approve → apply → verify against an in-process Botmancers stub, replay of
the same operation id, and typed non-mutating failure paths (including Botmancers
unavailable at apply). Live smoke reads `CLONE_MARKET_EVIDENCE_DB` and writes
`CLONE_MARKET_CATALOG_DB` for the web UI; it is **[operator]**-only.

Live end-to-end proof against the current public Marketplace and a local Botmancers
instance remains an **[operator]** run (`docs/acceptance-v0.md`). Browser recordings
and UI captures are operator evidence, not part of the default offline suite.

### Remaining unsupported / uncertain

- Private Grok usage, installs, ratings, or retention claims
- Continuous automated X (or other) evidence collectors
- Agent Deck and coding-agent import targets
- Executing imported instructions against real credentials
- Multi-user hosting, billing, or analytics
- Marketplace schema stability (undocumented HTML/RSC surface may drift)
- Whether every public template remains importable when Botmancers capabilities change
- Botmancers package-root `npm test` / `npm run typecheck` unless `BOTMANCERS_ROOT` is set (Clone Market does not vendor that repository)
