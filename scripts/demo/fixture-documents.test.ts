import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DEMO_CHOSEN_EXTERNAL_ID, DEMO_CHOSEN_SLUG } from "./constants.mjs";
import type { DemoError } from "./errors.mjs";
import type { FixtureRequest } from "./fixture-server.mjs";
import { createFixtureRequestHandler, loadFixtureDocuments } from "./fixture-server.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function serve(
  handler: (request: { url?: string; method?: string }, response: unknown) => void,
  url: string,
  method = "GET",
): { status: number; body: string } {
  let status = 0;
  let body = "";
  handler({ url, method }, {
    writeHead: (code: number) => {
      status = code;
    },
    end: (chunk: string) => {
      body = chunk;
    },
  });
  return { status, body };
}

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

  it("routes index, public-slug detail, and 404s without loopback", async () => {
    const documents = await loadFixtureDocuments(ROOT);
    const requests: FixtureRequest[] = [];
    const handler = createFixtureRequestHandler(documents, requests);

    expect(serve(handler, "/bot/marketplace/")).toEqual({ status: 200, body: documents.indexHtml });
    expect(serve(handler, "/bot/marketplace")).toEqual({ status: 200, body: documents.indexHtml });
    expect(serve(handler, `/bot/marketplace/bots/${DEMO_CHOSEN_SLUG}`)).toEqual({ status: 200, body: documents.detailHtml });
    expect(serve(handler, `/bot/marketplace/bots/${DEMO_CHOSEN_EXTERNAL_ID}`)).toEqual({ status: 200, body: documents.detailHtml });
    expect(serve(handler, "/bot/marketplace/bots/no-such-bot").status).toBe(404);
    expect(serve(handler, "/bot/marketplace/", "POST").status).toBe(404);
    expect(requests).toEqual([
      { method: "GET", path: "/bot/marketplace/" },
      { method: "GET", path: "/bot/marketplace" },
      { method: "GET", path: `/bot/marketplace/bots/${DEMO_CHOSEN_SLUG}` },
      { method: "GET", path: `/bot/marketplace/bots/${DEMO_CHOSEN_EXTERNAL_ID}` },
      { method: "GET", path: "/bot/marketplace/bots/no-such-bot" },
      { method: "POST", path: "/bot/marketplace/" },
    ]);
  });
});
