# Clone Market web

The Next.js app composes the repository's public package APIs into a catalog, template inspector, and reviewed private Botmancers clone flow.

## Configuration

Copy `.env.example` and configure:

- `CLONE_MARKET_CATALOG_DB`: indexed catalog SQLite database.
- `CLONE_MARKET_EVIDENCE_DB`: public evidence SQLite database.
- `CLONE_MARKET_GROK_BASE_URL`: Grok Marketplace source endpoint.
- `CLONE_MARKET_BOTMANCERS_BASE_URL`: Botmancers API endpoint.

The central databases contain catalog metadata and public evidence only. Full source manifests are fetched on demand for each detail, preview, apply, or verification request. They are not written to SQLite, cookies, local storage, or session storage.

## Versioned HTTP surface

- `GET /api/v1/catalog`
- `GET /api/v1/templates/:provider/:externalId`
- `GET /api/v1/templates/:provider/:externalId/evidence`
- `POST /api/v1/templates/:provider/:externalId/clone/preview`
- `POST /api/v1/templates/:provider/:externalId/clone/apply`
- `POST /api/v1/templates/:provider/:externalId/clone/verify`

Preview is side-effect free. Apply requires `approved: true`, `planDigest`, and `reviewedAt` (the displayed plan's `createdAt`). A successful apply verifies the created clone in the same request and returns either the verification result or a verification-only error; the UI never invites a second apply after creation. The standalone verification route requires the same review identity plus `targetReference` and remains available while that reviewed source is current. The server refetches and replans before apply, and changed source or target inputs force another review before any import.

## Operator checklist

The browser-only evidence below is intentionally pending. Earlier files under
`artifacts/not-351` were generated from a synthetic HTML renderer rather than
the running Next.js app, so they were removed and must not be treated as
acceptance evidence. An operator must run the configured fixture databases and
Botmancers stub through `next dev` or `next start`, interact with the real
`CloneReview` client component, and capture the rendered app at both widths.

At both 1280px and 390px widths:

- Confirm every indexed item is reachable and the displayed total matches the database.
- Confirm Featured is a separate badge from Listed, Discussed, Emerging, and Observed use.
- Confirm the page says labels describe public evidence and do not imply private use.
- Open each adoption label and confirm exact evidence rows and rule contributions appear.
- Inspect retrieval history, current public components, permission, and redistribution state.
- Preview a fixture containing an unsupported integration; confirm `unavailable` appears before approval.
- Confirm preview causes no Botmancers import, unchecked approval cannot apply, and a refreshed/changed digest forces review.
- Apply the fixture and confirm the verification result and any differences are visible.
- Simulate source drift and a Botmancers failure; confirm a recoverable error appears and no clone is created or activated.

Required operator evidence (pending):

- [ ] Capture the running app at desktop width after checking all five visible label states.
- [ ] Capture the running app at 390px after checking all five visible label states.
- [ ] Record a real browser catalog → inspector → preview → apply → verify run.
- [ ] Record that the permission and omission acknowledgements gate the apply button.
- [ ] Record that `unsupported-crm` appears as unavailable before approval.
- [ ] Record the apply result and verification differences from the real client component.
- [ ] Live Grok and Botmancers connectivity remains deployment-environment evidence.
