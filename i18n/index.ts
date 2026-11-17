// The dashboard's words live in language files (owner, 17 Nov 2026: "the
// whole platform to be moved to language files and for now only english,
// later we can add persian").
//
//   messages/<locale>/*.json   every sentence the dashboard shows, by area
//   messages/<locale>/terms.json   the product's nouns, defined once
//
// A sentence names a term as {@workspace.one} (also .other, .One, .Other —
// the four English forms). The terms are expanded into the sentences once,
// when the catalog loads and before any message is parsed, so renaming a
// noun is one edit in terms.json and no sentence is assembled in code.
// Another language brings its own terms AND its own full sentences: Persian
// grammar is not English with the nouns swapped.
//
// Use: `$t("settings.keys.title")`, `$t("runs.page.count", { n })` — ICU
// messages (plurals, selects, numbers), the same call in server components,
// client components and plain modules. A sentence with markup inside it is
// one message with tags, so a translator can move the markup with the words:
// `$rich("limits.page.everyCap", { code: (chunks) => <code>{chunks}</code> })`
// for "Every cap here is the <code>budget:</code> line…". English is the only locale for now;
// `dir` is here so a right-to-left language is one switch later.

import type { ReactNode } from "react";
import { createTranslator } from "use-intl/core";
import { CATALOG } from "@/messages/en";
import TERMS from "@/messages/en/terms.json" with { type: "json" };

export const LOCALE = "en";
export const DIR: "ltr" | "rtl" = "ltr";

type Forms = Record<string, string>;
type Tree = { [key: string]: string | Tree };

/** ICU treats { } # | and a quote before them as syntax: a term is plain
 *  text, so quote what would be read as syntax. */
function icuLiteral(s: string): string {
  return /[{}#|]/.test(s) ? `'${s.replace(/'/g, "''")}'` : s;
}

const REF = /\{@([a-zA-Z]+)\.([a-zA-Z]+)\}/g;

/** Every {@term.form} in the tree, replaced; an unknown term or form throws,
 *  so a typo fails the build and the tests instead of reaching a page. */
export function expandTerms(tree: Tree, terms: Record<string, Forms>, at = ""): Tree {
  const out: Tree = {};
  for (const [k, v] of Object.entries(tree)) {
    const path = at ? `${at}.${k}` : k;
    if (typeof v === "string") {
      out[k] = v.replace(REF, (_m, term: string, form: string) => {
        const forms = terms[term];
        if (!forms) throw new Error(`${path}: unknown term {@${term}.${form}}`);
        const word = forms[form];
        if (word === undefined) throw new Error(`${path}: term ${term} has no form "${form}" (has ${Object.keys(forms).join(", ")})`);
        return icuLiteral(word);
      });
    } else out[k] = expandTerms(v, terms, path);
  }
  return out;
}

export const MESSAGES = expandTerms(CATALOG as Tree, TERMS as Record<string, Forms>) as typeof CATALOG;

const translate = createTranslator({ locale: LOCALE, messages: MESSAGES });

type Values = Record<string, string | number | Date>;

/** One sentence of the dashboard, by key. */
export function $t(key: string, values?: Values): string {
  return (translate as unknown as (k: string, v?: Values) => string)(key, values);
}

type RichValues = Record<string, string | number | Date | ((chunks: ReactNode) => ReactNode)>;

/** One sentence with markup in it: each <tag> in the message is drawn by the
 *  function of the same name (use-intl keys the elements). */
export function $rich(key: string, values: RichValues): ReactNode {
  return (translate.rich as unknown as (k: string, v: RichValues) => ReactNode)(key, values);
}

/** An element placed inside a sentence as-is: `<localTime></localTime>` in the
 *  message, `localTime: $el(<LocalTime iso={at} />)` in the code. Built where
 *  it stood, so the page's own narrowing and values still apply. */
export function $el(node: ReactNode): () => ReactNode {
  return () => node;
}
