import { pathToFileURL } from "node:url";

import { GrokMarketplaceAdapter } from "./adapter.js";
import { SourceRequestError, SourceSchemaDriftError } from "./errors.js";

export type LiveSmokeResult =
  | {
      status: "passed";
      index: { count: number; featuredCount: number; url: string; retrievedAt: string };
      detail: { source: { provider: string; externalId: string }; url: string; retrievedAt: string };
    }
  | {
      status: "inconclusive";
      reason: "source_request_failed";
      source: { url: string; status?: number; attempts: number };
    };

export async function runLiveSmoke(adapter = new GrokMarketplaceAdapter()): Promise<LiveSmokeResult> {
  try {
    const index = await adapter.listTemplates();
    const first = index.templates[0];
    if (first === undefined) throw new Error("Grok Marketplace returned an empty index");
    const detail = await adapter.getTemplate(first.provenance.source);
    return {
      status: "passed",
      index: {
        count: index.templates.length,
        featuredCount: index.templates.filter((template) => template.featured).length,
        url: first.provenance.url.replace(/\/bots\/[^/]+$/, "/"),
        retrievedAt: first.provenance.retrievedAt,
      },
      detail: { source: detail.source, url: detail.provenanceUrl, retrievedAt: detail.retrievedAt },
    };
  } catch (error) {
    if (error instanceof SourceRequestError) {
      return {
        status: "inconclusive",
        reason: "source_request_failed",
        source: {
          url: error.url,
          attempts: error.attempts,
          ...(error.status === undefined ? {} : { status: error.status }),
        },
      };
    }
    throw error;
  }
}

async function main(): Promise<void> {
  try {
    console.log(JSON.stringify(await runLiveSmoke(), null, 2));
  } catch (error) {
    if (error instanceof SourceSchemaDriftError) console.error(JSON.stringify({ status: "failed", diagnostic: error.diagnostic }, null, 2));
    else console.error(error);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
