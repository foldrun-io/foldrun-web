// OpenAPI request/response schemas: everything else outside /api/workspaces: hooks, inbox, events, changelog, healthz, version, status, metrics, usage, issues, insights, schedule, search, openapi.json, /s/{token}.
// Written from what each handler validates and answers (30 Oct 2026).

import { type Schema, type Shape, obj, str, bool, int, arr, nullable } from "./kit.ts";

const num: Schema = { type: "number" };
const nstr = (description?: string): Schema => nullable(str(description));

/** What a hook or an inbox answers: a run started, or a delivery the flow's
 *  own idempotency:/throttle:/debounce:/disable_after: dropped (still 200). */
const TriggerAnswer = obj({
  ok: bool,
  runId: str("the run it started"),
  started: { ...bool, description: "false when the delivery was dropped; absent when a run started" },
  reason: str("why it was dropped"),
  detail: str(),
});

const Components = obj({
  core: nstr("commit sha"), platform: nstr(), web: nstr(), docs: nstr(), infra: nstr(), cli: nstr(), admin: nstr(),
});
const NoteLine = obj({ repo: str(), sha: str(), subject: str() });

const PublicIncident = obj({
  id: str(), kind: str("incident | maintenance"), title: str(), impact: str("minor | major | maintenance"),
  status: str("investigating | identified | monitoring | resolved, or scheduled | in_progress | completed"),
  components: arr(str("web | workers | scheduler | providers | email | storage")),
  startsAt: str(), endsAt: nstr(), resolvedAt: nstr(),
  updates: arr(obj({ at: str(), status: str(), body: str() })),
});

const SpendSeries = obj({
  name: str("a workspace, or <workspace>/<flow>, <workspace>/<agent>"),
  totalUsd: num, runs: int,
  periods: arr(obj({ period: str(), usd: num, runs: int })),
  change: { ...nullable(num), description: "the last complete period against the one before, as a fraction (0.5 is half again); null when there is nothing to compare" },
});

export const SHAPES: Record<string, Shape> = {
  "GET /api/changelog": {
    query: [{ name: "limit", description: "releases, default 10, 1–50" }],
    response: obj({
      version: str("what this install runs"),
      api: obj({
        current: str("YYYY-MM-DD"), supportMonths: int,
        versions: arr(obj({ version: str(), changes: arr(str()) }), "newest first"),
        deprecations: arr(obj({ route: str(), deprecatedAt: str(), sunsetAt: nstr(), link: nstr() })),
      }),
      releases: arr(
        obj({
          version: str(), released_at: nstr(), previous: nstr(), components: Components,
          notes: { ...nullable(obj({ features: arr(NoteLine), fixes: arr(NoteLine), docs: arr(NoteLine), other: arr(NoteLine) })), description: "null when they could not be built" },
        }),
        "newest first",
      ),
    }),
  },
  "POST /api/events/{tenant}/{workspace}/{runId}": {
    query: [
      { name: "token", description: "the event URL's token — the only credential" },
      { name: "step", description: "the parked step's index, as the event URL carries it (since 30 Oct 2026): the token is that step's, for one park, and releases it alone. A URL without it (made before then) still releases a step parked under it" },
    ],
    body: { description: "anything — read as text, the first 20,000 characters become the waiting step's event payload" },
    response: obj({ ok: bool, runId: str(), steps: arr(int, "the step indexes released") }),
  },
  "GET /api/healthz": {
    response: obj({
      ok: { ...bool, description: "always true — healthz reports, never gates" },
      version: str(), role: str("all | web | worker …, FOLDRUN_ROLE"),
      workerAlive: { ...bool, description: "a live worker holds the lease on this data directory (not: this process is it)" },
      database: { ...nullable(bool), description: "null with no database configured" },
      redis: { ...nullable(bool), description: "null with no Redis configured" },
    }),
  },
  "POST /api/hooks/{tenant}/{workspace}/{flow}": {
    query: [{ name: "token", description: "the hook's token, when the sender cannot send Authorization: Bearer or X-Foldrun-Token" }],
    body: { description: "anything — the whole body is what a signature:, idempotency: body:<field> and filter: read (filter: as JSON); the first 20,000 characters become the run's task" },
    response: {
      ...TriggerAnswer,
      properties: { ...(TriggerAnswer.properties as Record<string, Schema>), challenge: str("Slack's url_verification handshake, answered without starting anything") },
    },
  },
  "POST /api/inbox/{tenant}/{workspace}/{flow}": {
    query: [{ name: "token", description: "the inbox's token, when the sender cannot send Authorization: Bearer or X-Foldrun-Token" }],
    body: {
      ...obj({ from: str(), to: str(), subject: str(), text: str(), html: str() }),
      additionalProperties: true,
      description: "an inbound email: JSON (Resend's data wrapper understood) or an inbound-parse form body (Mailgun, SendGrid, Postmark …); at most 200,000 characters read",
    },
    response: TriggerAnswer,
  },
  "GET /api/metrics": {
    media: {
      type: "text/plain",
      schema: { type: "string", description: "Prometheus text exposition, version 0.0.4 (Content-Type: text/plain; version=0.0.4): foldrun_queue_*, run counts, room-wait and billing gauges" },
      description: "Every account's operational numbers, for a scraper. Only with Authorization: Bearer <FOLDRUN_METRICS_TOKEN> — no account key or session is taken; 404 while that token is unset or a wrong one is sent (wrong tokens are rate-limited)",
    },
  },
  "GET /api/openapi.json": {
    response: { ...obj({ openapi: str("3.1.0"), info: { type: "object", additionalProperties: true }, paths: { type: "object", additionalProperties: true }, components: { type: "object", additionalProperties: true } }), additionalProperties: true, description: "this document" },
  },
  "GET /api/schedule": {
    response: obj({
      scheduled: arr(
        obj({
          workspace: str(), project: str("deprecated — use workspace"), flow: str(), schedule: str("the cron line"),
          timezone: str("UTC when the flow names none"), steps: int,
          valid: { ...bool, description: "the cron parses" },
          upcoming: arr(str(), "the next three fire times, ISO; [] when invalid"),
        }),
        "every scheduled flow in the workspaces the caller may see",
      ),
    }),
  },
  "POST /api/schedule": {
    noBody: "It ticks the scheduler now; there is nothing to choose.",
    response: obj({ ok: bool, fired: arr(str("<workspace>/<flow>"), "this account's flows the tick started") }),
  },
  "GET /api/search": {
    query: [{ name: "q", description: "at most 100 characters; empty lists the workspaces alone" }],
    response: obj({
      hits: arr(
        obj({
          kind: str("workspace | agent | flow | run | tool | hook | skill | knowledge | memory"),
          title: str("the name; a run's id"), subtitle: str(), href: str("the dashboard page"),
          workspace: str("absent for the shared library"), status: str("for a run: its display status"), score: num,
        }),
        "ranked, at most six per kind",
      ),
    }),
  },
  "GET /api/status": {
    response: obj({
      status: str("operational | maintenance | degraded | outage — unknown (with a 503) when it could not be worked out"),
      description: str(), updatedAt: str(),
      components: arr(obj({
        id: str("web | workers | scheduler | providers | email | storage"), name: str(),
        status: str("operational | degraded | outage | maintenance | unknown"), detail: str(), checkedAt: nstr(),
      })),
      incidents: arr(PublicIncident, "open incidents"),
      maintenance: arr(PublicIncident, "maintenance now or announced"),
    }),
  },
  "GET /api/status/history": {
    query: [{ name: "days", description: "1–90, default 90" }],
    response: obj({
      days: int, sampleMinutes: int,
      components: arr(obj({
        id: str(), name: str(),
        uptime: { ...nullable(num), description: "0..1 over the window; null with no measured sample" },
        days: arr(obj({ date: str("YYYY-MM-DD"), samples: int, operational: int, degraded: int, outage: int, maintenance: int, uptime: nullable(num) }), "oldest first"),
      })),
      incidents: arr(PublicIncident),
    }),
  },
  "GET /api/usage/history": {
    query: [{ name: "days", description: "the window, default 56, 1–365; over 21 days it buckets by week" }],
    response: obj({
      from: str(), to: str(), bucket: str("day | week"), periods: arr(str()),
      byFlow: arr(SpendSeries), byAgent: arr(SpendSeries), byWorkspace: arr(SpendSeries),
      unattributedUsd: { ...num, description: "charges with no flow on their line" },
      totalUsd: num,
      modelUsd: num, platformUsd: num,
      unsplitUsd: { ...num, description: "charges written before the model/platform split existed" },
    }),
  },
  "GET /api/version": {
    response: obj({
      version: str("vYYYY.MM.DD.N, or dev"), released_at: nstr(), build: nstr(), api: str("the current API version, YYYY-MM-DD"),
      components: Components,
      packages: obj({ core: nstr(), cli: nstr() }),
      browsers: { type: ["array", "null"], items: str(), description: "the browser engines the runner image has; null when the deploy did not say" },
      browser_versions: { type: ["object", "null"], additionalProperties: { type: "string" }, description: "engine → version where known" },
    }),
  },
  "GET /s/{token}": {
    media: { type: "application/octet-stream", description: "the shared file itself, streamed, under its own content type; every failure is the same 404" },
  },
};
