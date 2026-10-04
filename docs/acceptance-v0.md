# V0 acceptance runbook

Prove Clone Market against current external systems with one documented command sequence. Default verification stays network-free; live Marketplace and local Botmancers steps are tagged **[operator]** and require explicit opt-in.

## Prerequisites

| Mode | Requirements |
| --- | --- |
| Fixture (`npm run smoke:v0`) | Node.js ≥ 22.5, `npm ci` already done, no network |
| Live **[operator]** | Fixture prerequisites plus outbound access to the public Grok Marketplace, a local Botmancers API at `CLONE_MARKET_BOTMANCERS_BASE_URL`, Botmancers UI at `CLONE_MARKET_BOTMANCERS_UI_BASE_URL`, and reviewed evidence rows for the chosen public template |

Environment variables (see `apps/web/.env.example`):

- `CLONE_MARKET_CATALOG_DB` / `CLONE_MARKET_EVIDENCE_DB` — SQLite paths for the web app
- `CLONE_MARKET_GROK_BASE_URL` — Marketplace index/detail base (live only)
- `CLONE_MARKET_BOTMANCERS_BASE_URL` — Botmancers import API (live only)
- `CLONE_MARKET_BOTMANCERS_UI_BASE_URL` — return link after apply
- `CLONE_MARKET_ACCEPTANCE_LIVE=1` — required to enable `--live`

## Offline verification (both package roots) **[agent]**

From the Clone Market repository root:

```bash
npm run typecheck
npm test
npm run smoke:v0
```

`npm test` and `npm run smoke:v0` stay network-free. They reconcile the captured complete Marketplace fixture, seed public evidence for Projects Manager, exercise preview → approve → apply → verify against an in-process Botmancers stub, and assert failure paths (source drift, Botmancers unavailable, changed plan digest, idempotent retry). The machine-readable report is written under `.temporal/logs/`.

When a local Botmancers checkout is available, run that repository’s own offline verification command as documented there. Clone Market does not vendor Botmancers.

## Operator live sequence **[operator]**

One command sequence for the exit predicate:

```bash
# 1) Seed / refresh local DBs from the live Marketplace index (observed count; never a hard-coded product limit)
CLONE_MARKET_ACCEPTANCE_LIVE=1 \
  CLONE_MARKET_BOTMANCERS_BASE_URL=http://127.0.0.1:8787/ \
  CLONE_MARKET_BOTMANCERS_UI_BASE_URL=http://127.0.0.1:3100/ \
  npm run smoke:v0:live

# 2) Serve the web UI against those databases and a reachable Botmancers instance
cp apps/web/.env.example apps/web/.env.local   # edit paths/URLs
npm run build
npm run build:web
npm run dev --workspace=@clone-market/web
```

Then in a real browser (record desktop 1280px and mobile 390px):

1. Open the catalog; confirm the displayed total matches the reconciliation `source.count` and every indexed identity is reachable.
2. Open the Projects Manager inspector (`grok-marketplace` / `bot-projects-manager-20261002` while that public template remains listed).
3. Open the adoption label; confirm dated evidence rows and rule contributions appear. Labels must not claim private usage or use the all-zero Marketplace `installCount`.
4. Preview → confirm creator permission → acknowledge omissions if shown → approve the digest → apply.
5. Confirm verification passed, note `operationId` and Botmancers bot id from the UI / acceptance report, follow **Open imported bot in Botmancers**, and confirm return to that bot.
6. Retry apply with the same approved digest; confirm Botmancers does not create a duplicate bot.

## Report fields

Each JSON report (`schemaVersion: 1.0.0`, `suite: v0-acceptance`) includes:

- `source.retrievedAt` / `source.count` — observed retrieval time and Marketplace size
- `reconciliation.added|changed|removed|reappeared|unchanged` and `unexplainedOmissions` (must be `[]`)
- `template` provenance for the chosen public template
- `evidence` snapshot, contributions, and rows (`usesInstallCount` / `usesPrivateUsage` always `false`)
- `compatibility.planDigest` and summary counts
- `approval` event (`approved`, `reviewedAt`, `planDigest`)
- `target.operationId`, `target.botmancersBotId`, `target.verification`, `target.returnUrl`
- `failureCases[]` for injected non-mutating failures (nonzero exit when any fail)
- `browser.status` — `operator_required` until a browser recording is attached by an operator

## Failure-path coverage **[agent]**

Injected inside `npm run smoke:v0` (fixture Botmancers / fixture source):

| Case | Expected |
| --- | --- |
| `source_schema_drift` | HTTP 503, `source_drift`, no Botmancers POST |
| `botmancers_unavailable` | HTTP 503, `target_unavailable`, zero bots |
| `changed_plan_after_preview` | HTTP 409, `stale_plan`, zero bots |
| `idempotent_retry` | second apply reuses the same operation id / bot id |

## Remaining unsupported / uncertain

Documented honestly in the product brief Status section. V0 does not claim private Grok popularity, continuous X collection, Agent Deck / coding-agent targets, credentialed instruction execution, or multi-user hosting.
