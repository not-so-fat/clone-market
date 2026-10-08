# Clone Market web

The Next.js app composes the repository's public package APIs into a trial home page, catalog, template inspector, reviewed private Botmancers clone flow, and read-only Agent Deck registration preview.

## Trial flows

A first-time user starts at `/`, which explains Clone Market in plain language and links to the [Grok Bot Marketplace](https://x.ai/bot/marketplace). Two equal entry paths converge on the same read-only **Would register** preview:

1. **Paste a URL** — submit a canonical `https://x.ai/bot/marketplace/bots/<slug>` link. The server resolves the slug to its catalog source identity, then opens `/templates/:provider/:externalId/agent-deck-preview`. Malformed URLs, unsupported hosts/paths, and valid but unknown bot URLs each return a distinct recoverable error without fetching a manifest.
2. **Search the marketplace** — search the complete indexed catalog by template name, creator, or summary (no result cap). Each result links to the same shared preview route as URL submission.

The preview fetches the current normalized manifest on demand, maps it through the pure `@clone-market/agent-deck-preview` package (outside UI and route code), and groups deterministic playbook and MCP-service candidates with source-component traceability, readiness, retrieved-at time, unavailable-field disclosure, and a link back to the original Grok template. The preview registers nothing and persists nothing.

Run locally with a configured catalog database:

```sh
npm run build
npm run dev --workspace=@clone-market/web
```

## Configuration

Copy `.env.example` and configure:

- `CLONE_MARKET_CATALOG_DB`: indexed catalog SQLite database.
- `CLONE_MARKET_EVIDENCE_DB`: public evidence SQLite database.
- `CLONE_MARKET_ARTIFACT_DIR`: directory for reviewed private Botmancers-compatible artifacts (default `./data/artifacts`).
- `CLONE_MARKET_GROK_BASE_URL`: Grok Marketplace source endpoint.
- `CLONE_MARKET_BOTMANCERS_BASE_URL`: optional Botmancers import API. Leave unset for V0 preview/export/offline verify (declared capabilities; no HTTP).
- `CLONE_MARKET_BOTMANCERS_UI_BASE_URL`: unused in V0 (Botmancers has no proven `bots/<id>` return page).

The central databases contain catalog metadata and public evidence only. Full source manifests are fetched on demand for each detail, preview, apply, or verification request. They are not written to SQLite, cookies, local storage, or session storage.

## Versioned HTTP surface

- `GET /api/v1/catalog`
- `GET /api/v1/catalog/search?q=...`
- `GET /api/v1/catalog/resolve?url=...`
- `GET /api/v1/templates/:provider/:externalId`
- `GET /api/v1/templates/:provider/:externalId/agent-deck-preview`
- `GET /api/v1/templates/:provider/:externalId/evidence`
- `POST /api/v1/templates/:provider/:externalId/clone/preview`
- `POST /api/v1/templates/:provider/:externalId/clone/export`
- `POST /api/v1/templates/:provider/:externalId/clone/verify-artifact`
- `POST /api/v1/templates/:provider/:externalId/clone/apply` (optional Botmancers HTTP apply; not the V0 path)
- `POST /api/v1/templates/:provider/:externalId/clone/verify` (optional Botmancers HTTP verify; not the V0 path)

Preview is side-effect free. Export requires `approved: true`, `planDigest`, and `reviewedAt` (the displayed plan's `createdAt`). A successful export writes `botmancers/import.json` to `CLONE_MARKET_ARTIFACT_DIR` and verifies that file against the reviewed plan without a Botmancers endpoint. Repeating the same approved inputs reuses one artifact identity. The server refetches and replans before export, and changed source or capability inputs force another review. Applying the file inside Botmancers is unsupported in V0.

## V0 acceptance

Machine-readable offline acceptance lives in `src/acceptance/` and is documented in [`docs/acceptance-v0.md`](../../docs/acceptance-v0.md).

- **[agent]** `npm run smoke:v0` from the repository root (network-free fixture + declared capabilities).
- **[operator]** `npm run smoke:v0:live` with `CLONE_MARKET_ACCEPTANCE_LIVE=1` (set by the script). Relative `CLONE_MARKET_CATALOG_DB` / `CLONE_MARKET_EVIDENCE_DB` / `CLONE_MARKET_ARTIFACT_DIR` paths resolve to the repository root so they match `next dev`. Import reviewed evidence, then `npm run evidence:derive` (or let live smoke derive missing snapshots). The catalog DB and artifact directory are retained for `next dev`.

## Operator browser checklist **[operator]**

Earlier files under `artifacts/not-351` were generated from a synthetic HTML renderer rather than the running Next.js app, so they were removed and must not be treated as acceptance evidence. An operator must run configured databases through `next dev` or `next start`, interact with the real `CloneReview` client component, and capture the rendered app at both widths.

At both 1280px and 390px widths:

- Confirm every indexed item is reachable and the displayed total matches the reconciliation report `source.count`.
- Confirm Featured is a separate badge from Listed, Discussed, Emerging, and Observed use.
- Confirm the page says labels describe public evidence and do not imply private use.
- Open each adoption label and confirm exact evidence rows and rule contributions appear.
- Inspect retrieval history, current public components, permission, and redistribution state.
- Preview a template containing an unsupported integration; confirm `unavailable` appears before approval.
- Confirm preview writes no artifact, unchecked approval cannot export, and a refreshed/changed digest forces review.
- Export the template and confirm the artifact digest plus offline verification result.
- Confirm the UI does not send operators to an unsupported Botmancers `bots/<id>` page.
- Open `/` at both widths: confirm the plain-language explanation, Grok Marketplace link, URL and search entry paths, and the secondary browse-all link to `/catalog`.
- Paste a valid public Grok Bot URL and confirm the shared “Would register” preview; repeat via marketplace search and confirm identical Playbooks and MCP services sections.
- Confirm malformed, unsupported, and unknown-bot URLs show distinct recoverable errors with no preview fetched.
- Confirm the preview registers nothing (copy says “would register”), shows provenance, retrieved-at time, unavailable fields, and a link back to the Grok template.
- Keyboard-walk both entry paths with no horizontal page overflow at 1280px and 390px.

Required operator evidence:

- [ ] Capture the running app at desktop width after checking visible label states.
- [ ] Capture the running app at 390px after checking visible label states.
- [ ] Record a real browser catalog → inspector → preview → export → verify run.
- [ ] Record that the permission and omission acknowledgements gate the export button.
- [ ] Record that unsupported integrations appear as unavailable before approval.
- [ ] Record the export identity, artifact digest, and offline verification from the real client component.
- [ ] Live Grok connectivity remains deployment-environment evidence. Applying the artifact inside Botmancers is not required for V0.
