// One API, Anthropic's shape (owner, 22 Nov 2026: "one api works with both
// platform and the llm proxy like how anthropic does itself"). From API
// version 2026-11-22 an /v1 refusal is the body /v1 already answers with:
//
//   { "type": "error", "error": { "type": "not_found_error", "message": "…" } }
//
// Before it, and for the dashboard (a signed-in browser: it ships with the
// server and still reads `{ error: "…" }`), the old body. The proxy decides
// which, per request (api-limits.ts apiGate, ERROR_SHAPE_HEADER), and the one
// place every refusal is built (api.ts errorResponse) reads that here.

import { AsyncLocalStorage } from "node:async_hooks";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external.js";
import { ERROR_SHAPE_HEADER, type ErrorShape } from "./api-version.ts";

/** A shape set for code that runs outside a request Next started — a test,
 *  or a handler called by another handler. */
const scope = new AsyncLocalStorage<ErrorShape>();

export function withErrorShape<T>(shape: ErrorShape, fn: () => T): T {
  return scope.run(shape, fn);
}

/** The request's headers as Next holds them for the running route, read
 *  synchronously (next/headers only offers a promise). Null outside one. */
function requestHeaders(): { get(name: string): string | null } | null {
  try {
    const store = workUnitAsyncStorage.getStore() as { type?: string; headers?: { get(name: string): string | null } } | undefined;
    return store && store.type === "request" && store.headers ? store.headers : null;
  } catch {
    return null;
  }
}

/** Which body a refusal is answered with now. Legacy when nothing says
 *  otherwise: every request through the proxy carries the header, so only
 *  code the proxy never saw (unit tests calling a handler) falls back. */
export function currentErrorShape(): ErrorShape {
  const scoped = scope.getStore();
  if (scoped) return scoped;
  return requestHeaders()?.get(ERROR_SHAPE_HEADER) === "anthropic" ? "anthropic" : "legacy";
}

/** Anthropic's error types, by HTTP status
 *  (https://docs.claude.com/en/api/errors). */
export function errorTypeFor(status: number): string {
  if (status === 401) return "authentication_error";
  if (status === 402) return "billing_error";
  if (status === 403) return "permission_error";
  if (status === 404) return "not_found_error";
  if (status === 413) return "request_too_large";
  if (status === 429) return "rate_limit_error";
  // 503 as the gateway door maps it (platform gateway-door.ts): busy, come back.
  if (status === 529 || status === 503) return "overloaded_error";
  if (status >= 500) return "api_error";
  return "invalid_request_error";
}

/** A refusal's body in a shape. `extra` (a `code`, figures, `known`) goes
 *  inside `error` in Anthropic's shape, beside `error` in the old one. */
export function errorBody(message: string, status: number, extra: Record<string, unknown> = {}, shape: ErrorShape = currentErrorShape()): Record<string, unknown> {
  if (shape === "legacy") return { error: message, ...extra };
  return { type: "error", error: { type: errorTypeFor(status), message, ...extra } };
}

/** Anthropic's body back to the old one: the downgrade of the 2026-11-22
 *  change (api-version.ts), and what a client reading either can call. */
export function legacyErrorBody(body: unknown): unknown {
  const b = body as { type?: unknown; error?: unknown } | null;
  if (!b || b.type !== "error" || !b.error || typeof b.error !== "object") return body;
  const { type: _type, message, ...rest } = b.error as Record<string, unknown>;
  return { error: message, ...rest };
}
