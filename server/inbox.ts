// Your inbox (feature 6, 24 Oct 2026): what is waiting on YOU, across every
// workspace you may see, in one list — instead of a banner for gates, a page
// for issues, a card for proposals and a run list to scan for your failures.
//
// Derived, never stored: each item is read from where it lives (a gate from
// the run, an issue from the issues fold, a proposal from improve.ts) and
// leaves the inbox when it is done there — a gate decided, an issue
// resolved, a proposal applied. The only thing kept is what one person did
// to their own view: read, and set aside ("dismiss") — a notice of kind
// "inbox" per person. Setting an item aside never decides it: the gate still
// waits, the issue stays open for everyone else.
//
// Three buckets, never mixed (a Codex debate, 24 Oct 2026):
//   mine     — assigned to you: you are named in the flow's `approvers:`, or
//              you own the flow or agent (`owner:`, down the cascade), or you
//              asked for the proposal;
//   started  — runs you started: the ones that failed or ended BLOCKED or BAD
//              this week, a gate on one (which someone else must decide —
//              your own approval is refused), a question one asked;
//   team     — the rest of what waits in your workspaces, for whoever picks
//              it up.
//
// Identity: a person's email. A key acts for the person who minted it, inside
// the key's own workspace scope — never its minter's current one; a key with
// no person recorded has no inbox.
//
// An item's id names its occurrence, so a thing that happens again is new:
// an issue's id carries when it was last seen, a gate its step.

import { listFlows, listAgents, listAllRunSummaries, listWorkspaces, runVerdict, mayApprove, type FlowInfo } from "@/lib/store";
import { scopeAllows } from "@/platform/scope";
import { can, type Role } from "@/platform/permissions";
import { getNotice, updateNotice } from "@/platform/notices";
import { listProposals, settleProposal } from "@/platform/improve";
import { accountIssues, filterIssues } from "@/server/issues";
import { pendingForPeople } from "@/server/pending";
import { runHref } from "@/components/run-href";
import { anchorId } from "@/components/collapse-model";
import { listEvals } from "@/lib/evals";

export type InboxKind = "approval" | "question" | "issue" | "proposal" | "run";
export type InboxBucket = "mine" | "started" | "team";

export interface InboxItem {
  id: string;
  kind: InboxKind;
  bucket: InboxBucket;
  /** Why it is in that bucket, in a few words. */
  why: string;
  workspace: string;
  title: string;
  detail: string;
  /** When it started waiting, ISO. */
  at: string;
  /** Where to act on it, a dashboard path. */
  href: string;
  read: boolean;
  dismissed: boolean;
}

export interface InboxView {
  person: string;
  items: InboxItem[];
  /** Over every item that is not set aside: per bucket, and unread of
   *  mine + started (what the top bar's count shows). */
  counts: { mine: number; started: number; team: number; unread: number };
}

interface InboxState {
  read: string[];
  dismissed: string[];
}

/** How many ids of each a person's state keeps; the oldest go first. */
const KEEP_IDS = 1000;
/** Runs you started that went wrong, this far back. */
const RUN_WINDOW_MS = 7 * 86400_000;

/** The person a caller is, or null for a key nobody minted. */
export function personOf(actor: { kind: string; name: string }): string | null {
  const email = actor.name.trim().toLowerCase();
  return email.includes("@") ? email : null;
}

const same = (a: string | null | undefined, person: string) => !!a && a.trim().toLowerCase() === person;

export async function readInboxState(tenant: string, person: string): Promise<InboxState> {
  const n = await getNotice<InboxState>(tenant, "inbox", person).catch(() => null);
  return { read: n?.payload?.read ?? [], dismissed: n?.payload?.dismissed ?? [] };
}

export type InboxAction = "read" | "unread" | "dismiss" | "restore";
const ID = /^(gate|ask|issue|proposal|run):[\w./:@+-]{1,300}$/;
export const isInboxId = (id: string) => ID.test(id);

/** One person's marks on their own view. Never decides anything. */
export async function markInbox(tenant: string, person: string, ids: string[], action: InboxAction): Promise<InboxState> {
  const bad = ids.find((id) => !isInboxId(id));
  if (bad) throw Object.assign(new Error(`not an inbox item: ${bad}`), { status: 400 });
  return updateNotice<InboxState>(tenant, "inbox", person, (prev) => {
    const read = new Set(prev?.read ?? []);
    const dismissed = new Set(prev?.dismissed ?? []);
    for (const id of ids) {
      if (action === "read") read.add(id);
      if (action === "unread") read.delete(id);
      if (action === "dismiss") {
        dismissed.add(id);
        read.add(id);
      }
      if (action === "restore") dismissed.delete(id);
    }
    return { read: [...read].slice(-KEEP_IDS), dismissed: [...dismissed].slice(-KEEP_IDS) };
  });
}

/** Everything waiting, for one person, in the workspaces `scope` allows. */
export async function inboxFor(
  tenant: string,
  person: string,
  scope: string[] | null,
  opts: { role?: string | null; now?: number } = {},
): Promise<InboxView> {
  const now = opts.now ?? Date.now();
  const qs = tenant !== "default" ? `?tenant=${encodeURIComponent(tenant)}` : "";
  const workspaces = listWorkspaces(tenant).map((w) => w.name).filter((w) => scopeAllows(scope, w));
  const flows = new Map<string, Map<string, FlowInfo>>();
  const agentOwners = new Map<string, Map<string, string | null>>();
  for (const ws of workspaces) {
    try {
      flows.set(ws, new Map(listFlows(tenant, ws).map((f) => [f.name, f])));
    } catch {
      flows.set(ws, new Map());
    }
    try {
      agentOwners.set(ws, new Map(listAgents(tenant, ws).map((a) => [a.name, a.owner ?? null])));
    } catch {
      agentOwners.set(ws, new Map());
    }
  }
  const flowOf = (ws: string, name: string) => flows.get(ws)?.get(name.replace(/^(adhoc|eval):/, "")) ?? null;
  const ownsWhat = (ws: string, what: string) => {
    if (what.startsWith("adhoc:") || what.startsWith("agent: ")) return same(agentOwners.get(ws)?.get(what.replace(/^(adhoc:|agent: )/, "")), person);
    return same(flowOf(ws, what)?.owner, person);
  };
  const items: Omit<InboxItem, "read" | "dismissed">[] = [];
  const runs = new Map(listAllRunSummaries(tenant).filter((r) => scopeAllows(scope, r.workspace)).map((r) => [r.id, r]));

  // ---- gates and questions
  const { approvals, questions } = await pendingForPeople(tenant, scope);
  for (const g of approvals) {
    const flow = flowOf(g.workspace, g.flow);
    const run = runs.get(g.runId);
    const mineByList = !!flow?.approvers?.includes(person);
    const startedByMe = same(run?.startedBy, person);
    // Only someone who may decide it: the flow's approvers: allow it, and the
    // role may approve at all (a viewer may not, whatever approvers: says).
    // A gate on your own run stays, as news, under Started by me.
    const canDecide = (!opts.role || can(opts.role as Role, "run:start")) && mayApprove(flow, { email: person, role: opts.role ?? null });
    if (!startedByMe && !canDecide) continue;
    const bucket: InboxBucket = startedByMe ? "started" : mineByList || same(flow?.owner, person) ? "mine" : "team";
    items.push({
      id: `gate:${g.workspace}/${g.runId}/${g.step}`,
      kind: "approval",
      bucket,
      why: startedByMe ? "your run — someone else decides its gate" : mineByList ? "you are an approver" : bucket === "mine" ? "you own the flow" : "waiting on anyone who may approve",
      workspace: g.workspace,
      title: `${g.flow} — ${g.agent} waits for approval`,
      detail: g.question.split("\n")[0].slice(0, 240),
      at: g.waitingSince,
      href: runHref(g.workspace, g.runId, tenant),
    });
  }
  for (const q of questions) {
    const run = runs.get(q.runId);
    const startedByMe = same(run?.startedBy, person);
    const bucket: InboxBucket = startedByMe ? "started" : ownsWhat(q.workspace, q.flow) ? "mine" : "team";
    items.push({
      id: `ask:${q.id}`,
      kind: "question",
      bucket,
      why: startedByMe ? "your run asked" : bucket === "mine" ? "you own the flow" : "an agent is asking",
      workspace: q.workspace,
      title: `${q.flow} — ${q.agent} asks a question`,
      detail: q.question.split("\n")[0].slice(0, 240),
      at: q.askedAt,
      href: runHref(q.workspace, q.runId, tenant),
    });
  }

  // ---- issues still asking for someone (open or acknowledged)
  let issues: Awaited<ReturnType<typeof accountIssues>> = [];
  try {
    issues = filterIssues(await accountIssues(tenant, scope, now, undefined, workspaces), "active");
  } catch {
    /* a fold that cannot be read lists no issues here */
  }
  for (const i of issues) {
    const mine = ownsWhat(i.workspace, i.what);
    items.push({
      id: `issue:${i.id}:${i.lastSeen}`,
      kind: "issue",
      bucket: mine ? "mine" : "team",
      why: mine ? "you own the flow" : "open in your workspaces",
      workspace: i.workspace,
      title: `${i.what} — ${i.kind === "platform" ? "a platform problem" : i.kind}${i.count > 1 ? ` ×${i.count}` : ""}`,
      detail: i.reason.split("\n")[0].slice(0, 240),
      at: i.lastSeen,
      href: `/dashboard/issues?workspace=${encodeURIComponent(i.workspace)}${tenant !== "default" ? `&tenant=${encodeURIComponent(tenant)}` : ""}`,
    });
  }

  // ---- proposals ready for review
  for (const ws of workspaces) {
    let ps: Awaited<ReturnType<typeof listProposals>> = [];
    try {
      ps = await Promise.all((await listProposals(tenant, ws)).map((p) => settleProposal(tenant, p).catch(() => p)));
    } catch {
      continue;
    }
    for (const p of ps.filter((x) => x.status === "ready")) {
      const askedByMe = same(p.by, person);
      const target = listEvalTarget(tenant, ws, p.eval);
      const owns = target ? ownsWhat(ws, target) : false;
      items.push({
        id: `proposal:${ws}/${p.id}`,
        kind: "proposal",
        bucket: askedByMe || owns ? "mine" : "team",
        why: askedByMe ? "you asked for it" : owns ? "you own what it changes" : "a fix to review",
        workspace: ws,
        title: `${p.eval} — a proposed fix`,
        detail: `${p.files.map((f) => f.path).join(", ")} · covers ${p.failures.length} failure${p.failures.length === 1 ? "" : "s"}`,
        at: p.updatedAt,
        // The eval card's own anchor: a collapsed card opens for it, and the
        // proposal is inside it.
        href: `/dashboard/${encodeURIComponent(ws)}/evals${qs}#${anchorId("eval", p.eval)}`,
      });
    }
  }

  // ---- runs you started that went wrong this week
  for (const r of runs.values()) {
    if (!same(r.startedBy, person) || !r.finishedAt || now - Date.parse(r.finishedAt) > RUN_WINDOW_MS) continue;
    if (r.flow.startsWith("eval:") || r.stopRequested) continue;
    const verdict = r.status === "completed" ? runVerdict(r) : null;
    const wrong = r.status === "failed" ? "failed" : verdict === "BLOCKED" || verdict === "BAD" ? verdict : null;
    if (!wrong) continue;
    items.push({
      id: `run:${r.workspace}/${r.id}`,
      kind: "run",
      bucket: "started",
      why: "you started it",
      workspace: r.workspace,
      title: `${r.flow.replace(/^adhoc:/, "agent: ")} — ${wrong === "failed" ? "failed" : `ended ${wrong}`}`,
      detail: (r.summary ?? r.steps.find((s) => s.error)?.error ?? "").split("\n")[0].slice(0, 240),
      at: r.finishedAt,
      href: runHref(r.workspace, r.id, tenant),
    });
  }

  const state = await readInboxState(tenant, person);
  const read = new Set(state.read);
  const dismissed = new Set(state.dismissed);
  const all: InboxItem[] = items
    .map((i) => ({ ...i, read: read.has(i.id), dismissed: dismissed.has(i.id) }))
    .sort((a, b) => b.at.localeCompare(a.at));
  const live = all.filter((i) => !i.dismissed);
  return {
    person,
    items: all,
    counts: {
      mine: live.filter((i) => i.bucket === "mine").length,
      started: live.filter((i) => i.bucket === "started").length,
      team: live.filter((i) => i.bucket === "team").length,
      unread: live.filter((i) => i.bucket !== "team" && !i.read).length,
    },
  };
}

/** What an eval points at, as the inbox names it: `adhoc:<agent>` or the flow. */
function listEvalTarget(tenant: string, ws: string, evalName: string): string | null {
  try {
    const e = listEvals(tenant, ws).find((x) => x.name === evalName);
    return e ? (e.flow ?? (e.agent ? `adhoc:${e.agent}` : null)) : null;
  } catch {
    return null;
  }
}
