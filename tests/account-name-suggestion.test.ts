// A taken account name is refused with a free one beside it, so the form can
// offer it in one click (FOL-hotfix, 26 Nov 2026). The account name stays the
// unique id; the suggestion only proposes another. File-mode store.
//
//   node --import ./tests/register.mjs --experimental-test-module-mocks --test tests/account-name-suggestion.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-name-suggest-"));
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_OPEN_SIGNUP = "1";
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_SETUP_TOKEN;

const { NextRequest } = await import("next/server");
const signupPost = await import("../app/v1/auth/signup/route.ts");
const { createUser } = await import("../server/users.ts");
const names = await import("../server/account-names.ts");
const { assertSafeName } = await import("../../foldrun-core/src/store.ts");

const PW = "a long and unusual passphrase 42!";
const post = (body: unknown) =>
  new NextRequest("http://x/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
  });

test("the first free of name-2, a name from the address, name-3 …", async () => {
  const none = new Set<string>();
  assert.equal(await names.suggestAccountName("acme", "jane.doe@x.example", (n) => !none.has(n)), "acme-2");
  none.add("acme-2");
  assert.equal(await names.suggestAccountName("acme", "jane.doe@x.example", (n) => !none.has(n)), "jane-doe");
  none.add("jane-doe");
  assert.equal(await names.suggestAccountName("acme", "jane.doe@x.example", (n) => !none.has(n)), "acme-3");
  assert.equal(await names.suggestAccountName("acme", "nobody", () => false), null, "nothing free: nothing offered");
});

test("every candidate is a valid account name, however odd the input", () => {
  for (const [wanted, email] of [["Acme Corp!", "Jane.Doe+x@Example.com"], ["", "a@b.c"], ["x".repeat(80), "y".repeat(80) + "@z.c"], ["---", "@@"], ["ünï", "ünï@x.y"]]) {
    for (const c of names.candidates(wanted, email)) {
      assert.doesNotThrow(() => assertSafeName(c, "account name"), `${c} for ${wanted}/${email}`);
      assert.ok(c.length <= 40, c);
    }
  }
  assert.ok(!names.candidates("acme", "acme@x.y").includes("acme"), "never the name that was refused");
});

test("sign-up with a taken name: refused as before, with a free name beside it that then works", async () => {
  await createUser("first@example.com", PW, "acme", { request: "free" });
  await createUser("second@example.com", PW, "acme-2", { request: "free" });
  const res = await signupPost.POST(post({ email: "third@example.com", password: PW, account: "acme" }));
  assert.equal(res.status, 400, "the status is what it was");
  const body = await res.json();
  assert.equal(body.error, names.NAME_TAKEN, "the sentence is what it was");
  assert.equal(body.code, "name_taken");
  assert.equal(body.suggestion, "third", "acme-2 is taken too, so the next is made from the address");
  const again = await signupPost.POST(post({ email: "third@example.com", password: PW, account: body.suggestion }));
  assert.equal(again.status, 200);
  assert.equal((await again.json()).tenant, "third");
});

test("a refusal for any other reason carries no suggestion; a taken address is not turned into a name offer", async () => {
  const mail = await signupPost.POST(post({ email: "first@example.com", password: PW, account: "acme" }));
  assert.equal(mail.status, 400);
  const body = await mail.json();
  assert.match(body.error, /email/);
  assert.equal(body.suggestion, undefined);
  assert.equal(body.code, undefined);
});
