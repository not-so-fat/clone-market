// Shared constants for the one-command fixture-backed demo (`npm run demo`).

/** Canonical sample Grok URL printed by the demo banner and pasted by the operator. */
export const DEMO_SAMPLE_GROK_URL = "https://x.ai/bot/marketplace/bots/projects-manager";

/** Sample marketplace search query printed by the demo banner. */
export const DEMO_SAMPLE_SEARCH_QUERY = "Projects Manager";

/** Explicit non-registration statement printed once the demo is ready. */
export const DEMO_READONLY_STATEMENT = "This demo is read-only; registers nothing.";

/** Default Next.js port for the demo web app (override: --port / CLONE_MARKET_DEMO_PORT). */
export const DEMO_DEFAULT_WEB_PORT = 3100;

/** Default port for the local fixture source (override: --fixture-port / CLONE_MARKET_DEMO_FIXTURE_PORT). */
export const DEMO_DEFAULT_FIXTURE_PORT = 3101;

/** Demo data directory, relative to the repository root unless overridden. Ignored by git. */
export const DEMO_DIR_NAME = ".temporal/demo";

export const DEMO_CATALOG_DATABASE = "catalog.sqlite";
export const DEMO_EVIDENCE_DATABASE = "evidence.sqlite";
export const DEMO_ARTIFACT_DIR_NAME = "artifacts";

/**
 * Fixed clock for demo seeding so catalog retrieval stamps and the evidence
 * derivation are byte-stable across reruns. Matches the V0 acceptance fixtures.
 */
export const DEMO_SEED_NOW = "2026-10-03T18:00:00.000Z";

/** Demo-specific Next.js build directory (see apps/web/next.config.ts). Ignored by git. */
export const DEMO_NEXT_DIST_DIR = ".next-demo";

/** Minimum supported Node.js version (major, minor). */
export const DEMO_MIN_NODE_MAJOR = 22;
export const DEMO_MIN_NODE_MINOR = 5;

export const DEMO_CHOSEN_PROVIDER = "grok-marketplace";
export const DEMO_CHOSEN_EXTERNAL_ID = "bot-projects-manager-20261002";
export const DEMO_CHOSEN_SLUG = "projects-manager";
export const DEMO_CHOSEN_TEMPLATE_ID = "grok-marketplace:bot-projects-manager-20261002";
