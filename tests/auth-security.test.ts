// The primitives under sign-in: TOTP against a known vector, tokens that
// verify and expire and bind, and a password policy that says no to the
// right things.

import test from "node:test";
import assert from "node:assert/strict";
import { hotp, totp, verifyTotp, base32Encode, base32Decode, newSecret, newBackupCodes, hashBackup, otpauthUri } from "../server/totp.ts";
import { mintToken, readToken, hashFingerprint } from "../server/auth-tokens.ts";
import { assertPasswordPolicy, PolicyError } from "../server/password-policy.ts";

process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";

test("HOTP matches RFC 4226's test vectors", () => {
  // The secret "12345678901234567890", counters 0..3 — the numbers in the RFC.
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.deepEqual([0, 1, 2, 3].map((c) => hotp(secret, c)), ["755224", "287082", "359152", "969429"]);
});

test("TOTP accepts the current step and one either side, and nothing else", () => {
  const secret = newSecret();
  const now = 1_700_000_000_000;
  const code = totp(secret, now);
  assert.ok(verifyTotp(secret, code, now));
  assert.ok(verifyTotp(secret, code, now + 30_000), "the next step still accepts it");
  assert.ok(verifyTotp(secret, code, now - 30_000), "the previous step still accepts it");
  assert.ok(!verifyTotp(secret, code, now + 61_000), "two steps on, it is dead");
  assert.ok(!verifyTotp(secret, "000000", now) || code === "000000");
  assert.ok(!verifyTotp(secret, "12345", now), "five digits is not a code");
  assert.ok(verifyTotp(secret, code.slice(0, 3) + " " + code.slice(3), now), "a space in the middle is how people type them");
});

test("base32 round-trips, secrets are 160 bits, the URI is what apps expect", () => {
  const buf = Buffer.from("any bytes at all, really");
  assert.equal(base32Decode(base32Encode(buf)).toString(), buf.toString());
  assert.equal(base32Decode(newSecret()).length, 20);
  const uri = otpauthUri("ABC", "me@example.com");
  assert.match(uri, /^otpauth:\/\/totp\/foldrun:me%40example\.com\?secret=ABC&issuer=foldrun&algorithm=SHA1&digits=6&period=30$/);
});

test("backup codes: eight, unambiguous alphabet, hashed the same however typed", () => {
  const codes = newBackupCodes();
  assert.equal(codes.length, 8);
  for (const c of codes) assert.match(c, /^[abcdefghjkmnpqrstuvwxyz23456789]{5}-[abcdefghjkmnpqrstuvwxyz23456789]{5}$/);
  assert.equal(hashBackup(codes[0]), hashBackup(codes[0].toUpperCase().replace("-", " ")));
  assert.notEqual(hashBackup(codes[0]), hashBackup(codes[1]));
});

test("a token verifies, carries its payload, expires, and is bound to its kind", () => {
  const t = mintToken("reset", { u: "abc", h: "deadbeef" }, 1000);
  assert.deepEqual(readToken("reset", t), { u: "abc", h: "deadbeef" });
  assert.equal(readToken("verify", t), null, "a reset token is not a verify token");
  assert.equal(readToken("reset", t.slice(0, -1) + (t.at(-1) === "a" ? "b" : "a")), null, "one flipped character");
  const dead = mintToken("reset", { u: "abc" }, -1);
  assert.equal(readToken("reset", dead), null, "expired");
});

test("the reset fingerprint changes when the hash does, and is not the hash", () => {
  const a = hashFingerprint("hash-one"), b = hashFingerprint("hash-two");
  assert.notEqual(a, b);
  assert.equal(a.length, 16);
  assert.ok(!"hash-one".includes(a));
});

test("the password policy: length, not your email, not a keyboard walk", async () => {
  await assert.rejects(assertPasswordPolicy("short", "a@b.co"), PolicyError);
  await assert.rejects(assertPasswordPolicy("matt.smith.rocks", "matt.smith@x.io"), /email/);
  await assert.rejects(assertPasswordPolicy("qwertyuiop123", "a@b.co"), /guess/);
  await assert.rejects(assertPasswordPolicy("aaaaaaaaaaaa", "a@b.co"), /guess/);
  await assert.doesNotReject(assertPasswordPolicy("correct horse battery", "a@b.co"));
});
