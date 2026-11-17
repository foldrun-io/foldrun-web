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
// client components and plain modules. English is the only locale for now;
// `dir` is here so a right-to-left language is one switch later.

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
