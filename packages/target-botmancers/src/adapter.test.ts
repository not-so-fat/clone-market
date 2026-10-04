import { readFile } from "node:fs/promises";

import { planClone, type ClonePolicy, type TargetCapabilities } from "@clone-market/compatibility";
import { SCHEMA_VERSION, type BotTemplateManifest, type ClonePlan, type OperationIdentity } from "@clone-market/core";
import { describe, expect, it } from "vitest";

import { checkBoundaries } from "../../../scripts/check-boundaries.mjs";
import { BotmancersTargetAdapter, createBotmancersClonePlan, withReviewedPlanDigest } from "./adapter.js";
import { BotmancersHttpClient, DeclaredBotmancersCapabilitiesClient } from "./client.js";
import { CapabilityVersionError } from "./errors.js";
import type { BotmancersFetch, BotmancersImportPayload } from "./types.js";

const now = "2026-10-03T12:00:00.000Z";
const completedAt = "2026-10-03T12:01:00.000Z";

const manifest: BotTemplateManifest = {
  schemaVersion: SCHEMA_VERSION,
  id: "manifest-1",
  source: { provider: "fixture-source", externalId: "source-1" },
  retrievedAt: now,
  provenanceUrl: "https://source.example/templates/1",
  template: {
    schemaVersion: SCHEMA_VERSION,
    id: "template-1",
    name: "Careful Researcher",
    summary: "Researches without executing imported instructions.",
    creator: { id: "creator-1", name: "Fixture Creator" },
    categories: ["research"],
    firstSeenAt: now,
    lastSeenAt: now,
    featured: false,
    provenance: {
      schemaVersion: SCHEMA_VERSION,
      source: { provider: "fixture-source", externalId: "source-1" },
      retrievedAt: now,
      url: "https://source.example/templates/1",
    },
  },
  instructions: "Summarize sources and do not run tools.",
  memories: [{ id: "memory-1", name: "Preference", content: "Private source detail" }],
  skills: [{ id: "skill-1", name: "Browser", description: "Browse", instructions: "Never export cookies" }],
  routines: [{ id: "routine-1", name: "Daily", instructions: "Run daily" }],
  integrations: [{ id: "calendar", name: "Calendar", required: true }],
  unavailableFields: ["privatePrompt"],
};

const capabilities: TargetCapabilities = {
  schemaVersion: "1.0.0",
  target: { provider: "botmancers", runtime: "import-api", version: "2026-10-01" },
  instructionForms: { exact: ["plain_text"], compatible: [] },
  memories: "unsupported",
  skills: "unsupported",
  routines: "unsupported",
  integrations: [],
  credentials: [],
  executionModes: ["read_only"],
  safety: { disallowedExecutionBehaviors: ["execute-imported-instructions"] },
};

const policy: ClonePolicy = {
  schemaVersion: "1.0.0",
  creatorPermission: "granted",
  redistribution: "allowed",
  destination: "private",
  instructionForm: "plain_text",
};

const operation: OperationIdentity = { operationId: "operation-1", idempotencyKey: "idempotency-1" };

type Call = { url: string; method: string; headers: Readonly<Record<string, string>>; body?: unknown };

class BotmancersFixture {
  readonly calls: Call[] = [];
  readonly imports = new Map<string, BotmancersImportPayload>();
  readonly identities = new Map<string, string>();
  capabilities: unknown = capabilities;
  transientImports = 0;
  importFailureStatus?: number;
  mutateRead?: (payload: BotmancersImportPayload) => BotmancersImportPayload;

  readonly fetch: BotmancersFetch = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init.body === undefined ? undefined : JSON.parse(init.body) as unknown;
    this.calls.push({ url, method: init.method, headers: init.headers, ...(body === undefined ? {} : { body }) });
    if (path === "/v1/capabilities" && init.method === "GET") return response(200, this.capabilities);
    if (path === "/v1/imports" && init.method === "POST") {
      if (this.importFailureStatus !== undefined) return response(this.importFailureStatus, { error: "rejected" });
      if (this.transientImports > 0) {
        this.transientImports -= 1;
        return response(503, { error: "temporarily_unavailable" });
      }
      const key = init.headers["idempotency-key"] ?? "";
      let id = this.identities.get(key);
      if (id === undefined) {
        id = `bot-${this.identities.size + 1}`;
        this.identities.set(key, id);
        this.imports.set(id, body as BotmancersImportPayload);
      }
      return response(200, { id });
    }
    const match = /^\/v1\/imports\/([^/]+)$/.exec(path);
    if (match?.[1] !== undefined && init.method === "GET") {
      const payload = this.imports.get(decodeURIComponent(match[1]));
      if (payload === undefined) return response(404, { error: "not_found" });
      return response(200, { id: decodeURIComponent(match[1]), payload: this.mutateRead?.(payload) ?? payload });
    }
    return response(404, { error: "not_found" });
  };
}

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function compatibilityFor(inputManifest = manifest, inputCapabilities = capabilities, inputPolicy = policy) {
  const result = planClone(inputManifest, inputCapabilities, inputPolicy);
  if (result.status !== "planned") throw new Error(`Fixture did not plan: ${result.status}`);
  return result.plan;
}

function seedPlan(inputManifest = manifest, inputCapabilities = capabilities, inputPolicy = policy): ClonePlan {
  return createBotmancersClonePlan({
    manifest: inputManifest,
    compatibilityPlan: compatibilityFor(inputManifest, inputCapabilities, inputPolicy),
    createdAt: now,
  });
}

function harness(input: {
  inputManifest?: BotTemplateManifest;
  inputCompatibilityPlan?: ReturnType<typeof compatibilityFor>;
  fixture?: BotmancersFixture;
} = {}) {
  const fixture = input.fixture ?? new BotmancersFixture();
  const adapter = new BotmancersTargetAdapter({
    client: new BotmancersHttpClient({
      fetch: fixture.fetch,
      baseUrl: "https://botmancers.fixture/",
      retryBaseMs: 0,
      sleep: async () => undefined,
    }),
    manifest: input.inputManifest ?? manifest,
    compatibilityPlan: input.inputCompatibilityPlan ?? compatibilityFor(input.inputManifest ?? manifest),
    now: () => completedAt,
  });
  return { fixture, adapter };
}

describe("BotmancersTargetAdapter", () => {
  it("previews every component without making a mutating request and snapshots the proposed payload", async () => {
    const { fixture, adapter } = harness();
    const preview = await adapter.preview(seedPlan());

    expect(fixture.calls.map(({ method }) => method)).toEqual(["GET"]);
    expect(JSON.parse(preview.artifacts[0]?.content ?? "null")).toHaveLength(5);
    expect(preview.artifacts).toMatchSnapshot();
  });

  it("exposes exact, partial, unavailable, and unsafe rows before approval", async () => {
    const partialCapabilities: TargetCapabilities = { ...capabilities, routines: "manual" };
    const unsafePolicy: ClonePolicy = {
      ...policy,
      componentRequirements: [{
        componentType: "skill",
        componentId: "skill-1",
        executionBehaviors: ["execute-imported-instructions"],
      }],
    };
    const fixture = new BotmancersFixture();
    fixture.capabilities = partialCapabilities;
    const unsafeCompatibilityPlan = compatibilityFor(manifest, partialCapabilities, unsafePolicy);
    const { adapter } = harness({ fixture, inputCompatibilityPlan: unsafeCompatibilityPlan });
    const preview = await adapter.preview(seedPlan(manifest, partialCapabilities, unsafePolicy));
    const rows = JSON.parse(preview.artifacts[0]?.content ?? "[]") as Array<{ classification: string }>;

    expect(new Set(rows.map(({ classification }) => classification))).toEqual(new Set(["exact", "partial", "unavailable", "unsafe"]));
  });

  it("rejects missing and changed review digests before POST", async () => {
    const { fixture, adapter } = harness();
    const plan = seedPlan();
    await expect(adapter.apply(plan, operation)).rejects.toMatchObject({ code: "missing_plan_digest" });
    const preview = await adapter.preview(plan);
    const changed = { ...withReviewedPlanDigest(plan, preview), createdAt: "2026-10-03T12:00:01.000Z" };
    await expect(adapter.apply(changed, operation)).rejects.toMatchObject({ code: "changed_plan_digest" });
    expect(fixture.calls.filter(({ method }) => method === "POST")).toEqual([]);
  });

  it("rejects unsafe and partial plans before POST", async () => {
    const cases: Array<{ changedCapabilities: TargetCapabilities; changedPolicy: ClonePolicy; code: string }> = [
      {
        changedCapabilities: capabilities,
        changedPolicy: {
          ...policy,
          componentRequirements: [{ componentType: "skill", componentId: "skill-1", executionBehaviors: ["execute-imported-instructions"] }],
        },
        code: "unsafe_plan",
      },
      { changedCapabilities: { ...capabilities, routines: "manual" }, changedPolicy: policy, code: "partial_plan" },
    ];
    for (const entry of cases) {
      const fixture = new BotmancersFixture();
      fixture.capabilities = entry.changedCapabilities;
      const changedPlan = compatibilityFor(manifest, entry.changedCapabilities, entry.changedPolicy);
      const { adapter } = harness({ fixture, inputCompatibilityPlan: changedPlan });
      const plan = seedPlan(manifest, entry.changedCapabilities, entry.changedPolicy);
      const reviewed = withReviewedPlanDigest(plan, await adapter.preview(plan));
      await expect(adapter.apply(reviewed, operation)).rejects.toMatchObject({ code: entry.code });
      expect(fixture.calls.filter(({ method }) => method === "POST")).toEqual([]);
    }
  });

  it("rejects unsupported capability versions before POST", async () => {
    const fixture = new BotmancersFixture();
    fixture.capabilities = { ...capabilities, schemaVersion: "2.0.0" };
    const { adapter } = harness({ fixture });
    await expect(adapter.apply({ ...seedPlan(), id: `sha256:${"0".repeat(64)}` }, operation)).rejects.toBeInstanceOf(CapabilityVersionError);
    expect(fixture.calls.filter(({ method }) => method === "POST")).toEqual([]);
  });

  it("applies idempotently and excludes unsupported or sensitive source fields", async () => {
    const { fixture, adapter } = harness();
    const plan = seedPlan();
    const reviewed = withReviewedPlanDigest(plan, await adapter.preview(plan));
    const first = await adapter.apply(reviewed, operation);
    const second = await adapter.apply(reviewed, operation);

    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("succeeded");
    expect(first.status === "succeeded" && second.status === "succeeded" && first.targetReference).toBe(second.status === "succeeded" ? second.targetReference : "");
    const posts = fixture.calls.filter(({ method }) => method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[0]?.headers).not.toHaveProperty("authorization");
    expect(posts[0]?.body).toEqual({
      schemaVersion: "1.0.0",
      bot: {
        name: "Careful Researcher",
        description: "Researches without executing imported instructions.",
        instructions: "Summarize sources and do not run tools.",
      },
      provenance: {
        source: { provider: "fixture-source", externalId: "source-1" },
        manifestId: "manifest-1",
        retrievedAt: now,
        url: "https://source.example/templates/1",
        reviewedPlanDigest: reviewed.id,
      },
    });
    expect(JSON.stringify(posts[0]?.body)).not.toMatch(/Private source detail|Never export cookies|Run daily|calendar|credential|unavailableFields/);
  });

  it("retries only a declared transient response and preserves operation identity", async () => {
    const fixture = new BotmancersFixture();
    fixture.transientImports = 1;
    const { adapter } = harness({ fixture });
    const plan = seedPlan();
    const reviewed = withReviewedPlanDigest(plan, await adapter.preview(plan));
    await adapter.apply(reviewed, operation);

    const posts = fixture.calls.filter(({ method }) => method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts.map(({ headers }) => ({ idempotency: headers["idempotency-key"], operation: headers["x-operation-id"] }))).toEqual([
      { idempotency: "idempotency-1", operation: "operation-1" },
      { idempotency: "idempotency-1", operation: "operation-1" },
    ]);

    const nonTransient = new BotmancersFixture();
    nonTransient.importFailureStatus = 400;
    const other = harness({ fixture: nonTransient });
    const otherPlan = seedPlan();
    const otherReviewed = withReviewedPlanDigest(otherPlan, await other.adapter.preview(otherPlan));
    await expect(other.adapter.apply(otherReviewed, operation)).rejects.toMatchObject({ retryable: false, attempts: 1 });
    expect(nonTransient.calls.filter(({ method }) => method === "POST")).toHaveLength(1);
  });

  it("verifies by read-after-write and reports field-level differences without execution calls", async () => {
    const { fixture, adapter } = harness();
    const plan = seedPlan();
    const reviewed = withReviewedPlanDigest(plan, await adapter.preview(plan));
    const applied = await adapter.apply(reviewed, operation);
    if (applied.status !== "succeeded") throw new Error("Fixture apply failed");
    fixture.calls.length = 0;
    fixture.mutateRead = (payload) => ({ ...payload, bot: { ...payload.bot, description: "changed" } });

    const result = await adapter.verify({ plan: reviewed, targetReference: applied.targetReference }, operation);

    expect(result.status).toBe("failed");
    expect(result.checks).toEqual([{ name: "$.bot.description", passed: false, detail: "Expected \"Researches without executing imported instructions.\", received \"changed\"" }]);
    expect(fixture.calls.map(({ method, url }) => ({ method, path: new URL(url).pathname }))).toEqual([
      { method: "GET", path: "/v1/imports/bot-1" },
    ]);
    expect(fixture.calls.some(({ url }) => /model|openai|conversation|execute/i.test(url))).toBe(false);
  });

  it("passes verification when the saved import exactly matches the reviewed plan", async () => {
    const { fixture, adapter } = harness();
    const plan = seedPlan();
    const reviewed = withReviewedPlanDigest(plan, await adapter.preview(plan));
    const applied = await adapter.apply(reviewed, operation);
    if (applied.status !== "succeeded") throw new Error("Fixture apply failed");
    fixture.calls.length = 0;

    await expect(adapter.verify({ plan: reviewed, targetReference: applied.targetReference }, operation)).resolves.toMatchObject({
      status: "passed",
      checks: [{ name: "saved-import-payload", passed: true }],
    });
    expect(fixture.calls).toHaveLength(1);
  });

  it("requires a runtime-valid operation identity before any mutating request", async () => {
    const { fixture, adapter } = harness();
    const plan = seedPlan();
    const reviewed = withReviewedPlanDigest(plan, await adapter.preview(plan));
    await expect(adapter.apply(reviewed, { operationId: "", idempotencyKey: "" })).rejects.toMatchObject({
      code: "invalid_operation_identity",
    });
    expect(fixture.calls.filter(({ method }) => method === "POST")).toEqual([]);
  });
});

describe("BotmancersHttpClient", () => {
  it("rejects base URLs containing embedded credentials", () => {
    expect(() => new BotmancersHttpClient({ baseUrl: "https://user:secret@botmancers.example/" })).toThrow(
      "baseUrl must not contain credentials",
    );
  });
});

describe("DeclaredBotmancersCapabilitiesClient", () => {
  it("returns declared capabilities without HTTP", async () => {
    const client = new DeclaredBotmancersCapabilitiesClient();
    await expect(client.getCapabilities()).resolves.toMatchObject({
      schemaVersion: "1.0.0",
      target: { provider: "botmancers" },
      memories: "native",
    });
    await expect(client.importBot(
      { schemaVersion: "1.0.0", bot: { name: "x", description: "y" }, provenance: { source: { provider: "p", externalId: "e" }, manifestId: "m", retrievedAt: "t", url: "u", reviewedPlanDigest: "d" } },
      { operationId: "op", idempotencyKey: "key" },
    )).rejects.toMatchObject({ name: "BotmancersHttpError" });
  });
});

describe("package boundary", () => {
  it("imports only core and compatibility workspace packages", async () => {
    const root = new URL("../../../", import.meta.url);
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
    expect(packageJson.dependencies).toEqual({
      "@clone-market/compatibility": "0.1.0",
      "@clone-market/core": "0.1.0",
    });
    await expect(checkBoundaries(root.pathname)).resolves.toEqual([]);
  });
});
