import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { botmancersBotUrl } from "./botmancers-url.js";

describe("Botmancers return URL [agent]", () => {
  it("builds bots/<id> and is the helper CloneReview renders", () => {
    expect(botmancersBotUrl("http://127.0.0.1:3100/", "bot-1")).toBe("http://127.0.0.1:3100/bots/bot-1");
    const review = readFileSync(
      fileURLToPath(new URL("../app/templates/[provider]/[externalId]/clone-review.tsx", import.meta.url)),
      "utf8",
    );
    expect(review).toContain('from "../../../../src/botmancers-url"');
    expect(review).toContain("botmancersBotUrl(botmancersUiBaseUrl, result.result.targetReference)");
  });
});
