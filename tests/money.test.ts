// How an amount is written. One sign, never two, and zero is not a payment.

import test from "node:test";
import assert from "node:assert/strict";
import { usd, signedUsd, credits } from "../components/money.ts";

test("usd carries the minus itself", () => {
  assert.equal(usd(-0.42), "−$0.42");
  assert.equal(usd(0), "$0.00");
  assert.equal(usd(1234.5), "$1,234.50");
});

test("signedUsd never doubles the sign, and never credits a zero", () => {
  // The statement printed "−−$0.18" for weeks: usd() already renders the
  // minus and the row prefixed its own.
  assert.equal(signedUsd(-0.18), "−$0.18");
  assert.equal(signedUsd(-365.25), "−$365.25");
  assert.ok(!signedUsd(-1).includes("−−"), "two minus signs is never right");

  // A waived run is zero, and zero is not money arriving. It rendered as
  // "+$0.00" in credit-green, which said a payment had been received.
  assert.equal(signedUsd(0), "$0.00");
  assert.ok(!signedUsd(0).startsWith("+"), "zero must not read as a credit");

  // Money coming in is the only case that earns a plus.
  assert.equal(signedUsd(50), "+$50.00");
  assert.equal(signedUsd(1234.5), "+$1,234.50");
});

test("credits round to whole cents and keep one sign", () => {
  assert.equal(credits(1), "100 credits");
  assert.equal(credits(0.01), "1 credit");
  assert.equal(credits(-3.65), "−365 credits");
});
