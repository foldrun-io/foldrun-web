// Event-based trigger: POST here and the flow runs, with the request body
// delivered as the run's task. Flows must opt in with `trigger: webhook`.
//
// The token is per-flow, derived from the install's secret key, so there is
// nothing extra to store and rotating the key rotates every hook. It may
// arrive as `Authorization: Bearer <token>`, as `X-Foldrun-Token`, or in the
// URL's `?token=` — in that order. The URL is the leakier channel and stays
// supported because most webhook senders have nowhere to put a header; a
// caller that does should use one.
//
// A flow may additionally demand a provider's signature (`signature:` in its
// frontmatter — github, stripe, slack or a plain hmac): then the token says
// where the delivery was meant to land and the signature says who sent it,
// and both have to hold. Slack's url_verification handshake is answered
// here without starting anything, because a URL that cannot answer it is
// never saved on their side.

import { errorResponse } from "@/server/api";
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { loadFlow } from "@/lib/runner";
import { enqueueFlowRun } from "@/platform/queue";
import { webhookToken, recordDelivery } from "@/lib/webhook";
import { clientIp, refuseWhenLimited } from "@/server/limits";
import { verifyWebhookSignature, withTask, deliveryKey } from "@/lib/triggers";
import { platform } from "@/lib/platform";
import { webhookFilterPayload } from "@/lib/trigger-filter";

/** Wrong tokens one caller may present in a window before a 429. Far
 *  above a misconfigured sender retrying; far below a guessing run. */
const BAD_TOKENS = { limit: 30, windowSec: 60 };

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ tenant: string; workspace: string; flow: string }> },
) {
  try {
    const { tenant, workspace, flow: flowName } = await ctx.params;
    // Every delivery is written down, refused ones especially: a hook that
    // "never fires" and a hook firing into a refusal look identical from
    // the sender's side, and the log is what tells them apart.
    const log = (
      outcome: "accepted" | "invalid-token" | "invalid-signature" | "not-webhook" | "no-flow" | "error" | "dropped",
      extra: object = {},
    ) => recordDelivery(tenant, workspace, { t: new Date().toISOString(), flow: flowName, outcome, ...extra });

    // The header first, the query string second. Both are accepted because
    // the two kinds of caller cannot be served by one: Stripe, GitHub and
    // every other service that takes a URL in a form field has nowhere to
    // put a header, while anything scripted does — and a URL is the leakier
    // channel, turning up in proxy logs, access logs, browser history and
    // screenshots long after the request. So senders that can use the
    // safer one now may, and the ones that cannot are unaffected.
    const header = req.headers.get("authorization") ?? "";
    const presented =
      (/^Bearer\s+(.+)$/i.exec(header)?.[1] ?? req.headers.get("x-foldrun-token") ?? req.nextUrl.searchParams.get("token") ?? "").trim();
    const expected = webhookToken(tenant, workspace, flowName);
    const ok =
      presented.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
    if (!ok) {
      // Counted per caller, and only when refused: a sender with the right
      // token never meets this, so a stranger cannot throttle a real hook.
      const ip = clientIp(req);
      const limited = ip ? await refuseWhenLimited(`hook-refused:${ip}`, BAD_TOKENS.limit, BAD_TOKENS.windowSec) : null;
      if (limited) return limited;
      log("invalid-token");
      return NextResponse.json({ error: "invalid token" }, { status: 401 });
    }

    const flow = loadFlow(tenant, workspace, flowName);
    if (!flow) {
      log("no-flow");
      return NextResponse.json({ error: "flow not found" }, { status: 404 });
    }
    if (flow.trigger !== "webhook") {
      log("not-webhook");
      return NextResponse.json(
        {
          error:
            flow.trigger === "email"
              ? `flow ${flowName} is email-triggered — its address is /api/inbox/…, not /api/hooks/…`
              : `flow ${flowName} is not webhook-triggered (set trigger: webhook)`,
        },
        { status: 400 },
      );
    }
    if (flow.steps.length === 0) {
      log("error", { detail: "flow has no steps" });
      return NextResponse.json({ error: "flow has no steps" }, { status: 400 });
    }

    // Whatever was posted becomes context for the first step. Read whole
    // before any signature check: every scheme signs the exact bytes.
    const raw = (await req.text()).slice(0, 20_000);
    const verdict = verifyWebhookSignature(tenant, workspace, flow, raw, (name) => req.headers.get(name));
    if (verdict.challenge) {
      log("accepted", { detail: "slack url_verification" });
      return NextResponse.json({ challenge: verdict.challenge });
    }
    if (!verdict.ok) {
      log("invalid-signature", { detail: verdict.reason });
      return NextResponse.json({ error: verdict.reason }, { status: 401 });
    }

    // idempotency:, throttle:, debounce:, disable_after: — whether this
    // delivery becomes a run. A drop is a 200: the delivery arrived and was
    // understood, and the flow's own file says one run is enough. Anything
    // else and a sender with retries would hammer the hook forever trying
    // to deliver a duplicate we deliberately ignored.
    const gate = await platform.admitTrigger(tenant, workspace, flow, {
      deliveryKey: deliveryKey(flow.idempotency, (n) => req.headers.get(n), raw),
      body: raw,
      tag: "webhook_payload",
      // What `filter:` reads: the body as JSON (null when it is not, which
      // no filter matches). Only parsed when the flow has a filter.
      ...(flow.filter != null ? { fields: webhookFilterPayload(raw) } : {}),
    });
    if (!gate.admit) {
      log("dropped", { detail: `${gate.reason}: ${gate.detail}`, bytes: raw.length });
      return NextResponse.json({ ok: true, started: false, reason: gate.reason, detail: gate.detail });
    }

    let run;
    try {
      run = await enqueueFlowRun(tenant, workspace, withTask(flow.steps, "webhook_payload", raw), flow.name);
    } catch (err) {
      // The gate recorded this delivery as handled and started the throttle
      // window. Neither is true if the run could not start — undo them, so
      // the sender's retry is a fresh event and not a "duplicate" of nothing.
      await platform.rollbackTrigger(tenant, workspace, flow, {
        deliveryKey: deliveryKey(flow.idempotency, (n) => req.headers.get(n), raw),
        reason: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    log("accepted", { runId: run.id, bytes: raw.length, ...(flow.signature ? { detail: verdict.reason } : {}) });
    return NextResponse.json({ ok: true, runId: run.id });
  } catch (err) {
    return errorResponse(err);
  }
}
