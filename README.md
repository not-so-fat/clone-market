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
| `npm run demo` | One-command fixture-backed browser demo (network-free after `npm ci`). |
| `npm run typecheck` | Build and type-check the core package and external consumer fixture. |
| `npm test` | Run contract, public-consumer, package-boundary, and offline V0 acceptance tests (network-free). |
| `npm run lint` | Check package boundaries and TypeScript source hygiene. |
| `npm run smoke:v0` | Opt-in offline V0 acceptance harness; writes a machine-readable report under `.temporal/logs/`. |
| `npm run smoke:v0:live` | **[operator]** Live Marketplace + local artifact export; requires `CLONE_MARKET_ACCEPTANCE_LIVE=1`. Relative DB paths resolve against the repo root. |
| `npm run evidence:derive` | Write an adoption snapshot into `CLONE_MARKET_EVIDENCE_DB` from reviewed rows (`--database` `--template-id`). |

The reusable contracts live in `@clone-market/core`. Product surfaces, source,
storage, and target implementations consume that package; they do not own
its transport-neutral contracts. The source-neutral index catalog and SQLite
adapter live in `@clone-market/catalog`. See [ADR 0001](docs/decisions/0001-package-graph.md).
Reviewed public signals, deduplication, and inspectable adoption-label derivation
live in `@clone-market/evidence`. The Next.js catalog, inspector, and reviewed
Botmancers clone flow live in `@clone-market/web`.

## Demo

From a clean checkout with dependencies installed, one command launches a
working browser demo of the URL/search → “Would register” trial flow:

```sh
npm ci
npm run demo
```

The launcher rebuilds workspace packages from the current checkout, seeds an
isolated fixture catalog and reviewed-evidence database under `.temporal/demo/`,
serves the captured Grok fixtures from a local source (no external network),
and starts the web app on an isolated Next.js cache. When ready it prints the
browser URL plus the sample inputs:

```text
Clone Market demo is ready.
Browser URL: http://127.0.0.1:3100/
Sample Grok URL: https://x.ai/bot/marketplace/bots/projects-manager
Sample search query: Projects Manager
This demo is read-only; registers nothing.
Press Ctrl-C to stop.
```

Paste the sample URL or search the sample query: both entry paths render the
same populated “Would register” preview. The server stays in the foreground;
Ctrl-C stops the fixture source and web app and releases both ports.

Notes:

- Deterministic and network-free after `npm ci`. Reruns reuse the same demo
  directory idempotently (upsert; nothing is duplicated).
- Read-only: the preview registers nothing in Agent Deck or elsewhere.
- Fixture-backed: catalog provenance and “Original Grok template” links point
  at the local fixture source, and fixture results do not prove the current
  live Grok Marketplace contract.
- Isolated: the demo never reads or writes `apps/web/.env.local`,
  `data/catalog.sqlite`, `data/evidence.sqlite`, operator artifact
  directories, or the normal `.next` cache. All demo state stays under
  `.temporal/demo/` (plus the `apps/web/.next-demo` cache).
- Ports default to 3100 (web) and 3101 (fixture source); override with
  `--port`, `--fixture-port`, `--demo-dir`, or the `CLONE_MARKET_DEMO_PORT` /
  `CLONE_MARKET_DEMO_FIXTURE_PORT` / `CLONE_MARKET_DEMO_DIR` variables.
  Occupied ports, Node below 22.5, missing dependencies, and seed failures
  exit before launching with a one-line fix.

The live/operator acceptance sequence (`npm run smoke:v0:live` plus a
configured `next dev`) remains a separate path; see
[V0 acceptance runbook](docs/acceptance-v0.md).

## Status

Foundation contracts, the Grok Marketplace source adapter, the central public
index catalog, reviewed public-evidence labels, the Botmancers target adapter,
and the Clone Market web surface are implemented. Offline V0 acceptance
(`npm run smoke:v0`) proves complete fixture-catalog reconciliation, evidence-backed
labels whose contributions are checked for `installCount` and private-usage signals,
preview → approve → export → offline artifact verify against a file/memory sink
(declared Botmancers capabilities; no Botmancers HTTP), replay of the same artifact
identity and digest, and typed non-mutating failure paths (source drift, unavailable
artifact sink, changed plan digest, tampered artifact, idempotent retry). Live smoke
reads `CLONE_MARKET_EVIDENCE_DB` (and derives missing snapshots) and writes
`CLONE_MARKET_CATALOG_DB` for the web UI; relative paths resolve to the repository root
so they match `next dev`. Live mode is **[operator]**-only.

Live end-to-end proof against the current public Marketplace remains an **[operator]**
run (`docs/acceptance-v0.md`). A local Botmancers process is not required. Browser
recordings and UI captures are operator evidence, not part of the default offline suite.

### Remaining unsupported / uncertain

- Private Grok usage, installs, ratings, or retention claims
- Continuous automated X (or other) evidence collectors
- Agent Deck and coding-agent import targets
- Executing imported instructions against real credentials
- Multi-user hosting, billing, or analytics
- Marketplace schema stability (undocumented HTML/RSC surface may drift)
- Whether every public template remains importable when Botmancers capabilities change
- Botmancers package-root `npm run lint` / `tsc --noEmit` unless `BOTMANCERS_ROOT` is set (Clone Market does not vendor that repository). `not-so-fat/botmancers` currently has no GitHub Actions CI, no `npm test` script, no `app/bots/[id]` UI page, and installed `lint`/`tsc` on 2026-10-04 `main` exit nonzero — Clone Market records that as `failed`/`unverified`, never a false `passed`
