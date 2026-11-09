// A docs heading's anchor id — the same one docs.foldrun.io gives it.
//
// The docs are one set of markdown files shown in two places: this
// dashboard's docs viewer and docs.foldrun.io (foldrun-docs
// src/lib/heading-ids.ts). A link written in a doc — `[x](agents#resources--your-own-numbers)` —
// has to land in both, and `foldrun check` prints checks#config-effort-fitted
// for a rule. Both sides make GitHub's slug of the heading's text, with a "/"
// read as a "-" first; a repeated heading gets -1, -2 within its page.
//
// Before 8 Nov 2026 this viewer made its own slug (every run of punctuation
// → one "-"), so 49 of the docs' 237 anchor links missed their section here.

import Slugger from "github-slugger";

/** The heading as a reader sees it: a link's text without its address,
 *  code and emphasis without their marks. */
export function headingText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\W)[*_](.+?)[*_](?=\W|$)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .trim();
}

/** Ids for one document's headings, in order. */
export function headingSlugger(): (markdown: string) => string {
  const slugger = new Slugger();
  return (markdown) => slugger.slug(headingText(markdown).replace(/\//g, "-"));
}
