// Foreground orchestrator for `npm run demo`: preflight, workspace build,
// isolated seed, fixture source, Next.js child, readiness, banner, shutdown.
//
// Nothing here references operator configuration or data
// (apps/web/.env.local, data/*.sqlite, operator artifact directories): every
// database, artifact, and cache path is derived from the isolated demo root.

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEMO_ARTIFACT_DIR_NAME,
  DEMO_CATALOG_DATABASE,
  DEMO_CHOSEN_SLUG,
  DEMO_DEFAULT_FIXTURE_PORT,
  DEMO_DEFAULT_WEB_PORT,
  DEMO_DIR_NAME,
  DEMO_EVIDENCE_DATABASE,
  DEMO_NEXT_DIST_DIR,
  DEMO_READONLY_STATEMENT,
  DEMO_SAMPLE_GROK_URL,
  DEMO_SAMPLE_SEARCH_QUERY,
} from "./constants.mjs";
import { DemoError } from "./errors.mjs";
import { checkDependencies, checkNodeVersion, checkPortFree, checkPortNumber } from "./preflight.mjs";
import { startFixtureServer } from "./fixture-server.mjs";
import { prepareDemoDatabases } from "./seed.mjs";

const DEMO_HOST = "127.0.0.1";

/** Repository root: CLONE_MARKET_ROOT override or the enclosing checkout. */
export function resolveRepoRoot(environment = process.env) {
  const override = environment.CLONE_MARKET_ROOT;
  if (override !== undefined && override.length > 0) return resolve(override);
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new DemoError(
      "demo_invalid_args",
      `Option ${name} requires a value.`,
      "run node scripts/demo/cli.mjs --help for usage.",
    );
  }
  return value;
}

/**
 * Parse demo CLI arguments. Flags win over CLONE_MARKET_DEMO_* environment.
 * @param {string[]} argv process.argv.slice(2)
 * @param {NodeJS.ProcessEnv} environment
 */
export function parseDemoArgs(argv, environment = process.env) {
  const known = new Set(["--port", "--fixture-port", "--demo-dir", "--skip-build", "--help", "-h"]);
  for (const arg of argv) {
    if (arg.startsWith("--") && !known.has(arg) && !arg.startsWith("--port=") && !arg.startsWith("--fixture-port=") && !arg.startsWith("--demo-dir=")) {
      throw new DemoError(
        "demo_invalid_args",
        `Unknown option "${arg}".`,
        "run node scripts/demo/cli.mjs --help for usage.",
      );
    }
  }
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const inline = (name) => {
    const match = argv.find((arg) => arg.startsWith(`${name}=`));
    return match === undefined ? undefined : match.slice(name.length + 1);
  };
  const blankToUndefined = (value) => (value === undefined || value.trim().length === 0 ? undefined : value);
  const rawPort = blankToUndefined(optionValue(argv, "--port") ?? inline("--port") ?? environment.CLONE_MARKET_DEMO_PORT);
  const rawFixturePort = blankToUndefined(optionValue(argv, "--fixture-port") ?? inline("--fixture-port") ?? environment.CLONE_MARKET_DEMO_FIXTURE_PORT);
  const rawDemoDir = blankToUndefined(optionValue(argv, "--demo-dir") ?? inline("--demo-dir") ?? environment.CLONE_MARKET_DEMO_DIR);
  // Hidden test hook: lets parallel launcher tests use disjoint Next caches.
  const rawDistDir = blankToUndefined(environment.CLONE_MARKET_DEMO_DIST_DIR);
  return {
    ...(rawPort === undefined ? {} : { webPort: checkPortNumber(rawPort, "web port") }),
    ...(rawFixturePort === undefined ? {} : { fixturePort: checkPortNumber(rawFixturePort, "fixture port") }),
    ...(rawDemoDir === undefined ? {} : { demoDir: rawDemoDir }),
    ...(rawDistDir === undefined ? {} : { demoDistDir: checkDemoDistDirName(rawDistDir) }),
    ...(argv.includes("--skip-build") ? { skipBuild: true } : {}),
  };
}

/**
 * Validate a demo Next.js cache directory name. Only `.next-demo` plus
 * suffixed variants are accepted so cleanup can never escape to the normal
 * `.next` directory or anywhere else.
 */
export function checkDemoDistDirName(value) {
  if (value === DEMO_NEXT_DIST_DIR || /^\.next-demo-[0-9A-Za-z._~-]+$/.test(value)) return value;
  throw new DemoError(
    "demo_invalid_args",
    `Invalid demo Next directory "${value}": expected ${DEMO_NEXT_DIST_DIR} or a ${DEMO_NEXT_DIST_DIR}-<suffix> variant.`,
    "unset CLONE_MARKET_DEMO_DIST_DIR or use a .next-demo-<suffix> name.",
  );
}

export function demoUsage() {
  return [
    "Usage: npm run demo [-- --port <n> --fixture-port <n> --demo-dir <path>]",
    "",
    "Launch the fixture-backed Clone Market browser demo (foreground, Ctrl-C to stop).",
    "",
    "Options:",
    `  --port <n>          web app port (default ${DEMO_DEFAULT_WEB_PORT}; CLONE_MARKET_DEMO_PORT)`,
    `  --fixture-port <n>  local fixture source port (default ${DEMO_DEFAULT_FIXTURE_PORT}; CLONE_MARKET_DEMO_FIXTURE_PORT)`,
    `  --demo-dir <path>   isolated demo data directory (default ${DEMO_DIR_NAME}/; CLONE_MARKET_DEMO_DIR)`,
    "  --help              show this usage",
  ].join("\n");
}

/**
 * Compute every derived demo path. Pure: no filesystem access, no operator
 * paths. All database, artifact, and cache paths stay under demoRoot.
 */
export function planDemo({ root, demoRoot, webPort, fixturePort, host = DEMO_HOST, nextDistDirName = DEMO_NEXT_DIST_DIR }) {
  const resolvedRoot = resolve(root);
  const effectiveDemoRoot = demoRoot === undefined || demoRoot.trim().length === 0 ? DEMO_DIR_NAME : demoRoot;
  const resolvedDemoRoot = isAbsolute(effectiveDemoRoot)
    ? resolve(effectiveDemoRoot)
    : resolve(resolvedRoot, effectiveDemoRoot);
  const validatedDistDirName = checkDemoDistDirName(nextDistDirName);
  const webDir = join(resolvedRoot, "apps", "web");
  const catalogPath = join(resolvedDemoRoot, DEMO_CATALOG_DATABASE);
  const evidencePath = join(resolvedDemoRoot, DEMO_EVIDENCE_DATABASE);
  const artifactDir = join(resolvedDemoRoot, DEMO_ARTIFACT_DIR_NAME);
  const resolvedWebPort = webPort ?? DEMO_DEFAULT_WEB_PORT;
  const resolvedFixturePort = fixturePort ?? DEMO_DEFAULT_FIXTURE_PORT;
  for (const path of [catalogPath, evidencePath, artifactDir]) {
    const outside = relative(resolvedDemoRoot, path).startsWith("..");
    if (outside) {
      throw new DemoError(
        "demo_invalid_args",
        `Demo path ${path} escapes the demo root ${resolvedDemoRoot}.`,
        "choose a --demo-dir inside the checkout or an absolute empty directory.",
      );
    }
  }
  return {
    root: resolvedRoot,
    demoRoot: resolvedDemoRoot,
    webDir,
    catalogPath,
    evidencePath,
    artifactDir,
    host,
    webPort: resolvedWebPort,
    fixturePort: resolvedFixturePort,
    webUrl: `http://${host}:${resolvedWebPort}/`,
    fixtureBaseUrl: `http://${host}:${resolvedFixturePort}/bot/marketplace/`,
    nextDistDirName: validatedDistDirName,
    nextDistDir: join(webDir, validatedDistDirName),
  };
}

/**
 * Prove the isolated demo root is writable before any listener starts, so
 * seed-path failures surface without needing loopback.
 */
export async function ensureDemoRootWritable(plan) {
  try {
    await mkdir(plan.demoRoot, { recursive: true });
    await mkdir(plan.artifactDir, { recursive: true });
    await mkdir(dirname(plan.catalogPath), { recursive: true });
    await mkdir(dirname(plan.evidencePath), { recursive: true });
  } catch (error) {
    throw new DemoError(
      "demo_seed_failed",
      `Demo directory ${plan.demoRoot} is not writable (${error instanceof Error ? error.message : "unknown error"}).`,
      `remove ${plan.demoRoot} (or choose another --demo-dir) and retry.`,
    );
  }
}

/** Rebuild workspace package output from the current checkout. */
export async function buildWorkspacePackages({ root, stderr }) {
  const child = spawn("npm", ["run", "build"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk) => {
      output += chunk.toString();
      stderr(chunk.toString());
    });
  }
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).catch((error) => {
    throw new DemoError(
      "demo_build_failed",
      `Workspace build cannot start (${error instanceof Error ? error.message : "unknown error"}).`,
      "run npm ci from the repository root, then retry npm run demo.",
    );
  });
  if (code !== 0) {
    throw new DemoError(
      "demo_build_failed",
      `Workspace build failed with exit code ${code}.`,
      "run npm run build for the full error, fix the checkout, then retry npm run demo.",
    );
  }
}

/**
 * Remove the demo-specific Next.js cache so stale bundles can never mask the
 * checked-out code. Only the demo directory is touched; never the normal
 * .next directory or operator paths. Failures warn and continue (dev mode
 * recompiles from source by content hash regardless).
 */
export async function cleanDemoNextDir(plan, stderr) {
  if (relative(plan.webDir, plan.nextDistDir) !== plan.nextDistDirName || checkDemoDistDirName(plan.nextDistDirName) !== plan.nextDistDirName) {
    throw new DemoError(
      "demo_invalid_args",
      `Refusing to clean unexpected Next directory ${plan.nextDistDir}.`,
      "retry without overrides; report this error if it persists.",
    );
  }
  try {
    await rm(plan.nextDistDir, { recursive: true, force: true });
  } catch (error) {
    stderr(`warning: cannot clean ${plan.nextDistDir} (${error instanceof Error ? error.message : "unknown error"}); continuing with the existing demo cache.\n`);
  }
}

function resolveNextBin(webDir) {
  try {
    return createRequire(join(webDir, "package.json")).resolve("next/dist/bin/next");
  } catch {
    throw new DemoError(
      "demo_dependencies_missing",
      "The Next.js binary is missing from the installed dependencies.",
      "run npm ci from the repository root, then retry npm run demo.",
    );
  }
}

/** Environment for the web child: explicit demo values win over .env.local. */
export function webChildEnv(plan, environment = process.env) {
  const { ...rest } = environment;
  return {
    ...rest,
    CLONE_MARKET_DEMO: "1",
    CLONE_MARKET_DEMO_DIST_DIR: plan.nextDistDirName,
    CLONE_MARKET_CATALOG_DB: plan.catalogPath,
    CLONE_MARKET_EVIDENCE_DB: plan.evidencePath,
    CLONE_MARKET_ARTIFACT_DIR: plan.artifactDir,
    CLONE_MARKET_GROK_BASE_URL: plan.fixtureBaseUrl,
    // Blank, not deleted: Next.js fills variables absent from process.env from
    // apps/web/.env.local, while readConfig's optionalUrl treats blank as
    // unset — so blank keeps declared Botmancers capabilities without letting
    // an operator .env.local supply an HTTP endpoint.
    CLONE_MARKET_BOTMANCERS_BASE_URL: "",
    CLONE_MARKET_BOTMANCERS_UI_BASE_URL: "",
    PORT: String(plan.webPort),
  };
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Stop a child process: signal, grace period, then SIGKILL. Resolves with the
 * observed exit code/signal. Exported for lifecycle tests.
 */
export async function stopChild(child, { signal = "SIGTERM", graceMs = 10_000, killGroup = false } = {}) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  const exited = new Promise((resolve) => {
    child.once("exit", (code, exitSignal) => resolve({ code, signal: exitSignal }));
  });
  const killTarget = (finalSignal) => {
    if (killGroup && child.pid !== undefined && process.platform !== "win32") {
      try {
        process.kill(-child.pid, finalSignal);
        return;
      } catch {
        /* fall through to direct kill */
      }
    }
    try {
      child.kill(finalSignal);
    } catch {
      /* already exited */
    }
  };
  killTarget(signal);
  const timeout = setTimeout(() => killTarget("SIGKILL"), graceMs);
  try {
    return await exited;
  } finally {
    clearTimeout(timeout);
  }
}

/** Poll the home page until it answers 200 or the web child dies. */
export async function waitForWebReady({ url, timeoutMs, child }) {
  const started = Date.now();
  let lastDetail = "no response yet";
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new DemoError(
        "demo_web_failed",
        `Web app exited before becoming ready (code ${child.exitCode ?? child.signalCode}).`,
        "check the [web] output above, free the port, and retry npm run demo.",
      );
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        await response.text().catch(() => undefined);
        if (response.status === 200) return;
        lastDetail = `HTTP ${response.status}`;
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      const cause = error?.cause;
      lastDetail = cause?.code ?? error?.message ?? "connection refused";
    }
    await sleep(500);
  }
  throw new DemoError(
    "demo_web_not_ready",
    `Web app did not answer ${url} within ${Math.round(timeoutMs / 1000)}s (last: ${lastDetail}).`,
    "free the port, remove the demo directory, and retry; check the [web] output above.",
  );
}

function bannerLines(plan) {
  return [
    "Clone Market demo is ready.",
    `Browser URL: ${plan.webUrl}`,
    `Sample Grok URL: ${DEMO_SAMPLE_GROK_URL}`,
    `Sample search query: ${DEMO_SAMPLE_SEARCH_QUERY}`,
    DEMO_READONLY_STATEMENT,
    "Press Ctrl-C to stop.",
  ];
}

/**
 * Launch the demo and resolve once the ready banner is printed. Pre-ready
 * failures reject with DemoError; post-ready shutdown resolves handle.done.
 */
export async function runDemo(options = {}) {
  const {
    root = resolveRepoRoot(options.environment),
    demoRoot,
    webPort,
    fixturePort,
    demoDistDir,
    host = DEMO_HOST,
    skipBuild = false,
    readyTimeoutMs = 180_000,
    webGraceMs = 10_000,
    handleSignals = false,
    stdout = (chunk) => process.stdout.write(chunk),
    stderr = (chunk) => process.stderr.write(chunk),
    version = options.environment?.CLONE_MARKET_DEMO_NODE_VERSION ?? process.versions.node,
  } = options;

  const plan = planDemo({
    root,
    demoRoot,
    webPort,
    fixturePort,
    host,
    ...(demoDistDir === undefined ? {} : { nextDistDirName: demoDistDir }),
  });
  checkNodeVersion(version);
  await checkDependencies(plan.root);
  await ensureDemoRootWritable(plan);
  await checkPortFree(plan.webPort, plan.host, "web port");
  await checkPortFree(plan.fixturePort, plan.host, "fixture port");

  if (!skipBuild) {
    stderr("Building workspace packages from the current checkout...\n");
    await buildWorkspacePackages({ root: plan.root, stderr });
  }
  await cleanDemoNextDir(plan, stderr);

  stderr(`Starting local fixture source for ${DEMO_CHOSEN_SLUG}...\n`);
  const fixture = await startFixtureServer({ port: plan.fixturePort, host: plan.host, root: plan.root });
  // Lock the seed to the bound fixture port (mirrors fixtureBaseUrl unless port 0 binds).
  const seedBaseUrl = fixture.baseUrl;

  let seed;
  try {
    stderr("Seeding isolated demo databases...\n");
    seed = await prepareDemoDatabases({
      catalogPath: plan.catalogPath,
      evidencePath: plan.evidencePath,
      artifactDir: plan.artifactDir,
      grokBaseUrl: seedBaseUrl,
    });
  } catch (error) {
    await fixture.close().catch(() => undefined);
    throw error;
  }
  stderr(`Seeded ${seed.catalog.total} catalog templates and ${seed.evidence.rows} evidence rows (${seed.evidence.label}).\n`);

  const nextBin = resolveNextBin(plan.webDir);
  const useGroup = process.platform !== "win32";
  const web = spawn(
    process.execPath,
    [nextBin, "dev", "--port", String(plan.webPort), "--hostname", plan.host],
    { cwd: plan.webDir, env: webChildEnv(plan, options.environment), stdio: ["ignore", "pipe", "pipe"], detached: useGroup },
  );
  let webTail = "";
  const forwardWeb = (chunk) => {
    const text = chunk.toString();
    webTail = `${webTail}${text}`.slice(-4000);
    for (const line of text.split("\n")) {
      if (line.length > 0) stderr(`[web] ${line}\n`);
    }
  };
  web.stdout?.on("data", forwardWeb);
  web.stderr?.on("data", forwardWeb);
  web.once("error", (error) => {
    webTail += `\nspawn error: ${error.message}`;
  });

  try {
    stderr(`Waiting for the web app at ${plan.webUrl}...\n`);
    await waitForWebReady({ url: plan.webUrl, timeoutMs: readyTimeoutMs, child: web });
  } catch (error) {
    await stopChild(web, { graceMs: webGraceMs, killGroup: useGroup }).catch(() => undefined);
    await fixture.close().catch(() => undefined);
    if (error instanceof DemoError && error.code === "demo_web_failed") {
      throw new DemoError(error.code, `${error.message} Last web output: ${webTail.trim().slice(-500) || "none"}`, error.remediation);
    }
    throw error;
  }

  for (const line of bannerLines(plan)) stdout(`${line}\n`);

  let stopOnce = null;
  let doneResolve;
  const done = new Promise((resolve) => {
    doneResolve = resolve;
  });
  const finish = (code, error) => {
    if (handleSignals) {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
    doneResolve(error === undefined ? { code } : { code, error });
  };
  const stop = (signal = "SIGTERM") => {
    if (stopOnce === null) {
      stopOnce = (async () => {
        stderr(`\nStopping the demo (${signal})...\n`);
        await stopChild(web, { signal, graceMs: webGraceMs, killGroup: useGroup }).catch(() => undefined);
        await fixture.close().catch(() => undefined);
        stderr("Demo stopped.\n");
      })().then(() => finish(0), (error) => finish(1, error));
    }
    return stopOnce;
  };
  let signalCount = 0;
  const onSignal = (signal) => {
    signalCount += 1;
    if (signalCount === 1) {
      void stop(signal);
      return;
    }
    try {
      if (useGroup && web.pid !== undefined) process.kill(-web.pid, "SIGKILL");
      else web.kill("SIGKILL");
    } catch {
      /* already exited */
    }
    void fixture.close().catch(() => undefined).then(() => finish(0));
  };
  if (handleSignals) {
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  }
  web.once("exit", (code, signal) => {
    if (stopOnce !== null) return;
    stopOnce = (async () => {
      await fixture.close().catch(() => undefined);
      const error = new DemoError(
        "demo_web_failed",
        `Web app exited unexpectedly (code ${code ?? signal}). Last web output: ${webTail.trim().slice(-500) || "none"}`,
        "check the [web] output above, free the port, and retry npm run demo.",
      );
      stderr(`${error.format()}\n`);
      finish(1, error);
    })();
  });

  return { plan, seed, stop: () => stop("SIGTERM"), done };
}
