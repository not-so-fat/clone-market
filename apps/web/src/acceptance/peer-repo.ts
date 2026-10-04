import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export type PeerRepoCheck = {
  root?: string;
  status: "passed" | "failed" | "skipped";
  typecheck?: { status: number; command: string };
  test?: { status: number; command: string };
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
      return pattern.test(readFileSync(file, "utf8"));
    } catch {
      return false;
    }
  });
}

function runScript(root: string, script: string): { status: number; command: string } {
  const command = `npm run ${script}`;
  const result = spawnSync("npm", ["run", script], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  return { status: result.status ?? 1, command };
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
  const returnRouteConfirmed = grepTree(root, /bots\/[:$]|`bots\/|['"]\/bots\/|path:\s*['"]bots\//);
  const idempotencyKeyConfirmed = grepTree(root, /idempotency-key|idempotencyKey/);
  const typecheck = runScript(root, "typecheck");
  const test = runScript(root, "test");
  const status = typecheck.status === 0 && test.status === 0 && returnRouteConfirmed && idempotencyKeyConfirmed
    ? "passed"
    : "failed";
  return {
    root,
    status,
    typecheck,
    test,
    returnRouteConfirmed,
    idempotencyKeyConfirmed,
    detail: `typecheck=${typecheck.status} test=${test.status} returnRoute=${returnRouteConfirmed} idempotency=${idempotencyKeyConfirmed}`,
  };
}
