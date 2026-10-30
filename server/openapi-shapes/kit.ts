// What every schema file under server/openapi-shapes/ builds from: the small
// helpers and the shapes several routes share. A route's request and response
// schemas live in the file for its group (30 Oct 2026, when every operation
// got one); server/openapi.ts merges them.

export type Schema = Record<string, unknown>;

/** One operation's documentation. `response` is the 200 JSON body; `media`
 *  replaces it for a route that answers something else (a stream, a file,
 *  CSV); `status` for one that answers 201, 204 or a 302 redirect. `noBody` /
 *  `noResponse` say, in a sentence, why a write takes no body or an answer
 *  has no schema — tests/openapi-coverage.test.ts wants one or the other. */
export type Shape = {
  body?: Schema;
  response?: Schema;
  query?: { name: string; description: string }[];
  media?: { type: string; schema?: Schema; description?: string };
  status?: "200" | "201" | "202" | "204" | "302" | "303" | "307";
  noBody?: string;
  noResponse?: string;
};


export const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
});
export const str = (description?: string): Schema => ({ type: "string", ...(description ? { description } : {}) });
export const bool = { type: "boolean" };
export const int = { type: "integer" };
export const GENERIC: Schema = { type: "object", additionalProperties: true, description: "JSON — see docs/api.md for this route's fields" };

export const Tokens: Schema = {
  ...obj({
    input: { ...int, description: "all input tokens, cache reads and writes included" },
    output: int,
    cacheRead: { ...int, description: "the part of input the prompt cache served (a tenth of the price); absent before 18 Oct 2026" },
    cacheWrite: { ...int, description: "the part of input written to the prompt cache; absent before 18 Oct 2026" },
  }),
  type: ["object", "null"],
};

// FOL-54 step 3: core issues.ts.
export const IssueEvent = obj({ at: str(), by: str(), action: str("acknowledge | snooze | resolve | reopen"), until: str(), note: str() });
export const Issue = obj({
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

export const Run = obj({
  id: str(), flow: str(), status: str("queued | running | awaiting-approval | completed | failed | stopped"),
  startedAt: str(), finishedAt: str(), test: bool,
  verdict: { type: ["string", "null"], description: "GOOD | QUIET | BLOCKED | BAD, the word the run's summary leads with; null for none" },
  outcome: str("in the runs list: running | queued | waiting | good | done | quiet | blocked | bad | failed | stopped — the one outcome every surface shows"),
  failure: { type: ["object", "null"], description: "in the runs list: { agent, reason } — the step that failed and its last error; null when none" },
  chargedUsd: { type: ["number", "null"], description: "in the runs list: what the account was charged for the run, in USD (one credit is one cent); null until the ledger settles it. costUsd is the token cost at the model's list price" },
  tokens: Tokens,
  steps: { type: "array", items: { ...obj({ tokens: Tokens }), additionalProperties: true } },
});

export const EffectiveFlag = obj({
  name: str(), description: str(), owner: str(), default: bool, on: bool,
  source: str("account | global | rollout | default — what decided it"),
  rollout: { type: ["integer", "null"], description: "the rollout percentage in force, when one is" },
});

/** Hand-written shapes, by "METHOD path". */

/** Shorthand: an array of these. */
export const arr = (items: Schema, description?: string): Schema => ({ type: "array", items, ...(description ? { description } : {}) });
/** Shorthand: this, or null. */
export const nullable = (s: Schema): Schema => ({ ...s, type: [s.type as string, "null"] });
/** The common write answer. */
export const OK = obj({ ok: bool }, ["ok"]);

/** platform improve.ts Proposal: a proposed fix for an eval's failures — GET …/proposals, POST …/evals/{evalName}/improve. */
export const Proposal = obj({
  id: str("prop_…"), workspace: str(), eval: str(),
  by: str("auto (the grade pass) or who asked"), createdAt: str(), updatedAt: str(),
  status: str("drafting | ready | failed | applying | applied | partial | dismissed"),
  failures: arr(obj({ runId: str(), case: str("for an eval case, in place of runId"), check: str(), detail: str(), at: str() })),
  jobId: nullable(str()),
  reply: str("the assistant's explanation"),
  files: arr(obj({
    path: str(), content: str("the proposed file"),
    before: nullable(str("what the workspace has there now; null for a new file")),
    sha256: nullable(str("sha256 of before"))
  })),
  issues: arr(obj({ where: str(), message: str(), level: str("error | warn") }), "the deploy's checks on the proposed files"),
  error: str("why it failed, or what was dropped from it"), notes: arr(str()),
  decidedBy: str(), decidedAt: str(),
  applied: arr(str(), "for applied and partial: the files written"),
  draftFailed: { ...bool, description: "dismissed after its draft failed; its failures still count toward the next proposal" },
  timedOut: { ...bool, description: "failed only because the draft did not finish in time" },
});
