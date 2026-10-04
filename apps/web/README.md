# Clone Market web

The Next.js app composes the repository's public package APIs into a catalog, template inspector, and reviewed private Botmancers clone flow.

## Configuration

Copy `.env.example` and configure:

- `CLONE_MARKET_CATALOG_DB`: indexed catalog SQLite database.
- `CLONE_MARKET_EVIDENCE_DB`: public evidence SQLite database.
- `CLONE_MARKET_GROK_BASE_URL`: Grok Marketplace source endpoint.
- `CLONE_MARKET_BOTMANCERS_BASE_URL`: Botmancers API endpoint.
- `CLONE_MARKET_BOTMANCERS_UI_BASE_URL`: Botmancers UI base used for the post-apply return link.

The central databases contain catalog metadata and public evidence only. Full source manifests are fetched on demand for each detail, preview, apply, or verification request. They are not written to SQLite, cookies, local storage, or session storage.

## Versioned HTTP surface

- `GET /api/v1/catalog`
- `GET /api/v1/templates/:provider/:externalId`
- `GET /api/v1/templates/:provider/:externalId/evidence`
- `POST /api/v1/templates/:provider/:externalId/clone/preview`
- `POST /api/v1/templates/:provider/:externalId/clone/apply`
- `POST /api/v1/templates/:provider/:externalId/clone/verify`

Preview is side-effect free. Apply requires `approved: true`, `planDigest`, and `reviewedAt` (the displayed plan's `createdAt`). A successful apply verifies the created clone in the same request and returns either the verification result or a verification-only error; the UI never invites a second apply after creation. After a successful apply the UI offers **Open imported bot in Botmancers** using `CLONE_MARKET_BOTMANCERS_UI_BASE_URL`. The standalone verification route requires the same review identity plus `targetReference` and remains available while that reviewed source is current. The server refetches and replans before apply, and changed source or target inputs force another review before any import.

## V0 acceptance

Machine-readable offline acceptance lives in `src/acceptance/` and is documented in [`docs/acceptance-v0.md`](../../docs/acceptance-v0.md).

- **[agent]** `npm run smoke:v0` from the repository root (network-free fixture + stub).
- **[operator]** `CLONE_MARKET_ACCEPTANCE_LIVE=1 npm run smoke:v0:live` plus the browser checklist below.

## Operator browser checklist **[operator]**

Earlier files under `artifacts/not-351` were generated from a synthetic HTML renderer rather than the running Next.js app, so they were removed and must not be treated as acceptance evidence. An operator must run configured databases and a reachable Botmancers instance through `next dev` or `next start`, interact with the real `CloneReview` client component, and capture the rendered app at both widths.

At both 1280px and 390px widths:

- Confirm every indexed item is reachable and the displayed total matches the reconciliation report `source.count`.
- Confirm Featured is a separate badge from Listed, Discussed, Emerging, and Observed use.
- Confirm the page says labels describe public evidence and do not imply private use.
- Open each adoption label and confirm exact evidence rows and rule contributions appear.
- Inspect retrieval history, current public components, permission, and redistribution state.
- Preview a template containing an unsupported integration; confirm `unavailable` appears before approval.
- Confirm preview causes no Botmancers import, unchecked approval cannot apply, and a refreshed/changed digest forces review.
- Apply the template and confirm the verification result, Botmancers bot id, and **Open imported bot in Botmancers** return link.
- Simulate source drift and a Botmancers failure; confirm a recoverable error appears and no clone is created or activated.

Required operator evidence:

- [ ] Capture the running app at desktop width after checking visible label states.
- [ ] Capture the running app at 390px after checking visible label states.
- [ ] Record a real browser catalog → inspector → preview → apply → verify run.
- [ ] Record that the permission and omission acknowledgements gate the apply button.
- [ ] Record that unsupported integrations appear as unavailable before approval.
- [ ] Record the apply result, verification, and Botmancers return from the real client component.
- [ ] Live Grok and Botmancers connectivity remains deployment-environment evidence.
