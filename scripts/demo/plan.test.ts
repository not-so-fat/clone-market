import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEMO_ARTIFACT_DIR_NAME,
  DEMO_CATALOG_DATABASE,
  DEMO_DEFAULT_FIXTURE_PORT,
  DEMO_DEFAULT_WEB_PORT,
  DEMO_DIR_NAME,
  DEMO_EVIDENCE_DATABASE,
} from "./constants.mjs";
import type { DemoError } from "./errors.mjs";
import { ensureDemoRootWritable, planDemo, resolveRepoRoot, webChildEnv } from "./launcher.mjs";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("demo plan [agent]", () => {
  it("derives every path under the isolated demo root by default", () => {
    const plan = planDemo({ root: ROOT });
    expect(plan.root).toBe(resolve(ROOT));
    expect(plan.demoRoot).toBe(join(resolve(ROOT), DEMO_DIR_NAME));
    expect(plan.webDir).toBe(join(resolve(ROOT), "apps", "web"));
    expect(plan.catalogPath).toBe(join(plan.demoRoot, DEMO_CATALOG_DATABASE));
    expect(plan.evidencePath).toBe(join(plan.demoRoot, DEMO_EVIDENCE_DATABASE));
    expect(plan.artifactDir).toBe(join(plan.demoRoot, DEMO_ARTIFACT_DIR_NAME));
    expect(plan.webPort).toBe(DEMO_DEFAULT_WEB_PORT);
    expect(plan.fixturePort).toBe(DEMO_DEFAULT_FIXTURE_PORT);
    expect(plan.webUrl).toBe(`http://127.0.0.1:${DEMO_DEFAULT_WEB_PORT}/`);
    expect(plan.fixtureBaseUrl).toBe(`http://127.0.0.1:${DEMO_DEFAULT_FIXTURE_PORT}/bot/marketplace/`);
    expect(plan.nextDistDirName).toBe(".next-demo");
    expect(plan.nextDistDir).toBe(join(plan.webDir, ".next-demo"));
  });

  it("accepts suffixed demo caches and rejects anything else", () => {
    const plan = planDemo({ root: ROOT, nextDistDirName: ".next-demo-test-1" });
    expect(plan.nextDistDir).toBe(join(plan.webDir, ".next-demo-test-1"));
    for (const name of [".next", "dist", ".next-demo-", "../escape", ".next-demo/../escape", ""]) {
      try {
        planDemo({ root: ROOT, nextDistDirName: name });
        expect.unreachable(`dist dir ${name} should be rejected`);
      } catch (error) {
        expect((error as DemoError).code).toBe("demo_invalid_args");
      }
    }
  });

  it("treats a blank demo root as the default", () => {
    const plan = planDemo({ root: ROOT, demoRoot: "  " });
    expect(plan.demoRoot).toBe(join(resolve(ROOT), DEMO_DIR_NAME));
  });

  it("honors absolute overrides without touching operator paths", () => {
    const demoRoot = mkdtempSync(join(tmpdir(), "demo-plan-"));
    temporary.push(demoRoot);
    const plan = planDemo({ root: ROOT, demoRoot, webPort: 3210, fixturePort: 3211 });
    expect(plan.demoRoot).toBe(resolve(demoRoot));
    expect(plan.webUrl).toContain("3210");
    expect(plan.fixtureBaseUrl).toContain("3211");
    const serialized = JSON.stringify(plan);
    for (const operatorPath of [".env.local", "data/catalog.sqlite", "data/evidence.sqlite", "data/artifacts"]) {
      expect(serialized).not.toContain(operatorPath);
    }
  });

  it("builds a web child environment that overrides .env.local and scrubs Botmancers HTTP", () => {
    const plan = planDemo({ root: ROOT });
    const env = webChildEnv(plan, {
      CLONE_MARKET_CATALOG_DB: "/operator/catalog.sqlite",
      CLONE_MARKET_GROK_BASE_URL: "https://x.ai/bot/marketplace/",
      CLONE_MARKET_BOTMANCERS_BASE_URL: "http://127.0.0.1:43123/",
      CLONE_MARKET_BOTMANCERS_UI_BASE_URL: "http://127.0.0.1:43123/",
    });
    expect(env.CLONE_MARKET_DEMO).toBe("1");
    expect(env.CLONE_MARKET_DEMO_DIST_DIR).toBe(".next-demo");
    expect(env.CLONE_MARKET_CATALOG_DB).toBe(plan.catalogPath);
    expect(env.CLONE_MARKET_EVIDENCE_DB).toBe(plan.evidencePath);
    expect(env.CLONE_MARKET_ARTIFACT_DIR).toBe(plan.artifactDir);
    expect(env.CLONE_MARKET_GROK_BASE_URL).toBe(plan.fixtureBaseUrl);
    expect(env.CLONE_MARKET_BOTMANCERS_BASE_URL).toBeUndefined();
    expect(env.CLONE_MARKET_BOTMANCERS_UI_BASE_URL).toBeUndefined();
  });

  it("resolves the repository root from CLONE_MARKET_ROOT or the checkout", () => {
    expect(resolveRepoRoot({ CLONE_MARKET_ROOT: "/tmp/demo-root" })).toBe(resolve("/tmp/demo-root"));
    expect(resolveRepoRoot({})).toBe(resolve(ROOT));
  });

  it("proves demo-root writability without loopback, and fails on a file path", async () => {
    const demoRoot = mkdtempSync(join(tmpdir(), "demo-writable-"));
    temporary.push(demoRoot);
    const writable = planDemo({ root: ROOT, demoRoot: join(demoRoot, "nested", "demo") });
    await ensureDemoRootWritable(writable);
    expect(statSync(writable.artifactDir).isDirectory()).toBe(true);

    const filePath = join(mkdtempSync(join(tmpdir(), "demo-file-")), "demo");
    temporary.push(join(filePath, ".."));
    writeFileSync(filePath, "sentinel");
    const blocked = planDemo({ root: ROOT, demoRoot: filePath });
    const failure = await ensureDemoRootWritable(blocked).then(
      () => undefined,
      (error: unknown) => error as DemoError,
    );
    expect(failure?.code).toBe("demo_seed_failed");
    expect(failure?.remediation).toContain("--demo-dir");
  });
});
