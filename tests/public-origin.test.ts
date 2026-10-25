// Every link and redirect goes to the environment's own address. Behind the
// proxy the request's origin is the server's internal one: the confirm-email
// redirect sent people there (18 Oct 2026).
//
//   node --import ./tests/register.mjs --test tests/public-origin.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { publicOrigin, installOrigin } from "../server/auth-flows.ts";

const internal = (headers: Record<string, string> = {}) => new NextRequest("http://0.0.0.0:3900/api/auth/verify?token=x", { headers });

test("the environment's FOLDRUN_PUBLIC_URL wins over everything the request says", () => {
  process.env.FOLDRUN_PUBLIC_URL = "https://stage.example.test/";
  try {
    assert.equal(installOrigin(), "https://stage.example.test");
    assert.equal(publicOrigin(internal({ "x-forwarded-host": "evil.test" })), "https://stage.example.test");
  } finally {
    delete process.env.FOLDRUN_PUBLIC_URL;
  }
});

test("unset: the host a trusted proxy saw, then the request itself — never a fixed host", () => {
  delete process.env.FOLDRUN_PUBLIC_URL;
  assert.equal(installOrigin(), null);
  process.env.FOLDRUN_TRUST_PROXY = "1";
  try {
    assert.equal(publicOrigin(internal({ "x-forwarded-host": "lan.example.test", "x-forwarded-proto": "http" })), "http://lan.example.test");
    assert.equal(publicOrigin(internal({ "x-forwarded-host": "a.example.test, b" })), "https://a.example.test");
  } finally {
    delete process.env.FOLDRUN_TRUST_PROXY;
  }
  assert.equal(publicOrigin(internal()), "http://0.0.0.0:3900");
});

test("a forwarded host is never believed without a trusted proxy: a reset link cannot be pointed elsewhere", () => {
  delete process.env.FOLDRUN_PUBLIC_URL;
  delete process.env.FOLDRUN_TRUST_PROXY;
  assert.equal(publicOrigin(internal({ "x-forwarded-host": "attacker.example.test" })), "http://0.0.0.0:3900");
});
