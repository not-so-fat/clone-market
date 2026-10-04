import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { SqliteCatalogRepository } from "@clone-market/catalog";
import type { ClonePolicy } from "@clone-market/compatibility";
import type { SourceAdapter, SourceIdentity } from "@clone-market/core";
import { EvidenceService, SqliteEvidenceRepository } from "@clone-market/evidence";
import { GrokMarketplaceAdapter } from "@clone-market/source-grok";
import { DeclaredBotmancersCapabilitiesClient, DECLARED_BOTMANCERS_CAPABILITIES } from "@clone-market/target-botmancers";

import { FileArtifactSink, MemoryArtifactSink, type ArtifactSink } from "../artifact-sink.js";
import { resolveCloneMarketDataPath } from "../config.js";
import { createV1Handlers } from "../http.js";
import { MarketService, type CatalogItem } from "../market.js";
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
  grokBaseUrl?: string;
  catalogPath?: string;
  evidencePath?: string;
  artifactDir?: string;
  source?: SourceIdentity;
  verifyPeerRepos?: boolean;
  botmancersRoot?: string;
  now?: () => string;
};

type ExportBody = {
  identity: string;
  created: boolean;
  path: string;
  digest: string;
  verification: { status: string };
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

function exportMarket(input: {
  catalog: SqliteCatalogRepository;
  evidence: EvidenceService;
  adapter: SourceAdapter;
  botmancers?: DeclaredBotmancersCapabilitiesClient;
  artifacts: ArtifactSink;
  now: () => string;
}) {
  return new MarketService({
    catalog: input.catalog,
    evidence: input.evidence,
    source: () => input.adapter,
    botmancers: input.botmancers ?? new DeclaredBotmancersCapabilitiesClient(),
    artifacts: input.artifacts,
    now: input.now,
  });
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
    const artifacts = new MemoryArtifactSink();
    const catalog = new SqliteCatalogRepository(input.catalogPath);
    const adapter = await createFixtureGrokAdapter("detail_drift");
    const handlers = createV1Handlers(exportMarket({
      catalog,
      evidence: input.evidence,
      adapter,
      artifacts,
      now: input.now,
    }));
    const response = await handlers.preview({ params: identity, body: { policy: POLICY } });
    const code = (response.body as { error?: { code?: string } }).error?.code;
    cases.push({
      id: "source_schema_drift",
      status: response.status === 503 && code === "source_drift" && artifacts.store.size === 0 ? "passed" : "failed",
      expectedCode: "source_drift",
      httpStatus: response.status,
      mutating: false,
      detail: artifacts.store.size === 0
        ? `Typed source_drift response with status ${response.status}; no artifact written`
        : `Unexpected artifact count ${artifacts.store.size}`,
    });
    catalog.close();
  }

  {
    const artifacts = new MemoryArtifactSink();
    artifacts.unavailable = true;
    const catalog = new SqliteCatalogRepository(input.catalogPath);
    const adapter = await createFixtureGrokAdapter("happy");
    const handlers = createV1Handlers(exportMarket({
      catalog,
      evidence: input.evidence,
      adapter,
      artifacts,
      now: input.now,
    }));
    const preview = await handlers.preview({ params: identity, body: { policy: POLICY } });
    const previewBody = preview.body as { plan: { id: string; createdAt: string } };
    const exported = await handlers.exportArtifact({
      params: identity,
      body: {
        policy: POLICY,
        planDigest: previewBody.plan?.id,
        reviewedAt: previewBody.plan?.createdAt,
        approved: true,
      },
    });
    const code = (exported.body as { error?: { code?: string } }).error?.code;
    cases.push({
      id: "artifact_sink_unavailable",
      status: exported.status === 503 && code === "sink_unavailable" && artifacts.store.size === 0 ? "passed" : "failed",
      expectedCode: "sink_unavailable",
      httpStatus: exported.status,
      mutating: false,
      detail: `export sink_unavailable status=${exported.status}; artifacts=${artifacts.store.size}`,
    });
    catalog.close();
  }

  {
    const artifacts = new MemoryArtifactSink();
    const catalog = new SqliteCatalogRepository(input.catalogPath);
    const adapter = await createFixtureGrokAdapter("happy");
    const botmancers = new DeclaredBotmancersCapabilitiesClient();
    const handlers = createV1Handlers(exportMarket({
      catalog,
      evidence: input.evidence,
      adapter,
      botmancers,
      artifacts,
      now: input.now,
    }));
    const preview = await handlers.preview({ params: identity, body: { policy: POLICY } });
    const previewBody = preview.body as { plan: { id: string; createdAt: string } };
    botmancers.capabilities = {
      ...DECLARED_BOTMANCERS_CAPABILITIES,
      memories: "unsupported",
    };
    const exported = await handlers.exportArtifact({
      params: identity,
      body: {
        policy: POLICY,
        planDigest: previewBody.plan.id,
        reviewedAt: previewBody.plan.createdAt,
        approved: true,
      },
    });
    const code = (exported.body as { error?: { code?: string } }).error?.code;
    cases.push({
      id: "changed_plan_after_preview",
      status: exported.status === 409 && code === "stale_plan" && artifacts.store.size === 0 ? "passed" : "failed",
      expectedCode: "stale_plan",
      httpStatus: exported.status,
      mutating: false,
      detail: `stale_plan status=${exported.status}; artifacts=${artifacts.store.size}`,
    });
    catalog.close();
  }

  {
    const artifacts = new MemoryArtifactSink();
    const catalog = new SqliteCatalogRepository(input.catalogPath);
    const adapter = await createFixtureGrokAdapter("happy");
    const handlers = createV1Handlers(exportMarket({
      catalog,
      evidence: input.evidence,
      adapter,
      artifacts,
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
    const exported = await handlers.exportArtifact({ params: identity, body });
    const exportBody = exported.body as ExportBody;
    const stored = artifacts.store.get(exportBody.identity);
    stored?.set("botmancers/import.json", `${stored.get("botmancers/import.json") ?? ""} `);
    const verified = await handlers.verifyArtifact({
      params: identity,
      body: {
        policy: POLICY,
        planDigest: previewBody.plan.id,
        reviewedAt: previewBody.plan.createdAt,
        artifactIdentity: exportBody.identity,
      },
    });
    const verification = verified.body as { status?: string; checks?: Array<{ name: string; passed: boolean }> };
    const namedBoundary = verification.checks?.some((check) => !check.passed && (check.name === "artifact-digest" || check.name === "artifact-content")) === true;
    cases.push({
      id: "tampered_artifact",
      status: exported.status === 200 && verified.status === 200 && verification.status === "failed" && namedBoundary ? "passed" : "failed",
      expectedCode: "tampered_artifact",
      httpStatus: verified.status,
      mutating: false,
      detail: `verification status=${verification.status}; boundary=${namedBoundary ? "artifact-digest" : "missing"}`,
    });
    catalog.close();
  }

  {
    const artifacts = new MemoryArtifactSink();
    const catalog = new SqliteCatalogRepository(input.catalogPath);
    const adapter = await createFixtureGrokAdapter("happy");
    const handlers = createV1Handlers(exportMarket({
      catalog,
      evidence: input.evidence,
      adapter,
      artifacts,
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
    const first = await handlers.exportArtifact({ params: identity, body });
    const second = await handlers.exportArtifact({ params: identity, body });
    const firstBody = first.body as ExportBody;
    const secondBody = second.body as ExportBody;
    const sameIdentity = firstBody.identity === secondBody.identity;
    const sameDigest = firstBody.digest === secondBody.digest;
    cases.push({
      id: "idempotent_retry",
      status: first.status === 200 && second.status === 200 && artifacts.store.size === 1 && sameIdentity && sameDigest && secondBody.created === false ? "passed" : "failed",
      expectedCode: "idempotent_export",
      httpStatus: second.status,
      mutating: false,
      detail: `artifacts=${artifacts.store.size} first=${firstBody.identity} second=${secondBody.identity} digest=${firstBody.digest}`,
    });
    catalog.close();
  }

  return cases;
}

async function previewAndExport(input: {
  handlers: ReturnType<typeof createV1Handlers>;
  source: SourceIdentity;
  replay: boolean;
}): Promise<{
  compatibility: NonNullable<V0AcceptanceReport["compatibility"]>;
  approval: NonNullable<V0AcceptanceReport["approval"]>;
  artifact: NonNullable<V0AcceptanceReport["artifact"]>;
}> {
  const identity = params(input.source);
  const preview = await input.handlers.preview({ params: identity, body: { policy: POLICY } });
  if (preview.status !== 200) responseError(preview, "preview_failed");
  const previewBody = preview.body as {
    plan: { id: string; createdAt: string };
    compatibility: { summary: NonNullable<V0AcceptanceReport["compatibility"]>["summary"] };
  };
  const exportBodyPayload = {
    policy: POLICY,
    planDigest: previewBody.plan.id,
    reviewedAt: previewBody.plan.createdAt,
    approved: true,
  };
  const exported = await input.handlers.exportArtifact({ params: identity, body: exportBodyPayload });
  if (exported.status !== 200) responseError(exported, "export_failed");
  const exportBody = exported.body as ExportBody & { verification: NonNullable<V0AcceptanceReport["artifact"]>["verification"] };
  if (exportBody.verification?.status !== "passed") {
    throw new AcceptanceFailure("verification_failed", `Artifact verification did not pass: ${JSON.stringify(exportBody.verification ?? exportBody)}`);
  }
  let replaySameDigest: boolean | undefined;
  let replayDuplicate: boolean | undefined;
  if (input.replay) {
    const replayed = await input.handlers.exportArtifact({ params: identity, body: exportBodyPayload });
    if (replayed.status !== 200) responseError(replayed, "export_failed");
    const replayBody = replayed.body as ExportBody;
    replaySameDigest = replayBody.digest === exportBody.digest && replayBody.identity === exportBody.identity;
    replayDuplicate = replayBody.created === true;
    if (replaySameDigest !== true || replayDuplicate) {
      throw new AcceptanceFailure(
        "duplicate_artifact",
        `Replaying export ${exportBody.identity} produced identity ${replayBody.identity} digest ${replayBody.digest} created=${replayBody.created}`,
      );
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
    artifact: {
      identity: exportBody.identity,
      path: exportBody.path,
      digest: exportBody.digest,
      verification: exportBody.verification,
      ...(replaySameDigest === undefined ? {} : { replaySameDigest }),
      ...(replayDuplicate === undefined ? {} : { replayDuplicate }),
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
  const artifactDir = persistOperatorDbs
    ? optionalResolvedPath(options.artifactDir ?? process.env.CLONE_MARKET_ARTIFACT_DIR ?? "./data/artifacts")!
    : join(work, "artifacts");
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
      notes: "Record catalog → inspector → preview → artifact export → offline verification in a real browser; Botmancers apply/return is unsupported in V0. See docs/acceptance-v0.md ([operator]).",
    },
    failureCases: [],
    peerRepositories: {
      botmancers: {
        status: "skipped",
        returnRouteConfirmed: false,
        idempotencyKeyConfirmed: false,
        detail: "Peer verification is outside V0 acceptance and is not requested for this run.",
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

    mkdirSync(artifactDir, { recursive: true });
    const artifacts = new FileArtifactSink(artifactDir);

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
      const handlers = createV1Handlers(exportMarket({
        catalog: catalogRepo,
        evidence,
        adapter,
        artifacts,
        now,
      }));
      const catalogResponse = await handlers.catalog();
      if (catalogResponse.status !== 200) responseError(catalogResponse, "catalog_failed");
      const catalogBody = catalogResponse.body as { total: number; items: CatalogItem[] };
      if (catalogBody.total < 1) throw new AcceptanceFailure("catalog_empty", "Catalog traversal returned zero templates");
      report.evidence = await inspectDisplayedLabels(handlers, catalogBody.items, sourceIdentity);
      const previewCheck = await handlers.preview({ params: params(sourceIdentity), body: { policy: POLICY } });
      if (previewCheck.status !== 200) responseError(previewCheck, "preview_failed");
      const exported = await previewAndExport({
        handlers,
        source: sourceIdentity,
        replay: true,
      });
      const detail = await handlers.detail({ params: params(sourceIdentity) });
      const detailBody = detail.body as { manifest: { provenanceUrl: string; retrievedAt: string; template: { name: string } } };
      report.template = {
        source: sourceIdentity,
        provenanceUrl: detailBody.manifest.provenanceUrl,
        retrievedAt: detailBody.manifest.retrievedAt,
        name: detailBody.manifest.template.name,
      };
      report.compatibility = exported.compatibility;
      report.approval = exported.approval;
      report.artifact = exported.artifact;
    } else {
      const grokBaseUrl = options.grokBaseUrl ?? process.env.CLONE_MARKET_GROK_BASE_URL ?? "https://x.ai/bot/marketplace/";
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
      const handlers = createV1Handlers(exportMarket({
        catalog,
        evidence: evidence!,
        adapter,
        artifacts,
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
      const exported = await previewAndExport({
        handlers,
        source: sourceIdentity,
        replay: true,
      });
      report.compatibility = exported.compatibility;
      report.approval = exported.approval;
      report.artifact = exported.artifact;
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
        detail: "Peer Botmancers verification is outside V0 acceptance. Opt in only with CLONE_MARKET_ACCEPTANCE_PEER_REPOS=1 and BOTMANCERS_ROOT.",
      };

    const statuses: Array<"passed" | "failed"> = [
      report.reconciliation.unexplainedOmissions.length === 0 ? "passed" : "failed",
      report.evidence?.usesInstallCount === false && report.evidence?.usesPrivateUsage === false ? "passed" : "failed",
      report.artifact?.verification.status === "passed" && report.artifact.replaySameDigest === true && report.artifact.replayDuplicate === false ? "passed" : "failed",
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
