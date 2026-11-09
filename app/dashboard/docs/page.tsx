// The docs index.
//
// Help answers "what does this field mean" mid-edit. This answers the two
// questions that come before that: how do I start, and how do I drive it from
// somewhere else. Both were only answerable from a checkout until now — the
// CLI and the HTTP API were documented in the repo and nowhere a user could
// reach, which is the same failure as prose that reached no model.

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
        title="Docs"
        description="Agents are just folders and flows are numbered lists, so there is no build step: edit, check, run, deploy. Start on your own machine — none of it needs an account."
      />

      <Panel title="The loop" className="mb-10">
        <pre className="overflow-x-auto rounded-md border border-line bg-sunken p-3 font-mono text-xs leading-relaxed text-fg-secondary">{`npm install -g foldrun

foldrun init my-workspace     # a workspace that already runs
foldrun check                 # validate everything — no model is called
foldrun run publish           # run it, locally, for real
foldrun deploy --url …        # push it here`}</pre>
        <p className="mt-3 text-sm text-fg-muted">
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-fg">check</code> is free and catches a broken flow at push time rather than at 3am when its schedule fires. Run it after edits, the way you would run a typecheck.
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
        <SectionTitle title="Also" />
        <DocGrid>
          <DocCard
            href="/dashboard/help"
            icon={<BookOpen />}
            title="How foldrun reads your files"
            summary="The whole grammar on one page — every field an agent or a flow can carry, and what each one does. The page to keep open while editing."
          />
          <div className="flex h-full min-w-0 gap-3 rounded-lg border border-line bg-surface p-5">
            <IconBox>
              <Bot />
            </IconBox>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-fg">Using Claude Code?</h3>
              <p className="mt-1 text-sm leading-relaxed text-fg-muted">
                A subagent at <code className="font-mono text-xs">.claude/agents/&lt;name&gt;.md</code> deploys as an agent here — no conversion. <code className="font-mono text-xs">init</code> also writes a CLAUDE.md so your editor
                knows the conventions instead of guessing.
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
