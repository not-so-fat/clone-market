// Shared helpers for loopback demo tests (CI/operator environments only; the
// restricted developer sandbox forbids listen()).
import { createServer } from "node:net";
import { expect } from "vitest";

import { SqliteCatalogRepository } from "@clone-market/catalog";
import { EvidenceService, SqliteEvidenceRepository } from "@clone-market/evidence";
import { GrokMarketplaceAdapter } from "@clone-market/source-grok";
import { DeclaredBotmancersCapabilitiesClient } from "@clone-market/target-botmancers";
import { MemoryArtifactSink } from "../../apps/web/src/artifact-sink.js";
import { MarketService } from "../../apps/web/src/market.js";

/** Allocate a currently-free loopback port (bind 0, read back, release). */
export async function allocatePort(host = "127.0.0.1"): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, host, () => resolve()));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("failed to allocate a loopback port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

/** Assert an HTTP listener is gone (post-shutdown port check). */
export async function expectConnectionRefused(url: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const failure = await fetch(url).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(TypeError);
    const code = (failure as { cause?: { code?: string } }).cause?.code;
    if (code === "ECONNREFUSED") return;
    // A fetch against a just-closed listener can reuse a stale pooled
    // keep-alive socket (UND_ERR_SOCKET) instead of opening a fresh
    // connection; retry so the check observes the released port.
    expect(code).toBe("UND_ERR_SOCKET");
  }
  throw new Error(`expected ECONNREFUSED from released port: ${url}`);
}

export type OpenMarket = {
  service: MarketService;
  close: () => void;
};

/**
 * Open a MarketService over seeded demo databases with a fresh-adapter
 * factory, mirroring the web runtime's per-request adapter construction.
 */
export function openMarketService(input: {
  catalogPath: string;
  evidencePath: string;
  grokBaseUrl: string;
  now: () => string;
}): OpenMarket {
  const catalog = new SqliteCatalogRepository(input.catalogPath);
  const evidenceRepository = new SqliteEvidenceRepository(input.evidencePath);
  const service = new MarketService({
    catalog,
    evidence: new EvidenceService(evidenceRepository),
    source: () => new GrokMarketplaceAdapter({ baseUrl: input.grokBaseUrl, maxRetries: 0, retryBaseMs: 0 }),
    botmancers: new DeclaredBotmancersCapabilitiesClient(),
    artifacts: new MemoryArtifactSink(),
    now: input.now,
  });
  return {
    service,
    close: () => {
      catalog.close();
      evidenceRepository.close();
    },
  };
}

/** Count catalog templates through the repository API. */
export async function countCatalogTemplates(catalogPath: string): Promise<number> {
  const repository = new SqliteCatalogRepository(catalogPath);
  try {
    let total = 0;
    let cursor: string | undefined;
    do {
      const page = await repository.listTemplates({ ...(cursor === undefined ? {} : { cursor }), limit: 100 });
      total += page.templates.length;
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return total;
  } finally {
    repository.close();
  }
}

/** List evidence rows for one template. */
export async function listEvidenceRows(evidencePath: string, templateId: string): Promise<string[]> {
  const repository = new SqliteEvidenceRepository(evidencePath);
  try {
    const rows = await repository.listEvidence(templateId);
    return rows.map((row) => row.id);
  } finally {
    repository.close();
  }
}
