"use client";
import { useState } from "react";

export function CloneReview({ provider, externalId }: { provider: string; externalId: string }) {
  const [review, setReview] = useState<any>();
  const [result, setResult] = useState<any>();
  const [approved, setApproved] = useState(false);
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const [error, setError] = useState<string>();
  const base = `/api/v1/templates/${encodeURIComponent(provider)}/${encodeURIComponent(externalId)}/clone`;
  const policy = { schemaVersion: "1.0.0", creatorPermission: permissionConfirmed ? "granted" : "unknown", redistribution: "private_only", destination: "private", instructionForm: "plain_text" } as const;
  async function call(path: string, body: unknown) {
    const response = await fetch(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error?.message ?? "Request failed");
    return value;
  }
  async function preview() { setError(undefined); try { setReview(await call("preview", { policy })); setResult(undefined); } catch (reason) { setError(String(reason)); } }
  async function apply() { setError(undefined); try { const applied = await call("apply", { policy, planDigest: review.plan.id, approved }); setResult({ applied }); const verification = await call("verify", { policy, planDigest: review.plan.id, targetReference: applied.result.targetReference }); setResult({ applied, verification }); } catch (reason) { setError(String(reason)); } }
  return <section className="clone-panel"><h2>Private clone</h2><p>A preview does not change Botmancers. Applying requires approval of the exact displayed digest.</p><label><input type="checkbox" checked={permissionConfirmed} onChange={(event) => { setPermissionConfirmed(event.target.checked); setReview(undefined); setApproved(false); }} /> I confirm I have creator permission for this private import</label>{!review && <div><button onClick={preview}>Preview Botmancers clone</button></div>}{error && <div className="alert danger">{error} — refresh the preview and try again.</div>}{review && <><div className="summary">{review.preview.summary}</div><table><thead><tr><th>Type</th><th>Component</th><th>Compatibility</th></tr></thead><tbody>{review.compatibility.assessments.map((row: any) => <tr key={`${row.componentType}:${row.componentId}`} className={row.classification}><td>{row.componentType}</td><td>{row.componentId}</td><td>{row.classification}</td></tr>)}</tbody></table><h3>Required actions</h3><ul>{review.compatibility.requiredUserActions.map((action: any) => <li key={action.id}>{action.code}</li>)}</ul><h3>Target payload</h3><pre>{review.preview.artifacts.find((artifact: any) => artifact.path.endsWith("import.json"))?.content}</pre><div className="decision"><label><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /> I approve this exact plan</label><button disabled={!approved || !permissionConfirmed || review.compatibility.summary.unsafe > 0 || review.compatibility.summary.partial > 0 || review.compatibility.requiredUserActions.length > 0} onClick={apply}>Apply private clone</button><button className="secondary" onClick={preview}>Refresh preview</button></div></>}{result?.applied && <div className="alert success">Applied as {result.applied.result.targetReference}</div>}{result?.verification && <section><h3>Verification: {result.verification.status}</h3><ul>{result.verification.checks.map((check: any) => <li key={check.name} className={check.passed ? "passed" : "failed"}>{check.detail}</li>)}</ul></section>}</section>;
}
