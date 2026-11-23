// Every status a route file returns on purpose is in the OpenAPI document
// (FOL-199, 16 Nov 2026). The hosted fuzz run (Schemathesis) fails on a
// status the document does not list, and each run found one more — a 409
// here, a 202 there — until they were listed together. This sweep reads each
// app/v1/**/route.ts for the statuses it writes (`status: NNN`,
// `refuse(…, NNN)`) and fails on one that no method of that path documents,
// so a new one is caught here, not by the next fuzz run.
//
// 5xx are left out: the fuzz reports a server error whatever the document
// says. Add a status to EXTRA_STATUSES in server/openapi.ts ("METHOD path",
// or "* path" for each method).
//
//   node --import ./tests/register.mjs --test tests/status-coverage.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.FOLDRUN_DATA ??= fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-status-coverage-"));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { openapiDocument } = await import("../server/openapi.ts");

type Doc = { paths: Record<string, Record<string, { responses?: Record<string, unknown> }>> };

/** The statuses a route file writes, read from its source. */
export function statusesIn(src: string): Set<string> {
  const codes = new Set<string>();
  for (const m of src.matchAll(/status:\s*(\d{3})\b/g)) codes.add(m[1]);
  for (const m of src.matchAll(/refuse\([^;]*?,\s*(\d{3})\s*\)/g)) codes.add(m[1]);
  return codes;
}

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) routeFiles(p, out);
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

test("the sweep reads the statuses a route writes", () => {
  const src = 'return refuse("taken", 409);\nreturn NextResponse.json(x, { status: 202 });\n// status 418 in a comment is not one';
  assert.deepEqual([...statusesIn(src)].sort(), ["202", "409"]);
});

test("every status a route returns on purpose is in the OpenAPI document", () => {
  const doc = openapiDocument() as Doc;
  const files = routeFiles(path.join(root, "app/v1"));
  assert.ok(files.length > 100, `only ${files.length} route files found`);
  const missing: string[] = [];
  for (const f of files) {
    const api = "/" + path.relative(path.join(root, "app"), path.dirname(f)).split(path.sep).join("/")
      .replace(/\[\.\.\.(\w+)\]/g, "{$1}").replace(/\[(\w+)\]/g, "{$1}");
    const ops = doc.paths[api];
    if (!ops) continue; // a route the document leaves out on purpose (openapi.test.ts owns that)
    const documented = new Set(Object.values(ops).flatMap((op) => Object.keys(op.responses ?? {})));
    const gaps = [...statusesIn(fs.readFileSync(f, "utf8"))].filter((c) => !c.startsWith("5") && !documented.has(c));
    if (gaps.length) missing.push(`${api} returns ${gaps.join(", ")} — add it to EXTRA_STATUSES in server/openapi.ts`);
  }
  assert.deepEqual(missing, []);
});

test("an MCP notification's 202 has no body; an eval run's 202 has its own", () => {
  const doc = openapiDocument() as Doc & { paths: Record<string, Record<string, { responses: Record<string, { content?: unknown }> }>> };
  assert.equal(doc.paths["/v1/mcp"].post.responses["202"].content, undefined);
  assert.ok(doc.paths["/v1/workspaces/{workspace}/evals/{evalName}/run"].post.responses["202"].content);
});

test("a 416 (Range outside the file) is documented with no body, as the routes send it", () => {
  const doc = openapiDocument() as Doc & { paths: Record<string, Record<string, { responses: Record<string, { content?: unknown; $ref?: string }> }>> };
  for (const p of ["/v1/workspaces/{workspace}/storage/download", "/v1/workspaces/{workspace}/runs/{runId}/archive"]) {
    const r = doc.paths[p].get.responses["416"];
    assert.ok(r && r.content === undefined && r.$ref === undefined, `${p}: ${JSON.stringify(r)}`);
  }
});

test("a 206 (part of a file) is documented with the file's bytes as its body", () => {
  const doc = openapiDocument() as Doc & { paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, unknown> }> }>> };
  for (const p of ["/v1/workspaces/{workspace}/storage/download", "/v1/workspaces/{workspace}/runs/{runId}/archive"]) {
    assert.ok(doc.paths[p].get.responses["206"].content?.["*/*"], p);
  }
});
