import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { allocatePort, expectConnectionRefused } from "./test-helpers.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "scripts", "demo", "cli.mjs");

const temporary: string[] = [];
const children: ChildProcess[] = [];
const distDirs: string[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
  for (const path of distDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

type SpawnedCli = {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  webUrl: string;
  fixtureUrl: string;
};

async function spawnCli(options: { extraEnv?: Record<string, string>; args?: string[]; trackDistDir?: string } = {}): Promise<SpawnedCli> {
  const demoRoot = mkdtempSync(join(tmpdir(), "demo-lifecycle-"));
  temporary.push(demoRoot);
  const webPort = await allocatePort();
  const fixturePort = await allocatePort();
  let stdout = "";
  let stderr = "";
  const child = spawn(
    process.execPath,
    [CLI, "--demo-dir", demoRoot, "--port", String(webPort), "--fixture-port", String(fixturePort), "--skip-build", ...(options.args ?? [])],
    {
      cwd: ROOT,
      env: { ...process.env, ...(options.extraEnv ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(child);
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  if (options.trackDistDir !== undefined) distDirs.push(join(ROOT, "apps", "web", options.trackDistDir));
  return {
    child,
    stdout: () => stdout,
    stderr: () => stderr,
    webUrl: `http://127.0.0.1:${webPort}/`,
    fixtureUrl: `http://127.0.0.1:${fixturePort}/bot/marketplace/`,
  };
}

async function waitForReady(cli: SpawnedCli, timeoutMs = 240_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (cli.stdout().includes("Clone Market demo is ready.")) return;
    if (cli.child.exitCode !== null || cli.child.signalCode !== null) {
      throw new Error(`demo CLI exited early (code ${cli.child.exitCode}): ${cli.stderr().slice(-2000)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`demo CLI did not become ready within ${timeoutMs}ms: ${cli.stderr().slice(-2000)}`);
}

async function waitForExit(cli: SpawnedCli, timeoutMs = 60_000): Promise<number | null> {
  if (cli.child.exitCode !== null) return cli.child.exitCode;
  return new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      cli.child.kill("SIGKILL");
      reject(new Error(`demo CLI did not exit within ${timeoutMs}ms: ${cli.stderr().slice(-2000)}`));
    }, timeoutMs);
    cli.child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe("demo lifecycle [agent]", () => {
  it("stops every child and releases both ports on SIGTERM", async () => {
    const cli = await spawnCli({ extraEnv: { CLONE_MARKET_DEMO_DIST_DIR: ".next-demo-lifecycle-term" }, trackDistDir: ".next-demo-lifecycle-term" });
    await waitForReady(cli);
    expect((await fetch(cli.webUrl)).status).toBe(200);
    cli.child.kill("SIGTERM");
    expect(await waitForExit(cli)).toBe(0);
    await expectConnectionRefused(cli.webUrl);
    await expectConnectionRefused(cli.fixtureUrl);
  }, { timeout: 300_000 });

  it("stops every child and releases both ports on SIGINT", async () => {
    const cli = await spawnCli({ extraEnv: { CLONE_MARKET_DEMO_DIST_DIR: ".next-demo-lifecycle-int" }, trackDistDir: ".next-demo-lifecycle-int" });
    await waitForReady(cli);
    cli.child.kill("SIGINT");
    expect(await waitForExit(cli)).toBe(0);
    await expectConnectionRefused(cli.webUrl);
    await expectConnectionRefused(cli.fixtureUrl);
  }, { timeout: 300_000 });

  it("refuses an occupied port with remediation", async () => {
    const webPort = await allocatePort();
    const fixturePort = await allocatePort();
    const occupier = createServer();
    await new Promise<void>((resolve) => occupier.listen(webPort, "127.0.0.1", () => resolve()));
    try {
      const demoRoot = mkdtempSync(join(tmpdir(), "demo-occupied-"));
      temporary.push(demoRoot);
      const child = spawn(
        process.execPath,
        [CLI, "--demo-dir", demoRoot, "--port", String(webPort), "--fixture-port", String(fixturePort), "--skip-build"],
        { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
      );
      children.push(child);
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("occupied-port CLI did not exit promptly"));
        }, 60_000);
        child.once("exit", (exitCode) => {
          clearTimeout(timer);
          resolve(exitCode);
        });
      });
      expect(code).not.toBe(0);
      expect(stderr).toContain("error[demo_port_occupied]");
      expect(stderr).toContain(`web port ${webPort} is already in use`);
      expect(stderr).toContain("--port");
    } finally {
      await new Promise<void>((resolve) => occupier.close(() => resolve()));
    }
  }, { timeout: 120_000 });

  it("exits nonzero with remediation on old Node, missing dependencies, seed failure, and invalid args", async () => {
    const cases: Array<{ name: string; extraEnv?: Record<string, string>; args?: string[]; code: string; remediation: string }> = [];
    const blockerDir = mkdtempSync(join(tmpdir(), "demo-blocker-"));
    temporary.push(blockerDir);
    const blocker = join(blockerDir, "demo");
    writeFileSync(blocker, "not a directory");
    cases.push(
      { name: "old node", extraEnv: { CLONE_MARKET_DEMO_NODE_VERSION: "20.1.0" }, code: "demo_node_version", remediation: "22.5" },
      { name: "missing dependencies", extraEnv: { CLONE_MARKET_ROOT: mkdtempSync(join(tmpdir(), "demo-empty-root-")) }, code: "demo_dependencies_missing", remediation: "npm ci" },
      { name: "seed failure", args: ["--demo-dir", blocker], code: "demo_seed_failed", remediation: "--demo-dir" },
      { name: "invalid args", args: ["--port", "abc"], code: "demo_invalid_args", remediation: "--port" },
    );
    for (const testCase of cases) {
      if (testCase.extraEnv?.CLONE_MARKET_ROOT !== undefined) temporary.push(testCase.extraEnv.CLONE_MARKET_ROOT);
      const demoRoot = testCase.args?.includes("--demo-dir") === true
        ? undefined
        : mkdtempSync(join(tmpdir(), "demo-failfast-"));
      if (demoRoot !== undefined) temporary.push(demoRoot);
      const child = spawn(
        process.execPath,
        [CLI, ...(demoRoot === undefined ? [] : ["--demo-dir", demoRoot]), ...(testCase.args ?? []), "--skip-build"],
        { cwd: ROOT, env: { ...process.env, ...(testCase.extraEnv ?? {}) }, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const code: number | null = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`${testCase.name}: CLI did not exit promptly`));
        }, 60_000);
        child.once("exit", (exitCode) => {
          clearTimeout(timer);
          resolve(exitCode);
        });
        child.once("error", reject);
      });
      expect(code, testCase.name).not.toBe(0);
      expect(stderr, testCase.name).toContain(`error[${testCase.code}]`);
      expect(stderr, testCase.name).toContain(testCase.remediation);
    }
  }, { timeout: 180_000 });
});
