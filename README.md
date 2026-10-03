# Clone Market

Discover public agent templates, understand how they work, and privately clone the compatible parts into your own agent stack.

Clone Market begins with the public Grok Bot Marketplace and is designed around a reusable source-adapter and manifest layer so additional agent marketplaces can be supported later.

## Product

- [Product brief](docs/product-brief.md)

## Development

Clone Market uses Node.js 20 or newer, TypeScript 5, npm workspaces, and Vitest.

| Command | Purpose |
| --- | --- |
| `npm ci` | Reproduce the dependency tree from `package-lock.json`. |
| `npm run typecheck` | Build and type-check the core package and external consumer fixture. |
| `npm test` | Run contract, public-consumer, and package-boundary tests. |
| `npm run lint` | Check package boundaries and TypeScript source hygiene. |

The reusable contracts live in `@clone-market/core`. Product surfaces and future
source, storage, and target implementations consume that package; they do not own
its transport-neutral contracts. See [ADR 0001](docs/decisions/0001-package-graph.md).

## Status

Foundation contracts only. No importer or public catalog has been implemented yet.
