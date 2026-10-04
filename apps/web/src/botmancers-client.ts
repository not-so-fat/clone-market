import {
  BotmancersHttpClient,
  DeclaredBotmancersCapabilitiesClient,
  type BotmancersClient,
} from "@clone-market/target-botmancers";

import type { WebConfig } from "./config.js";

/** Use declared capabilities unless an operator explicitly configured a Botmancers API URL. */
export function createWebBotmancersClient(config: Pick<WebConfig, "botmancersBaseUrl">): BotmancersClient {
  if (config.botmancersBaseUrl === undefined) {
    return new DeclaredBotmancersCapabilitiesClient();
  }
  return new BotmancersHttpClient({ baseUrl: config.botmancersBaseUrl });
}
