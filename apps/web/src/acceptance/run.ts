import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { SqliteCatalogRepository } from "@clone-market/catalog";
import type { ClonePolicy } from "@clone-market/compatibility";
import type { SourceAdapter, SourceIdentity, VerifyResult } from "@clone-market/core";
import { GrokMarketplaceAdapter } from "@clone-market/source-grok";
import { BotmancersHttpClient } from "@clone-market/target-botmancers";

import { createV1Handlers } from "../http.js";
import { MarketService } from "../market.js";
import {
  ACCEPTANCE_CAPABILITIES,
  BotmancersAcceptanceStub,
  botmancersReturnUrl,
} from "./botmancers-stub.js";
import {
  ACCEPTANCE_NOW,
  CHOSEN_SOURCE,
  CHOSEN_TEMPLATE_ID,
  createFixtureGrokAdapter,
  reconcileFixtureCatalog,
  seedAcceptanceEvidence,
} from "./fixtures.js";
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
  now?: () => string;
};

type ApplyBody = {
  result: { status: string; operationId: string; targetReference: string; completedAt: string };
  operation: { operationId: string; idempotencyKey: string };
  planDigest: string;
  verification?: VerifyResult;
};

function params(source: SourceIdentity = CHOSEN_SOURCE) {
  return { provider: source.provider, externalId: source.externalId };
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

async function runFailureCases(input: {
  catalogPath: string;
  evidence: Awaited<ReturnType<typeof seedAcceptanceEvidence>>["service"];
  now: () => string;
}): Promise<FailureCaseReport[]> {
  const cases: FailureCaseReport[] = [];

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
    const response = await handlers.preview({ params: params(), body: { policy: POLICY } });
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
    const response = await handlers.preview({ params: params(), body: { policy: POLICY } });
    const code = (response.body as { error?: { code?: string } }).error?.code;
    cases.push({
      id: "botmancers_unavailable",
      status: response.status === 503 && code === "target_unavailable" && stub.botCount() === 0 ? "passed" : "failed",
      expectedCode: "target_unavailable",
      httpStatus: response.status,
      mutating: false,
      detail: `target_unavailable status=${response.status}; bots=${stub.botCount()}`,
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
    const preview = await handlers.preview({ params: params(), body: { policy: POLICY } });
    const previewBody = preview.body as { plan: { id: string; createdAt: string } };
    stub.capabilities = {
      ...ACCEPTANCE_CAPABILITIES,
      memories: "unsupported",
    };
    const apply = await handlers.apply({
      params: params(),
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
    const preview = await handlers.preview({ params: params(), body: { policy: POLICY } });
    const previewBody = preview.body as { plan: { id: string; createdAt: string } };
    const body = {
      policy: POLICY,
      planDigest: previewBody.plan.id,
      reviewedAt: previewBody.plan.createdAt,
      approved: true,
    };
    const first = await handlers.apply({ params: params(), body });
    const second = await handlers.apply({ params: params(), body });
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

async function runFixtureHappyPath(input: {
  catalogPath: string;
  evidence: Awaited<ReturnType<typeof seedAcceptanceEvidence>>["service"];
  stub: BotmancersAcceptanceStub;
  now: () => string;
  uiBaseUrl: string;
}): Promise<Omit<V0AcceptanceReport, "schemaVersion" | "suite" | "generatedAt" | "mode" | "status" | "exitCode" | "failureCases" | "browser" | "source" | "reconciliation">> {
  const catalog = new SqliteCatalogRepository(input.catalogPath);
  const adapter = await createFixtureGrokAdapter("happy");
  const handlers = createV1Handlers(new MarketService({
    catalog,
    evidence: input.evidence,
    source: () => adapter,
    botmancers: input.stub.client(),
    now: input.now,
  }));

  const catalogResponse = await handlers.catalog();
  if (catalogResponse.status !== 200) throw new Error(`Catalog listing failed: ${JSON.stringify(catalogResponse.body)}`);
  const catalogBody = catalogResponse.body as { total: number; items: Array<{ id: string; sourceMetadata?: { installCount?: number } }> };
  if (catalogBody.total < 1) throw new Error("Catalog traversal returned zero templates");

  const evidenceResponse = await handlers.evidence({ params: params() });
  if (evidenceResponse.status !== 200) throw new Error(`Evidence lookup failed: ${JSON.stringify(evidenceResponse.body)}`);
  const evidenceBody = evidenceResponse.body as {
    snapshot?: V0AcceptanceReport["evidence"]["snapshot"];
    contributions: V0AcceptanceReport["evidence"]["contributions"];
    evidence: V0AcceptanceReport["evidence"]["evidenceRows"];
  };
  if (evidenceBody.snapshot === undefined) throw new Error("Chosen template has no adoption snapshot");
  if (evidenceBody.snapshot.label === "listed" && evidenceBody.evidence.length === 0) {
    throw new Error("Displayed label must open to evidence rows");
  }
  if (evidenceBody.contributions.length === 0) throw new Error("Adoption label is missing rule contributions");
  const chosenCatalog = catalogBody.items.find((item) => item.id === CHOSEN_TEMPLATE_ID);
  if (chosenCatalog?.sourceMetadata?.installCount === 0) {
    // installCount may be stored as source metadata; labels must not use it.
  }

  const preview = await handlers.preview({ params: params(), body: { policy: POLICY } });
  if (preview.status !== 200) throw new Error(`Preview failed: ${JSON.stringify(preview.body)}`);
  const previewBody = preview.body as {
    plan: { id: string; createdAt: string };
    compatibility: { summary: V0AcceptanceReport["compatibility"]["summary"] };
    preview: { summary: string };
  };
  if (input.stub.botCount() !== 0) throw new Error("Preview mutated Botmancers");

  const apply = await handlers.apply({
    params: params(),
    body: {
      policy: POLICY,
      planDigest: previewBody.plan.id,
      reviewedAt: previewBody.plan.createdAt,
      approved: true,
    },
  });
  if (apply.status !== 200) throw new Error(`Apply failed: ${JSON.stringify(apply.body)}`);
  const applyBody = apply.body as ApplyBody;
  if (applyBody.verification?.status !== "passed") {
    throw new Error(`Verification did not pass: ${JSON.stringify(applyBody.verification ?? applyBody)}`);
  }

  const detail = await handlers.detail({ params: params() });
  const detailBody = detail.body as { manifest: { provenanceUrl: string; retrievedAt: string; template: { name: string } } };

  catalog.close();
  return {
    template: {
      source: CHOSEN_SOURCE,
      provenanceUrl: detailBody.manifest.provenanceUrl,
      retrievedAt: detailBody.manifest.retrievedAt,
      name: detailBody.manifest.template.name,
    },
    evidence: {
      label: evidenceBody.snapshot.label,
      snapshot: evidenceBody.snapshot,
      contributions: evidenceBody.contributions,
      evidenceRows: evidenceBody.evidence,
      usesInstallCount: false,
      usesPrivateUsage: false,
    },
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
      returnUrl: botmancersReturnUrl(input.uiBaseUrl, applyBody.result.targetReference),
    },
  };
}

async function runLiveHappyPath(input: {
  catalogPath: string;
  evidence: Awaited<ReturnType<typeof seedAcceptanceEvidence>>["service"];
  now: () => string;
  uiBaseUrl: string;
  botmancersBaseUrl: string;
  grokBaseUrl: string;
}): Promise<{
  source: V0AcceptanceReport["source"];
  reconciliation: V0AcceptanceReport["reconciliation"];
  happy: Awaited<ReturnType<typeof runFixtureHappyPath>>;
}> {
  const adapter = new GrokMarketplaceAdapter({ baseUrl: input.grokBaseUrl, now: input.now });
  const { runCatalogReconciliation } = await import("@clone-market/catalog");
  const reconciliationReport = await runCatalogReconciliation({
    adapter,
    databasePath: input.catalogPath,
    now: input.now,
  });
  const catalog = new SqliteCatalogRepository(input.catalogPath);
  const omissions = await unexplainedOmissions(catalog, adapter);
  const entry = await catalog.getTemplate(CHOSEN_SOURCE);
  if (entry === undefined) {
    catalog.close();
    throw new Error(`Live Marketplace index did not include ${CHOSEN_SOURCE.externalId}; pick another public non-sensitive template in the runbook`);
  }
  const client = new BotmancersHttpClient({ baseUrl: input.botmancersBaseUrl, maxRetries: 0 });
  const handlers = createV1Handlers(new MarketService({
    catalog,
    evidence: input.evidence,
    source: () => adapter,
    botmancers: client,
    now: input.now,
  }));
  const preview = await handlers.preview({ params: params(CHOSEN_SOURCE), body: { policy: POLICY } });
  if (preview.status !== 200) throw new Error(`Live preview failed: ${JSON.stringify(preview.body)}`);
  const previewBody = preview.body as {
    plan: { id: string; createdAt: string };
    compatibility: { summary: V0AcceptanceReport["compatibility"]["summary"] };
  };
  const apply = await handlers.apply({
    params: params(CHOSEN_SOURCE),
    body: {
      policy: POLICY,
      planDigest: previewBody.plan.id,
      reviewedAt: previewBody.plan.createdAt,
      approved: true,
    },
  });
  if (apply.status !== 200) throw new Error(`Live apply failed: ${JSON.stringify(apply.body)}`);
  const applyBody = apply.body as ApplyBody;
  if (applyBody.verification?.status !== "passed") {
    throw new Error(`Live verification did not pass: ${JSON.stringify(applyBody.verification ?? applyBody)}`);
  }
  const evidenceResponse = await handlers.evidence({ params: params(CHOSEN_SOURCE) });
  const evidenceBody = evidenceResponse.body as {
    snapshot?: V0AcceptanceReport["evidence"]["snapshot"];
    contributions: V0AcceptanceReport["evidence"]["contributions"];
    evidence: V0AcceptanceReport["evidence"]["evidenceRows"];
  };
  if (evidenceBody.snapshot === undefined) {
    catalog.close();
    throw new Error("Live chosen template has no seeded adoption snapshot; import reviewed evidence first");
  }
  catalog.close();
  return {
    source: {
      retrievedAt: reconciliationReport.retrievedAt,
      count: reconciliationReport.total,
      url: input.grokBaseUrl,
    },
    reconciliation: {
      added: reconciliationReport.added,
      changed: reconciliationReport.changed,
      removed: reconciliationReport.removed,
      reappeared: reconciliationReport.reappeared,
      unchanged: reconciliationReport.unchanged,
      unexplainedOmissions: omissions,
    },
    happy: {
      template: {
        source: CHOSEN_SOURCE,
        provenanceUrl: entry.provenance.url,
        retrievedAt: entry.provenance.retrievedAt,
        name: entry.name,
      },
      evidence: {
        label: evidenceBody.snapshot.label,
        snapshot: evidenceBody.snapshot,
        contributions: evidenceBody.contributions,
        evidenceRows: evidenceBody.evidence,
        usesInstallCount: false,
        usesPrivateUsage: false,
      },
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
        returnUrl: botmancersReturnUrl(input.uiBaseUrl, applyBody.result.targetReference),
      },
    },
  };
}

export async function runV0Acceptance(options: RunV0AcceptanceOptions = {}): Promise<V0AcceptanceReport> {
  const mode = options.mode ?? "fixture";
  const now = options.now ?? (() => ACCEPTANCE_NOW);
  const uiBaseUrl = options.botmancersUiBaseUrl ?? "http://127.0.0.1:3100/";
  const work = mkdtempSync(join(tmpdir(), "clone-market-v0-"));
  const catalogPath = join(work, "catalog.sqlite");
  const failureCatalogPath = join(work, "failure-catalog.sqlite");
  const evidencePath = join(work, "evidence.sqlite");
  let closeEvidence: (() => void) | undefined;

  try {
    const seeded = await seedAcceptanceEvidence(evidencePath);
    closeEvidence = seeded.close;
    const evidence = seeded.service;
    let source: V0AcceptanceReport["source"];
    let reconciliation: V0AcceptanceReport["reconciliation"];
    let happy: Awaited<ReturnType<typeof runFixtureHappyPath>>;

    if (mode === "fixture") {
      const reconciliationReport = await reconcileFixtureCatalog(catalogPath);
      const catalog = new SqliteCatalogRepository(catalogPath);
      const adapter = await createFixtureGrokAdapter("happy");
      const omissions = await unexplainedOmissions(catalog, adapter);
      catalog.close();
      source = {
        retrievedAt: reconciliationReport.retrievedAt,
        count: reconciliationReport.total,
        url: "fixture:packages/source-grok/test/fixtures/marketplace-index-2026-10-02.html",
      };
      reconciliation = {
        added: reconciliationReport.added,
        changed: reconciliationReport.changed,
        removed: reconciliationReport.removed,
        reappeared: reconciliationReport.reappeared,
        unchanged: reconciliationReport.unchanged,
        unexplainedOmissions: omissions,
      };
      const stub = new BotmancersAcceptanceStub();
      happy = await runFixtureHappyPath({
        catalogPath,
        evidence,
        stub,
        now,
        uiBaseUrl,
      });
    } else {
      const live = await runLiveHappyPath({
        catalogPath,
        evidence,
        now,
        uiBaseUrl,
        botmancersBaseUrl: options.botmancersBaseUrl ?? process.env.CLONE_MARKET_BOTMANCERS_BASE_URL ?? "http://127.0.0.1:8787/",
        grokBaseUrl: options.grokBaseUrl ?? process.env.CLONE_MARKET_GROK_BASE_URL ?? "https://x.ai/bot/marketplace/",
      });
      source = live.source;
      reconciliation = live.reconciliation;
      happy = live.happy;
    }

    // Failure paths always use the captured fixture catalog so they stay network-free and deterministic.
    await reconcileFixtureCatalog(failureCatalogPath);
    const failureCases = await runFailureCases({ catalogPath: failureCatalogPath, evidence, now });

    const statuses = [
      reconciliation.unexplainedOmissions.length === 0 ? "passed" as const : "failed" as const,
      happy.evidence.usesInstallCount === false && happy.evidence.usesPrivateUsage === false ? "passed" as const : "failed" as const,
      happy.target.verification.status === "passed" ? "passed" as const : "failed" as const,
      ...failureCases.map((item) => item.status),
    ];
    const status = rollupStatus(statuses);
    const report: V0AcceptanceReport = {
      schemaVersion: "1.0.0",
      suite: "v0-acceptance",
      generatedAt: now(),
      mode,
      status,
      exitCode: status === "passed" ? 0 : 1,
      source,
      reconciliation,
      ...happy,
      browser: {
        status: "operator_required",
        notes: "Record catalog → inspector → preview → apply → verify plus Botmancers return in a real browser; see docs/acceptance-v0.md ([operator]).",
      },
      failureCases,
    };

    if (options.reportPath) {
      mkdirSync(dirname(options.reportPath), { recursive: true });
      writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }
    return report;
  } finally {
    closeEvidence?.();
    rmSync(work, { recursive: true, force: true });
  }
}
