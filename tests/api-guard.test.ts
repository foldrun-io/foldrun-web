// scripts/api-guard.mjs: a change an existing API caller would break on is
// refused unless it is versioned, deprecated past its sunset, or a declared
// correction of the document.
//
//   node --import ./tests/register.mjs --test tests/api-guard.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { apiBreaks, judge } from "../scripts/api-guard.mjs";

const op = (response?: object, body?: object, query: object[] = []) => ({
  parameters: query,
  ...(body ? { requestBody: { required: true, content: { "application/json": { schema: body } } } } : {}),
  responses: { "200": { content: { "application/json": { schema: response ?? { type: "object" } } } } },
});
const doc = (paths: Record<string, Record<string, object>>, schemas: Record<string, object> = {}) => ({ paths, components: { schemas } });
const obj = (properties: Record<string, object>, required: string[] = []) => ({ type: "object", properties, required });
const str = { type: "string" };
const num = { type: "integer" };

const RUNS = "/api/workspaces/{workspace}/runs";
const base = (doc_: object) => ({ doc: doc_, current: "2026-10-01", changes: [], deprecations: [], corrections: [] });

test("additions are never breaks: a new route, a new response field, a new optional request field", () => {
  const a = doc({ [RUNS]: { get: op(obj({ id: str })), post: op(undefined, obj({ flow: str }, ["flow"])) } });
  const b = doc({
    [RUNS]: { get: op(obj({ id: str, cost: num })), post: op(undefined, obj({ flow: str, tags: { type: "array", items: str } }, ["flow"])) },
    "/api/new": { get: op() },
  });
  assert.deepEqual(apiBreaks(a, b), []);
});

test("what a caller breaks on: an operation gone, a field gone or retyped, a field newly required", () => {
  const a = doc({
    [RUNS]: { get: op(obj({ runs: { type: "array", items: obj({ id: str, finishedAt: str }) } })), post: op(undefined, obj({ flow: str, mode: { type: "string", enum: ["a", "b"] } })) },
    "/api/old": { delete: op() },
  });
  const b = doc({
    [RUNS]: { get: op(obj({ runs: { type: "array", items: obj({ id: num }) } })), post: op(undefined, obj({ flow: str, mode: { type: "string", enum: ["a"] } }, ["flow"]), [{ name: "since", in: "query", required: true }]) },
  });
  const whats = apiBreaks(a, b).map((x: { method: string; path: string; what: string }) => `${x.method} ${x.path}: ${x.what}`);
  assert.deepEqual(whats.sort(), [
    `DELETE /api/old: the operation is gone`,
    `GET ${RUNS}: response field runs[].finishedAt is gone`,
    `GET ${RUNS}: response field runs[].id was string, now integer`,
    `POST ${RUNS}: query parameter since is now required`,
    `POST ${RUNS}: request field flow is now required`,
    `POST ${RUNS}: request field mode no longer accepts "b"`,
  ].sort());
});

test("$ref schemas are followed on both sides", () => {
  const a = doc({ [RUNS]: { get: op({ $ref: "#/components/schemas/Run" }) } }, { Run: obj({ id: str, flow: str }) });
  const b = doc({ [RUNS]: { get: op({ $ref: "#/components/schemas/Run" }) } }, { Run: obj({ id: str }) });
  assert.deepEqual(apiBreaks(a, b).map((x: { what: string }) => x.what), ["response field flow is gone"]);
});

const gone = { method: "GET", path: RUNS, what: "response field finishedAt is gone" };

test("a break is refused unless something answers for it", () => {
  const r = judge([gone], base({}), base({}));
  assert.equal(r.refused.length, 1);
});

test("a VersionChange newer than the base answers it — with the current version moved to it", () => {
  const change = { version: "2026-11-01", summary: "finishedAt is endedAt", routes: [{ method: "GET", path: "^/api/workspaces/[^/]+/runs$" }] };
  const ok = judge([gone], base({}), { ...base({}), current: "2026-11-01", changes: [change] });
  assert.deepEqual([ok.refused.length, ok.answered.length, ok.problems], [0, 1, []]);
  const stale = judge([gone], base({}), { ...base({}), changes: [change] });
  assert.match(stale.problems[0], /move API_VERSION .* to 2026-11-01/);
  const old = judge([gone], base({}), { ...base({}), changes: [{ ...change, version: "2026-10-01" }] });
  assert.equal(old.refused.length, 1, "a change the base already had answers nothing new");
  const other = judge([gone], base({}), { ...base({}), current: "2026-11-01", changes: [{ ...change, routes: [{ method: "POST", path: change.routes[0].path }] }] });
  assert.equal(other.refused.length, 1, "it must cover this method");
});

test("an operation may go only after a deprecation the base already carried has reached its sunset", () => {
  const removed = { method: "DELETE", path: "/api/old", what: "the operation is gone" };
  const dep = { method: "DELETE", path: "^/api/old$", deprecatedAt: "2026-01-01", sunsetAt: "2026-07-01" };
  assert.equal(judge([removed], { ...base({}), deprecations: [dep] }, base({}), "2026-10-13").refused.length, 0);
  assert.equal(judge([removed], { ...base({}), deprecations: [dep] }, base({}), "2026-06-30").refused.length, 1, "before the sunset");
  assert.equal(judge([removed], base({}), { ...base({}), deprecations: [dep] }, "2026-10-13").refused.length, 1, "deprecated in the same change: never announced");
  assert.equal(judge([removed], { ...base({}), deprecations: [{ ...dep, sunsetAt: null }] }, base({}), "2026-10-13").refused.length, 1, "no sunset set");
});

test("a declared schema correction is reported, not refused", () => {
  const r = judge([gone], base({}), { ...base({}), corrections: [{ method: "GET", path: RUNS, reason: "never returned" }] });
  assert.deepEqual([r.refused.length, r.answered[0].by], [0, "schema correction: never returned"]);
});

// 30 Oct 2026: every operation got a schema. Describing an operation the
// document had left generic states what it always required; adding a required
// body to an operation that was described (and took none) is still a break.
test("documenting an undescribed operation for the first time is not a break; a new required body on a described one is", () => {
  const generic = { type: "object", additionalProperties: true, description: "JSON — see docs/api.md for this route's fields" };
  const a = doc({ "/api/x": { post: op(generic) }, "/api/y": { post: op(obj({ ok: { type: "boolean" } })) } });
  const b = doc({
    "/api/x": { post: op(obj({ ok: { type: "boolean" } }), obj({ name: str }, ["name"])) },
    "/api/y": { post: op(obj({ ok: { type: "boolean" } }), obj({ name: str }, ["name"])) },
  });
  assert.deepEqual(apiBreaks(a, b).map((x: { path: string; what: string }) => `${x.path}: ${x.what}`), ["/api/y: a request body is now required"]);
});
