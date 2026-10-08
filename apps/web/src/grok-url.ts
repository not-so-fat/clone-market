export const GROK_BOT_URL_EXAMPLE = "https://x.ai/bot/marketplace/bots/<slug>";

export class GrokUrlError extends Error {
  constructor(
    readonly code: "invalid_grok_url" | "unsupported_grok_url",
    message: string,
  ) {
    super(message);
  }
}

const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;

/**
 * Strictly parse a canonical public Grok Bot URL of the form
 * `https://x.ai/bot/marketplace/bots/<slug>` and return its slug.
 *
 * Query strings and fragments are ignored. Anything else — malformed input,
 * another host, or another path shape — throws a typed, non-mutating error.
 */
export function parseGrokBotUrl(input: string): { slug: string } {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new GrokUrlError("invalid_grok_url", `Enter a Grok Bot Marketplace URL like ${GROK_BOT_URL_EXAMPLE}.`);
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new GrokUrlError("invalid_grok_url", `That is not a valid URL. Paste a full link like ${GROK_BOT_URL_EXAMPLE}.`);
  }
  const supportedShape = url.protocol === "https:"
    && url.hostname === "x.ai"
    && url.port === ""
    && url.username === ""
    && url.password === "";
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  const shapeMatches = supportedShape
    && segments.length === 4
    && segments[0] === "bot"
    && segments[1] === "marketplace"
    && segments[2] === "bots";
  if (!shapeMatches) {
    throw new GrokUrlError(
      "unsupported_grok_url",
      `Only public Grok Bot URLs like ${GROK_BOT_URL_EXAMPLE} are supported.`,
    );
  }
  let slug: string;
  try {
    slug = decodeURIComponent(segments[3]!);
  } catch {
    throw new GrokUrlError(
      "unsupported_grok_url",
      `Only public Grok Bot URLs like ${GROK_BOT_URL_EXAMPLE} are supported.`,
    );
  }
  if (slug.length === 0 || slug.length > 256 || slug === "." || slug === ".." || !SLUG_PATTERN.test(slug)) {
    throw new GrokUrlError(
      "unsupported_grok_url",
      `Only public Grok Bot URLs like ${GROK_BOT_URL_EXAMPLE} are supported.`,
    );
  }
  return { slug };
}
