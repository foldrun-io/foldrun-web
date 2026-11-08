// FOL-121: no account content in a platform log line — the web's server
// code under core's log guard (foldrun-core/scripts/log-guard.mjs), the
// boundary installed first in instrumentation.ts, and the API's error
// logger proved on a 500 that carries a marker in its message, its stack
// and a database error's query and values.
//
//   node --import ./tests/register.mjs --test tests/log-guard.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scanSource, compareBaseline, format } from "../../foldrun-core/scripts/log-guard.mjs";

type Found = { file: string; line: number; fp: string; why: string; text: string };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** foldrun-admin's overlay files (skip-worktree here): not this
 *  repository's copy, and the boundary covers them at run time. */
const SKIP = new Set(["server/hosted-services.ts", "server/billing-notices.ts", "server/view-as.ts"]);

/** Calls that were there on 5 Nov 2026 and are not platform log lines:
 *  file → fingerprint → why. Only ever shrinks. */
const BASELINE: Record<string, Record<string, string>> = {};

function serverSources(): string[] {
  const out = execFileSync("git", ["ls-files", "server", "app", "instrumentation.ts", "proxy.ts"], { cwd: root, encoding: "utf8" });
  return out.split("\n").filter((f) => /\.(ts|tsx|mts|mjs)$/.test(f) && !SKIP.has(f) && fs.existsSync(path.join(root, f)));
}

// Which files are the repository's own needs git. The check scripts'
// scratch copies (without-billing-check.sh, foldrun-admin check.sh) carry no
// .git; there it is skipped, saying so — CI and the git hooks run it in a
// checkout.
const inGit = (() => {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("the web's server code: no raw console call prints a value, every ops event is a literal", { skip: !inGit && "not a git checkout (a check script's scratch copy)" }, () => {
  const found: Found[] = serverSources().flatMap((f) => scanSource(fs.readFileSync(path.join(root, f), "utf8"), f));
  const baseline = Object.fromEntries(Object.entries(BASELINE).map(([f, fps]) => [f, Object.keys(fps)]));
  const { fresh, stale } = compareBaseline(found, baseline);
  assert.equal(fresh.length, 0, `print these through opsLog/opsError (@/lib/ops-log.ts):\n${format(fresh)}`);
  assert.deepEqual(stale, [], "gone from the source: remove from BASELINE");
});

test("instrumentation.ts puts the server inside the boundary before anything else it does", () => {
  const src = fs.readFileSync(path.join(root, "instrumentation.ts"), "utf8");
  const body = src.slice(src.indexOf("export async function register()"));
  const install = body.indexOf("installOpsBoundary();");
  assert.ok(install > 0, "register() installs the boundary");
  for (const later of ["dev-auth-guard", "@/platform/boot.ts", "prepare()"]) assert.ok(body.indexOf(later) > install, `${later} comes after the boundary`);
});

// The marker in every place an API error could carry it. Capitals and
// digits: the shape of a code and an id, so no check is dodged by case.
const MARKER = "CANARYW121QX";

test("inside the boundary, the API's error logger says a 500's class and frames — never its message, stack text, query or values", async () => {
  const child = `
    const { installOpsBoundary } = await import("@/lib/ops-log.ts");
    installOpsBoundary();
    const { errorResponse } = await import("@/server/api.ts");
    const M = ${JSON.stringify(MARKER)};
    // A bug whose message quotes the request it choked on.
    const bug = new TypeError("Cannot read properties of undefined (reading '" + M + "')");
    // A parse error quoting the body; a system error naming an account's file.
    const parse = new SyntaxError('Unexpected token, "' + M + '" is not valid JSON');
    const sys = Object.assign(new Error("ENOENT: open '/data/acme/" + M + ".md'"), { code: "ENOENT", syscall: "open", path: "/data/acme/" + M });
    // A model process that died, its stderr in the message (FOL-107).
    const model = new TypeError("Claude Code process exited with code 1. stderr: " + M);
    // A database error: query text and values both carry the marker.
    const db = Object.assign(new Error("Failed query: select '" + M + "'\\nparams: " + M), { query: "select '" + M + "'", params: [M], cause: Object.assign(new Error(M), { code: "23505", severity: "ERROR" }) });
    for (const e of [bug, parse, sys, model, db]) errorResponse(e);
    console.error("[foldrun] raw:", bug);
    process.stdout.write("done " + M + "\\n");
  `;
  const out = await new Promise<{ code: number | null; text: string }>((resolve) => {
    const c = spawn(process.execPath, ["--import", "./tests/register.mjs", "--input-type=module", "-e", child], {
      cwd: root,
      env: { ...process.env, NODE_ENV: "production", FOLDRUN_LOG_MODE: "", FOLDRUN_DATABASE_URL: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let text = "";
    c.stdout.on("data", (d) => (text += d));
    c.stderr.on("data", (d) => (text += d));
    c.on("close", (code) => resolve({ code, text }));
  });
  assert.equal(out.code, 0, out.text.slice(0, 3000));
  assert.ok(!out.text.toLowerCase().includes(MARKER.toLowerCase()), `the marker reached the streams:\n${out.text.slice(0, 3000)}`);
  const lines = out.text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  for (const l of lines) assert.equal(l.ops, 1);
  const internal = lines.filter((l) => l.event === "api.internal_error");
  assert.ok(internal.length >= 3, out.text);
  assert.ok(internal.every((l) => l.status === 500 || l.status === 404 || l.status === 400), out.text);
  assert.ok(internal.every((l) => typeof l.errorClass === "string" && typeof l.errorName === "string"), out.text);
  const db = lines.find((l) => l.event === "api.database_error");
  assert.equal(db?.code, "23505");
  assert.ok(lines.some((l) => l.event === "stream.raw"), "a raw write is counted, not passed on");
});
