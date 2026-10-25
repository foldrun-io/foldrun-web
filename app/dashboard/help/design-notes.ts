// The design notes shipped with the app: docs/*.md, minus the rendered HTML
// that lives there for other reasons.
//
// One list, used by the help page's index and by the note route's static
// params and its allowlist check — so a note cannot appear in one and 404 in
// the other, and a request can never name a file this list does not.

import fs from "node:fs";
import path from "node:path";

export const docsDir = () => process.env.FOLDRUN_DOCS_DIR ?? path.join(process.cwd(), "..", "foldrun-docs");

export function designNotes(): string[] {
  try {
    return fs
      .readdirSync(docsDir())
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
  } catch {
    // No docs/ in the image (a build that excluded it) — the help page then
    // simply shows no notes rather than failing to render at all.
    return [];
  }
}

/** The note's own H1, falling back to its filename. */
export function noteTitle(raw: string, slug: string): string {
  const h1 = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return h1 ?? slug.replace(/-/g, " ");
}

/** The first real paragraph, for the index card. */
export function noteSummary(raw: string): string {
  const body = raw.replace(/^#\s+.+$/m, "").trim();
  const para = body.split(/\n\s*\n/).find((p) => p.trim() && !p.startsWith("#") && !p.startsWith("|"));
  return (para ?? "").replace(/\s+/g, " ").slice(0, 180);
}
