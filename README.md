# Clone Market

Discover public agent templates, understand how they work, and privately clone the compatible parts into your own agent stack.

Clone Market begins with the public Grok Bot Marketplace and is designed around a reusable source-adapter and manifest layer so additional agent marketplaces can be supported later.

## Product

- [Product brief](docs/product-brief.md)

## Development

Clone Market uses Node.js 22.5 or newer (for the built-in SQLite API), TypeScript 5, npm workspaces, and Vitest.

| Command | Purpose |
| --- | --- |
| `npm ci` | Reproduce the dependency tree from `package-lock.json`. |
| `npm run typecheck` | Build and type-check the core package and external consumer fixture. |
| `npm test` | Run contract, public-consumer, and package-boundary tests. |
| `npm run lint` | Check package boundaries and TypeScript source hygiene. |

The reusable contracts live in `@clone-market/core`. Product surfaces, source,
storage, and future target implementations consume that package; they do not own
its transport-neutral contracts. The source-neutral index catalog and SQLite
adapter live in `@clone-market/catalog`. See [ADR 0001](docs/decisions/0001-package-graph.md).
Reviewed public signals, deduplication, and inspectable adoption-label derivation
live in `@clone-market/evidence`.

## Status

Foundation contracts, the Grok Marketplace source adapter, the central public
index catalog, and reviewed public-evidence labels are implemented. Private target
import and catalog rendering remain future work.
