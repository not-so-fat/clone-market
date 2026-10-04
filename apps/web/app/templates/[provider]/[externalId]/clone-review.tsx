"use client";
import { useState } from "react";

function requestError(reason: unknown): { code: string; message: string } {
  if (typeof reason === "object" && reason !== null) {
    const value = reason as { code?: unknown; message?: unknown };
    if (typeof value.code === "string" && typeof value.message === "string") return { code: value.code, message: value.message };
  }
  return { code: "request_failed", message: reason instanceof Error ? reason.message : "Request failed" };
}

export function CloneReview({ provider, externalId }: { provider: string; externalId: string }) {
  const [review, setReview] = useState<any>();
  const [result, setResult] = useState<any>();
  const [approved, setApproved] = useState(false);
  const [omissionsAcknowledged, setOmissionsAcknowledged] = useState(false);
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const [error, setError] = useState<{ code: string; message: string }>();
  const base = `/api/v1/templates/${encodeURIComponent(provider)}/${encodeURIComponent(externalId)}/clone`;
  const policy = { schemaVersion: "1.0.0", creatorPermission: permissionConfirmed ? "granted" : "unknown", redistribution: "private_only", destination: "private", instructionForm: "plain_text" } as const;
  async function call(path: string, body: unknown) {
    const response = await fetch(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw { code: value.error?.code ?? "request_failed", message: value.error?.message ?? "Request failed" };
    return value;
  }
  async function preview() {
    setError(undefined);
    try {
      setReview(await call("preview", { policy }));
      setResult(undefined);
      setApproved(false);
      setOmissionsAcknowledged(false);
    } catch (reason) {
      setError(requestError(reason));
    }
  }
  async function apply() {
    setError(undefined);
    const reviewedAt = review.plan.createdAt;
    try {
      const applied = await call("apply", { policy, planDigest: review.plan.id, reviewedAt, approved });
      setResult({ applied });
      const verification = await call("verify", { policy, planDigest: review.plan.id, reviewedAt, targetReference: applied.result.targetReference });
      setResult({ applied, verification });
    } catch (reason) {
      setError(requestError(reason));
    }
  }
  return <section className="clone-panel"><h2>Private clone</h2><p>A preview does not change Botmancers. Applying requires approval of the exact displayed digest.</p><label><input type="checkbox" checked={permissionConfirmed} onChange={(event) => { setPermissionConfirmed(event.target.checked); setReview(undefined); setApproved(false); setOmissionsAcknowledged(false); }} /> I confirm I have creator permission for this private import</label>{!review && <div><button onClick={preview}>Preview Botmancers clone</button></div>}{error && <div className="alert danger"><strong>{error.code}</strong>: {error.message} — refresh the preview and try again.</div>}{review && <>{review.compatibility.summary.unsafe > 0 && <div className="alert danger">Unsafe plan — apply is blocked.</div>}{review.compatibility.summary.partial > 0 && <div className="alert warning">Partial compatibility must be resolved outside Clone Market before apply.</div>}{review.compatibility.summary.unavailable > 0 && <div className="alert warning">Unavailable components will be omitted from the private clone.</div>}<div className="summary">{review.preview.summary}</div><p className="digest"><strong>Reviewed plan digest:</strong> <code>{review.plan.id}</code></p><table><thead><tr><th>Type</th><th>Component</th><th>Compatibility</th><th>Reason</th></tr></thead><tbody>{review.compatibility.assessments.map((row: any) => <tr key={`${row.componentType}:${row.componentId}`} className={row.classification}><td>{row.componentType}</td><td>{row.componentId}</td><td>{row.classification}</td><td>{row.rationaleCode}</td></tr>)}</tbody></table><h3>Required actions</h3><ul>{review.compatibility.requiredUserActions.length === 0 ? <li>None</li> : review.compatibility.requiredUserActions.map((action: any) => <li key={action.id}>{action.code}{action.subject ? `: ${action.subject}` : ""}</li>)}</ul><h3>Target payload</h3><pre>{review.preview.artifacts.find((artifact: any) => artifact.path.endsWith("import.json"))?.content}</pre><div className="decision"><h3>Your decision</h3>{review.compatibility.summary.unavailable > 0 && <label><input type="checkbox" checked={omissionsAcknowledged} onChange={(event) => setOmissionsAcknowledged(event.target.checked)} /> I understand unavailable components will not be imported</label>}<label><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /> I approve this exact plan digest</label><button disabled={!approved || !permissionConfirmed || review.compatibility.summary.unsafe > 0 || review.compatibility.summary.partial > 0 || (review.compatibility.summary.unavailable > 0 && !omissionsAcknowledged)} onClick={apply}>Apply private clone</button><button className="secondary" onClick={preview}>Refresh preview</button></div></>}{result?.applied && <div className="alert success">Applied as {result.applied.result.targetReference}</div>}{result?.verification && <section><h3>Verification: {result.verification.status}</h3><ul>{result.verification.checks.map((check: any) => <li key={check.name} className={check.passed ? "passed" : "failed"}><strong>{check.name}</strong>: {check.detail}</li>)}</ul></section>}</section>;
}
