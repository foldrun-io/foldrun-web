// The words that say how long an emailed sign-in code works are built from
// the same constant that expires it, so they cannot drift again (a mail said
// ten minutes for a while after the lifetime became five).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CODE_MS, CODE_LIFETIME_TEXT, codeMailText, lifetimeText } from "../server/code-lifetime.ts";

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

test("a lifetime is said the way people say it", () => {
  assert.equal(lifetimeText(5 * 60_000), "5 minutes");
  assert.equal(lifetimeText(60_000), "1 minute");
  assert.equal(lifetimeText(90_000), "90 seconds");
});

test("the code mail names the real lifetime", () => {
  assert.ok(codeMailText("123456").includes(`works for ${lifetimeText(CODE_MS)},`));
  assert.equal(CODE_LIFETIME_TEXT, lifetimeText(CODE_MS));
});

test("login-codes expires a code by the same constant, with no number of its own", async () => {
  const src = read("../server/login-codes.ts");
  assert.match(src, /from "@\/server\/code-lifetime"/);
  assert.doesNotMatch(src, /export const CODE_MS\s*=/);
  assert.doesNotMatch(src, /works for \d/);
});

test("the sign-in page takes the lifetime as a value, not as typed digits", () => {
  const msg = JSON.parse(read("../messages/en/auth.json")) as Record<string, Record<string, string>>;
  const text = Object.values(msg).flatMap((o) => Object.values(o)).find((v) => v.includes("a code is on its way"));
  assert.ok(text, "the message exists");
  assert.match(text, /\{lifetime\}/);
  assert.doesNotMatch(text, /\d+ minutes/);
  assert.match(read("../app/(auth)/auth-form.tsx"), /lifetime: CODE_LIFETIME_TEXT/);
});

test("the API docs, where they sit beside this checkout, say the same lifetime", { skip: !fs.existsSync(new URL("../../foldrun-docs/api.md", import.meta.url)) }, () => {
  const line = read("../../foldrun-docs/api.md").split("\n").find((l) => l.includes("`/v1/auth/login/code` |"));
  assert.ok(line);
  const words = lifetimeText(CODE_MS).replace(/^5 /, "five ");
  assert.ok(line.includes(`${words}, once`) || line.includes(`${lifetimeText(CODE_MS)}, once`), `api.md says ${words}`);
});
