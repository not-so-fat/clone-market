import { describe, expect, it } from "vitest";

import { GrokUrlError, parseGrokBotUrl } from "./grok-url.js";

describe("Grok Bot URL parsing [agent]", () => {
  it("accepts a canonical public Grok Bot URL", () => {
    expect(parseGrokBotUrl("https://x.ai/bot/marketplace/bots/projects-manager")).toEqual({ slug: "projects-manager" });
  });

  it("trims whitespace and ignores query strings, fragments, and a trailing slash", () => {
    expect(parseGrokBotUrl("  https://x.ai/bot/marketplace/bots/projects-manager/?ref=home#details  ")).toEqual({
      slug: "projects-manager",
    });
  });

  it("rejects malformed URLs as invalid_grok_url", () => {
    for (const input of ["", "   ", "not a url", "://missing-scheme", "https://"]) {
      try {
        parseGrokBotUrl(input);
        expect.unreachable(`expected ${JSON.stringify(input)} to throw`);
      } catch (error) {
        expect(error).toBeInstanceOf(GrokUrlError);
        expect((error as GrokUrlError).code).toBe("invalid_grok_url");
      }
    }
  });

  it("rejects unsupported hosts, schemes, and credentials as unsupported_grok_url", () => {
    for (
      const input of [
        "https://example.com/bot/marketplace/bots/projects-manager",
        "https://x.ai.evil.test/bot/marketplace/bots/projects-manager",
        "http://x.ai/bot/marketplace/bots/projects-manager",
        "https://x.ai:8443/bot/marketplace/bots/projects-manager",
        "https://user:pass@x.ai/bot/marketplace/bots/projects-manager",
      ]
    ) {
      try {
        parseGrokBotUrl(input);
        expect.unreachable(`expected ${input} to throw`);
      } catch (error) {
        expect(error).toBeInstanceOf(GrokUrlError);
        expect((error as GrokUrlError).code).toBe("unsupported_grok_url");
      }
    }
  });

  it("rejects unsupported paths and slugs as unsupported_grok_url", () => {
    for (
      const input of [
        "https://x.ai/bot/marketplace",
        "https://x.ai/bot/marketplace/",
        "https://x.ai/bot/marketplace/bots",
        "https://x.ai/bot/marketplace/bots/",
        "https://x.ai/bot/marketplace/bots/a/b",
        "https://x.ai/bots/projects-manager",
        "https://x.ai/other/path",
        "https://x.ai/bot/marketplace/bots/%2e%2e",
        "https://x.ai/bot/marketplace/bots/has%20space",
      ]
    ) {
      try {
        parseGrokBotUrl(input);
        expect.unreachable(`expected ${input} to throw`);
      } catch (error) {
        expect(error).toBeInstanceOf(GrokUrlError);
        expect((error as GrokUrlError).code).toBe("unsupported_grok_url");
      }
    }
  });
});
