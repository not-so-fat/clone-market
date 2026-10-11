import { afterEach, describe, expect, it, vi } from "vitest";

describe("demo Next.js cache isolation [agent]", () => {
  afterEach(() => {
    delete process.env.CLONE_MARKET_DEMO;
    vi.resetModules();
  });

  it("uses the isolated demo cache when CLONE_MARKET_DEMO=1", async () => {
    vi.resetModules();
    process.env.CLONE_MARKET_DEMO = "1";
    const demo = await import("../../apps/web/next.config.js");
    expect(demo.default.distDir).toBe(".next-demo");
  });

  it("uses the normal cache otherwise", async () => {
    vi.resetModules();
    delete process.env.CLONE_MARKET_DEMO;
    const normal = await import("../../apps/web/next.config.js");
    expect(normal.default.distDir).toBe(".next");
  });
});
