// The usage and pricing API of 7 Nov 2026 (FOL-125): GET /api/pricing (open,
// exact-origin CORS, ETag, five minutes' cache, 404 where nothing is sold, 503
// when prices cannot be read), GET /api/usage/rates, and ?from&to on
// GET /api/usage with the credits, tokens and compute blocks. File-mode store.
//
//   node --import ./tests/register.mjs --test tests/usage-pricing.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-usage-pricing-"));
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_SIGNUP_ORIGINS;

const { createApiKey } = await import("../server/auth.ts");
const { createUser } = await import("../server/users.ts");
const { billing } = await import("@/platform/billing");
const { unmetered } = await import("../server/api-limits.ts");
const { workspaceDir } = await import("@/lib/store");
const pricing = await import("../app/api/pricing/route.ts");
const rates = await import("../app/api/usage/rates/route.ts");
const usage = await import("../app/api/usage/route.ts");
import type { MeterRates, PricingCatalogue, AccountCredits } from "../../foldrun-platform/src/billing.ts";

const RATES: MeterRates = { creditUsd: 0.01, vcpuUsdPerHour: 0.06, ramUsdPerGibHour: 0.02, diskUsdPerGibMonth: 0.16, storageUsdPerGbMonth: 0.1, networkUsdPerGb: 0.2, margin: 1.2 };
const PLAN = { id: "starter", name: "Starter", feeUsd: 29, creditsPerMonth: 3000, rollover: true, rolloverCapCredits: 6000, storageGb: 10, computeAtOnce: { vcpu: 4, memGiB: 8 }, lane: "normal" as const, paysForTokens: false as const };
const CATALOGUE: PricingCatalogue = {
  version: 3, creditUsd: 0.01,
  plans: [{ ...PLAN, id: "free", name: "Free", feeUsd: 0, creditsPerMonth: 300, rollover: false, rolloverCapCredits: 0, storageGb: 2, computeAtOnce: { vcpu: 2, memGiB: 4 } }, PLAN],
  contact: { label: "Contact us" },
  meters: [{ meter: "vcpu", unit: "vCPU-hour", usd: 0.06 }],
  example: { name: "default step", vcpu: 2, memGiB: 2, creditsPerHour: 16 },
  models: { margin: 1.2, providers: ["anthropic"], soon: ["zai"], prices: [] },
};
const CREDITS: AccountCredits = { pots: { planUsd: 12, boughtUsd: 5 }, plan: { ...PLAN, status: "active", resetsAt: "2026-12-01T00:00:00.000Z" }, boughtOldestExpiresAt: null };

type Hooks = { catalogue?: () => PricingCatalogue; meterRates?: () => MeterRates; accountCredits?: (t: string) => Promise<AccountCredits> };
/** Give billing these hooks for the length of `fn`, whichever billing this build carries. */
async function withBilling<T>(hooks: Hooks, fn: () => Promise<T> | T): Promise<T> {
  const b = billing() as Hooks;
  const saved = (Object.keys(hooks) as (keyof Hooks)[]).map((k) => [k, Object.prototype.hasOwnProperty.call(b, k), b[k]] as const);
  Object.assign(b, hooks);
  try {
    return await fn();
  } finally {
    for (const [k, had, v] of saved) {
      if (had) (b as Record<string, unknown>)[k] = v;
      else delete (b as Record<string, unknown>)[k];
    }
  }
}

const tenant = "price-co";
const owner = await createUser("owner@price.test", "a long and unusual passphrase 42!", tenant, { request: "free" });
fs.mkdirSync(workspaceDir(tenant, "desk"), { recursive: true });
fs.writeFileSync(path.join(workspaceDir(tenant, "desk"), "AGENTS.md"), "---\ndescription: d\n---\n\nContext.\n");
const key = async (workspaces: string[] | null = null) => (await createApiKey(tenant, "k", owner.email, undefined, "admin", workspaces)).key;
const call = (route: { GET: (r: NextRequest) => Promise<Response> }, url: string, k: string | null, headers: Record<string, string> = {}) =>
  route.GET(new NextRequest(`http://localhost${url}`, { headers: { ...(k ? { authorization: `Bearer ${k}` } : {}), ...headers } }));

// ------------------------------------------------------------ /api/pricing

test("GET /api/pricing: open, the catalogue whole, an ETag and five minutes' cache", async () => {
  await withBilling({ catalogue: () => CATALOGUE }, async () => {
    const res = await call(pricing, "/api/pricing", null);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), CATALOGUE);
    assert.equal(res.headers.get("cache-control"), "public, max-age=300");
    const etag = res.headers.get("etag");
    assert.match(etag ?? "", /^"[A-Za-z0-9_-]{22}"$/);
    const again = await call(pricing, "/api/pricing", null, { "if-none-match": etag! });
    assert.equal(again.status, 304, "an unchanged catalogue is not sent twice");
  });
});

test("GET /api/pricing: no plan carries the anti-abuse run cap, and plan credits never pay for tokens", async () => {
  await withBilling({ catalogue: () => CATALOGUE }, async () => {
    const body = (await (await call(pricing, "/api/pricing", null)).json()) as PricingCatalogue;
    for (const p of body.plans) {
      assert.equal(p.paysForTokens, false);
      assert.ok(!("concurrency" in p) && !("runsAtOnce" in p), "runs at once is not advertised");
    }
  });
});

test("GET /api/pricing: readable cross-origin from the sign-up origins only, with no credentials", async () => {
  await withBilling({ catalogue: () => CATALOGUE }, async () => {
    const ok = await call(pricing, "/api/pricing", null, { origin: "https://foldrun.io" });
    assert.equal(ok.headers.get("access-control-allow-origin"), "https://foldrun.io");
    assert.equal(ok.headers.get("access-control-allow-credentials"), null);
    const other = await call(pricing, "/api/pricing", null, { origin: "https://evil.example" });
    assert.equal(other.headers.get("access-control-allow-origin"), null);
    assert.match(other.headers.get("vary") ?? "", /Origin/i);
    const pre = await pricing.OPTIONS(new NextRequest("http://localhost/api/pricing", { method: "OPTIONS", headers: { origin: "https://foldrun.io" } }));
    assert.equal(pre.status, 204);
  });
});

test("GET /api/pricing: 404 where nothing is sold, 503 and never cached when prices cannot be read", async () => {
  await withBilling({ catalogue: undefined }, async () => {
    delete (billing() as Hooks).catalogue;
    const res = await call(pricing, "/api/pricing", null);
    assert.equal(res.status, 404);
    assert.equal(typeof ((await res.json()) as { error: string }).error, "string");
  });
  await withBilling({ catalogue: () => { throw new Error("margin unavailable"); } }, async () => {
    const res = await call(pricing, "/api/pricing", null);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(await res.text(), /margin unavailable/, "the cause is not echoed");
  });
});

test("the public pricing read is not counted against any key", () => {
  assert.equal(unmetered("GET", "/api/pricing"), true);
  assert.equal(unmetered("POST", "/api/pricing"), false);
});

// ------------------------------------------------------------ /api/usage/rates

test("GET /api/usage/rates: needs a key; answers the rates, the plan and the catalogue", async () => {
  assert.equal((await call(rates, "/api/usage/rates", null)).status, 401);
  await withBilling({ catalogue: () => CATALOGUE, meterRates: () => RATES, accountCredits: async () => CREDITS }, async () => {
    const res = await call(rates, "/api/usage/rates", await key());
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await res.json()) as { rates: MeterRates; plan: { id: string; status: string }; catalogue: PricingCatalogue };
    assert.deepEqual(body.rates, RATES);
    assert.equal(body.plan.id, "starter");
    assert.equal(body.plan.status, "active");
    assert.deepEqual(body.catalogue, CATALOGUE);
  });
});

test("GET /api/usage/rates: a key limited to some workspaces does not read the account's plan; rates stay", async () => {
  await withBilling({ catalogue: () => CATALOGUE, meterRates: () => RATES, accountCredits: async () => CREDITS }, async () => {
    const body = (await (await call(rates, "/api/usage/rates", await key(["desk"]))).json()) as { rates: MeterRates | null; plan: unknown };
    assert.equal(body.plan, null);
    assert.deepEqual(body.rates, RATES);
  });
});

test("GET /api/usage/rates: nothing billed means nulls, not an error", async () => {
  await withBilling({}, async () => {
    const b = billing() as Hooks;
    const saved = { c: b.catalogue, m: b.meterRates, a: b.accountCredits };
    delete b.catalogue; delete b.meterRates; delete b.accountCredits;
    try {
      const res = await call(rates, "/api/usage/rates", await key());
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { rates: null, plan: null, catalogue: null });
    } finally {
      Object.assign(b, Object.fromEntries(Object.entries({ catalogue: saved.c, meterRates: saved.m, accountCredits: saved.a }).filter(([, v]) => v)));
    }
  });
});

// ------------------------------------------------------------ /api/usage ?from&to

type Usage = { period: { from: string; to: string; basis: string }; credits: unknown; tokens: { totals: { calls: number }; byModel: unknown[] }; compute: { meters: { meter: string }[]; planFee: unknown; bySize: unknown[] }; billed: unknown; totals: { runs: number } };

test("GET /api/usage: ?from&to bound the period; default the month so far; the new blocks are always there", async () => {
  const k = await key();
  const def = (await (await call(usage, "/api/usage", k)).json()) as Usage;
  assert.match(def.period.from, /^\d{4}-\d{2}-01$/);
  assert.equal(def.period.basis, "consumption");
  assert.deepEqual(def.compute.meters.map((m) => m.meter), ["vcpu", "ram", "disk", "storage", "network", "pods"]);
  assert.equal(def.tokens.totals.calls, 0);
  assert.deepEqual(def.tokens.byModel, []);
  const chosen = (await (await call(usage, "/api/usage?from=2026-10-01&to=2026-10-31", k)).json()) as Usage;
  assert.deepEqual(chosen.period, { from: "2026-10-01", to: "2026-10-31", basis: "consumption" });
  assert.equal(typeof chosen.totals.runs, "number", "the older totals are still there");
});

test("GET /api/usage: a bad or too-long period is a 400 that says why", async () => {
  const k = await key();
  for (const [q, why] of [["from=nope", /YYYY-MM-DD/], ["from=2026-11-05&to=2026-11-01", /after/], ["from=2024-01-01&to=2026-01-01", /year/]] as const) {
    const res = await call(usage, `/api/usage?${q}`, k);
    assert.equal(res.status, 400, q);
    assert.match(((await res.json()) as { error: string }).error, why);
  }
});

test("GET /api/usage: credits come from the billing hook, and a scoped key gets none of the account's money", async () => {
  await withBilling({ meterRates: () => RATES, accountCredits: async () => CREDITS }, async () => {
    const full = (await (await call(usage, "/api/usage", await key())).json()) as Usage & { credits: { pots: { planUsd: number; boughtUsd: number }; plan: { id: string } } };
    assert.equal(full.credits.pots.planUsd, 12);
    assert.equal(full.credits.pots.boughtUsd, 5);
    assert.equal(full.credits.plan.id, "starter");
    const scoped = (await (await call(usage, "/api/usage", await key(["desk"]))).json()) as Usage;
    assert.equal(scoped.credits, null);
    assert.equal(scoped.compute.planFee, null);
    assert.equal(scoped.billed, null);
  });
});
