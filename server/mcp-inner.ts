// The mark on an in-process call a /api/mcp tool makes (server/mcp.ts) to the
// route it stands for. An AI app's OAuth access token opens /api/mcp and, with
// this mark, the routes its tools call — and nothing else: the secret is made
// when the process starts, lives only in memory and is never sent anywhere, so
// no request from outside can carry it.
//
// On globalThis, so a route bundled apart from server/mcp.ts sees the same
// value rather than a second, different one.

import crypto from "node:crypto";

export const MCP_INNER_HEADER = "x-foldrun-mcp-inner";

const g = globalThis as { __foldrunMcpInner?: string };
g.__foldrunMcpInner ??= crypto.randomBytes(32).toString("hex");

export const mcpInnerSecret = (): string => g.__foldrunMcpInner!;

/** Whether a request is one of those in-process calls. */
export function isMcpInnerCall(headers: Headers): boolean {
  const v = headers.get(MCP_INNER_HEADER);
  if (!v) return false;
  const a = Buffer.from(v);
  const b = Buffer.from(mcpInnerSecret());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
