import { marketService } from "../../../../src/runtime";
import { renderEvidence } from "../../../../src/presentation";
import { MarketError } from "../../../../src/market";
import type { MarketService } from "../../../../src/market";
import { readConfig } from "../../../../src/config";
import { CloneReview } from "./clone-review";

export const dynamic = "force-dynamic";

export default async function TemplatePage({ params }: { params: Promise<{ provider: string; externalId: string }> }) {
  const identity = await params;
  const { botmancersUiBaseUrl } = readConfig();
  let inspection: Awaited<ReturnType<MarketService["inspect"]>>;
  const market = await marketService();
  try {
    inspection = await market.inspect(identity);
  } catch (error) {
    const code = error instanceof MarketError ? error.code : "inspector_unavailable";
    const message = error instanceof Error ? error.message : "Stored template detail is temporarily unavailable";
    return <><a className="back" href="/">← Complete catalog</a><section><p className="eyebrow">Recoverable inspector error</p><h1>Stored template detail unavailable</h1><div className="alert danger"><strong>{code}</strong>: {message}</div><p>No clone was created or activated. Reload this page to retry the catalog database.</p><a href={`/templates/${encodeURIComponent(identity.provider)}/${encodeURIComponent(identity.externalId)}`}>Retry inspector</a></section></>;
  }
  let manifest: Awaited<ReturnType<MarketService["manifest"]>> | undefined;
  let sourceError: { code: string; message: string } | undefined;
  try {
    manifest = await market.manifest(identity);
  } catch (error) {
    sourceError = { code: error instanceof MarketError ? error.code : "source_unavailable", message: error instanceof Error ? error.message : "Public source detail is unavailable" };
  }
  return <><a className="back" href="/">← Complete catalog</a><section className="inspector-head"><p className="eyebrow">{inspection.entry.featured ? "Featured · " : ""}{inspection.entry.provenance.source.provider}</p><h1>{inspection.entry.name}</h1><p>{inspection.entry.summary}</p><dl><dt>Creator</dt><dd>{inspection.entry.creator.name}</dd><dt>Creator permission</dt><dd>Unknown — not provided by the public source</dd><dt>Redistribution grant</dt><dd>Not provided; Clone Market offers private import only</dd></dl></section>
    {!inspection.entry.present && <div className="alert warning">Source drift: this template is no longer present in the latest index.</div>}
    <div className="inspector-grid"><section><h2>Currently public components</h2>{sourceError && <div className="alert danger"><strong>{sourceError.code}</strong>: {sourceError.message}. Stored history and evidence remain available; retry this page for live components.</div>}{manifest && <><p>Fetched on demand at {manifest.retrievedAt}. The full manifest is not stored in the catalog or browser persistence.</p><ul><li>Instructions: {manifest.instructions ? "available" : "unavailable"}</li><li>Memories: {manifest.memories.length}</li><li>Skills: {manifest.skills.length}</li><li>Routines: {manifest.routines.length}</li><li>Integrations: {manifest.integrations.map(({ name }) => name).join(", ") || "none"}</li>{manifest.unavailableFields.map((field) => <li key={field}>{field}: unavailable from source</li>)}</ul></>}</section><section><h2>Retrieval history</h2><ol>{inspection.history.map((item) => <li key={`${item.capturedAt}:${item.contentHash}`}>{item.change} · {item.capturedAt}</li>)}</ol></section></div>
    <div dangerouslySetInnerHTML={{ __html: renderEvidence(inspection.evidence) }} />{manifest ? <CloneReview {...identity} botmancersUiBaseUrl={botmancersUiBaseUrl} /> : <section className="clone-panel"><h2>Private clone</h2><div className="alert warning">Clone preview is unavailable until the current public manifest can be fetched. No clone has been created or activated.</div></section>}</>;
}
