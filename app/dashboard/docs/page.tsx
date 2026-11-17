// The docs index.
//
// Help answers "what does this field mean" mid-edit. This answers the two
// questions that come before that: how do I start, and how do I drive it from
// somewhere else. Both were only answerable from a checkout until now — the
// CLI and the HTTP API were documented in the repo and nowhere a user could
// reach, which is the same failure as prose that reached no model.

import { $rich, $t } from "@/i18n";
import fs from "node:fs";
import path from "node:path";
import Link from "@foldrun/ui/react/link";
import { Page, PageHeader, Panel, SectionTitle, IconBox } from "@foldrun/ui/react/page";
import { BookOpen, FileText, Bot } from "lucide-react";
import { docsDir, groupedDocs, docTitle, docSummary } from "@/docs-index";

// Per request, not prerendered (28 Oct 2026): the enforced CSP's nonce is
// minted per request, and a static page cannot carry one. The markdown ships
// in the image beside the app for this (foldrun-infra Dockerfile).
export const dynamic = "force-dynamic";

export default function DocsPage() {
  // Read per request: the docs ship in the image and change with a deploy.
  const groups = groupedDocs().map((g) => ({
    ...g,
    docs: g.slugs.map((slug) => {
      const raw = fs.readFileSync(path.join(docsDir(), `${slug}.md`), "utf8");
      return { slug, title: docTitle(raw, slug), summary: docSummary(raw) };
    }),
  }));

  return (
    <Page className="pb-16">
      <PageHeader
        title={$t("docs.page.docs")}
        description={$t("docs.page.agentsAreJustFoldersAndFlows")}
      />

      <Panel title={$t("docs.page.theLoop")} className="mb-10">
        <pre className="overflow-x-auto rounded-md border border-line bg-sunken p-3 font-mono text-xs leading-relaxed text-fg-secondary">{`npm install -g foldrun

foldrun init my-workspace     # a workspace that already runs
foldrun check                 # validate everything — no model is called
foldrun run publish           # run it, locally, for real
foldrun deploy --url …        # push it here`}</pre>
        <p className="mt-3 text-sm text-fg-muted">
          {$rich("docs.page.checkIsFreeAndCatchesA", { code: (chunks) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-fg">{chunks}</code> })}
        </p>
      </Panel>

      {groups.map((group) => (
        <section key={group.title} className="mb-10">
          <SectionTitle title={group.title} description={group.blurb} />
          <DocGrid>
            {group.docs.map((doc) => (
              <DocCard key={doc.slug} href={`/dashboard/docs/${doc.slug}`} icon={<FileText />} title={doc.title} summary={doc.summary} />
            ))}
          </DocGrid>
        </section>
      ))}

      <section>
        <SectionTitle title={$t("docs.page.also")} />
        <DocGrid>
          <DocCard
            href="/dashboard/help"
            icon={<BookOpen />}
            title={$t("docs.page.howFoldrunReadsYourFiles")}
            summary={$t("docs.page.theWholeGrammarOnOnePage")}
          />
          <div className="flex h-full min-w-0 gap-3 rounded-lg border border-line bg-surface p-5">
            <IconBox>
              <Bot />
            </IconBox>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-fg">{$t("docs.page.usingClaudeCode")}</h3>
              <p className="mt-1 text-sm leading-relaxed text-fg-muted">
                {$rich("docs.page.aSubagentAtClaudeAgentsName", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}
              </p>
            </div>
          </div>
        </DocGrid>
      </section>
    </Page>
  );
}

function DocGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>;
}

function DocCard({ href, icon, title, summary }: { href: string; icon: React.ReactNode; title: string; summary: string }) {
  return (
    <Link href={href} className="flex h-full min-w-0 gap-3 rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-strong">
      <IconBox>{icon}</IconBox>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-fg-muted">{summary}</p>
      </div>
    </Link>
  );
}
