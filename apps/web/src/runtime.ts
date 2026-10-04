import { SqliteCatalogRepository } from "@clone-market/catalog";
import { EvidenceService, SqliteEvidenceRepository } from "@clone-market/evidence";
import { GrokMarketplaceAdapter } from "@clone-market/source-grok";
import { BotmancersHttpClient } from "@clone-market/target-botmancers";
import { readConfig } from "./config.js";
import { MarketService } from "./market.js";

let instance: MarketService | undefined;

export function marketService(): MarketService {
  if (instance) return instance;
  const config = readConfig();
  const catalog = new SqliteCatalogRepository(config.catalogDatabase);
  const evidence = new SqliteEvidenceRepository(config.evidenceDatabase);
  const grok = new GrokMarketplaceAdapter({ baseUrl: config.grokBaseUrl });
  instance = new MarketService({
    catalog,
    evidence: new EvidenceService(evidence),
    source(provider) {
      if (provider !== grok.source) throw new RangeError(`Unsupported source ${provider}`);
      return grok;
    },
    botmancers: new BotmancersHttpClient({ baseUrl: config.botmancersBaseUrl }),
  });
  return instance;
}
