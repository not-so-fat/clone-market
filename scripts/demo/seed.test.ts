import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteCatalogRepository } from "@clone-market/catalog";
import { SqliteEvidenceRepository } from "@clone-market/evidence";
import { DEMO_CHOSEN_EXTERNAL_ID, DEMO_CHOSEN_PROVIDER, DEMO_CHOSEN_SLUG, DEMO_CHOSEN_TEMPLATE_ID } from "./constants.mjs";
import { loadFixtureDocuments } from "./fixture-server.mjs";
import type { DemoSeedResult } from "./seed.mjs";
import { demoEvidenceRows, prepareDemoDatabases } from "./seed.mjs";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

type FetchResult = { ok: boolean; status: number; text(): Promise<string> };

async function catalogCount(catalogPath: string): Promise<{ total: number; chosenName: string | undefined; chosenSlug: string | undefined }> {
  const repository = new SqliteCatalogRepository(catalogPath);
  try {
    let total = 0;
    let chosenName: string | undefined;
    let chosenSlug: string | undefined;
    let cursor: string | undefined;
    do {
      const page = await repository.listTemplates({ ...(cursor === undefined ? {} : { cursor }), limit: 100 });
      for (const entry of page.templates) {
        total += 1;
        if (entry.provenance.source.externalId === DEMO_CHOSEN_EXTERNAL_ID) {
          chosenName = entry.name;
          chosenSlug = entry.provenance.url.split("/").filter((segment) => segment.length > 0).at(-1);
        }
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return { total, chosenName, chosenSlug };
  } finally {
    repository.close();
  }
}

async function historyLength(catalogPath: string): Promise<number> {
  const repository = new SqliteCatalogRepository(catalogPath);
  try {
    const history = await repository.getSourceHistory({ provider: DEMO_CHOSEN_PROVIDER, externalId: DEMO_CHOSEN_EXTERNAL_ID });
    return history.length;
  } finally {
    repository.close();
  }
}

describe("demo seed [agent]", () => {
  it("seeds the chosen template plus reviewed evidence, idempotently", async () => {
    const documents = await loadFixtureDocuments(ROOT);
    const fetchClient = async (url: string): Promise<FetchResult> => {
      if (url.endsWith("/bot/marketplace/") || url.endsWith("/bot/marketplace")) {
        return { ok: true, status: 200, text: async () => documents.indexHtml };
      }
      if (url.includes(`/bots/${DEMO_CHOSEN_SLUG}`) || url.includes(`/bots/${DEMO_CHOSEN_EXTERNAL_ID}`)) {
        return { ok: true, status: 200, text: async () => documents.detailHtml };
      }
      return { ok: false, status: 404, text: async () => "not found" };
    };
    const demoRoot = mkdtempSync(join(tmpdir(), "demo-seed-"));
    temporary.push(demoRoot);
    const input = {
      catalogPath: join(demoRoot, "catalog.sqlite"),
      evidencePath: join(demoRoot, "evidence.sqlite"),
      artifactDir: join(demoRoot, "artifacts"),
      grokBaseUrl: "http://127.0.0.1:9/bot/marketplace/",
      fetchClient,
    };

    const first: DemoSeedResult = await prepareDemoDatabases(input);
    expect(first.catalog.total).toBeGreaterThan(0);
    expect(first.catalog.added).toBe(first.catalog.total);
    expect(first.evidence.rows).toBe(3);
    expect(first.evidence.label).toBe("observed_use");

    const second: DemoSeedResult = await prepareDemoDatabases(input);
    expect(second.catalog.total).toBe(first.catalog.total);
    expect(second.catalog.added).toBe(0);
    expect(second.catalog.changed).toBe(0);
    expect(second.catalog.unchanged).toBe(first.catalog.total);
    expect(second.evidence.snapshotId).toBe(first.evidence.snapshotId);
    expect(second.evidence.label).toBe("observed_use");

    const catalog = await catalogCount(input.catalogPath);
    expect(catalog.total).toBe(first.catalog.total);
    expect(catalog.chosenName).toContain("Projects Manager");
    expect(catalog.chosenSlug).toBe(DEMO_CHOSEN_SLUG);
    expect(await historyLength(input.catalogPath)).toBe(1);

    const evidence = new SqliteEvidenceRepository(input.evidencePath);
    try {
      const rows = await evidence.listEvidence(DEMO_CHOSEN_TEMPLATE_ID);
      expect(rows.map((row) => row.id)).toEqual(["try-1", "try-2", "repeat-1"]);
      expect(await evidence.getLatestDerivation(DEMO_CHOSEN_TEMPLATE_ID)).toMatchObject({
        snapshot: { id: first.evidence.snapshotId, label: "observed_use" },
      });
    } finally {
      evidence.close();
    }

    expect(readdirSync(input.artifactDir)).toEqual([]);
    expect(demoEvidenceRows().map((row) => row.id)).toEqual(["try-1", "try-2", "repeat-1"]);
  });
});
