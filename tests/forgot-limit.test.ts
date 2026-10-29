// "I forgot my password" is open to anyone. Its per-caller count used to be
// `forgot:ip:<ip or "?">` — so wherever nothing reports the caller (no trusted
// proxy, or no edge stamp), every request on the install shared the one "?"
// count, and twenty requests an hour from anyone blocked every person's reset
// (FOL-101). Now: per caller only when there is one, per address always, and
// an install-wide ceiling on the mail it sends that answers the same sentence.
//
//   node --import ./tests/register.mjs --test tests/forgot-limit.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-forgot-limit-"));
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_REDIS_URL;
delete process.env.FOLDRUN_TRUST_PROXY;

const { NextRequest } = await import("next/server");
const forgot = await import("../app/api/auth/forgot/route.ts");
const { createUser } = await import("../server/users.ts");
const { rateLimit } = await import("@/platform/cache");
const { recentAudit } = await import("../server/audit.ts");

/** The reset mail (and its audit line) is sent after the answer, so the
 *  answer's timing says nothing: wait for the n-th line. */
const resets = async (n: number) => {
  for (let i = 0; i < 200; i++) {
    const lines = (await recentAudit("forgot-acct")).filter((e) => e.action === "password.reset_requested");
    if (lines.length >= n) return lines;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`no reset audit line ${n}`);
};
const ask = (email: string, headers: Record<string, string> = {}) =>
  forgot.POST(new NextRequest("http://x/api/auth/forgot", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ email }) }));

test("with no caller address, a flood of addresses never locks anyone else out", async () => {
  // The old shared "?" count refused the 21st request of the hour, whoever sent it.
  for (let i = 1; i <= 30; i++) assert.equal((await ask(`stranger${i}@example.test`)).status, 200, `request ${i}`);
  assert.equal((await ask("someone-else@example.test")).status, 200);
});

test("per address: the fourth reset for one address in an hour is a 429, another address is not", async () => {
  for (let i = 1; i <= 3; i++) assert.equal((await ask("Target@Example.test")).status, 200, `request ${i}`);
  // The same address however it is spelled.
  assert.equal((await ask(" target@example.TEST ")).status, 429);
  assert.equal((await ask("bystander@example.test")).status, 200);
});

test("per caller, when a trusted proxy names one: the 21st from one address is a 429, another caller is not", async () => {
  process.env.FOLDRUN_TRUST_PROXY = "1";
  try {
    const from = { "x-forwarded-for": "203.0.113.9" };
    for (let i = 1; i <= 20; i++) assert.equal((await ask(`ip-flood${i}@example.test`, from)).status, 200, `request ${i}`);
    assert.equal((await ask("ip-flood-21@example.test", from)).status, 429);
    assert.equal((await ask("ip-other@example.test", { "x-forwarded-for": "198.51.100.4" })).status, 200);
  } finally {
    delete process.env.FOLDRUN_TRUST_PROXY;
  }
});

test("install-wide: past the hour's reset mail, the answer is the same sentence and no mail goes", async () => {
  const user = await createUser("owner@forgot.test", "Correct-horse-battery-9", "forgot-acct");
  const first = await ask(user.email);
  assert.equal(first.status, 200);
  // Made-up addresses above spent none of the install's mail.
  const lines = await resets(1);
  assert.equal(lines.length, 1);
  assert.notEqual(lines[0].detail.error, "the install's hourly reset mail limit was reached");

  // Use up the rest of the hour's mail (300; one went above).
  for (let i = 0; i < 299; i++) await rateLimit("forgot:sends", 300, 3600);
  const over = await ask(user.email);
  assert.equal(over.status, 200, "a 429 here would say the address has an account");
  assert.deepEqual(await over.json(), await (await ask("nobody@forgot.test")).json());
  const last = (await resets(2))[0];
  assert.equal(last.detail.sent, false);
  assert.equal(last.detail.error, "the install's hourly reset mail limit was reached");
});
