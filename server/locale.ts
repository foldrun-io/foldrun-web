// The language of this request, for server components.
//
// The proxy decides it (proxy.ts `localeFor`: the host, then the person's
// choice) and writes it in a request header nothing else can set; this reads
// that header once per render and hands it to `$t` (i18n/index.ts). The root
// layout and every page await it before they write a word.

import { cache } from "react";
import { headers } from "next/headers";
import { setRequestLocale, type Locale } from "@/i18n";
// Server components read Persian from here: this file is never in a browser bundle.
import "@/i18n/persian";

export const LOCALE_HEADER = "x-foldrun-locale";

export const requestLocale = cache(async (): Promise<Locale> => {
  let locale: Locale = "en";
  try {
    if ((await headers()).get(LOCALE_HEADER) === "fa") locale = "fa";
  } catch {
    // Outside a request (a build step, a test): English.
  }
  setRequestLocale(locale);
  return locale;
});
