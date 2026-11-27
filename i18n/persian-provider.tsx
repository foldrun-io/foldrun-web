"use client";

// The provider the root layout renders around every page. On an English
// page it only says so. On a Persian page it first brings Persian's
// sentences (./persian), in a file of their own that the browser fetches
// only here, and everything on the page is inside it, so no component draws
// a word before they are there. A static import would not do: the browser
// is sent every file a layout names, whichever branch it renders.

import { use, type ReactNode } from "react";
import { LocaleChoiceContext, LocaleContext, type Locale } from "./locale-context";

let persian: Promise<unknown> | null = null;
let ready = false;
function loadPersian(): Promise<unknown> {
  return (persian ??= import("./persian").then(() => { ready = true; }));
}

// In the browser a Persian page asks for its words as soon as this file runs.
// The server has them from its first moment, for any request.
if (typeof document === "undefined" || document.documentElement.lang === "fa") void loadPersian();

function Persian({ children }: { children: ReactNode }) {
  // Waits here, with the server's page on screen, until the words are in.
  if (!ready) use(loadPersian());
  return <LocaleContext value="fa">{children}</LocaleContext>;
}

export function PageLocale({ locale, choice = false, children }: { locale: Locale; choice?: boolean; children: ReactNode }) {
  const page = locale === "fa" ? <Persian>{children}</Persian> : <LocaleContext value="en">{children}</LocaleContext>;
  return <LocaleChoiceContext value={choice}>{page}</LocaleChoiceContext>;
}
