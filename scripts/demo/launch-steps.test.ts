import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import type { DemoError } from "./errors.mjs";
import { buildWorkspacePackages, cleanDemoNextDir, planDemo, waitForWebReady } from "./launcher.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("demo launch steps [agent]", () => {
  it("fails fast when the web child exits before readiness", async () => {
    const child = spawn(process.execPath, ["-e", "process.exit(3);"], { stdio: "ignore" });
    const failure = await waitForWebReady({ url: "http://127.0.0.1:9/", timeoutMs: 10_000, child }).then(
      () => undefined,
      (error: unknown) => error as DemoError,
    );
    expect(failure?.code).toBe("demo_web_failed");
    expect(failure?.format()).toContain("error[demo_web_failed]");
  });

  it("times out when nothing answers the web URL", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000);"], { stdio: "ignore" });
    try {
      const failure = await waitForWebReady({ url: "http://127.0.0.1:9/", timeoutMs: 1_200, child }).then(
        () => undefined,
        (error: unknown) => error as DemoError,
      );
      expect(failure?.code).toBe("demo_web_not_ready");
      expect(failure?.remediation).toContain("retry");
    } finally {
      child.kill("SIGKILL");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  });

  it("rebuilds workspace packages and reports build failures", async () => {
    let output = "";
    await buildWorkspacePackages({ root: ROOT, stderr: (chunk) => { output += chunk; } });
    expect(output).toContain("tsc -b");
    const empty = mkdtempSync(join(tmpdir(), "demo-no-build-"));
    temporary.push(empty);
    const failure = await buildWorkspacePackages({ root: empty, stderr: () => undefined }).then(
      () => undefined,
      (error: unknown) => error as DemoError,
    );
    expect(failure?.code).toBe("demo_build_failed");
    expect(failure?.remediation).toContain("npm run build");
  }, { timeout: 120_000 });

  it("cleans only the planned demo Next directory", async () => {
    const webDir = mkdtempSync(join(tmpdir(), "demo-webdir-"));
    temporary.push(webDir);
    const demoCache = join(webDir, ".next-demo-test-clean");
    const normalCache = join(webDir, ".next");
    mkdirSync(demoCache, { recursive: true });
    mkdirSync(normalCache, { recursive: true });
    writeFileSync(join(demoCache, "stale.txt"), "stale");
    writeFileSync(join(normalCache, "keep.txt"), "keep");

    const plan = {
      ...planDemo({ root: ROOT, nextDistDirName: ".next-demo-test-clean" }),
      webDir,
      nextDistDir: demoCache,
    };
    await cleanDemoNextDir(plan, () => undefined);
    expect(existsSync(demoCache)).toBe(false);
    expect(existsSync(join(normalCache, "keep.txt"))).toBe(true);

    const hostile = { ...plan, nextDistDir: normalCache, nextDistDirName: ".next" };
    await expect(cleanDemoNextDir(hostile, () => undefined)).rejects.toBeInstanceOf(Error);
  });
});
