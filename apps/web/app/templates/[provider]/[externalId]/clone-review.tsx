"use client";
import { useState } from "react";
import type { ApplyResult, VerifyResult } from "@clone-market/core";
import type { ReviewResponse } from "../../../../src/market";

type SuccessfulApply = Extract<ApplyResult, { status: "succeeded" }>;
type ApplyResponse = {
  result: SuccessfulApply;
  planDigest: string;
  verification?: VerifyResult;
  verificationError?: { code: string; message: string; recoverable: true };
};

function requestError(reason: unknown): { code: string; message: string } {
  if (typeof reason === "object" && reason !== null) {
    const value = reason as { code?: unknown; message?: unknown };
    if (typeof value.code === "string" && typeof value.message === "string") return { code: value.code, message: value.message };
  }
  return { code: "request_failed", message: reason instanceof Error ? reason.message : "Request failed" };
}

function botmancersBotUrl(uiBaseUrl: string, botId: string): string {
  const base = uiBaseUrl.endsWith("/") ? uiBaseUrl : `${uiBaseUrl}/`;
  return new URL(`bots/${encodeURIComponent(botId)}`, base).toString();
}

export function CloneReview({ provider, externalId, botmancersUiBaseUrl }: { provider: string; externalId: string; botmancersUiBaseUrl: string }) {
  const [review, setReview] = useState<ReviewResponse>();
  const [result, setResult] = useState<ApplyResponse>();
  const [approved, setApproved] = useState(false);
  const [omissionsAcknowledged, setOmissionsAcknowledged] = useState(false);
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const [error, setError] = useState<{ code: string; message: string }>();
  const base = `/api/v1/templates/${encodeURIComponent(provider)}/${encodeURIComponent(externalId)}/clone`;
  const policy = { schemaVersion: "1.0.0", creatorPermission: permissionConfirmed ? "granted" : "unknown", redistribution: "private_only", destination: "private", instructionForm: "plain_text" } as const;
  async function call<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw { code: value.error?.code ?? "request_failed", message: value.error?.message ?? "Request failed" };
    return value as T;
  }
  async function preview() {
    setError(undefined);
    try {
      setReview(await call<ReviewResponse>("preview", { policy }));
      setResult(undefined);
      setApproved(false);
      setOmissionsAcknowledged(false);
    } catch (reason) {
      setError(requestError(reason));
    }
  }
  async function apply() {
    if (!review) return;
    setError(undefined);
    const reviewedAt = review.plan.createdAt;
    try {
      setResult(await call<ApplyResponse>("apply", { policy, planDigest: review.plan.id, reviewedAt, approved }));
    } catch (reason) {
      setError(requestError(reason));
    }
  }
  return <section className="clone-panel"><h2>Private clone</h2><p>A preview does not change Botmancers. Applying requires approval of the exact displayed digest.</p><label><input type="checkbox" checked={permissionConfirmed} disabled={result !== undefined} onChange={(event) => { setPermissionConfirmed(event.target.checked); setReview(undefined); setResult(undefined); setApproved(false); setOmissionsAcknowledged(false); }} /> I confirm I have creator permission for this private import</label>{!review && <div><button onClick={preview}>Preview Botmancers clone</button></div>}{error && <div className="alert danger"><strong>{error.code}</strong>: {error.message} — refresh the preview and try again.</div>}{review && <>{review.compatibility.summary.unsafe > 0 && <div className="alert danger">Unsafe plan — apply is blocked.</div>}{review.compatibility.summary.partial > 0 && <div className="alert warning">Partial compatibility must be resolved outside Clone Market before apply.</div>}{review.compatibility.summary.unavailable > 0 && <div className="alert warning">Unavailable components will be omitted from the private clone.</div>}<div className="summary">{review.preview.summary}</div><p className="digest"><strong>Reviewed plan digest:</strong> <code>{review.plan.id}</code></p><table><thead><tr><th>Type</th><th>Component</th><th>Compatibility</th><th>Reason</th></tr></thead><tbody>{review.compatibility.assessments.map((row) => <tr key={`${row.componentType}:${row.componentId}`} className={row.classification}><td>{row.componentType}</td><td>{row.componentId}</td><td>{row.classification}</td><td>{row.rationaleCode}</td></tr>)}</tbody></table><h3>Required actions</h3><ul>{review.compatibility.requiredUserActions.length === 0 ? <li>None</li> : review.compatibility.requiredUserActions.map((action) => <li key={action.id}>{action.code}{action.subject ? `: ${action.subject}` : ""}</li>)}</ul><h3>Target payload</h3><pre>{review.preview.artifacts.find((artifact) => artifact.path.endsWith("import.json"))?.content}</pre><div className="decision"><h3>Your decision</h3>{review.compatibility.summary.unavailable > 0 && <label><input type="checkbox" checked={omissionsAcknowledged} disabled={result !== undefined} onChange={(event) => setOmissionsAcknowledged(event.target.checked)} /> I understand unavailable components will not be imported</label>}<label><input type="checkbox" checked={approved} disabled={result !== undefined} onChange={(event) => setApproved(event.target.checked)} /> I approve this exact plan digest</label><button disabled={result !== undefined || !approved || !permissionConfirmed || review.compatibility.summary.unsafe > 0 || review.compatibility.summary.partial > 0 || (review.compatibility.summary.unavailable > 0 && !omissionsAcknowledged)} onClick={apply}>{result ? "Clone applied" : "Apply private clone"}</button>{!result && <button className="secondary" onClick={preview}>Refresh preview</button>}</div></>}{result && <div className="alert success">Applied as {result.result.targetReference}. This clone will not be applied again from this review. <a href={botmancersBotUrl(botmancersUiBaseUrl, result.result.targetReference)}>Open imported bot in Botmancers</a></div>}{result?.verificationError && <div className="alert warning"><strong>Verification unavailable:</strong> {result.verificationError.message}. The clone was already created; do not apply again.</div>}{result?.verification && <section><h3>Verification: {result.verification.status}</h3><ul>{result.verification.checks.map((check) => <li key={check.name} className={check.passed ? "passed" : "failed"}><strong>{check.name}</strong>: {check.detail}</li>)}</ul></section>}</section>;
}
