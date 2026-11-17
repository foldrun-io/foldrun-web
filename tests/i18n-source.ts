// Tests that read a page's source for its words (a title, a label, a
// sentence) read it through this: each $t("key") / $rich("key", …) shows as
// the English it draws, since 17 Nov 2026 the words live in messages/en.
//
//   title={$t("k")}   → title="What you are charged"
//   label: $t("k")    → label: "Quantity"
//   $t("k", { n })    → $t("{n} credits", { n })   (the message, values kept)

import { $t, MESSAGES } from "@/i18n";

type Tree = { [k: string]: string | Tree };

/** The English message for a key, ICU arguments and tags as written. */
export function message(key: string): string | undefined {
  let at: string | Tree | undefined = MESSAGES as unknown as Tree;
  for (const part of key.split(".")) at = typeof at === "object" ? at[part] : undefined;
  return typeof at === "string" ? at : undefined;
}

export function english(src: string): string {
  const quoted = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return src
    .replace(/=\{\$t\("([^"]+)"\)\}/g, (m, key: string) => (message(key) === undefined ? m : `="${quoted($t(key))}"`))
    .replace(/\{\$t\("([^"]+)"\)\}/g, (m, key: string) => (message(key) === undefined ? m : quoted($t(key))))
    .replace(/\$t\("([^"]+)"\)/g, (m, key: string) => (message(key) === undefined ? m : `"${quoted($t(key))}"`))
    .replace(/\$(t|rich)\("([^"]+)",/g, (m, fn: string, key: string) => {
      const msg = message(key);
      return msg === undefined ? m : `$${fn}("${quoted(msg)}",`;
    });
}
