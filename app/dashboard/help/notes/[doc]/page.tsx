// Design notes, rendered from the repo's own docs/*.md.
//
// These are the decision records — why the platform scales the way it does,
// where the flow grammar stops. They were written for the repo, which means
// the people who most need them (anyone editing a flow, anyone sizing the
// box) could not reach them without a checkout. Same files, same words,
// reachable from the sidebar.
//
// Read per request (since 28 Oct 2026, for the CSP nonce): the markdown
// ships in the image and changes only when a deploy does.

import fs from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { Page, PageHeader, Card } from "@/components/kit/page";
import { Markdown } from "@/components/markdown";
import { designNotes, docsDir, noteTitle } from "../../design-notes";

// Per request, not prerendered (28 Oct 2026): the enforced CSP's nonce is
// minted per request, and a static page cannot carry one. The markdown ships
// in the image beside the app for this (foldrun-infra Dockerfile).
export const dynamic = "force-dynamic";

export default async function NotePage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  // The slug indexes a known list — never joined from the request — so a
  // crafted `doc` cannot walk out of docs/.
  if (!designNotes().includes(doc)) notFound();

  const raw = fs.readFileSync(path.join(docsDir(), `${doc}.md`), "utf8");

  return (
    <Page width="narrow" className="pb-16">
      <PageHeader back={{ href: "/dashboard/help", label: "Help" }} title={noteTitle(raw, doc)} description="A design note from the repo — why, not how." />
      <Card className="p-5 sm:p-8">
        <Markdown text={raw} />
      </Card>
    </Page>
  );
}
