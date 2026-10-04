import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { SqliteCatalogRepository } from "@clone-market/catalog";
import type { ClonePolicy } from "@clone-market/compatibility";
import type { SourceAdapter, SourceIdentity, VerifyResult } from "@clone-market/core";
import { EvidenceService, SqliteEvidenceRepository } from "@clone-market/evidence";
import { GrokMarketplaceAdapter } from "@clone-market/source-grok";
import { BotmancersHttpClient } from "@clone-market/target-botmancers";

import { botmancersBotUrl } from "../botmancers-url.js";
import { resolveCloneMarketDataPath } from "../config.js";
import { createV1Handlers } from "../http.js";
import { MarketService, type CatalogItem } from "../market.js";
import {
  ACCEPTANCE_CAPABILITIES,
  BotmancersAcceptanceStub,
} from "./botmancers-stub.js";
import { AcceptanceFailure, acceptanceError } from "./error.js";
import {
  ACCEPTANCE_NOW,
  CHOSEN_SOURCE,
  createFixtureGrokAdapter,
  reconcileFixtureCatalog,
  seedAcceptanceEvidence,
} from "./fixtures.js";
import { adoptionLabelFlags } from "./label-guards.js";
import { verifyBotmancersPeerRepo } from "./peer-repo.js";
import {
  rollupStatus,
  type FailureCaseReport,
  type V0AcceptanceReport,
} from "./report.js";

const POLICY: ClonePolicy = {
  schemaVersion: "1.0.0",
  creatorPermission: "granted",
  redistribution: "private_only",
  destination: "private",
  instructionForm: "plain_text",
};

export type RunV0AcceptanceOptions = {
  mode?: "fixture" | "live";
  reportPath?: string;
  botmancersUiBaseUrl?: string;
  botmancersBaseUrl?: string;
  grokBaseUrl?: string;
  catalogPath?: string;
  evidencePath?: string;
  source?: SourceIdentity;
  verifyPeerRepos?: boolean;
  botmancersRoot?: string;
  now?: () => string;
};

type ApplyBody = {
  result: { status: string; operationId: string; targetReference: string; completedAt: string };
  operation: { operationId: string; idempotencyKey: string };
  planDigest: string;
  verification?: VerifyResult;
};

type EvidenceLookup = {
  snapshot?: NonNullable<V0AcceptanceReport["evidence"]>["snapshot"];
  contributions: NonNullable<V0AcceptanceReport["evidence"]>["contributions"];
  evidence: NonNullable<V0AcceptanceReport["evidence"]>["evidenceRows"];
};

function params(source: SourceIdentity) {
  return { provider: source.provider, externalId: source.externalId };
}

function parseSource(value: string | undefined, fallback: SourceIdentity): SourceIdentity {
  if (value === undefined || value.length === 0) return fallback;
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    return { provider: fallback.provider, externalId: value };
  }
  return { provider: value.slice(0, separator), externalId: value.slice(separator + 1) };
}

function responseError(response: { status: number; body: unknown }, fallback: string): never {
  const error = (response.body as { error?: { code?: string; message?: string } }).error;
  throw new AcceptanceFailure(error?.code ?? fallback, error?.message ?? JSON.stringify(response.body));
}

async function unexplainedOmissions(
  catalog: SqliteCatalogRepository,
  adapter: SourceAdapter,
): Promise<SourceIdentity[]> {
  const listed: SourceIdentity[] = [];
  let cursor: string | undefined;
  do {
    const page = await adapter.listTemplates(cursor === undefined ? undefined : { cursor });
    listed.push(...page.templates.map((template) => template.provenance.source));
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  const missing: SourceIdentity[] = [];
  for (const source of listed) {
    const entry = await catalog.getTemplate(source);
    if (entry === undefined || !entry.present) missing.push(source);
  }
  return missing;
}

function inspectEvidence(
  handlersBody: EvidenceLookup,
  source: SourceIdentity,
): NonNullable<V0AcceptanceReport["evidence"]> {
  if (handlersBody.snapshot === undefined) {
    throw new AcceptanceFailure("missing_reviewed_evidence", `No adoption snapshot for ${source.provider}:${source.externalId}; import reviewed evidence first`);
  }
  if (handlersBody.snapshot.label === "listed" && handlersBody.evidence.length === 0) {
    throw new AcceptanceFailure("label_missing_evidence", "Displayed label must open to evidence rows");
  }
  if (handlersBody.contributions.length === 0) {
    throw new AcceptanceFailure("label_missing_evidence", "Adoption label is missing rule contributions");
  }
  const flags = adoptionLabelFlags({
    snapshot: handlersBody.snapshot,
    contributions: handlersBody.contributions,
    evidenceRows: handlersBody.evidence,
  });
  return {
    label: handlersBody.snapshot.label,
    snapshot: handlersBody.snapshot,
    contributions: handlersBody.contributions,
    evidenceRows: handlersBody.evidence,
    usesInstallCount: flags.usesInstallCount,
    usesPrivateUsage: flags.usesPrivateUsage,
  };
}

async function ensureAdoptionSnapshots(
  repository: SqliteEvidenceRepository,
  evidence: EvidenceService,
  templateIds: string[],
  calculatedAt: string,
): Promise<void> {
  for (const templateId of templateIds) {
    const rows = await repository.listEvidence(templateId);
    if (rows.length === 0) continue;
    if (await evidence.getLatest(templateId) !== undefined) continue;
    await evidence.derive(templateId, { calculatedAt });
  }
}

async function inspectDisplayedLabels(
  handlers: ReturnType<typeof createV1Handlers>,
  items: CatalogItem[],
  chosen: SourceIdentity,
): Promise<NonNullable<V0AcceptanceReport["evidence"]>> {
  const displayed = items.filter((item) => item.adoption !== undefined);
  const sources = displayed.length > 0
    ? displayed.map((item) => item.provenance.source)
    : [chosen];
  let chosenEvidence: NonNullable<V0AcceptanceReport["evidence"]> | undefined;
  for (const source of sources) {
    const evidenceResponse = await handlers.evidence({ params: params(source) });
    if (evidenceResponse.status !== 200) responseError(evidenceResponse, "evidence_failed");
    const inspected = inspectEvidence(evidenceResponse.body as EvidenceLookup, source);
    if (inspected.usesInstallCount || inspected.usesPrivateUsage) {
      throw new AcceptanceFailure(
        "label_uses_forbidden_metric",
        `Adoption label for ${source.provider}:${source.externalId} used forbidden signals (installCount=${inspected.usesInstallCount}, privateUsage=${inspected.usesPrivateUsage})`,
      );
    }
    if (source.provider === chosen.provider && source.externalId === chosen.externalId) {
      chosenEvidence = inspected;
    }
  }
  if (chosenEvidence === undefined) {
    const evidenceResponse = await handlers.evidence({ params: params(chosen) });
    if (evidenceResponse.status !== 200) responseError(evidenceResponse, "evidence_failed");
    chosenEvidence = inspectEvidence(evidenceResponse.body as EvidenceLookup, chosen);
    if (chosenEvidence.usesInstallCount || chosenEvidence.usesPrivateUsage) {
      throw new AcceptanceFailure(
        "label_uses_forbidden_metric",
        `Adoption label used forbidden signals (installCount=${chosenEvidence.usesInstallCount}, privateUsage=${chosenEvidence.usesPrivateUsage})`,
      );
    }
  }
  return chosenEvidence;
}

function optionalResolvedPath(path: string | undefined): string | undefined {
  if (path === undefined || path.length === 0) return path;
  return resolveCloneMarketDataPath(path);
}

async function runFailureCases(input: {
  catalogPath: string;
  evidence: EvidenceService;
  now: () => string;
  source: SourceIdentity;
}): Promise<FailureCaseReport[]> {
  const cases: FailureCaseReport[] = [];
  const identity = params(input.source);

  {
    const stub = new BotmancersAcceptanceStub();
    const catalog = new SqliteCatalogRepository(input.catalogPath);
    const adapter = await createFixtureGrokAdapter("detail_drift");
    const handlers = createV1Handlers(new MarketService({
      catalog,
      evidence: input.evidence,
      source: () => adapter,
      botmancers: stub.client(),
      now: input.now,
    }));
    const response = await handlers.preview({ params: identity, body: { policy: POLICY } });
    const code = (response.body as { error?: { code?: string } }).error?.code;
    const posts = stub.calls.filter((call) => call.method === "POST").length;
    cases.push({
      id: "source_schema_drift",
      status: response.status === 503 && code === "source_drift" && posts === 0 ? "passed" : "failed",
      expectedCode: "source_drift",
      httpStatus: response.status,
      mutating: false,
      detail: posts === 0
        ? `Typed source_drift response with status ${response.status}; no Botmancers mutation`
        : `Unexpected Botmancers POST count ${posts}`,
    });
    catalog.close();
  }

  {
    const stub = new BotmancersAcceptanceStub();
    stub.offline = true;
    const catalog = new SqliteCatalogRepository(input.catalogPath);
    const adapter = await createFixtureGrokAdapter("happy");
    const handlers = createV1Handlers(new MarketService({
      catalog,
      evidence: input.evidence,
      source: () => adapter,
      botmancers: stub.client(),
      now: input.now,
    }));
    const response = await handlers.preview({ params: identity, body: { policy: POLICY } });
    const code = (response.body as { error?: { code?: string } }).error?.code;
    cases.push({
      id: "botmancers_unavailable",
      status: response.status === 503 && code === "target_unavailable" && stub.botCount() === 0 ? "passed" : "failed",
      expectedCode: "target_unavailable",
      httpStatus: response.status,
      mutating: false,
      detail: `preview target_unavailable status=${response.status}; bots=${stub.botCount()}`,
    });
    catalog.close();
  }

  {
    const stub = new BotmancersAcceptanceStub();
    const catalog = new SqliteCatalogRepository(input.catalogPath);
    const adapter = await createFixtureGrokAdapter("happy");
    const handlers = createV1Handlers(new MarketService({
      catalog,
      evidence: input.evidence,
      source: () => adapter,
      botmancers: stub.client(),
      now: input.now,
    }));
    const preview = await handlers.preview({ params: identity, body: { policy: POLICY } });
    const previewBody = preview.body as { plan: { id: string; createdAt: string } };
    stub.offline = true;
    const apply = await handlers.apply({
      params: identity,
      body: {
        policy: POLICY,
        planDigest: previewBody.plan?.id,
        reviewedAt: previewBody.plan?.createdAt,
        approved: true,
      },
    });
    const code = (apply.body as { error?: { code?: string } }).error?.code;
    cases.push({
      id: "botmancers_unavailable_apply",
      status: apply.status === 503 && code === "target_unavailable" && stub.botCount() === 0 ? "passed" : "failed",
      expectedCode: "target_unavailable",
      httpStatus: apply.status,
      mutating: false,
      detail: `apply target_unavailable status=${apply.status}; bots=${stub.botCount()}`,
    });
    catalog.close();
  }

  {
    const stub = new BotmancersAcceptanceStub();
    const catalog = new SqliteCatalogRepository(input.catalogPath);
    const adapter = await createFixtureGrokAdapter("happy");
    const market = new MarketService({
      catalog,
      evidence: input.evidence,
      source: () => adapter,
      botmancers: stub.client(),
      now: input.now,
    });
    const handlers = createV1Handlers(market);
    const preview = await handlers.preview({ params: identity, body: { policy: POLICY } });
    const previewBody = preview.body as { plan: { id: string; createdAt: string } };
    stub.capabilities = {
      ...ACCEPTANCE_CAPABILITIES,
      memories: "unsupported",
    };
    const apply = await handlers.apply({
      params: identity,
      body: {
        policy: POLICY,
        planDigest: previewBody.plan.id,
        reviewedAt: previewBody.plan.createdAt,
        approved: true,
      },
    });
    const code = (apply.body as { error?: { code?: string } }).error?.code;
    cases.push({
      id: "changed_plan_after_preview",
      status: apply.status === 409 && code === "stale_plan" && stub.botCount() === 0 ? "passed" : "failed",
      expectedCode: "stale_plan",
      httpStatus: apply.status,
      mutating: false,
      detail: `stale_plan status=${apply.status}; bots=${stub.botCount()}`,
    });
    catalog.close();
  }

  {
    const stub = new BotmancersAcceptanceStub();
    const catalog = new SqliteCatalogRepository(input.catalogPath);
    const adapter = await createFixtureGrokAdapter("happy");
    const handlers = createV1Handlers(new MarketService({
      catalog,
      evidence: input.evidence,
      source: () => adapter,
      botmancers: stub.client(),
      now: input.now,
    }));
    const preview = await handlers.preview({ params: identity, body: { policy: POLICY } });
    const previewBody = preview.body as { plan: { id: string; createdAt: string } };
    const body = {
      policy: POLICY,
      planDigest: previewBody.plan.id,
      reviewedAt: previewBody.plan.createdAt,
      approved: true,
    };
    const first = await handlers.apply({ params: identity, body });
    const second = await handlers.apply({ params: identity, body });
    const firstBody = first.body as ApplyBody;
    const secondBody = second.body as ApplyBody;
    const sameBot = firstBody.result?.targetReference === secondBody.result?.targetReference;
    const sameOperation = firstBody.operation?.operationId === secondBody.operation?.operationId;
    cases.push({
      id: "idempotent_retry",
      status: first.status === 200 && second.status === 200 && stub.botCount() === 1 && sameBot && sameOperation ? "passed" : "failed",
      expectedCode: "idempotent_apply",
      httpStatus: second.status,
      mutating: false,
      detail: `bots=${stub.botCount()} first=${firstBody.result?.targetReference} second=${secondBody.result?.targetReference} operation=${firstBody.operation?.operationId}`,
    });
    catalog.close();
  }

  return cases;
}

async function previewAndApply(input: {
  handlers: ReturnType<typeof createV1Handlers>;
  source: SourceIdentity;
  uiBaseUrl: string;
  replay: boolean;
  listBots?: () => Promise<{ id: string }[]>;
}): Promise<{
  compatibility: NonNullable<V0AcceptanceReport["compatibility"]>;
  approval: NonNullable<V0AcceptanceReport["approval"]>;
  target: NonNullable<V0AcceptanceReport["target"]>;
}> {
  const identity = params(input.source);
  const preview = await input.handlers.preview({ params: identity, body: { policy: POLICY } });
  if (preview.status !== 200) responseError(preview, "preview_failed");
  const previewBody = preview.body as {
    plan: { id: string; createdAt: string };
    compatibility: { summary: NonNullable<V0AcceptanceReport["compatibility"]>["summary"] };
  };
  const applyBodyPayload = {
    policy: POLICY,
    planDigest: previewBody.plan.id,
    reviewedAt: previewBody.plan.createdAt,
    approved: true,
  };
  const apply = await input.handlers.apply({ params: identity, body: applyBodyPayload });
  if (apply.status !== 200) responseError(apply, "apply_failed");
  const applyBody = apply.body as ApplyBody;
  if (applyBody.verification?.status !== "passed") {
    throw new AcceptanceFailure("verification_failed", `Verification did not pass: ${JSON.stringify(applyBody.verification ?? applyBody)}`);
  }
  let replaySameBot: boolean | undefined;
  let replayBotCount: number | undefined;
  if (input.replay) {
    const afterApply = input.listBots === undefined ? undefined : await input.listBots();
    const replayed = await input.handlers.apply({ params: identity, body: applyBodyPayload });
    if (replayed.status !== 200) responseError(replayed, "apply_failed");
    const replayBody = replayed.body as ApplyBody;
    replaySameBot = replayBody.result?.targetReference === applyBody.result.targetReference
      && replayBody.operation?.operationId === applyBody.operation.operationId;
    if (replaySameBot !== true) {
      throw new AcceptanceFailure(
        "duplicate_bot",
        `Replaying ${applyBody.operation.operationId} created ${replayBody.result?.targetReference} instead of ${applyBody.result.targetReference}`,
      );
    }
    if (input.listBots !== undefined) {
      const afterReplay = await input.listBots();
      const botId = applyBody.result.targetReference;
      const listedAfterApply = afterApply ?? [];
      const applyMatches = listedAfterApply.filter((bot) => bot.id === botId).length;
      const replayMatches = afterReplay.filter((bot) => bot.id === botId).length;
      if (afterReplay.length !== listedAfterApply.length || applyMatches !== 1 || replayMatches !== 1) {
        throw new AcceptanceFailure(
          "duplicate_bot",
          `Replaying ${applyBody.operation.operationId} changed Botmancers bot count from ${listedAfterApply.length} to ${afterReplay.length} (id ${botId} seen ${replayMatches} times)`,
        );
      }
      replayBotCount = afterReplay.length;
    }
  }
  return {
    compatibility: {
      planDigest: previewBody.plan.id,
      summary: previewBody.compatibility.summary,
    },
    approval: {
      approved: true,
      reviewedAt: previewBody.plan.createdAt,
      planDigest: previewBody.plan.id,
    },
    target: {
      operationId: applyBody.operation.operationId,
      botmancersBotId: applyBody.result.targetReference,
      verification: applyBody.verification!,
      returnUrl: botmancersBotUrl(input.uiBaseUrl, applyBody.result.targetReference),
      ...(replaySameBot === undefined ? {} : { replaySameBot }),
      ...(replayBotCount === undefined ? {} : { replayBotCount }),
    },
  };
}

function emptySource(now: string, url: string): V0AcceptanceReport["source"] {
  return { retrievedAt: now, count: 0, url };
}

function emptyReconciliation(): V0AcceptanceReport["reconciliation"] {
  return { added: 0, changed: 0, removed: 0, reappeared: 0, unchanged: 0, unexplainedOmissions: [] };
}

export async function runV0Acceptance(options: RunV0AcceptanceOptions = {}): Promise<V0AcceptanceReport> {
  const mode = options.mode ?? "fixture";
  const now = options.now ?? (() => ACCEPTANCE_NOW);
  const generatedAt = now();
  const uiBaseUrl = options.botmancersUiBaseUrl ?? process.env.CLONE_MARKET_BOTMANCERS_UI_BASE_URL ?? "http://127.0.0.1:3100/";
  const sourceIdentity = options.source
    ?? parseSource(process.env.CLONE_MARKET_ACCEPTANCE_TEMPLATE, CHOSEN_SOURCE);
  const work = mkdtempSync(join(tmpdir(), "clone-market-v0-"));
  const failureCatalogPath = join(work, "failure-catalog.sqlite");
  const fixtureEvidencePath = join(work, "evidence.sqlite");
  const persistOperatorDbs = mode === "live";
  const catalogPath = persistOperatorDbs
    ? optionalResolvedPath(options.catalogPath ?? process.env.CLONE_MARKET_CATALOG_DB)
    : join(work, "catalog.sqlite");
  const evidencePath = persistOperatorDbs
    ? optionalResolvedPath(options.evidencePath ?? process.env.CLONE_MARKET_EVIDENCE_DB)
    : fixtureEvidencePath;
  let closeEvidence: (() => void) | undefined;
  let closeFailureEvidence: (() => void) | undefined;
  let closeCatalog: (() => void) | undefined;
  let evidence: EvidenceService | undefined;
  let liveEvidenceRepository: SqliteEvidenceRepository | undefined;

  const report: V0AcceptanceReport = {
    schemaVersion: "1.0.0",
    suite: "v0-acceptance",
    generatedAt,
    mode,
    status: "failed",
    exitCode: 1,
    databases: {
      catalogPath: catalogPath ?? "",
      evidencePath: evidencePath ?? "",
      retainedAfterRun: persistOperatorDbs,
    },
    source: emptySource(generatedAt, mode === "live" ? (options.grokBaseUrl ?? process.env.CLONE_MARKET_GROK_BASE_URL ?? "https://x.ai/bot/marketplace/") : "fixture:packages/source-grok/test/fixtures/marketplace-index-2026-10-02.html"),
    reconciliation: emptyReconciliation(),
    browser: {
      status: "operator_required",
      notes: "Record catalog → inspector → preview → apply → verify plus Botmancers return in a real browser; see docs/acceptance-v0.md ([operator]).",
    },
    failureCases: [],
    peerRepositories: {
      botmancers: {
        status: "skipped",
        returnRouteConfirmed: false,
        idempotencyKeyConfirmed: false,
        detail: "Peer verification not requested for this run.",
      },
    },
  };

  const writeReport = () => {
    if (options.reportPath) {
      mkdirSync(dirname(options.reportPath), { recursive: true });
      writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }
  };

  try {
    if (persistOperatorDbs) {
      if (catalogPath === undefined || catalogPath.length === 0) {
        throw new AcceptanceFailure("missing_catalog_db", "Live acceptance requires CLONE_MARKET_CATALOG_DB (retained for the web UI)");
      }
      if (evidencePath === undefined || evidencePath.length === 0) {
        throw new AcceptanceFailure("missing_evidence_db", "Live acceptance requires CLONE_MARKET_EVIDENCE_DB with reviewed evidence rows");
      }
      if (!existsSync(evidencePath)) {
        throw new AcceptanceFailure("missing_evidence_db", `Live evidence database not found at ${evidencePath}; import reviewed rows before smoke:v0:live`);
      }
      mkdirSync(dirname(catalogPath), { recursive: true });
      const repository = new SqliteEvidenceRepository(evidencePath);
      liveEvidenceRepository = repository;
      closeEvidence = () => repository.close();
      evidence = new EvidenceService(repository);
    } else {
      const seeded = await seedAcceptanceEvidence(fixtureEvidencePath);
      closeEvidence = seeded.close;
      evidence = seeded.service;
    }

    if (mode === "fixture") {
      const reconciliationReport = await reconcileFixtureCatalog(catalogPath!);
      const catalog = new SqliteCatalogRepository(catalogPath!);
      const adapter = await createFixtureGrokAdapter("happy");
      const omissions = await unexplainedOmissions(catalog, adapter);
      catalog.close();
      report.source = {
        retrievedAt: reconciliationReport.retrievedAt,
        count: reconciliationReport.total,
        url: "fixture:packages/source-grok/test/fixtures/marketplace-index-2026-10-02.html",
      };
      report.reconciliation = {
        added: reconciliationReport.added,
        changed: reconciliationReport.changed,
        removed: reconciliationReport.removed,
        reappeared: reconciliationReport.reappeared,
        unchanged: reconciliationReport.unchanged,
        unexplainedOmissions: omissions,
      };
      const catalogRepo = new SqliteCatalogRepository(catalogPath!);
      closeCatalog = () => catalogRepo.close();
      const handlers = createV1Handlers(new MarketService({
        catalog: catalogRepo,
        evidence,
        source: () => adapter,
        botmancers: new BotmancersAcceptanceStub().client(),
        now,
      }));
      const catalogResponse = await handlers.catalog();
      if (catalogResponse.status !== 200) responseError(catalogResponse, "catalog_failed");
      const catalogBody = catalogResponse.body as { total: number; items: CatalogItem[] };
      if (catalogBody.total < 1) throw new AcceptanceFailure("catalog_empty", "Catalog traversal returned zero templates");
      report.evidence = await inspectDisplayedLabels(handlers, catalogBody.items, sourceIdentity);
      const stub = new BotmancersAcceptanceStub();
      const applyHandlers = createV1Handlers(new MarketService({
        catalog: catalogRepo,
        evidence,
        source: () => adapter,
        botmancers: stub.client(),
        now,
      }));
      const previewCheck = await applyHandlers.preview({ params: params(sourceIdentity), body: { policy: POLICY } });
      if (previewCheck.status !== 200) responseError(previewCheck, "preview_failed");
      if (stub.botCount() !== 0) throw new AcceptanceFailure("preview_mutated_target", "Preview mutated Botmancers");
      const applied = await previewAndApply({
        handlers: applyHandlers,
        source: sourceIdentity,
        uiBaseUrl,
        replay: true,
        listBots: async () => stub.client().listBots(),
      });
      const detail = await applyHandlers.detail({ params: params(sourceIdentity) });
      const detailBody = detail.body as { manifest: { provenanceUrl: string; retrievedAt: string; template: { name: string } } };
      report.template = {
        source: sourceIdentity,
        provenanceUrl: detailBody.manifest.provenanceUrl,
        retrievedAt: detailBody.manifest.retrievedAt,
        name: detailBody.manifest.template.name,
      };
      report.compatibility = applied.compatibility;
      report.approval = applied.approval;
      report.target = applied.target;
    } else {
      const grokBaseUrl = options.grokBaseUrl ?? process.env.CLONE_MARKET_GROK_BASE_URL ?? "https://x.ai/bot/marketplace/";
      const botmancersBaseUrl = options.botmancersBaseUrl ?? process.env.CLONE_MARKET_BOTMANCERS_BASE_URL ?? "http://127.0.0.1:8787/";
      const adapter = new GrokMarketplaceAdapter({ baseUrl: grokBaseUrl, now });
      const { runCatalogReconciliation } = await import("@clone-market/catalog");
      const reconciliationReport = await runCatalogReconciliation({
        adapter,
        databasePath: catalogPath!,
        now,
      });
      const catalog = new SqliteCatalogRepository(catalogPath!);
      closeCatalog = () => catalog.close();
      const omissions = await unexplainedOmissions(catalog, adapter);
      report.source = {
        retrievedAt: reconciliationReport.retrievedAt,
        count: reconciliationReport.total,
        url: grokBaseUrl,
      };
      report.reconciliation = {
        added: reconciliationReport.added,
        changed: reconciliationReport.changed,
        removed: reconciliationReport.removed,
        reappeared: reconciliationReport.reappeared,
        unchanged: reconciliationReport.unchanged,
        unexplainedOmissions: omissions,
      };
      const entry = await catalog.getTemplate(sourceIdentity);
      if (entry === undefined) {
        throw new AcceptanceFailure(
          "template_not_in_catalog",
          `Live Marketplace index did not include ${sourceIdentity.provider}:${sourceIdentity.externalId}; pass CLONE_MARKET_ACCEPTANCE_TEMPLATE`,
        );
      }
      report.template = {
        source: sourceIdentity,
        provenanceUrl: entry.provenance.url,
        retrievedAt: entry.provenance.retrievedAt,
        name: entry.name,
      };
      const client = new BotmancersHttpClient({ baseUrl: botmancersBaseUrl, maxRetries: 0 });
      const handlers = createV1Handlers(new MarketService({
        catalog,
        evidence: evidence!,
        source: () => adapter,
        botmancers: client,
        now,
      }));
      const catalogResponse = await handlers.catalog();
      if (catalogResponse.status !== 200) responseError(catalogResponse, "catalog_failed");
      const catalogBody = catalogResponse.body as { items: CatalogItem[] };
      if (liveEvidenceRepository === undefined) {
        throw new AcceptanceFailure("missing_evidence_db", "Live evidence repository was not opened");
      }
      await ensureAdoptionSnapshots(
        liveEvidenceRepository,
        evidence!,
        [...catalogBody.items.map((item) => item.id), `${sourceIdentity.provider}:${sourceIdentity.externalId}`],
        now(),
      );
      const catalogAfterDerive = await handlers.catalog();
      if (catalogAfterDerive.status !== 200) responseError(catalogAfterDerive, "catalog_failed");
      report.evidence = await inspectDisplayedLabels(
        handlers,
        (catalogAfterDerive.body as { items: CatalogItem[] }).items,
        sourceIdentity,
      );
      const preview = await handlers.preview({ params: params(sourceIdentity), body: { policy: POLICY } });
      if (preview.status !== 200) responseError(preview, "preview_failed");
      const applied = await previewAndApply({
        handlers,
        source: sourceIdentity,
        uiBaseUrl,
        replay: true,
        listBots: async () => client.listBots(),
      });
      report.compatibility = applied.compatibility;
      report.approval = applied.approval;
      report.target = applied.target;
    }

    await reconcileFixtureCatalog(failureCatalogPath);
    let failureEvidence = evidence!;
    if (persistOperatorDbs) {
      const seeded = await seedAcceptanceEvidence(join(work, "failure-evidence.sqlite"));
      closeFailureEvidence = seeded.close;
      failureEvidence = seeded.service;
    }
    report.failureCases = await runFailureCases({
      catalogPath: failureCatalogPath,
      evidence: failureEvidence,
      now,
      source: CHOSEN_SOURCE,
    });

    const verifyPeer = options.verifyPeerRepos ?? process.env.CLONE_MARKET_ACCEPTANCE_PEER_REPOS === "1";
    report.peerRepositories.botmancers = verifyPeer
      ? verifyBotmancersPeerRepo(options.botmancersRoot ?? process.env.BOTMANCERS_ROOT)
      : {
        status: "skipped",
        returnRouteConfirmed: false,
        idempotencyKeyConfirmed: false,
        detail: "Peer Botmancers verification is opt-in via CLONE_MARKET_ACCEPTANCE_PEER_REPOS=1 and BOTMANCERS_ROOT.",
      };

    const statuses: Array<"passed" | "failed"> = [
      report.reconciliation.unexplainedOmissions.length === 0 ? "passed" : "failed",
      report.evidence?.usesInstallCount === false && report.evidence?.usesPrivateUsage === false ? "passed" : "failed",
      report.target?.verification.status === "passed" && report.target.replaySameBot === true ? "passed" : "failed",
      ...report.failureCases.map((item) => item.status),
    ];
    if (verifyPeer) {
      const peerStatus = report.peerRepositories.botmancers.status;
      if (peerStatus === "failed" || peerStatus === "unverified") statuses.push("failed");
    }
    report.status = rollupStatus(statuses);
    report.exitCode = report.status === "passed" ? 0 : 1;
    writeReport();
    return report;
  } catch (reason) {
    report.status = "failed";
    report.exitCode = 1;
    report.error = acceptanceError(reason);
    writeReport();
    return report;
  } finally {
    closeCatalog?.();
    closeEvidence?.();
    closeFailureEvidence?.();
    rmSync(work, { recursive: true, force: true });
  }
}
