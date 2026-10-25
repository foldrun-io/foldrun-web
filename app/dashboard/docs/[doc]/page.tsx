// One doc, rendered from the repo's own docs/*.md.
//
// Same files, same words, no second copy to drift. Read at build time rather
// than per request: the docs ship in the image and change only when a deploy
// does.

import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { allDocs, docsDir, docTitle, docSummary } from "@/docs-index";

export const dynamic = "force-static";

export function generateStaticParams() {
  return allDocs().map((doc) => ({ doc }));
}

export default async function DocPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  // The slug indexes a known list and is never joined from the request, so a
  // crafted `doc` cannot walk out of docs/.
  if (!allDocs().includes(doc)) notFound();

  const raw = fs.readFileSync(path.join(docsDir(), `${doc}.md`), "utf8");
  // The H1 becomes the page title, so rendering it again would show it twice.
  const body = raw.replace(/^#\s+.+$/m, "").trimStart();

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <Link href="/dashboard/docs" className="text-sm text-fg-muted hover:text-fg">
        ← Docs
      </Link>
      <PageHeader title={docTitle(raw, doc)} subtitle={docSummary(raw)} />
      <Card className="p-6">
        <Markdown text={body} document />
      </Card>
    </main>
  );
}
