// OpenAPI request/response schemas: everything else outside /api/workspaces: hooks, inbox, events, changelog, healthz, version, status, metrics, usage, issues, insights, schedule, search, openapi.json, mcp, /s/{token}.
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

// ---------------------------------------------------------------- observe (account)

/** server/account-observe.ts runRef: a run named inside the analysis — enough to open it. */
const ObserveRunRef = obj({
  workspace: str(), id: str(), what: str("the flow's name, or \"agent: x\" for a direct agent run"),
  outcome: str("running | queued | waiting | good | done | quiet | blocked | bad | failed | stopped"),
  startedAt: str(), finishedAt: nstr(),
  failure: { type: ["object", "null"], description: "{ agent, reason } — the step that failed and its last error; null when none" },
});
const ObserveSampled = obj({ n: int, p50: nullable(num), p95: nullable(num), max: nullable(num) });
const AccountObservation = obj({
  days: int,
  timezone: str("IANA zone the days are counted in: the one most of the account's schedules use, UTC when none say"),
  window: obj({ from: str(), to: str() }),
  previous: obj({ from: str(), to: str(), runs: { ...int, description: "runs started in the window before, of the same length" } }),
  kpis: obj({
    runs: int, finished: { ...int, description: "not still going (stopped included)" }, succeeded: int,
    rate: { ...nullable(num), description: "completed / (completed + failed), 0..1; null with none finished" },
    prevRate: { ...nullable(num), description: "the same for the window before" },
    failed: int, platformFailures: int, deskFailures: int,
    spendUsd: { ...num, description: "what was charged, USD (one credit is one cent)" }, prevSpendUsd: num,
    medianSecs: { ...nullable(num), description: "median run, start to finish; null under five finished runs" },
  }),
  causes: arr(obj({
    kind: str("platform | verify | timeout | error | blocked | bad | stopped"), key: str(), label: str(),
    platform: { ...bool, description: "the platform's fault — no desk edit fixes it" },
    count: int, desks: arr(str()), sample: nstr("what the newest such run said"), newest: ObserveRunRef,
  }), "why runs went wrong, the platform's causes first, then by count"),
  desks: arr(obj({
    workspace: str(), runs: int, rate: nullable(num), prevRate: nullable(num),
    deskFailures: int, platformFailures: int, spendUsd: num, medianSecs: nullable(num),
    worst: { type: ["object", "null"], description: "{ what, count } — the flow with the most desk failures" },
    lastBad: { ...nullable(ObserveRunRef), description: "the newest run that went wrong" },
  }), "every workspace, worst first; one that did not run comes last"),
  agents: arr(obj({
    workspace: str(), agent: str(), steps: int, failed: int, retried: int, costUsd: num,
    chargedUsd: nullable(num), seconds: ObserveSampled,
  }), "agents to watch: most failures, then retries, then charged; at most 10"),
  tools: arr(obj({
    name: str(), calls: int, errors: int, workspaces: arr(str("the workspaces that called it")),
    p95ms: { ...nullable(num), description: "the slowest p95 any workspace measured; null when none timed it" },
  }), "tools across the account merged by name: errors first, then calls; at most 10"),
  daily: arr(obj({
    day: str("YYYY-MM-DD in timezone"), good: int, attention: { ...int, description: "finished BLOCKED or BAD" },
    failed: int, platform: { ...int, description: "of failed, the platform's" }, other: int, spendUsd: num,
  }), "one per day, oldest first, zero-filled; a week at least"),
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
  "GET /api/observe": {
    query: [{ name: "days", description: "the window in days, 1–365 (default 7)" }],
    response: AccountObservation,
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
  "POST /api/mcp": {
    body: obj(
      {
        jsonrpc: str('"2.0"'),
        id: { type: ["string", "integer"], description: "left out on a notification, which is answered 202 with no body" },
        method: str("initialize | ping | tools/list | tools/call | notifications/…"),
        params: { type: "object", additionalProperties: true, description: "tools/call: { name, arguments }; initialize: { protocolVersion, capabilities, clientInfo }" },
      },
      ["jsonrpc", "method"],
    ),
    response: obj({
      jsonrpc: str('"2.0"'),
      id: { type: ["string", "integer", "null"] },
      result: { type: "object", additionalProperties: true, description: "initialize: { protocolVersion, capabilities, serverInfo, instructions }; tools/list: { tools }; tools/call: { content: [{ type: text, text }], isError }" },
      error: obj({ code: int, message: str() }),
    }),
  },
  "POST /api/mcp/oauth/register": {
    body: obj(
      {
        redirect_uris: arr(str("https, or http to localhost; no fragment"), "one to ten"),
        client_name: str("at most 100 characters"),
        token_endpoint_auth_method: str("none | client_secret_post | client_secret_basic (default) | private_key_jwt"),
        jwks: { type: "object", additionalProperties: true, description: "private_key_jwt: { keys: [public JWKs] }, one to ten, no private parts" },
        jwks_uri: str("private_key_jwt: an https URL of the app's JWKS, instead of jwks"),
        grant_types: arr(str("authorization_code | refresh_token")),
        response_types: arr(str("code")),
        client_uri: str("https"),
      },
      ["redirect_uris"],
    ),
    status: "201",
    response: obj({
      client_id: str(),
      client_id_issued_at: int,
      client_name: str(),
      redirect_uris: arr(str()),
      grant_types: arr(str()),
      response_types: arr(str()),
      token_endpoint_auth_method: str(),
      client_secret: str("the two secret methods only, shown once"),
      client_secret_expires_at: { ...int, description: "0: never" },
    }),
  },
  "GET /api/mcp/oauth/authorize": {
    response: obj({
      client: obj({ name: str(), id: str(), kind: str("dcr | cimd"), uri: nstr() }),
      redirectHost: str("where the answer goes — what the person is shown"),
      loopback: bool,
      scopes: arr(str("mcp:read | mcp:write")),
      account: str(),
      person: obj({ email: str(), role: str() }),
      workspaces: arr(str(), "the workspaces the person may open"),
      allWorkspaces: bool,
      redirect: str("instead of the rest: the app's redirect URI with OAuth's error, for a fault the app should hear about"),
    }),
  },
  "POST /api/mcp/oauth/authorize": {
    body: obj(
      {
        request: str("the app's authorization request, as its query string"),
        decision: str("approve | deny"),
        access: str("read | write"),
        workspaces: { type: ["array", "null"], items: str(), description: "a subset of the person's; null for all" },
      },
      ["request", "decision"],
    ),
    response: obj({ ok: bool, redirect: str("the app's redirect URI with code, state and iss — or error=access_denied") }),
  },
  "POST /api/mcp/oauth/token": {
    body: obj(
      {
        grant_type: str("authorization_code | refresh_token"),
        code: str(),
        redirect_uri: str(),
        code_verifier: str("PKCE, S256"),
        refresh_token: str(),
        client_id: str(),
        client_secret: str("or HTTP Basic"),
        client_assertion_type: str("urn:ietf:params:oauth:client-assertion-type:jwt-bearer, for private_key_jwt"),
        client_assertion: str("private_key_jwt: a JWT signed with a key in the app's JWKS — iss = sub = client_id, aud = the issuer or this endpoint, ≤ 5 minutes, jti used once"),
        resource: str("this install's /api/mcp"),
      },
      ["grant_type"],
    ),
    response: obj({
      access_token: str("fmcp_at_…, opens POST /api/mcp only"),
      token_type: str("Bearer"),
      expires_in: int,
      refresh_token: str("rotated on every use"),
      scope: str("mcp:read, or mcp:read mcp:write"),
    }),
  },
  "POST /api/mcp/oauth/revoke": {
    body: obj(
      {
        token: str("an fmcp_at_ access token or fmcp_rt_ refresh token this app holds"),
        token_type_hint: str("access_token | refresh_token"),
        client_id: str(),
        client_secret: str("or HTTP Basic"),
      },
      ["token"],
    ),
    response: { type: "object", description: "200 with an empty body: the connection the token speaks for has ended (also for a token already unknown, RFC 7009 §2.2)" },
  },
  "POST /api/mcp/clients": {
    body: obj({
      name: str("what the machine client is, as people will read it"),
      role: str("viewer (default) | editor | admin | owner — never above yours"),
      workspaces: { type: ["array", "null"], items: str(), description: "the workspaces it may open; null or absent for all you can open" },
      access: str("read (default) | write"),
      token_auth: str("client_secret_basic (default) | client_secret_post | private_key_jwt"),
      jwks: { type: "object", additionalProperties: true, description: "private_key_jwt: { keys: [public JWKs] }" },
      jwks_uri: str("private_key_jwt: an https URL of its JWKS"),
    }, ["name"]),
    status: "201",
    response: obj({
      client_id: str(),
      client_secret: str("the secret methods only — shown once"),
      grant: str("its connection id: DELETE /api/mcp/connections/<id> ends it"),
      token_endpoint: str("POST grant_type=client_credentials here"),
      token_endpoint_auth_method: str(),
    }, ["client_id", "grant", "token_endpoint"]),
  },
  "GET /api/mcp/connections": {
    response: obj({
      connections: arr(
        obj({
          id: str(),
          client: str(),
          clientId: str(),
          redirectHost: str(),
          person: str(),
          role: str(),
          workspaces: { type: ["array", "null"], items: str() },
          access: str("read | write"),
          createdAt: str(),
          lastUsedAt: nstr(),
          revokedAt: nstr(),
          machine: { type: "boolean", description: "a machine client (client credentials), not an app a person signed in" },
        }),
      ),
      everyone: { ...bool, description: "true: every connection in the account (keys:manage); false: your own" },
    }),
  },
  "DELETE /api/mcp/connections/{id}": { response: obj({ ok: bool, id: str(), revoked: bool }) },
  "GET /s/{token}": {
    media: { type: "application/octet-stream", description: "the shared file itself, streamed, under its own content type; every failure is the same 404" },
  },
};
