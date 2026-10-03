import { readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SCHEMA_VERSION,
  type BotTemplateManifest,
  type CatalogRecord,
  type SourceAdapter,
  type SourceIdentity,
  type Template,
} from "@clone-market/core";
import { GrokMarketplaceAdapter, type FetchResponse } from "@clone-market/source-grok";
import { afterEach, describe, expect, it } from "vitest";

import { CatalogService, SqliteCatalogRepository, runCatalogReconciliation } from "./index.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

const temporaryDirectories: string[] = [];
const fixtureTime = "2026-10-02T18:30:00.000Z";

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "clone-market-catalog-"));
  temporaryDirectories.push(directory);
  return join(directory, "catalog.sqlite");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function template(externalId: string, retrievedAt: string, overrides: Partial<Template> = {}): Template {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `fixture:${externalId}`,
    name: `Template ${externalId}`,
    summary: "Public summary",
    creator: { id: "creator-1", name: "Creator One" },
    categories: ["Productivity"],
    firstSeenAt: retrievedAt,
    lastSeenAt: retrievedAt,
    featured: false,
    provenance: {
      schemaVersion: SCHEMA_VERSION,
      source: { provider: "fixture", externalId },
      retrievedAt,
      url: `https://example.test/templates/${externalId}`,
    },
    ...overrides,
  };
}

class FixtureAdapter implements SourceAdapter {
  readonly source = "fixture";
  templates: Template[];

  constructor(templates: Template[]) {
    this.templates = templates;
  }

  async listTemplates() {
    return { templates: this.templates };
  }

  async fetchTemplate(_source: SourceIdentity): Promise<unknown> {
    throw new Error("Catalog reconciliation must not fetch full templates");
  }

  async normalizeTemplate(_input: unknown, _retrievedAt: string): Promise<BotTemplateManifest> {
    throw new Error("Catalog reconciliation must not normalize full templates");
  }

  getCatalogMetadata(source: SourceIdentity) {
    return { installCount: source.externalId.length };
  }
}

describe("captured Grok index integration", () => {
  it("reconciles all 89 records twice without duplicate rows or snapshots", async () => {
    const path = await databasePath();
    const body = readFileSync(new URL("../../source-grok/test/fixtures/marketplace-index-2026-10-02.html", import.meta.url), "utf8");
    const response: FetchResponse = { ok: true, status: 200, text: async () => body };
    const adapter = new GrokMarketplaceAdapter({ fetch: async () => response, now: () => fixtureTime });
    const repository = new SqliteCatalogRepository(path);
    const service = new CatalogService(repository);

    const first = await service.reconcile(adapter);
    const second = await service.reconcile(adapter);
    const listed = await service.listTemplates({ source: adapter.source, limit: 100 });
    const histories = await Promise.all(listed.templates.map((entry) => service.getSourceHistory(entry.provenance.source)));

    expect(first).toEqual({
      source: "grok-marketplace", retrievedAt: fixtureTime, total: 89,
      added: 89, changed: 0, removed: 0, reappeared: 0, unchanged: 0,
    });
    expect(second).toEqual({
      source: "grok-marketplace", retrievedAt: fixtureTime, total: 89,
      added: 0, changed: 0, removed: 0, reappeared: 0, unchanged: 89,
    });
    expect(listed.templates).toHaveLength(89);
    expect(histories.flat()).toHaveLength(89);
    expect(listed.templates.every((entry) => entry.sourceMetadata.installCount === 0)).toBe(true);
    repository.close();
  });

  it("returns a machine-readable report from the library harness", async () => {
    const path = await databasePath();
    const report = await runCatalogReconciliation({
      adapter: new FixtureAdapter([template("one", fixtureTime)]),
      databasePath: path,
    });
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(report).toMatchObject({ total: 1, added: 1 });
  });
});

describe("deterministic reconciliation", () => {
  it("tracks changed, missing, and reappearing templates with stable first/last seen history", async () => {
    const path = await databasePath();
    const repository = new SqliteCatalogRepository(path);
    const adapter = new FixtureAdapter([
      template("a", "2026-01-01T00:00:00.000Z"),
      template("b", "2026-01-01T00:00:00.000Z"),
    ]);
    const service = new CatalogService(repository);
    await service.reconcile(adapter);

    adapter.templates = [
      template("a", "2026-01-02T00:00:00.000Z", { summary: "Changed summary", featured: true }),
      template("c", "2026-01-02T00:00:00.000Z"),
    ];
    expect(await service.reconcile(adapter)).toMatchObject({ added: 1, changed: 1, removed: 1, reappeared: 0, unchanged: 0 });
    expect(await service.getTemplate({ provider: "fixture", externalId: "b" })).toMatchObject({
      present: false,
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      lastRetrievedAt: "2026-01-02T00:00:00.000Z",
    });

    adapter.templates = [
      template("a", "2026-01-03T00:00:00.000Z", { summary: "Changed summary", featured: true }),
      template("b", "2026-01-03T00:00:00.000Z"),
      template("c", "2026-01-03T00:00:00.000Z"),
    ];
    expect(await service.reconcile(adapter)).toMatchObject({ added: 0, changed: 0, removed: 0, reappeared: 1, unchanged: 2 });
    expect(await service.getTemplate({ provider: "fixture", externalId: "b" })).toMatchObject({
      present: true,
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-03T00:00:00.000Z",
    });
    expect((await service.getSourceHistory({ provider: "fixture", externalId: "a" })).map(({ change }) => change)).toEqual(["added", "changed"]);
    const bHistory = await service.getSourceHistory({ provider: "fixture", externalId: "b" });
    expect(bHistory.map(({ change }) => change)).toEqual(["added", "removed", "reappeared"]);
    expect(bHistory.map(({ capturedAt }) => capturedAt)).toEqual([
      "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "2026-01-03T00:00:00.000Z",
    ]);
    expect((await service.listTemplates({ category: "Productivity", featured: true })).templates.map(({ id }) => id)).toEqual(["fixture:a"]);
    expect((await service.listTemplates({ present: false })).templates).toEqual([]);
    repository.close();
  });

  it("supports source-neutral identity lookup, creator filters, and stable pagination", async () => {
    const repository = new SqliteCatalogRepository(":memory:");
    const service = new CatalogService(repository);
    const adapter = new FixtureAdapter([
      template("c", fixtureTime, { name: "Charlie", creator: { name: "Another Creator" } }),
      template("a", fixtureTime, { name: "Alpha" }),
      template("b", fixtureTime, { name: "Bravo" }),
    ]);
    await service.reconcile(adapter);

    await expect(service.getTemplate({ provider: "fixture", externalId: "b" })).resolves.toMatchObject({
      id: "fixture:b",
      name: "Bravo",
    });
    await expect(service.getTemplate({ provider: "other", externalId: "b" })).resolves.toBeUndefined();
    await expect(service.listTemplates({ creator: "creator-1" })).resolves.toMatchObject({
      templates: [{ name: "Alpha" }, { name: "Bravo" }],
    });
    await expect(service.listTemplates({ creator: "Another Creator" })).resolves.toMatchObject({
      templates: [{ name: "Charlie" }],
    });

    const first = await service.listTemplates({ limit: 2 });
    expect(first.templates.map(({ name }) => name)).toEqual(["Alpha", "Bravo"]);
    expect(first.nextCursor).toBe("2");
    if (first.nextCursor === undefined) throw new Error("Expected another catalog page");
    await expect(service.listTemplates({ cursor: first.nextCursor, limit: 2 })).resolves.toMatchObject({
      templates: [{ name: "Charlie" }],
    });
    repository.close();
  });
});

describe("storage boundary and migrations", () => {
  it("rejects full-manifest fields at the repository boundary without writing a row", async () => {
    const repository = new SqliteCatalogRepository(":memory:");
    const unsafe = {
      template: template("unsafe", fixtureTime),
      sourceMetadata: {},
      instructions: "central secret",
      memories: [{ content: "do not store" }],
      skills: [],
      routines: [],
      integrations: [],
      credentials: { token: "nope" },
    };
    await expect(repository.reconcile({
      source: "fixture",
      retrievedAt: fixtureTime,
      records: [unsafe as unknown as CatalogRecord],
    })).rejects.toThrow();
    expect((await repository.listTemplates({ limit: 10 })).templates).toEqual([]);
    repository.close();
  });

  it("rejects forbidden fields nested in source metadata", async () => {
    const repository = new SqliteCatalogRepository(":memory:");
    for (const field of ["instructions", "memories", "skills", "routines", "integrations", "credentials", "manifest"]) {
      const unsafe = {
        template: template(`unsafe-${field}`, fixtureTime),
        sourceMetadata: { [field]: "must not be persisted" },
      };
      await expect(repository.reconcile({
        source: "fixture",
        retrievedAt: fixtureTime,
        records: [unsafe as unknown as CatalogRecord],
      })).rejects.toThrow();
    }
    expect((await repository.listTemplates({ limit: 10 })).templates).toEqual([]);
    repository.close();
  });

  it("migrates a clean database and exposes no forbidden manifest columns", async () => {
    const path = await databasePath();
    const repository = new SqliteCatalogRepository(path);
    repository.close();
    const database = new DatabaseSync(path);
    const version = database.prepare("PRAGMA user_version").get() as { user_version: number | bigint };
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
    const columns = database.prepare("PRAGMA table_info(catalog_templates)").all() as Array<{ name: string }>;
    expect(Number(version.user_version)).toBe(1);
    expect(tables.map(({ name }) => name)).toEqual(["catalog_retrievals", "catalog_snapshots", "catalog_templates"]);
    expect(columns.map(({ name }) => name)).not.toEqual(expect.arrayContaining([
      "instructions", "memories", "skills", "routines", "integrations", "credentials", "manifest",
    ]));
    database.close();
  });

  it("refuses to open a database created by a newer catalog version", async () => {
    const path = await databasePath();
    const database = new DatabaseSync(path);
    database.exec("PRAGMA user_version = 2");
    database.close();
    expect(() => new SqliteCatalogRepository(path)).toThrow(
      "Catalog database version 2 is newer than supported version 1",
    );
  });

  it("keeps production catalog code independent from Grok implementation paths", () => {
    for (const file of ["service.ts", "harness.ts", "sqlite-repository.ts", "index.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toContain("@clone-market/source-grok");
      expect(source).not.toContain("packages/source-grok");
    }
  });
});
