// OpenAPI request/response schemas: /api/workspaces/{workspace}/flows*, /api/workspaces/{workspace}/hooks/*.
// Written from what each handler validates and answers (30 Oct 2026).

import { type Shape, type Schema, obj, str, bool, int, arr, nullable } from "./kit.ts";

const num: Schema = { type: "number" };

/** One parsed step (core store.ts FlowStep). Options a step does not set are absent. */
const FlowStep: Schema = {
  ...obj(
    {
      agent: str("the agent the step runs, or the flow when `subflow` is set"),
      instruction: str(),
      group: { ...int, description: "steps with the same group run in parallel" },
      optional: { ...bool, description: "`2?.` — its failure does not fail the flow" },
      subflow: str("set when the step runs another flow ([[flow:name]])"),
      model: str(), effort: str(), approve: bool, when: str(), case: str(), else: bool,
      retry: int, timeout: { ...int, description: "seconds" }, onFail: str("the agent that takes over when it fails"),
      waitSecs: int, waitFor: str("event"), ask: str(), preview: arr(str()), delegate: arr(str()),
      loop: int, until: str(), each: str("lines | rows | items"), eachPath: str(), max: int, parallel: int,
      verify: str(), output: str("json"), maxTurns: int,
      limits: { type: "object", additionalProperties: int },
      line: { ...int, description: "1-based line in the flow file" },
      problems: arr(str(), "what is wrong with an option's value — `foldrun check` reports each as an error"),
    },
    ["agent", "instruction", "group", "optional"],
  ),
  additionalProperties: true,
};

/** A parsed flow file (core store.ts FlowInfo). Large; the fields callers use. */
const Flow: Schema = {
  ...obj({
    name: str(), file: str("its file under flows/"),
    trigger: str("manual | schedule | webhook | email | flow | once | watch | storage"),
    schedule: nullable(str("cron, for trigger: schedule")), timezone: nullable(str()),
    model: nullable(str()), effort: nullable(str()),
    overlap: nullable(str("skip | queue")), priority: nullable(str("high | normal | low")),
    budget: nullable({ ...num, description: "the most one run may spend, USD" }), budgetProblem: nullable(str()),
    compute: nullable(obj({ vcpu: num, memGiB: num, diskGiB: num })),
    after: nullable(str("trigger: flow — the flow whose end starts this one")), on: str("completed | failed | blocked | any"),
    at: nullable(str()), url: nullable(str()), every: nullable(int), path: nullable(str()),
    signature: nullable(str("github | stripe | slack | hmac")), signingSecret: nullable(str("the vault secret's NAME, never its value")),
    filter: { description: "`filter:` exactly as written (any JSON); null when the flow has none" },
    live: bool, description: nullable(str()),
    owner: nullable(str()), ownerFrom: nullable(str("flow | workspace | account")),
    frontProblems: arr(str()),
    steps: arr(FlowStep),
  }),
  additionalProperties: true,
};

/** One canvas gesture (core flow-patterns.ts PatternEdit); which fields apply depends on `op`. */
const PatternEdit: Schema = obj(
  {
    op: str("insert | router | options | approve | remove | duplicate | paste"),
    target: str("insert: the agent (or flow, with subflow) of the new step"),
    subflow: bool,
    instruction: str(),
    at: { type: "object", description: "insert, paste: { rail: n } (its own group there; 0 is before every group) or { column: n } (join that group)" },
    options: { type: "object", additionalProperties: { type: ["string", "null"] }, description: "insert: step options to write (ask, wait, on-fail, each, max, loop, until, verify, case, else, when, retry, approve)" },
    router: str("router: the triage step's agent"),
    rail: int,
    cases: arr(obj({ value: str(), target: str() }), "router: one case: branch each"),
    else: str("router: the agent for the else: branch"),
    step: { ...int, description: "options, approve, remove, duplicate: the step's index in the parsed steps" },
    set: { type: "object", additionalProperties: { type: ["string", "null"] }, description: "options: the options to set; null removes one" },
    on: { ...bool, description: "approve: the `!` marker on or off" },
    text: str("paste: copied step markdown"),
  },
  ["op"],
);

const EXPECT = str("the text the caller read the file as, or its sha256; refused with 409 (and the current text) when the file no longer reads it");

/** PATCH …/flows/{flow}: one of the shapes, checked in this order: restore, edits, edit, compute, trigger, step+instruction, step+options, groups. */
const EDIT_FLOW: Shape = {
  body: obj({
    restore: str("a whole earlier text to put back (the canvas's undo); needs expect"),
    edits: arr(PatternEdit, "several canvas edits applied in order as one write"),
    edit: PatternEdit,
    compute: nullable(obj({ vcpu: num, memGiB: num, diskGiB: num }, [])),
    a2a: nullable({ ...obj({
      publish: { ...bool, description: "outside agents with an A2A key naming this flow may call it" },
      name: nullable(str("the agent card's name; null removes it (the flow's name is used)")),
      description: nullable(str("the card's description; null removes it")),
      examples: nullable(arr(str(), "example requests the card lists; null removes them")),
      public_card: nullable({ ...bool, description: "the card is readable without a key (calling it never is)" }),
      input: { description: "a JSON Schema the request's data part must satisfy; null removes it" },
      accept_risk: nullable(arr(str(), "the agents of this flow an admin accepts holding a secret while they can run code (their answer goes to the caller); null or [] removes it")),
    }), description: "merged over the flow's a2a: — a key sent replaces it, null removes it, the rest is kept; null removes the block. Admin only (workspace:manage)" }),
    trigger: obj({
      trigger: str("manual | schedule | webhook (default manual)"),
      schedule: str("a cron expression the scheduler can fire, for schedule"),
      timezone: str(),
    }),
    step: { ...int, description: "an index into the flow's parsed steps; with instruction or options" },
    instruction: str("with step: that step's new instruction"),
    options: {
      type: "object",
      additionalProperties: { type: ["string", "number", "null"] },
      description: "with step: model, effort, retry, timeout, verify, when, case, else, loop, until, each, max, limits; null removes one",
    },
    groups: arr(arr(int), "the new arrangement, as indices into the parsed steps: [[0], [1, 2], [3]]"),
    expect: EXPECT,
  }),
  response: obj({
    ok: bool,
    flow: Flow,
    before: str("the file before the write"),
    text: str("the file after it"),
  }),
};

/** DELETE …/flows/{flow}: remove one step. */
const REMOVE_STEP: Shape = {
  body: obj({ step: { ...int, description: "the step's index in the parsed steps" }, expect: EXPECT }, ["step"]),
  response: obj({ ok: bool, flow: Flow }),
};

const DraftFile = obj({
  path: str(), content: str(),
  before: nullable(str("what the workspace has at that path now; null for a new file")),
  sha256: nullable(str("sha256 of before, for the source PUT's ifMatch")),
});
const DraftIssue = obj({ where: str(), message: str(), level: str("error | warn") });

/** A hook in hooks/ or the account library (server/hooks.ts HookEntry). */
const HookEntry = obj(
  {
    name: str(), scope: str("workspace | account"), path: str("hooks/<name>"),
    on: str("tool.call | tool.result | step.start | step.end"), tool: str(), timeoutSec: int, description: str(),
    error: str("why hook.md is not a hook — set instead of on, tool and timeoutSec"),
    shadowed: { ...bool, description: "an account hook hidden by a workspace hook of the same name" },
    onFor: arr(str(), "who turns it on: account, workspace, or an agent's name"),
  },
  ["name", "scope", "path", "onFor"],
);

const HookActivity = obj({
  runId: str(), flow: str(), agent: str(), step: { ...int, description: "1-based" }, t: str(),
  record: { ...obj({ hook: str(), event: str(), did: str("deny | rewrite | error | context | reply | note …"), tool: str(), reason: str(), ms: int }), additionalProperties: true },
});

export const SHAPES: Record<string, Shape> = {
  "GET /api/workspaces/{workspace}/a2a": {
    response: obj({
      flows: arr(obj({
        flow: str(), published: bool, publicCard: bool,
        name: str("the agent card's name"), description: nullable(str()),
        hasInputSchema: { ...bool, description: "the flow's a2a: input: — a JSON Schema the request's data part must match" },
        card: str("the agent card's URL"), url: str("the A2A JSON-RPC endpoint"),
        acceptRisk: arr(str(), "the flow's a2a: accept_risk — agents an admin accepted holding a secret while they can run code"),
      }), "every flow whose frontmatter says a2a:, published or not"),
      risks: arr(obj({
        flow: str(), agent: str(), secrets: arr(str(), "the secrets that reach its sandbox"),
        accepted: { ...bool, description: "the flow's accept_risk names it" },
      }), "every flow's agents (published or not) that hold a secret and can run code: a published one is refused new A2A tasks, and publishing is refused, until accepted"),
      keys: nullable(arr(obj({ id: str(), label: str(), prefix: str(), flows: arr(str()), maxTasks: nullable(int), expiresAt: nullable(str()) }), "the workspace's live A2A keys; null unless the caller may manage keys")),
      tasks: arr(obj({
        id: str("the A2A task id"), flow: str(), state: str("TASK_STATE_SUBMITTED | WORKING | COMPLETED | FAILED | CANCELED | …"),
        runId: nullable(str()), contextId: str(),
        key: obj({ id: str(), label: nullable(str()), prefix: nullable(str()), revoked: bool }),
        createdAt: str(), updatedAt: str("when its state last changed"),
      }), "the 50 newest A2A tasks"),
    }, ["flows", "keys", "tasks"]),
  },
  "GET /api/workspaces/{workspace}/flows": { response: obj({ flows: arr(Flow) }) },
  "POST /api/workspaces/{workspace}/flows": {
    body: obj({ name: str("the new flow's name; flows/<name>.md"), pattern: str("pipeline | review-loop | fan-out | debate | router (anything else is pipeline)") }, ["name"]),
    response: obj({ ok: bool, path: str("flows/<name>.md"), pattern: str() }),
  },
  "PATCH /api/workspaces/{workspace}/flows/{flow}": EDIT_FLOW,
  "POST /api/workspaces/{workspace}/flows/{flow}/filter": {
    body: obj({ payload: { description: "the delivery to test: a webhook's JSON body (a string is read as one), an email's { from, to, subject, text }, a chained run's { run, flow, status, ending, verdict, summary }, a storage event's { by, paths }" } }, ["payload"]),
    response: obj({
      flow: str(), trigger: str(),
      filter: { description: "the flow's filter: as written; null when it has none" },
      applies: { ...bool, description: "the trigger is one a filter applies to: webhook, email, flow or storage" },
      match: bool, reason: str("why, in one sentence"),
    }),
  },
  "POST /api/workspaces/{workspace}/flows/draft": {
    body: obj({
      description: str("the flow wanted, in words (at most 4000 characters). Without it the POST is a step added to a flow named draft, as POST …/flows/{flow} takes it"),
      flow: str("redraft this existing flow"),
      target: str("no description: the step to add"), subflow: bool, instruction: str(),
    }),
    response: obj({
      ok: { ...bool, description: "no issue is an error" },
      files: arr(DraftFile, "proposed files — nothing is written"),
      issues: arr(DraftIssue),
      repaired: { ...bool, description: "the first answer had errors and the model was asked once more" },
      notes: str(), supply: str("provider | platform | mock"),
      flow: { ...Flow, description: "only when no description was sent: the flow named draft after its step was added" },
    }),
  },
  "PATCH /api/workspaces/{workspace}/flows/draft": { ...EDIT_FLOW, response: { ...(EDIT_FLOW.response as Schema), description: "the flow named draft, edited as PATCH …/flows/{flow}" } },
  "DELETE /api/workspaces/{workspace}/flows/draft": REMOVE_STEP,
  "GET /api/workspaces/{workspace}/hooks": {
    query: [
      { name: "runs", description: "how many runs to read back through for recent, newest first: 1–500, default 50" },
      { name: "all", description: "1 lists every hook record, not only deny, rewrite and error" },
    ],
    response: obj({
      hooks: arr(HookEntry, "the workspace's own first, then the account library's"),
      recent: arr(HookActivity, "newest first, at most 200"),
    }),
  },
  "GET /api/workspaces/{workspace}/hooks/{flow}": {
    response: obj({
      ok: bool, flow: str(),
      path: str("/api/hooks/<account>/<workspace>/<flow>?token=… — carries the token"),
      url: nullable(str("path made absolute with FOLDRUN_PUBLIC_URL; null when that is unset")),
    }),
  },
  "POST /api/workspaces/{workspace}/hooks/{flow}/rotate": {
    noBody: "rotating needs nothing but the flow in the path; the old token stops working at once",
    response: obj({ ok: bool, path: nullable(str("the new webhook path, carrying the new token; null on an Idempotency-Key replay")) }),
  },
  "POST /api/workspaces/{workspace}/hooks/{flow}/test": {
    body: obj({ event: { type: "object", additionalProperties: true, description: "the event the hook reads on stdin; omitted, a sample for its kind" } }),
    response: obj({
      ok: bool,
      decision: str("tool.call: allow | deny"), reason: str(),
      input: { type: "object", additionalProperties: true, description: "tool.call: the rewritten tool input" },
      context: str("step.start: text added to the step"), reply: str("step.end: the rewritten reply"), note: str(),
      failure: str("why it failed — threw, timed out, wrong shape; or why it was not run"),
      ms: int,
      hook: str(), on: str("tool.call | tool.result | step.start | step.end"), scope: str("workspace | account"),
      event: { type: "object", additionalProperties: true, description: "the whole event the hook was handed" },
      testable: { ...bool, description: "false on an install that runs hooks only inside a run's sandbox: nothing ran" },
      summary: str("set with testable: false"), detail: str("set with testable: false: how to test it instead"),
    }),
  },
};
