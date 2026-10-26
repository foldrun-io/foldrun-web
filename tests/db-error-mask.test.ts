// A failed query is never an answer (FOL-94). drizzle wraps every one in a
// DrizzleQueryError whose message is "Failed query: <SQL>\nparams: <values>",
// and errorStatus used to hand any plain Error's message back as a 400 — the
// schema and the values (an email, a salt, a hash) to whoever made the
// request. Now it is a 500 with the generic sentence, and the log keeps the
// query text and the SQLSTATE, never the values.
//
// The first tests build the real classes (drizzle's and pg's, from the
// platform's dependencies) and need nothing running. The last races two
// signups for one address against a real Postgres, so the unique index
// itself throws — it runs with FOLDRUN_TEST_DATABASE_URL:
//
//   FOLDRUN_TEST_DATABASE_URL=postgres://foldrun:test@localhost:55432/foldrun \
//     node --import ./tests/register.mjs --test tests/db-error-mask.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const url = process.env.FOLDRUN_TEST_DATABASE_URL;
process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-db-error-mask-"));
if (url) {
  const u = new URL(url);
  process.env.FOLDRUN_DATABASE_URL = `${u.protocol}//${u.username}@${u.host}${u.pathname}`;
  process.env.FOLDRUN_DATABASE_PASSWORD = u.password;
  process.env.FOLDRUN_SECRET_KEY ??= "test-install-key";
  process.env.FOLDRUN_OPEN_SIGNUP = "1";
} else delete process.env.FOLDRUN_DATABASE_URL;

const fromPlatform = createRequire(path.join(import.meta.dirname, "../../foldrun-platform/package.json"));
const { DrizzleQueryError } = fromPlatform("drizzle-orm") as { DrizzleQueryError: new (q: string, p: unknown[], c?: Error) => Error };
const { DatabaseError } = fromPlatform("pg") as { DatabaseError: new (m: string, l: number, n: string) => Error & Record<string, unknown> };

const { errorResponse, errorStatus, databaseFault } = await import("../server/api.ts");

const EMAIL = "victim@example.test";
const SECRET_VALUES = [EMAIL, "9f2c-salt", "scrypt$hash"];

/** What a unique violation on users_email_idx looks like coming out of drizzle. */
function uniqueViolation(): Error {
  const pgErr = new DatabaseError('duplicate key value violates unique constraint "users_email_idx"', 0, "error");
  Object.assign(pgErr, { code: "23505", severity: "ERROR", constraint: "users_email_idx", detail: `Key (lower(email))=(${EMAIL}) already exists.` });
  return new DrizzleQueryError('insert into "users" ("id", "email", "salt", "hash") values ($1, $2, $3, $4)', ["u1", ...SECRET_VALUES], pgErr);
}

/** Run `fn` with console.error captured; returns what it printed. */
async function logged(fn: () => unknown): Promise<string> {
  const real = console.error;
  const lines: string[] = [];
  console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = real;
  }
  return lines.join("\n");
}

test("a DrizzleQueryError is a 500 with the generic sentence: no SQL, no values in the answer", async () => {
  const err = uniqueViolation();
  assert.match(err.message, /Failed query: insert into "users"[\s\S]*victim@example\.test/, "the real class does carry the values — the reason for this");
  let res!: Response;
  const log = await logged(async () => (res = errorResponse(err)));
  assert.equal(res.status, 500);
  const body = await res.text();
  assert.deepEqual(JSON.parse(body), { error: "something went wrong on our side" });
  for (const v of [...SECRET_VALUES, "insert", "users_email_idx", "Failed query"]) assert.ok(!body.includes(v), `answer leaked ${v}`);
  // The log says what failed — query text and SQLSTATE — and never the values.
  assert.match(log, /database error 23505 in: insert into "users"/);
  for (const v of SECRET_VALUES) assert.ok(!log.includes(v), `log leaked ${v}`);
  assert.ok(!log.includes("params"), "no params line in the log");
});

test("the driver's own error, unwrapped, is masked the same way; an ordinary message still reads", () => {
  const pgErr = new DatabaseError("value too long for type character varying(64)", 0, "error");
  Object.assign(pgErr, { code: "22001", severity: "ERROR" });
  assert.deepEqual(errorStatus(pgErr), { status: 500, message: "something went wrong on our side", internal: true });
  assert.deepEqual(databaseFault(pgErr), { code: "22001", query: null });
  // Not a database error: the 400 with its own words, as before.
  assert.deepEqual(errorStatus(new Error("usd must be a positive number")), { status: 400, message: "usd must be a positive number", internal: false });
  // A code alone is not Postgres's (a Node errno is lower-case, and has no severity).
  assert.equal(databaseFault(Object.assign(new Error("x"), { code: "EPIPE" })), null);
});

test(
  "two signups for one address at once against Postgres: the loser's answer has no SQL and no values",
  { skip: url ? false : "set FOLDRUN_TEST_DATABASE_URL to run against Postgres" },
  async () => {
    const { migrate } = await import("@/platform/db.ts");
    await migrate();
    const { NextRequest } = await import("next/server");
    const signup = await import("../app/api/auth/signup/route.ts");
    const email = `race-${Date.now()}@example.test`;
    const attempt = (n: number) =>
      signup.POST(
        new NextRequest("http://x/api/auth/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password: "correct horse battery staple 9", account: `race${Date.now()}${n}` }),
        }),
      );
    const answers = await Promise.all([1, 2, 3, 4].map(attempt));
    assert.ok(answers.some((r) => r.status === 200), "one signup wins");
    for (const r of answers.filter((a) => a.status !== 200)) {
      const body = await r.text();
      assert.ok(r.status === 500 || r.status === 400 || r.status === 409, `${r.status} ${body}`);
      for (const v of [email, "insert", "Failed query", "params"]) assert.ok(!body.includes(v), `answer leaked ${v}: ${body}`);
    }
  },
);
