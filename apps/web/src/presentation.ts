import type { AdoptionEvidenceQuery } from "@clone-market/evidence";
import type { CatalogItem, Review } from "./market.js";

const LABELS = {
  listed: "Listed",
  discussed: "Discussed",
  emerging: "Emerging",
  observed_use: "Observed use",
} as const;

function escape(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function adoptionLabel(item: CatalogItem): string {
  return item.adoption ? LABELS[item.adoption.label] : "Listed";
}

export function renderCatalog(items: readonly CatalogItem[]): string {
  return `<div class="catalog-grid">${items.map((item) => `<article class="template-card">
    <div class="card-flags">${item.featured ? '<span class="badge featured">Featured</span>' : ""}<span class="badge adoption">${adoptionLabel(item)}</span></div>
    <h2><a href="/templates/${escape(item.provenance.source.provider)}/${escape(item.provenance.source.externalId)}">${escape(item.name)}</a></h2>
    <p>${escape(item.summary)}</p><dl><dt>Source</dt><dd>${escape(item.provenance.source.provider)}</dd><dt>Creator</dt><dd>${escape(item.creator.name)}</dd><dt>Evidence</dt><dd class="${item.evidenceState}">${escape(item.evidenceState)}</dd></dl>
  </article>`).join("")}</div>`;
}

export function renderEvidence(query: AdoptionEvidenceQuery | undefined): string {
  if (!query) return '<p class="empty">No public evidence has been reviewed. This template remains Listed.</p>';
  const counted = new Set(query.countedEvidenceIds);
  return `<section><h2>Why ${LABELS[query.snapshot.label]}</h2><ul class="rules">${query.contributions.map((rule) => `<li data-rule="${escape(rule.rule)}"><strong>${rule.passed ? "Passed" : "Not passed"}</strong> ${escape(rule.explanation)} (${rule.count}/${rule.threshold})</li>`).join("")}</ul><table><thead><tr><th>Used</th><th>Type</th><th>Claim</th><th>Author</th></tr></thead><tbody>${query.evidence.map((row) => `<tr data-evidence-id="${escape(row.id)}"><td>${counted.has(row.id) ? "Yes" : "No"}</td><td>${escape(row.type)}</td><td>${escape(row.claim)}</td><td>${escape(row.author.name)}</td></tr>`).join("")}</tbody></table></section>`;
}

export function renderReview(review: Review): string {
  const rows = review.compatibility.assessments.map((row) => `<tr class="${row.classification}"><td>${escape(row.componentType)}</td><td>${escape(row.componentId)}</td><td><span class="badge">${escape(row.classification)}</span></td><td>${escape(row.rationaleCode)}</td></tr>`).join("");
  return `<section class="review"><header><p class="eyebrow">Private Botmancers import</p><h1>Review before applying</h1><p>${escape(review.preview.summary)}</p></header>
    ${review.compatibility.summary.unsafe ? '<div class="alert danger">Unsafe plan — apply is blocked.</div>' : ""}
    ${review.compatibility.summary.partial ? '<div class="alert warning">Partial compatibility requires review before apply.</div>' : ""}
    <h2>Component compatibility</h2><table><thead><tr><th>Type</th><th>Component</th><th>Result</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table>
    <h2>Required actions</h2><ul>${review.compatibility.requiredUserActions.map((action) => `<li>${escape(action.code)}${action.subject ? `: ${escape(action.subject)}` : ""}</li>`).join("") || "<li>None</li>"}</ul>
    <h2>Target payload preview</h2><pre>${escape(review.preview.artifacts.find(({ path }) => path.endsWith("import.json"))?.content)}</pre>
    <div class="decision"><h2>Your decision</h2><label><input type="checkbox" name="approved"> I approve this exact plan digest</label><button data-plan-digest="${escape(review.plan.id)}">Apply private clone</button></div></section>`;
}

export function renderVerification(result: { status: string; checks: readonly { name: string; passed: boolean; detail: string }[] }): string {
  return `<section><h2>Verification ${escape(result.status)}</h2><ul>${result.checks.map((check) => `<li class="${check.passed ? "passed" : "failed"}"><strong>${escape(check.name)}</strong> ${escape(check.detail)}</li>`).join("")}</ul></section>`;
}
