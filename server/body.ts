// A request's JSON body, read as the object every write route expects.
//
// `await req.json()` answers whatever the bytes say: `null`, `[]`, `"x"` or
// `7` are all valid JSON, and a route that then read `body.name` threw a
// TypeError — a 500 "something went wrong on our side" for what is the
// caller's mistake (30 Oct 2026). Routes that read a body go through here
// instead: anything but a JSON object is a 400 that says what was expected,
// before a field is touched. Each route still checks its own fields' types.

import { ApiError } from "./api.ts";

export type JsonObject = Record<string, unknown>;

/**
 * The body as a JSON object, or ApiError 400.
 *
 * `optional` is for the routes whose every field is optional (a PATCH that
 * changes what it is given): an empty body reads as `{}` there, as the
 * `.catch(() => ({}))` they used to carry made it. Malformed JSON is never
 * read as empty — it is refused with the same "malformed JSON" errorStatus
 * gives a SyntaxError.
 */
export async function jsonObject(req: Request, opts: { optional?: boolean } = {}): Promise<JsonObject> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw new ApiError("could not read the request body", 400);
  }
  if (!text.trim()) {
    if (opts.optional) return {};
    throw new ApiError("expected a JSON object body", 400);
  }
  // A NUL (\u0000) in any string or key: Postgres cannot hold one in text or
  // jsonb ("unsupported Unicode escape sequence"), so a hosted write of it was
  // a 500 (FOL-199, hosted fuzz: POST /v1/mcp/clients with a name holding
  // one). No field here means anything by it — refused before any is read.
  const NUL = Symbol("nul");
  let value: unknown;
  try {
    value = JSON.parse(text, (k, v) => {
      if (k.includes("\u0000") || (typeof v === "string" && v.includes("\u0000"))) throw NUL;
      return v;
    });
  } catch (err) {
    if (err === NUL) throw new ApiError("text in the body cannot hold a NUL character (\\u0000)", 400);
    throw new ApiError("malformed JSON", 400);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("expected a JSON object body", 400);
  }
  return value as JsonObject;
}

/** A field that must be a string when present: its value, undefined when
 *  absent, ApiError 400 naming the field otherwise. */
export function optionalString(body: JsonObject, field: string): string | undefined {
  const v = body[field];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new ApiError(`${field} must be a string`, 400);
  return v;
}
