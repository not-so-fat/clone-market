import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { checkBoundaries } from "../../../scripts/check-boundaries.mjs";

describe("compatibility package boundary", () => {
  it("depends only on core and passes the repository boundary checker", async () => {
    const root = new URL("../../../", import.meta.url);
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { dependencies?: Record<string, string> };

    expect(packageJson.dependencies).toEqual({ "@clone-market/core": "0.1.0" });
    await expect(checkBoundaries(root.pathname)).resolves.toEqual([]);
  });
});
