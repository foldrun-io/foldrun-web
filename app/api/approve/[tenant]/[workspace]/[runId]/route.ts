// Approve where the notification lands.
//
// A run parked at a gate emails a link here. GET shows what is waiting and
// two buttons; POST decides. The split is not ceremony: inbox link-checkers
// and mail clients prefetch GETs, and a link that approved on GET would have
// runs approved by a spam filter. Nothing here mutates until a person pushes
// a button.
//
// Authentication is the token in the URL — no session, no API key. What
// the token may decide is core's rule (approvals.ts): the one step it was
// minted for, before it expires, once, and — where the flow names its
// approvers — only as the approver it was mailed to. Whoever holds the
// link decides that much, which is the property an emailed link is
// supposed to have; a forwarded link used to decide every later gate of
// the run, for as long as the run lived, past any approvers: list.

import { NextRequest, NextResponse } from "next/server";
import { readFileBytes } from "@/lib/storage";
import { readRun, type RunRecord } from "@/lib/store";
import { checkApproveLink, decideApproval, readApproveLink } from "@/lib/approvals";
import { errorResponse, reportError, refuse } from "@/server/api";

type Params = { params: Promise<{ tenant: string; workspace: string; runId: string }> };

const presentedToken = (req: NextRequest) => req.nextUrl.searchParams.get("token") ?? "";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Self-contained on purpose: the page is opened from a phone, off a mail
// client, possibly from a network that cannot reach anything but this one
// route. No stylesheet, no script, no font to fetch.
function page(title: string, inner: string, status = 200) {
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex">` +
    `<title>${esc(title)}</title>` +
    `<style>` +
    `body{font:16px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:24px;background:#f6f6f4;color:#1a1a1a}` +
    `main{max-width:36rem;margin:0 auto;background:#fff;border:1px solid #e2e2df;border-radius:8px;padding:24px}` +
    `h1{font-size:1.25rem;margin:0 0 4px}.muted{color:#666;font-size:.9rem}` +
    `dl{margin:16px 0;display:grid;grid-template-columns:max-content 1fr;gap:4px 12px}dt{color:#666}dd{margin:0}` +
    `ul{padding-left:20px}li{margin:6px 0}q{font-style:italic}` +
    `h2{font-size:.9rem;color:#666;margin:18px 0 4px;font-weight:600}pre{white-space:pre-wrap;word-break:break-word;font:13px/1.45 ui-monospace,Menlo,monospace;background:#f6f6f4;border:1px solid #e2e2df;border-radius:6px;padding:10px;margin:0 0 6px}` +
    `textarea{width:100%;box-sizing:border-box;min-height:5rem;font:inherit;padding:8px;border:1px solid #ccc;border-radius:6px;margin:6px 0 14px}` +
    `.row{display:flex;gap:12px}button{font:inherit;padding:10px 18px;border-radius:6px;border:1px solid #999;background:#fff;cursor:pointer}` +
    `button.approve{background:#1f7a3a;border-color:#1f7a3a;color:#fff}button.reject{background:#fff;border-color:#b3261e;color:#b3261e}` +
    `button.preselected{outline:3px solid #ffd54f}` +
    `</style></head><body><main>${inner}</main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    },
  });
}

function nothingWaiting(run: RunRecord, workspace: string) {
  return page(
    `${run.flow} — nothing to decide`,
    `<h1>Nothing is waiting on you</h1>` +
      `<p class="muted">${esc(workspace)} / ${esc(run.id)}</p>` +
      `<p><strong>${esc(run.flow)}</strong> is <strong>${esc(run.status)}</strong>. ` +
      `Either this was already decided, or the run moved on. Nothing was changed.</p>`,
  );
}

/**
 * A link that cannot decide, said in a sentence: expired, already used,
 * or a flow that names its approvers when the link names nobody. The
 * person holding it did nothing wrong, and "401" would send them to the
 * wrong place.
 */
function cannotDecide(run: RunRecord | null, workspace: string, runId: string, status: number, message: string) {
  const title =
    status === 410 ? "This link has expired" : status === 409 ? "This link was already used" : status === 403 ? "This link cannot decide this gate" : "Could not decide";
  return page(
    `${run?.flow ?? runId} — ${title.toLowerCase()}`,
    `<h1>${esc(title)}</h1>` +
      `<p class="muted">${esc(workspace)} / ${esc(runId)}</p>` +
      `<p>${esc(message)}</p>` +
      (run ? `<p>Nothing was changed. <strong>${esc(run.flow)}</strong> is <strong>${esc(run.status)}</strong>.</p>` : ""),
    status,
  );
}

export async function GET(req: NextRequest, ctx: Params) {
  const { tenant, workspace, runId } = await ctx.params;
  const presented = presentedToken(req);
  // The token before the run: a bad token learns nothing about which runs
  // exist. An expired one is told so — it was a real link once.
  const read = readApproveLink(tenant, workspace, runId, presented);
  if ("error" in read) {
    if (read.status === 401) return refuse("invalid token", 401);
    return cannotDecide(readRun(tenant, workspace, runId), workspace, runId, read.status, read.error);
  }
  const run = readRun(tenant, workspace, runId);
  if (!run) return page("run not found", `<h1>Run not found</h1><p class="muted">${esc(runId)}</p>`, 404);

  const check = checkApproveLink(tenant, workspace, run, presented);
  if (!check.ok) {
    if (check.status === 409 && !/already used/.test(check.message)) return nothingWaiting(run, workspace);
    return cannotDecide(run, workspace, runId, check.status, check.message);
  }
  const waiting = check.steps.map((i) => run.steps[i]);
  if (waiting.length === 0) return nothingWaiting(run, workspace);

  // ?decision=reject from the reject link only pre-selects; the button is
  // still the act. Nobody has rejected anything by opening the page.
  const preselect = req.nextUrl.searchParams.get("decision") === "reject" ? "reject" : "approve";
  const action = `${req.nextUrl.pathname}?token=${encodeURIComponent(presented)}`;

  const steps = waiting
    .map(
      (s) =>
        `<li><strong>${esc(s.agent)}</strong>` +
        (s.ask ? ` asks: <q>${esc(s.ask)}</q>` : " is waiting for approval before running") +
        `</li>`,
    )
    .join("");

  // What is being approved, on the page that approves it. The gate's
  // `preview:` files are the proposal — a table of rows, a draft — and
  // without them here the email's button was a decision made blind, or a
  // trip to the dashboard the email was meant to save. Text renders as
  // text; an image is named, since nothing but this route is reachable
  // from where the page is opened. Capped, so a long brief still loads on
  // a phone.
  const previews: string[] = [];
  for (const s of waiting) {
    for (const rel of s.previewFiles ?? []) {
      if (previews.length >= 6) break;
      if (!/\.(?:mdx?|txt|csv|json|tsv)$/i.test(rel)) {
        previews.push(`<p class="muted">${esc(rel)} — open the dashboard to see this file</p>`);
        continue;
      }
      const bytes = await readFileBytes(tenant, workspace, rel).catch(() => null);
      if (!bytes) continue;
      const text = bytes.toString("utf8");
      const shown = text.length > 12_000 ? `${text.slice(0, 12_000)}\n… (${text.length - 12_000} more characters in the dashboard)` : text;
      previews.push(`<h2>${esc(rel)}</h2><pre>${esc(shown)}</pre>`);
    }
  }

  return page(
    `${run.flow} — waiting for you`,
    `<h1>${esc(run.flow)} is waiting for you</h1>` +
      `<p class="muted">${esc(workspace)} / ${esc(run.id)}</p>` +
      // The gate still asks — a test should exercise it — but the answer
      // decides nothing real, and the person deciding must know that.
      (run.test
        ? `<p><strong>This is a test run.</strong> Approving lets the step run; nothing it sends will go out and nothing it writes to state/ will be kept.</p>`
        : "") +
      `<ul>${steps}</ul>` +
      // Whose decision this will be recorded as, when the link was mailed
      // to a named approver — the one case a link carries an identity.
      (check.approver ? `<p class="muted">This link was sent to <strong>${esc(check.approver)}</strong>; the decision is recorded as theirs.</p>` : "") +
      (check.link.kind === "step" ? `<p class="muted">This link works until ${esc(new Date(check.link.expiresAt).toUTCString())}, for this gate only, once.</p>` : "") +
      previews.join("") +
      `<form method="POST" action="${esc(action)}">` +
      `<label for="note">${waiting.some((s) => s.ask) ? "Your answer" : "A note for the agent"} (optional)</label>` +
      `<textarea id="note" name="note" maxlength="4000"></textarea>` +
      `<div class="row">` +
      `<button type="submit" name="decision" value="approve" class="approve${preselect === "approve" ? " preselected" : ""}"${preselect === "approve" ? " autofocus" : ""}>Approve</button>` +
      `<button type="submit" name="decision" value="reject" class="reject${preselect === "reject" ? " preselected" : ""}"${preselect === "reject" ? " autofocus" : ""}>Reject</button>` +
      `</div></form>`,
  );
}

export async function POST(req: NextRequest, ctx: Params) {
  const { tenant, workspace, runId } = await ctx.params;
  const presented = presentedToken(req);
  const read = readApproveLink(tenant, workspace, runId, presented);
  if ("error" in read) {
    if (read.status === 401) return refuse("invalid token", 401);
    return cannotDecide(readRun(tenant, workspace, runId), workspace, runId, read.status, read.error);
  }
  const approver = read.link.kind === "step" ? read.link.approver : null;

  // A browser form or a curl with JSON: same fields either way.
  const contentType = req.headers.get("content-type") ?? "";
  let fields: { decision?: unknown; note?: unknown } = {};
  if (contentType.includes("application/json")) {
    fields = (await req.json().catch(() => ({}))) as typeof fields;
  } else {
    const form = await req.formData().catch(() => null);
    if (form) fields = { decision: form.get("decision"), note: form.get("note") };
  }
  const decision = fields.decision === "reject" ? "reject" : "approve";
  const note = typeof fields.note === "string" ? fields.note : undefined;

  // JSON when the caller asked for it or spoke it; the form-posting browser
  // gets a page it can read.
  const accept = req.headers.get("accept") ?? "";
  const wantsJson =
    contentType.includes("application/json") ||
    (accept.includes("application/json") && !accept.includes("text/html"));

  try {
    // Core reads the link again and enforces what it may decide — the
    // step, the expiry, single use, approvers: — and decides as the named
    // approver when there is one. This route only says which door.
    const { run, steps } = await decideApproval(tenant, workspace, runId, {
      decision,
      note,
      by: approver ? `via emailed link (${approver})` : "via emailed link",
      link: presented,
    });
    if (wantsJson) return NextResponse.json({ ok: true, decision, steps });
    return page(
      `${run.flow} — ${decision === "approve" ? "approved" : "rejected"}`,
      `<h1>${decision === "approve" ? "Approved" : "Rejected"}</h1>` +
        `<p class="muted">${esc(workspace)} / ${esc(run.id)}</p>` +
        `<p><strong>${esc(run.flow)}</strong> ${
          decision === "approve" ? "will continue from where it stopped." : "will not continue."
        }${note?.trim() ? " Your note was passed along." : ""}</p>`,
    );
  } catch (err) {
    if (wantsJson) return errorResponse(err);
    // A server fault reads as one generic sentence, never its own detail.
    const { status, message } = reportError(err);
    // A second click on a link already used is the common case here, and it
    // deserves a sentence, not an error code.
    const run = readRun(tenant, workspace, runId);
    if (run && status === 409 && !/already used/.test(message)) return nothingWaiting(run, workspace);
    return cannotDecide(run, workspace, runId, status, message);
  }
}
