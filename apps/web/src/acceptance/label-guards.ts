import type { AdoptionSnapshot } from "@clone-market/core";
import type { RuleContribution, StoredEvidence } from "@clone-market/evidence";

const INSTALL_COUNT = /\binstallCount\b|sourceMetadata\.installCount/;
const PRIVATE_USAGE = /private[_ ]usage|clone.market.activity|clone_market_activity|private telemetry|first-party (views|saves|clone)/i;

export function adoptionLabelFlags(input: {
  snapshot: AdoptionSnapshot;
  contributions: RuleContribution[];
  evidenceRows: StoredEvidence[];
}): { usesInstallCount: boolean; usesPrivateUsage: boolean } {
  const contributionText = JSON.stringify(input.contributions);
  const snapshotText = JSON.stringify(input.snapshot);
  const usesInstallCount = INSTALL_COUNT.test(contributionText)
    || INSTALL_COUNT.test(snapshotText)
    || input.evidenceRows.some((row) => Object.hasOwn(row.engagement ?? {}, "installCount"));
  const usesPrivateUsage = PRIVATE_USAGE.test(contributionText)
    || PRIVATE_USAGE.test(snapshotText)
    || input.evidenceRows.some((row) =>
      row.provenance.source.provider === "clone-market-activity"
      || PRIVATE_USAGE.test(`${row.type} ${row.claim}`),
    );
  return { usesInstallCount, usesPrivateUsage };
}
