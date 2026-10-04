import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { botmancersBotUrl } from "../botmancers-url.js";
import { CHOSEN_SOURCE } from "./fixtures.js";
import { adoptionLabelFlags } from "./label-guards.js";
import { runV0Acceptance } from "./run.js";

describe("V0 acceptance harness [agent]", () => {
  it("proves fixture catalog reconciliation, evidence labels, apply/verify, and failure paths without network", async () => {
    mkdirSync(join(process.cwd(), ".temporal/logs"), { recursive: true });
    const reportPath = join(process.cwd(), ".temporal/logs/v0-acceptance-fixture-test.json");
    const report = await runV0Acceptance({
      mode: "fixture",
      reportPath,
      botmancersUiBaseUrl: "http://127.0.0.1:3100/",
      verifyPeerRepos: false,
    });

    expect(report.status).toBe("passed");
    expect(report.exitCode).toBe(0);
    expect(report.error).toBeUndefined();
    expect(report.mode).toBe("fixture");
    expect(report.databases.retainedAfterRun).toBe(false);
    expect(report.source.count).toBeGreaterThan(0);
    expect(report.reconciliation.unexplainedOmissions).toEqual([]);
    expect(report.reconciliation.added + report.reconciliation.unchanged + report.reconciliation.changed + report.reconciliation.reappeared)
      .toBe(report.source.count);

    expect(report.template?.source).toEqual(CHOSEN_SOURCE);
    expect(report.evidence?.label).toBe("observed_use");
    expect(report.evidence?.evidenceRows.length).toBeGreaterThan(0);
    expect(report.evidence?.contributions.length).toBeGreaterThan(0);
    expect(report.evidence?.usesInstallCount).toBe(false);
    expect(report.evidence?.usesPrivateUsage).toBe(false);

    expect(report.compatibility?.planDigest.startsWith("sha256:")).toBe(true);
    expect(report.approval?.approved).toBe(true);
    expect(report.approval?.planDigest).toBe(report.compatibility?.planDigest);
    expect(report.target?.operationId.startsWith("apply-")).toBe(true);
    expect(report.target?.botmancersBotId).toMatch(/^bot-/);
    expect(report.target?.verification.status).toBe("passed");
    expect(report.target?.replaySameBot).toBe(true);
    expect(report.target?.returnUrl).toBe(botmancersBotUrl("http://127.0.0.1:3100/", report.target!.botmancersBotId));

    const byId = Object.fromEntries(report.failureCases.map((item) => [item.id, item]));
    expect(byId.source_schema_drift).toMatchObject({ status: "passed", expectedCode: "source_drift", mutating: false, httpStatus: 503 });
    expect(byId.botmancers_unavailable).toMatchObject({ status: "passed", expectedCode: "target_unavailable", mutating: false, httpStatus: 503 });
    expect(byId.botmancers_unavailable_apply).toMatchObject({ status: "passed", expectedCode: "target_unavailable", mutating: false, httpStatus: 503 });
    expect(byId.changed_plan_after_preview).toMatchObject({ status: "passed", expectedCode: "stale_plan", mutating: false, httpStatus: 409 });
    expect(byId.idempotent_retry).toMatchObject({ status: "passed", mutating: false });
    expect(byId.idempotent_retry?.detail).toContain("bots=1");

    expect(report.browser.status).toBe("operator_required");
    expect(report.peerRepositories.botmancers.status).toBe("skipped");
  });

  it("writes a typed failed live report when operator databases are missing", async () => {
    mkdirSync(join(process.cwd(), ".temporal/logs"), { recursive: true });
    const reportPath = join(process.cwd(), ".temporal/logs/v0-acceptance-live-missing-db.json");
    const report = await runV0Acceptance({
      mode: "live",
      reportPath,
      catalogPath: "",
      evidencePath: "",
      verifyPeerRepos: false,
    });
    expect(report.status).toBe("failed");
    expect(report.exitCode).toBe(1);
    expect(report.error?.code).toBe("missing_catalog_db");
    expect(report.databases.retainedAfterRun).toBe(true);
    const written = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(reportPath, "utf8"))) as typeof report;
    expect(written.error?.code).toBe("missing_catalog_db");
  });

  it("writes a typed failed live report when the evidence database is absent", async () => {
    mkdirSync(join(process.cwd(), ".temporal/logs"), { recursive: true });
    const catalogPath = join(process.cwd(), ".temporal/logs/v0-live-catalog.sqlite");
    const reportPath = join(process.cwd(), ".temporal/logs/v0-acceptance-live-missing-evidence.json");
    writeFileSync(catalogPath, "");
    const report = await runV0Acceptance({
      mode: "live",
      reportPath,
      catalogPath,
      evidencePath: join(process.cwd(), ".temporal/logs/does-not-exist-evidence.sqlite"),
      verifyPeerRepos: false,
    });
    expect(report.error?.code).toBe("missing_evidence_db");
    expect(report.status).toBe("failed");
  });
});

describe("adoption label guards [agent]", () => {
  const snapshot = {
    schemaVersion: "1.0.0" as const,
    id: "adoption-1",
    templateId: "t",
    calculatedAt: "2026-10-03T18:00:00.000Z",
    evidenceThrough: "2026-10-03T18:00:00.000Z",
    uniqueMentions: 1,
    independentUsageReports: 1,
    repeatedUseReports: 0,
    outcomeReports: 0,
    sourceBreadth: 1,
    velocity: 1,
    label: "observed_use" as const,
    confidence: 0.8,
    provenance: {
      schemaVersion: "1.0.0" as const,
      source: { provider: "clone-market-evidence", externalId: "t" },
      retrievedAt: "2026-10-03T18:00:00.000Z",
      url: "https://example.test/evidence",
    },
  };

  it("detects installCount and private usage in contributions or evidence rows", () => {
    expect(adoptionLabelFlags({
      snapshot,
      contributions: [{ rule: "reviewed_evidence", passed: true, count: 1, threshold: 1, evidenceIds: ["a"], explanation: "Public posts only." }],
      evidenceRows: [],
    })).toEqual({ usesInstallCount: false, usesPrivateUsage: false });

    expect(adoptionLabelFlags({
      snapshot,
      contributions: [{ rule: "reviewed_evidence", passed: true, count: 1, threshold: 1, evidenceIds: ["a"], explanation: "Boosted by sourceMetadata.installCount." }],
      evidenceRows: [],
    }).usesInstallCount).toBe(true);

    expect(adoptionLabelFlags({
      snapshot,
      contributions: [{ rule: "reviewed_evidence", passed: true, count: 1, threshold: 1, evidenceIds: ["a"], explanation: "Includes clone_market_activity." }],
      evidenceRows: [],
    }).usesPrivateUsage).toBe(true);
  });
});
