#!/usr/bin/env node
// Entry point for `npm run demo`: one foreground process serving the
// fixture-backed Clone Market browser demo. Ctrl-C stops everything.

import { pathToFileURL } from "node:url";
import { DemoError } from "./errors.mjs";
import { demoUsage, parseDemoArgs, resolveRepoRoot, runDemo } from "./launcher.mjs";

async function main(argv) {
  const environment = process.env;
  let args;
  try {
    args = parseDemoArgs(argv, environment);
  } catch (error) {
    if (error instanceof DemoError) {
      console.error(error.format());
      return 2;
    }
    throw error;
  }
  if ("help" in args) {
    console.log(demoUsage());
    return 0;
  }
  try {
    const handle = await runDemo({
      root: resolveRepoRoot(environment),
      ...(args.webPort === undefined ? {} : { webPort: args.webPort }),
      ...(args.fixturePort === undefined ? {} : { fixturePort: args.fixturePort }),
      ...(args.demoDir === undefined ? {} : { demoRoot: args.demoDir }),
      ...(args.demoDistDir === undefined ? {} : { demoDistDir: args.demoDistDir }),
      ...(args.skipBuild === true ? { skipBuild: true } : {}),
      handleSignals: true,
      environment,
    });
    const result = await handle.done;
    if (result.error !== undefined) console.error(result.error.format());
    return result.code;
  } catch (error) {
    if (error instanceof DemoError) {
      console.error(error.format());
      return 1;
    }
    console.error(error);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
