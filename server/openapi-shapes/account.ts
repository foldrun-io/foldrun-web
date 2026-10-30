// OpenAPI request/response schemas: /api/account*, /api/approvals, /api/approve/*, /api/assistant/*, /api/audit.
// Written from what each handler validates and answers (30 Oct 2026).

import { type Schema, type Shape, obj, str, bool, int, arr, nullable, OK } from "./kit.ts";

const num: Schema = { type: "number" };
const nstr = (description?: string): Schema => nullable(str(description));

// ---------------------------------------------------------------- defaults

/** components/defaults-model.ts defaultsOf: the account's AGENTS.md keys a form edits. */
const Budget = obj({ usd: num, period: str("day | week | month") }, ["usd", "period"]);
const Compute = obj({ vcpu: nullable(num), memGiB: nullable(num), diskGiB: nullable(num) });
const Notify = obj({ url: str("an https:// webhook, or ${SECRET_NAME}"), email: str(), events: arr(str("failed | awaiting-approval | completed")) }, ["events"]);
const Telemetry = obj({ endpoint: str("the collector's OTLP/HTTP traces URL"), headers: { type: "object", additionalProperties: { type: "string" }, description: "name → value as written; ${NAME} names a vault secret, never its value" } });
/** GET, to a caller limited to some workspaces (accountDefaultsFor): a webhook
 *  URL is set but not shown; telemetry: is set but nothing of it is shown. */
const NotifyView = obj({
  url: str("an https:// webhook, or ${SECRET_NAME} — absent when hidden"), email: str(), events: arr(str("failed | awaiting-approval | completed")),
  hidden: { ...bool, description: "true: a webhook URL is set but not shown to a caller limited to some workspaces" },
}, ["events"]);
const TelemetryView = obj({
  endpoint: str("the collector's OTLP/HTTP traces URL; \"\" when hidden"),
  headers: { type: "object", additionalProperties: { type: "string" }, description: "name → value as written; ${NAME} names a vault secret, never its value; {} when hidden" },
  hidden: { ...bool, description: "true: telemetry: is set but not shown to a caller limited to some workspaces" },
});
const Alerts: Schema = {
  ...obj({
    failure_rate: { type: ["string", "number"] }, min_runs: { type: ["string", "number"] }, credits_day: { type: ["string", "number"] },
    run_minutes: { type: ["string", "number"] }, stale_days: { type: ["string", "number"] }, cost_spike: { type: ["string", "number"] },
    runs_per_hour: { type: ["string", "number"] }, new_host: bool,
  }),
  description: "the thresholds that tell notify:, as written (30% stays \"30%\")",
};
const Judge = obj({ model: str(), effort: str() });

const Defaults = obj({
  timezone: nstr("IANA zone"),
  budget: { ...nullable(Budget), description: "a cap over a day, week or month; null for none" },
  concurrency: { ...nullable(int), description: "runs that may drive at once; null is the plan's" },
  compute: { ...nullable(Compute), description: "the account's own pool — lowers the plan's, never raises it" },
  notify: nullable(Notify),
  deployBlock: nstr("none | secrets | security — what a deploy refuses beyond its own checks; null when unset"),
  networkEnforce: { ...bool, description: "refuse a site off a step's network: list, not only name it" },
  telemetry: nullable(Telemetry),
  owner: nstr("who answers for every agent and flow that names none"),
  alerts: nullable(Alerts),
  judge: nullable(Judge),
});
/** GET /api/account: the same, with notify:'s URL and telemetry: hidden from a caller limited to some workspaces. */
const DefaultsView = obj({
  ...(Defaults.properties as Record<string, Schema>),
  notify: nullable(NotifyView),
  telemetry: nullable(TelemetryView),
});

const DefaultsPatch = obj({
  timezone: { type: ["string", "null"], description: "an IANA zone; null or \"\" clears" },
  budget: { type: ["number", "string", "object", "null"], description: "60 (a month), \"60/day\", \"60/week\", or { usd, period }; null or \"\" clears" },
  concurrency: { type: ["integer", "string", "null"], description: "1–64; null or \"\" for the plan's" },
  compute: { type: ["object", "null"], description: "{ vcpu?, memGiB?, diskGiB? } — merged over the file: a key not sent is kept; null removes the block" },
  notify: { ...nullable(Notify), description: "{ url?, email?, events } — a URL or an email or both, at least one event; null clears" },
  deploy_block: { type: ["string", "null"], description: "none | secrets | security; null or \"\" clears" },
  network_enforce: { type: ["boolean", "null"] },
  telemetry: { type: ["object", "null"], description: "{ otlp: https URL, headers?: { name: value | ${SECRET} } } — needs a caller who holds every workspace; null stops sending" },
  owner: { type: ["string", "null"], description: "an email or a name, up to 200 characters" },
  alerts: { type: ["object", "null"], description: "failure_rate, min_runs, credits_day, run_minutes, stale_days, cost_spike, runs_per_hour, new_host; blank values are left out" },
  judge: { type: ["object", "null"], description: "{ model?, effort? }" },
});

// ---------------------------------------------------------------- backups

const BackupRecord = obj({
  id: str(), at: str(), archive: str("the archive's name"),
  bytes: { ...nullable(int), description: "the size of the (encrypted) archive" }, sha256: nstr(),
  files: nullable(int), runs: nullable(int),
  kinds: arr(str("files | database | keys")),
  accounts: arr(str(), "this account alone"),
  verified: bool, offsite: nstr("where the offsite copy went"), keepDays: nullable(int),
  encrypted: { ...bool, description: "sealed with age before it left the server" },
  recipient: nstr("fingerprint of the key it was sealed to, sha256:<16 hex>"),
});

const RestoreRequest = obj({
  id: str("rr_…"), tenant: str(), workspace: nstr("null for the whole account"), target: str("the point in time wanted, as the person put it"),
  backupId: nstr(), what: str("runs | state | storage | everything"), note: nstr(), by: str(), at: str(),
  status: str("requested, until the operator acts"), notified: { ...bool, description: "the operator was mailed" },
});

// ---------------------------------------------------------------- pause, model, providers

const PauseMark = obj({
  at: str(), by: str(), reason: str(),
  earlier: arr(obj({ from: str(), to: str() }), "earlier pause windows, kept a week and a day"),
});
const PauseView = obj({
  paused: { ...nullable({ ...PauseMark, properties: { ...(PauseMark.properties as Record<string, Schema>), scope: str("account | workspace") } }), description: "what holds runs now; null when nothing does" },
  account: { ...nullable(PauseMark), description: "the account's own pause" },
  workspaces: { type: "object", additionalProperties: PauseMark, description: "workspaces paused on their own, by name — those the caller may see" },
});

const AccountModel = obj({
  set: bool,
  provider: nstr("a preset name, custom, or null when no key is set"),
  baseUrl: nstr(), format: nstr("anthropic | openai"),
  keyHint: nstr("…and the key's last four characters"),
  runsOn: str("account | platform | none — what a step with no provider: runs on today"),
  platformKeyAllowed: bool,
});

const ProviderCheck = obj({
  provider: str("its preset name, or its host"), model: str("the model id a run would send"),
  verdict: str("ok | credential | not-found | busy | unreachable | provider-error"), ok: bool,
  status: { ...nullable(int), description: "the provider's HTTP status" }, ms: int, detail: str(),
  declaredIn: str("account, <workspace> or <workspace>/<agent>"),
});
const LastCheck = { ...nullable(obj({ checkedAt: str(), results: arr(ProviderCheck) })), description: "the last check; null before the first" };

// ---------------------------------------------------------------- approvals, assistant, audit

const PendingGate = obj({
  workspace: str(), runId: str(), flow: str(), step: { ...int, description: "index into the run's steps" }, agent: str(),
  question: str("the ask: text, else the step's instruction"), asked: { ...bool, description: "the flow wrote an ask:" },
  startedAt: str(), waitingSince: str(),
});
const PendingQuestion = obj({
  kind: str("question"), id: str("what POST …/runs/<id>/answer takes as question"), workspace: str(), runId: str(), flow: str(), agent: str(),
  step: int, question: str(), options: arr(str()), askedAt: str(),
});

const ConversationSummary = obj({ id: str("c_…"), workspace: str(), title: str(), updatedAt: str(), messages: { ...int, description: "how many" }, unsaved: { ...int, description: "proposed files not saved yet" } });

const AuditEntry = obj({
  id: str("opaque, stable, increasing — what cursor takes"), at: str(), actor: str(), action: str("e.g. apikey.created"),
  subject: nstr(), detail: { type: "object", additionalProperties: true },
});

const workspaceRev = obj({
  name: str(),
  head: nstr("the newest revision with a snapshot — what a restore can reach"),
  lastChange: nullable(obj({ id: str(), at: str(), by: str(), message: str() })),
  history: { ...bool, description: "it has a revision a restore can reach" },
});

export const SHAPES: Record<string, Shape> = {
  "GET /api/account": { response: obj({ defaults: DefaultsView }) },
  "PATCH /api/account": {
    body: { ...DefaultsPatch, description: "at least one key; null clears one. The keys are edited in place in AGENTS.md, comments kept" },
    response: obj({ ok: bool, defaults: Defaults }),
  },
  "GET /api/account/backups": {
    response: obj({
      policy: obj({
        schedule: str(), keepLocal: int, keepOffsiteDays: nullable(int),
        encrypted: { ...bool, description: "the job's rule; each archive says whether it was" },
        covers: arr(str()), excludes: arr(str()),
      }),
      last: { ...nullable(BackupRecord), description: "the newest archive holding this account" },
      backups: arr(BackupRecord, "newest first, at most 60"),
      requests: arr(RestoreRequest, "restore requests the caller may see, newest first"),
      workspaces: arr(workspaceRev, "the caller's workspaces and how far back their own history reaches"),
    }),
  },
  "GET /api/account/backups/requests": { response: obj({ requests: arr(RestoreRequest, "newest first, at most 20 — those the caller may see") }) },
  "POST /api/account/backups/requests": {
    body: obj(
      {
        what: str("runs | state | storage | everything"),
        target: str("the date and time to restore to, as the person puts it; at most 100 characters"),
        workspace: str("one workspace; omitted, the whole account (needs access to every workspace)"),
        backupId: str("the archive, when one was picked"),
        note: str("at most 1,000 characters"),
      },
      ["what", "target"],
    ),
    status: "201",
    response: obj({ ok: bool, request: RestoreRequest }),
  },
  "POST /api/account/close": {
    body: obj({ confirm: str("the account's name, typed back"), reason: str("at most 500 characters") }, ["confirm"]),
    response: obj({
      ok: bool,
      suspended: { ...bool, description: "always true: no new runs from now" },
      notified: { ...bool, description: "the platform's operator was mailed" },
      billing: str("what happened to the subscription, in words"),
    }),
  },
  "GET /api/account/export": {
    media: {
      type: "application/json",
      description: "an attachment, foldrun-<account>-export.json",
      schema: obj({
        account: str(), exportedAt: str(),
        workspaces: arr(obj({ name: str(), flows: arr(str()) })),
        members: arr(obj({ email: str(), role: nstr("owner | admin | editor | viewer"), workspaces: { type: ["array", "null"], items: str() }, since: str() })),
        runs: arr(obj({ id: str(), workspace: str(), flow: str(), status: str(), startedAt: str(), finishedAt: str(), summary: str(), startedBy: str() })),
        ledger: arr({
          ...obj({
            t: str(), kind: str("topup | run | adjustment | grant | expire"), usd: { ...num, description: "positive credits the account, negative spends it" },
            meter: obj({ steps: int, computeSecs: num, netBytes: int }), split: obj({ modelUsd: num, computeUsd: num, networkUsd: num }),
            carriedUsd: num, waived: arr(str("models | compute | network")), workspace: str(), runId: str(), flow: str(), note: str(), key: str(), reason: str(), pricingVersion: int,
          }),
          additionalProperties: true,
          description: "a ledger line — the charge, never the provider cost behind it",
        }),
      }),
    },
  },
  "GET /api/account/jobs": {
    query: [{ name: "workspace", description: "also that workspace's values" }],
    response: obj({
      workspace: str("echoed when asked"),
      jobs: arr(
        obj({
          name: str("governance | guardrail | observability | evaluation"), title: str(), what: str(),
          fields: arr(
            obj({
              key: str("the AGENTS.md key"),
              account: { description: "the account's value as written; null when unset. To a caller limited to some workspaces, notify: and telemetry: come as { hidden: true, … } — set, never the URL, headers or token" },
              workspace: { description: "the workspace's value, when one was asked about; null when unset" },
              combine: str("workspace replaces | either turns it on | both apply | per key | per field | level nearest, sites from both | account only"),
              writable: { ...bool, description: "this scope's settings PATCH writes it; otherwise it is written in AGENTS.md" },
            }),
          ),
        }),
      ),
    }),
  },
  "GET /api/account/model": { response: AccountModel },
  "PUT /api/account/model": {
    body: obj(
      {
        provider: str("a preset name (anthropic, openrouter, openai, groq, …) or custom"),
        apiKey: str("write-only; a Claude login token is refused unless the account may use the platform's credential"),
        baseUrl: str("https://; required for custom and for a preset whose address is per account"),
        format: str("anthropic | openai"),
      },
      ["apiKey"],
    ),
    response: { ...AccountModel, properties: { ok: bool, ...(AccountModel.properties as Record<string, Schema>) } },
  },
  "DELETE /api/account/model": { response: { ...AccountModel, properties: { ok: bool, ...(AccountModel.properties as Record<string, Schema>) } } },
  "GET /api/account/pause": { response: PauseView },
  "POST /api/account/pause": {
    body: obj({ reason: str("at most 300 characters"), stop: { ...bool, description: "true also stops every running, queued or parked run (needs run:start)" } }),
    response: {
      ...PauseView,
      properties: {
        ok: bool,
        ...(PauseView.properties as Record<string, Schema>),
        stopped: arr(str("<workspace>/<runId>")),
        failed: arr(obj({ runId: str(), workspace: str(), error: str() })),
      },
    },
  },
  "DELETE /api/account/pause": { response: { ...PauseView, properties: { ok: bool, ...(PauseView.properties as Record<string, Schema>) } } },
  "GET /api/account/providers": {
    response: obj({
      configured: arr(obj({ provider: str("preset name or base URL"), declaredIn: str(), model: str(), format: str("anthropic | openai") }), "the provider: blocks in use the caller may see"),
      lastCheck: LastCheck,
    }),
  },
  "POST /api/account/providers": {
    noBody: "It checks every provider block the account uses; there is nothing to choose.",
    response: obj({ ok: bool, lastCheck: LastCheck }),
  },
  "POST /api/account/telemetry/test": {
    body: obj({ workspace: str("use its telemetry: block; omitted, the account's (needs access to every workspace)") }),
    response: obj({
      ok: { ...bool, description: "the collector took every span" },
      status: { ...int, description: "the collector's HTTP status, when it answered" },
      error: str(), spans: { ...int, description: "spans sent" },
      endpoint: str(),
    }),
  },
  "GET /api/approvals": {
    response: obj({
      approvals: arr(PendingGate, "one per waiting step, oldest first"),
      questions: arr(PendingQuestion, "questions agents are asking mid-step"),
    }),
  },
  "GET /api/approve/{tenant}/{workspace}/{runId}": {
    query: [
      { name: "token", description: "the link's token — the only credential" },
      { name: "decision", description: "reject pre-selects the Reject button; nothing is decided on GET" },
    ],
    media: { type: "text/html", schema: { type: "string" }, description: "a page showing what waits, its preview files, and Approve / Reject buttons" },
  },
  "POST /api/approve/{tenant}/{workspace}/{runId}": {
    query: [{ name: "token", description: "the link's token — the only credential" }],
    body: obj(
      { decision: str("approve | reject; anything else is approve"), note: str("an answer to the ask:, or a note for the agent") },
      [],
    ),
    response: {
      ...obj({ ok: bool, decision: str("approve | reject"), steps: arr(int, "the step indexes decided") }),
      description: "for a JSON body or Accept: application/json; a browser form post (form-encoded, same fields) gets an HTML page",
    },
  },
  "GET /api/assistant/conversations": {
    query: [
      { name: "workspace", description: "only this workspace's" },
      { name: "q", description: "search the titles and every message" },
      { name: "limit", description: "default 50, 1–200" },
    ],
    response: obj({ conversations: arr(ConversationSummary, "the caller's own, newest first") }),
  },
  "GET /api/assistant/conversations/{id}": {
    response: obj({
      id: str(), workspace: str(), title: str(),
      messages: arr(obj({ role: str("user | assistant"), content: str(), meta: { type: "object", additionalProperties: true, description: "what the dashboard draws under a reply: sources, tokens, charge, a proposed workspace" } }, ["role", "content"])),
      files: arr(obj({ path: str(), content: str(), before: nstr("the file before the proposal; null for a new one"), sha256: nstr() }), "proposed files not saved yet"),
      createdAt: str(), updatedAt: str(),
    }),
  },
  "DELETE /api/assistant/conversations/{id}": { response: OK },
  "GET /api/audit": {
    query: [
      { name: "since", description: "7d, 24h, 30m or a date" },
      { name: "until", description: "the same" },
      { name: "action", description: "an exact action (apikey.created) or a family (apikey, apikey.*)" },
      { name: "actor", description: "who did it, exactly" },
      { name: "workspace", description: "entries whose detail names this workspace" },
      { name: "limit", description: "1–1000; default 100 (1000 for csv)" },
      { name: "cursor", description: "the previous page's next" },
      { name: "format", description: "json (default) | csv — csv answers text/csv with the cursor in X-Next-Cursor" },
    ],
    response: obj({
      entries: arr(AuditEntry, "newest first"),
      next: nstr("the cursor for the next page; null at the end"),
      retention: str("how long entries are kept"),
    }),
  },
};
