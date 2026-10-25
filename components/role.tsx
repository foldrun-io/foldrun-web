"use client";

// The signed-in person's role, once per session, and one question every
// control asks of it: may I?
//
// The answer comes from the same table the API refuses with
// (core/src/permissions.ts), so a control the dashboard draws is one the
// server will honour and a control it withholds is one the server would 403.
// Drawn-but-disabled, with the reason on hover, rather than hidden: a page
// with no Run button reads as "running is not a thing here", which is a worse
// lesson than "you cannot".

import { createContext, useContext, type ReactNode } from "react";
import { can, type Action, type Role } from "@/platform/permissions";

const RoleContext = createContext<Role>("owner");

export function RoleProvider({ role, children }: { role: Role; children: ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole(): Role {
  return useContext(RoleContext);
}

export function useCan(action: Action): boolean {
  return can(useContext(RoleContext), action);
}

/** The sentence a disabled control shows on hover. */
export function needs(action: Action): string {
  const least = { "workspace:read": "viewer", "workspace:write": "editor", "run:start": "editor" } as Record<string, string>;
  return `Your role cannot do this — it needs ${least[action] ?? "a higher role"} or above`;
}
