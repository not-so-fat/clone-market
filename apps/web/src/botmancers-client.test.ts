import { describe, expect, it } from "vitest";

import {
  BotmancersHttpClient,
  DeclaredBotmancersCapabilitiesClient,
  DECLARED_BOTMANCERS_CAPABILITIES,
} from "@clone-market/target-botmancers";

import { createWebBotmancersClient } from "./botmancers-client.js";

describe("web Botmancers client [agent]", () => {
  it("uses declared capabilities when no Botmancers API URL is configured", async () => {
    const client = createWebBotmancersClient({});
    expect(client).toBeInstanceOf(DeclaredBotmancersCapabilitiesClient);
    await expect(client.getCapabilities()).resolves.toEqual(DECLARED_BOTMANCERS_CAPABILITIES);
  });

  it("uses HTTP only when an operator configures a Botmancers API URL", () => {
    const client = createWebBotmancersClient({ botmancersBaseUrl: "http://127.0.0.1:43123/" });
    expect(client).toBeInstanceOf(BotmancersHttpClient);
  });
});
