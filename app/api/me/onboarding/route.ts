// Getting started — the account's first steps, each derived from what is
// really there (components/onboarding-model.ts), what this person hid, and
// with ?workspace= that workspace's checklist (workspace-checklist-model.ts).
//
//   GET [?workspace=<name>]   { steps, done, total, complete, next, upNext,
//                               hidden, dismissed, dismissedAt, welcomedAt,
//                               checklist? }
//   PATCH { dismissed?, welcomed?, hide?, show?,
//           checklist?: { workspace, dismissed?, hide?, show? } }
//
// Read by anyone in the account, key or person. Hiding is a person's own
// setting (users.prefs), so PATCH needs a signed-in person; a key reads
// nothing hidden and `dismissed: false`, since a key is nobody.

import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { requireCaller, requireSession, errorResponse, ApiError } from "@/server/api";
import {
  onboardingFor,
  onboardingPrefs,
  workspaceChecklistFor,
  ONBOARDING_PREF,
  ONBOARDING_WELCOMED_PREF,
  ONBOARDING_HIDDEN_PREF,
  ONBOARDING_CHECKLISTS_PREF,
} from "@/server/onboarding";
import { isOnboardingStepId } from "@/components/onboarding-model";
import { isChecklistItemId } from "@/components/workspace-checklist-model";
import { findUserById, setUserPrefs, verifySession, SESSION_COOKIE } from "@/server/users";
import { scopeAllows } from "@/platform/scope";
import { workspaceDir } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { tenant, actor } = await requireCaller(req);
    const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    const person = session ? await findUserById(session.id) : null;
    const prefs = onboardingPrefs(person?.prefs);
    const ws = req.nextUrl.searchParams.get("workspace");
    let checklist = undefined;
    if (ws !== null) {
      // Out of scope reads as absent: a scoped caller learns no other
      // workspace's name, not even that it exists.
      if (!ws || !scopeAllows(actor.workspaces, ws) || !fs.existsSync(workspaceDir(tenant, ws))) throw new ApiError(`no workspace ${ws}`, 404);
      checklist = workspaceChecklistFor(tenant, ws, prefs);
    }
    return NextResponse.json({
      ...(await onboardingFor(tenant, actor.workspaces, prefs.hidden)),
      dismissed: Boolean(prefs.dismissedAt),
      dismissedAt: prefs.dismissedAt,
      welcomedAt: prefs.welcomedAt,
      ...(checklist ? { checklist } : {}),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** A list of ids, every one known, or a 400 naming the field. */
function ids(v: unknown, field: string, known: (x: unknown) => boolean): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every(known)) throw new ApiError(`${field} must be a list of step ids`, 400);
  return v as string[];
}

const merge = (current: string[], hide: string[], show: string[]) => [...new Set([...current, ...hide])].filter((x) => !show.includes(x));

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession(req);
    const body = (await req.json().catch(() => ({}))) as {
      dismissed?: unknown;
      welcomed?: unknown;
      hide?: unknown;
      show?: unknown;
      checklist?: unknown;
    };
    if (body.dismissed !== undefined && typeof body.dismissed !== "boolean") throw new ApiError("dismissed must be true or false", 400);
    if (body.welcomed !== undefined && typeof body.welcomed !== "boolean") throw new ApiError("welcomed must be true or false", 400);
    const hide = ids(body.hide, "hide", isOnboardingStepId);
    const show = ids(body.show, "show", isOnboardingStepId);
    const cl = body.checklist;
    if (cl !== undefined && (!cl || typeof cl !== "object" || typeof (cl as { workspace?: unknown }).workspace !== "string")) {
      throw new ApiError("checklist must be { workspace, dismissed?, hide?, show? }", 400);
    }
    if (body.dismissed === undefined && body.welcomed === undefined && !hide.length && !show.length && cl === undefined) {
      throw new ApiError("expected { dismissed: true | false } or welcomed, hide, show, checklist", 400);
    }

    const person = await findUserById(session.id);
    const prefs = onboardingPrefs(person?.prefs);
    const patch: Record<string, unknown> = {};
    if (body.dismissed !== undefined) patch[ONBOARDING_PREF] = body.dismissed ? new Date().toISOString() : null;
    if (body.welcomed !== undefined) patch[ONBOARDING_WELCOMED_PREF] = body.welcomed ? (prefs.welcomedAt ?? new Date().toISOString()) : null;
    if (hide.length || show.length) {
      const next = merge(prefs.hidden, hide, show);
      patch[ONBOARDING_HIDDEN_PREF] = next.length ? next : null;
    }
    if (cl !== undefined) {
      const c = cl as { workspace: string; dismissed?: unknown; hide?: unknown; show?: unknown };
      // The same reading of the account and scope GET answers with.
      const { tenant, actor } = await requireCaller(req);
      if (!c.workspace || !scopeAllows(actor.workspaces, c.workspace) || !fs.existsSync(workspaceDir(tenant, c.workspace))) {
        throw new ApiError(`no workspace ${c.workspace}`, 404);
      }
      if (c.dismissed !== undefined && typeof c.dismissed !== "boolean") throw new ApiError("checklist.dismissed must be true or false", 400);
      const chide = ids(c.hide, "checklist.hide", isChecklistItemId);
      const cshow = ids(c.show, "checklist.show", isChecklistItemId);
      const lists = { ...prefs.checklists };
      const cur = lists[c.workspace] ?? {};
      const entry: { dismissedAt?: string; hidden?: string[] } = {};
      const dismissedAt = c.dismissed === undefined ? cur.dismissedAt : c.dismissed ? new Date().toISOString() : undefined;
      if (dismissedAt) entry.dismissedAt = dismissedAt;
      const hidden = merge(cur.hidden ?? [], chide, cshow);
      if (hidden.length) entry.hidden = hidden;
      if (entry.dismissedAt || entry.hidden) lists[c.workspace] = entry;
      else delete lists[c.workspace];
      patch[ONBOARDING_CHECKLISTS_PREF] = Object.keys(lists).length ? lists : null;
    }
    const saved = onboardingPrefs(await setUserPrefs(session.id, patch));
    return NextResponse.json({
      ok: true,
      dismissed: Boolean(saved.dismissedAt),
      dismissedAt: saved.dismissedAt,
      welcomedAt: saved.welcomedAt,
      hidden: saved.hidden,
      ...(cl !== undefined ? { checklist: saved.checklists[(cl as { workspace: string }).workspace] ?? {} } : {}),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
