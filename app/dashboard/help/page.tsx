// The whole grammar on one page. Everything here is also in SPEC.md — this
// is the version you can reach from the sidebar mid-edit. If a feature isn't
// on this page, either the feature or this page is wrong; the consistency
// suite can't check that, so keep the two in the same commit.

import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import type { ReactNode } from "react";
import { WithEmails } from "@/components/email";
import { Card, PageHeader } from "@/components/ui";
import { designNotes, docsDir, noteTitle, noteSummary } from "./design-notes";

export const dynamic = "force-static";

const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-gray-800">{children}</code>
);

function Table({ rows, head }: { head: [string, string]; rows: [string, string][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-fg-subtle">
            <th className="py-1 pr-4 font-medium">{head[0]}</th>
            <th className="py-1 font-medium">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a} className="border-t border-line-faint align-top">
              <td className="whitespace-nowrap py-1.5 pr-4">
                <Code>
                  <WithEmails text={a} />
                </Code>
              </td>
              <td className="py-1.5 text-fg-tertiary">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HelpPage() {
  // Read at build time — the notes ship in the image and change with a deploy.
  const notes = designNotes().map((slug) => {
    const raw = fs.readFileSync(path.join(docsDir(), `${slug}.md`), "utf8");
    return { slug, title: noteTitle(raw, slug), summary: noteSummary(raw) };
  });

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <PageHeader
        title="How foldrun reads your files"
        subtitle="Folders are agents, a flow is a numbered list of links, and every capability is a file the agent names in its frontmatter. This page is the whole grammar."
      />

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-fg">The workspace, on disk</h2>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-sunken p-3 font-mono text-xs leading-relaxed text-fg-secondary">{`my-workspace/
  AGENTS.md              workspace-wide rules · notify: · budget:
  agents/<name>/agent.md one folder per agent — the folder IS the agent
  flows/<name>.md        orchestration: a numbered list of [[agent]] links
  tools/<name>.md        a capability: one file, code fenced inside it
  skills/<name>.md       a how-to the agent loads when it applies
  knowledge/*.md         what YOU gave the agents      (OKF format)
  memory/*.md            what agents LEARNED and wrote (OKF format)
  storage/               run artifacts — what steps produce and consume;
                         NOT carried by a deploy or export
  state/                 the workspace's own memory between runs — small,
                         inspectable, travels with the workspace
  evals/                 graded checks for your agents`}</pre>
      </Card>

      <Card className="mt-4 p-4">
        <h2 className="text-sm font-semibold text-fg">A flow file</h2>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-sunken p-3 font-mono text-xs leading-relaxed text-fg-secondary">{`---
name: extract-and-send
trigger: schedule          # manual | schedule | once | webhook | email | flow | storage | watch
schedule: "0 8 * * *"      # 5-field cron…
timezone: Australia/Sydney # …read in this IANA zone
overlap: skip              # skip | queue — what a new fire does mid-run
budget: 5                  # the most one run may spend, USD — checked between steps
---

1. [[extractor]] — read [[sources-of-leads]], build the list into storage/leads.csv
   timeout: 2700
2. [[enricher]] — fill the gaps in [[storage/leads.csv]]   ← same number:
2. [[bouncecheck]] — verify its emails                   ← these two run in parallel
3! [[uploader]] — import into the CRM                    ← ! waits for a human`}</pre>
        <p className="mt-3 text-sm text-fg-tertiary">
          <strong><Code>{"[[name]]"}</Code> means &ldquo;the thing called name&rdquo;</strong> —
          one syntax, everywhere, and <Code>{"[["}</Code> autocompletes it. Wherever prose reaches
          a model, a link becomes that thing&rsquo;s path: a knowledge or memory document
          (<Code>{"[[sources-of-conveyancers]]"}</Code>), a stored file
          (<Code>{"[[storage/leads.csv]]"}</Code>), or a folder when you need to say <em>where</em>{" "}
          without naming a file (<Code>{"[[storage/]]"}</Code>, <Code>{"[[state/]]"}</Code>). Names
          match on filename or the doc&rsquo;s <Code>title:</Code>/<Code>name:</Code>, blind to
          hyphens, underscores and case; anything unmatched passes through untouched, so a typo
          never breaks a run.
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          The same bracket works in frontmatter, under one rule: <strong>if it names a file, you
          can link it.</strong> <Code>tools:</Code>, <Code>skills:</Code>, <Code>agents:</Code>, a
          step&rsquo;s <Code>delegate:</Code> and a flow&rsquo;s <Code>after:</Code> all take{" "}
          <Code>{"- [[site_repo]]"}</Code> or a bare <Code>site_repo</Code> and read them as the same
          name; secrets, model and size are values, never linked. The brackets say one extra thing:
          &ldquo;this is my file&rdquo; — so in <Code>tools:</Code> a bare <Code>search</Code> is the
          platform group and <Code>{"[[search]]"}</Code> is your <Code>tools/search.md</Code>. Use
          the block form when linking; YAML reads <Code>{"[[x]]"}</Code> as a nested list, which
          works but makes an inline mix hard to read.
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          The one exception is the shape of a step line: its <em>first</em> link is the agent the
          step <em>runs</em>, not a path to read. Every other link on that same line resolves
          normally — <Code>{"1. [[extractor]] — read [[sources]] and write storage/x.csv"}</Code>{" "}
          runs the extractor and hands it the real path to the sources document.
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          Where accumulated data lives follows the same discipline: a value{" "}
          <em>regenerated</em> each run (a cache, a fetched list) is a run artifact —{" "}
          <Code>storage/</Code>. A value <em>accumulated</em> across runs (a ledger of dead ends,
          filed briefs) is workspace memory — <Code>state/</Code> — because it must travel when the
          workspace does.
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          The convention that keeps links honest: <strong>link what you read, spell out what you
          write.</strong> A link points at something that exists — an input. An output
          (<Code>write the result to workspace/storage/x.csv</Code>) doesn&rsquo;t exist yet, so it stays
          a literal path.
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          Each step receives the previous group&rsquo;s results automatically. Big artifacts ride{" "}
          <Code>storage/</Code>. A step can run another flow with <Code>[[flow:name]]</Code>.
        </p>
        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Triggers</h3>
        <Table
          head={["trigger:", "starts when"]}
          rows={[
            ["manual", "a person presses Run, the CLI invokes it, or the API is called"],
            ["schedule + schedule:", "the cron matches — timezone: says where"],
            ["once + at:", "one ISO instant passes — fires once, never again"],
            ["webhook", "a POST hits the flow's hook URL; add signature: github | stripe | slack | hmac and signing_secret: ${NAME} to have the sender's HMAC checked"],
            ["email", "a message reaches the flow's inbox URL from Resend, Postmark, Mailgun, SendGrid or an email worker — from, subject and text become the task"],
            ["flow + after: + on:", "another flow of this workspace finishes (completed by default, or failed / any) — its conclusion becomes the task"],
            ["storage + path:", "a file lands under that storage/ prefix — an upload, an API write, another flow's output"],
            ["watch + url: + every:", "the page at the URL changes, polled every 15m by default — the new content becomes the task"],
          ]}
        />
        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Step markers</h3>
        <Table
          head={["marker", "meaning"]}
          rows={[
            ["2.", "step 2 — repeat a number to run steps in parallel"],
            ["2?", "optional: its failure does not fail the flow"],
            ["2!", "stops and waits for human approval before running"],
            ["[[flow:weekly]]", "a whole flow as one step"],
          ]}
        />
        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          Step options — indented lines under the step
        </h3>
        <Table
          head={["option", "what it does"]}
          rows={[
            ["timeout: 2700", "seconds (or 45m, 2h) before the step is stopped"],
            ["retry: 2", "attempts after a failure (max 5)"],
            ["verify: test -s out.md", "shell check that must pass or the step fails — the step's final turn is in the file $FOLDRUN_REPLY_FILE — or contains: / not-contains: / matches: / file: / judge:, the eval vocabulary"],
            ["output: json", "the reply ends with one JSON value; the next step gets it as data, and a shell verify: reads it on stdin"],
            ["each: items", "fan out — one instance per element of the previous step's output: json array"],
            ["parallel: 3", "with each: — how many instances run at once (default: all)"],
            ["schema: {...} or schema: path.json", "with output: json — a JSON Schema the reply must satisfy, or the step fails"],
            ["max_turns: 20", "how many model turns the step may take before it is stopped"],
            ["limits: {web.search: 10}", "how many calls the step may make, per tool or in all — over the agent's limits:, key by key"],
            ["when: READY", "run only if a line of the previous group's result begins with READY"],
            ["when: rows of workspace/storage/x.csv", "run only if that CSV has a data row — for the steps after a fan-out"],
            ["case: <label> / else:", "route to exactly one step of a group"],
            ["loop: 3 + until: APPROVED", "repeat (max 5) until the phrase appears in the result"],
            ["each: lines + max: 10", "fan out — one instance per line of the previous result"],
            ["model: / effort:", "override for this step — nearest wins: step, flow, agent"],
            ["approve: true", "long form of the ! marker"],
            ["on-fail: other-agent", "when this step fails, that agent takes it over — its success continues the flow with its result"],
            ["wait: 3d", "hold before this step runs (s/m/h/d, max 30d) — the run parks in the queue, not in a process"],
            ["wait: event", "hold until something POSTs the run's event URL (printed in the step's trace) — the body reaches the step; a person can still release it here"],
            ["each: rows of workspace/storage/x.csv", "fan out one instance per CSV row, each carrying the header"],
            ["ask: which subject line?", "parks like an approval, but carries a question — the typed answer reaches the step's prompt"],
            ["preview: draft/*.mdx, draft/images/*.webp", "what the approval box shows for a gated step — paths under storage/, globs allowed, resolved when the run parks"],
            ["delegate: a, b, c", "this step's agent picks which of THESE agents run next, one instruction each — the choice set is yours, the picks are the model's"],
          ]}
        />
        <p className="mt-3 text-sm text-fg-tertiary">
          <Code>when:</Code>, <Code>case:</Code> and <Code>until:</Code> read markers, not
          meaning: a line of the previous result that begins with the word (for{" "}
          <Code>until:</Code>, a line that is the word). No model decides them. Write the verdict as
          a headline and they agree with what the agent meant.
        </p>
      </Card>

      <Card className="mt-4 p-4">
        <h2 className="text-sm font-semibold text-fg">When a run waits for you</h2>
        <p className="mt-2 text-sm text-fg-tertiary">
          A step with <Code>ask:</Code> (or a <Code>2!</Code> marker) parks the run until a person
          answers. Parking is durable — the run survives restarts and waits days if it has to — and
          the platform tells you three ways: the amber banner across every dashboard page, the
          run&rsquo;s row on the Runs page, and an email if the workspace&rsquo;s{" "}
          <Code>notify:</Code> includes <Code>awaiting-approval</Code>.
        </p>
        <p className="mt-2 text-sm text-fg-tertiary">
          Open the run and the waiting step shows the question, an answer box, and two buttons. The
          box is not decoration: whatever you type reaches the step as its instruction, so the gate
          is a conversation, not a switch.
        </p>
        <Table
          head={["you do", "what happens"]}
          rows={[
            ["Approve, box empty", "the step proceeds as its prompt already says"],
            ["Approve, with an instruction", "the step reads your text and follows it — \u201cpublish, but change the title to X\u201d steers without rejecting a whole run"],
            ["Reject", "the step does not run; the run ends without doing the gated thing"],
          ]}
        />
        <p className="mt-2 text-sm text-fg-tertiary">
          Answer soon rather than perfectly: a parked run is money already spent on the steps before
          the gate, holding for one decision. If the answer needs work first, reject with a note —
          the run history keeps the question and your reason.
        </p>

        <h2 className="text-sm font-semibold text-fg">An agent file</h2>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-sunken p-3 font-mono text-xs leading-relaxed text-fg-secondary">{`---
name: extractor
description: Builds the NSW conveyancer list
model: sonnet              # tier, alias, or full model id
tools:                     # one list: built-ins bare, your files linked
  - read
  - [[browser]]
  - [[crm-known]]
secrets: [OI_CRM_API_KEY]  # vault entries its tools may read
agents: [enricher]         # colleagues it may consult mid-run
---

You build lead lists. Read [[sources-of-leads]] first,
and skip what we already have…          ← the prompt; the link
                                          becomes the real path`}</pre>
        <p className="mt-3 text-sm text-fg-tertiary">
          A name in <Code>tools:</Code> that is not a built-in resolves against the workspace&rsquo;s{" "}
          <Code>tools/</Code> first, then the account Library — one copy of a shared tool, every
          workspace&rsquo;s agents can ask for it.
          Secrets are substituted server-side; the model never sees the values.
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          <strong>Bring your own model key.</strong> A <Code>provider:</Code> block in AGENTS.md (the whole
          workspace) or in one agent names the endpoint and the secret:{" "}
          <Code>{"provider: { name: groq, token: ${GROQ_API_KEY} }"}</Code>. Anthropic-shaped providers —
          Anthropic, OpenRouter, DeepSeek, Kimi, z.ai, Qwen, Vercel&rsquo;s gateway, your own LiteLLM — are
          spoken to directly. OpenAI, Gemini, xAI, Groq, Mistral, Together, Hugging Face and Cloudflare speak
          Chat Completions, and <Code>format: openai</Code> reaches them through the runtime&rsquo;s own
          translator inside the run sandbox. <Code>auth: x-api-key</Code> for the few that want the key in
          that header. <Code>foldrun probe &lt;model&gt;</Code> proves a key holds a tool loop before a run
          depends on it.
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          The format models two knobs and no more: <Code>model:</Code> and <Code>effort:</Code>. Everything
          else a provider accepts goes in <Code>params:</Code> on the provider block, merged into the request
          verbatim — <Code>temperature</Code>, <Code>seed</Code>, <Code>response_format</Code>, a gateway&rsquo;s
          own routing. A <Code>null</Code> value removes a field instead of setting it, which is how you stop
          sending <Code>temperature</Code> to an endpoint that rejects it. It applies to a{" "}
          <Code>format: openai</Code> provider; an Anthropic-shaped one is spoken to directly, so set its
          knobs at the provider.
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          Two groups are the platform&rsquo;s own: <Code>tools: [search]</Code> gives{" "}
          <Code>search_files(query)</Code>, ranked full-text search over the agent&rsquo;s knowledge,
          memory, state and storage at every scope (lexical, on the box — nothing leaves it), and{" "}
          <Code>tools: [history]</Code> gives <Code>recall_runs()</Code> and <Code>read_run(id)</Code>,
          the workspace&rsquo;s last thirty finished runs and what they concluded, so a scheduled flow
          continues where yesterday&rsquo;s left off instead of redoing it. <Code>tools: [peers]</Code> gives{" "}
          <Code>peers_list()</Code> and <Code>peers_message(to, text)</Code>: the other steps running beside
          it in its parallel group, and a message to one of them, which reaches that agent after its next
          tool call — a step asks a colleague for what it has instead of guessing or failing.
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          <Code>tools:</Code> is the one list. It accepts everything — built-in groups, SDK names,{" "}
          <em>and</em> your own tools — with built-ins winning a name clash, so a Claude Code agent
          drops in unchanged. Name a tool of yours after a built-in and the run says it was
          shadowed — write <Code>{"[[name]]"}</Code> to mean yours. The older <Code>use:</Code> key is no longer read: an agent
          that still has one gets an error quoting the <Code>tools:</Code> line to write, and{" "}
          <Code>node scripts/migrate-use-to-tools.mjs .</Code> rewrites every agent in a folder.
        </p>
      </Card>

      <Card className="mt-4 p-4">
        <h2 className="text-sm font-semibold text-fg">A tool file</h2>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-sunken p-3 font-mono text-xs leading-relaxed text-fg-secondary">{`---
transport: script          # script | http | mcp
name: crm-upload
description: Upload a lead CSV to the CRM
args:
  csv: the file to upload
  dry: "true (default) previews; false commits"
timeout: 600
---

Prose for the agent, then the implementation:

\`\`\`js
// the fenced block IS the tool — args arrive parsed,
// secrets arrive as environment variables
\`\`\``}</pre>
        <p className="mt-3 text-sm text-fg-tertiary">
          <Code>http</Code> tools declare a URL and headers (with <Code>{"${SECRET}"}</Code>{" "}
          placeholders); <Code>mcp</Code> tools point at an MCP server. Scripts run inside the
          run&rsquo;s sandbox with <Code>FOLDRUN_RUN_ID</Code>, <Code>FOLDRUN_AGENT</Code> and{" "}
          <Code>FOLDRUN_DATE</Code> in their environment for stamping provenance.
        </p>
      </Card>

      <Card className="mt-4 p-4">
        <h2 className="text-sm font-semibold text-fg">Skills, knowledge, memory</h2>
        <Table
          head={["kind", "what it is"]}
          rows={[
            ["skills/<name>.md", "a how-to, loaded only when its description applies; `when: <tag>` limits it to runs tagged that way"],
            ["knowledge/*.md", "curated context a person gave the agents — OKF bundles with a `type:` field"],
            ["memory/*.md", "the same format, written by agents as they learn"],
          ]}
        />
      </Card>

      <Card className="mt-4 p-4">
        <h2 className="text-sm font-semibold text-fg">Workspace frontmatter (AGENTS.md)</h2>
        <Table
          head={["key", "what it does"]}
          rows={[
            ["notify: you@co.com", "email (or webhook URL) for run events; `events: [failed, completed, awaiting-approval]` narrows it"],
            ["budget: 50", "spend cap in USD per month — or `50/day`, `50/week`; unset is no limit. At the cap, new runs are refused until the window turns (running ones finish)"],
            ["provider:", "route this workspace's model calls through your own gateway or key"],
          ]}
        />
        <p className="mt-3 text-sm text-fg-tertiary">
          Everything on this page is plain markdown in your workspace — editable here in the
          dashboard, or in any editor, and every change is an ordinary git diff.
        </p>
      </Card>

      {notes.length > 0 && (
        <Card className="mt-4 p-4">
          <h2 className="text-sm font-semibold text-fg">Design notes</h2>
          <p className="mt-1 text-sm text-fg-tertiary">
            Why the format is shaped this way, and where it deliberately stops. The rest of this
            page is what the grammar <em>is</em>; these are the decisions behind it.
          </p>
          <ul className="mt-3 space-y-3">
            {notes.map(({ slug, title, summary }) => (
              <li key={slug}>
                <Link
                  href={`/dashboard/help/notes/${slug}`}
                  className="text-sm font-medium text-fg hover:underline"
                >
                  {title}
                </Link>
                {summary && <p className="mt-0.5 text-sm text-fg-tertiary">{summary}…</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
