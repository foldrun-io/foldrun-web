// The sign-up switches (7 Nov 2026): GET /api/signup (open, exact-origin
// CORS, a minute's cache, exactly { free, paid, plans }), the sign-up POST
// asking the door it is for (a plan refused, closed refused before any
// address work), the first account decided under the lock (two at once make
// one owner), the door recorded on the person, the trial only for the doors
// that earn it, and what the sign-up page draws. File-mode store.
//
//   node --import ./tests/register.mjs --experimental-test-module-mocks --test tests/signup-switches.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fresh = () => {
  process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-signup-switches-"));
};
fresh();
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_SIGNUP_ORIGINS;
delete process.env.FOLDRUN_OPEN_SIGNUP;
delete process.env.FOLDRUN_SETUP_TOKEN;

const { NextRequest } = await import("next/server");
const { registerPlatform } = await import("../../foldrun-core/src/platform.ts");
const { billing } = await import("@/platform/billing");
const signupApi = await import("../app/api/signup/route.ts");
const signupPost = await import("../app/api/auth/signup/route.ts");
const verifyRoute = await import("../app/api/auth/verify/route.ts");
const { createUser, accountAdmission, findUser, hasUsers } = await import("../server/users.ts");
const { signupPageState, signupModesNow, publicSignup } = await import("../server/signup.ts");
const { verifyLink } = await import("../server/auth-flows.ts");
import type { SignupOffer, PublicPlan } from "../../foldrun-platform/src/signup.ts";

const PW = "a long and unusual passphrase 42!";
const hosted = (on: boolean) => registerPlatform({ edition: () => (on ? "hosted" : "self-hosted") });
const get = (url: string, headers: Record<string, string> = {}) => new NextRequest(`http://x${url}`, { headers });
const post = (body: unknown) =>
  new NextRequest("http://x/api/auth/signup", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });

/** Give billing an offer for the length of `fn` — whichever billing this
 *  build carries (the public one has none, the hosted one its own). */
async function withOffer<T>(offer: SignupOffer | null, fn: () => Promise<T> | T): Promise<T> {
  const b = billing() as { signupOffer?: () => SignupOffer };
  const had = Object.prototype.hasOwnProperty.call(b, "signupOffer");
  const before = b.signupOffer;
  if (offer) b.signupOffer = () => offer;
  else delete b.signupOffer;
  try {
    return await fn();
  } finally {
    if (had) b.signupOffer = before;
    else delete b.signupOffer;
  }
}

const PLAN: PublicPlan = { id: "pro", name: "Pro", price: { amount: 9900, currency: "usd", interval: "month" }, credits: 9900, storageGb: null, vcpu: 8, memoryGiB: 16, priority: true };

// ------------------------------------------------------------ the read

test("GET /api/signup: open, exactly { free, paid, plans }, cached a minute", async () => {
  hosted(true);
  await withOffer(null, async () => {
    process.env.FOLDRUN_OPEN_SIGNUP = "0";
    let res = await signupApi.GET(get("/api/signup"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "public, max-age=60");
    assert.deepEqual(await res.json(), { free: false, paid: false, plans: [] });
    process.env.FOLDRUN_OPEN_SIGNUP = "1";
    res = await signupApi.GET(get("/api/signup"));
    assert.deepEqual(await res.json(), { free: true, paid: false, plans: [] });
  });
  delete process.env.FOLDRUN_OPEN_SIGNUP;
});

test("GET /api/signup: the first-account exception is never advertised as free sign-up", async () => {
  hosted(true);
  fresh();
  assert.equal(await hasUsers(), false);
  assert.equal(signupModesNow(false).bootstrap, true);
  const body = await (await signupApi.GET(get("/api/signup"))).json();
  assert.equal(body.free, false);
});

test("GET /api/signup: paid and plans only while paid is in effect; nothing beyond the contract", async () => {
  hosted(true);
  // Configured but blocked (today: the paid flow does not exist): no plans.
  await withOffer({ paidConfigured: true, paidBlocked: "the paid sign-up flow is not built yet (FOL-125)", plans: [PLAN] }, async () => {
    assert.deepEqual(await (await signupApi.GET(get("/api/signup"))).json(), { free: false, paid: false, plans: [] });
  });
  // In effect: the plans, field by field — an extra field billing adds does not leak.
  const leaky = { ...PLAN, concurrency: 4, secret: "x", price: { ...PLAN.price, stripePrice: "price_123" } } as PublicPlan;
  await withOffer({ paidConfigured: true, paidBlocked: null, plans: [leaky] }, async () => {
    const body = await (await signupApi.GET(get("/api/signup"))).json();
    assert.deepEqual(body, { free: false, paid: true, plans: [PLAN] });
    assert.deepEqual(Object.keys(body.plans[0]).sort(), ["credits", "id", "memoryGiB", "name", "price", "priority", "storageGb", "vcpu"]);
    assert.deepEqual(Object.keys(body.plans[0].price).sort(), ["amount", "currency", "interval"]);
  });
});

test("GET /api/signup: the community edition is { free, paid: false, plans: [] }, whatever billing offers", async () => {
  hosted(false);
  process.env.FOLDRUN_OPEN_SIGNUP = "1";
  await withOffer({ paidConfigured: true, paidBlocked: null, plans: [PLAN] }, async () => {
    assert.deepEqual(await (await signupApi.GET(get("/api/signup"))).json(), { free: true, paid: false, plans: [] });
  });
  delete process.env.FOLDRUN_OPEN_SIGNUP;
  hosted(true);
});

test("GET /api/signup: CORS for the site's exact origins only, never *, never credentials", async () => {
  for (const origin of ["https://foldrun.io", "https://www.foldrun.io", "https://docs.foldrun.io"]) {
    const res = await signupApi.GET(get("/api/signup", { origin }));
    assert.equal(res.headers.get("access-control-allow-origin"), origin);
    assert.match(res.headers.get("vary") ?? "", /Origin/);
    assert.equal(res.headers.get("access-control-allow-credentials"), null);
  }
  for (const origin of ["https://evil.example", "https://foldrun.io.evil.example", "https://evilfoldrun.io", "http://foldrun.io", "https://foldrun.io:8443", "null", "https://status.foldrun.io"]) {
    const res = await signupApi.GET(get("/api/signup", { origin }));
    assert.equal(res.headers.get("access-control-allow-origin"), null, origin);
    assert.match(res.headers.get("vary") ?? "", /Origin/, "Vary even when refused, so a cache never hands one origin's answer to another");
    assert.equal(res.status, 200, "CORS decides who may read it in a browser, not who may ask");
  }
  const pre = signupApi.OPTIONS(get("/api/signup", { origin: "https://foldrun.io" }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://foldrun.io");
  assert.match(pre.headers.get("access-control-allow-methods") ?? "", /GET/);
  assert.equal(signupApi.OPTIONS(get("/api/signup", { origin: "https://evil.example" })).headers.get("access-control-allow-origin"), null);
  process.env.FOLDRUN_SIGNUP_ORIGINS = "http://localhost:4321";
  try {
    assert.equal((await signupApi.GET(get("/api/signup", { origin: "http://localhost:4321" }))).headers.get("access-control-allow-origin"), "http://localhost:4321");
    assert.equal((await signupApi.GET(get("/api/signup", { origin: "https://foldrun.io" }))).headers.get("access-control-allow-origin"), null, "the variable replaces the list");
  } finally {
    delete process.env.FOLDRUN_SIGNUP_ORIGINS;
  }
});

test("GET /api/signup: a failure answers the same shape, doors shut, never cached, still with CORS", async () => {
  await withOffer(null, async () => {
    const b = billing() as { signupOffer?: () => SignupOffer };
    b.signupOffer = () => {
      throw new Error("boom");
    };
    const res = await signupApi.GET(get("/api/signup", { origin: "https://foldrun.io" }));
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("access-control-allow-origin"), "https://foldrun.io");
    assert.deepEqual(await res.json(), { free: false, paid: false, plans: [] });
  });
});

// ------------------------------------------------------------ the doors

test("two first sign-ups at once make exactly one owner, by the bootstrap door", async () => {
  hosted(true);
  fresh();
  delete process.env.FOLDRUN_OPEN_SIGNUP;
  const tries = await Promise.allSettled([1, 2, 3, 4].map((i) => createUser(`first${i}@example.test`, PW, `first${i}`, { request: "free" })));
  const made = tries.filter((t) => t.status === "fulfilled").map((t) => (t as PromiseFulfilledResult<{ admission?: string; owner?: boolean }>).value);
  assert.equal(made.length, 1, "the lock decides who was first, not a read taken before it");
  assert.equal(made[0].admission, "bootstrap");
  for (const t of tries.filter((x) => x.status === "rejected")) assert.match(String((t as PromiseRejectedResult).reason?.message), /signups are closed/);
});

test("with free sign-up on, concurrent first sign-ups all come in — exactly one by bootstrap", async () => {
  fresh();
  process.env.FOLDRUN_OPEN_SIGNUP = "1";
  const made = await Promise.all([1, 2, 3].map((i) => createUser(`open${i}@example.test`, PW, `open${i}`, { request: "free" })));
  assert.deepEqual(made.map((u) => u.admission).sort(), ["bootstrap", "free", "free"]);
  // Recorded, and read back from the store.
  for (const u of made) assert.equal((await findUser(u.email))?.admission, u.admission);
  delete process.env.FOLDRUN_OPEN_SIGNUP;
});

test("a door is asked for by name: anything else is the closed sentence", async () => {
  fresh();
  process.env.FOLDRUN_OPEN_SIGNUP = "1";
  for (const request of ["pro", "", undefined, "FREE"]) {
    await assert.rejects(createUser(`x${String(request)}@example.test`, PW, `x${Math.random().toString(36).slice(2, 8)}`, { request } as never), /signups are closed/);
  }
  // Paid configured but not in effect: closed, even with free open.
  await withOffer({ paidConfigured: true, paidBlocked: "no plan in the catalogue is marked purchasable", plans: [] }, async () => {
    await createUser("boot@example.test", PW, "boot", { request: "free" });
    await assert.rejects(createUser("payer@example.test", PW, "payer", { request: "paid" }), /signups are closed/);
  });
  delete process.env.FOLDRUN_OPEN_SIGNUP;
});

test("the setup token holds at the locked bootstrap decision too", async () => {
  fresh();
  process.env.FOLDRUN_SETUP_TOKEN = "tok-" + "x".repeat(20);
  try {
    await assert.rejects(createUser("nosetup@example.test", PW, "nosetup", { request: "free" }), /setup link/);
    const u = await createUser("withsetup@example.test", PW, "withsetup", { request: "free", setupToken: true });
    assert.equal(u.admission, "bootstrap");
  } finally {
    delete process.env.FOLDRUN_SETUP_TOKEN;
  }
});

// ------------------------------------------------------------ the POST

test("POST /api/auth/signup: a plan is refused (400) before anything is made", async () => {
  fresh();
  process.env.FOLDRUN_OPEN_SIGNUP = "1";
  for (const plan of ["pro", null, ""]) {
    const res = await signupPost.POST(post({ email: "plan@example.test", password: PW, account: "planco", plan }));
    assert.equal(res.status, 400, JSON.stringify(plan));
    assert.match((await res.json()).error, /plan/);
  }
  assert.equal(await hasUsers(), false);
  delete process.env.FOLDRUN_OPEN_SIGNUP;
});

test("POST /api/auth/signup: first account is bootstrap; then closed for everyone alike; free records free", async () => {
  fresh();
  delete process.env.FOLDRUN_OPEN_SIGNUP;
  const first = await signupPost.POST(post({ email: "founder@example.test", password: PW, account: "founder" }));
  assert.equal(first.status, 200, await first.clone().text());
  assert.equal((await findUser("founder@example.test"))?.admission, "bootstrap");
  const known = await signupPost.POST(post({ email: "founder@example.test", password: PW, account: "other1" }));
  const unknown = await signupPost.POST(post({ email: "stranger@example.test", password: PW, account: "other2" }));
  assert.equal(known.status, unknown.status);
  assert.equal((await known.json()).error, (await unknown.json()).error, "closed: the same sentence for a known and an unknown address");
  process.env.FOLDRUN_OPEN_SIGNUP = "1";
  const free = await signupPost.POST(post({ email: "freebie@example.test", password: PW, account: "freebie" }));
  assert.equal(free.status, 200);
  assert.equal((await findUser("freebie@example.test"))?.admission, "free");
  delete process.env.FOLDRUN_OPEN_SIGNUP;
});

// ------------------------------------------------------------ the trial

test("verifying grants the trial only to an account whose door earns it", async () => {
  hosted(true);
  fresh();
  process.env.FOLDRUN_OPEN_SIGNUP = "1";
  const b = billing() as { grantTrial: (tenant: string) => Promise<boolean> };
  const before = b.grantTrial;
  const granted: string[] = [];
  b.grantTrial = async (tenant) => {
    granted.push(tenant);
    return true;
  };
  try {
    const boot = await createUser("t-boot@example.test", PW, "tboot", { request: "free" });
    const free = await createUser("t-free@example.test", PW, "tfree", { request: "free" });
    // A paid sign-up, as Part B will record one (the door is not open yet,
    // so it is written the way the lock would have).
    const paid = await withOffer({ paidConfigured: true, paidBlocked: null, plans: [PLAN] }, () => createUser("t-paid@example.test", PW, "tpaid", { request: "paid" }));
    assert.equal(paid.admission, "paid");
    assert.equal(await accountAdmission("tpaid"), "paid");
    for (const u of [boot, free, paid]) {
      const res = await verifyRoute.GET(new NextRequest(verifyLink("http://x", u)));
      assert.equal(res.status, 307);
    }
    assert.deepEqual(granted.sort(), ["tboot", "tfree"], "a paid sign-up is never handed trial credit");
    // The community edition grants nothing, as before.
    hosted(false);
    const other = await createUser("t-comm@example.test", PW, "tcomm", { request: "free" });
    await verifyRoute.GET(new NextRequest(verifyLink("http://x", other)));
    assert.deepEqual(granted.sort(), ["tboot", "tfree"]);
  } finally {
    b.grantTrial = before;
    hosted(true);
    delete process.env.FOLDRUN_OPEN_SIGNUP;
  }
});

test("a paid account handed to an invitee, its founder removed, still earns no trial", async () => {
  hosted(true);
  fresh();
  const { transferOwnership, removeMember } = await import("../server/users.ts");
  const b = billing() as { grantTrial: (tenant: string) => Promise<boolean> };
  const before = b.grantTrial;
  const granted: string[] = [];
  b.grantTrial = async (tenant) => {
    granted.push(tenant);
    return true;
  };
  try {
    await createUser("boot2@example.test", PW, "boot2", { request: "free" });
    const founder = await withOffer({ paidConfigured: true, paidBlocked: null, plans: [PLAN] }, () => createUser("payer2@example.test", PW, "payco", { request: "paid" }));
    const joiner = await createUser("joiner2@example.test", PW, "payco", { joining: true, role: "admin" });
    assert.equal(joiner.admission, "invite");
    await transferOwnership("payco", joiner.id, founder.id);
    await removeMember("payco", founder.id, joiner.id);
    assert.equal(await accountAdmission("payco"), "invite", "the founder is gone: how the account began is unknown, not the joiner's door");
    await verifyRoute.GET(new NextRequest(verifyLink("http://x", (await findUser("joiner2@example.test"))!)));
    assert.deepEqual(granted, []);
  } finally {
    b.grantTrial = before;
  }
});

// ------------------------------------------------------------ the page

test("the sign-up page: invite, dead invite, setup, form, closed", () => {
  const shut = { bootstrap: false, free: false, paid: false };
  const base = { inviteGiven: false, inviteValid: false, setupRequired: false, setupGiven: false, modes: shut };
  assert.equal(signupPageState(base), "closed");
  assert.equal(signupPageState({ ...base, modes: { ...shut, paid: true } }), "closed", "paid's plan form is Part B: until it exists the page is closed");
  assert.equal(signupPageState({ ...base, modes: { ...shut, free: true } }), "form");
  assert.equal(signupPageState({ ...base, modes: { ...shut, bootstrap: true } }), "form");
  assert.equal(signupPageState({ ...base, modes: { ...shut, bootstrap: true }, setupRequired: true }), "setup");
  assert.equal(signupPageState({ ...base, modes: { ...shut, bootstrap: true }, setupRequired: true, setupGiven: true }), "form");
  // A valid invite works whatever the switches say; a dead one says so.
  assert.equal(signupPageState({ ...base, inviteGiven: true, inviteValid: true }), "invite");
  assert.equal(signupPageState({ ...base, inviteGiven: true, modes: { ...shut, free: true } }), "invite-invalid");
});

test("publicSignup and the page read the same switches", async () => {
  hosted(true);
  process.env.FOLDRUN_OPEN_SIGNUP = "1";
  assert.equal(publicSignup().free, signupModesNow(true).free);
  process.env.FOLDRUN_OPEN_SIGNUP = "0";
  assert.equal(publicSignup().free, signupModesNow(true).free);
  delete process.env.FOLDRUN_OPEN_SIGNUP;
});
