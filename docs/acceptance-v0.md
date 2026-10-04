# V0 acceptance runbook

Prove Clone Market against current external systems with one documented command sequence. Default verification stays network-free; live Marketplace and local Botmancers steps are tagged **[operator]** and require explicit opt-in.

## Prerequisites

| Mode | Requirements |
| --- | --- |
| Fixture (`npm run smoke:v0`) | Node.js ≥ 22.5, `npm ci` already done, no network |
| Live **[operator]** | Fixture prerequisites plus outbound access to the public Grok Marketplace, a local Botmancers API at `CLONE_MARKET_BOTMANCERS_BASE_URL`, Botmancers UI at `CLONE_MARKET_BOTMANCERS_UI_BASE_URL`, **reviewed evidence rows** in `CLONE_MARKET_EVIDENCE_DB` for templates that display labels, and writable `CLONE_MARKET_CATALOG_DB` |

Environment variables (see `apps/web/.env.example`):

- `CLONE_MARKET_CATALOG_DB` / `CLONE_MARKET_EVIDENCE_DB` — SQLite paths. **Relative paths resolve against the Clone Market repository root**, not the Next.js cwd, so `npm run smoke:v0:live` and `npm run dev --workspace=@clone-market/web` share one file. Prefer absolute paths. Live smoke **writes the catalog here and leaves it in place** for `next dev`. It opens the evidence database for read/write so it can derive missing adoption snapshots; it fails if the file is missing or the chosen template has no reviewed rows. Fixture smoke uses a temporary directory and deletes it.
- `CLONE_MARKET_GROK_BASE_URL` — Marketplace index/detail base (live only)
- `CLONE_MARKET_BOTMANCERS_BASE_URL` — **local** Botmancers import API (live only). Replay asserts bot count via `GET v1/imports` or `GET api/bots`. `apps/web/.env.example` defaults to `http://127.0.0.1:8787/` so `cp .env.example .env.local` does not target `https://api.botmancers.com/`.
- `CLONE_MARKET_BOTMANCERS_UI_BASE_URL` — return link after apply (`bots/<id>`)
- `CLONE_MARKET_ACCEPTANCE_TEMPLATE` — optional `provider:externalId` override (default fixture id: `grok-marketplace:bot-projects-manager-20261002`)
- `CLONE_MARKET_ACCEPTANCE_LIVE=1` — enables live mode (required; `smoke:v0:live` sets this). `--live` is forwarded after a vite-node `--` so it is not swallowed.
- `BOTMANCERS_ROOT` + `CLONE_MARKET_ACCEPTANCE_PEER_REPOS=1` — optional **[agent]** run of the Botmancers checkout’s `npm run lint`, `npm run typecheck` / `tsc --noEmit`, and `npm test` when those scripts exist, plus source inspection for a UI `app/bots/[id]` (or `pages/bots/[id]`) page and import operation identity (`idempotency-key` / `operation_id`). API-only `app/api/bots` routes do not count as the return page. An executed lint/typecheck that exits nonzero is `failed` when `node_modules` is present, or `unverified` when dependencies are missing — never `passed`.

## Offline verification (both package roots) **[agent]**

From the Clone Market repository root:

```bash
npm run typecheck
npm test
npm run smoke:v0
```

`npm test` and `npm run smoke:v0` stay network-free. They reconcile the captured complete Marketplace fixture, seed public evidence for Projects Manager, exercise preview → approve → apply → verify against an in-process Botmancers stub, replay the same operation id (including a Botmancers list-bot count), and assert failure paths (source drift, Botmancers unavailable at preview **and apply**, changed plan digest, idempotent retry). The machine-readable report is written under `.temporal/logs/`.

When a Botmancers checkout is available on this machine, install **that** repository’s dependencies first (Clone Market’s default `npm test` does not do this):

```bash
export BOTMANCERS_ROOT=/absolute/path/to/botmancers
cd "$BOTMANCERS_ROOT"
npm ci
# not-so-fat/botmancers has lint, no typecheck script, and no npm test
# (test:acceptance is live-gated — do not run it from Clone Market CI).
npm run lint
npx --no-install tsc --noEmit -p .
```

Or from Clone Market (records lint/tsc output on `peerRepositories.botmancers`):

```bash
CLONE_MARKET_ACCEPTANCE_PEER_REPOS=1 BOTMANCERS_ROOT=/absolute/path/to/botmancers npm run smoke:v0
```

The peer check records command output in `peerRepositories.botmancers`. Clone Market does not vendor Botmancers. The Clone Market UI return link is `CLONE_MARKET_BOTMANCERS_UI_BASE_URL` + `bots/<encodeURIComponent(botId)>` (`apps/web/src/botmancers-url.ts`, used by `CloneReview`).

Observed **2026-10-04** against GitHub `not-so-fat/botmancers` `main` after `npm ci` in a throwaway checkout (not vendored; not committed):

- `npm run lint` exited **1** (eslint `react-hooks/immutability` errors in `app/page.tsx`).
- `npx tsc --noEmit -p .` exited **2** (`app/layout.tsx`: `Cannot find name 'LayoutProps'`).
- There is **no** UI route `app/bots/[id]/page.tsx` (only `app/api/bots` and a home SPA on `/`).
- There is **no** `npm test` / `typecheck` script and **no GitHub Actions** workflows. `test:acceptance` is live-gated and was not run.

The opt-in peer check therefore reports `status: failed` (executed lint/tsc plus missing UI return page). Default `npm run smoke:v0` leaves this check `skipped` so Clone Market CI stays network-free.

## Operator live sequence **[operator]**

One command sequence for the exit predicate. Use the **same** catalog/evidence paths for smoke and for the web UI (repository-root-relative or absolute).

```bash
cp apps/web/.env.example apps/web/.env.local
# Prefer absolute CLONE_MARKET_CATALOG_DB / CLONE_MARKET_EVIDENCE_DB.
# Evidence DB must already contain reviewed rows for displayed labels.
# Confirm CLONE_MARKET_BOTMANCERS_BASE_URL is the local API, not api.botmancers.com.

set -a && source apps/web/.env.local && set +a

# Derive an adoption snapshot if import left only reviewed rows (also done by live smoke).
npm run evidence:derive -- --database "$CLONE_MARKET_EVIDENCE_DB" --template-id grok-marketplace:bot-projects-manager-20261002

# 1) Reconcile the live Marketplace into CLONE_MARKET_CATALOG_DB (observed count; never a hard-coded product limit).
#    vite-node receives flags after `--`. CLONE_MARKET_ACCEPTANCE_LIVE=1 alone also selects live mode.
npm run smoke:v0:live -- --template grok-marketplace:bot-projects-manager-20261002

# 2) Serve the web UI against those same databases and a reachable Botmancers instance
npm run build
npm run build:web
npm run dev --workspace=@clone-market/web
```

Then in a real browser (record desktop 1280px and mobile 390px):

1. Open the catalog; confirm the displayed total matches the reconciliation `source.count` and every indexed identity is reachable.
2. Open the chosen template inspector (`CLONE_MARKET_ACCEPTANCE_TEMPLATE`).
3. Open **each displayed adoption label**; confirm dated evidence rows and rule contributions appear. Labels must not claim private usage or use the all-zero Marketplace `installCount`.
4. Preview → confirm creator permission → acknowledge omissions if shown → approve the digest → apply.
5. Confirm verification passed, note `operationId` and Botmancers bot id from the UI / acceptance report, follow **Open imported bot in Botmancers**, and confirm return to that bot (`…/bots/<id>`).
6. Retry apply with the same approved digest; confirm Botmancers does not create a duplicate bot (`target.replaySameBot` and `target.replayBotCount` in the live report).

## Report fields

Each JSON report (`schemaVersion: 1.0.0`, `suite: v0-acceptance`) includes:

- `error` — typed `{ code, message }` on harness failure (always written to `--report` / the default `.temporal/logs/` path)
- `databases.catalogPath` / `evidencePath` / `retainedAfterRun` (absolute after root resolution)
- `source.retrievedAt` / `source.count` — observed retrieval time and Marketplace size
- `reconciliation.added|changed|removed|reappeared|unchanged` and `unexplainedOmissions` (must be `[]`)
- `template` provenance for the chosen public template
- `evidence` snapshot, contributions, and rows (`usesInstallCount` / `usesPrivateUsage` derived from contributions, snapshot text, and evidence engagement/types — the run fails if **any displayed catalog label** uses either)
- `compatibility.planDigest` and summary counts
- `approval` event (`approved`, `reviewedAt`, `planDigest`)
- `target.operationId`, `target.botmancersBotId`, `target.verification`, `target.returnUrl`, `target.replaySameBot`, `target.replayBotCount`
- `failureCases[]` for injected non-mutating failures (nonzero exit when any fail)
- `peerRepositories.botmancers` — skipped unless peer verification is opted in
- `browser.status` — `operator_required` until a browser recording is attached by an operator

## Failure-path coverage **[agent]**

Injected inside `npm run smoke:v0` (fixture Botmancers / fixture source):

| Case | Expected |
| --- | --- |
| `source_schema_drift` | HTTP 503, `source_drift`, no Botmancers POST |
| `botmancers_unavailable` | HTTP 503, `target_unavailable` on **preview**, zero bots |
| `botmancers_unavailable_apply` | HTTP 503, `target_unavailable` on **apply** after a successful preview, zero bots |
| `changed_plan_after_preview` | HTTP 409, `stale_plan`, zero bots |
| `idempotent_retry` | second apply reuses the same operation id / bot id |

Live failures (missing DBs, missing reviewed evidence, source drift, Botmancers down, duplicate bot) write the same JSON schema with `status: failed`, `exitCode: 1`, and `error.code`.

## Remaining unsupported / uncertain

Documented honestly in the product brief Status section. V0 does not claim private Grok popularity, continuous X collection, Agent Deck / coding-agent targets, credentialed instruction execution, or multi-user hosting. Botmancers has no GitHub Actions CI on `not-so-fat/botmancers` as of 2026-10-04; peer verification is opt-in via `BOTMANCERS_ROOT`. Installed-peer `lint` and `tsc --noEmit` on that `main` currently fail; Clone Market records `failed` / `unverified` rather than treating a failed typecheck as `passed`. The Botmancers UI is a home SPA (`/`), not a `bots/<id>` page.
