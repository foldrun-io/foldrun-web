// What starts a flow, in one short line — the sub-line under a flow's name on
// the Flows list, the line under its title, and a row on the Triggers page.
// Pure: no store, no React, so a server page and a client widget read it the
// same way.

import { humanSchedule } from "@/components/schedule-human";

export interface TriggerFacts {
  trigger: string;
  schedule?: string | null;
  timezone?: string | null;
  after?: string | null;
  on?: string | null;
  at?: string | null;
  url?: string | null;
  path?: string | null;
}

export function triggerLine(f: TriggerFacts): string {
  switch (f.trigger) {
    case "schedule":
      return f.schedule ? `${humanSchedule(f.schedule) ?? f.schedule}${f.timezone ? ` · ${f.timezone}` : ""}` : "On a schedule";
    case "webhook":
      return "When its webhook URL is called";
    case "email":
      return "When an email arrives";
    case "storage":
      return f.path ? `When a file lands in storage/${f.path}` : "When a file lands in storage/";
    case "watch":
      return f.url ? `When ${f.url} changes` : "When a watched page changes";
    case "flow":
      return f.after ? `After ${f.after} ${!f.on || f.on === "any" ? "finishes" : f.on === "completed" ? "completes" : `ends ${f.on}`}` : "After another flow";
    case "once":
      return f.at ? `Once, at ${f.at.replace("T", " ").slice(0, 16)}` : "Once";
    case "manual":
    case "":
    case undefined:
      return "Run by hand";
    default:
      return f.trigger;
  }
}

/** The trigger's word for a tag: "schedule", "webhook", "manual"… */
export function triggerWord(trigger: string | null | undefined): string {
  return trigger || "manual";
}
