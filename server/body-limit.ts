// The largest request body an /api route receives whole.
//
// Next.js buffers the body of every request its proxy (proxy.ts) sees, up to
// `experimental.proxyClientMaxBodySize`, and passes anything larger on CUT
// OFF — the route reads a truncated body and cannot tell. On 2026-09-25 a
// 30 MB PUT to /storage was stored as its first 10 MB and answered 200. So
// the limit is named once here, handed to Next in next.config.ts, and the
// proxy refuses a larger Content-Length with a 413 before any route runs.
// Big files do not come through here at all: /storage/upload-url hands the
// client a signed URL to the object store.
export const API_BODY_LIMIT_BYTES = 10 * 1024 * 1024;

/** The refusal for a declared body over the limit, or null. */
export function bodyTooLarge(contentLength: string | null): string | null {
  const n = Number(contentLength);
  if (!contentLength || !Number.isFinite(n) || n <= API_BODY_LIMIT_BYTES) return null;
  return (
    `request body is ${(n / 1024 / 1024).toFixed(1)} MB; the API takes at most ${API_BODY_LIMIT_BYTES / 1024 / 1024} MB per request. ` +
    `For a large file, POST /api/workspaces/<ws>/storage/upload-url and PUT the bytes to the URL it returns.`
  );
}

/**
 * The refusal for a raw body a route has read, or null — for the routes
 * that store bytes, where a cut body is a corrupt file answered 200.
 *
 * The proxy can only refuse a length that was declared. A chunked body
 * declares none, and Next hands the route what it buffered before the
 * limit: short of it by up to one chunk, so the size alone cannot tell a
 * cut body from a whole one. Such a body is refused with 411; a declared
 * one must have arrived whole.
 */
export function bodyCut(contentLength: string | null, received: number): { status: 400 | 411 | 413; error: string } | null {
  const tooBig = bodyTooLarge(contentLength) ?? bodyTooLarge(String(received));
  if (tooBig) return { status: 413, error: tooBig };
  if (!contentLength) {
    return {
      status: 411,
      error: `send a Content-Length: a body without one cannot be told whole from cut off at the ${API_BODY_LIMIT_BYTES / 1024 / 1024} MB limit`,
    };
  }
  if (Number(contentLength) !== received) {
    return { status: 400, error: `the body ended at ${received} of the ${contentLength} bytes declared` };
  }
  return null;
}
