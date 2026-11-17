// What starts a flow, in one short line — the sub-line under a flow's name on
// the Flows list, the line under its title, and a row on the Triggers page.
// Pure: no store, no React, so a server page and a client widget read it the
// same way.

import { $t } from "@/i18n";
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
      return f.schedule ? `${humanSchedule(f.schedule) ?? f.schedule}${f.timezone ? ` · ${f.timezone}` : ""}` : $t("workspace.flows-trigger-line.onASchedule");
    case "webhook":
      return $t("workspace.flows-trigger-line.whenItsWebhookUrlIsCalled");
    case "email":
      return $t("workspace.flows-trigger-line.whenAnEmailArrives");
    case "storage":
      return f.path ? $t("workspace.flows-trigger-line.whenAFileLandsInStorage", { path: String(f.path) }) : $t("workspace.flows-trigger-line.whenAFileLandsInStorage2");
    case "watch":
      return f.url ? $t("workspace.flows-trigger-line.whenChanges", { url: String(f.url) }) : $t("workspace.flows-trigger-line.whenAWatchedPageChanges");
    case "flow":
      return f.after ? $t("workspace.flows-trigger-line.afterFlowEnds", { after: String(f.after), on: !f.on ? "any" : f.on }) : $t("workspace.flows-trigger-line.afterAnotherFlow");
    case "once":
      return f.at ? $t("workspace.flows-trigger-line.onceAt", { v0: String(f.at.replace("T", " ").slice(0, 16)) }) : $t("workspace.flows-trigger-line.once");
    case "manual":
    case "":
    case undefined:
      return $t("workspace.flows-trigger-line.runByHand");
    default:
      return f.trigger;
  }
}

/** The trigger's word for a tag: "schedule", "webhook", "manual"… */
export function triggerWord(trigger: string | null | undefined): string {
  return trigger || "manual";
}
