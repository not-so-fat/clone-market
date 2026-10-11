import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DEMO_CHOSEN_EXTERNAL_ID, DEMO_CHOSEN_SLUG } from "./constants.mjs";
import type { DemoError } from "./errors.mjs";
import { loadFixtureDocuments } from "./fixture-server.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("demo fixture documents [agent]", () => {
  it("loads the captured index and remapped detail deterministically", async () => {
    const first = await loadFixtureDocuments(ROOT);
    const second = await loadFixtureDocuments(ROOT);
    expect(second).toEqual(first);
    expect(first.indexHtml).toContain(DEMO_CHOSEN_SLUG);
    expect(first.indexHtml).toContain(DEMO_CHOSEN_EXTERNAL_ID);
    expect(first.indexHtml).toContain("Projects Manager");
    expect(first.detailHtml).toContain(DEMO_CHOSEN_SLUG);
    expect(first.detailHtml).toContain(DEMO_CHOSEN_EXTERNAL_ID);
    expect(first.detailHtml).not.toContain("project-steward");
  });

  it("fails with remediation when fixtures are missing", async () => {
    const failure = await loadFixtureDocuments("/tmp/demo-no-such-root").then(
      () => undefined,
      (error: unknown) => error as DemoError,
    );
    expect(failure?.code).toBe("demo_fixture_failed");
    expect(failure?.remediation).toContain("packages/source-grok/test/fixtures");
  });
});
