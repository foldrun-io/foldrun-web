// OpenAPI request/response schemas: /api/workspaces, and /api/workspaces/{workspace}/<agents|assets|assistant|check|deploy|evals|export|import|… up to 'l'>.
// Written from what each handler validates and answers (30 Oct 2026).

import { type Shape, type Schema, obj, str, bool, int, arr, nullable, Proposal } from "./kit.ts";

const num: Schema = { type: "number" };

const WorkspaceSummary = obj({
  name: str(), description: str(), agents: int, flows: int,
  deployedAt: str("when its folder last changed"), runCount: int,
  avatar: nullable(str("its picture's URL")),
});

/** One agent as listed (core store.ts AgentInfo plus server/agent-activity.ts). Large; the fields callers use. */
const Agent: Schema = {
  ...obj({
    name: str(), description: str(),
    owner: nullable(str()), ownerFrom: nullable(str("agent | workspace | account")),
    model: str(), effort: nullable(str()),
    tools: arr(str()), ownTools: arr(str()), consults: arr(str("agents: — colleagues it may consult")), subagents: arr(str()),
    sandbox: str("own, when set"),
    skills: nullable(arr(str(), "the skills: allowlist; null inherits every skill in scope")),
    secrets: arr(str()), budget: nullable(num), timezone: nullable(str()),
    lastRunAt: nullable(str("when its latest step that ran started")),
    stale: { ...bool, description: "past the workspace's (else the account's) alerts: stale_days" },
  }),
  additionalProperties: true,
};

const DraftFile = obj({
  path: str(), content: str(),
  before: nullable(str("what the workspace has at that path now; null for a new file")),
  sha256: nullable(str("sha256 of before, for the source PUT's ifMatch")),
});
const DraftIssue = obj({ where: str(), message: str(), level: str("error | warn") });

const Assertion = obj({ type: str("contains | not-contains | matches | file | run | judge"), value: str() });

/** An eval file, parsed (core evals.ts EvalInfo). */
const EvalInfo = obj({
  name: str(), file: str(),
  agent: nullable(str("the agent under test; null when a flow is")), flow: nullable(str()),
  model: str("the judge's model"), effort: nullable(str()),
  trigger: str("deploy | manual | runs"),
  sample: { ...int, description: "trigger: runs — percent of finished runs graded" },
  improve: nullable(int), problems: arr(str()), revision: str("a hash of the file as read"),
  live: bool, inputs: { ...bool, description: "a file of saved inputs for a flow, not a test" },
  cases: arr(obj({ name: str(), task: str(), expect: arr(Assertion) })),
});

const CaseResult = obj({
  name: str(), task: str(), runId: nullable(str()), passed: bool,
  error: nullable(str("the agent itself failed before any check ran")),
  assertions: arr(obj({ assertion: Assertion, passed: bool, detail: str(), costUsd: num })),
  costUsd: num, judgeCostUsd: num, secs: nullable(num),
});

/** One eval run's result (core evals.ts EvalResult). */
const EvalResultProps: Record<string, Schema> = {
  eval: str(), startedAt: str(), finishedAt: str(), passed: int, failed: int, costUsd: num,
  cases: arr(CaseResult),
  error: str("why the eval could not run at all; set only when cases is empty for that reason"),
};
const EvalResult = obj(EvalResultProps);

const Progress = obj({ done: int, total: int });

/** A model comparison's result (core eval-compare.ts EvalComparison). */
const EvalComparison = obj({
  eval: str(),
  target: obj({ flow: nullable(str()), agent: nullable(str()) }),
  judge: obj({ model: str(), effort: nullable(str()) }),
  startedAt: str(), finishedAt: str(), repeat: int, maxUsd: num, spentUsd: num,
  stopped: nullable(str("why it stopped early, when it did")),
  configs: arr(obj({
    model: str(), effort: nullable(str()), agent: nullable(str()), label: str(),
    trials: int, passed: int, notRun: int, rate: nullable(num),
    costUsd: num, judgeCostUsd: num, avgCostUsd: nullable(num), avgSecs: nullable(num), runIds: arr(str()),
  })),
  cases: arr(obj({ case: str(), passed: arr(int, "per setting, in order"), trials: arr(int) })),
});

/** A poll of one eval run or comparison (server/eval-runs.ts LaneView), with `running`. */
const laneView = (result: Schema): Record<string, Schema> => ({
  running: bool,
  runId: str(),
  state: str("running | done | failed | lost | unavailable — with ?run="),
  startedAt: str(),
  progress: Progress,
  result,
  error: str("failed, lost or unavailable: why"),
});

const GradeAssertion = obj({ type: str(), value: str(), passed: bool, detail: str() });
/** One graded run (core grades.ts Grade). */
const Grade = obj({
  eval: str(), runId: str(), flow: str("the run's flow; adhoc:<agent> for a direct agent run"), at: str(),
  status: str("pass | fail | error"),
  checks: arr(obj({ name: str(), passed: bool, error: str("the check could not be decided"), assertions: arr(GradeAssertion) })),
  costUsd: { ...num, description: "what the judges cost" }, model: str("the judge's model"),
  evalRevision: str(), runRevision: nullable(str()), runFinishedAt: nullable(str()),
  by: str("sample, or who asked"),
});

const RevisionFile = obj({ path: str(), before: nullable(str("null: the file did not exist")), after: nullable(str("null: the change deleted it")) });

const ImportPlanProps: Record<string, Schema> = {
  kind: str("workspace | flow | agent"), name: str(), from: str("the workspace it was exported from"), workspace: str(),
  creates: { ...bool, description: "the workspace does not exist yet and the import makes it" },
  added: arr(str()), overwritten: arr(str("exists with different text — written only with overwrite=1")), unchanged: arr(str()),
  skipped: arr(str("in the zip, not written")),
  needs: obj({ secrets: arr(str()), tools: arr(str()), skills: arr(str()), scripts: arr(str()), agents: arr(str()), flows: arr(str()) }),
};

export const SHAPES: Record<string, Shape> = {
  "GET /api/workspaces": { response: obj({ workspaces: arr(WorkspaceSummary, "the ones the caller may see, most recently deployed first") }) },
  "POST /api/workspaces": {
    body: obj({
      name: str("required unless demo: true"),
      files: arr(obj({ path: str(), content: str() }, ["path", "content"]), "the workspace's files; not needed with template, starter or demo"),
      template: { ...bool, description: "blank: just an AGENTS.md (what the dashboard sends)" },
      starter: { ...bool, description: "the example researcher, writer and publish flow" },
      demo: { ...bool, description: "the demo pipeline, under its fixed name" },
      ifAbsent: { ...bool, description: "refuse with 409 when the name exists, rather than deploying over it" },
    }),
    response: obj({
      ok: bool, name: str(), tenant: str("the account"),
      agents: { ...int, description: "how many agents it now has" }, flows: { ...int, description: "how many flows" },
      dashboard: str("its dashboard path"),
    }),
  },
  "GET /api/workspaces/{workspace}/agents": { response: obj({ agents: arr(Agent) }) },
  "POST /api/workspaces/{workspace}/agents": {
    body: obj({ name: str("agents/<name>/agent.md"), description: str(), model: str() }, ["name"]),
    response: obj({ ok: bool, path: str() }),
  },
  "POST /api/workspaces/{workspace}/agents/{agent}/run": {
    body: obj({ task: str("what the agent is asked to do"), test: { ...bool, description: "a test run" } }),
    query: [
      { name: "wait", description: "true (or 1) answers when the run stops — 202 if it is still going at the timeout or waits on approval" },
      { name: "timeout", description: "with wait: seconds, default 300, at most 900" },
    ],
    response: obj({
      ok: bool, runId: str(), test: bool,
      status: str("with wait: the run's status"), result: nullable(str("with wait: what it produced")),
      failure: nullable(obj({ agent: str(), reason: str() })), costUsd: num,
      steps: arr(obj({ agent: str(), status: str(), skipReason: nullable(str()) })),
      timedOut: bool, awaitingApproval: bool,
    }),
  },
  "GET /api/workspaces/{workspace}/agents/import": {
    response: obj({
      workspaces: arr(obj({ name: str(), agents: arr(obj({ name: str(), description: str() })) }), "every other workspace the caller may read that has agents"),
    }),
  },
  "POST /api/workspaces/{workspace}/agents/import": {
    body: obj({ from: str("the source workspace"), agent: str("the agent to copy"), as: str("a new name for it here") }, ["from", "agent"]),
    response: obj({
      ok: bool, from: str(), name: str("its name in this workspace"), files: arr(str(), "workspace-relative paths written"),
      warnings: arr(str(), "what it names that this workspace does not have"),
    }),
  },
  "POST /api/workspaces/{workspace}/assets": {
    body: obj(
      {
        kind: str("agents | evals | flows | tools | hooks | knowledge | memory | skills | scripts"),
        name: str(),
        agent: str("create it inside this agent's folder, for a kind that may live there"),
        template: str("start from: a tool transport (http | script | mcp) or a gallery entry"),
        language: str("a script tool's language"),
      },
      ["kind", "name"],
    ),
    response: obj({ ok: bool, path: str("the document's main file"), type: nullable(str("its document type, when the kind has one")) }),
  },
  "POST /api/workspaces/{workspace}/assistant": {
    body: obj(
      {
        messages: arr(obj({ role: str("user | assistant"), content: str() }, ["role", "content"]), "the conversation; the last is the person's"),
        files: arr(obj({ path: str(), content: str() }, ["path", "content"]), "proposals from earlier replies not saved yet"),
        page: str("where the person is in the dashboard"),
        conversation: nullable(str("continue this kept conversation; omitted, a new one")),
      },
      ["messages"],
    ),
    response: {
      ...obj({
        ok: { ...bool, description: "no issue is an error" },
        reply: str(),
        files: arr(DraftFile, "every unsaved proposal, as it stands — nothing is written"),
        issues: arr(DraftIssue),
        sources: arr(obj({ doc: str(), section: str(), url: str() }), "the doc sections it read"),
        supply: str("provider | platform | mock"),
        workspace: nullable(obj({ name: str(), purpose: str() }, ["name", "purpose"])),
        usage: nullable(obj({ inputTokens: int, outputTokens: int, cacheReadTokens: int, cacheWriteTokens: int, costUsd: num })),
        chargedUsd: nullable(num),
        conversation: str("the conversation's id"),
      }),
      description: "With Accept: text/event-stream the reply streams instead: status and text events ({ text }), then done (this object) or error ({ error, status })",
    },
  },
  "GET /api/workspaces/{workspace}/evals": { response: obj({ evals: arr(EvalInfo) }) },
  "POST /api/workspaces/{workspace}/evals": {
    body: obj({ name: str("evals/<name>.md") }, ["name"]),
    response: obj({ ok: bool, path: str() }),
  },
  "GET /api/workspaces/{workspace}/evals/{evalName}/compare": {
    query: [{ name: "run", description: "one comparison by id; omitted, who holds it now and the kept comparisons" }],
    response: obj({
      ...laneView(EvalComparison),
      comparisons: arr(
        obj({ runId: str(), startedAt: str(), finishedAt: str(), status: str("done | failed"), result: EvalComparison, error: str() }),
        "without ?run=: the kept comparisons, newest first",
      ),
    }),
  },
  "POST /api/workspaces/{workspace}/evals/{evalName}/compare": {
    body: obj(
      {
        configs: arr(
          obj({ model: str("a tier (fast, default, max) or a model id"), effort: nullable(str("low | medium | high | xhigh | max")), agent: nullable(str("flow evals: only this agent's steps take the model")) }, ["model"]),
          "two to four settings, each different",
        ),
        repeat: { ...int, description: "1–5, default 1" },
        maxUsd: { ...num, description: "spend limit, USD: above 0, at most 100, default 5" },
      },
      ["configs"],
    ),
    status: "202",
    response: obj({ started: bool, eval: str(), runId: str("poll GET …/compare?run=<runId>"), startedAt: str(), trials: { ...int, description: "cases × settings × repeat" }, maxUsd: num }),
  },
  "POST /api/workspaces/{workspace}/evals/{evalName}/grade": {
    body: obj({ run: str("the id of a finished run to grade") }, ["run"]),
    response: Grade,
  },
  "GET /api/workspaces/{workspace}/evals/{evalName}/grades": {
    query: [
      { name: "days", description: "the window: 1–90, default 30" },
      { name: "status", description: "pass | fail | error — filters grades, not summary" },
      { name: "limit", description: "newest grades returned: 1–500, default 100" },
    ],
    response: obj({
      eval: str(), flow: nullable(str()), agent: nullable(str()), sample: int, improve: nullable(int), days: int,
      summary: obj({
        graded: int, passed: int, failed: int, errors: int, rate: nullable({ ...num, description: "passed / (passed + failed)" }), costUsd: num,
        byDay: arr(obj({ day: str(), graded: int, passed: int, failed: int })),
      }),
      grades: arr(Grade, "newest first"),
    }),
  },
  "POST /api/workspaces/{workspace}/evals/{evalName}/improve": {
    noBody: "the eval in the path says what to fix: a grader's failed grades no proposal has covered, or the last result's failed cases",
    status: "202",
    response: { ...Proposal, description: "the proposal, drafting — poll GET …/proposals/{id}; nothing is written until a person applies it. 409 when there is nothing to fix, one is already open, or the workspace is paused" },
  },
  "GET /api/workspaces/{workspace}/evals/{evalName}/run": {
    query: [{ name: "run", description: "one run by id (what an async caller polls); omitted, who holds the eval now and its latest result" }],
    response: obj(laneView(nullable(EvalResult))),
  },
  "POST /api/workspaces/{workspace}/evals/{evalName}/run": {
    body: obj({ async: { ...bool, description: "true answers 202 { started, eval, runId, startedAt } at once and the eval runs on" } }),
    response: obj({
      ...EvalResultProps,
      started: { ...bool, description: "async: true only" },
      runId: str("async: true only — poll GET …/run?run=<runId>"),
    }),
  },
  "GET /api/workspaces/{workspace}/export": {
    query: [
      { name: "kind", description: "workspace (default) | flow | agent" },
      { name: "name", description: "the flow or agent, for kind flow or agent" },
    ],
    media: { type: "application/zip", description: "the package, as an attachment: authored source only — never memory, state, storage or a secret's value" },
  },
  "GET /api/workspaces/{workspace}/history": {
    query: [
      { name: "path", description: "revisions that touched this file; with id, that revision narrowed to it" },
      { name: "id", description: "one revision in full, with each file's line diff" },
      { name: "limit", description: "without id: 1–500, default 100" },
    ],
    response: obj({
      revisions: arr(obj({ id: str(), at: str(), by: str(), message: str(), commit: nullable(str()), paths: arr(str()) }), "without id: newest first"),
      id: str("with id: the revision"), at: str(), by: str("a signed-in email, api-key, agent:<name>, deploy or system"), message: str(),
      commit: nullable(str("set when the revision is a git commit")),
      files: arr({
        ...RevisionFile,
        properties: { ...(RevisionFile.properties as Record<string, Schema>), diff: arr(obj({ kind: str("same | add | del"), text: str() })) },
      }),
    }),
  },
  "POST /api/workspaces/{workspace}/import": {
    noBody: "the body is the package itself — the .zip GET …/export answers — sent as application/zip with a Content-Length, at most 20 MB; not JSON",
    query: [
      { name: "dryRun", description: "1: what it would add, overwrite and still need; writes nothing" },
      { name: "overwrite", description: "1: replace files that differ (otherwise 409)" },
    ],
    response: obj({
      ok: { ...bool, description: "applied" },
      dryRun: { ...bool, description: "dryRun=1 only" },
      ...ImportPlanProps,
      written: arr(str(), "applied: the paths written"),
      revision: nullable(str("applied: the History revision, for undo")),
    }),
  },
};
