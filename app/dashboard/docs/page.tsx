// The docs index.
//
// Help answers "what does this field mean" mid-edit. This answers the two
// questions that come before that: how do I start, and how do I drive it from
// somewhere else. Both were only answerable from a checkout until now — the
// CLI and the HTTP API were documented in the repo and nowhere a user could
// reach, which is the same failure as prose that reached no model.

import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
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
    <main className="mx-auto max-w-7xl px-6 py-8">
      <PageHeader
        title="Docs"
        subtitle="Agents are just folders and flows are numbered lists, so there is no build step: edit, check, run, deploy. Start on your own machine — none of it needs an account."
      />

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-fg">The loop</h2>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-ink p-3 font-mono text-xs leading-relaxed text-gray-100">{`npm install -g foldrun

foldrun init my-workspace     # a workspace that already runs
foldrun check                 # validate everything — no model is called
foldrun run publish           # run it, locally, for real
foldrun deploy --url …        # push it here`}</pre>
        <p className="mt-3 text-sm text-fg-tertiary">
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-gray-800">check</code>{" "}
          is free and catches a broken flow at push time rather than at 3am when its schedule fires.
          Run it after edits, the way you would run a typecheck.
        </p>
      </Card>

      {groups.map((group) => (
        <section key={group.title} className="mt-8">
          <h2 className="text-sm font-semibold text-fg">{group.title}</h2>
          <p className="mt-1 text-sm text-fg-muted">{group.blurb}</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {group.docs.map((doc) => (
              <Link key={doc.slug} href={`/dashboard/docs/${doc.slug}`} className="block">
                <Card className="h-full p-4 transition-shadow hover:shadow-md">
                  <h3 className="text-sm font-semibold text-fg">{doc.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-fg-tertiary">{doc.summary}</p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fg">Also</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link href="/dashboard/help" className="block">
            <Card className="h-full p-4 transition-shadow hover:shadow-md">
              <h3 className="text-sm font-semibold text-fg">How foldrun reads your files</h3>
              <p className="mt-1 text-sm leading-relaxed text-fg-tertiary">
                The whole grammar on one page — every field an agent or a flow can carry, and what
                each one does. The page to keep open while editing.
              </p>
            </Card>
          </Link>
          <Card className="h-full p-4">
            <h3 className="text-sm font-semibold text-fg">Using Claude Code?</h3>
            <p className="mt-1 text-sm leading-relaxed text-fg-tertiary">
              A subagent at <code className="font-mono text-[12px]">.claude/agents/&lt;name&gt;.md</code>{" "}
              deploys as an agent here — no conversion. <code className="font-mono text-[12px]">init</code>{" "}
              also writes a CLAUDE.md so your editor knows the conventions instead of guessing.
            </p>
          </Card>
        </div>
      </section>
    </main>
  );
}
