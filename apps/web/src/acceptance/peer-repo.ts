import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { findCloneMarketRoot } from "../config.js";

export type PeerScriptResult = {
  status: number;
  command: string;
  output?: string;
};

export type PeerRepoCheck = {
  root?: string;
  status: "passed" | "failed" | "skipped";
  typecheck?: PeerScriptResult;
  test?: PeerScriptResult;
  returnRouteConfirmed: boolean;
  idempotencyKeyConfirmed: boolean;
  detail: string;
};

function walkSource(root: string, files: string[] = [], depth = 0): string[] {
  if (depth > 6) return files;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return files;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "dist" || name === "coverage") continue;
    const path = join(root, name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walkSource(path, files, depth + 1);
    else if (/\.(ts|tsx|js|jsx|md)$/.test(name)) files.push(path);
  }
  return files;
}

function grepTree(root: string, pattern: RegExp): boolean {
  return walkSource(root).some((file) => {
    try {
      return pattern.test(file) || pattern.test(readFileSync(file, "utf8"));
    } catch {
      return false;
    }
  });
}

function packageScripts(root: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

function pickScript(scripts: Record<string, string>, names: string[]): string | undefined {
  return names.find((name) => scripts[name] !== undefined);
}

function runNpmScript(root: string, script: string): PeerScriptResult {
  const command = `npm run ${script}`;
  const result = spawnSync("npm", ["run", script], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 2_000_000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-2000);
  return { status: result.status ?? 1, command, ...(output.length === 0 ? {} : { output }) };
}

function runTsc(root: string): PeerScriptResult {
  const tsc = join(findCloneMarketRoot(), "node_modules/typescript/bin/tsc");
  const command = existsSync(tsc) ? `${tsc} --noEmit -p .` : "npx --no-install tsc --noEmit -p .";
  const result = existsSync(tsc)
    ? spawnSync(process.execPath, [tsc, "--noEmit", "-p", "."], { cwd: root, encoding: "utf8", env: process.env, maxBuffer: 2_000_000 })
    : spawnSync("npx", ["--no-install", "tsc", "--noEmit", "-p", "."], { cwd: root, encoding: "utf8", env: process.env, maxBuffer: 2_000_000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-2000);
  return { status: result.status ?? 1, command, ...(output.length === 0 ? {} : { output }) };
}

/** Inspect an optional Botmancers checkout for offline tests, UI return route, and idempotency-key handling. */
export function verifyBotmancersPeerRepo(root: string | undefined): PeerRepoCheck {
  if (root === undefined || root.length === 0) {
    return {
      status: "skipped",
      returnRouteConfirmed: false,
      idempotencyKeyConfirmed: false,
      detail: "BOTMANCERS_ROOT unset. Set it to the Botmancers package root and CLONE_MARKET_ACCEPTANCE_PEER_REPOS=1 to run that repository's offline verification.",
    };
  }
  if (!existsSync(join(root, "package.json"))) {
    return {
      root,
      status: "failed",
      returnRouteConfirmed: false,
      idempotencyKeyConfirmed: false,
      detail: `BOTMANCERS_ROOT ${root} has no package.json`,
    };
  }
  const scripts = packageScripts(root);
  const returnRouteConfirmed = grepTree(root, /bots\/[:$]|`bots\/|['"]\/bots\/|path:\s*['"]bots\/|app\/api\/bots|\/api\/bots/);
  const idempotencyKeyConfirmed = grepTree(root, /idempotency-key|idempotencyKey|import_operation_id|operation_id/);
  const typecheckName = pickScript(scripts, ["typecheck"]);
  const testName = pickScript(scripts, ["test"]);
  const hasPeerInstall = existsSync(join(root, "node_modules"));
  const typecheck = typecheckName === undefined
    ? (existsSync(join(root, "tsconfig.json")) ? runTsc(root) : { status: 1, command: "missing typecheck script and tsconfig.json" })
    : runNpmScript(root, typecheckName);
  const test = testName === undefined
    ? { status: 0, command: "skipped (no npm test script; not running live-gated test:acceptance)", output: Object.keys(scripts).join(",") }
    : runNpmScript(root, testName);
  const typecheckRequired = typecheckName !== undefined || hasPeerInstall;
  const testRequired = testName !== undefined;
  const status = (typecheckRequired ? typecheck.status === 0 : true)
    && (testRequired ? test.status === 0 : true)
    && returnRouteConfirmed
    && idempotencyKeyConfirmed
    ? "passed"
    : "failed";
  return {
    root,
    status,
    typecheck,
    test,
    returnRouteConfirmed,
    idempotencyKeyConfirmed,
    detail: `typecheck=${typecheck.command}:${typecheck.status} test=${test.command}:${test.status} returnRoute=${returnRouteConfirmed} idempotency=${idempotencyKeyConfirmed}`,
  };
}
