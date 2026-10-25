// Design notes, rendered from the repo's own docs/*.md.
//
// These are the decision records — why the platform scales the way it does,
// where the flow grammar stops. They were written for the repo, which means
// the people who most need them (anyone editing a flow, anyone sizing the
// box) could not reach them without a checkout. Same files, same words,
// reachable from the sidebar.
//
// Read at build time, not per request: the docs ship in the image and change
// only when a deploy does, so this is static like the rest of help.

import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { designNotes, docsDir, noteTitle } from "../../design-notes";

export const dynamic = "force-static";

export function generateStaticParams() {
  return designNotes().map((slug) => ({ doc: slug }));
}

export default async function NotePage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  // The slug indexes a known list — never joined from the request — so a
  // crafted `doc` cannot walk out of docs/.
  if (!designNotes().includes(doc)) notFound();

  const raw = fs.readFileSync(path.join(docsDir(), `${doc}.md`), "utf8");

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <PageHeader title={noteTitle(raw, doc)} subtitle="A design note from the repo — why, not how." />
      <Link href="/dashboard/help" className="text-sm text-fg-muted hover:text-fg">
        ← Back to help
      </Link>
      <Card className="mt-4 p-6">
        <Markdown text={raw} />
      </Card>
    </main>
  );
}
