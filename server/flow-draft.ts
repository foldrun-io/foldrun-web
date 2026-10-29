// "Draft with AI" — a flow file (and any agents it needs) from a sentence.
//
// The markdown stays the only source of truth: this module proposes files,
// it never writes one. The route returns what the model drafted, checked;
// the dashboard shows it as diffs and saves through the ordinary source PUT
// only when a person presses Save and confirms.
//
// The check is the deploy's own (deployIssues, which `deploy --dry-run`
// answers with) over the workspace as it would be with the draft in it,
// plus the flow lint `foldrun check` runs. When it finds errors the model is
// shown them once and asked to repair; whatever is still wrong after that is
// returned beside the files, not hidden.
//
// The model call is the platform's one-off completion, the shape the eval
// judge uses (a toolless, single-turn Agent SDK query) — on the workspace's
// own `provider:` when it declares an Anthropic-format one, else on the
// platform credential. On the platform credential the account pays for it:
// the balance gate first, then one ledger line, as for a run.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import matter from "@/lib/matter";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { workspaceDir, listAgents, listFlows, resolveModel } from "@/lib/store";
import { hostSafeEnv } from "@/lib/host-env";
import { withModelEnv } from "@/lib/model-env";
import { recordRunCost } from "@/platform/ledger";
import { billing } from "@/platform/billing";
import { draftModelEnv, mergedIssues, FLOW_PATH, AGENT_PATH, type DraftFile, type DraftIssue } from "@/platform/assistant/shared";

export { draftModelEnv, mergedIssues, type DraftFile, type DraftIssue };

/** Hard limits, so a draft is a bounded call whatever is typed. */
export const DRAFT_LIMITS = {
  /** The person's description. Longer is refused, not truncated. */
  description: 4_000,
  /** The whole prompt, reference and workspace context included. */
  prompt: 40_000,
  /** What the model may answer, per call. */
  outputTokens: 8_000,
  /** The answer we will read, in characters. */
  answer: 60_000,
  /** Files in one draft. */
  files: 6,
} as const;



export interface DraftResult {
  files: DraftFile[];
  issues: DraftIssue[];
  /** True when the first answer had errors and the model was asked once more. */
  repaired: boolean;
  notes: string;
  /** Which supply answered: the workspace's provider or the platform's. */
  supply: "provider" | "platform" | "mock";
}

/** One completion. Injectable: the tests replace the model, and so does a
 *  dev server started with FOLDRUN_DRAFT_MOCK=1. */
export type Completer = (req: {
  system: string;
  prompt: string;
  maxOutputTokens: number;
  tenant: string;
  workspace: string;
}) => Promise<{ text: string; costUsd: number; supply: DraftResult["supply"] }>;

let override: Completer | null = null;
/** Tests only: answer every draft with this instead of a model. */
export function setDraftCompleter(fn: Completer | null) {
  override = fn;
}

/** Refusals with an HTTP status the route passes through. */
function refuse(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

// ---------------------------------------------------------------- prompt

/** The grammar, condensed from flows.md and agents.md. What a model needs to
 *  write a file `foldrun check` accepts, and nothing it does not. */
export const FLOW_REFERENCE = `# foldrun flow and agent files

A flow is flows/<name>.md: YAML frontmatter, then a numbered list of steps.
The number is the GROUP: steps with the same number run in parallel and the
flow waits for all of them before the next number.

---
name: <name>             # same as the file name
trigger: manual          # manual | schedule | webhook
schedule: "0 9 * * 1"    # cron, only when trigger: schedule
timezone: Australia/Sydney
model: default           # fast | default | max — a default for every step
effort: low              # low | medium | high
overlap: skip            # skip | queue
---

1. [[researcher]] — Find three sources on the task.
2. [[writer]] — Draft from what the researcher found.
   verify: judge: the draft cites every source
3?. [[editor]] — Tighten it.        (? = optional, may be skipped)
4!. [[publisher]] — Publish it.     (! = a human approves before it runs)

[[name]] links an agent in agents/<name>/agent.md; [[flow:other]] runs another
flow as a step. The text after the dash is the step's instruction. The run's
task reaches step 1; each step's output reaches the next.

Options, indented three spaces under a step, one per line:
  approve: true | when: <MARKER> | case: <value> / else: true
  retry: 2 (max 5) | timeout: 900 (seconds) | wait: 30m | ask: <question>
  verify: judge: <claim in English> | verify: contains: <text>
  verify: not-contains: <text> | verify: matches: <regex> | verify: file: <path>
  verify: <shell command>   (a bare verify is a SHELL COMMAND, never a sentence)
  model: fast|default|max | effort: low|medium|high
  loop: 3 / until: <condition> (max 5) | each: lines | each: items | max: 10
  output: json | on-fail: [[agent]] | delegate: [[a]], [[b]]

An agent is agents/<name>/agent.md: frontmatter, then prose that IS its
system prompt — what the role is for, what it must not do, what good looks like.

---
name: <name>             # same as the folder name
description: One line on what it does.
model: default           # fast | default | max
tools: [web]             # only what it needs; omit for none
---

You ... (the prompt)

Never put a secret, key or token in either file.`;

export interface DraftContext {
  description: string;
  workspace: string;
  agents: { name: string; description: string; tools: string[] }[];
  flows: string[];
  /** Redrafting an existing flow: its path and what it says now. */
  current: { path: string; content: string } | null;
}

/** The system prompt: who the model is and the shape of its answer. */
export const DRAFT_SYSTEM =
  "You write foldrun flow files. You answer ONLY with files in the exact wrapper the user gives, " +
  "optionally followed by one <notes> element of at most three sentences. No other prose.";

type Repair = { previous: string; issues: DraftIssue[] };

/**
 * The prompt, under DRAFT_LIMITS.prompt. Over it, what gives is the context,
 * in this order: the agent list (the longest part a workspace controls, and
 * the model can still name agents it was not shown — the check then says
 * they do not exist), the flow list, the previous answer quoted for a
 * repair, the current flow quoted for a redraft, and last the repair's
 * issue list. The reference, the request and the answer format never do.
 */
export function draftPrompt(ctx: DraftContext, repair?: Repair): string {
  let c = ctx;
  let r = repair;
  let caps = { current: 12_000, previous: 20_000 };
  for (;;) {
    const prompt = composeDraftPrompt(c, r, caps);
    const over = prompt.length - DRAFT_LIMITS.prompt;
    if (over <= 0) return prompt;
    if (c.agents.length) {
      c = { ...c, agents: c.agents.slice(0, Math.max(0, c.agents.length - Math.ceil(over / 120) - 1)) };
    } else if (c.flows.length) {
      c = { ...c, flows: c.flows.slice(0, Math.max(0, c.flows.length - Math.ceil(over / 16) - 1)) };
    } else if (r && caps.previous > 0) {
      caps = { ...caps, previous: Math.max(0, Math.min(caps.previous, r.previous.length) - over - 64) };
    } else if (c.current && caps.current > 0) {
      caps = { ...caps, current: Math.max(0, Math.min(caps.current, c.current.content.length) - over - 64) };
    } else if (r && r.issues.length > 1) {
      r = { ...r, issues: r.issues.slice(0, Math.max(1, r.issues.length - Math.ceil(over / 80) - 1)) };
    } else {
      return prompt; // the fixed parts alone; nothing context-sized is left to give
    }
  }
}

function composeDraftPrompt(ctx: DraftContext, repair: Repair | undefined, caps: { current: number; previous: number }): string {
  const agentLine = (a: DraftContext["agents"][number]) =>
    `- ${a.name}: ${(a.description || "(no description)").replace(/\s+/g, " ").slice(0, 160)}${a.tools.length ? ` [tools: ${a.tools.slice(0, 8).join(", ")}]` : ""}`;
  const parts: string[] = [
    FLOW_REFERENCE,
    `# The workspace "${ctx.workspace}"`,
    ctx.agents.length
      ? `Agents that already exist — use these wherever one fits, by [[name]]; do NOT write a file for any of them:\n${ctx.agents.map(agentLine).join("\n")}`
      : "There are no agents yet.",
    ctx.flows.length ? `Flows that already exist (do not reuse these names for a new flow): ${ctx.flows.join(", ")}` : "",
    ctx.current
      ? `# The flow being redrafted\nRewrite ${ctx.current.path} — keep its file name and name:. It says now:\n<current>\n${ctx.current.content.slice(0, caps.current)}\n</current>`
      : "",
    `# What the person asked for\n<request>\n${ctx.description}\n</request>`,
    "# Your answer",
    [
      `Write ${ctx.current ? `the new ${ctx.current.path}` : "one flow file, flows/<kebab-name>.md"}` +
        ", and an agents/<kebab-name>/agent.md for each agent the flow needs that does not exist yet (at most " +
        `${DRAFT_LIMITS.files - 1}). Each file whole, exactly like this:`,
      '<file path="flows/example.md">',
      "...the whole file...",
      "</file>",
    ].join("\n"),
  ];
  if (repair) {
    parts.push(
      `# Repair\nYour previous answer was checked and these problems were found:\n${repair.issues
        .map((i) => `- ${i.where}: ${i.message}`)
        .join("\n")}\n\nYour previous answer:\n<previous>\n${repair.previous.slice(0, caps.previous)}\n</previous>\n\nAnswer again with every file, fixed.`,
    );
  }
  return parts.filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------- answer


/** The files in a model's answer, and what was wrong with its shape. */
export function parseDraft(text: string): { files: { path: string; content: string }[]; notes: string; problems: DraftIssue[] } {
  const answer = text.slice(0, DRAFT_LIMITS.answer);
  const files: { path: string; content: string }[] = [];
  const problems: DraftIssue[] = [];
  const re = /<file\s+path="([^"]+)">\r?\n?([\s\S]*?)<\/file>/g;
  for (let m = re.exec(answer); m; m = re.exec(answer)) {
    const p = m[1].trim();
    // A model that fences the file inside the wrapper gets the fence peeled.
    const content = m[2].replace(/^```[a-z]*\n/, "").replace(/\n```\s*$/, "\n").replace(/\s*$/, "\n");
    if (!FLOW_PATH.test(p) && !AGENT_PATH.test(p)) {
      problems.push({ where: p, message: "only flows/<name>.md and agents/<name>/agent.md may be drafted — this file was dropped", level: "error" });
      continue;
    }
    if (files.some((f) => f.path === p)) {
      problems.push({ where: p, message: "written twice — the first copy was kept", level: "warn" });
      continue;
    }
    if (files.length >= DRAFT_LIMITS.files) {
      problems.push({ where: p, message: `more than ${DRAFT_LIMITS.files} files — the rest were dropped`, level: "error" });
      continue;
    }
    files.push({ path: p, content });
  }
  if (!files.some((f) => FLOW_PATH.test(f.path))) {
    problems.push({ where: "flows/", message: "the answer has no flow file", level: "error" });
  }
  const notes = (/<notes>([\s\S]*?)<\/notes>/.exec(answer)?.[1] ?? "").trim().slice(0, 600);
  return { files, notes, problems };
}

/**
 * What is wrong with the draft as part of this workspace: the deploy's own
 * checks over the merged tree, narrowed to the drafted files, and the flow
 * lint `foldrun check` runs.
 */
export function validateDraft(
  tenant: string,
  workspace: string,
  files: { path: string; content: string }[],
  opts: { redrafting?: string | null } = {},
): DraftIssue[] {
  const dir = workspaceDir(tenant, workspace);
  const issues: DraftIssue[] = [];
  const add = (where: string, message: string, level: DraftIssue["level"] = "error") => {
    if (!issues.some((i) => i.where === where && i.message === message)) issues.push({ where, message, level });
  };

  for (const f of files) {
    const exists = fs.existsSync(path.join(dir, f.path));
    const agent = AGENT_PATH.exec(f.path);
    if (agent && exists) add(f.path, `agent ${agent[1]} already exists — link [[${agent[1]}]] as it is, or give the new agent another name`);
    if (FLOW_PATH.test(f.path) && exists && f.path !== opts.redrafting) add(f.path, `${f.path} already exists — pick another name`);
    if (opts.redrafting && FLOW_PATH.test(f.path) && f.path !== opts.redrafting) {
      add(f.path, `this draft redrafts ${opts.redrafting} — write that file, not a new flow`);
    }
    let front: Record<string, unknown>;
    let body = "";
    try {
      const parsed = matter(f.content);
      front = parsed.data as Record<string, unknown>;
      body = parsed.content;
    } catch (err) {
      add(f.path, `the frontmatter does not parse: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      continue;
    }
    if (agent) {
      if (front.name !== undefined && front.name !== agent[1]) add(f.path, `name: ${String(front.name)} does not match its folder, ${agent[1]}`);
      if (!body.trim()) add(f.path, "an agent needs its prompt — the prose after the frontmatter is empty");
    }
  }

  for (const i of mergedIssues(tenant, workspace, files)) add(i.where, i.message, i.level);
  return issues;
}


// ---------------------------------------------------------------- model



const modelCompleter: Completer = async ({ system, prompt, maxOutputTokens, tenant, workspace }) => {
  const m = draftModelEnv(tenant, workspace);
  let text = "";
  let costUsd = 0;
  // Through the step's translator when the provider speaks Chat Completions
  // or Responses (FOL-16).
  await withModelEnv(m, async (env) => {
    const q = query({
      prompt,
      options: {
        model: resolveModel("default"),
        systemPrompt: system,
        tools: [],
        allowedTools: [],
        settingSources: [],
        maxTurns: 1,
        env: { ...hostSafeEnv(), ...env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxOutputTokens) },
      },
    });
    for await (const message of q) {
      if (message.type === "assistant") {
        for (const block of message.message.content) if (block.type === "text") text += block.text;
      } else if (message.type === "result") {
        costUsd = message.total_cost_usd ?? 0;
      }
    }
  });
  return { text, costUsd, supply: m.supply };
};

/** A dev server's stand-in for the model (FOLDRUN_DRAFT_MOCK=1, never in
 *  production): a plausible answer built from the workspace's own agents,
 *  so the dashboard can be exercised without a credential. */
export const mockCompleter: Completer = async ({ prompt }) => {
  const existing = [...prompt.matchAll(/^- ([a-z0-9-]+): /gm)].map((m) => m[1]);
  const redraft = /Rewrite (flows\/[a-z0-9-]+\.md)/.exec(prompt)?.[1];
  const flowPath = redraft ?? "flows/weekly-digest.md";
  const name = path.basename(flowPath, ".md");
  const first = existing.find((n) => /research|gather|find/.test(n)) ?? existing[0] ?? "researcher";
  const second = existing.find((n) => /writ|draft/.test(n)) ?? existing.find((n) => n !== first) ?? first;
  const text = `<file path="${flowPath}">
---
name: ${name}
trigger: schedule
schedule: "0 8 * * 1"
timezone: Australia/Sydney
model: default
overlap: skip
---

1. [[${first}]] — Gather this week's sources on the task: what changed, with links.
   retry: 2
2. [[fact-checker]] — Check every claim against its source; mark anything unsupported.
   verify: judge: every claim names the source it came from
3. [[${second}]] — Write the digest from the checked findings, five items at most.
4!. [[${second}]] — Send the digest once a person has read it.
</file>
<file path="agents/fact-checker/agent.md">
---
name: fact-checker
description: Checks each claim in a list of findings against the source it cites.
model: fast
tools: [web]
---

You check findings before anyone publishes them. For each claim, open the
source it cites and say whether the source supports it: SUPPORTED, PARTLY or
UNSUPPORTED, with the sentence from the source that decides it.

Never add a claim of your own, and never drop one silently — an unsupported
claim stays in the list, marked, so the writer can leave it out on purpose.
</file>
<notes>Uses ${first} and ${second} as they are; adds one agent, fact-checker, for the check between them. Step 4 waits for a person before anything is sent.</notes>`;
  return { text, costUsd: 0, supply: "mock" };
};

function completer(): Completer {
  if (override) return override;
  if (process.env.FOLDRUN_DRAFT_MOCK === "1" && process.env.NODE_ENV !== "production") return mockCompleter;
  return modelCompleter;
}

// ---------------------------------------------------------------- draft

export async function draftFlow(
  tenant: string,
  workspace: string,
  input: { description: string; flow?: string | null },
): Promise<DraftResult> {
  const description = input.description.trim();
  if (!description) throw refuse("describe the flow you want", 400);
  if (description.length > DRAFT_LIMITS.description) {
    throw refuse(`the description is ${description.length} characters — at most ${DRAFT_LIMITS.description}`, 413);
  }
  const dir = workspaceDir(tenant, workspace);
  if (!fs.existsSync(dir)) throw refuse(`no workspace "${workspace}"`, 404);
  // Charged at the prices it started under (30 Oct 2026).
  const pricing = billing().priceSnapshot?.() ?? null;

  const flows = listFlows(tenant, workspace);
  let current: DraftContext["current"] = null;
  if (input.flow) {
    const f = flows.find((x) => x.name === input.flow);
    if (!f) throw refuse(`flow ${input.flow} not found`, 404);
    const rel = `flows/${f.file}`;
    current = { path: rel, content: fs.readFileSync(path.join(dir, rel), "utf8") };
  }
  const ctx: DraftContext = {
    description,
    workspace,
    agents: listAgents(tenant, workspace).map((a) => ({ name: a.name, description: a.description ?? "", tools: a.tools ?? [] })),
    flows: flows.map((f) => f.name),
    current,
  };

  const complete = completer();
  // The platform pays for the call on its own credential, so the account's
  // balance is asked first, as a run's start asks. A provider of the
  // account's own is its own bill.
  const supplyIsPlatform = !override && complete === modelCompleter && draftModelEnv(tenant, workspace).supply === "platform";
  if (supplyIsPlatform) await billing().assertFunds(tenant);

  let cost = 0;
  let supply: DraftResult["supply"] = "platform";
  const ask = async (prompt: string) => {
    const r = await complete({ system: DRAFT_SYSTEM, prompt, maxOutputTokens: DRAFT_LIMITS.outputTokens, tenant, workspace });
    cost += r.costUsd;
    supply = r.supply;
    return r.text;
  };

  try {
    let text = await ask(draftPrompt(ctx));
    let parsed = parseDraft(text);
    let issues = [...parsed.problems, ...validateDraft(tenant, workspace, parsed.files, { redrafting: current?.path })];
    let repaired = false;
    if (issues.some((i) => i.level === "error")) {
      repaired = true;
      text = await ask(draftPrompt(ctx, { previous: text, issues: issues.filter((i) => i.level === "error") }));
      const again = parseDraft(text);
      // A repair that lost every file is worse than the first answer.
      if (again.files.length > 0) {
        parsed = again;
        issues = [...again.problems, ...validateDraft(tenant, workspace, again.files, { redrafting: current?.path })];
      }
    }
    const files: DraftFile[] = parsed.files.map((f) => {
      const abs = path.join(dir, f.path);
      const before = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
      return { ...f, before, sha256: before === null ? null : sha256(before) };
    });
    return { files, issues, repaired, notes: parsed.notes, supply };
  } finally {
    if (supplyIsPlatform && cost > 0) {
      // One line, like a run's, attributed to the drafting rather than to a
      // flow that does not exist yet. A ledger that blinks here must not
      // turn a finished draft into an error.
      await recordRunCost(tenant, workspace, `draft-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`, { tokenCostUsd: cost, steps: 0, computeSecs: 0 }, { flow: "ai-draft", pricing }).catch(
        (err) => console.error(`[foldrun] ai draft: could not record $${cost.toFixed(4)} for ${tenant}: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }
}
