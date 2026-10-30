// Every API operation documents its request and its answer (30 Oct 2026).
// Before, 182 of 215 answered with "JSON, see the docs": a client generated
// from the spec had to guess, and the API guard — which compares documented
// fields between releases — could not see a field disappear. A new route now
// fails here until its group's file in server/openapi-shapes/ describes it,
// or says in a sentence why it cannot (a file download, a redirect).
//
//   node --import ./tests/register.mjs --test tests/openapi-coverage.test.ts

import test from "node:test";
import assert from "node:assert/strict";

const { SHAPES, documentedOperations, openapiDocument } = await import("../server/openapi.ts");

const WRITES = new Set(["POST", "PUT", "PATCH"]);

test("every operation has a response schema, or a reason it has none", () => {
  const missing = documentedOperations().filter((op) => {
    const s = SHAPES[op];
    return !s || !(s.response || s.media || s.status === "204" || s.status?.startsWith("3") || (s.noResponse && s.noResponse.length > 15));
  });
  assert.deepEqual(missing, [], "describe the answer in server/openapi-shapes/<group>.ts (response, media or status), or give noResponse a reason");
});

test("every write has a request schema, or a reason it takes no body", () => {
  const missing = documentedOperations().filter((op) => {
    if (!WRITES.has(op.split(" ")[0])) return false;
    const s = SHAPES[op];
    return !s || !(s.body || (s.noBody && s.noBody.length > 15));
  });
  assert.deepEqual(missing, [], "describe the body in server/openapi-shapes/<group>.ts, or give noBody a reason");
});

test("no shape documents an operation the server does not serve", () => {
  const served = new Set(documentedOperations());
  // Billing's routes are absent from a build without billing, not gone.
  const stray = Object.keys(SHAPES).filter((op) => !served.has(op) && !/ \/api\/billing(\/|$)/.test(op));
  assert.deepEqual(stray, [], "a shape for a route that does not exist — fix its key (METHOD /api/path/{param})");
});

test("the document still builds, with a success response on every operation", () => {
  const doc = openapiDocument() as { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> };
  for (const [p, item] of Object.entries(doc.paths)) {
    for (const [m, op] of Object.entries(item)) {
      assert.ok(Object.keys(op.responses).some((c) => /^2|^3/.test(c)), `${m.toUpperCase()} ${p} has no success response`);
    }
  }
});
