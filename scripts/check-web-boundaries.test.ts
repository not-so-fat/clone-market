import { describe, expect, it } from "vitest";
import { checkWebBoundaries } from "./check-web-boundaries.mjs";

describe("web boundaries", () => {
  it("uses package public exports and contains no copied parser, classifier, planner, or payload mapper", async () => {
    expect(await checkWebBoundaries(process.cwd())).toEqual([]);
  });
});
