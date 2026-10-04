import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type WebConfig = {
  catalogDatabase: string;
  evidenceDatabase: string;
  artifactDirectory: string;
  grokBaseUrl: string;
  botmancersBaseUrl: string;
  botmancersUiBaseUrl: string;
};

/** Walk from cwd (or CLONE_MARKET_ROOT) to the workspace package.json named clone-market. */
export function findCloneMarketRoot(start = process.cwd()): string {
  const override = process.env.CLONE_MARKET_ROOT;
  if (override !== undefined && override.length > 0) return resolve(override);
  let dir = resolve(start);
  for (let i = 0; i < 12; i += 1) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === "clone-market") return dir;
      } catch {
        /* keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

/** Resolve catalog/evidence SQLite paths against the repository root so smoke and `next dev` share one file. */
export function resolveCloneMarketDataPath(path: string, root = findCloneMarketRoot()): string {
  if (path.length === 0) return path;
  return isAbsolute(path) ? path : resolve(root, path);
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): WebConfig {
  const root = environment.CLONE_MARKET_ROOT !== undefined && environment.CLONE_MARKET_ROOT.length > 0
    ? resolve(environment.CLONE_MARKET_ROOT)
    : findCloneMarketRoot();
  return {
    catalogDatabase: resolveCloneMarketDataPath(environment.CLONE_MARKET_CATALOG_DB ?? "./data/catalog.sqlite", root),
    evidenceDatabase: resolveCloneMarketDataPath(environment.CLONE_MARKET_EVIDENCE_DB ?? "./data/evidence.sqlite", root),
    artifactDirectory: resolveCloneMarketDataPath(environment.CLONE_MARKET_ARTIFACT_DIR ?? "./data/artifacts", root),
    grokBaseUrl: environment.CLONE_MARKET_GROK_BASE_URL ?? "https://x.ai/bot/marketplace/",
    botmancersBaseUrl: environment.CLONE_MARKET_BOTMANCERS_BASE_URL ?? "http://127.0.0.1:8787/",
    botmancersUiBaseUrl: environment.CLONE_MARKET_BOTMANCERS_UI_BASE_URL ?? "http://127.0.0.1:3100/",
  };
}
