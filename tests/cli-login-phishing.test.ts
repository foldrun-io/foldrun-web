// Device-code phishing (RFC 8628 §5.4), 30 Oct 2026: someone runs `foldrun
// login`, sends a person the link, and waits for them to approve it. So
//  - the approval page is told where the request came from (the trusted
//    proxy's address, coarsely; a country behind Cloudflare) and whether
//    the browser looking is on that network;
//  - a request older than five minutes cannot be approved (410), though it
//    can still be denied.
// The file store; the database path stores the same two columns (0031).
//
//   node --import ./tests/register.mjs --test tests/cli-login-phishing.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-cli-phish-"));
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_TRUST_PROXY;
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_OPEN_SIGNUP = "1";

const { NextRequest } = await import("next/server");
const { beginCliLogin, decideCliLogin, describeCliLogin, requestOrigin, APPROVE_WINDOW_MS } = await import("../server/cli-login.ts");
const { createUser, mintSession, SESSION_COOKIE } = await import("../server/users.ts");
const loginRoute = await import("../app/api/cli/login/route.ts");
const authorizeRoute = await import("../app/api/cli/authorize/route.ts");

const person = { tenant: "acme", email: "owner@acme.test", role: "owner" as const, workspaces: null };
const file = () => path.join(process.env.FOLDRUN_DATA!, "cli-logins.json");
/** Make a request look `ms` old, as if it had waited that long. */
const age = (code: string, ms: number) => {
  const rows = JSON.parse(fs.readFileSync(file(), "utf8")) as { code: string; createdAt: string }[];
  for (const r of rows) if (r.code === code) r.createdAt = new Date(Date.now() - ms).toISOString();
  fs.writeFileSync(file(), JSON.stringify(rows));
};

test("where a request came from is the trusted proxy's word, coarsely — never a raw header", () => {
  const h = (headers: Record<string, string>) => ({ headers: new Headers(headers) });
  assert.deepEqual(requestOrigin(h({ "x-forwarded-for": "203.0.113.9" })), { network: null, country: null }, "no trusted proxy: not known");
  process.env.FOLDRUN_TRUST_PROXY = "1";
  try {
    assert.deepEqual(requestOrigin(h({ "x-forwarded-for": "203.0.113.9", "cf-ipcountry": "AU" })), { network: "203.0.113.0/24", country: null }, "a country only from Cloudflare");
  } finally {
    delete process.env.FOLDRUN_TRUST_PROXY;
  }
});

test("the approval page is told when and from where the terminal asked, and whether it is this browser's network", async () => {
  process.env.FOLDRUN_TRUST_PROXY = "1";
  try {
    const started = await loginRoute.POST(new NextRequest("http://x/api/cli/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ hostname: "laptop" }),
    }));
    const { code } = (await started.json()) as { code: string };
    const look = (ip: string) => authorizeRoute.GET(new NextRequest(`http://x/api/cli/authorize?code=${code}`, { headers: { "x-forwarded-for": ip } }));
    const same = (await (await look("203.0.113.200")).json()) as { requestedFrom: string; createdAt: string; approveBy: string; sameNetwork: boolean };
    assert.equal(same.requestedFrom, "203.0.113.0/24");
    assert.equal(same.sameNetwork, true);
    assert.equal(Date.parse(same.approveBy) - Date.parse(same.createdAt), APPROVE_WINDOW_MS);
    const other = (await (await look("198.51.100.7")).json()) as { sameNetwork: boolean };
    assert.equal(other.sameNetwork, false, "a different network is said, so the page can warn");
  } finally {
    delete process.env.FOLDRUN_TRUST_PROXY;
  }
  const unknown = await beginCliLogin("box");
  const d = await describeCliLogin(unknown.code);
  assert.equal(d?.requestedFrom, null, "not known without a trusted proxy");
});

test("a request older than the approval window is refused approval, and can still be denied", async () => {
  const fresh = await beginCliLogin("fresh");
  assert.equal(await decideCliLogin(fresh.code, "approve", person), "approved");

  const stale = await beginCliLogin("stale");
  age(stale.code, APPROVE_WINDOW_MS + 1000);
  assert.equal(await decideCliLogin(stale.code, "approve", person), "too-old");
  assert.equal(await decideCliLogin(stale.code, "deny", person), "denied");
});

test("the route answers 410 for a stale approval, with what to do", async () => {
  const user = await createUser("phish@acme-phish.test", "a long enough password 1", "acme-phish");
  const cookie = `${SESSION_COOKIE}=${(await mintSession(user)).value}`;
  const stale = await beginCliLogin("carried");
  age(stale.code, APPROVE_WINDOW_MS + 1000);
  const res = await authorizeRoute.POST(new NextRequest("http://x/api/cli/authorize", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ code: stale.code, decision: "approve" }),
  }));
  assert.equal(res.status, 410);
  assert.match(((await res.json()) as { error: string }).error, /five minutes/);
});
