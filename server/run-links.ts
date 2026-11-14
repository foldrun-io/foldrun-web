// What a run's own record tells a caller who may only read it.
//
// A run parked on `wait: event` prints its release URL into its trace
// (core runner.ts: "release it with POST /api/events/<account>/<ws>/<run>?
// token=…&step=n"), and that URL needs no credential: whoever POSTs it
// releases the step, with a body of their choosing as the event. The
// record is read by every role, so a viewer — or a leaked viewer key — could
// read the line and then post "paid" to the world's payment gate. A viewer
// "changes nothing, starts nothing" (permissions.ts), and an editor, who may
// release the step through POST …/approve anyway, loses nothing by seeing it.
//
// So the line stays in the record, and the routes that hand a record to a
// caller take the URL out of it unless the caller may run things (run:start).

import { can } from "@/platform/permissions";
import type { Actor } from "@/server/auth";

/** The release URL as the runner printed it, inside JSON text (no quote, backslash or space in a URL). */
const EVENT_LINK = /release it with POST [^\s"\\]+/g;
const HIDDEN = "release it with the link an editor sees on this run";

/** May this caller see the links that release a run's gates? */
export function mayReleaseRuns(actor: Pick<Actor, "role">): boolean {
  return can(actor.role, "run:start");
}

/** A run record's JSON text, as this caller may read it. */
export function runTextFor(raw: string, actor: Pick<Actor, "role">): string {
  return mayReleaseRuns(actor) || !raw.includes("release it with POST") ? raw : raw.replace(EVENT_LINK, HIDDEN);
}

/** A run record as an object, as this caller may read it. */
export function runFor<T extends object>(run: T, actor: Pick<Actor, "role">): T {
  if (mayReleaseRuns(actor)) return run;
  const raw = JSON.stringify(run);
  return raw.includes("release it with POST") ? (JSON.parse(runTextFor(raw, actor)) as T) : run;
}
