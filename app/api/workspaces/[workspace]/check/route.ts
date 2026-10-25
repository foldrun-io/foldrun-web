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
import fs from "node:fs";
import { requireTenant, errorResponse } from "@/server/api";
import { workspaceDir } from "@/lib/store";
import { CHECK_RULES, SCAN_RULES, scanRule } from "@/lib/scan";
import { workspaceCheck } from "@/server/checks";
import { checkTree } from "@/lib/workspace-check";
import { onlineFindings, ONLINE_MAX_BYTES } from "@/lib/online-checks";
import { platform } from "@/lib/platform";
import { lastRescan } from "@/platform/rescan";

const SECURITY = new Set(["secret", "security", "content", "supply-chain"]);

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = await requireTenant(req);
    const dir = workspaceDir(tenant, workspace);
    if (!fs.existsSync(dir)) return NextResponse.json({ error: `no workspace "${workspace}"` }, { status: 404 });

    let findings = workspaceCheck(tenant, workspace);
    const q = req.nextUrl.searchParams;
    // FOL-58: ?online=1 adds the checks that need the network — known
    // vulnerabilities for exact runtime pins (OSV) and remote MCP servers'
    // tool text — and says what could not be checked.
    const wantOnline = q.get("online") === "1" || q.get("online") === "true";
    let online: { problems: string[]; sources: { source: string; checked: boolean; problem?: string }[] } | null = null;
    if (wantOnline) {
      const fetchGuarded = (u: string, i?: RequestInit) => platform.fetchUntrusted(u, i, { maxBytes: ONLINE_MAX_BYTES });
      const r = await onlineFindings(checkTree(dir), { fetch: fetchGuarded, osvFetch: fetchGuarded });
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
