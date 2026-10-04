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

Preview is side-effect free. Apply requires `approved: true`, `planDigest`, and `reviewedAt` (the displayed plan's `createdAt`). Verification requires the same review identity plus `targetReference`. The server refetches and replans against that review identity before apply or verification; any source or target drift returns `stale_plan` and requires another review.

## Operator checklist

The fixture-backed smoke is recorded under [`artifacts/not-351`](./artifacts/not-351). `browser-smoke.json` records the successful catalog → inspector → preview → apply → verify route sequence, the reviewed digest, the unsupported component shown before approval, and the verification result. `browser-smoke.html` is the browser-readable fixture output. The 1440px and 390px PNG visual artifacts show all adoption labels and the completed flow; deterministic SVG sources and `scripts/rasterize-svg.swift` keep the captures reproducible offline.

Verify the handler-backed artifact is current with:

```sh
npx vitest run apps/web/src/operator-artifacts.test.ts
```

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

Recorded fixture results:

- [x] Featured, Listed, Discussed, Emerging, and Observed use are distinguishable at desktop and narrow mobile widths.
- [x] Labels are explicitly scoped to public evidence and do not imply private use.
- [x] Catalog → inspector → preview → apply → verify completed.
- [x] `unsupported-crm` appears as unavailable before approval.
- [x] Apply result and passing verification are visible.
- [ ] Live Grok and Botmancers connectivity remains deployment-environment evidence.
