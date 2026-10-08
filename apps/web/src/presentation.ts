import type { AgentDeckRegistrationPreview, AgentDeckReadiness } from "@clone-market/agent-deck-preview";
import type { SourceIdentity } from "@clone-market/core";
import type { AdoptionEvidenceQuery } from "@clone-market/evidence";
import type { CatalogItem, ReviewResponse } from "./market.js";

export const GROK_MARKETPLACE_URL = "https://x.ai/bot/marketplace";

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
  return `<div class="catalog-grid">${items.map((item) => {
    const href = `/templates/${encodeURIComponent(item.provenance.source.provider)}/${encodeURIComponent(item.provenance.source.externalId)}`;
    return `<article class="template-card">
    <div class="card-flags">${item.featured ? '<span class="badge featured">Featured</span>' : ""}<a class="badge adoption" href="${href}#evidence" aria-label="Open evidence for ${escape(item.name)}">${adoptionLabel(item)}</a></div>
    <h2><a href="${href}">${escape(item.name)}</a></h2>
    <p>${escape(item.summary)}</p><dl><dt>Source</dt><dd>${escape(item.provenance.source.provider)}</dd><dt>Creator</dt><dd>${escape(item.creator.name)}</dd><dt>Evidence</dt><dd class="${item.evidenceState}">${escape(item.evidenceState)}${item.adoption ? ` · through ${escape(item.adoption.evidenceThrough)}` : ""}</dd></dl>
  </article>`;
  }).join("")}</div>`;
}

export function renderEvidence(query: AdoptionEvidenceQuery | undefined): string {
  if (!query) return '<section id="evidence"><h2>Why Listed</h2><p class="empty">No public evidence has been reviewed. This template remains Listed.</p></section>';
  const counted = new Set(query.countedEvidenceIds);
  return `<section id="evidence"><h2>Why ${LABELS[query.snapshot.label]}</h2><ul class="rules">${query.contributions.map((rule) => `<li data-rule="${escape(rule.rule)}"><strong>${rule.passed ? "Passed" : "Not passed"}</strong> ${escape(rule.explanation)} (${rule.count}/${rule.threshold})</li>`).join("")}</ul><table><thead><tr><th>Used</th><th>Type</th><th>Claim</th><th>Author</th></tr></thead><tbody>${query.evidence.map((row) => `<tr data-evidence-id="${escape(row.id)}"><td>${counted.has(row.id) ? "Yes" : "No"}</td><td>${escape(row.type)}</td><td>${escape(row.claim)}</td><td>${escape(row.author.name)}</td></tr>`).join("")}</tbody></table></section>`;
}

export function renderReview(review: ReviewResponse): string {
  const rows = review.compatibility.assessments.map((row) => `<tr class="${row.classification}"><td>${escape(row.componentType)}</td><td>${escape(row.componentId)}</td><td><span class="badge">${escape(row.classification)}</span></td><td>${escape(row.rationaleCode)}</td></tr>`).join("");
  return `<section class="review"><header><p class="eyebrow">Private Botmancers import</p><h1>Review before exporting</h1><p>${escape(review.preview.summary)}</p></header>
    ${review.compatibility.summary.unsafe ? '<div class="alert danger">Unsafe plan — export is blocked.</div>' : ""}
    ${review.compatibility.summary.partial ? '<div class="alert warning">Partial compatibility requires review before export.</div>' : ""}
    <h2>Component compatibility</h2><table><thead><tr><th>Type</th><th>Component</th><th>Result</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table>
    <h2>Required actions</h2><ul>${review.compatibility.requiredUserActions.map((action) => `<li>${escape(action.code)}${action.subject ? `: ${escape(action.subject)}` : ""}</li>`).join("") || "<li>None</li>"}</ul>
    <h2>Target payload preview</h2><pre>${escape(review.preview.artifacts.find(({ path }) => path.endsWith("import.json"))?.content)}</pre>
    <div class="decision"><h2>Your decision</h2><label><input type="checkbox" name="approved"> I approve this exact plan digest</label><button data-plan-digest="${escape(review.plan.id)}">Export private artifact</button></div></section>`;
}

export function renderVerification(result: { status: string; checks: readonly { name: string; passed: boolean; detail: string }[] }): string {
  return `<section><h2>Verification ${escape(result.status)}</h2><ul>${result.checks.map((check) => `<li class="${check.passed ? "passed" : "failed"}"><strong>${escape(check.name)}</strong> ${escape(check.detail)}</li>`).join("")}</ul></section>`;
}

export function renderTrialHome(): string {
  return `<section class="hero"><p class="eyebrow">Try Clone Market</p><h1>See what a public Grok Bot would register.</h1>`
    + `<p>Clone Market reads a public bot's instructions, skills, routines, and integrations, then shows a read-only preview of the Agent Deck playbooks and MCP services it would register. This preview registers nothing, and nothing asks for credentials.</p>`
    + `<p><a class="external" href="${GROK_MARKETPLACE_URL}" target="_blank" rel="noreferrer">Open the Grok Bot Marketplace</a></p></section>`
    + `<div class="trial-grid"><section class="entry-card" aria-labelledby="trial-url-heading"><h2 id="trial-url-heading">Paste a URL</h2>`
    + `<p>Paste a public Grok Bot link to open its registration preview.</p>`
    + `<form method="get" action="/"><label>Public Grok Bot URL<input type="url" name="url" required placeholder="https://x.ai/bot/marketplace/bots/<slug>" autocomplete="off" /></label><button>Paste a URL to preview</button></form></section>`
    + `<section class="entry-card" aria-labelledby="trial-search-heading"><h2 id="trial-search-heading">Search the marketplace</h2>`
    + `<p>Search the complete indexed catalog by template name, creator, or summary.</p>`
    + `<form method="get" action="/"><label>Search templates<input type="search" name="q" placeholder="Name, creator, or summary" autocomplete="off" /></label><button>Search the marketplace</button></form></section></div>`
    + `<p class="browse-all"><a href="/catalog">Browse the complete catalog</a></p>`;
}

export function renderGrokUrlError(error: { code: string; message: string }): string {
  return `<section aria-label="URL error"><div class="alert danger" role="alert"><strong>${escape(error.code)}</strong>: ${escape(error.message)} No preview was fetched.</div>`
    + `<p>Check the link and try again, or <a href="/catalog">browse the complete catalog</a>.</p></section>`;
}

export function renderSearchError(error: { code: string; message: string }): string {
  return `<section aria-label="Search error"><div class="alert danger" role="alert"><strong>${escape(error.code)}</strong>: ${escape(error.message)} No preview was fetched.</div>`
    + `<p>Reload to retry the catalog database, or paste a Grok Bot URL above.</p></section>`;
}

export function renderSearchResults(query: string, items: readonly CatalogItem[], total: number): string {
  if (items.length === 0) {
    return `<section aria-label="Search results"><h2>No matches for &ldquo;${escape(query)}&rdquo;</h2>`
      + `<p>No templates match that search. Try different words, paste a Grok Bot URL, or <a href="/catalog">browse the complete catalog</a>.</p></section>`;
  }
  return `<section aria-label="Search results"><h2>${total} ${total === 1 ? "match" : "matches"} for &ldquo;${escape(query)}&rdquo; · complete catalog traversal</h2>`
    + `<ul class="result-list">${items.map((item) => {
      const href = `/templates/${encodeURIComponent(item.provenance.source.provider)}/${encodeURIComponent(item.provenance.source.externalId)}/agent-deck-preview`;
      return `<li><h3><a href="${href}">${escape(item.name)}</a></h3><p class="result-meta">by ${escape(item.creator.name)}</p><p>${escape(item.summary)}</p></li>`;
    }).join("")}</ul>`
    + `<p>Each result opens the same read-only &ldquo;Would register&rdquo; preview.</p></section>`;
}

const READINESS_LABELS: Readonly<Record<AgentDeckReadiness, string>> = {
  ready: "Ready",
  needs_review: "Needs review",
  cannot_produce: "Cannot produce",
};

const READINESS_CLASSES: Readonly<Record<AgentDeckReadiness, string>> = {
  ready: "ready",
  needs_review: "needs-review",
  cannot_produce: "cannot-produce",
};

export function renderAgentDeckPreview(preview: AgentDeckRegistrationPreview): string {
  const playbooks = preview.playbooks.length === 0
    ? `<p class="empty">No playbook candidates. The public source exposed no instructions, skills, or routines that would register.</p>`
    : `<ul class="candidate-list">${preview.playbooks.map((candidate) => {
      const memories = candidate.supportingContext.memoryIds.length === 0
        ? `<p>Supporting context: none.</p>`
        : `<p>Supporting context: ${candidate.supportingContext.memoryIds.length} public ${candidate.supportingContext.memoryIds.length === 1 ? "memory" : "memories"} (${candidate.supportingContext.memoryNames.map(escape).join(", ")}).</p>`;
      return `<li data-playbook-id="${escape(candidate.id)}"><h3>${escape(candidate.title)}</h3>`
        + `<p><span class="badge ${READINESS_CLASSES[candidate.readiness]}">${READINESS_LABELS[candidate.readiness]}</span></p>`
        + `<dl><dt>Source component</dt><dd>${escape(candidate.sourceComponent.type)}:${escape(candidate.sourceComponent.id)}</dd></dl>`
        + `<ul>${candidate.reviewReasons.map((reason) => `<li>${escape(reason)}</li>`).join("")}</ul>${memories}</li>`;
    }).join("")}</ul>`;
  const services = preview.mcpServices.length === 0
    ? `<p class="empty">No MCP service candidates. The public source declared no integrations that would register.</p>`
    : `<ul class="candidate-list">${preview.mcpServices.map((candidate) => {
      return `<li data-mcp-id="${escape(candidate.id)}"><h3>${escape(candidate.title)}</h3>`
        + `<p><span class="badge ${READINESS_CLASSES[candidate.readiness]}">${READINESS_LABELS[candidate.readiness]}</span></p>`
        + `<dl><dt>Source integration</dt><dd>${escape(candidate.sourceComponent.id)}</dd><dt>Connection</dt><dd>${candidate.connection.required ? "Required" : "Optional"} · credential state unknown</dd></dl>`
        + `<ul>${candidate.reviewReasons.map((reason) => `<li>${escape(reason)}</li>`).join("")}</ul></li>`;
    }).join("")}</ul>`;
  const unavailable = preview.unavailable.length === 0
    ? `<p>Every expected field was public from Grok.</p>`
    : `<ul>${preview.unavailable.map((item) => `<li><strong>${escape(item.field)}</strong>: ${escape(item.detail)}</li>`).join("")}</ul>`;
  return `<section class="preview-head"><p class="eyebrow">Read-only Agent Deck preview</p><h1>Would register</h1>`
    + `<p>This is what Clone Market would register in Agent Deck for ${escape(preview.template.name)} by ${escape(preview.template.creator)}. This preview registers nothing.</p>`
    + `<dl><dt>Source</dt><dd><a href="${escape(preview.provenanceUrl)}">Original Grok template</a></dd><dt>Retrieved at</dt><dd>${escape(preview.retrievedAt)}</dd><dt>Manifest</dt><dd>${escape(preview.manifestId)}</dd></dl></section>`
    + `<div class="preview-groups"><section aria-labelledby="preview-playbooks-heading"><h2 id="preview-playbooks-heading">Playbooks (${preview.playbooks.length})</h2>${playbooks}</section>`
    + `<section aria-labelledby="preview-mcp-heading"><h2 id="preview-mcp-heading">MCP services (${preview.mcpServices.length})</h2>${services}</section></div>`
    + `<section aria-label="Unavailable source fields"><h2>Unavailable from source</h2>${unavailable}</section>`
    + `<p class="back-links"><a href="/">Back to trial home</a> · <a href="${escape(preview.provenanceUrl)}">Open the original Grok template</a></p>`;
}

export function renderAgentDeckPreviewError(error: { code: string; message: string }, source: SourceIdentity): string {
  const retry = `/templates/${encodeURIComponent(source.provider)}/${encodeURIComponent(source.externalId)}/agent-deck-preview`;
  return `<section><p class="eyebrow">Recoverable preview error</p><h1>Preview unavailable</h1>`
    + `<div class="alert danger" role="alert"><strong>${escape(error.code)}</strong>: ${escape(error.message)}</div>`
    + `<p>This preview registers nothing. <a href="${retry}">Retry the preview</a>, or <a href="/">try another bot</a>.</p></section>`;
}
