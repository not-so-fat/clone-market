import { afterEach, describe, expect, it, vi } from "vitest";

describe("demo Next.js cache isolation [agent]", () => {
  afterEach(() => {
    delete process.env.CLONE_MARKET_DEMO;
    delete process.env.CLONE_MARKET_DEMO_DIST_DIR;
    vi.resetModules();
  });

  it("uses the isolated demo cache when CLONE_MARKET_DEMO=1", async () => {
    vi.resetModules();
    process.env.CLONE_MARKET_DEMO = "1";
    const demo = await import("../../apps/web/next.config.js");
    expect(demo.default.distDir).toBe(".next-demo");
  });

  it("honors a per-run demo cache override", async () => {
    vi.resetModules();
    process.env.CLONE_MARKET_DEMO = "1";
    process.env.CLONE_MARKET_DEMO_DIST_DIR = ".next-demo-test-1";
    const demo = await import("../../apps/web/next.config.js");
    expect(demo.default.distDir).toBe(".next-demo-test-1");
  });

  it("uses the normal cache otherwise", async () => {
    vi.resetModules();
    delete process.env.CLONE_MARKET_DEMO;
    const normal = await import("../../apps/web/next.config.js");
    expect(normal.default.distDir).toBe(".next");
  });
});
