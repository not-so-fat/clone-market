import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { botmancersReturnUrl } from "./botmancers-stub.js";
import { CHOSEN_SOURCE } from "./fixtures.js";
import { runV0Acceptance } from "./run.js";

describe("V0 acceptance harness [agent]", () => {
  it("proves fixture catalog reconciliation, evidence labels, apply/verify, and failure paths without network", async () => {
    mkdirSync(join(process.cwd(), ".temporal/logs"), { recursive: true });
    const reportPath = join(process.cwd(), ".temporal/logs/v0-acceptance-fixture-test.json");
    const report = await runV0Acceptance({
      mode: "fixture",
      reportPath,
      botmancersUiBaseUrl: "http://127.0.0.1:3100/",
    });

    expect(report.status).toBe("passed");
    expect(report.exitCode).toBe(0);
    expect(report.mode).toBe("fixture");
    expect(report.source.count).toBeGreaterThan(0);
    expect(report.source.count).not.toBe(0);
    // Observed count from the captured index — not a product hard-cap.
    expect(report.reconciliation.unexplainedOmissions).toEqual([]);
    expect(report.reconciliation.added + report.reconciliation.unchanged + report.reconciliation.changed + report.reconciliation.reappeared)
      .toBe(report.source.count);

    expect(report.template.source).toEqual(CHOSEN_SOURCE);
    expect(report.evidence.label).toBe("observed_use");
    expect(report.evidence.evidenceRows.length).toBeGreaterThan(0);
    expect(report.evidence.contributions.length).toBeGreaterThan(0);
    expect(report.evidence.usesInstallCount).toBe(false);
    expect(report.evidence.usesPrivateUsage).toBe(false);

    expect(report.compatibility.planDigest.startsWith("sha256:")).toBe(true);
    expect(report.approval.approved).toBe(true);
    expect(report.approval.planDigest).toBe(report.compatibility.planDigest);
    expect(report.target.operationId.startsWith("apply-")).toBe(true);
    expect(report.target.botmancersBotId).toMatch(/^bot-/);
    expect(report.target.verification.status).toBe("passed");
    expect(report.target.returnUrl).toBe(botmancersReturnUrl("http://127.0.0.1:3100/", report.target.botmancersBotId));

    const byId = Object.fromEntries(report.failureCases.map((item) => [item.id, item]));
    expect(byId.source_schema_drift).toMatchObject({ status: "passed", expectedCode: "source_drift", mutating: false, httpStatus: 503 });
    expect(byId.botmancers_unavailable).toMatchObject({ status: "passed", expectedCode: "target_unavailable", mutating: false, httpStatus: 503 });
    expect(byId.changed_plan_after_preview).toMatchObject({ status: "passed", expectedCode: "stale_plan", mutating: false, httpStatus: 409 });
    expect(byId.idempotent_retry).toMatchObject({ status: "passed", mutating: false });
    expect(byId.idempotent_retry?.detail).toContain("bots=1");

    expect(report.browser.status).toBe("operator_required");
  });
});
