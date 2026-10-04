import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { findCloneMarketRoot, readConfig, resolveCloneMarketDataPath } from "./config.js";

describe("web data path resolution [agent]", () => {
  it("resolves relative catalog and evidence paths against the clone-market root, not cwd", () => {
    const root = findCloneMarketRoot();
    expect(root.endsWith("clone-market") || root.includes("clone-market")).toBe(true);
    expect(resolveCloneMarketDataPath("./data/catalog.sqlite", root)).toBe(join(root, "data/catalog.sqlite"));
    expect(resolveCloneMarketDataPath("/abs/evidence.sqlite", root)).toBe("/abs/evidence.sqlite");
    const config = readConfig({
      CLONE_MARKET_ROOT: root,
      CLONE_MARKET_CATALOG_DB: "./data/catalog.sqlite",
      CLONE_MARKET_EVIDENCE_DB: "./data/evidence.sqlite",
    });
    expect(config.catalogDatabase).toBe(join(root, "data/catalog.sqlite"));
    expect(config.evidenceDatabase).toBe(join(root, "data/evidence.sqlite"));
  });

  it("defaults the Botmancers API to a local URL so copied env files do not target production", () => {
    expect(readConfig({ CLONE_MARKET_ROOT: findCloneMarketRoot() }).botmancersBaseUrl).toBe("http://127.0.0.1:8787/");
  });

  it("keeps operator absolute paths unchanged", () => {
    mkdirSync(join(process.cwd(), ".temporal/logs"), { recursive: true });
    writeFileSync(join(process.cwd(), ".temporal/logs/path-resolution.txt"), `${findCloneMarketRoot()}\n`);
    expect(readConfig({
      CLONE_MARKET_CATALOG_DB: "/var/clone-market/catalog.sqlite",
      CLONE_MARKET_EVIDENCE_DB: "/var/clone-market/evidence.sqlite",
    }).catalogDatabase).toBe("/var/clone-market/catalog.sqlite");
  });
});
