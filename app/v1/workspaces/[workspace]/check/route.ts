// What `foldrun check` would say about the DEPLOYED copy of a workspace, as
// findings with rule ids: what a deploy refuses, what it warns about, and
// the scanner — hard-coded secrets, hidden text, an agent that reads the web,
// holds a secret and can send it, unpinned code.
//
// Read-only, and offline unless asked: no model is called and nothing is
// written. The Checks page reads it; a CI job can too. `?security=1` keeps
// only the security categories, `?rule=` (repeatable or comma-separated) one
// rule or category, `?online=1` adds the network checks (FOL-58).

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs";
import { requireTenant, requirePermission, errorResponse, refuse } from "@/server/api";
import { refuseWhenLimited } from "@/server/limits";
import { workspaceDir } from "@/lib/store";
import { CHECK_RULES, SCAN_RULES, scanRule } from "@/lib/scan";
import { workspaceCheck } from "@/server/checks";
import { checkTree } from "@/lib/workspace-check";
import { onlineFindings, ONLINE_MAX_BYTES } from "@/lib/online-checks";
import { platform } from "@/lib/platform";
import { lastRescan } from "@/platform/rescan";

const SECURITY = new Set(["secret", "security", "content", "supply-chain"]);

type OnlineResult = Awaited<ReturnType<typeof onlineFindings>>;

/**
 * ?online=1 sends the server out to OSV and to every remote MCP server the
 * workspace names. Since 30 Oct 2026 that is an editor's ask (workspace:write,
 * the role that can change what is checked), its answer is kept per workspace
 * for ONLINE_TTL_MS while the files are the same, and fresh online passes are
 * limited per workspace. Any viewer could loop it before and make the server
 * fetch third-party URLs on every request.
 */
const ONLINE_TTL_MS = 10 * 60_000;
const ONLINE_FRESH = { limit: 6, windowSec: 10 * 60 } as const;
const onlineKept = new Map<string, { at: number; files: string; result: OnlineResult }>();

/** The files the online checks read, as one digest: a redeploy is a fresh pass. */
function filesDigest(tree: { path: string; content: string }[]): string {
  const h = crypto.createHash("sha256");
  for (const f of [...tree].sort((a, b) => a.path.localeCompare(b.path))) h.update(f.path).update("\0").update(f.content).update("\0");
  return h.digest("hex");
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const q = req.nextUrl.searchParams;
    const wantOnline = q.get("online") === "1" || q.get("online") === "true";
    const tenant = wantOnline ? (await requirePermission(req, "workspace:write")).tenant : await requireTenant(req);
    const dir = workspaceDir(tenant, workspace);
    if (!fs.existsSync(dir)) return refuse(`no workspace "${workspace}"`, 404);

    let findings = workspaceCheck(tenant, workspace);
    // FOL-58: ?online=1 adds the checks that need the network — known
    // vulnerabilities for exact runtime pins (OSV) and remote MCP servers'
    // tool text — and says what could not be checked.
    let online: { problems: string[]; sources: { source: string; checked: boolean; problem?: string }[] } | null = null;
    if (wantOnline) {
      const tree = checkTree(dir);
      const files = filesDigest(tree);
      const key = `${tenant}\0${workspace}`;
      const kept = onlineKept.get(key);
      let r: OnlineResult;
      if (kept && kept.files === files && Date.now() - kept.at < ONLINE_TTL_MS) {
        r = kept.result;
      } else {
        const limited = await refuseWhenLimited(`check-online:${tenant}/${workspace}`, ONLINE_FRESH.limit, ONLINE_FRESH.windowSec);
        if (limited) return limited;
        const fetchGuarded = (u: string, i?: RequestInit) => platform.fetchUntrusted(u, i, { maxBytes: ONLINE_MAX_BYTES });
        r = await onlineFindings(tree, { fetch: fetchGuarded, osvFetch: fetchGuarded });
        onlineKept.set(key, { at: Date.now(), files, result: r });
        if (onlineKept.size > 1000) onlineKept.delete(onlineKept.keys().next().value as string);
      }
      findings = [...findings, ...r.findings];
      online = { problems: r.problems, sources: r.sources };
    }
    const rescan = await lastRescan(tenant, workspace).catch(() => null);
    const security = q.get("security") === "1" || q.get("security") === "true";
    const rules = q.getAll("rule").flatMap((r) => r.split(",")).map((r) => r.trim()).filter(Boolean);
    const category = (id: string) => scanRule(id)?.category ?? "config";
    if (security) findings = findings.filter((f) => SECURITY.has(category(f.rule)));
    if (rules.length) {
      const want = new Set(rules);
      findings = findings.filter((f) => want.has(f.rule) || want.has(category(f.rule)) || want.has(f.rule.split("/")[0]!));
    }

    const counts = { error: 0, warn: 0, info: 0 };
    for (const f of findings) counts[f.level]++;
    const used = new Set(findings.map((f) => f.rule));
    return NextResponse.json({
      workspace,
      counts,
      findings,
      // Each rule a finding names, with why it matters — what the page shows
      // beside it, so a person does not need the docs open to act on one.
      rules: [...SCAN_RULES, ...CHECK_RULES].filter((r) => used.has(r.id)),
      ...(online ? { online } : {}),
      // The daily rescan's last pass: when, what it could not check, what is
      // still waiting to be told.
      rescan: rescan ? { checkedAt: new Date(rescan.checkedAt).toISOString(), findings: rescan.findings.length, pending: rescan.pending.length, problems: rescan.problems } : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
