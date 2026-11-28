// The OpenAPI 3.1 document served at /v1/openapi.json.
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
import { CURRENT_API_VERSION, deprecationFor } from "./api-version.ts";

import { type Schema, type Shape, obj, str, bool, int, arr, GENERIC, Issue, Run, EffectiveFlag } from "./openapi-shapes/kit.ts";

/** The account's beta and its beta flags (app/v1/account/beta). */
const BetaView = obj({
  beta: { type: "boolean", description: "whether the account is in the beta" },
  flags: arr(obj({ name: str(), description: str(), on: bool, source: str("account | global | beta | rollout | default") }), "the beta flags, as they stand for this account"),
}, ["beta", "flags"]);

/** What revoking a deleted or replaced oauth2 secret's tokens at its
 *  provider came to (RFC 7009); absent when there was nothing to revoke. */
const OAuthRevoked: Schema = {
  type: "object",
  description: "revoking the old oauth2 grant at the provider (RFC 7009): skipped (no-revocation-url, shared-grant, same-app, unreadable), revoked (token types the provider accepted), error (reported; the write still happened)",
  properties: {
    skipped: { type: "string", enum: ["no-revocation-url", "shared-grant", "same-app", "unreadable"] },
    revoked: { type: "array", items: { type: "string", enum: ["refresh_token", "access_token"] } },
    error: { type: "string" },
  },
};
import { GROUP_SHAPES } from "./openapi-shapes/index.ts";
import { jsonOnly } from "./csrf.ts";

/** Routes that carry their own proof (a token in the URL, a signature) or
 *  none at all — everything else takes the bearer key or the session. */
const OPEN = [
  /^\/v1\/healthz$/, /^\/v1\/version$/, /^\/v1\/openapi\.json$/,
  /^\/v1\/status(\/history)?$/,
  /^\/v1\/signup$/, /^\/v1\/pricing$/,
  /^\/v1\/hooks\//, /^\/v1\/inbox\//, /^\/v1\/events\//, /^\/v1\/approve\//, /^\/v1\/unsubscribe$/,
  /^\/v1\/billing\/stripe$/, /^\/v1\/billing\/confirm$/,
  // A storefront's HMAC signature (X-Foldrun-Partner/Timestamp/Signature), never a key.
  /^\/v1\/billing\/partner\//,
  /^\/v1\/auth\/(signup|login|forgot|reset|verify|mfa\/verify)$/, /^\/v1\/cli\/login(\/\{id\})?$/, /^\/v1\/oauth\/callback$/,
  /^\/s\//,
];
/** One method open on a path whose others are not. */
const OPEN_OPS = new Set(["GET /v1/cli/authorize", "GET /v1/auth/session"]);
export const isOpen = (p: string, method?: string) => OPEN.some((r) => r.test(p)) || (method !== undefined && OPEN_OPS.has(`${method} ${p}`));

/** GET /v1/account/api (server/api-facts.ts apiFactsFor). */
const AccountApi = obj({
  version: obj({ current: str(), pinned: { type: ["string", "null"] }, effective: str(), supported: { type: "array", items: str() }, supportMonths: int }),
  limits: obj({ plan: str(), windowSeconds: int, perCredential: obj({ read: int, write: int }), perAccount: obj({ read: int, write: int }) }),
  urls: obj({ api: { type: ["string", "null"], description: "where programs call: keys, the CLI, Claude Code (FOLDRUN_PUBLIC_API_URL); null: the dashboard's address answers them" }, app: { type: ["string", "null"], description: "the dashboard's address (FOLDRUN_PUBLIC_URL)" } }),
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

const nstr = (description?: string): Schema => ({ type: ["string", "null"], ...(description ? { description } : {}) });
const nullable = (s: Schema): Schema => ({ ...s, type: [s.type as string, "null"] });

/** The two pots of an account's balance, USD (7 Nov 2026). */
const CreditPots: Schema = obj({
  planUsd: { type: "number", description: "plan credits: pay for compute, storage and network, never tokens on foldrun's models" },
  boughtUsd: { type: "number", description: "bought credits: pay for anything, tokens on foldrun's models included" },
});

const PlanTermsProps: Record<string, Schema> = {
  id: str(), name: str(), feeUsd: { type: "number" }, creditsPerMonth: int,
  rollover: { ...bool, description: "unused plan credits carry into the next month" },
  rolloverCapCredits: { ...int, description: "the most a rollover keeps; 0 without" },
  storageGb: int,
  computeAtOnce: obj({ vcpu: { type: "number" }, memGiB: { type: "number" } }),
  lane: str("normal | fast"),
  paysForTokens: { ...bool, description: "whether plan credits pay for tokens on foldrun's models: true once one wallet is on (FOL-384), false before" },
};

const MeterRatesSchema: Schema = obj({
  creditUsd: { type: "number" }, vcpuUsdPerHour: { type: "number" }, ramUsdPerGibHour: { type: "number" },
  diskUsdPerGibMonth: { type: "number" }, storageUsdPerGbMonth: { type: "number" }, networkUsdPerGb: { type: "number" },
  margin: { type: "number", description: "the multiple on provider token prices on foldrun's models" },
});

const PricingCatalogueSchema: Schema = obj({
  version: { ...int, description: "the settings version the figures were read at" },
  creditUsd: { type: "number" },
  plans: arr(obj(PlanTermsProps), "the old platform plans still sold: none since 27 Nov 2026"),
  subscriptions: arr(obj({
    id: str("starter | pro | max"), name: str(), priceUsd: { type: "number", description: "thirty days, USD — the console's gateway.plan_<size>_usd" },
    periodDays: int,
    model: obj({ weekUsd: { type: ["number", "null"], description: "the model allowance in a 7-day window, USD at list prices" }, monthUsd: { type: ["number", "null"], description: "the same for the 30-day period" } }),
    storageGb: { type: "number", description: "GB of stored files the size includes; beyond it storage is charged by the GB-month" },
    fable: { type: "boolean", description: "Fable models are inside the allowance (Max only)" },
    upgradeTo: { type: ["string", "null"], description: "the size one up; null at the top" },
  }), "the one subscription's sizes on sale, smallest first; a size the console has no price for is not listed"),
  contact: obj({ label: str() }),
  meters: arr(obj({ meter: str("vcpu | ram | disk | storage | network"), unit: str(), usd: { type: "number" }, over: str("what the rate applies over, when it is not every unit") })),
  tools: arr(obj({
    tool: str("web_search | web_fetch | web_browse | extract | docs"), unit: str("call, browser-minute, page, …"), usd: { type: "number", description: "USD per unit, the console's pricing.tool_*" },
    minimum: str("the least charged, e.g. 1 minute"), charged: { type: "boolean", description: "false: listed, not charged yet" },
  }), "the platform tools' prices; a failed call is free"),
  example: obj({ name: str(), vcpu: { type: "number" }, memGiB: { type: "number" }, creditsPerHour: { type: "number" } }),
  models: obj({
    margin: { type: "number" }, providers: arr(str()), soon: arr(str(), "providers on their way"),
    prices: arr(obj({ provider: str(), model: str(), inputPerMTok: { type: "number" }, outputPerMTok: { type: "number" }, cacheReadPerMTok: { type: ["number", "null"] }, cacheWritePerMTok: { type: ["number", "null"] } })),
  }),
});

/** Written before the per-group files (kept as they were). */
const LEGACY_SHAPES: Record<string, Shape> = {
  "GET /v1/workspaces/{workspace}/runs": {
    query: [
      { name: "limit", description: "newest first; default 50, at most 500 — counted after the filters" },
      { name: "tool", description: "a step called a tool whose name contains this" },
      { name: "tool_error", description: "1: a tool call errored" },
      { name: "agent", description: "a step was this agent" },
      { name: "model", description: "a step ran a model whose name contains this" },
      { name: "min_tokens", description: "input tokens, all steps together (50000 or 50k)" },
      { name: "min_secs", description: "the run took at least this long" },
      { name: "context", description: "the runs of one conversation: its context id, exactly (FOL-162)" },
      { name: "customer", description: "the runs for one end customer, exactly (FOL-168)" },
      { name: "before", description: "the next page: the `next` of the page before (a cursor, <startedAt>~<runId>), a time (runs that started before it) or a run id of this workspace (runs older than it); a cursor that is neither is a 400" },
    ],
    response: obj({
      runs: { type: "array", items: Run },
      next: { type: ["string", "null"], description: "pass as before= for the page after this one; null when no older run matches" },
    }),
  },
  "GET /v1/workspaces/{workspace}/runs/{runId}": {
    query: [{ name: "wait", description: "true blocks until the run stops or timeout" }, { name: "timeout", description: "seconds, default 300, max 900" }],
    response: {
      ...Run,
      properties: {
        ...(Run as { properties: Record<string, unknown> }).properties,
        chargedUsd: { type: ["number", "null"], description: "what the account was charged for it (the ledger's line, USD); null until the run settles — the worker settles it as it ends, an hourly pass retries one that failed to" },
        estimatedUsd: { type: "number", description: "what it costs at foldrun's list price — the figure until it settles" },
        settled: { type: "boolean", description: "chargedUsd is final" },
      },
    },
  },
  "POST /v1/workspaces/{workspace}/flows/{flow}/run": {
    body: obj({ task: str("delivered to the first step"), tags: { type: "array", items: str() }, from: int, test: bool, context: str("a conversation this run is a turn of: 1–200 printable ASCII characters; its first step reads the earlier runs of the same context (FOL-162). Not with from"), customer: str("which of your own users this run is for (FOL-168): an opaque id, 1–128 of letters, digits and . _ : @ -; never personal data. Limits and blocks follow it, and the model provider is told a hash of it as its end-user id"), inputs: { type: "array", items: str(), description: "files to hand the run: storage paths, as GET …/storage lists them — at most 20, 100 MiB together; staged at agents/<name>/inputs/ for the first step; not with from, held as they are now (FOL-163). Needs the k8s or container sandbox (409 otherwise); 404 names a path with no stored file" } }),
    response: obj({ ok: bool, runId: str(), steps: int, test: bool, started: bool, reason: str(), context: str("the context, when one was given"), inputs: { type: "array", items: str(), description: "the storage paths it was handed, when any" }, customer: str("the end customer, when one was named") }),
    query: [{ name: "wait", description: "true answers when the run stops" }],
  },
  "POST /v1/workspaces/{workspace}/deploy": {
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
      policy: { ...obj({ status: int, code: str("a2a_widening | a2a_secret_code | a2a_accept_risk, when the refusal has one"), error: str() }), description: "dry run: why the real deploy would be refused by the workspace's policy — a policy key or a2a: past an editor, an agent widened behind a published flow, a secret-and-code agent with no accept_risk. Absent when it would not be" },
    }),
  },
  "GET /v1/workspaces/{workspace}/check": {
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
  "GET /v1/workspaces/{workspace}/source": {
    query: [{ name: "path", description: "one file; omitted, the tree" }],
    response: obj({
      path: str("with ?path="), content: str("with ?path="), sha256: str("with ?path=: what PUT's ifMatch takes"),
      files: { type: "array", items: str(), description: "without ?path=: every file's workspace-relative path (runs/ and outputs/ left out)" },
    }),
  },
  "PUT /v1/workspaces/{workspace}/source": {
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
  "PATCH /v1/workspaces/{workspace}/source": {
    body: { ...obj({ from: str(), to: str() }, ["from", "to"]), description: "rename a file; both paths pass the same gate as a write" },
    response: obj({ ok: bool, path: str("the new path") }),
  },
  "DELETE /v1/workspaces/{workspace}/source": { body: obj({ path: str("a file or a folder") }, ["path"]), response: obj({ ok: bool }) },
  "POST /v1/workspaces/{workspace}/source/share": {
    body: obj(
      {
        path: str("a skill, tool, script, knowledge or memory file; skills/x/SKILL.md or tools/x/tool.md (or the folder) moves the whole folder"),
        overwrite: { ...bool, description: "replace library files already at those paths (refused otherwise)" },
        dryRun: { ...bool, description: "answer what would move; nothing is written" },
      },
      ["path"],
    ),
    response: obj({
      ok: bool,
      kind: str("skills | tools | scripts | knowledge | memory"),
      unit: str("what moved: the folder, or the one file"),
      files: arr(obj({ from: str("its path in the workspace"), to: str("its path under the library's kind"), replaces: bool })),
      moved: { ...bool, description: "false for a dry run" },
    }),
  },
  "PATCH /v1/workspaces/{workspace}/agents/{agent}": {
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
  "GET /v1/secrets": {
    query: [{ name: "workspace", description: "that workspace's own store; omitted, the account's" }],
    response: obj({
      secrets: {
        type: "array",
        items: obj({
          name: str(), scope: str("account | workspace"), updatedAt: str(),
          kind: str("oauth2 | service_account | file | ssh | api | client_cert | identity | token-exchange — absent for a plain value"),
          shadowed: { ...bool, description: "with ?workspace: this workspace's own entry hides an account secret of the same name" },
          health: { ...GENERIC, type: ["object", "null"], description: "how the credential fared where it was last used; null before anything used it" },
          sites: { type: "array", items: str(), description: "bound: filled by the egress proxy for these sites alone, never in a sandbox" },
          workspaces: { type: "array", items: str(), description: "an account secret limited to these workspaces (listed without ?workspace); absent: every workspace" },
        }),
      },
    }),
  },
  "PUT /v1/secrets": {
    body: obj(
      {
        name: str(), value: str("write-only, never returned"), workspace: str("that workspace's own store; omitted, the account's"),
        oauth2: { ...GENERIC, description: "a refresh recipe: { token_url, client_id, client_secret?, refresh_token?, grant_type? (refresh_token or client_credentials), extra?, token_auth? (client_secret_post, client_secret_basic, none or private_key_jwt; absent is the form body), client_assertion_key? / _kid? / _alg? / _cert? (private_key_jwt), generate_key? (private_key_jwt with no key: one is made and its public_jwk answered), revocation_url?, dpop? (true: a DPoP key is made for it), dpop_key?, tls_client_cert? / tls_client_key? / tls_client_passphrase? (tls_client_auth) }" },
        service_account: GENERIC, ssh: GENERIC, api: GENERIC,
        client_cert: { ...GENERIC, description: "a client certificate for mutual TLS: { cert, key, passphrase?, export? }" },
        identity: { ...GENERIC, description: "a keyless cloud identity: { audience }" },
        token_exchange: { ...GENERIC, description: "token exchange (RFC 8693): { token_url, client_id, client_secret?, token_auth?, subject_secret (another secret's name), subject_token_type?, requested_token_type?, audience?, resource?, scope? }" },
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
      revoked: OAuthRevoked,
      public_jwk: { type: "object", additionalProperties: true, description: "an oauth2 recipe with private_key_jwt: the public key to register with the provider" },
    }),
  },
  "PATCH /v1/secrets": {
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
  "DELETE /v1/secrets": { body: obj({ name: str(), workspace: str() }, ["name"]), response: obj({ ok: bool, revoked: OAuthRevoked }) },
  "POST /v1/workspaces/{workspace}/runs/{runId}/rerun": {
    body: obj({
      step: { ...int, description: "1-based step to start from" },
      agent: str("or: the first step this agent runs"),
      instruction: str("what that step is told this once, in place of the flow's — the new run records it in rerunOf"),
    }),
    response: obj({ ok: bool, runId: str(), from: str(), steps: int }),
  },
  "GET /v1/workspaces/{workspace}/runs/{runId}/compare": {
    query: [{ name: "with", description: "the run to compare with; unasked, the newest earlier run of the flow that finished well, else the run this one re-ran" }],
    response: obj({
      comparison: { ...GENERIC, description: "{ base, run, revisionChanged, changedFiles (null when unknown), steps: [{ step, agent, base, run, changes }] } — each side { status, instruction, model, secs, tokensIn, tokensOut, modelCalls, tools, toolErrors, errors, said }" },
      chosen: str("named | last good | re-run source"),
    }),
  },
  "GET /v1/workspaces/{workspace}/runs/{runId}/trace": {
    response: obj({
      tree: { ...GENERIC, description: "TraceSpan: { id, kind (run | step | model | tool | error), label, start, end (epoch ms), status (ok | error | running | waiting | skipped | pending), tokens?, costUsd?, model?, stop?, call?, captured?, text?, subagent?, step?, children }" },
      failure: { type: "array", items: str(), description: "span ids from the root to the first thing that went wrong; [] when nothing did" },
    }),
  },
  "GET /v1/workspaces/{workspace}/runs/{runId}/calls/{callId}": {
    response: obj({
      call: obj({
        id: str("the tool call's id (the event's `call`)"), tool: str(),
        input: str("what the tool was given, secrets masked, at most 65,536 characters"), output: str("what it gave back, the same"),
        inputChars: { ...int, description: "the whole input's length in characters, before the cap" }, outputChars: int,
        truncated: bool, inputCut: { ...bool, description: "this part was cut to the cap" }, outputCut: bool,
      }),
    }),
  },
  "GET /v1/insights": {
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
  "GET /v1/issues": {
    query: [
      { name: "status", description: "active (default: open + acknowledged) | open | acknowledged | snoozed | resolved | all" },
      { name: "workspace", description: "only issues that hit this workspace" },
    ],
    response: obj({ issues: { type: "array", items: Issue } }),
  },
  "GET /v1/issues/{id}": { response: obj({ issue: Issue }) },
  "POST /v1/issues/{id}": {
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
  "GET /v1/keys": {
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
          purpose: str("a2a for an outside agent's key (it opens /a2a only); gateway for a coding agent's key (it opens the gateway only); absent for an API key"),
          gateway: {
            ...obj({
            capUsd: { type: ["number", "null"], description: "the most it may spend in all, USD; null none" },
            dailyUsd: { type: ["number", "null"], description: "the most it may spend per UTC day, USD; null none" },
            spentUsd: { type: "number", description: "what it has spent in all, USD (open calls at their estimate)" },
            todayUsd: { type: "number", description: "what it has spent today (UTC), USD" },
            credential: str("account: the plan first, then bought credits up to walletUsd; login: on this account's plan (not billed per call; no spend shown); absent: the plan first too, then bought credits up to capUsd/dailyUsd alone (no wallet budget of its own)"),
            walletUsd: { type: "number", description: "an account key: the most bought credits may pay for its calls, USD; 0 the plan only" },
            walletSpentUsd: { type: "number", description: "an account key: what bought credits have paid for its calls, USD" },
            models: obj({ opus: str(), sonnet: str(), haiku: str() }),
            principal: str("an API key with model access: the first key of its rotation chain — its spend is counted there, so a rotation keeps it"),
          }),
            description: "a gateway key's grant; on an API key (no purpose), its model access — the same key also calls foldrun's models within these limits",
          },
          a2a: obj({ workspace: str(), flows: arr(str()), principal: str("the first key of its rotation chain — the owner of its tasks"), maxTasks: int }),
        }),
      },
      gatewayUrl: { type: ["string", "null"], description: "where a coding agent points ANTHROPIC_BASE_URL with a gateway key; null where this install has no gateway" },
    }),
  },
  "POST /v1/keys": {
    body: obj({
      label: str(), role: str("viewer | editor | admin"), workspaces: { type: ["array", "null"], items: str() },
      expires: { type: ["string", "integer", "null"], description: "30d, 90d, 365d, a number of days (1–3650), or never / null" },
      workspace: str("with purpose: a2a, the A2A key's one workspace; otherwise refused: deploy keys went with the platform's own git (17 Oct 2026)"), access: str("refused, as workspace"),
      purpose: str("a2a: mint a key for an outside agent — it opens /a2a/<account>/<workspace>/… for `flows` and no /v1 route. gateway: mint a key for a coding agent such as Claude Code (ANTHROPIC_BASE_URL + this key) — it spends the account's balance on the platform's Anthropic models through the gateway and opens no /v1 route; needs capUsd or dailyUsd, and an admin of every workspace"),
      capUsd: { type: "number", description: "purpose: gateway — the most the key may spend in all, USD (above 0, at most 100000)" },
      dailyUsd: { type: "number", description: "purpose: gateway — the most the key may spend per UTC day, USD" },
      requireCustomer: bool,
      credential: str("purpose: gateway — account: the plan pays while it has room, then bought credits up to walletUsd (needs capUsd or dailyUsd); login: on the operator's own Claude login, for an account the operator allows its credential; not metered, takes no capUsd/dailyUsd; absent: the plan first too, then bought credits up to capUsd/dailyUsd alone"),
      walletUsd: { type: "number", description: "credential: account — the most bought credits may pay for this key's calls, USD, 0 (the plan only; the default) to 100000" },
      models: { ...obj({ opus: str(), sonnet: str(), haiku: str() }), description: "purpose: gateway — which model each Claude Code tier runs on with this key, e.g. { sonnet: openai/gpt-6 }" },
      flows: arr(str(), "purpose: a2a — the flows it may call (each must also be published with a2a:)"),
      maxTasks: { ...int, description: "purpose: a2a — its tasks open at once, 1–100 (default 10)" },
      modelAccess: {
        ...obj({
          dailyUsd: { type: "number", description: "the most its model calls may spend per UTC day, USD" },
          capUsd: { type: "number", description: "the most its model calls may spend in all, USD" },
          walletUsd: { type: "number", description: "the most bought credits may pay for its model calls, USD; 0 (the plan only; the default) to 100000" },
        }),
        description: "an API key (no purpose) that may also call foldrun's models with the same secret — dailyUsd or capUsd required; the plan pays first, then bought credits up to walletUsd. Only an admin of every workspace, on the hosted platform",
      },
    }),
    response: obj({
      ok: bool, key: str("shown once"), id: str(), prefix: str(), role: str(), workspaces: { type: ["array", "null"], items: str() }, expiresAt: { type: ["string", "null"] },
      purpose: str("a2a, for an A2A key; gateway, for a gateway key"), workspace: str("an A2A key's workspace"), flows: arr(str()), maxTasks: int,
      capUsd: { type: ["number", "null"], description: "a gateway key's total limit" }, dailyUsd: { type: ["number", "null"], description: "a gateway key's daily limit" },
      gatewayUrl: { type: ["string", "null"], description: "a gateway key: its ANTHROPIC_BASE_URL" },
      credential: str("a login gateway key: login; an account key: account"),
      walletUsd: { type: "number", description: "an account key's wallet budget, USD" },
      modelAccess: { ...obj({ capUsd: { type: ["number", "null"] }, dailyUsd: { type: ["number", "null"] }, walletUsd: { type: "number" } }), description: "an API key made with modelAccess: its limits" },
    }),
  },
  "DELETE /v1/keys": { body: obj({ id: str("a key may always revoke itself") }, ["id"]), response: obj({ ok: bool }) },
  "POST /v1/team": {
    body: obj({
      role: str("viewer | editor | admin, default editor; admin only by the owner"),
      workspaces: { type: ["array", "null"], items: str(), description: "names, or omit / null for all — never wider than your own scope" },
      email: { type: ["string", "null"], description: "the one address that may accept it; omit for a link anyone may use, once" },
      send: { ...bool, description: "false: do not mail it, only return the link" },
    }),
    response: obj({
      ok: bool,
      id: str("the invite's id — GET/DELETE /v1/team/invites"),
      role: str(),
      workspaces: { type: ["array", "null"], items: str() },
      email: { type: ["string", "null"] },
      path: str("the invite's relative URL; shown once — it works once, for seven days"),
      expires: str(),
      sent: { type: ["boolean", "null"] },
      sendError: { type: ["string", "null"] },
    }),
  },
  "GET /v1/team/invites": {
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
  "DELETE /v1/team/invites/{id}": {
    response: obj({ ok: bool, revoked: { ...bool, description: "false when it was already revoked or expired" }, invite: GENERIC }),
  },
  "GET /v1/account/usage/compute": {
    response: obj({
      compute: obj({
        vcpu: { type: ["number", "null"], description: "cores all running steps may hold together; null is no cap" },
        memGiB: { type: ["number", "null"], description: "GiB all running steps may hold together; null is no cap" },
        stepVcpu: { type: ["number", "null"], description: "the most one step may hold, in cores" },
        stepMemGiB: { type: ["number", "null"], description: "the most one step may hold, in GiB" },
        diskGiB: { type: ["number", "null"], description: "GiB of disk (ephemeral-storage limits) all running steps may be allowed together; null is no cap" },
        stepDiskGiB: { type: ["number", "null"], description: "the most disk one step may be allowed, in GiB" },
        source: { type: ["string", "null"], description: "plan | account | install, or null with no pool" },
        stepDefault: { type: "array", items: { type: "string" }, description: "the step figures (stepVcpu, stepMemGiB, stepDiskGiB) that are the default for an account whose plan sets none — on the hosted platform the entry plan's; absent when none is" },
      }),
      inUse: obj({ vcpu: { type: "number" }, memGiB: { type: "number" }, diskGiB: { type: "number" }, steps: { type: "integer" } }),
      runsWaiting: obj({
        waiting: { type: ["integer", "null"], description: "the account's runs waiting for their turn now — lined up, back for room, or out of a gate and waiting for a worker (not those asleep on a wait: timer); null for a caller scoped to some workspaces" },
        limit: { type: ["integer", "null"], description: "new runs are refused (409, code waiting_cap) while this many wait; null is no limit" },
        source: { type: ["string", "null"], description: "install (FOLDRUN_MAX_WAITING_RUNS) | plan (the account's plan sets it) | derived (20 × slots, at least 50) | null" },
        slots: { type: "integer", description: "with derived: the runs at once the limit was worked from" },
      }, ["limit", "source"]),
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
  "GET /v1/account/usage": {
    query: [
      { name: "from", description: "first UTC day of the period, YYYY-MM-DD; default the first of this month. Bounds tokens, compute and billed, not totals or workspaces" },
      { name: "to", description: "last UTC day of the period, YYYY-MM-DD; default today. At most a year after from" },
    ],
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
      period: obj({ from: str("YYYY-MM-DD"), to: str("YYYY-MM-DD"), basis: str("consumption — priced at today's rates; `billed` is what the ledger charged") }),
      credits: {
        ...obj({
          unit: str("credit"),
          usdPerCredit: { type: "number" },
          pots: CreditPots,
          plan: nullable({ ...obj({ ...PlanTermsProps, status: { type: ["string", "null"], description: "active | past_due | cancelled" }, resetsAt: nstr("when the monthly grant next lands, or the plan's credits renew") }) }),
          boughtOldestExpiresAt: nstr("when the oldest bought credit still unspent expires"),
        }),
        type: ["object", "null"],
        description: "the two credit pots and the plan; null for a caller limited to some workspaces, and where nothing is billed",
      },
      tokens: obj({
        totals: obj({ calls: int, billedCredits: { type: "number" }, byokTokens: { ...int, description: "tokens used on the account's own keys, billed nothing here" } }),
        byModel: arr(obj({
          supply: str("foldrun (the platform's keys, billed) | operator (the operator's key, billed) | own (the account's own key, 0 billed)"),
          provider: str(), model: str(), calls: int,
          inputTokens: int, cacheReadTokens: int, cacheWriteTokens: int, outputTokens: int,
          billedCredits: { type: "number", description: "0 on the account's own key" },
          providerCostUsd: { type: "number", description: "foldrun's models: the provider's price before the margin" },
          estimatedCalls: { ...int, description: "calls charged at an estimate because no usage came back" },
          billedNote: str("why the row is billed nothing, when it is"),
        })),
      }),
      compute: obj({
        meters: arr(obj({
          meter: str("vcpu | ram | disk | storage | network | search | browser | warm (the last three are the account's pods, charged for the vCPU and GiB they hold while they live and the bytes they move; warm is the runtime build when a workspace is deployed)"),
          quantity: { type: ["number", "null"] }, unit: str(),
          rateCreditsPerUnit: { type: ["number", "null"], description: "credits per unit; null where nothing is priced" },
          credits: { type: "number" },
          includedGb: { type: "number", description: "storage: the plan's allowance" },
          overGb: { type: "number", description: "storage: GB over it, which is what is charged" },
          basis: str("storage: where the figure was measured (filesystem | revisions)"),
          sessions: { ...int, description: "pods: sessions in the period" },
          networkGb: { type: "number", description: "pods: GB the pods moved, charged inside the pod line" },
          note: str("pods: who pays and why"),
        })),
        planFee: { ...nullable(obj({ usd: { type: "number" }, credits: { type: "number" }, label: str(), includedCredits: { type: "number" } })), description: "the monthly plan fee as its own line; null for a caller limited to some workspaces and on Free" },
        bySize: arr(obj({
          size: str("small | large | heavy | unrecorded"), steps: int, hours: { type: "number" },
          vcpu: { type: "number" }, memGiB: { type: "number" }, diskGiB: { type: "number" },
          creditsPerHour: { type: ["number", "null"] },
        })),
      }),
      billed: {
        ...obj({ totalCredits: { type: "number", description: "what the ledger charged over the period" }, waived: { type: "array", items: { type: "string" } } }),
        type: ["object", "null"],
        description: "null for a caller limited to some workspaces",
      },
    }),
  },
  "GET /v1/account/usage/rates": {
    response: obj({
      rates: { ...nullable(MeterRatesSchema), description: "what the account is charged now; null where nothing is billed" },
      plan: { ...nullable(obj({ ...PlanTermsProps, status: { type: ["string", "null"] }, resetsAt: nstr() })), description: "the account's plan; null for a caller limited to some workspaces" },
      catalogue: { ...nullable(PricingCatalogueSchema), description: "the public catalogue" },
    }),
  },
  "GET /v1/pricing": {
    response: PricingCatalogueSchema,
  },
  "GET /v1/billing": {
    response: obj({
      enabled: { ...bool, description: "billing is on for this install" },
      balanceUsd: { type: "number", description: "the account's credit, in USD (one credit is one cent)" },
      fullyWaived: { ...bool, description: "every leg is waived by the operator — the balance never stops a run" },
      notices: { type: "array", items: { type: "string" }, description: "what the account should be told, worded by the server" },
      entries: { type: "array", items: GENERIC, description: "the newest 100 ledger lines, newest first; a caller limited to some workspaces sees only theirs" },
    }),
  },
  "POST /v1/billing/checkout": { body: obj({ usd: { type: "number" } }, ["usd"]), response: obj({ url: str() }) },
  "POST /v1/billing/portal": { body: obj({ returnTo: str() }), response: obj({ url: str() }) },
  "POST /v1/billing/subscribe": {
    body: obj({ plan: str("starter | pro | scale"), resume: bool }),
    response: obj({
      ok: bool,
      url: str("Stripe Checkout, when the plan starts with a card"),
      changed: { ...bool, description: "the plan was switched in place" },
      resumed: { ...bool, description: "a plan set to stop was resumed" },
      unchanged: { ...bool, description: "already on that plan" },
      plan: str("the plan now in force"),
    }),
  },
  "GET /v1/account/api": { response: AccountApi },
  "PATCH /v1/account/api": {
    body: obj({ version: { type: ["string", "null"], description: "YYYY-MM-DD, or null for current" } }, ["version"]),
    response: { ...AccountApi, description: "the same as GET, as the whole account sees it (only a caller who holds every workspace may PATCH)" },
  },
  "GET /v1/account/flags": { response: obj({ flags: { type: "array", items: EffectiveFlag } }) },
  "GET /v1/account/beta": { response: BetaView },
  "PUT /v1/account/beta": { body: obj({ beta: { type: "boolean", description: "true joins the beta, false leaves it" } }, ["beta"]), response: { ...BetaView, properties: { ...(BetaView.properties as Record<string, Schema>), changed: bool } } },
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
 *  no /v1/billing, so its spec does not offer it. The operator console's
 *  routes are never in it (scripts/gen-openapi.mjs leaves them out). */
const ROUTES = billing() === freeBilling ? ALL_ROUTES.filter((r) => !/^\/v1\/billing(\/|$)/.test(r.path)) : ALL_ROUTES;

/** Routes a browser session alone may call: a key is refused, so the spec
 *  names the cookie, not the bearer key every other route inherits. */
const SESSION_ONLY = new Set(["POST /v1/auth/session"]);

const IDEMPOTENT_ROUTES = new Set(ROUTES.flatMap((r) => (r.idempotent ?? []).map((m) => `${m} ${r.path}`)));

/** Statuses a route answers by design that the general rules above do not
 *  cover — found by the API fuzz (quality/fuzz.sh, 27 Oct 2026). */
const EXTRA_STATUSES: Record<string, string[]> = {
  // Past 64 KiB of upload (FOL-402, the road test).
  "POST /v1/network/bytes": ["413"],
  // An unknown or spent sign-in code.
  "GET /v1/cli/authorize": ["404"],
  // Nothing to fix, a proposal for that eval already open, or paused.
  "POST /v1/workspaces/{workspace}/evals/{evalName}/improve": ["409"],
  // The file changed since it was loaded (body.ifMatch is not its sha256).
  "PUT /v1/workspaces/{workspace}/source": ["409"],
  // Gone (FOL-75): removing a step is PATCH { edit }.
  "DELETE /v1/workspaces/{workspace}/flows/draft": ["410"],
  // Not there (404); a file the library cannot hold, or one already there without overwrite (409).
  "POST /v1/workspaces/{workspace}/source/share": ["404", "409"],
  // No secret by that name.
  "PATCH /v1/secrets": ["404", "409"],
  // Renaming onto a taken name, or a secret limited to this workspace that
  // cannot be read (409); the vault could not be updated (503).
  "PATCH /v1/workspaces/{workspace}": ["409", "503"],
  "DELETE /v1/workspaces/{workspace}": ["409", "503"],
  // A sign-in code older than five minutes can no longer be approved.
  "POST /v1/cli/authorize": ["410"],
  // The install sends no mail (code mail_not_configured), or it is already your address.
  "POST /v1/auth/email": ["409"],
  // A new run while the account has its most runs waiting (code
  // waiting_cap, FOL-100); a flow start also for overlap: skip. 402: every
  // new run is admitted against the balance and the `budget:` files
  // (platform queue.ts admitNow → reservations.ts), and refused past them.
  "POST /v1/workspaces/{workspace}/flows/{flow}/run": ["402", "409"],
  "POST /v1/workspaces/{workspace}/agents/{agent}/run": ["402", "409", "413", "503"],
  "POST /v1/workspaces/{workspace}/runs/{runId}/rerun": ["402", "409"],
  // The same waiting-cap refusal to a delivery is a 503 with Retry-After,
  // which a sender retries; out of funds or budget stays a 402.
  "POST /v1/hooks/{tenant}/{workspace}/{flow}": ["402", "503"],
  "POST /v1/inbox/{tenant}/{workspace}/{flow}": ["402", "503"],
  // A new workspace past the plan's workspace count (server/workspace-cap.ts).
  "POST /v1/workspaces": ["402"],
  "POST /v1/workspaces/{workspace}/deploy": ["402"],
  "POST /v1/workspaces/{workspace}/import": ["402"],
  // Found by the hosted fuzz run (FOL-199, 16 Nov 2026), each by design:
  // no saved OAuth client, gallery tool or workspace by the name in the body.
  "POST /v1/oauth/start": ["404"],
  "POST /v1/oauth/device": ["404"],
  "POST /v1/library/gallery": ["404"],
  // A skill, tool or hook by that name is already in the library.
  "POST /v1/library/{kind}": ["409"],
  // No saved OAuth client for the secret's provider (needsClient: true).
  "POST /v1/oauth/reconnect": ["404"],
  "GET /v1/me/onboarding": ["404"],
  // The flow is not a webhook flow (requireWebhookFlow).
  "GET /v1/workspaces/{workspace}/hooks/{flow}": ["409"],
  // No frame from the agent's browser yet: nothing to show.
  "GET /v1/workspaces/{workspace}/runs/{runId}/live": ["204"],
  // The run has already ended.
  "POST /v1/workspaces/{workspace}/runs/{runId}/stop": ["409"],
  // A mail that cannot be unsubscribed from (409); a spent token (410).
  "POST /v1/unsubscribe": ["409", "410"],
  // { async: true } answers 202 at once (21 Oct 2026); that eval already
  // running is a 409 naming the run to poll (FOL-199, hosted fuzz).
  "POST /v1/workspaces/{workspace}/evals/{evalName}/run": ["202", "409"],
  // A flow of that name already exists (FOL-199, hosted fuzz).
  "POST /v1/workspaces/{workspace}/flows": ["409"],
  // A mail that cannot be turned off, with the reason (FOL-199, hosted fuzz).
  "PATCH /v1/me/notifications": ["409"],
  // Every status a route file returns on purpose, from the sweep
  // tests/status-coverage.test.ts runs (FOL-199, 16 Nov 2026): each hosted
  // fuzz run found one more of these until they were listed together. A
  // "* path" entry applies to each method of that path. 5xx are not listed:
  // the fuzz reports a server error whatever the document says.
  "* /v1/billing/partner/plans": ["404"],
  "* /v1/billing/partner/topups/quote": ["404"],
  "* /v1/billing/partner/topups": ["404"],
  "* /v1/billing/stripe": ["404"],
  "* /v1/billing/subscribe": ["402", "404"],
  "* /v1/events/{tenant}/{workspace}/{runId}": ["409"],
  "* /v1/extract": ["411", "413"],
  "* /v1/oauth/clients": ["404"],
  "* /v1/oauth/discover": ["422"],
  "* /v1/pricing": ["204", "304", "404"],
  "* /v1/signup": ["204"],
  "* /v1/workspaces/{workspace}/agents/{agent}": ["409"],
  "* /v1/workspaces/{workspace}/agents": ["409"],
  "* /v1/workspaces/{workspace}/assets": ["409"],
  "* /v1/workspaces/{workspace}/deploy": ["409", "413"],
  "* /v1/workspaces/{workspace}/evals/{evalName}/compare": ["409"],
  "* /v1/workspaces/{workspace}/evals": ["409"],
  "* /v1/workspaces/{workspace}/flows/{flow}": ["409"],
  "* /v1/workspaces/{workspace}/import": ["411", "413"],
  "* /v1/workspaces/{workspace}/restore": ["409"],
  "* /v1/workspaces/{workspace}/runs/{runId}/answer": ["409", "413"],
  "* /v1/workspaces/{workspace}/runs/{runId}/archive": ["206", "416"],
  "* /v1/workspaces/{workspace}/runs/{runId}/message": ["409", "413"],
  "* /v1/workspaces/{workspace}/sessions/{context}/messages": ["201", "409", "503"],
  "* /v1/workspaces/{workspace}/sessions/{context}/messages/take": ["503"],
  "* /v1/workspaces/{workspace}/shares": ["409"],
  "* /v1/workspaces/{workspace}/snapshots": ["411", "413"],
  "* /v1/workspaces/{workspace}/source": ["422"],
  "* /v1/workspaces/{workspace}/storage/download": ["206", "416"],
  "* /v1/workspaces": ["409"],
  "* /v1/account/agents-md": ["409", "413"],
  "* /v1/account/model": ["409"],
  "* /v1/auth/login/code": ["404"],
  "* /v1/auth/login/code/verify": ["404"],
  "* /v1/auth/login": ["401"],
  "* /v1/auth/mfa/verify": ["401"],
  "* /v1/auth/sessions": ["409"],
  "* /v1/auth/signup": ["403"],
  "* /v1/avatars/{kind}/{id}": ["413"],
  "* /v1/billing/partner/plans/offer": ["404"],
  // A JSON-RPC notification has no reply: 202, no body (MCP Streamable HTTP).
  "POST /v1/mcp": ["202"],
};

/** A success status whose body is not the default one for that code. */
const EXTRA_SUCCESS_FOR: Record<string, Record<string, Schema>> = {
  "POST /v1/mcp": { "202": { description: "Accepted — a notification, nothing to send" } },
};

/** The success statuses in EXTRA_STATUSES, which are not refusals. */
const EXTRA_SUCCESS: Record<string, Schema> = {
  "204": { description: "Nothing to send" },
  "206": {
    description: "Part of the file (a Range request): those bytes, with Content-Range",
    // The file's own type (a PNG, a PDF, a video), so any (Codex review).
    content: { "*/*": { schema: { type: "string", format: "binary" } } },
  },
  "304": { description: "Not modified since the ETag sent" },
  // Not a success, but like these sent with no body: an empty answer with a
  // Content-Range of the file's size (Codex review).
  "416": { description: "The Range asked for is outside the file — no body; Content-Range gives the size" },
  "202": {
    description: "Started — poll GET …/run?run=<runId> for the result",
    content: { "application/json": { schema: obj({ started: bool, eval: str(), runId: str(), startedAt: str() }, ["started", "runId"]) } },
  },
};

/** Open routes whose credential is a signature or a signed token in the
 *  request (a storefront's HMAC, Stripe's signature, an unsubscribe token):
 *  a missing or forged one is a 401 (FOL-199). */
const SIGNED_OPEN = [/^\/v1\/billing\/partner\//, /^\/v1\/billing\/stripe$/, /^\/v1\/unsubscribe$/];

/** Operations whose credential is not the general rule's (a bearer API key
 *  or a session, refused 401/403): the credential it takes, and the
 *  refusals it gives instead (FOL-75, 5 Nov 2026 — the document said
 *  bearer and 401/403 for /v1/metrics, which takes neither). */
const OP_AUTH: Record<string, { security: Schema[]; refusals: string[] }> = {
  // The scraper's token (FOLDRUN_METRICS_TOKEN), never an account's key or a
  // session; no token, a wrong one, or none configured is a 404 — the route
  // does not say it is there — and too many wrong ones a 429.
  "GET /v1/metrics": { security: [{ metricsToken: [] }], refusals: ["404"] },
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
      const auth = OP_AUTH[`${method} ${r.path}`];
      // A route in DEPRECATIONS (api-version.ts) still answers, with
      // Deprecation headers; the document says so too.
      const deprecated = deprecationFor(method, r.path.replace(/\{[a-zA-Z]+\}/g, "x")) !== null;
      const parameters: Schema[] = [
        ...params,
        ...(shape?.query ?? []).map((q) => ({ name: q.name, in: "query", required: false, description: q.description, schema: { type: "string" } })),
        { $ref: "#/components/parameters/FoldrunVersion" },
      ];
      if (IDEMPOTENT_ROUTES.has(`${method} ${r.path}`)) parameters.push({ $ref: "#/components/parameters/IdempotencyKey" });
      // The refusal shape: the API's { error }, or the operation's own.
      const E = { $ref: `#/components/responses/${shape?.errorShape ?? "Error"}` };
      const op: Schema = {
        operationId: `${method.toLowerCase()}${r.path.replace(/[{}]/g, "").replace(/[^a-zA-Z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ""))}`,
        summary: r.summary ? r.summary.split(/[.;—]/)[0].trim().slice(0, 120) : `${method} ${r.path}`,
        ...(r.summary ? { description: r.summary } : {}),
        tags: [tagOf(r.path)],
        parameters,
        ...(open ? { security: [] } : SESSION_ONLY.has(`${method} ${r.path}`) ? { security: [{ session: [] }] } : auth ? { security: auth.security } : {}),
        ...(deprecated ? { deprecated: true } : {}),
        ...(shape?.body && method !== "GET" ? { requestBody: { required: true, content: { "application/json": { schema: shape.body } } } } : {}),
        responses: {
          ...successOf(shape),
          "400": E,
          ...(open || auth ? {} : { "401": E, "403": E }),
          ...Object.fromEntries((auth?.refusals ?? []).map((c) => [c, E])),
          // A route that names something in its path can find nothing there
          // (27 Oct 2026: the API fuzz found 26 undocumented 404s).
          ...(params.length ? { "404": E } : {}),
          // An open route that carries a token in its path refuses a bad one.
          ...(open && params.length ? { "401": E } : {}),
          ...Object.fromEntries([...(EXTRA_STATUSES[`${method} ${r.path}`] ?? []), ...(EXTRA_STATUSES[`* ${r.path}`] ?? [])].map((c) => [c, EXTRA_SUCCESS_FOR[`${method} ${r.path}`]?.[c] ?? EXTRA_SUCCESS[c] ?? E])),
          ...(open && SIGNED_OPEN.some((x) => x.test(r.path)) ? { "401": E } : {}),
          // The sign-in writes take JSON only; the proxy answers any other
          // type 415 (server/csrf.ts jsonOnly — the same test, so the two agree).
          ...(jsonOnly({ method, headers: new Headers(), url: `http://local${r.path}` }) ? { "415": E } : {}),
          "429": { $ref: "#/components/responses/RateLimited" },
          ...(IDEMPOTENT_ROUTES.has(`${method} ${r.path}`) ? { "422": E } : {}),
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
        "Every route is /v1/<route>, on the API host. Authenticate with `Authorization: Bearer <key>` (Settings → API keys). " +
        "Pin a version with `Foldrun-Version: YYYY-MM-DD`. Writes that start work accept `Idempotency-Key`. " +
        "See docs/api-usage.md for rate limits, errors and pagination.",
    },
    ...(origin ? { servers: [{ url: origin }] } : {}),
    security: [{ bearer: [] }],
    paths,
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "An API key from Settings → API keys (fr_api_…; fr_gw_… for the gateway, fr_a2a_… for A2A)" },
        session: { type: "apiKey", in: "cookie", name: "foldrun_session", description: "A signed-in browser's session cookie. The few routes that are a browser session's alone (moving the session to another account) take it and refuse a key" },
        metricsToken: { type: "http", scheme: "bearer", description: "The install's Prometheus scrape token (FOLDRUN_METRICS_TOKEN) — not an API key; only GET /v1/metrics takes it" },
      },
      parameters: {
        FoldrunVersion: {
          name: "Foldrun-Version", in: "header", required: false,
          description: `The API version to answer under (YYYY-MM-DD). Omitted: the account's pin for an API key, else ${CURRENT_API_VERSION}; a signed-in dashboard always gets ${CURRENT_API_VERSION}. Unknown → 400 with \`code\` and \`known\`. From 2026-11-22 a refusal is Anthropic's error body; the key may be sent as \`x-api-key\` too.`,
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
        // API 2026-11-22 (one API, as Anthropic's): a program gets the body
        // /v1 answers with; an older pin and a browser, { error }.
        Error: { oneOf: [{ $ref: "#/components/schemas/AnthropicError" }, { $ref: "#/components/schemas/LegacyError" }] },
        AnthropicError: obj(
          {
            type: str('"error"'),
            error: obj(
              {
                type: str("Anthropic's error type, by status: invalid_request_error, authentication_error, billing_error, permission_error, not_found_error, request_too_large, rate_limit_error, api_error, overloaded_error"),
                message: str("What to do first, then why — enough on its own: a client may show only this"),
                code: str("Where a caller can act on it — as `code` below"),
                retry_after: int,
                foldrun: obj(
                  {
                    code: str("The catalogued reason: key_revoked, allowance_used, rate_limited, too_large, model_unavailable, unavailable…"),
                    fix: str("What to do, one line (the start of message)"),
                    command: str("An existing foldrun command that diagnoses or fixes it, e.g. `foldrun login`, `foldrun doctor`"),
                    command_kind: str("diagnose or repair"),
                    docs: str("Where it is explained"),
                  },
                  ["code", "fix"],
                ),
              },
              ["type", "message"],
            ),
          },
          ["type", "error"],
        ),
        LegacyError: obj(
          {
            error: str(),
            code: str("Where a caller can act on it: `unknown_api_version` (this server does not answer that Foldrun-Version), `bad_api_version` (not a YYYY-MM-DD date), or `waiting_cap` (409: the account already has its most runs waiting for their turn — nothing was started)"),
            known: { type: "array", items: { type: "string" }, description: "With an API-version refusal: the versions this server answers" },
            limit: { type: "integer", description: "With `waiting_cap`: the most runs this account may have waiting at once" },
            waiting: { type: "integer", description: "With `waiting_cap`: how many are waiting now" },
          },
          ["error"],
        ),
        RateLimited: { oneOf: [{ $ref: "#/components/schemas/AnthropicError" }, obj({ error: str(), retry_after: int }, ["error", "retry_after"])] },
      },
      responses: {
        Error: { description: "A refusal, with a sentence saying why", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        // The MCP endpoint refuses as JSON-RPC 2.0 does (§5.1); a refusal the
        // API's gate makes before the endpoint runs (a Foldrun-Version it
        // does not answer, say) keeps the API's own { error } (Codex, FOL-199).
        RpcError: {
          description: "A refusal: as JSON-RPC 2.0 sends one (§5.1) — no result, an error object with its code and a sentence — or, from the API's gate before the endpoint runs, the API's own { error }",
          content: { "application/json": { schema: { oneOf: [
            obj({ jsonrpc: str('"2.0"'), id: { type: ["string", "integer", "null"] }, error: obj({ code: int, message: str() }, ["code", "message"]) }, ["jsonrpc", "error"]),
            { $ref: "#/components/schemas/Error" },
          ] } } },
        },
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
  const m = p.match(/^\/v1\/workspaces\/\{workspace\}\/([a-z-]+)/);
  if (m) return m[1];
  if (p === "/v1/workspaces" || p === "/v1/workspaces/{workspace}") return "workspaces";
  if (p.startsWith("/s/")) return "shares";
  return p.split("/")[2] ?? "api";
}
