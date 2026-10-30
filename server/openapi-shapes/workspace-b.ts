// OpenAPI request/response schemas: /api/workspaces/{workspace} itself and /api/workspaces/{workspace}/<notify|observe|pause|proposals|restore|runtimes|shares|source|storage|tools|triggers|vocabulary|…>.
// Written from what each handler validates and answers (30 Oct 2026).

import { type Schema, type Shape, obj, str, bool, int, arr, nullable, OK, Proposal } from "./kit.ts";

const num = { type: "number" };
const open = (s: Schema, description?: string): Schema => ({ ...s, additionalProperties: true, ...(description ? { description } : {}) });

// ---------------------------------------------------------------- the workspace

/** core store.ts AgentInfo — the fields callers rely on; the rest are the
 *  checks' findings about its frontmatter. */
const AgentInfo = open(
  obj({
    name: str(), description: str(),
    owner: nullable(str("its own owner:, else the workspace's, else the account's")), ownerFrom: nullable(str("agent | workspace | account")),
    model: str("fast | default | max, or a model id; default when unset"), effort: nullable(str()),
    tools: arr(str()), ownTools: arr(str(), "the tools: entries that are not built-ins"),
    apis: arr(open(obj({ name: str(), base: str() }))),
    consults: arr(str(), "agents:"), subagents: arr(str(), "subagents:"), sandbox: str("own — present only when set"),
    skills: { type: ["array", "null"], items: str(), description: "the skills: allowlist; null when absent (every skill in scope)" },
    secrets: arr(str(), "names only"),
    budget: nullable({ ...num, description: "the most it may spend in one run, USD" }),
    timezone: nullable(str()),
    limits: { type: "object", additionalProperties: int },
    network: open(obj({ readsWeb: bool }), "the resolved network: policy, account → workspace → agent"),
    frontmatterError: str("present when its YAML does not parse; the other fields are then defaults"),
  }),
  "an agent (core AgentInfo); also budgetProblem, timezoneProblem, webProblems, limitProblems, networkProblems and the other checks' findings",
);

/** core store.ts FlowInfo — the fields callers rely on. */
const FlowInfo = open(
  obj({
    name: str(), file: str(), description: nullable(str()),
    trigger: str("manual | schedule | webhook | email | storage | watch | flow | once"),
    schedule: nullable(str("cron, for trigger: schedule")), timezone: nullable(str()),
    model: nullable(str()), effort: nullable(str()),
    overlap: nullable(str("skip | queue")), priority: nullable(str("high | normal | low")),
    budget: nullable({ ...num, description: "the most one run may spend, USD" }),
    owner: nullable(str()), ownerFrom: nullable(str("flow | workspace | account")),
    live: bool,
    steps: arr(open(obj({})), "the numbered steps, parsed"),
    frontProblems: arr(str()),
  }),
  "a flow (core FlowInfo); also the trigger's own settings (after, on, at, every, signature, path, filter, debounce, throttle, sla, approvers, …)",
);

const Budget = obj({ usd: num, period: str("day | week | month") }, ["usd", "period"]);
const NotifyBlock = obj({ url: str("https://… or ${SECRET_NAME}"), email: str(), events: arr(str("failed | awaiting-approval | completed")) });
const Compute = obj({ vcpu: nullable(num), memGiB: nullable(num), diskGiB: nullable(num) });
const Alerts = open(
  obj({ failure_rate: { type: ["string", "number"] }, min_runs: { type: ["string", "number"] }, credits_day: { type: ["string", "number"] }, run_minutes: { type: ["string", "number"] }, stale_days: { type: ["string", "number"] }, cost_spike: { type: ["string", "number"] }, runs_per_hour: { type: ["string", "number"] }, new_host: bool }),
  "the thresholds as written (30% stays \"30%\"); {} is no alerts here",
);
const Judge = obj({ model: str(), effort: str() });

/** components/defaults-model.ts Defaults, as this workspace's AGENTS.md sets them. */
const Defaults = obj({
  timezone: nullable(str()),
  budget: nullable(Budget),
  concurrency: nullable(int),
  compute: nullable(Compute),
  notify: nullable(NotifyBlock),
  deployBlock: nullable(str("none | secrets | security")),
  networkEnforce: bool,
  telemetry: nullable(obj({ endpoint: str(), headers: { type: "object", additionalProperties: str("as written: ${NAME} for a vault secret, never its value") } })),
  owner: nullable(str()),
  alerts: nullable(Alerts),
  judge: nullable(Judge),
});

// ---------------------------------------------------------------- notify

/** core notify.ts WebhookAttempt. */
const WebhookAttempt = obj({
  n: { ...int, description: "1-based" }, at: str(),
  statusCode: nullable({ ...int, description: "the receiver's status; null when none came back (a timeout, DNS)" }),
  durationMs: int,
  response: nullable(str("the first 500 characters of what the receiver answered")),
  error: nullable(str()),
  manual: { ...bool, description: "a person pressed redeliver or test" },
});

/** platform webhook-deliveries.ts DeliveryRow, as redactDelivery hands it out. */
const Delivery = obj({
  id: str("the X-Foldrun-Delivery id, the same across every attempt"), tenant: str(), workspace: str(),
  event: str("failed | awaiting-approval | completed | test | …"),
  status: str("pending | delivered | failed | skipped"),
  body: str("the JSON sent, as text — approve/reject links replaced with [redacted]"),
  destination: nullable(str("the URL as notify: names it — a ${SECRET} left unresolved")),
  attempts: int, attemptLog: arr(WebhookAttempt),
  lastStatusCode: nullable(int), lastError: nullable(str()),
  nextAttemptAt: nullable(str("when the next automatic retry is due; null when none is")),
  createdAt: str(), updatedAt: str(),
});

const Endpoint = obj({
  urlHash: str(), failingSince: nullable(str()), lastSuccessAt: nullable(str()), lastFailureAt: nullable(str()),
  disabledAt: nullable(str("switched off after days of failures; an accepted test or redelivery turns it back on")), disabledReason: nullable(str()),
});

// ---------------------------------------------------------------- observe

const Sampled = obj({ n: int, p50: nullable(num), p95: nullable(num), max: nullable(num) }, ["n", "p50", "p95", "max"]);
const Tally = obj({
  runs: int, live: int, waiting: int, stopped: int, finished: int, completed: int, failed: int, ok: int, quiet: int, blocked: int, bad: int,
  completedPct: nullable({ ...int, description: "completed / finished, whole percent; null with nothing finished" }),
});

// ---------------------------------------------------------------- pause

const PauseMark = obj({
  at: str(), by: str(), reason: str(),
  earlier: arr(obj({ from: str(), to: str() }), "earlier pause windows, kept a week and a day"),
});
const PauseView = {
  paused: nullable({ ...obj({ ...(PauseMark.properties as Record<string, Schema>), scope: str("account | workspace — whose pause applies") }), description: "the pause that holds runs here (the account's when both); null when none" }),
  account: nullable({ ...PauseMark, description: "the account's own pause, or null" }),
  workspace: nullable({ ...PauseMark, description: "this workspace's own pause, or null" }),
};

// ---------------------------------------------------------------- proposals

// Proposal is in kit.ts: POST …/evals/{evalName}/improve answers one too.

// ---------------------------------------------------------------- restore

const DeployIssue = obj({ where: str(), message: str() });
const RestoreTo = obj({ id: str("the revision restored to"), sha: str("the same id, under its older name"), at: str(), by: str(), message: str() });
const RestorePlan = {
  workspace: str(),
  to: RestoreTo,
  from: nullable(str("the revision before the restore — restore to it to undo")),
  added: arr(str()), updated: arr(str()), removed: arr(str()),
  files: arr(obj({ path: str(), change: str("added | updated | removed"), diff: arr(obj({ kind: str("same | add | del"), text: str() })) })),
  blockedBy: arr(str(), "runs in flight; a restore waits for them, as a deploy does"),
  noop: { ...bool, description: "the workspace already matches that point" },
  issues: arr(DeployIssue, "the deploy checks on that tree: a restore with any is refused"),
  warnings: arr(DeployIssue, "advisory"),
};

// ---------------------------------------------------------------- storage, shares, tools

/** core storage.ts FileRecord. */
const FileRecord = obj({
  path: str("under storage/, forward-slashed"), sha: str("sha256 of the bytes"), size: { ...int, description: "bytes" }, mime: str(), updatedAt: str(),
  by: str("user:<email>, key:<label> or run:<runId>:<agent>"),
});

const Share = obj({
  token: str("the link's token — masked (its first characters and …) unless the reader is an admin or made the link"),
  masked: { ...bool, description: "true when token is masked and url null" },
  url: nullable(str("the public link; null when masked or the install has no public origin")),
  id: str("sh_… — revoke by it when the token is masked"),
  path: str(), contentType: str(), createdAt: str(), createdBy: nullable(str()),
  expiresAt: nullable(str("null: never expires")), revokedAt: nullable(str()),
});

/** core tool-test.ts ToolTestResult (and the web tier's refusal, same shape less ms). */
const ToolTestResult = obj({
  ok: bool, transport: str("http | script | mcp"),
  summary: str("one line, safe to show beside the button"),
  detail: str("the response body, stdout or the server's tool list, cut at 4,000 characters"),
  ms: int,
  missingSecrets: arr(str(), "names only"),
}, ["ok", "transport", "summary", "detail", "missingSecrets"]);

/** server/doc-preview.ts Preview — one of these, by kind. */
const Preview = open(
  obj({
    kind: str("text | table | document | slides | archive | html | svg | image | email | calendar | contacts | notebook | link | mesh | binary"),
    format: str("text: markdown | json | code | plain"), language: str(), text: str(),
    sheets: arr(obj({ name: str(), rows: arr(arr(str())), truncated: bool }), "table"),
    blocks: arr(obj({ style: str("h1 | h2 | h3 | p | li"), text: str() }), "document"),
    slides: arr(obj({ title: str(), lines: arr(str()) }), "slides"),
    entries: arr(obj({ name: str(), size: int }), "archive"),
    html: str("html: the page's source, for a sandboxed frame — never served as a page"), svg: str(),
    mime: str("image"), data: str("image: base64"),
    headers: arr(obj({ name: str(), value: str() }), "email"), body: str(), attachments: arr(str()),
    events: arr(obj({ title: str(), start: str(), end: str(), where: str(), notes: str() }), "calendar"),
    people: arr(obj({ name: str(), lines: arr(str()) }), "contacts"),
    cells: arr(obj({ type: str("markdown | code | raw"), source: str(), outputs: arr(str()) }), "notebook"),
    url: str("link"),
    triangles: arr(num, "mesh"), count: int,
    hex: str("binary: the first bytes"), size: int,
    truncated: bool, note: str(),
  }, ["kind"]),
  "the file parsed for reading; which fields are present depends on kind",
);

// ---------------------------------------------------------------- triggers

const TriggerOutcome = "started | duplicate | throttled | debounced | quarantined | paused | halted | overlap-skipped | missed | filtered | failed";

export const SHAPES: Record<string, Shape> = {
  "GET /api/workspaces/{workspace}": {
    response: obj({
      name: str(),
      agents: arr(AgentInfo),
      flows: arr(FlowInfo),
      files: arr(str(), "the workspace's editable files, workspace-relative; runs/, outputs/ and generated results left out"),
    }),
  },
  "PATCH /api/workspaces/{workspace}": {
    body: obj({
      name: str("rename it — every webhook URL changes; refused (409) while it is paused"),
      description: str("written as one YAML value, recorded as a revision"),
      timezone: nullable(str("an IANA zone; null or \"\" clears")),
      budget: { type: ["number", "string", "object", "null"], description: "a USD cap: a number (per month), \"60/day\", \"60/week\", or { usd, period }; null clears" },
      compute: nullable({ ...obj({ vcpu: nullable(num), memGiB: nullable(num), diskGiB: nullable(num) }), description: "this workspace's pool, merged over what is set (a key not sent is kept, null drops one); null clears" }),
      notify: nullable({ ...NotifyBlock, description: "{ url?, email?, events } — a URL, an email or both, at least one event; null clears" }),
      network_enforce: nullable({ ...bool, description: "true refuses a site off a step's network: list; false or null turns it off" }),
      owner: nullable(str("a person's email or name, up to 200 characters; null clears")),
      alerts: nullable({ ...Alerts, description: "thresholds; blank ones are left out, {} is no alerts here, null is the account's" }),
      judge: nullable({ ...Judge, description: "the model every grader here uses; null clears" }),
    }),
    response: obj({
      ok: bool,
      name: str("the name it has now"),
      renamed: bool,
      defaults: Defaults,
      brokeWebhooks: arr(str(), "flows whose webhook URL stopped working with the rename — re-copy each"),
    }),
  },
  "DELETE /api/workspaces/{workspace}": {
    noBody: "The workspace is named in the path; its public links are revoked and its stored files purged with it.",
    response: OK,
  },
  "GET /api/workspaces/{workspace}/notify/deliveries": {
    query: [
      { name: "status", description: "pending | delivered | failed | skipped" },
      { name: "event", description: "only deliveries of this event (failed, awaiting-approval, completed, test, …)" },
      { name: "limit", description: "default 50, 1–200" },
      { name: "offset", description: "default 0" },
    ],
    response: obj({
      deliveries: arr(Delivery, "newest first"),
      total: { ...int, description: "how many the filter matches, for paging" },
      limit: int, offset: int,
      endpoint: nullable({ ...Endpoint, description: "the webhook's health; null when notify: has no url or nothing was sent yet" }),
    }),
  },
  "POST /api/workspaces/{workspace}/notify/deliveries/{id}/redeliver": {
    noBody: "The delivery is named in the path; it is sent again with its own id and body.",
    response: obj({
      ok: { ...bool, description: "the receiver took it; 200 either way" },
      attempt: nullable({ ...WebhookAttempt, description: "the attempt just made" }),
      delivery: Delivery,
    }),
  },
  "POST /api/workspaces/{workspace}/notify/test": {
    noBody: "It sends one test message to whatever this workspace's notify: resolves to; there is nothing to choose.",
    response: obj({
      ok: { ...bool, description: "it was accepted; 200 either way" },
      destination: str("where it went: the email, the URL as written (a ${SECRET} left unresolved), or none"),
      detail: str("what happened — the provider's own words when it failed"),
    }, ["ok", "destination", "detail"]),
  },
  "GET /api/workspaces/{workspace}/observe": {
    query: [
      { name: "days", description: "the window in days, 1–365 (default 30)" },
      { name: "since", description: "the older spelling of days" },
    ],
    response: obj({
      workspace: str(), sinceDays: int,
      from: nullable(str("the oldest run's start in the window")),
      runs: int,
      failedRuns: { ...int, description: "runs that failed, not ones a person stopped" },
      tally: Tally,
      steps: int,
      costUsd: { ...num, description: "the provider's token cost at list price — not the bill" },
      chargedUsd: { ...num, description: "what the runs were charged, USD (a credit is a cent); list price until the ledger settles" },
      agents: arr(obj({
        agent: str(), steps: int, failed: int, retried: int, skipped: int, costUsd: num, chargedUsd: num,
        inputTokens: int, outputTokens: int, cacheReadTokens: int, cacheWriteTokens: int, cacheHitRate: nullable(num),
        turns: Sampled, systemPromptChars: Sampled, seconds: Sampled,
      })),
      tools: arr(obj({
        name: str(), calls: int, errors: int, measured: int, ms: Sampled, resultSize: Sampled, resultChars: int,
        heavyCalls: { ...int, description: "calls whose result was over 10,000 characters" }, agents: arr(str()),
      })),
      flows: arr(obj({ flow: str(), runs: int, failed: int, seconds: Sampled, costUsd: num, chargedUsd: num })),
      days: arr(obj({ day: str("YYYY-MM-DD"), runs: int, failed: int, costUsd: num, chargedUsd: num })),
      failures: arr(obj({ runId: str(), flow: str(), agent: str(), at: str(), attempts: int, text: str("the last error the step recorded") })),
      startup: arr(obj({ phase: str(), took: Sampled, at: Sampled }), "where steps' first seconds went, phase by phase"),
    }),
  },
  "GET /api/workspaces/{workspace}/pause": {
    response: obj(PauseView),
  },
  "POST /api/workspaces/{workspace}/pause": {
    body: obj({
      reason: str("up to 300 characters"),
      stop: { ...bool, description: "true also stops every running, queued or waiting run here (needs run:start)" },
    }),
    response: obj({
      ok: bool, ...PauseView,
      stopped: arr(str(), "<workspace>/<runId> of each run stopped"),
      failed: arr(obj({ runId: str(), workspace: str(), error: str() }), "runs that could not be stopped"),
    }),
  },
  "DELETE /api/workspaces/{workspace}/pause": {
    noBody: "Resumes this workspace; the account's own pause, if any, still holds.",
    response: obj({ ok: bool, ...PauseView }),
  },
  "GET /api/workspaces/{workspace}/proposals": {
    query: [
      { name: "status", description: "drafting | ready | failed | applying | applied | partial | dismissed" },
      { name: "eval", description: "only proposals for this eval" },
    ],
    response: obj({ proposals: arr(Proposal, "newest first, each settled as it is read") }),
  },
  "GET /api/workspaces/{workspace}/proposals/{id}": {
    response: Proposal,
  },
  "POST /api/workspaces/{workspace}/proposals/{id}": {
    body: obj({ action: str("apply (write its files, each a revision by the caller) | dismiss (set it aside)") }, ["action"]),
    response: Proposal,
  },
  "POST /api/workspaces/{workspace}/restore": {
    body: obj({
      to: str("a revision id, a deploy's commit or its prefix, an ISO date/time (the last revision at or before it) or an age: 90m, 12h, 3d, 2w"),
      dryRun: { ...bool, description: "true: what would change, with diffs; nothing written" },
      confirm: str("the workspace's name, typed back — required to restore"),
      expectRemoved: arr(str(), "the removals the dry run showed and a person accepted"),
    }, ["to"]),
    response: obj({
      dryRun: { ...bool, description: "a dry run: the plan's fields (workspace, files, blockedBy, issues, warnings) come with it" },
      ...RestorePlan,
      ok: { ...bool, description: "a restore: it went through (or there was nothing to do)" },
      applied: bool,
      noop: { ...bool, description: "nothing to do: the workspace already matches that point" },
      main: nullable(str("the workspace's head revision now")),
    }),
  },
  "GET /api/workspaces/{workspace}/runtimes": {
    response: obj({
      workspace: str(),
      runtimes: arr(obj({
        fingerprint: str("identifies one distinct runtime"),
        agents: arr(str(), "the agents that need it"),
        python: nullable(str()), packages: arr(str(), "pip"), npm: arr(str()), system: arr(str(), "apt"),
        rejected: arr(str(), "entries refused as written"),
        state: str("ready | failed | building | pending | on first run"),
        error: nullable(str("the installer's error when it failed")),
        at: nullable(str("when the last build finished")),
      })),
    }),
  },
  "GET /api/workspaces/{workspace}/shares": {
    response: obj({ ok: bool, shares: arr(Share) }),
  },
  "POST /api/workspaces/{workspace}/shares": {
    body: obj({
      path: str("the file to share: workspace-relative, a stored file or one in the folder"),
      ttlDays: nullable({ ...num, description: "days until it expires; default 7, null never" }),
    }, ["path"]),
    response: obj({ ok: bool, url: str("the public link"), token: str(), id: str("sh_… — the handle a list shows"), path: str(), contentType: str(), expiresAt: nullable(str()) }),
  },
  "DELETE /api/workspaces/{workspace}/shares": {
    query: [
      { name: "token", description: "the link to revoke; only a link of this workspace" },
      { name: "id", description: "or its sh_… id, as a list gives it (wins over token)" },
    ],
    noBody: "The link is named by ?token= or ?id=.",
    response: obj({ ok: bool, revoked: { ...bool, description: "false when it was unknown, another workspace's, or already revoked" } }),
  },
  "GET /api/workspaces/{workspace}/storage": {
    response: obj({
      files: arr(FileRecord, "newest first"),
      driver: str("fs | s3"),
      used: { ...int, description: "bytes held, distinct blobs counted once" },
      quotaMb: num, maxMb: { ...num, description: "the per-file limit" },
    }),
  },
  "POST /api/workspaces/{workspace}/storage": {
    body: obj({
      path: str("where it goes under storage/"),
      sha: str("sha256 of the bytes already PUT to the presigned URL"),
      size: { ...int, description: "bytes; required, but the record takes the length the store reports" },
    }, ["path", "sha", "size"]),
    response: obj({ file: FileRecord }),
  },
  "PUT /api/workspaces/{workspace}/storage": {
    query: [{ name: "path", description: "where it goes under storage/ (required)" }],
    noBody: "The request body is the file's raw bytes, not JSON — any content type, not empty, within the per-file limit.",
    response: obj({ file: FileRecord }),
  },
  "DELETE /api/workspaces/{workspace}/storage": {
    query: [{ name: "path", description: "the file to delete (required)" }],
    noBody: "The file is named by ?path=.",
    response: OK,
  },
  "GET /api/workspaces/{workspace}/storage/download": {
    query: [
      { name: "path", description: "the stored file (required)" },
      { name: "inline", description: "1: show it rather than save it — images, and md/txt/csv/json as plain text, served from here; video, audio and PDF as themselves (with byte ranges, 206)" },
    ],
    media: {
      type: "application/octet-stream",
      description: "The file's bytes as an attachment (Content-Disposition: attachment, sandboxed CSP; never rendered as a page). On an object store it answers 302 to a short-lived signed URL instead. With inline=1: an image or plain text inline, or video/audio/PDF with Accept-Ranges (206 for a Range).",
    },
  },
  "GET /api/workspaces/{workspace}/storage/preview": {
    query: [{ name: "path", description: "the stored file (required); 413 over 25 MB" }],
    response: Preview,
  },
  "POST /api/workspaces/{workspace}/storage/upload-url": {
    body: obj({
      path: str("where it goes under storage/"),
      sha: str("sha256 of the file — the object's key"),
      size: { ...int, description: "its length in bytes: checked against the limits and signed into the URL; optional for older clients" },
    }, ["path", "sha"]),
    response: obj({ url: nullable(str("a presigned PUT, then POST ../storage to register it; null: no object store — PUT the bytes to ../storage?path= instead")) }),
  },
  "POST /api/workspaces/{workspace}/tools/{tool}/test": {
    body: obj({
      path: str("http tool: the path to try, appended to base:"),
      args: { type: "object", additionalProperties: str(), description: "script tool: values for its declared args:" },
    }),
    response: ToolTestResult,
  },
  "GET /api/workspaces/{workspace}/triggers": {
    query: [
      { name: "days", description: "the window in days, 1–365 (default 7)" },
      { name: "since", description: "the older spelling of days" },
    ],
    response: obj({
      days: int,
      flows: arr(obj({
        flow: str(), trigger: str(),
        fired: int, started: int,
        dropped: arr(obj({ outcome: str(TriggerOutcome), count: int, detail: str() }), "every outcome that was not a start, biggest first"),
        lastFiredAt: nullable(str()), lastStartedAt: nullable(str()),
      })),
      events: arr(obj({
        t: str(), flow: str(), trigger: str("schedule | webhook | storage | watch | flow | email | …"),
        outcome: str(TriggerOutcome), detail: str("the sentence a person reads, naming the key that decided"), runId: str(),
      }), "the raw decisions in the window, newest first, at most 200"),
      deliveries: arr(obj({
        t: str(), flow: str(),
        outcome: str("accepted | invalid-token | invalid-signature | not-webhook | no-flow | error | dropped"),
        runId: str(), bytes: int, detail: str(),
        count: { ...int, description: "a run of refusals collapsed: how many; absent is one" }, first: str("when the first of them came"),
      }), "inbound webhook requests, newest first, at most 50 — whether a request reached us and was authentic"),
    }),
  },
  "GET /api/workspaces/{workspace}/vocabulary": {
    response: obj({
      agents: arr(str()), flows: arr(str()), skills: arr(str()), tools: arr(str()),
      secrets: arr(str(), "names only, never values"),
      scripts: arr(str(), "prefixed: workspace/scripts/…, account/scripts/…, scripts/… (an agent's own)"),
      types: arr(str(), "OKF type: values already used here"),
      docs: arr(obj({ name: str("what goes between [[ ]]"), hint: str() }), "what [[ ]] reaches besides agents and flows: knowledge, memory, state/ and storage/ files"),
      models: arr(obj({ id: str(), hint: str("price and context") }), "the gateway's catalogue, when a provider: with a baseUrl is declared"),
    }, ["agents", "flows", "skills", "tools", "secrets", "scripts", "types"]),
  },
};

