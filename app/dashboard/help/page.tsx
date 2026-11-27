// The whole grammar on one page. Everything here is also in SPEC.md — this
// is the version you can reach from the sidebar mid-edit. If a feature isn't
// on this page, either the feature or this page is wrong; the consistency
// suite can't check that, so keep the two in the same commit.

import { $rich, $t } from "@/i18n";
import fs from "node:fs";
import path from "node:path";
import Link from "@foldrun/ui/react/link";
import type { ReactNode } from "react";
import { WithEmails } from "@/components/email";
import { Page, PageHeader, Panel } from "@foldrun/ui/react/page";
import { ChevronRight } from "lucide-react";
import { designNotes, docsDir, noteTitle, noteSummary } from "./design-notes";

import { requestLocale } from "@/server/locale";
// Per request, not prerendered (28 Oct 2026): the enforced CSP's nonce is
// minted per request, and a static page cannot carry one. The markdown ships
// in the image beside the app for this (foldrun-infra Dockerfile).
export const dynamic = "force-dynamic";

const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-fg">{children}</code>
);

function Table({ rows, head }: { head: [string, string]; rows: [string, string][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-[13px] text-fg-muted">
            <th className="py-1 pr-4 font-medium">{head[0]}</th>
            <th className="py-1 font-medium">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a} className="border-t border-line align-top">
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

export default async function HelpPage() {
  await requestLocale();
  // Read per request — the notes ship in the image and change with a deploy.
  const notes = designNotes().map((slug) => {
    const raw = fs.readFileSync(path.join(docsDir(), `${slug}.md`), "utf8");
    return { slug, title: noteTitle(raw, slug), summary: noteSummary(raw) };
  });

  return (
    <Page width="narrow" className="space-y-8 pb-16">
      <PageHeader
        title={$t("help.page.howFoldrunReadsYourFiles")}
        description={$t("help.page.foldersAreAgentsAFlowIs")}
      />

      <Panel title={$t("help.page.theWorkspaceOnDisk")}>
        <pre className="overflow-x-auto rounded-md border border-line bg-sunken p-3 font-mono text-xs leading-relaxed text-fg-secondary">{`my-workspace/
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
      </Panel>

      <Panel title={$t("help.page.aFlowFile")}>
        <pre className="overflow-x-auto rounded-md border border-line bg-sunken p-3 font-mono text-xs leading-relaxed text-fg-secondary">{`---
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
          <strong>{$rich("help.page.nameMeansTheThingCalledName", { code: (chunks) => <Code>{chunks}</Code> })}</strong>{" "}{$rich("help.page.oneSyntaxEverywhereAndAutocompletesIt", { code: (chunks) => <Code>{chunks}</Code>, em: (chunks) => <em>{chunks}</em> })}
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          {$rich("help.page.theSameBracketWorksInFrontmatter", { strong: (chunks) => <strong>{chunks}</strong>, code: (chunks) => <Code>{chunks}</Code> })}
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          {$rich("help.page.theOneExceptionIsTheShape", { em: (chunks) => <em>{chunks}</em>, code: (chunks) => <Code>{chunks}</Code> })}
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          {$rich("help.page.whereAccumulatedDataLivesFollowsThe", { em: (chunks) => <em>{chunks}</em>, code: (chunks) => <Code>{chunks}</Code> })}
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          {$rich("help.page.theConventionThatKeepsLinksHonest", { strong: (chunks) => <strong>{chunks}</strong>, code: (chunks) => <Code>{chunks}</Code> })}
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          {$rich("help.page.eachStepReceivesThePreviousGroup", { code: (chunks) => <Code>{chunks}</Code> })}
        </p>
        <h3 className="mt-6 text-sm font-medium text-fg">{$t("help.page.triggers")}</h3>
        <Table
          head={["trigger:", "starts when"]}
          rows={[
            ["manual", $t("help.page.aPersonPressesRunTheCli")],
            [$t("help.page.scheduleSchedule"), $t("help.page.theCronMatchesTimezoneSaysWhere")],
            [$t("help.page.onceAt"), $t("help.page.oneIsoInstantPassesFiresOnce")],
            ["webhook", $t("help.page.aPostHitsTheFlowS")],
            ["email", $t("help.page.aMessageReachesTheFlowS")],
            [$t("help.page.flowAfterOn"), $t("help.page.anotherFlowFinishes")],
            [$t("help.page.storagePath"), $t("help.page.aFileLandsUnderThatStorage")],
            [$t("help.page.watchUrlEvery"), $t("help.page.thePageAtTheUrlChanges")],
          ]}
        />
        <h3 className="mt-6 text-sm font-medium text-fg">{$t("help.page.stepMarkers")}</h3>
        <Table
          head={["marker", "meaning"]}
          rows={[
            ["2.", $t("help.page.step2RepeatANumberTo")],
            ["2?", $t("help.page.optionalItsFailureDoesNotFail")],
            ["2!", $t("help.page.stopsAndWaitsForHumanApproval")],
            ["[[flow:weekly]]", $t("help.page.aWholeFlowAsOneStep")],
          ]}
        />
        <h3 className="mt-6 text-sm font-medium text-fg">
          {$t("help.page.stepOptionsIndentedLinesUnderThe")}
        </h3>
        <Table
          head={["option", $t("help.page.whatItDoes")]}
          rows={[
            ["timeout: 2700", $t("help.page.secondsOr45m2hBeforeThe")],
            ["retry: 2", $t("help.page.attemptsAfterAFailureMax5")],
            ["verify: test -s out.md", $t("help.page.shellCheckThatMustPassOr")],
            ["output: json", $t("help.page.theReplyEndsWithOneJson")],
            ["each: items", $t("help.page.fanOutOneInstancePerElement")],
            ["parallel: 3", $t("help.page.withEachHowManyInstancesRun")],
            ["schema: {...} or schema: path.json", $t("help.page.withOutputJsonAJsonSchema")],
            ["max_turns: 20", $t("help.page.howManyModelTurnsTheStep")],
            ["max_output_tokens: 16000", $t("help.page.theLongestOneModelReplyMay")],
            ["limits: {web.search: 10}", $t("help.page.howManyCallsTheStepMay")],
            ["when: READY", $t("help.page.runOnlyIfALineOf")],
            ["when: rows of workspace/storage/x.csv", $t("help.page.runOnlyIfThatCsvHas")],
            ["case: <label> / else:", $t("help.page.routeToExactlyOneStepOf")],
            ["loop: 3 + until: APPROVED", $t("help.page.repeatMax5UntilThePhrase")],
            ["each: lines + max: 10", $t("help.page.fanOutOneInstancePerLine")],
            ["model: / effort:", $t("help.page.overrideForThisStepNearestWins")],
            ["approve: true", $t("help.page.longFormOfTheMarker")],
            ["on-fail: other-agent", $t("help.page.whenThisStepFailsThatAgent")],
            ["wait: 3d", $t("help.page.holdBeforeThisStepRunsS")],
            ["wait: event", $t("help.page.holdUntilSomethingPostsTheRun")],
            ["each: rows of workspace/storage/x.csv", $t("help.page.fanOutOneInstancePerCsv")],
            ["ask: which subject line?", $t("help.page.parksLikeAnApprovalButCarries")],
            ["preview: draft/*.mdx, draft/images/*.webp", $t("help.page.whatTheApprovalBoxShowsFor")],
            ["delegate: a, b, c", $t("help.page.thisStepS")],
          ]}
        />
        <p className="mt-3 text-sm text-fg-tertiary">
          {$rich("help.page.whenCaseAndUntilReadMarkers", { code: (chunks) => <Code>{chunks}</Code> })}
        </p>
      </Panel>

      <Panel title={$t("help.page.whenARunWaitsForYou")}>
        <p className="mt-2 text-sm text-fg-tertiary">
          {$rich("help.page.aStepWithAskOrA", { code: (chunks) => <Code>{chunks}</Code> })}
        </p>
        <p className="mt-2 text-sm text-fg-tertiary">
          {$t("help.page.openTheRunAndTheWaiting")}
        </p>
        <Table
          head={["you do", "what happens"]}
          rows={[
            [$t("help.page.approveBoxEmpty"), $t("help.page.theStepProceedsAsItsPrompt")],
            [$t("help.page.approveWithAnInstruction"), $t("help.page.theStepReadsYourTextAnd")],
            ["Reject", $t("help.page.theStepDoesNotRunThe")],
          ]}
        />
        <p className="mt-2 text-sm text-fg-tertiary">
          {$t("help.page.answerSoonRatherThanPerfectlyA")}
        </p>

      </Panel>

      <Panel title={$t("help.page.anAgentFile")}>
        <pre className="overflow-x-auto rounded-md border border-line bg-sunken p-3 font-mono text-xs leading-relaxed text-fg-secondary">{`---
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
          {$rich("help.page.aNameInToolsThatIs", { code: (chunks) => <Code>{chunks}</Code> })}
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          {$rich("help.page.bringYourOwnModelKeyA", { strong: (chunks) => <strong>{chunks}</strong>, code: (chunks) => <Code>{chunks}</Code> })}
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          {$rich("help.page.theFormatModelsTwoKnobsAnd", { code: (chunks) => <Code>{chunks}</Code> })}
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          {$rich("help.page.twoGroupsAreThePlatformS", { code: (chunks) => <Code>{chunks}</Code> })}
        </p>
        <p className="mt-3 text-sm text-fg-tertiary">
          {$rich("help.page.toolsIsTheOneListIt", { code: (chunks) => <Code>{chunks}</Code>, em: (chunks) => <em>{chunks}</em> })}
        </p>
      </Panel>

      <Panel title={$t("help.page.aToolFile")}>
        <pre className="overflow-x-auto rounded-md border border-line bg-sunken p-3 font-mono text-xs leading-relaxed text-fg-secondary">{`---
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
          {$rich("help.page.httpToolsDeclareAUrlAnd", { code: (chunks) => <Code>{chunks}</Code> })}
        </p>
      </Panel>

      <Panel title={$t("help.page.skillsKnowledgeMemory")}>
        <Table
          head={["kind", $t("help.page.whatItIs")]}
          rows={[
            ["skills/<name>.md", $t("help.page.aHowToLoadedOnlyWhen")],
            ["knowledge/*.md", $t("help.page.curatedContextAPersonGaveThe")],
            ["memory/*.md", $t("help.page.theSameFormatWrittenByAgents")],
          ]}
        />
      </Panel>

      <Panel title={$t("help.page.workspaceFrontmatterAgentsMd")}>
        <Table
          head={["key", $t("help.page.whatItDoes")]}
          rows={[
            ["notify: you@co.com", $t("help.page.emailOrWebhookUrlForRun")],
            ["budget: 50", $t("help.page.spendCapInUsdPerMonth")],
            ["provider:", $t("help.page.routeModelCalls")],
          ]}
        />
        <p className="mt-3 text-sm text-fg-tertiary">
          {$t("help.page.everythingOnThisPageIsPlain")}
        </p>
      </Panel>

      {notes.length > 0 && (
        <Panel title={$t("help.page.designNotes")}>
          <p className="mt-1 text-sm text-fg-tertiary">
            {$rich("help.page.whyTheFormatIsShapedThis", { em: (chunks) => <em>{chunks}</em> })}
          </p>
          <ul className="-mx-5 -mb-5 mt-4 divide-y divide-line border-t border-line">
            {notes.map(({ slug, title, summary }) => (
              <li key={slug}>
                <Link href={`/dashboard/help/notes/${slug}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-sunken">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-fg">{title}</span>
                    {summary && <span className="mt-0.5 block text-sm text-fg-muted">{summary}…</span>}
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-subtle" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </Page>
  );
}
