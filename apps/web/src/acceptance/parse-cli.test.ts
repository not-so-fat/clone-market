import { describe, expect, it } from "vitest";

import { parseAcceptanceCli, resolveLiveMode } from "./parse-cli.js";

describe("V0 acceptance CLI argv [agent]", () => {
  it("treats CLONE_MARKET_ACCEPTANCE_LIVE=1 as live even when --live is swallowed", () => {
    expect(resolveLiveMode([], {}).live).toBe(false);
    expect(resolveLiveMode(["--live"], {}).error).toMatch(/CLONE_MARKET_ACCEPTANCE_LIVE=1/);
    expect(resolveLiveMode([], { CLONE_MARKET_ACCEPTANCE_LIVE: "1" }).live).toBe(true);
    expect(resolveLiveMode(["--live"], { CLONE_MARKET_ACCEPTANCE_LIVE: "1" }).live).toBe(true);
  });

  it("forwards flags after a vite-node `--` and after the script path", () => {
    expect(parseAcceptanceCli(["--live", "--template", "grok-marketplace:bot-1"])).toMatchObject({
      wantsLive: true,
      template: "grok-marketplace:bot-1",
    });
    expect(parseAcceptanceCli(["--", "--live", "--template", "x"])).toMatchObject({
      wantsLive: true,
      template: "x",
    });
    expect(parseAcceptanceCli(["apps/web/src/acceptance/cli.ts", "--", "--live"])).toMatchObject({
      wantsLive: true,
    });
  });
});
