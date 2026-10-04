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

Preview is side-effect free. Apply requires `approved: true` and the digest returned by the currently displayed preview. The server refetches and replans before apply; any source or target drift returns `stale_plan` and requires another review.

## Operator checklist

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
