import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { checkBoundaries } from "./check-boundaries.mjs";

const execFileAsync = promisify(execFile);

describe("package boundary checker", () => {
  it("reports every forbidden workspace edge with package names", async () => {
    const root = fileURLToPath(new URL("./__fixtures__/invalid-boundaries", import.meta.url));

    await expect(checkBoundaries(root)).resolves.toEqual([
      "@fixture/core (core) -> @fixture/product (product): core cannot depend on another workspace package",
      "@fixture/source (source) -> @fixture/target (target): source packages cannot depend on target packages",
      "@fixture/target (target) -> @fixture/source (source): target packages cannot depend on source packages",
    ]);
  });

  it("exits nonzero and prints offending edges", async () => {
    const root = fileURLToPath(new URL("./__fixtures__/invalid-boundaries", import.meta.url));
    const checker = fileURLToPath(new URL("./check-boundaries.mjs", import.meta.url));

    await expect(execFileAsync(process.execPath, [checker, "--root", root])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("@fixture/source (source) -> @fixture/target (target)"),
    });
  });
});
