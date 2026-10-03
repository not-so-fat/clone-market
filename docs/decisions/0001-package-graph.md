# ADR 0001: One-way package graph

- Status: Accepted
- Date: 2026-10-03

## Context

Clone Market needs contracts that can be consumed by TypeScript applications and
other runtimes before a Grok parser, database, web UI, or Botmancers integration
exists. Letting a source parser or product surface own those contracts would couple
all other consumers to its framework and release cycle.

## Decision

`@clone-market/core` owns versioned, serializable contracts and transport-neutral
ports. It may depend only on general-purpose libraries. Source adapters and target
adapters may depend on core but never on one another. Services and product surfaces
compose these packages from the outside.

```text
product surfaces (CLI / HTTP / UI / Botmancers)
              |              |
              v              v
       source adapters   target adapters
              \              /
               v            v
                @clone-market/core
```

Every workspace package declares `cloneMarket.layer`. The root
`scripts/check-boundaries.mjs` command rejects internal core dependencies,
non-workspace core dependencies absent from the root `cloneMarket.coreDependencies`
allowlist, and source-to-target or target-to-source edges. The deliberately small
allowlist makes review of core's general-purpose dependencies explicit.

Product surfaces are consumers because their job is composition and presentation.
They can add transport concerns, authentication, persistence wiring, or UI state,
but cannot redefine portable source, evidence, compatibility, or operation shapes.

## Consequences

- The first TypeScript consumer receives native types and runtime validation.
- Exported JSON Schemas provide a language-neutral integration path.
- Target behavior cannot leak into source normalization, and source scraping cannot
  leak into target generation.
- A new product surface or adapter can evolve without becoming a dependency of core.
