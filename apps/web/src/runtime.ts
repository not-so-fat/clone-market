import { SqliteCatalogRepository } from "@clone-market/catalog";
import { GrokMarketplaceAdapter } from "@clone-market/source-grok";
import { BotmancersHttpClient } from "@clone-market/target-botmancers";
import { FileArtifactSink } from "./artifact-sink.js";
import { readConfig } from "./config.js";
import { MarketService } from "./market.js";

let instance: Promise<MarketService> | undefined;

async function createMarketService(): Promise<MarketService> {
  // The evidence package loads its SQL migration from the filesystem. Keeping
  // this public-package import request-time avoids webpack rewriting that URL.
  const { EvidenceService, SqliteEvidenceRepository } = await import(/* webpackIgnore: true */ "@clone-market/evidence");
  const config = readConfig();
  const catalog = new SqliteCatalogRepository(config.catalogDatabase);
  const evidence = new SqliteEvidenceRepository(config.evidenceDatabase);
  const grok = new GrokMarketplaceAdapter({ baseUrl: config.grokBaseUrl });
  return new MarketService({
    catalog,
    evidence: new EvidenceService(evidence),
    source(provider) {
      if (provider !== grok.source) throw new RangeError(`Unsupported source ${provider}`);
      return grok;
    },
    botmancers: new BotmancersHttpClient({ baseUrl: config.botmancersBaseUrl }),
    artifacts: new FileArtifactSink(config.artifactDirectory),
  });
}

export function marketService(): Promise<MarketService> {
  if (instance) return instance;
  instance = createMarketService();
  return instance;
}
