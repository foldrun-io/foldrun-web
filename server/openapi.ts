// The OpenAPI 3.1 document served at /api/openapi.json.
//
// Paths and methods come from server/openapi-routes.ts, which
// scripts/gen-openapi.mjs writes from the route files themselves (and the
// one-line descriptions in foldrun-docs/api.md) — so the spec cannot drift
// from what the server answers; tests/openapi.test.ts fails when it would.
//
// Request and response schemas are written here for the routes people call
// most, from what those handlers actually validate. Every other operation
// gets the generic object schema: an honest "JSON, see the docs" is better
// than an invented shape a code generator would trust.

import { ROUTES as ALL_ROUTES } from "./openapi-routes.ts";
import { billing, freeBilling } from "@/platform/billing";
import { CURRENT_API_VERSION } from "./api-version.ts";

type Schema = Record<string, unknown>;

/** Routes that carry their own proof (a token in the URL, a signature) or
 *  none at all — everything else takes the bearer key or the session. */
const OPEN = [
  /^\/api\/healthz$/, /^\/api\/version$/, /^\/api\/openapi\.json$/,
  /^\/api\/status(\/history)?$/,
  /^\/api\/hooks\//, /^\/api\/inbox\//, /^\/api\/events\//, /^\/api\/approve\//, /^\/api\/unsubscribe$/,
  /^\/api\/billing\/stripe$/, /^\/api\/billing\/confirm$/,
  /^\/api\/auth\/(signup|login|forgot|reset|verify|mfa\/verify|session)$/, /^\/api\/cli\/login(\/\{id\})?$/, /^\/api\/oauth\/callback$/,
  /^\/s\//,
];
/** One method open on a path whose others are not. */
const OPEN_OPS = new Set(["GET /api/cli/authorize"]);
export const isOpen = (p: string, method?: string) => OPEN.some((r) => r.test(p)) || (method !== undefined && OPEN_OPS.has(`${method} ${p}`));

const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
});
const str = (description?: string): Schema => ({ type: "string", ...(description ? { description } : {}) });
const bool = { type: "boolean" };
const int = { type: "integer" };
const GENERIC: Schema = { type: "object", additionalProperties: true, description: "JSON — see docs/api.md for this route's fields" };

const Tokens: Schema = {
  ...obj({
    input: { ...int, description: "all input tokens, cache reads and writes included" },
    output: int,
    cacheRead: { ...int, description: "the part of input the prompt cache served (a tenth of the price); absent before 18 Oct 2026" },
    cacheWrite: { ...int, description: "the part of input written to the prompt cache; absent before 18 Oct 2026" },
  }),
  type: ["object", "null"],
};

// FOL-54 step 3: core issues.ts.
const IssueEvent = obj({ at: str(), by: str(), action: str("acknowledge | snooze | resolve | reopen"), until: str(), note: str() });
const Issue = obj({
  id: str(), kind: str("platform | failed | blocked | bad | missed"), status: str("open | acknowledged | snoozed | resolved"),
  regressed: { ...bool, description: "it was resolved before and came back" }, sinceRevision: { type: ["string", "null"], description: "the revision the first run of this episode ran" },
  snoozedFor: { type: ["integer", "null"], description: "snoozed until it happens this many more times" },
  workspace: str(), workspaces: { type: "array", items: str() }, what: str(), agent: { type: ["string", "null"] },
  reason: str(), action: str("what to do, in plain words"), firstSeen: str(), lastSeen: str(), count: int,
  runs: { type: "array", items: obj({ workspace: str(), id: str(), at: str() }) },
  recoveredAt: { type: ["string", "null"], description: "the flow's newest good run after the last occurrence; it closes nothing" },
  acknowledged: { type: ["object", "null"] }, snoozedUntil: { type: ["string", "null"] }, resolved: { type: ["object", "null"] },
  history: { type: "array", items: IssueEvent },
});

const Run = obj({
  id: str(), flow: str(), status: str("queued | running | awaiting-approval | completed | failed | stopped"),
  startedAt: str(), finishedAt: str(), test: bool,
  verdict: { type: ["string", "null"], description: "GOOD | QUIET | BLOCKED | BAD, the word the run's summary leads with; null for none" },
  outcome: str("in the runs list: running | queued | waiting | good | done | quiet | blocked | bad | failed | stopped — the one outcome every surface shows"),
  failure: { type: ["object", "null"], description: "in the runs list: { agent, reason } — the step that failed and its last error; null when none" },
  chargedUsd: { type: ["number", "null"], description: "in the runs list: what the account was charged for the run, in USD (one credit is one cent); null until the ledger settles it. costUsd is the token cost at the model's list price" },
  tokens: Tokens,
  steps: { type: "array", items: { ...obj({ tokens: Tokens }), additionalProperties: true } },
});

const EffectiveFlag = obj({
  name: str(), description: str(), owner: str(), default: bool, on: bool,
  source: str("account | global | rollout | default — what decided it"),
  rollout: { type: ["integer", "null"], description: "the rollout percentage in force, when one is" },
});

/** Hand-written shapes, by "METHOD path". */
const SHAPES: Record<string, { body?: Schema; response?: Schema; query?: { name: string; description: string }[] }> = {
  "GET /api/workspaces/{workspace}/runs": {
    query: [
      { name: "limit", description: "newest first; default 50, at most 500 — counted after the filters" },
      { name: "tool", description: "a step called a tool whose name contains this" },
      { name: "tool_error", description: "1: a tool call errored" },
      { name: "agent", description: "a step was this agent" },
      { name: "model", description: "a step ran a model whose name contains this" },
      { name: "min_tokens", description: "input tokens, all steps together (50000 or 50k)" },
      { name: "min_secs", description: "the run took at least this long" },
    ],
    response: obj({ runs: { type: "array", items: Run } }),
  },
  "GET /api/workspaces/{workspace}/runs/{runId}": {
    query: [{ name: "wait", description: "true blocks until the run stops or timeout" }, { name: "timeout", description: "seconds, default 300, max 900" }],
    response: Run,
  },
  "POST /api/workspaces/{workspace}/flows/{flow}/run": {
    body: obj({ task: str("delivered to the first step"), tags: { type: "array", items: str() }, from: int, test: bool }),
    response: obj({ ok: bool, runId: str(), steps: int, test: bool, started: bool, reason: str() }),
    query: [{ name: "wait", description: "true answers when the run stops" }],
  },
  "POST /api/workspaces/{workspace}/deploy": {
    body: obj(
      {
        files: { type: "object", additionalProperties: { type: "string" }, description: "path → content" },
        commit: { type: ["string", "null"] }, force: bool, dryRun: bool,
        expectRemoved: { type: "array", items: str(), description: "the removals a person confirmed" },
      },
      ["files"],
    ),
    response: obj({ ok: bool, applied: bool, issues: { type: "array", items: GENERIC }, removed: { type: "array", items: str() } }),
  },
  "GET /api/workspaces/{workspace}/check": {
    query: [
      { name: "security", description: "1 keeps the security categories: secret, security, content, supply-chain" },
      { name: "rule", description: "one rule id or category; repeatable or comma-separated" },
      { name: "online", description: "1 adds the network checks: known vulnerabilities for exact runtime pins (OSV) and remote MCP servers' tool text" },
    ],
    response: obj({
      workspace: str(),
      counts: obj({ error: int, warn: int, info: int }),
      findings: {
        type: "array",
        items: obj(
          { rule: str("e.g. secret/hardcoded"), level: str("error | warn | info"), file: str(), line: int, message: str(), fingerprint: str("stable across edits elsewhere in the file") },
          ["rule", "level", "file", "message", "fingerprint"],
        ),
      },
      rules: { type: "array", items: GENERIC },
      online: obj({ problems: { type: "array", items: str() }, sources: { type: "array", items: obj({ source: str("osv or mcp:<server>"), checked: bool, problem: str() }) } }),
      // null before a workspace's first rescan.
      rescan: { ...obj({ checkedAt: str(), findings: int, pending: int, problems: { type: "array", items: str() } }), type: ["object", "null"] },
    }),
  },
  "GET /api/workspaces/{workspace}/source": {
    query: [{ name: "path", description: "one file; omitted, the tree" }],
    response: obj({ path: str(), content: str(), sha256: str() }),
  },
  "PUT /api/workspaces/{workspace}/source": {
    body: obj(
      {
        path: str(),
        content: str(),
        message: str("the revision's note"),
        ifMatch: str("sha256 from a GET; 409 if the file changed"),
        check: { type: "boolean", description: "refuse (422, with the issues, nothing written) when the file has an error a deploy would refuse" },
      },
      ["path", "content"],
    ),
    response: obj({
      ok: bool,
      sha256: str(),
      issues: { type: "array", description: "the deploy's checks for this file, as it was saved: errors and warnings", items: obj({ level: str("error | warn"), rule: str(), where: str(), message: str() }) },
    }),
  },
  "PATCH /api/workspaces/{workspace}/source": { body: obj({ from: str(), to: str() }, ["from", "to"]) },
  "DELETE /api/workspaces/{workspace}/source": { body: obj({ path: str() }, ["path"]) },
  "PATCH /api/workspaces/{workspace}/agents/{agent}": {
    body: obj({
      list: obj({ key: str("subagents | agents | tools"), name: str(), action: str("add | remove") }),
      set: obj({ key: str("description | sandbox"), value: str("for sandbox: own | parent") }),
      network: {
        type: ["object", "string", "array", "null"],
        description: "the sites its sandbox may reach: open | trusted | none, a list of sites, or { level, allow, defaults }; null inherits",
      },
    }),
    response: obj({ ok: bool, changed: bool }),
  },
  "GET /api/secrets": {
    query: [{ name: "workspace", description: "that workspace's own store; omitted, the account's" }],
    response: obj({ secrets: { type: "array", items: obj({ name: str(), scope: str(), updatedAt: str(), health: GENERIC, sites: { type: "array", items: str(), description: "bound: filled by the egress proxy for these sites alone, never in a sandbox" } }) } }),
  },
  "PUT /api/secrets": {
    body: obj(
      {
        name: str(), value: str("write-only, never returned"), workspace: str(), oauth2: GENERIC, service_account: GENERIC, ssh: GENERIC, api: GENERIC, file: str(),
        sites: { type: "array", items: str(), description: "bind it to these sites as it is set (see PATCH)" },
      },
      ["name"],
    ),
    response: obj({ ok: bool, sites: { type: "array", items: str() } }),
  },
  "PATCH /api/secrets": {
    body: obj(
      { name: str(), sites: { type: "array", items: str(), description: "api.example.com or *.example.com; [] unbinds" }, workspace: str() },
      ["name", "sites"],
    ),
    response: obj({ ok: bool, name: str(), scope: str(), sites: { type: "array", items: str() } }),
  },
  "DELETE /api/secrets": { body: obj({ name: str(), workspace: str() }, ["name"]) },
  "POST /api/workspaces/{workspace}/runs/{runId}/rerun": {
    body: obj({
      step: { ...int, description: "1-based step to start from" },
      agent: str("or: the first step this agent runs"),
      instruction: str("what that step is told this once, in place of the flow's — the new run records it in rerunOf"),
    }),
    response: obj({ ok: bool, runId: str(), from: str(), steps: int }),
  },
  "GET /api/workspaces/{workspace}/runs/{runId}/compare": {
    query: [{ name: "with", description: "the run to compare with; unasked, the newest earlier run of the flow that finished well, else the run this one re-ran" }],
    response: obj({
      comparison: { ...GENERIC, description: "{ base, run, revisionChanged, changedFiles (null when unknown), steps: [{ step, agent, base, run, changes }] } — each side { status, instruction, model, secs, tokensIn, tokensOut, modelCalls, tools, toolErrors, errors, said }" },
      chosen: str("named | last good | re-run source"),
    }),
  },
  "GET /api/workspaces/{workspace}/runs/{runId}/trace": {
    response: obj({
      tree: { ...GENERIC, description: "TraceSpan: { id, kind (run | step | model | tool | error), label, start, end (epoch ms), status (ok | error | running | waiting | skipped | pending), tokens?, costUsd?, model?, stop?, call?, captured?, text?, subagent?, step?, children }" },
      failure: { type: "array", items: str(), description: "span ids from the root to the first thing that went wrong; [] when nothing did" },
    }),
  },
  "GET /api/workspaces/{workspace}/runs/{runId}/calls/{callId}": {
    response: obj({
      call: obj({
        id: str("the tool call's id (the event's `call`)"), tool: str(),
        input: str("what the tool was given, secrets masked, at most 65,536 characters"), output: str("what it gave back, the same"),
        inputChars: { ...int, description: "the whole input's length in characters, before the cap" }, outputChars: int,
        truncated: bool, inputCut: { ...bool, description: "this part was cut to the cap" }, outputCut: bool,
      }),
    }),
  },
  "GET /api/insights": {
    query: [
      { name: "days", description: "the window, 1–30 (default 7)" },
      { name: "workspace", description: "only this workspace" },
    ],
    response: obj({
      days: int,
      insights: {
        type: "array",
        items: obj({
          id: str(), kind: str("cache | big-result | retry-loop | timeout"), workspace: str(), agent: str(), tool: str(),
          title: str(), why: str(), fix: str(), credits: { type: ["integer", "null"], description: "about how many credits it cost in the window" }, steps: int,
          evidence: { type: "array", items: obj({ workspace: str(), runId: str(), step: int }) },
        }),
      },
    }),
  },
  "GET /api/issues": {
    query: [
      { name: "status", description: "active (default: open + acknowledged) | open | acknowledged | snoozed | resolved | all" },
      { name: "workspace", description: "only issues that hit this workspace" },
    ],
    response: obj({ issues: { type: "array", items: Issue } }),
  },
  "GET /api/issues/{id}": { response: obj({ issue: Issue }) },
  "POST /api/issues/{id}": {
    body: obj(
      {
        action: str("acknowledge | snooze | resolve | reopen"),
        for: str("a snooze: 30m, 4h, 1d, 1w"),
        times: { ...int, description: "a snooze: until it happens this many more times (1–1000); with for/until, whichever comes first" },
        until: str("a snooze: a future time, ISO — instead of for"),
        note: str("kept in the history, at most 500 characters"),
      },
      ["action"],
    ),
    response: obj({ issue: Issue }),
  },
  "GET /api/keys": {
    response: obj({ keys: { type: "array", items: obj({ id: str(), prefix: str(), label: str(), role: str(), workspaces: { type: ["array", "null"], items: str() }, createdAt: str(), revokedAt: { type: ["string", "null"] } }) } }),
  },
  "POST /api/keys": {
    body: obj({ label: str(), role: str("viewer | editor | admin"), workspaces: { type: ["array", "null"], items: str() }, workspace: str("refused: deploy keys went with the platform's own git (17 Oct 2026)"), access: str("refused, as workspace") }),
    response: obj({ ok: bool, key: str("shown once"), id: str(), prefix: str(), role: str(), workspaces: { type: ["array", "null"], items: str() } }),
  },
  "DELETE /api/keys": { body: obj({ id: str() }, ["id"]) },
  "POST /api/team": {
    body: obj({
      role: str("viewer | editor | admin, default editor; admin only by the owner"),
      workspaces: { type: ["array", "null"], items: str(), description: "names, or omit / null for all — never wider than your own scope" },
      email: { type: ["string", "null"], description: "the one address that may accept it; omit for a link anyone may use, once" },
      send: { ...bool, description: "false: do not mail it, only return the link" },
    }),
    response: obj({
      ok: bool,
      id: str("the invite's id — GET/DELETE /api/team/invites"),
      role: str(),
      workspaces: { type: ["array", "null"], items: str() },
      email: { type: ["string", "null"] },
      path: str("the invite's relative URL; shown once — it works once, for seven days"),
      expires: str(),
      sent: { type: ["boolean", "null"] },
      sendError: { type: ["string", "null"] },
    }),
  },
  "GET /api/team/invites": {
    query: [{ name: "all", description: "1: accepted, revoked and expired invites too; pending only by default" }],
    response: obj({
      invites: {
        type: "array",
        items: obj({
          id: str(),
          email: { type: ["string", "null"], description: "the address it is for; null for a link anyone may use, once" },
          role: str("viewer | editor | admin"),
          workspaces: { type: ["array", "null"], items: str(), description: "null for every workspace" },
          invitedBy: str("who made it"),
          createdAt: str(),
          expiresAt: str(),
          status: str("pending | accepted | revoked | expired"),
        }),
      },
    }),
  },
  "DELETE /api/team/invites/{id}": {
    response: obj({ ok: bool, revoked: { ...bool, description: "false when it was already revoked or expired" }, invite: GENERIC }),
  },
  "GET /api/usage/compute": {
    response: obj({
      compute: obj({
        vcpu: { type: ["number", "null"], description: "cores all running steps may hold together; null is no cap" },
        memGiB: { type: ["number", "null"], description: "GiB all running steps may hold together; null is no cap" },
        stepVcpu: { type: ["number", "null"], description: "the most one step may hold, in cores" },
        stepMemGiB: { type: ["number", "null"], description: "the most one step may hold, in GiB" },
        diskGiB: { type: ["number", "null"], description: "GiB of disk (ephemeral-storage limits) all running steps may be allowed together; null is no cap" },
        stepDiskGiB: { type: ["number", "null"], description: "the most disk one step may be allowed, in GiB" },
        source: { type: ["string", "null"], description: "plan | account | install, or null with no pool" },
      }),
      inUse: obj({ vcpu: { type: "number" }, memGiB: { type: "number" }, diskGiB: { type: "number" }, steps: { type: "integer" } }),
      workspaces: {
        type: "array",
        description: "each workspace the caller sees: its own pool (its AGENTS.md compute:, null figures for none) and what its running steps hold",
        items: obj({
          workspace: { type: "string" },
          pool: obj({ vcpu: { type: ["number", "null"] }, memGiB: { type: ["number", "null"] }, diskGiB: { type: ["number", "null"] } }),
          inUse: obj({ vcpu: { type: "number" }, memGiB: { type: "number" }, diskGiB: { type: "number" }, steps: { type: "integer" } }),
        }),
      },
      runs: {
        type: "array",
        description: "live runs with a pool of their own (their flow's compute:) or anything held",
        items: obj({
          workspace: { type: "string" },
          runId: { type: "string" },
          flow: { type: "string" },
          pool: obj({ vcpu: { type: ["number", "null"] }, memGiB: { type: ["number", "null"] }, diskGiB: { type: ["number", "null"] } }),
          inUse: obj({ vcpu: { type: "number" }, memGiB: { type: "number" }, diskGiB: { type: "number" }, steps: { type: "integer" } }),
        }),
      },
      waiting: {
        type: "array",
        description: "steps waiting for room to start, oldest first — in a driver or with their run in the queue; a wait never fails a step",
        items: obj({
          workspace: { type: "string" },
          runId: { type: "string" },
          flow: { type: "string" },
          step: { type: "integer", description: "its index in the run's steps" },
          agent: { type: "string" },
          since: { type: "string", description: "when it first found no room — its place in line" },
          why: { type: "string" },
          cpus: { type: "number" },
          memGiB: { type: "number" },
          diskGiB: { type: "number" },
          level: { type: "string", description: "run | workspace | account | node — the cap that held it when it last looked; absent when it waited its turn" },
          runPool: obj({ vcpu: { type: ["number", "null"] }, memGiB: { type: ["number", "null"] }, diskGiB: { type: ["number", "null"] } }),
        }),
      },
    }),
  },
  "GET /api/usage": {
    response: obj({
      tenant: { type: "string" },
      generatedAt: { type: "string" },
      totals: GENERIC,
      workspaces: { type: "array", items: GENERIC },
      ledger: obj({
        balanceUsd: { type: "number", description: "the account's balance" },
        chargedUsd: { type: "number", description: "what the account has been charged for runs, all time" },
      }),
      waived: { type: "array", items: { type: "string" } },
    }),
  },
  "GET /api/billing": { response: obj({ balance: { type: "number" }, balanceUsd: { type: "number" }, notices: { type: "array", items: { type: "string" } }, entries: { type: "array", items: GENERIC } }) },
  "POST /api/billing/checkout": { body: obj({ usd: { type: "number" } }, ["usd"]), response: obj({ url: str() }) },
  "POST /api/billing/portal": { body: obj({ returnTo: str() }), response: obj({ url: str() }) },
  "POST /api/billing/subscribe": { body: obj({ plan: str("starter | creator | pro | scale"), resume: bool }), response: obj({ url: str(), changed: bool }) },
  "GET /api/account/api": {
    response: obj({
      version: obj({ current: str(), pinned: { type: ["string", "null"] }, effective: str(), supported: { type: "array", items: str() }, supportMonths: int }),
      limits: obj({ plan: str(), windowSeconds: int, perCredential: obj({ read: int, write: int }), perAccount: obj({ read: int, write: int }) }),
    }),
  },
  "PATCH /api/account/api": { body: obj({ version: { type: ["string", "null"], description: "YYYY-MM-DD, or null for current" } }, ["version"]) },
  "GET /api/account/flags": { response: obj({ flags: { type: "array", items: EffectiveFlag } }) },
};

const rl = (d: string): Schema => ({ description: d, schema: { type: "integer" } });
const RATE_HEADERS = {
  "X-RateLimit-Limit": { $ref: "#/components/headers/X-RateLimit-Limit" },
  "X-RateLimit-Remaining": { $ref: "#/components/headers/X-RateLimit-Remaining" },
  "X-RateLimit-Reset": { $ref: "#/components/headers/X-RateLimit-Reset" },
  "Foldrun-Version": { $ref: "#/components/headers/Foldrun-Version" },
};

/** The routes this build serves: an install without foldrun's billing has
 *  no /api/billing, so its spec does not offer it. The operator console's
 *  routes are never in it (scripts/gen-openapi.mjs leaves them out). */
const ROUTES = billing() === freeBilling ? ALL_ROUTES.filter((r) => !/^\/api\/billing(\/|$)/.test(r.path)) : ALL_ROUTES;

const IDEMPOTENT_ROUTES = new Set(ROUTES.flatMap((r) => (r.idempotent ?? []).map((m) => `${m} ${r.path}`)));

/** Statuses a route answers by design that the general rules above do not
 *  cover — found by the API fuzz (quality/fuzz.sh, 27 Oct 2026). */
const EXTRA_STATUSES: Record<string, string[]> = {
  // An unknown or spent sign-in code.
  "GET /api/cli/authorize": ["404"],
  // Closed (404) while FOLDRUN_METRICS_TOKEN is unset.
  "GET /api/metrics": ["404"],
  // Nothing to fix, a proposal for that eval already open, or paused.
  "POST /api/workspaces/{workspace}/evals/{evalName}/improve": ["409"],
  // The file changed since it was loaded (body.ifMatch is not its sha256).
  "PUT /api/workspaces/{workspace}/source": ["409"],
  // No secret by that name.
  "PATCH /api/secrets": ["404"],
};

export function openapiDocument(origin?: string): Schema {
  const paths: Record<string, Record<string, Schema>> = {};
  for (const r of ROUTES) {
    const item: Record<string, Schema> = {};
    const params = [...r.path.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    for (const method of r.methods) {
      if (method === "HEAD") continue;
      const shape = SHAPES[`${method} ${r.path}`];
      const open = isOpen(r.path, method);
      const parameters: Schema[] = [
        ...params,
        ...(shape?.query ?? []).map((q) => ({ name: q.name, in: "query", required: false, description: q.description, schema: { type: "string" } })),
        { $ref: "#/components/parameters/FoldrunVersion" },
      ];
      if (IDEMPOTENT_ROUTES.has(`${method} ${r.path}`)) parameters.push({ $ref: "#/components/parameters/IdempotencyKey" });
      const op: Schema = {
        operationId: `${method.toLowerCase()}${r.path.replace(/[{}]/g, "").replace(/[^a-zA-Z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ""))}`,
        summary: r.summary ? r.summary.split(/[.;—]/)[0].trim().slice(0, 120) : `${method} ${r.path}`,
        ...(r.summary ? { description: r.summary } : {}),
        tags: [tagOf(r.path)],
        parameters,
        ...(open ? { security: [] } : {}),
        ...(shape?.body && method !== "GET" ? { requestBody: { required: true, content: { "application/json": { schema: shape.body } } } } : {}),
        responses: {
          "200": { description: "OK", headers: RATE_HEADERS, content: { "application/json": { schema: shape?.response ?? GENERIC } } },
          "400": { $ref: "#/components/responses/Error" },
          ...(open ? {} : { "401": { $ref: "#/components/responses/Error" }, "403": { $ref: "#/components/responses/Error" } }),
          // A route that names something in its path can find nothing there
          // (27 Oct 2026: the API fuzz found 26 undocumented 404s).
          ...(params.length ? { "404": { $ref: "#/components/responses/Error" } } : {}),
          // An open route that carries a token in its path refuses a bad one.
          ...(open && params.length ? { "401": { $ref: "#/components/responses/Error" } } : {}),
          ...Object.fromEntries((EXTRA_STATUSES[`${method} ${r.path}`] ?? []).map((c) => [c, { $ref: "#/components/responses/Error" }])),
          "429": { $ref: "#/components/responses/RateLimited" },
          ...(IDEMPOTENT_ROUTES.has(`${method} ${r.path}`) ? { "422": { $ref: "#/components/responses/Error" } } : {}),
        },
      };
      item[method.toLowerCase()] = op;
    }
    paths[r.path] = item;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "foldrun API",
      version: CURRENT_API_VERSION,
      description:
        "Every route under /api. Authenticate with `Authorization: Bearer <key>` (Settings → API keys). " +
        "Pin a version with `Foldrun-Version: YYYY-MM-DD`. Writes that start work accept `Idempotency-Key`. " +
        "See docs/api-usage.md for rate limits, errors and pagination.",
    },
    ...(origin ? { servers: [{ url: origin }] } : {}),
    security: [{ bearer: [] }],
    paths,
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "An API key from Settings → API keys (mda_…)" },
      },
      parameters: {
        FoldrunVersion: {
          name: "Foldrun-Version", in: "header", required: false,
          description: `The API version to answer under (YYYY-MM-DD). Omitted: the account's pin for an API key, else ${CURRENT_API_VERSION}; a signed-in dashboard always gets ${CURRENT_API_VERSION}. Unknown → 400 with \`code\` and \`known\`.`,
          schema: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        },
        IdempotencyKey: {
          name: "Idempotency-Key", in: "header", required: false,
          description: "Up to 255 characters. The same key and body within 24h replays the first answer (Idempotent-Replayed: true); a different body is a 422.",
          schema: { type: "string", maxLength: 255 },
        },
      },
      headers: {
        "X-RateLimit-Limit": rl("Requests allowed in this window, for the bucket closest to its limit"),
        "X-RateLimit-Remaining": rl("Requests left in this window"),
        "X-RateLimit-Reset": rl("When the window resets, Unix seconds"),
        "Foldrun-Version": { description: "The API version this response was answered under", schema: { type: "string" } },
      },
      schemas: {
        Error: obj(
          {
            error: str(),
            code: str("Where a caller can act on it: `unknown_api_version` (this server does not answer that Foldrun-Version) or `bad_api_version` (not a YYYY-MM-DD date)"),
            known: { type: "array", items: { type: "string" }, description: "With an API-version refusal: the versions this server answers" },
          },
          ["error"],
        ),
        RateLimited: obj({ error: str(), retry_after: int }, ["error", "retry_after"]),
      },
      responses: {
        Error: { description: "A refusal, with a sentence saying why", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        RateLimited: {
          description: "Over the rate limit — wait Retry-After seconds",
          headers: { "Retry-After": { schema: { type: "integer" } }, ...RATE_HEADERS },
          content: { "application/json": { schema: { $ref: "#/components/schemas/RateLimited" } } },
        },
      },
    },
  };
}

function tagOf(p: string): string {
  const m = p.match(/^\/api\/workspaces\/\{workspace\}\/([a-z-]+)/);
  if (m) return m[1];
  if (p === "/api/workspaces" || p === "/api/workspaces/{workspace}") return "workspaces";
  if (p.startsWith("/s/")) return "shares";
  return p.split("/")[2] ?? "api";
}
