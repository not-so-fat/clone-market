export type WebConfig = {
  catalogDatabase: string;
  evidenceDatabase: string;
  grokBaseUrl: string;
  botmancersBaseUrl: string;
  botmancersUiBaseUrl: string;
};

export function readConfig(environment: NodeJS.ProcessEnv = process.env): WebConfig {
  return {
    catalogDatabase: environment.CLONE_MARKET_CATALOG_DB ?? "./data/catalog.sqlite",
    evidenceDatabase: environment.CLONE_MARKET_EVIDENCE_DB ?? "./data/evidence.sqlite",
    grokBaseUrl: environment.CLONE_MARKET_GROK_BASE_URL ?? "https://x.ai/bot/marketplace/",
    botmancersBaseUrl: environment.CLONE_MARKET_BOTMANCERS_BASE_URL ?? "https://api.botmancers.com/",
    botmancersUiBaseUrl: environment.CLONE_MARKET_BOTMANCERS_UI_BASE_URL ?? "http://127.0.0.1:3100/",
  };
}
