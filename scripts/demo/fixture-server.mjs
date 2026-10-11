// Local fixture source for `npm run demo`. Serves the captured Grok Marketplace
// index and detail fixtures over HTTP so the product's GrokMarketplaceAdapter
// (default fetch, configurable base URL) exercises URL resolution, stored-ID to
// public-slug lookup, manifest normalization, and preview mapping offline.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEMO_CHOSEN_EXTERNAL_ID, DEMO_CHOSEN_SLUG } from "./constants.mjs";
import { DemoError } from "./errors.mjs";

const FIXTURE_DIR = ["packages", "source-grok", "test", "fixtures"];
const INDEX_FIXTURE = "marketplace-index-2026-10-02.html";
const DETAIL_FIXTURE = "template-full-featured.html";

/**
 * Load the captured fixtures. The detail document is remapped onto the demo's
 * chosen template exactly like apps/web/src/acceptance/fixtures.ts so the demo
 * and smoke:v0 share one fixture contract.
 */
export async function loadFixtureDocuments(root) {
  let indexHtml;
  let detailRaw;
  try {
    indexHtml = await readFile(join(root, ...FIXTURE_DIR, INDEX_FIXTURE), "utf8");
    detailRaw = await readFile(join(root, ...FIXTURE_DIR, DETAIL_FIXTURE), "utf8");
  } catch (error) {
    throw new DemoError(
      "demo_fixture_failed",
      `Captured Grok fixtures are missing under ${join(...FIXTURE_DIR)} (${error instanceof Error ? error.message : "unknown error"}).`,
      "restore the checkout (git status must be clean for packages/source-grok/test/fixtures), then retry.",
    );
  }
  const detailHtml = detailRaw
    .replaceAll("project-steward-public", DEMO_CHOSEN_SLUG)
    .replaceAll("project-steward", DEMO_CHOSEN_EXTERNAL_ID);
  return { indexHtml, detailHtml };
}

/**
 * Build the fixture HTTP handler. Every request is appended to requestLog as
 * { method, path } so tests can assert the index then public-slug sequence.
 */
export function createFixtureRequestHandler(documents, requestLog = []) {
  return (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requestLog.push({ method: request.method ?? "GET", path: url.pathname });
    if ((request.method ?? "GET") === "GET" && (url.pathname === "/bot/marketplace" || url.pathname === "/bot/marketplace/")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(documents.indexHtml);
      return;
    }
    if (
      (request.method ?? "GET") === "GET"
      && (url.pathname === `/bot/marketplace/bots/${DEMO_CHOSEN_SLUG}`
        || url.pathname === `/bot/marketplace/bots/${DEMO_CHOSEN_EXTERNAL_ID}`)
    ) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(documents.detailHtml);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  };
}

/**
 * Start the fixture source. Resolves with the listener, its base URL (suitable
 * for CLONE_MARKET_GROK_BASE_URL), the request log, and a close function.
 */
export async function startFixtureServer({ port, host, root, documents, requestLog = [] }) {
  const loaded = documents ?? await loadFixtureDocuments(root);
  const server = createServer(createFixtureRequestHandler(loaded, requestLog));
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      if (error?.code === "EADDRINUSE") {
        reject(new DemoError(
          "demo_port_occupied",
          `Fixture port ${port} is already in use.`,
          `stop the process on port ${port}, or rerun with --fixture-port <free-port>.`,
        ));
      } else {
        reject(new DemoError(
          "demo_fixture_failed",
          `Fixture source failed to listen on ${host}:${port} (${error?.code ?? error?.message ?? "unknown error"}).`,
          "rerun where loopback listeners are permitted, or choose another port with --fixture-port.",
        ));
      }
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  return {
    server,
    port: actualPort,
    baseUrl: `http://${host}:${actualPort}/bot/marketplace/`,
    requests: requestLog,
    async close() {
      await closeFixtureServer(server);
    },
  };
}

/** Release the fixture listener; in-flight sockets are destroyed first. */
export function closeFixtureServer(server) {
  return new Promise((resolve, reject) => {
    server.closeAllConnections?.();
    server.close((error) => {
      if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
      else resolve();
    });
  });
}
