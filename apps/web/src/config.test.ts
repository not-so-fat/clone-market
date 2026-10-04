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
    expect(config.artifactDirectory).toBe(join(root, "data/artifacts"));
  });

  it("does not default a Botmancers API URL; unset means declared capabilities", () => {
    const config = readConfig({ CLONE_MARKET_ROOT: findCloneMarketRoot() });
    expect(config.botmancersBaseUrl).toBeUndefined();
    expect(config.botmancersUiBaseUrl).toBeUndefined();
  });

  it("keeps an explicit Botmancers API URL when the operator sets one", () => {
    expect(readConfig({
      CLONE_MARKET_ROOT: findCloneMarketRoot(),
      CLONE_MARKET_BOTMANCERS_BASE_URL: "http://127.0.0.1:43123/",
    }).botmancersBaseUrl).toBe("http://127.0.0.1:43123/");
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
