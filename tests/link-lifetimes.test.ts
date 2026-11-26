// The mailed links' lifetimes in words come from the constants that expire
// them (the reset mail said thirty minutes by hand, like the code mail said
// ten): the mails, the forgot-password page and the docs.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-link-life-"));
delete process.env.FOLDRUN_DATABASE_URL;
process.env.FOLDRUN_RESEND_API_KEY = "re_test_link_life";

/** Resend, captured. */
const mails: Array<{ subject: string; text: string; html: string }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).startsWith("https://api.resend.com/")) {
    const b = JSON.parse(String(init?.body ?? "{}")) as { subject: string; text: string; html?: string };
    mails.push({ subject: b.subject, text: b.text, html: b.html ?? "" });
    return new Response(JSON.stringify({ id: "m_1" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
}) as typeof fetch;

const life = await import("../server/lifetimes.ts");
const tokens = await import("../server/auth-tokens.ts");
const code = await import("../server/code-lifetime.ts");
const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

test("a lifetime is said in its largest even unit", () => {
  const t = life.lifetimeText;
  assert.equal(t(30 * 60_000), "30 minutes");
  assert.equal(t(60_000), "1 minute");
  assert.equal(t(60 * 60_000), "1 hour");
  assert.equal(t(24 * 3600_000), "24 hours");
  assert.equal(t(7 * 86400_000), "7 days");
  assert.equal(t(90 * 60_000), "90 minutes");
  assert.equal(t(90_000), "90 seconds");
  assert.equal(code.lifetimeText(5 * 60_000), "5 minutes");
});

test("the words are built from the constants the tokens expire by", () => {
  assert.equal(tokens.RESET_TTL_MS, life.RESET_TTL_MS);
  assert.equal(tokens.VERIFY_TTL_MS, life.VERIFY_TTL_MS);
  assert.equal(tokens.SIGNUP_LINK_TTL_MS, life.SIGNUP_LINK_TTL_MS);
  assert.equal(life.RESET_LIFETIME_TEXT, life.lifetimeText(tokens.RESET_TTL_MS));
  assert.equal(life.VERIFY_LIFETIME_TEXT, life.lifetimeText(tokens.VERIFY_TTL_MS));
});

test("no mail or page types a link's lifetime by hand", () => {
  const mail = read("../server/email.ts");
  assert.doesNotMatch(mail, /(works once and for|good for|for) \d+ (seconds?|minutes?|hours?|days?)/);
  for (const k of ["RESET_LIFETIME_TEXT", "VERIFY_LIFETIME_TEXT", "SIGNUP_LINK_LIFETIME_TEXT"]) assert.ok(mail.includes("${" + k + "}"), k);
  const msg = read("../messages/en/auth.json");
  assert.match(msg, /link that works once, for \{lifetime\}\./);
  assert.match(read("../app/(auth)/forgot/page.tsx"), /lifetime: RESET_LIFETIME_TEXT/);
});

test("each mail says the lifetime its token really has", async () => {
  const m = await import("../server/email.ts");
  const u = "https://x.test/l";
  await m.sendResetEmail("t", "a@x.test", u, null);
  await m.sendUnverifiedCodeEmail("t", "a@x.test", u, null);
  await m.sendEmailChangeConfirm("t", "b@x.test", "a@x.test", u);
  const names = mails.map((x) => x.subject);
  assert.ok(names.length >= 3, names.join("|"));
  const reset = mails.find((x) => x.subject.startsWith("Reset"))!;
  assert.ok(reset.text.includes(`works once and for ${life.lifetimeText(tokens.RESET_TTL_MS)}:`), reset.text);
  const unverified = mails.find((x) => x.subject.startsWith("Set your"))!;
  assert.ok(unverified.text.includes(`works once and for ${life.lifetimeText(tokens.RESET_TTL_MS)}:`));
  const change = mails.find((x) => /email|address/i.test(x.subject) && x.text.includes("move"))!;
  assert.ok(change, names.join("|"));
  assert.ok((change.text + change.html).includes(`works once and for ${life.lifetimeText(tokens.VERIFY_TTL_MS)}.`));
});

test("the API docs, where they sit beside this checkout, say the same reset lifetime", { skip: !fs.existsSync(new URL("../../foldrun-docs/api.md", import.meta.url)) }, () => {
  const line = read("../../foldrun-docs/api.md").split("\n").find((l) => l.includes("`/v1/auth/reset` |"));
  assert.ok(line);
  assert.ok(line.includes(`Works once and for ${life.RESET_LIFETIME_TEXT}`), "api.md");
});
