import { marketService } from "../../../../src/runtime.js";
import { renderEvidence } from "../../../../src/presentation.js";
import { CloneReview } from "./clone-review.js";

export const dynamic = "force-dynamic";

export default async function TemplatePage({ params }: { params: Promise<{ provider: string; externalId: string }> }) {
  const identity = await params;
  const detail = await marketService().detail(identity);
  const manifest = detail.manifest;
  return <><a className="back" href="/">← Complete catalog</a><section className="inspector-head"><p className="eyebrow">{detail.entry.featured ? "Featured · " : ""}{detail.entry.provenance.source.provider}</p><h1>{detail.entry.name}</h1><p>{detail.entry.summary}</p><dl><dt>Creator</dt><dd>{detail.entry.creator.name}</dd><dt>Permission</dt><dd>Confirm before private import</dd><dt>Redistribution</dt><dd>Private destination only</dd></dl></section>
    {!detail.entry.present && <div className="alert warning">Source drift: this template is no longer present in the latest index.</div>}
    <div className="inspector-grid"><section><h2>Currently public components</h2><p>Fetched on demand at {manifest.retrievedAt}. The full manifest is not stored in the catalog or browser persistence.</p><ul><li>Instructions: {manifest.instructions ? "available" : "unavailable"}</li><li>Memories: {manifest.memories.length}</li><li>Skills: {manifest.skills.length}</li><li>Routines: {manifest.routines.length}</li><li>Integrations: {manifest.integrations.map(({ name }) => name).join(", ") || "none"}</li>{manifest.unavailableFields.map((field) => <li key={field}>{field}: unavailable from source</li>)}</ul></section><section><h2>Retrieval history</h2><ol>{detail.history.map((item) => <li key={`${item.capturedAt}:${item.contentHash}`}>{item.change} · {item.capturedAt}</li>)}</ol></section></div>
    <div dangerouslySetInnerHTML={{ __html: renderEvidence(detail.evidence) }} /><CloneReview {...identity} /></>;
}
