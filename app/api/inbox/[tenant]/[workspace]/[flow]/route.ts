// A flow's inbox. An inbound-email service (Resend, Postmark, Mailgun,
// SendGrid, a Cloudflare Email Worker — anything that POSTs a received
// message) points at this URL, and the message starts the flow as its task:
// from, to, subject, then the text. Flows opt in with `trigger: email`.
//
// The same derived token as a webhook guards it; the two differ only in
// what the body is understood to be. An email flow is how "reply to this
// address and an agent handles it" exists without the platform becoming a
// mail client.

import { errorResponse } from "@/server/api";
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { loadFlow } from "@/lib/runner";
import { enqueueFlowRun } from "@/platform/queue";
import { webhookToken, recordDelivery } from "@/lib/webhook";
import { clientIp, refuseWhenLimited } from "@/server/limits";
import { normaliseInboundEmail, emailTask, withTask, deliveryKey } from "@/lib/triggers";
import { platform } from "@/lib/platform";

/** Wrong tokens one caller may present in a window before a 429. Far
 *  above a misconfigured sender retrying; far below a guessing run. */
const BAD_TOKENS = { limit: 30, windowSec: 60 };

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ tenant: string; workspace: string; flow: string }> },
) {
  try {
    const { tenant, workspace, flow: flowName } = await ctx.params;
    const log = (outcome: "accepted" | "invalid-token" | "not-webhook" | "no-flow" | "error" | "dropped", extra: object = {}) =>
      recordDelivery(tenant, workspace, { t: new Date().toISOString(), flow: flowName, outcome, ...extra });

    // The same three channels a hook takes (hooks/route.ts), so a sender
    // that can put the token in a header need not leave it in a URL.
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
    if (flow.trigger !== "email") {
      log("not-webhook", { detail: "not email-triggered" });
      return NextResponse.json({ error: `flow ${flowName} is not email-triggered (set trigger: email)` }, { status: 400 });
    }
    if (flow.steps.length === 0) {
      log("error", { detail: "flow has no steps" });
      return NextResponse.json({ error: "flow has no steps" }, { status: 400 });
    }
    const raw = (await req.text()).slice(0, 200_000);
    const mail = normaliseInboundEmail(req.headers.get("content-type"), raw);
    if (!mail) {
      log("error", { detail: "no message in the body" });
      return NextResponse.json(
        { error: "no message found — post JSON (from, subject, text) or a form-encoded inbound-parse body" },
        { status: 400 },
      );
    }
    const task = emailTask(mail);
    // A mail provider that retries a delivery, or a thread that arrives
    // twice, is one message. `idempotency: body:message_id` is the usual
    // shape here; a plain header works too.
    const gate = await platform.admitTrigger(tenant, workspace, flow, {
      deliveryKey: deliveryKey(flow.idempotency, (n) => req.headers.get(n), raw),
      body: task,
      tag: "email",
      // What `filter:` reads: the message as normalised, not the provider's shape.
      fields: { from: mail.from, to: mail.to, subject: mail.subject, text: mail.text },
    });
    if (!gate.admit) {
      log("dropped", { detail: `${gate.reason}: ${gate.detail}`, bytes: raw.length });
      return NextResponse.json({ ok: true, started: false, reason: gate.reason, detail: gate.detail });
    }
    let run;
    try {
      run = await enqueueFlowRun(tenant, workspace, withTask(flow.steps, "email", task), flow.name, flow.model, ["email"]);
    } catch (err) {
      await platform.rollbackTrigger(tenant, workspace, flow, {
        deliveryKey: deliveryKey(flow.idempotency, (n) => req.headers.get(n), raw),
        reason: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    log("accepted", { runId: run.id, bytes: raw.length, detail: `from ${mail.from}: ${mail.subject}`.slice(0, 200) });
    return NextResponse.json({ ok: true, runId: run.id });
  } catch (err) {
    return errorResponse(err);
  }
}
