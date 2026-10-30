// The OpenAPI 3.1 document served at /api/openapi.json.
//
// Paths and methods come from server/openapi-routes.ts, which
// scripts/gen-openapi.mjs writes from the route files themselves (and the
// one-line descriptions in foldrun-docs/api.md) — so the spec cannot drift
// from what the server answers; tests/openapi.test.ts fails when it would.
//
// Request and response schemas: every operation has one (30 Oct 2026), in
// server/openapi-shapes/<group>.ts, written from what the handler validates
// and answers — or a sentence saying why it has none (tests/openapi-coverage
// .test.ts). The API guard (scripts/api-guard.mjs) can only protect fields a
// schema names, which is why they matter.

import { ROUTES as ALL_ROUTES } from "./openapi-routes.ts";
import { billing, freeBilling } from "@/platform/billing";
import { CURRENT_API_VERSION } from "./api-version.ts";

import { type Schema, type Shape, obj, str, bool, int, GENERIC, Issue, Run, EffectiveFlag } from "./openapi-shapes/kit.ts";
import { GROUP_SHAPES } from "./openapi-shapes/index.ts";

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

/** GET /api/account/api (server/api-facts.ts apiFactsFor). */
const AccountApi = obj({
  version: obj({ current: str(), pinned: { type: ["string", "null"] }, effective: str(), supported: { type: "array", items: str() }, supportMonths: int }),
  limits: obj({ plan: str(), windowSeconds: int, perCredential: obj({ read: int, write: int }), perAccount: obj({ read: int, write: int }) }),
  usage: {
    ...obj({
      days: int,
      versions: { type: "array", items: obj({ version: str(), requests: int, lastSeen: str() }) },
      deprecated: {
        type: "array",
        items: obj({
          route: str(), requests: int, lastSeen: str(),
          callers: { type: "array", items: obj({ credential: str("who called: a key's prefix or a person"), requests: int, lastSeen: str() }) },
          deprecatedAt: { type: ["string", "null"] }, sunsetAt: { type: ["string", "null"] }, link: { type: ["string", "null"] },
        }),
        description: "deprecated routes the account still calls",
      },
    }),
    type: ["object", "null"],
    description: "the account's API use over the last 30 days; null to a caller limited to some workspaces (it names who calls each route), or when it could not be read",
  },
  usageHidden: { ...bool, description: "true: usage is withheld because the caller is limited to some workspaces" },
});

/** Written before the per-group files (kept as they were). */
const LEGACY_SHAPES: Record<string, Shape> = {
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
        // An array of { path, content } — the route refuses anything else. It
        // was documented as a path → content map until 30 Oct 2026 (a
        // SCHEMA_CORRECTIONS entry in server/api-version.ts says so).
        files: { type: "array", items: obj({ path: str(), content: str() }, ["path", "content"]), description: "every file of the workspace; at most 10 MB of content in all" },
        commit: { type: ["string", "null"] }, force: bool, dryRun: bool,
        expectRemoved: { type: "array", items: str(), description: "the removals a person confirmed" },
      },
      ["files"],
    ),
    response: obj({
      ok: bool, applied: bool,
      issues: { type: "array", items: GENERIC, description: "dry run: { where, message } the deploy would refuse on" },
      removed: { type: "array", items: str() },
      added: { type: "array", items: str() }, updated: { type: "array", items: str() },
      warnings: { type: "array", items: obj({ where: str(), message: str() }) },
      blockedBy: { type: "array", items: str(), description: "dry run: runs in flight that would block the swap" },
      commit: { type: ["string", "null"], description: "applied: the commit the workspace now runs, when known" },
      preserved: { ...int, description: "applied: files kept that the deploy does not own (state, memory, storage)" },
    }),
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
    response: obj({
      path: str("with ?path="), content: str("with ?path="), sha256: str("with ?path=: what PUT's ifMatch takes"),
      files: { type: "array", items: str(), description: "without ?path=: every file's workspace-relative path (runs/ and outputs/ left out)" },
    }),
  },
  "PUT /api/workspaces/{workspace}/source": {
    body: obj(
      {
        path: str(),
        content: str(),
        message: str("the revision's note"),
        ifMatch: { type: ["string", "null"], description: "sha256 from a GET; null: the caller saw no file there. 409 (with the current sha256, or null) if that is no longer so" },
        check: { type: "boolean", description: "refuse (422, with the issues, nothing written) when the file has an error a deploy would refuse" },
      },
      ["path", "content"],
    ),
    response: obj({
      ok: bool,
      path: str(),
      sha256: str(),
      issues: { type: "array", description: "the deploy's checks for this file, as it was saved: errors and warnings", items: obj({ level: str("error | warn"), rule: str(), where: str(), message: str() }) },
    }),
  },
  "PATCH /api/workspaces/{workspace}/source": {
    body: { ...obj({ from: str(), to: str() }, ["from", "to"]), description: "rename a file; both paths pass the same gate as a write" },
    response: obj({ ok: bool, path: str("the new path") }),
  },
  "DELETE /api/workspaces/{workspace}/source": { body: obj({ path: str("a file or a folder") }, ["path"]), response: obj({ ok: bool }) },
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
    response: obj({
      secrets: {
        type: "array",
        items: obj({
          name: str(), scope: str("account | workspace"), updatedAt: str(),
          kind: str("oauth2 | service_account | file | ssh | api | client_cert | identity — absent for a plain value"),
          shadowed: { ...bool, description: "with ?workspace: this workspace's own entry hides an account secret of the same name" },
          health: { ...GENERIC, type: ["object", "null"], description: "how the credential fared where it was last used; null before anything used it" },
          sites: { type: "array", items: str(), description: "bound: filled by the egress proxy for these sites alone, never in a sandbox" },
          workspaces: { type: "array", items: str(), description: "an account secret limited to these workspaces (listed without ?workspace); absent: every workspace" },
        }),
      },
    }),
  },
  "PUT /api/secrets": {
    body: obj(
      {
        name: str(), value: str("write-only, never returned"), workspace: str("that workspace's own store; omitted, the account's"),
        oauth2: GENERIC, service_account: GENERIC, ssh: GENERIC, api: GENERIC,
        client_cert: { ...GENERIC, description: "a client certificate for mutual TLS: { cert, key, passphrase?, export? }" },
        identity: { ...GENERIC, description: "a keyless cloud identity: { audience }" },
        file: str(),
        scopes: str("with oauth2: the scopes consented to, kept for reconnecting"),
        refresh_token_expires_in: { ...int, description: "with oauth2: seconds the refresh token lasts" },
        sites: { type: "array", items: str(), description: "bind it to these sites as it is set (see PATCH)" },
        workspaces: { type: ["array", "null"], items: str(), description: "an ACCOUNT secret limited to these existing workspaces, sealed with the value in one write; null for every workspace. Not with workspace" },
      },
      ["name"],
    ),
    response: obj({
      ok: bool, name: str(), scope: str("account | workspace"),
      sites: { type: "array", items: str(), description: "when sites was sent" },
      workspaces: { type: ["array", "null"], items: str(), description: "when workspaces was sent" },
    }),
  },
  "PATCH /api/secrets": {
    body: {
      ...obj(
        {
          name: str(),
          sites: { type: "array", items: str(), description: "api.example.com or *.example.com; [] unbinds. The secret must exist in that scope" },
          workspaces: { type: ["array", "null"], items: str(), description: "limits an ACCOUNT secret to these existing workspaces; null opens it to every workspace, [] to none. Not with workspace, and only by a caller who holds every workspace" },
          workspace: str("that workspace's own store (sites only); omitted, the account's"),
          ifWorkspaces: { type: ["array", "null"], items: str(), description: "the list you last saw — refused with 409 if it changed meanwhile" },
        },
        ["name"],
      ),
      description: "sites, workspaces, or both — at least one",
    },
    response: obj({
      ok: bool, name: str(), scope: str("account | workspace"),
      sites: { type: "array", items: str(), description: "when sites was sent: the binding now" },
      workspaces: { type: ["array", "null"], items: str(), description: "when workspaces was sent: the limit now; null is every workspace" },
    }),
  },
  "DELETE /api/secrets": { body: obj({ name: str(), workspace: str() }, ["name"]), response: obj({ ok: bool }) },
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
    response: obj({
      keys: {
        type: "array",
        items: obj({
          id: str(), prefix: str(), label: str(), tenant: str(), role: str(), workspaces: { type: ["array", "null"], items: str() },
          createdAt: str(), createdBy: str(), revokedAt: { type: ["string", "null"] },
          expiresAt: { type: ["string", "null"], description: "when it stops working; null never" },
          lastUsedAt: { type: ["string", "null"] }, lastIp: { type: ["string", "null"], description: "coarse: an IPv4 /24 or IPv6 /48" },
          expiryWarnedAt: { type: ["string", "null"] },
          replacedBy: { type: ["string", "null"], description: "the key that replaced it in a rotation" },
          origin: str("cli-login when `foldrun login` minted it; absent otherwise"),
        }),
      },
    }),
  },
  "POST /api/keys": {
    body: obj({
      label: str(), role: str("viewer | editor | admin"), workspaces: { type: ["array", "null"], items: str() },
      expires: { type: ["string", "integer", "null"], description: "30d, 90d, 365d, a number of days (1–3650), or never / null" },
      workspace: str("refused: deploy keys went with the platform's own git (17 Oct 2026)"), access: str("refused, as workspace"),
    }),
    response: obj({ ok: bool, key: str("shown once"), id: str(), prefix: str(), role: str(), workspaces: { type: ["array", "null"], items: str() }, expiresAt: { type: ["string", "null"] } }),
  },
  "DELETE /api/keys": { body: obj({ id: str("a key may always revoke itself") }, ["id"]), response: obj({ ok: bool }) },
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
      ledger: {
        ...obj({
          balanceUsd: { type: "number", description: "the account's balance" },
          chargedUsd: { type: "number", description: "what the account has been charged for runs, all time" },
        }),
        type: ["object", "null"],
        description: "null for a caller limited to some workspaces: the wallet and the account-wide charge are not theirs to read",
      },
      waived: { type: ["array", "null"], items: { type: "string" }, description: "models | compute | network — legs the bill leaves out; null for a caller limited to some workspaces" },
    }),
  },
  "GET /api/billing": {
    response: obj({
      enabled: { ...bool, description: "billing is on for this install" },
      balanceUsd: { type: "number", description: "the account's credit, in USD (one credit is one cent)" },
      fullyWaived: { ...bool, description: "every leg is waived by the operator — the balance never stops a run" },
      notices: { type: "array", items: { type: "string" }, description: "what the account should be told, worded by the server" },
      entries: { type: "array", items: GENERIC, description: "the newest 100 ledger lines, newest first; a caller limited to some workspaces sees only theirs" },
    }),
  },
  "POST /api/billing/checkout": { body: obj({ usd: { type: "number" } }, ["usd"]), response: obj({ url: str() }) },
  "POST /api/billing/portal": { body: obj({ returnTo: str() }), response: obj({ url: str() }) },
  "POST /api/billing/subscribe": {
    body: obj({ plan: str("starter | creator | pro | scale"), resume: bool }),
    response: obj({
      ok: bool,
      url: str("Stripe Checkout, when the plan starts with a card"),
      changed: { ...bool, description: "the plan was switched in place" },
      resumed: { ...bool, description: "a plan set to stop was resumed" },
      unchanged: { ...bool, description: "already on that plan" },
      plan: str("the plan now in force"),
    }),
  },
  "GET /api/account/api": { response: AccountApi },
  "PATCH /api/account/api": {
    body: obj({ version: { type: ["string", "null"], description: "YYYY-MM-DD, or null for current" } }, ["version"]),
    response: { ...AccountApi, description: "the same as GET, as the whole account sees it (only a caller who holds every workspace may PATCH)" },
  },
  "GET /api/account/flags": { response: obj({ flags: { type: "array", items: EffectiveFlag } }) },
};

/** Every operation's shape: the ones above, then each group's file. A key in
 *  two places is a mistake — the later one would silently win. */
export const SHAPES: Record<string, Shape> = (() => {
  const out: Record<string, Shape> = { ...LEGACY_SHAPES };
  for (const group of GROUP_SHAPES) {
    for (const [op, shape] of Object.entries(group)) {
      if (op in out) throw new Error(`openapi: ${op} has two shapes`);
      out[op] = shape;
    }
  }
  return out;
})();

/** The operations this build serves, as "METHOD /path" (HEAD left out). */
export function documentedOperations(): string[] {
  return ROUTES.flatMap((r) => r.methods.filter((m) => m !== "HEAD").map((m) => `${m} ${r.path}`));
}

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
  "PATCH /api/secrets": ["404", "409"],
  // Renaming onto a taken name, or a secret limited to this workspace that
  // cannot be read (409); the vault could not be updated (503).
  "PATCH /api/workspaces/{workspace}": ["409", "503"],
  "DELETE /api/workspaces/{workspace}": ["409", "503"],
  // A sign-in code older than five minutes can no longer be approved.
  "POST /api/cli/authorize": ["410"],
  // The install sends no mail (code mail_not_configured), or it is already your address.
  "POST /api/auth/email": ["409"],
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
          ...successOf(shape),
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

/** The success response: JSON by default; a media type, an empty 204 or a
 *  302 redirect where the shape says so. */
function successOf(shape: Shape | undefined): Record<string, Schema> {
  const status = shape?.status ?? "200";
  if (status === "204") return { "204": { description: "Done — no body", headers: RATE_HEADERS } };
  if (status.startsWith("3")) return { [status]: { description: shape?.media?.description ?? "A redirect", headers: { Location: { schema: { type: "string" } } } } };
  if (shape?.media) {
    const schema = shape.media.schema ?? { type: "string", format: "binary" };
    return { [status]: { description: shape.media.description ?? "OK", headers: RATE_HEADERS, content: { [shape.media.type]: { schema } } } };
  }
  return { [status]: { description: "OK", headers: RATE_HEADERS, content: { "application/json": { schema: shape?.response ?? GENERIC } } } };
}

function tagOf(p: string): string {
  const m = p.match(/^\/api\/workspaces\/\{workspace\}\/([a-z-]+)/);
  if (m) return m[1];
  if (p === "/api/workspaces" || p === "/api/workspaces/{workspace}") return "workspaces";
  if (p.startsWith("/s/")) return "shares";
  return p.split("/")[2] ?? "api";
}
