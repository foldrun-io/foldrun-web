// Sign-up links (14 Nov 2026): a link mailed to one address opens an account
// there even while registration is closed — verified from the start, on the
// `link` door (no trial), for that address only, once. File-mode store.
//
//   node --import ./tests/register.mjs --experimental-test-module-mocks --test tests/signup-links.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-signup-links-"));
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_OPEN_SIGNUP;
delete process.env.FOLDRUN_SETUP_TOKEN;

const { NextRequest } = await import("next/server");
const signupPost = await import("../app/api/auth/signup/route.ts");
const { signupLinkUrl, readSignupLink } = await import("../server/signup-links.ts");
const { createUser, findUser, accountAdmission } = await import("../server/users.ts");
const { mintToken } = await import("../server/auth-tokens.ts");

const PW = "a long and unusual passphrase 42!";
const post = (body: unknown) =>
  new NextRequest("http://x/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
  });
const tokenOf = (url: string) => new URL(url).searchParams.get("link")!;

// The install's first account exists, so the bootstrap door is shut and,
// with FOLDRUN_OPEN_SIGNUP unset, registration is closed.
await createUser("first@example.com", PW, "first", { request: "free" });

test("a link names its address, who asked and where to go next; a changed byte is refused", () => {
  const url = signupLinkUrl("https://dash.example.com/", { email: " Sara@Example.com ", from: "partner:ir", next: "https://shop.example.ir/charge?account=sara%40example.com" });
  assert.match(url, /^https:\/\/dash\.example\.com\/signup\?link=signup-link\./);
  const t = tokenOf(url);
  assert.deepEqual(readSignupLink(t), { email: "sara@example.com", from: "partner:ir", next: "https://shop.example.ir/charge?account=sara%40example.com" });
  const forged = t.slice(0, -1) + (t.endsWith("0") ? "1" : "0");
  assert.equal(readSignupLink(forged), null);
  assert.equal(readSignupLink(""), null);
  assert.equal(readSignupLink(undefined), null);
});

test("only an https next with no credentials; bad addresses and names are refused when minting", () => {
  assert.throws(() => signupLinkUrl("https://d", { email: "x@y.z", from: "partner:ir", next: "http://plain.example" }), /https/);
  assert.throws(() => signupLinkUrl("https://d", { email: "x@y.z", from: "partner:ir", next: "javascript:alert(1)" }), /https/);
  assert.throws(() => signupLinkUrl("https://d", { email: "x@y.z", from: "partner:ir", next: "https://u:p@evil.example" }), /https/);
  assert.throws(() => signupLinkUrl("https://d", { email: "not-an-address", from: "partner:ir" }), /email/);
  assert.throws(() => signupLinkUrl("https://d", { email: "x@y.z", from: "Partner IR!" }), /from/);
  assert.equal(readSignupLink(tokenOf(signupLinkUrl("https://d", { email: "x@y.z", from: "operator" })))?.next, null);
});

test("an expired link reads as nothing", () => {
  const old = mintToken("signup-link", { e: "late@example.com", f: "partner:ir" }, -1000);
  assert.equal(readSignupLink(old), null);
});

test("with registration closed a stranger is refused, but the link opens a verified account on the link door", async () => {
  const closed = await signupPost.POST(post({ email: "sara@example.com", password: PW, account: "sara" }));
  assert.equal(closed.status, 400);
  assert.match((await closed.json()).error, /closed/);

  const link = tokenOf(signupLinkUrl("https://d", { email: "sara@example.com", from: "partner:ir", next: "https://shop.example.ir/charge?account=sara%40example.com" }));
  const res = await signupPost.POST(post({ email: "Sara@example.com", password: PW, account: "sara", link }));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const body = await res.json();
  assert.equal(body.tenant, "sara");
  assert.equal(body.next, "https://shop.example.ir/charge?account=sara%40example.com");
  assert.match(res.headers.get("set-cookie") ?? "", /foldrun_session=/);
  const u = await findUser("sara@example.com");
  assert.ok(u?.owner, "the person owns the new account");
  assert.ok(u?.emailVerifiedAt, "opening the mailed link proved the address");
  assert.equal(await accountAdmission("sara"), "link");
});

test("the link is for its address only, works once, and a forged or taken name is refused", async () => {
  const link = tokenOf(signupLinkUrl("https://d", { email: "omid@example.com", from: "partner:ir" }));
  const other = await signupPost.POST(post({ email: "someone-else@example.com", password: PW, account: "omid", link }));
  assert.equal(other.status, 400);
  assert.match((await other.json()).error, /omid@example\.com/);

  const taken = await signupPost.POST(post({ email: "omid@example.com", password: PW, account: "sara", link }));
  assert.equal(taken.status, 409, "the account name belongs to someone else");

  const bad = await signupPost.POST(post({ email: "omid@example.com", password: PW, account: "omid", link: link + "x" }));
  assert.equal(bad.status, 400);

  const ok = await signupPost.POST(post({ email: "omid@example.com", password: PW, account: "omid", link }));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).next, undefined, "no next in the link, none in the answer");
  const again = await signupPost.POST(post({ email: "omid@example.com", password: PW, account: "omid2", link }));
  assert.equal(again.status, 409, "an address has one login: the second use is refused");
});
