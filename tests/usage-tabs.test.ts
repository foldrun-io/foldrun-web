// The Usage page's four tabs (7 Nov 2026, FOL-125): Overview, Tokens, Compute
// and Rates. The figures' formatting is tested for real; the page's shape is
// read from its source, like the other dashboard pages' tests, because JSX is
// not loadable here.
//
//   node --import ./tests/register.mjs --test tests/usage-tabs.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fmtCredits, fmtQuantity, fmtTokens, rateUnit, periodQuery, METER_NAMES } from "../components/usage-format.ts";

const root = path.join(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

test("credits are whole at a glance, exact when small, grouped", () => {
  assert.equal(fmtCredits(12340.4), "12,340");
  assert.equal(fmtCredits(0.356), "0.36");
  assert.equal(fmtCredits(0), "0");
  assert.equal(fmtCredits(16), "16");
  assert.equal(fmtQuantity(null), "—");
  assert.equal(fmtQuantity(1.23456), "1.235");
  assert.equal(fmtQuantity(12345.5), "12,345.5");
  assert.equal(fmtTokens(1_500_000), "1.5M");
  assert.equal(fmtTokens(2_400), "2.4k");
  assert.equal(fmtTokens(12), "12");
});

test("storage is priced per GB-month; every other meter per its own unit", () => {
  assert.equal(rateUnit("storage", "GB"), "GB-month");
  assert.equal(rateUnit("vcpu", "vCPU-hour"), "vCPU-hour");
  for (const m of ["vcpu", "ram", "disk", "storage", "network", "pods"]) assert.ok(METER_NAMES[m], `${m} has a name`);
});

test("the tab links keep the tenant and the period, and the overview is the bare page", () => {
  assert.equal(periodQuery("default", "overview"), "/dashboard/usage");
  assert.equal(periodQuery("default", "tokens"), "/dashboard/usage?tab=tokens");
  assert.equal(periodQuery("acme", "compute", "2026-10-01", "2026-10-31"), "/dashboard/usage?tenant=acme&tab=compute&from=2026-10-01&to=2026-10-31");
});

test("the page has Overview, Tokens, Compute and Rates, drawn by the kit", () => {
  const page = read("app/dashboard/usage/page.tsx");
  for (const t of ["overview", "tokens", "compute", "rates"]) assert.match(page, new RegExp(`key: "${t}"`), t);
  assert.match(page, /<PageTabs\b/);
  assert.match(page, /<Segmented\b/, "the period is chosen with the kit's switch, not a native date input");
  assert.match(page, /<CreditsBlock\b/, "the two credit pots are on the overview");
  assert.match(page, /<CollapsibleCard\b/, "the per-workspace tables are still there");
  assert.ok(fs.existsSync(path.join(root, "app/dashboard/usage/loading.tsx")), "a loading state");
  assert.ok(fs.existsSync(path.join(root, "app/dashboard/usage/error.tsx")), "an error state");
});

test("Tokens lists your own key at 0 credits, with the supply named; empty periods say so", () => {
  const tabs = read("app/dashboard/usage/tabs.tsx");
  assert.match(tabs, /r\.supply === "own"/);
  assert.match(tabs, /0 credits/);
  assert.match(tabs, /No model calls in this period/);
  assert.match(tabs, /"By provider and model"/);
});

test("Compute shows meters with quantity, rate and credits, the plan fee on its own, and sizes", () => {
  const tabs = read("app/dashboard/usage/tabs.tsx");
  for (const col of ["Quantity", "Rate", "Credits"]) assert.match(tabs, new RegExp(`label: "${col}"`));
  assert.match(tabs, /title="Plan fee"/);
  assert.match(tabs, /title="By step size"/);
  assert.match(tabs, /No compute in this period/);
});

test("Rates shows the rates, the plans (without a runs-at-once column) and the models; empty says nothing is billed", () => {
  const tabs = read("app/dashboard/usage/tabs.tsx");
  assert.match(tabs, /title="What you are charged"/);
  assert.match(tabs, /title="Plans"/);
  assert.match(tabs, /Nothing is billed here/);
  assert.doesNotMatch(tabs, /runs at once|concurrency/i, "runs at once is not sold");
  assert.match(tabs, /Compute at once/);
});

test("the credits block keeps the pots apart and says plan credits never pay for tokens", () => {
  const tabs = read("app/dashboard/usage/tabs.tsx");
  assert.match(tabs, /label="Plan credits"/);
  assert.match(tabs, /label="Bought credits"/);
  assert.match(tabs, /tokens on foldrun's models/);
});
