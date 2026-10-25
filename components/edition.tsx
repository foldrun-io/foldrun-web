"use client";

// Which edition the client is looking at, from the server, once.
//
// The one question every commercial surface asks — is anyone paying for this
// install? — is answered by core's `platform.edition()` hook, which only the
// server can read. Client components (the user menu, a top-up button) get it
// from here, set by the dashboard layout, so the answer is decided in exactly
// one place and nothing on the client guesses from an env var it cannot see.
//
// Default `self-hosted`: a component rendered outside the provider — a test,
// a stray page — shows the community dashboard, never the wallet.

import { createContext, useContext, type ReactNode } from "react";
import type { Edition } from "@/lib/platform";

const EditionContext = createContext<Edition>("self-hosted");

export function EditionProvider({ edition, children }: { edition: Edition; children: ReactNode }) {
  return <EditionContext.Provider value={edition}>{children}</EditionContext.Provider>;
}

export function useEdition(): Edition {
  return useContext(EditionContext);
}

export function useHosted(): boolean {
  return useContext(EditionContext) === "hosted";
}
