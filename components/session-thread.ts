// A conversation's messages with other sessions, both ways, oldest first
// (FOL-307): the order the dashboard's panel shows them in.

import type { SessionMessageRow } from "@/platform/session-messages";

export type ThreadRow = SessionMessageRow & { direction: "in" | "out" };

export function threadOf(received: SessionMessageRow[], sent: SessionMessageRow[]): ThreadRow[] {
  return [...received.map((m) => ({ ...m, direction: "in" as const })), ...sent.map((m) => ({ ...m, direction: "out" as const }))].sort((a, b) => a.at.localeCompare(b.at));
}
