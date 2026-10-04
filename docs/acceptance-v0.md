# V0 acceptance runbook

Prove Clone Market against current external systems with one documented command sequence. Default verification stays network-free; live Marketplace steps are tagged **[operator]** and require explicit opt-in. Applying a verified artifact inside Botmancers is out of V0 scope.

## Prerequisites

| Mode | Requirements |
| --- | --- |
| Fixture (`npm run smoke:v0`) | Node.js ≥ 22.5, `npm ci` already done, no network |
| Live **[operator]** | Fixture prerequisites plus outbound access to the public Grok Marketplace, **reviewed evidence rows** in `CLONE_MARKET_EVIDENCE_DB` for templates that display labels, writable `CLONE_MARKET_CATALOG_DB`, and writable `CLONE_MARKET_ARTIFACT_DIR` |

Environment variables (see `apps/web/.env.example`):

- `CLONE_MARKET_CATALOG_DB` / `CLONE_MARKET_EVIDENCE_DB` — SQLite paths. **Relative paths resolve against the Clone Market repository root**, not the Next.js cwd, so `npm run smoke:v0:live` and `npm run dev --workspace=@clone-market/web` share one file. Prefer absolute paths. Live smoke **writes the catalog here and leaves it in place** for `next dev`. It opens the evidence database for read/write so it can derive missing adoption snapshots; it fails if the file is missing or the chosen template has no reviewed rows. Fixture smoke uses a temporary directory and deletes it.
- `CLONE_MARKET_ARTIFACT_DIR` — directory sink for reviewed `botmancers/import.json` artifacts (default `./data/artifacts`). Live smoke retains files here; fixture smoke uses a temp directory.
- `CLONE_MARKET_GROK_BASE_URL` — Marketplace index/detail base (live only)
- `CLONE_MARKET_BOTMANCERS_BASE_URL` / `CLONE_MARKET_BOTMANCERS_UI_BASE_URL` — optional consumer endpoints. V0 export and offline verification do **not** call them. `apps/web/.env.example` still defaults the API to `http://127.0.0.1:8787/` so a copied env file does not target `https://api.botmancers.com/`.
- `CLONE_MARKET_ACCEPTANCE_TEMPLATE` — optional `provider:externalId` override (default fixture id: `grok-marketplace:bot-projects-manager-20261002`)
- `CLONE_MARKET_ACCEPTANCE_LIVE=1` — enables live mode (required; `smoke:v0:live` sets this). `--live` is forwarded after a vite-node `--` so it is not swallowed.
- `BOTMANCERS_ROOT` + `CLONE_MARKET_ACCEPTANCE_PEER_REPOS=1` — **outside V0 acceptance**. Optional checkout inspection; connecting to or launching Botmancers is a V0 non-goal.

## Offline verification (Clone Market root) **[agent]**

From the Clone Market repository root:

```bash
npm run typecheck
npm test
npm run smoke:v0
```

`npm test` and `npm run smoke:v0` stay network-free. They reconcile the captured complete Marketplace fixture, seed public evidence for Projects Manager, exercise preview → approve → **export** → **offline artifact verify** against a file/memory sink (declared Botmancers capabilities; no Botmancers HTTP), replay the same artifact identity and digest, and assert failure paths (source drift, unavailable artifact sink, changed plan digest, tampered artifact, idempotent retry). The machine-readable report is written under `.temporal/logs/`.

Peer Botmancers `npm` scripts are not part of this sequence.

## Operator live sequence **[operator]**

One command sequence for the exit predicate. Use the **same** catalog/evidence/artifact paths for smoke and for the web UI (repository-root-relative or absolute). A local Botmancers process is **not** required.

```bash
cp apps/web/.env.example apps/web/.env.local
# Prefer absolute CLONE_MARKET_CATALOG_DB / CLONE_MARKET_EVIDENCE_DB / CLONE_MARKET_ARTIFACT_DIR.
# Evidence DB must already contain reviewed rows for displayed labels.

set -a && source apps/web/.env.local && set +a

# Derive an adoption snapshot if import left only reviewed rows (also done by live smoke).
npm run evidence:derive -- --database "$CLONE_MARKET_EVIDENCE_DB" --template-id grok-marketplace:bot-projects-manager-20261002

# 1) Reconcile the live Marketplace into CLONE_MARKET_CATALOG_DB (observed count; never a hard-coded product limit).
#    vite-node receives flags after `--`. CLONE_MARKET_ACCEPTANCE_LIVE=1 alone also selects live mode.
npm run smoke:v0:live -- --template grok-marketplace:bot-projects-manager-20261002

# 2) Serve the web UI against those same databases
npm run build
npm run build:web
npm run dev --workspace=@clone-market/web
```

Then in a real browser (record desktop 1280px and mobile 390px):

1. Open the catalog; confirm the displayed total matches the reconciliation `source.count` and every indexed identity is reachable.
2. Open the chosen template inspector (`CLONE_MARKET_ACCEPTANCE_TEMPLATE`).
3. Open **each displayed adoption label**; confirm dated evidence rows and rule contributions appear. Labels must not claim private usage or use the all-zero Marketplace `installCount`.
4. Preview → confirm creator permission → acknowledge omissions if shown → approve the digest → **export private artifact**.
5. Confirm offline verification passed and note `artifact.identity` plus `artifact.digest` from the UI / acceptance report. Do not expect a Botmancers `bots/<id>` return page; that route is unsupported.
6. Retry export with the same approved digest; confirm the sink does not create a second identity (`artifact.replaySameDigest` and `artifact.replayDuplicate` in the report).

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
- `artifact.identity`, `artifact.path`, `artifact.digest`, `artifact.verification`, `artifact.replaySameDigest`, `artifact.replayDuplicate`
- `failureCases[]` for injected non-mutating failures (nonzero exit when any fail)
- `peerRepositories.botmancers` — skipped unless peer verification is opted in (**outside V0**)
- `browser.status` — `operator_required` until a browser recording is attached by an operator

## Failure-path coverage **[agent]**

Injected inside `npm run smoke:v0` (fixture source + artifact sink):

| Case | Expected |
| --- | --- |
| `source_schema_drift` | HTTP 503, `source_drift`, no artifact written |
| `artifact_sink_unavailable` | HTTP 503, `sink_unavailable` on **export**, empty sink |
| `changed_plan_after_preview` | HTTP 409, `stale_plan`, empty sink |
| `tampered_artifact` | verification `failed` with `artifact-digest` / `artifact-content`; no accepted artifact |
| `idempotent_retry` | second export reuses the same identity and digest (`created: false`) |

Live failures (missing DBs, missing reviewed evidence, source drift, unavailable sink, tampered artifact) write the same JSON schema with `status: failed`, `exitCode: 1`, and `error.code` or a failed `failureCases` entry.

## Remaining unsupported / uncertain

Documented honestly in the product brief Status section. V0 does not claim private Grok popularity, continuous X collection, Agent Deck / coding-agent targets, credentialed instruction execution, multi-user hosting, or applying the artifact inside Botmancers. Botmancers has no `app/bots/[id]` page on `not-so-fat/botmancers` as of 2026-10-04; Clone Market does not offer a return link to that route. Peer verification of a Botmancers checkout is outside V0.
