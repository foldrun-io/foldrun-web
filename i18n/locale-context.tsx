"use client";

// The page's language, for client components while the server renders them.
// The root layout renders this once around everything, so each request's
// tree carries its own language. In the browser nothing reads it: there the
// language is the document's own (`<html lang>`), which the server wrote.

import { createContext, type ReactNode } from "react";

export type Locale = "en" | "fa";

export const LocaleContext = createContext<Locale>("en");

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}
