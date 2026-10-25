// What a thrown thing becomes on the wire: a refusal keeps its sentence, a
// bug becomes a 500 with nothing in it, a missing file is a 404 without
// the path.
//
//   node --import ./tests/register.mjs --test tests/error-response.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, errorStatus, errorResponse } from "../server/api.ts";

test("an ApiError and a core error with a status keep both", () => {
  assert.deepEqual(errorStatus(new ApiError("sign in first", 401)), { status: 401, message: "sign in first", internal: false });
  const broke = Object.assign(new Error("out of credits"), { status: 402 });
  assert.deepEqual(errorStatus(broke), { status: 402, message: "out of credits", internal: false });
});

test("a plain Error is a refusal written for the caller: 400, verbatim", () => {
  assert.deepEqual(errorStatus(new Error("expected { id }")), { status: 400, message: "expected { id }", internal: false });
  assert.equal(errorStatus("a string").status, 400);
});

test("a Node system error never carries its path out; ENOENT is a 404", () => {
  const enoent = Object.assign(new Error("ENOENT: no such file or directory, open '/data/acme/secrets.json'"), { code: "ENOENT", syscall: "open", path: "/data/acme/secrets.json" });
  assert.deepEqual(errorStatus(enoent), { status: 404, message: "not found", internal: true });
  const eacces = Object.assign(new Error("EACCES: permission denied, open '/data/acme/keys.json'"), { code: "EACCES", syscall: "open" });
  const out = errorStatus(eacces);
  assert.equal(out.status, 500);
  assert.ok(!out.message.includes("/data"), "the path stays on the server");
});

test("a TypeError is a bug: 500 with a generic sentence", () => {
  const out = errorStatus(new TypeError("Cannot read properties of undefined (reading 'steps')"));
  assert.equal(out.status, 500);
  assert.ok(!out.message.includes("undefined"));
  assert.equal(errorStatus(new SyntaxError("Unexpected token } in JSON")).status, 400);
});

test("errorResponse sends the status and only the safe message, and logs the rest", async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (line: string) => void logged.push(String(line));
  try {
    const res = errorResponse(new TypeError("x is not a function"));
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "something went wrong on our side" });
    assert.ok(logged.some((l) => l.includes("x is not a function")), "the detail reached the log");
    logged.length = 0;
    const refusal = errorResponse(new Error("no such workspace"));
    assert.equal(refusal.status, 400);
    assert.deepEqual(await refusal.json(), { error: "no such workspace" });
    assert.equal(logged.length, 0, "a refusal is not an incident");
  } finally {
    console.error = original;
  }
});
