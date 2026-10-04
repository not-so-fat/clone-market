# V0 acceptance runbook

Prove Clone Market against current external systems with one documented command sequence. Default verification stays network-free; live Marketplace and local Botmancers steps are tagged **[operator]** and require explicit opt-in.

## Prerequisites

| Mode | Requirements |
| --- | --- |
| Fixture (`npm run smoke:v0`) | Node.js ≥ 22.5, `npm ci` already done, no network |
| Live **[operator]** | Fixture prerequisites plus outbound access to the public Grok Marketplace, a local Botmancers API at `CLONE_MARKET_BOTMANCERS_BASE_URL`, Botmancers UI at `CLONE_MARKET_BOTMANCERS_UI_BASE_URL`, **existing** reviewed rows in `CLONE_MARKET_EVIDENCE_DB` for the chosen public template, and writable `CLONE_MARKET_CATALOG_DB` |

Environment variables (see `apps/web/.env.example`):

- `CLONE_MARKET_CATALOG_DB` / `CLONE_MARKET_EVIDENCE_DB` — SQLite paths. Live smoke **writes the catalog here and leaves it in place** for `next dev`. It **reads** the evidence database and fails if the file is missing or has no reviewed snapshot for the chosen template. Fixture smoke uses a temporary directory and deletes it.
- `CLONE_MARKET_GROK_BASE_URL` — Marketplace index/detail base (live only)
- `CLONE_MARKET_BOTMANCERS_BASE_URL` — Botmancers import API (live only)
- `CLONE_MARKET_BOTMANCERS_UI_BASE_URL` — return link after apply (`bots/<id>`)
- `CLONE_MARKET_ACCEPTANCE_TEMPLATE` — optional `provider:externalId` override (default fixture id: `grok-marketplace:bot-projects-manager-20261002`)
- `CLONE_MARKET_ACCEPTANCE_LIVE=1` — required to enable `--live`
- `BOTMANCERS_ROOT` + `CLONE_MARKET_ACCEPTANCE_PEER_REPOS=1` — optional **[agent]** run of the Botmancers checkout’s own `npm run typecheck` and `npm test`, plus source inspection for the `bots/<id>` UI route and `idempotency-key` handling

## Offline verification (both package roots) **[agent]**

From the Clone Market repository root:

```bash
npm run typecheck
npm test
npm run smoke:v0
```

`npm test` and `npm run smoke:v0` stay network-free. They reconcile the captured complete Marketplace fixture, seed public evidence for Projects Manager, exercise preview → approve → apply → verify against an in-process Botmancers stub, replay the same operation id, and assert failure paths (source drift, Botmancers unavailable at preview **and apply**, changed plan digest, idempotent retry). The machine-readable report is written under `.temporal/logs/`.

When a Botmancers checkout is available on this machine, run its root offline commands in that repository (observed `package.json` scripts on the Botmancers/OpenDots-style Node service):

```bash
export BOTMANCERS_ROOT=/absolute/path/to/botmancers
cd "$BOTMANCERS_ROOT"
npm run typecheck
npm test
```

Or from Clone Market, after those scripts exist at `BOTMANCERS_ROOT`:

```bash
CLONE_MARKET_ACCEPTANCE_PEER_REPOS=1 BOTMANCERS_ROOT=/absolute/path/to/botmancers npm run smoke:v0
```

The peer check greps that checkout for a `bots/` return route and `idempotency-key` handling. Clone Market does not vendor Botmancers; this sandbox cannot mark the peer check passed unless `BOTMANCERS_ROOT` points at a real checkout. The Clone Market UI return link is `CLONE_MARKET_BOTMANCERS_UI_BASE_URL` + `bots/<encodeURIComponent(botId)>` (`apps/web/src/botmancers-url.ts`, used by `CloneReview`).

## Operator live sequence **[operator]**

One command sequence for the exit predicate. Use the **same** catalog/evidence paths for smoke and for the web UI.

```bash
cp apps/web/.env.example apps/web/.env.local
# edit CLONE_MARKET_CATALOG_DB, CLONE_MARKET_EVIDENCE_DB (must already contain reviewed rows),
# Botmancers URLs, and optionally CLONE_MARKET_ACCEPTANCE_TEMPLATE

set -a && source apps/web/.env.local && set +a

# 1) Reconcile the live Marketplace into CLONE_MARKET_CATALOG_DB (observed count; never a hard-coded product limit).
#    Reads CLONE_MARKET_EVIDENCE_DB; does not seed fixture posts. Leaves both DBs on disk.
CLONE_MARKET_ACCEPTANCE_LIVE=1 npm run smoke:v0:live -- --template grok-marketplace:bot-projects-manager-20261002

# 2) Serve the web UI against those same databases and a reachable Botmancers instance
npm run build
npm run build:web
npm run dev --workspace=@clone-market/web
```

Then in a real browser (record desktop 1280px and mobile 390px):

1. Open the catalog; confirm the displayed total matches the reconciliation `source.count` and every indexed identity is reachable.
2. Open the chosen template inspector (`CLONE_MARKET_ACCEPTANCE_TEMPLATE`).
3. Open the adoption label; confirm dated evidence rows and rule contributions appear. Labels must not claim private usage or use the all-zero Marketplace `installCount`.
4. Preview → confirm creator permission → acknowledge omissions if shown → approve the digest → apply.
5. Confirm verification passed, note `operationId` and Botmancers bot id from the UI / acceptance report, follow **Open imported bot in Botmancers**, and confirm return to that bot (`…/bots/<id>`).
6. Retry apply with the same approved digest; confirm Botmancers does not create a duplicate bot (`target.replaySameBot` in the live report).

## Report fields

Each JSON report (`schemaVersion: 1.0.0`, `suite: v0-acceptance`) includes:

- `error` — typed `{ code, message }` on harness failure (always written to `--report` / the default `.temporal/logs/` path)
- `databases.catalogPath` / `evidencePath` / `retainedAfterRun`
- `source.retrievedAt` / `source.count` — observed retrieval time and Marketplace size
- `reconciliation.added|changed|removed|reappeared|unchanged` and `unexplainedOmissions` (must be `[]`)
- `template` provenance for the chosen public template
- `evidence` snapshot, contributions, and rows (`usesInstallCount` / `usesPrivateUsage` derived from contributions, snapshot text, and evidence engagement/types — the run fails if either is true)
- `compatibility.planDigest` and summary counts
- `approval` event (`approved`, `reviewedAt`, `planDigest`)
- `target.operationId`, `target.botmancersBotId`, `target.verification`, `target.returnUrl`, `target.replaySameBot`
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

Documented honestly in the product brief Status section. V0 does not claim private Grok popularity, continuous X collection, Agent Deck / coding-agent targets, credentialed instruction execution, or multi-user hosting. Botmancers root tests are proven only when `BOTMANCERS_ROOT` is configured; GitHub MCP in this builder deck lacked scopes to fetch that repository remotely.
