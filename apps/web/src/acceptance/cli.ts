import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { SourceIdentity } from "@clone-market/core";

import { parseAcceptanceCli, resolveLiveMode } from "./parse-cli.js";
import { resolveCloneMarketDataPath } from "../config.js";
import { runV0Acceptance } from "./run.js";

function parseTemplate(value: string): SourceIdentity {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    return { provider: "grok-marketplace", externalId: value };
  }
  return { provider: value.slice(0, separator), externalId: value.slice(separator + 1) };
}

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseAcceptanceCli(args);
  if (parsed.parseOnly) {
    console.log(JSON.stringify(parsed));
    return 0;
  }
  const liveMode = resolveLiveMode(args, process.env);
  if (liveMode.error !== undefined) {
    console.error(liveMode.error);
    return 2;
  }
  const live = liveMode.live;
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const reportPath = parsed.reportPath
    ?? join(process.cwd(), ".temporal/logs", `v0-acceptance-${live ? "live" : "fixture"}-${stamp}.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  const template = parsed.template ?? process.env.CLONE_MARKET_ACCEPTANCE_TEMPLATE;
  const catalogPath = parsed.catalogPath ?? process.env.CLONE_MARKET_CATALOG_DB;
  const evidencePath = parsed.evidencePath ?? process.env.CLONE_MARKET_EVIDENCE_DB;
  const artifactDir = process.env.CLONE_MARKET_ARTIFACT_DIR;
  const report = await runV0Acceptance({
    mode: live ? "live" : "fixture",
    reportPath,
    ...(process.env.CLONE_MARKET_GROK_BASE_URL === undefined
      ? {}
      : { grokBaseUrl: process.env.CLONE_MARKET_GROK_BASE_URL }),
    ...(catalogPath === undefined ? {} : { catalogPath: resolveCloneMarketDataPath(catalogPath) }),
    ...(evidencePath === undefined ? {} : { evidencePath: resolveCloneMarketDataPath(evidencePath) }),
    ...(artifactDir === undefined ? {} : { artifactDir: resolveCloneMarketDataPath(artifactDir) }),
    ...(template === undefined ? {} : { source: parseTemplate(template) }),
    ...(process.env.CLONE_MARKET_ACCEPTANCE_PEER_REPOS === "1" ? { verifyPeerRepos: true } : {}),
    ...(process.env.BOTMANCERS_ROOT === undefined ? {} : { botmancersRoot: process.env.BOTMANCERS_ROOT }),
  });
  console.log(JSON.stringify(report, null, 2));
  console.error(`Wrote ${reportPath}`);
  return report.exitCode;
}

process.exitCode = await main();
