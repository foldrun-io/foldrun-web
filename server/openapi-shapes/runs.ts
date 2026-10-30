// OpenAPI request/response schemas: /api/workspaces/{workspace}/runs*.
// Written from what each handler validates and answers (30 Oct 2026).

import { type Shape, obj, str, bool, int, arr } from "./kit.ts";

export const SHAPES: Record<string, Shape> = {
  "DELETE /api/workspaces/{workspace}/runs/{runId}": {
    noBody: "the run is in the path; one still going is stopped first",
    response: obj({ ok: bool, deleted: str("the run's id") }),
  },
  "POST /api/workspaces/{workspace}/runs/{runId}/answer": {
    body: obj(
      {
        question: str("the question's id"),
        answer: str("at most 4000 characters, trimmed"),
      },
      ["question", "answer"],
    ),
    response: obj({ ok: bool, question: str(), answer: str(), by: str("who answered") }),
  },
  "POST /api/workspaces/{workspace}/runs/{runId}/approve": {
    body: obj({
      decision: str('approve | reject — required, except that a payload alone means approve'),
      reason: str("why, on a reject"),
      note: str("kept with the decision"),
      step: { ...int, description: "one step's index in the run's steps, from 0; omitted, every step waiting" },
      payload: { description: "releases a step parked on wait: event with this (a string, or JSON that is stringified), at most 20000 characters; not with a reject" },
    }),
    response: obj({
      ok: bool,
      decision: str("approve | reject"),
      steps: arr(int, "the indexes of the steps decided or released"),
    }),
  },
  "GET /api/workspaces/{workspace}/runs/{runId}/archive": {
    query: [
      { name: "agent", description: "the agent whose outputs/ the file is in" },
      { name: "path", description: "the file, relative to that agent's archived outputs/" },
    ],
    media: {
      type: "application/octet-stream",
      description:
        "One file a run archived, served inline as what it is and never as a page: text, code, HTML and SVG as text/plain; JSON, CSV, PDF, images, webm/mp4 by type; anything else application/octet-stream. Range requests answer 206 (416 for a bad range).",
    },
  },
  "GET /api/workspaces/{workspace}/runs/{runId}/live": {
    query: [
      {
        name: "agent",
        description:
          "one agent's newest browser frame as image/jpeg (headers x-live-url, x-live-at, x-live-ended, x-live-engine), or 204 when there is none; omitted, the JSON below",
      },
    ],
    response: obj({
      agents: { type: "object", additionalProperties: { type: "string" }, description: "agent → when its last frame arrived" },
    }),
  },
  "POST /api/workspaces/{workspace}/runs/{runId}/message": {
    body: obj(
      {
        text: str("at most 4000 characters, trimmed"),
        step: { type: ["integer", "string"], description: "the running step's index in the run's steps; required when several steps run at once" },
      },
      ["text"],
    ),
    response: obj({
      ok: bool,
      step: { ...int, description: "the step it went to" },
      message: obj({ text: str(), by: { type: ["string", "null"] }, at: str() }),
    }),
  },
  "POST /api/workspaces/{workspace}/runs/{runId}/promote": {
    body: obj({
      evalName: str("the eval file to write; default <target>-regressions"),
      caseName: str(),
      expect: arr(str(), "assertion lines in the eval syntax, e.g. contains: $34, judge: names the buyer — in place of the default judge line"),
      should: str("for a run that went wrong: what it should have done, the case's judge claim"),
    }),
    response: obj({
      ok: bool,
      file: str("the eval file written"),
      created: { ...bool, description: "false when the case was appended to an existing file" },
      caseName: str(),
    }),
  },
  "POST /api/workspaces/{workspace}/runs/{runId}/stop": {
    noBody: "the run is in the path; stopping it destroys its sandbox",
    response: obj({ ok: bool, runId: str(), status: str("the run's status after the stop") }),
  },
  "GET /api/workspaces/{workspace}/runs/{runId}/stream": {
    media: {
      type: "text/event-stream",
      description:
        "Server-sent events: `run` carries the whole run record (JSON) each time it changes, first at once; `done` carries { status } when the run is over, and the stream ends. A `: keepalive` comment every 15 s; after 30 minutes the stream closes without `done` and a client reconnects.",
    },
  },
  "POST /api/workspaces/{workspace}/runs/bulk": {
    body: obj(
      {
        action: str("stop | rerun"),
        status: arr(str(), "only runs with one of these statuses"),
        flow: str("only this flow's runs"),
        since: str("ISO instant — runs that started at or after it"),
        until: str("ISO instant — runs that started at or before it"),
        runIds: arr(str()),
        from: { ...int, description: "rerun only: the step to start from, as the trace numbers them, from 1" },
        dryRun: { ...bool, description: "answer with what would be touched, and touch nothing" },
      },
      ["action"],
    ),
    response: obj({
      ok: bool,
      dryRun: { ...bool, description: "present on a dry run" },
      action: str("stop | rerun"),
      matched: {
        type: ["integer", "array"],
        items: str(),
        description: "how many runs matched (at most 100 — more is a 422); on a dry run, their ids, newest first",
      },
      succeeded: int,
      failed: int,
      runs: arr(obj({ runId: str(), ok: bool, newRunId: str("rerun: the new run"), error: str() }), "each run's outcome; absent on a dry run"),
    }),
  },
};
