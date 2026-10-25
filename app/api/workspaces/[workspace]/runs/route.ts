import { NextRequest, NextResponse } from "next/server";
import { requireTenant, errorResponse, ApiError } from "@/server/api";
import { parseRunFilter, matchesRunFilter, isEmptyFilter } from "@/lib/runs-filter";
import { listRunSummaries, runTokens, runDisplayStatus, runVerdict, runFailure, runFromSummary } from "@/lib/store";
import { outcomeOf } from "@/lib/outcome";
import { intParam } from "@/server/query";
import { runCharges } from "@/server/run-charges";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workspace: string }> },
) {
  try {
    const { workspace } = await ctx.params;
    const tenant = await requireTenant(req);
    // 1..500, 50 unasked: `abc` used to return nothing and `-5` the oldest five.
    const limit = intParam(req.nextUrl.searchParams.get("limit"), 50, 1, 500);
    // FOL-72 step 9: tool, tool_error, agent, model, min_tokens, min_secs —
    // read off the index too. The limit counts runs that match.
    const { filter, problems } = parseRunFilter(req.nextUrl.searchParams);
    if (problems.length) throw new ApiError(problems.join("; "), 400);
    // The index, not the records: a list never parses every run.
    const all = listRunSummaries(tenant, workspace);
    const runs = (isEmptyFilter(filter) ? all : all.filter((r) => matchesRunFilter(r, filter))).slice(0, limit);
    const charges = await runCharges(tenant);
    // List view stays light: step results/events are on GET /runs/<id>.
    return NextResponse.json({
      runs: runs.map((r) => ({
        id: r.id,
        flow: r.flow,
        status: r.status,
        // One line, and the reason the list is worth reading: a status says
        // a run finished, this says what it found. Cheap enough for the
        // light projection — it is a sentence, not a step result.
        summary: r.summary ?? null,
        // Which step failed and why — what a search for an error's words
        // matches on the runs page, now for the CLI too (Codex review).
        failure: runFailure(runFromSummary(r)),
        // FOL-54: the run in the words every surface uses — the verdict its
        // summary leads with, and the one outcome (core outcome.ts), so a
        // caller never re-parses a summary or re-derives what a page shows.
        verdict: runVerdict(r),
        outcome: outcomeOf(runDisplayStatus(r), runVerdict(r)),
        startedAt: r.startedAt,
        finishedAt: r.finishedAt ?? null,
        // The run's own total, so "what does this desk cost" is one read
        // rather than a sum the caller has to remember to do. The steps keep
        // their own figures for the breakdown.
        costUsd: r.steps.reduce((sum, s) => sum + (s.costUsd ?? 0), 0),
        // FOL-54: what the account was charged for it — the ledger's line, in
        // USD (one credit is one cent); null until the ledger settles it.
        // costUsd above is the token cost at the model's list price, not the bill.
        chargedUsd: charges.usd.get(r.id) ?? null,
        // Token counts, cache reads and writes beside fresh input, so a
        // runs table can show how much of a desk's context the cache served.
        tokens: runTokens(r),
        steps: r.steps.map((s) => ({ agent: s.agent, status: s.status, costUsd: s.costUsd, tokens: s.tokens ?? null })),
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
