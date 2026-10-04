import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { runV0Acceptance } from "./run.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  const wantsLive = args.includes("--live");
  const liveEnabled = process.env.CLONE_MARKET_ACCEPTANCE_LIVE === "1";
  if (wantsLive && !liveEnabled) {
    console.error("Live V0 acceptance requires CLONE_MARKET_ACCEPTANCE_LIVE=1 (opt-in; may use network).");
    return 2;
  }
  const live = wantsLive && liveEnabled;
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const reportPath = option(args, "--report")
    ?? join(process.cwd(), ".temporal/logs", `v0-acceptance-${live ? "live" : "fixture"}-${stamp}.json`);
  mkdirSync(dirname(reportPath), { recursive: true });
  const report = await runV0Acceptance({
    mode: live ? "live" : "fixture",
    reportPath,
    ...(process.env.CLONE_MARKET_BOTMANCERS_UI_BASE_URL === undefined
      ? {}
      : { botmancersUiBaseUrl: process.env.CLONE_MARKET_BOTMANCERS_UI_BASE_URL }),
    ...(process.env.CLONE_MARKET_BOTMANCERS_BASE_URL === undefined
      ? {}
      : { botmancersBaseUrl: process.env.CLONE_MARKET_BOTMANCERS_BASE_URL }),
    ...(process.env.CLONE_MARKET_GROK_BASE_URL === undefined
      ? {}
      : { grokBaseUrl: process.env.CLONE_MARKET_GROK_BASE_URL }),
  });
  console.log(JSON.stringify(report, null, 2));
  console.error(`Wrote ${reportPath}`);
  return report.exitCode;
}

process.exitCode = await main();
