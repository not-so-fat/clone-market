import { describe, expect, it } from "vitest";

import type { DemoError } from "./errors.mjs";
import { demoUsage, parseDemoArgs } from "./launcher.mjs";

describe("demo CLI arguments [agent]", () => {
  it("defaults to empty options", () => {
    expect(parseDemoArgs([], {})).toEqual({});
  });

  it("parses --help", () => {
    expect(parseDemoArgs(["--help"], {})).toEqual({ help: true });
    expect(parseDemoArgs(["-h"], {})).toEqual({ help: true });
    expect(demoUsage()).toContain("npm run demo");
  });

  it("parses space-separated and inline flags", () => {
    expect(parseDemoArgs(["--port", "3200"], {})).toEqual({ webPort: 3200 });
    expect(parseDemoArgs(["--port=3200"], {})).toEqual({ webPort: 3200 });
    expect(parseDemoArgs(["--fixture-port", "3201"], {})).toEqual({ fixturePort: 3201 });
    expect(parseDemoArgs(["--fixture-port=3201"], {})).toEqual({ fixturePort: 3201 });
    expect(parseDemoArgs(["--demo-dir", "/tmp/demo"], {})).toEqual({ demoDir: "/tmp/demo" });
    expect(parseDemoArgs(["--demo-dir=/tmp/demo"], {})).toEqual({ demoDir: "/tmp/demo" });
    expect(parseDemoArgs(["--skip-build"], {})).toEqual({ skipBuild: true });
  });

  it("treats blank values as unset", () => {
    expect(parseDemoArgs([], {
      CLONE_MARKET_DEMO_PORT: "",
      CLONE_MARKET_DEMO_FIXTURE_PORT: "  ",
      CLONE_MARKET_DEMO_DIR: "",
      CLONE_MARKET_DEMO_DIST_DIR: "",
    })).toEqual({});
    expect(parseDemoArgs(["--port", ""], {})).toEqual({});
  });

  it("reads CLONE_MARKET_DEMO_* environment with flags winning", () => {
    expect(parseDemoArgs([], {
      CLONE_MARKET_DEMO_PORT: "3210",
      CLONE_MARKET_DEMO_FIXTURE_PORT: "3211",
      CLONE_MARKET_DEMO_DIR: "/tmp/env-demo",
    })).toEqual({ webPort: 3210, fixturePort: 3211, demoDir: "/tmp/env-demo" });
    expect(parseDemoArgs(["--port", "3220"], { CLONE_MARKET_DEMO_PORT: "3210" })).toEqual({ webPort: 3220 });
    expect(parseDemoArgs([], { CLONE_MARKET_DEMO_DIST_DIR: ".next-demo-x" })).toEqual({ demoDistDir: ".next-demo-x" });
    try {
      parseDemoArgs([], { CLONE_MARKET_DEMO_DIST_DIR: ".next" });
      expect.unreachable("invalid dist dir should fail parsing");
    } catch (error) {
      expect((error as DemoError).code).toBe("demo_invalid_args");
    }
  });

  it("rejects unknown options, missing values, and invalid ports", () => {
    for (const argv of [["--bogus"], ["--port"], ["--port", "--skip-build"], ["--port", "abc"], ["--port", "0"], ["--fixture-port", "70000"]]) {
      try {
        parseDemoArgs(argv, {});
        expect.unreachable(`${argv.join(" ")} should fail parsing`);
      } catch (error) {
        expect((error as DemoError).code).toBe("demo_invalid_args");
        expect((error as DemoError).format()).toContain("error[demo_invalid_args]");
      }
    }
  });
});
