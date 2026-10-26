// The HTTP surface, against a real server.
//
// Every claim here was first checked by hand against a running instance, once,
// and a check made once is a check that stops being true. These are the same
// assertions, kept:
//
//   no key                      → 401
//   a revoked or wrong key      → 401
//   a flow naming a missing agent → 422, with the issue and its line
//   a good deploy               → lands on disk
//   a refused deploy            → the CLI exits 1, so CI fails
//   ?wait=true on a failing run → 500 with the failure
//   ?wait=true on a working one → 200 with the result and the cost
//
// It needs a built dashboard and a port, so it is opt-in and excluded from
// `npm test` (which skips anything named *e2e*):
//
//   npm run api            # everything except the model call
//   FOLDRUN_E2E=1 npm run api   # and the model call too
//
// The last one spends money. Everything above it does not.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { billingPresent } from "./billing-files.ts";
import crypto from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "../foldrun-cli/bin/foldrun.mjs");

const enabled = process.env.FOLDRUN_API_E2E === "1";
const opts = { skip: enabled ? false : "set FOLDRUN_API_E2E=1 to run (starts a server)" };
// The founder's password as it stands: the hosted cases reset it, and the
// cases after them must sign in with whatever it is now on either edition.
let founderPassword = "correct horse battery";
// Billing, Stripe and the operator console are foldrun-admin's: absent from a
// public checkout, so their cases run only where it is laid over this one.
const hosted = { skip: opts.skip || (billingPresent ? false : "needs foldrun's billing (foldrun-admin)") };
// The one that costs money.
const paid = {
  skip: !enabled
    ? "set FOLDRUN_API_E2E=1 to run"
    : process.env.FOLDRUN_E2E === "1"
      ? false
      : "set FOLDRUN_E2E=1 as well to make a real model call",
};

let server: ChildProcess | null = null;
let base = "";
let token = "";
let data = "";
let source = "";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

/**
 * An API key, written the way the server stores them.
 *
 * Duplicating the record shape rather than importing it: `web/server/auth.ts`
 * resolves through Next's `@/` aliases, which plain node does not honour. The
 * duplication is safe because it cannot rot silently — the first two tests
 * assert that an unauthenticated request is refused and this key is accepted,
 * so a change to how keys are stored fails here loudly.
 */
function writeKey(dataDir: string, tenant = "default"): string {
  const key = `mda_${crypto.randomBytes(24).toString("hex")}`;
  const record = {
    id: crypto.randomBytes(6).toString("hex"),
    hash: crypto.createHash("sha256").update(key).digest("hex"),
    prefix: key.slice(0, 12),
    label: "api-e2e",
    tenant,
    createdAt: new Date().toISOString(),
    revokedAt: null,
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "keys.json"), JSON.stringify([record], null, 2), {
    mode: 0o600,
  });
  return key;
}

const api = (p: string, init: RequestInit = {}) =>
  fetch(`${base}${p}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });

const foldrun = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env: { ...process.env, FOLDRUN_TOKEN: token, FOLDRUN_URL: base },
  });

before(async () => {
  if (!enabled) return;

  if (!fs.existsSync(path.join(ROOT, ".next"))) {
    throw new Error("the dashboard is not built — run `cd web && npx next build` first");
  }

  data = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-api-"));
  source = path.join(data, "source");
  token = writeKey(path.join(data, "store"));

  // `--flat`: one workspace folder, which is what these tests deploy and what
  // every install made before the account layout existed. The account shape
  // (library/ beside workspaces/) has its own tests in the CLI.
  const init = spawnSync(process.execPath, [CLI, "init", source, "--flat", "--from", "../foldrun-core/templates/hello"], {
    encoding: "utf8",
    cwd: ROOT,
  });
  assert.equal(init.status, 0, `init failed:\n${init.stderr}`);

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd: ROOT,
    env: {
      ...process.env,
      FOLDRUN_DATA: path.join(data, "store"),
      // The scheduler would fire this workspace's flows underneath the tests.
      FOLDRUN_DISABLE_SCHEDULER: "1",
      // Explicitly NOT set: the point is to test the server refusing.
      FOLDRUN_DEV_NO_AUTH: "",
      // A webhook secret we hold, so the Stripe test below can sign a
      // payment event the way Stripe would and watch it credit the ledger.
      STRIPE_WEBHOOK_SECRET: "whsec_e2e_testing",
      // A Stripe key makes this a HOSTED edition without enforcing billing
      // (that is FOLDRUN_BILLING=1, which would refuse every run below on an
      // empty balance). Hosted is what the billing routes and the super admin
      // console exist on; nothing here calls Stripe with this key.
      STRIPE_SECRET_KEY: "sk_test_e2e_not_a_real_key",
      // The founder signed up below owns acme-e2e, and acme-e2e is the
      // platform's own account here — which makes them the super admin.
      // Nothing else grants it, which the last admin test checks.
      FOLDRUN_PLATFORM_ACCOUNT: "acme-e2e",
      // The breach check calls out to Have I Been Pwned; not from a test.
      FOLDRUN_SKIP_BREACH_CHECK: "1",
      // A known install key, so a test can mint the verification link the
      // mail would have carried and follow it.
      FOLDRUN_SECRET_KEY: "e2e-install-key",
    },
    stdio: "ignore",
  });

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await fetch(`${base}/api/workspaces`);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error("the server never came up");
      await new Promise((r) => setTimeout(r, 250));
    }
  }
});

after(async () => {
  // Wait for the server to be gone before removing its data. Killing it and
  // deleting at once raced: the store flushes on SIGTERM, and rmSync met a
  // file that appeared mid-walk (ENOTEMPTY on store/, box CI 2026-09-15).
  if (server && server.exitCode === null) {
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(() => { server?.kill("SIGKILL"); resolve(); }, 10_000);
      server!.once("exit", done);
      server!.kill("SIGTERM");
    });
  }
  for (let i = 0; data && i < 3; i++) {
    try { fs.rmSync(data, { recursive: true, force: true }); break; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOTEMPTY" || i === 2) throw e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
});

// ── the key is the door ──────────────────────────────────────────────────────

// Fail closed. This was once the other way round — no key meant "trust the
// tenant header" — so an instance that reached the internet before someone
// remembered a flag served every workspace to anyone who asked.
test("no key is refused", opts, async () => {
  const res = await fetch(`${base}/api/workspaces`);
  assert.equal(res.status, 401);
});

test("a wrong key is refused, and says why", opts, async () => {
  const res = await fetch(`${base}/api/workspaces`, {
    headers: { authorization: "Bearer mda_definitely-not-a-key" },
  });
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /invalid API key/);
});

test("a real key is accepted", opts, async () => {
  const res = await api("/api/workspaces");
  assert.equal(res.status, 200, "the key this test wrote was not understood by the server");
});

// ── deploying ────────────────────────────────────────────────────────────────

// The gate that makes this worth being an endpoint rather than a file copy:
// everything is declarative, so the whole workspace is checked before any of
// it is live.
test("a flow naming an agent the deploy does not ship is refused", opts, async () => {
  const res = await api("/api/workspaces/hello/deploy", {
    method: "POST",
    body: JSON.stringify({
      files: [
        { path: "AGENTS.md", content: "---\nname: hello\n---\n\nA desk.\n" },
        { path: "agents/writer/agent.md", content: "---\nname: writer\n---\n\nWrite.\n" },
        { path: "flows/publish.md", content: "---\nname: publish\n---\n\n1. [[ghost]] — vanish\n" },
      ],
    }),
  });

  assert.equal(res.status, 422, "a refusal is not a malformed request");
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, "did not check out");
  const issue = body.issues.find((i: { message: string }) => /ghost/.test(i.message));
  assert.ok(issue, `no issue named the missing agent: ${JSON.stringify(body.issues)}`);
  assert.match(issue.where, /^flows\/publish\.md:\d+$/, "an issue should carry its line");
});

test("a good deploy lands, and the workspace is really there", opts, async () => {
  const out = foldrun("deploy", source, "--to", "hello");
  assert.equal(out.status, 0, `deploy failed:\n${out.stdout}\n${out.stderr}`);

  const ws = path.join(data, "store/default/workspaces/hello");
  assert.ok(fs.existsSync(path.join(ws, "agents/notetaker/agent.md")), "nothing reached the disk");

  // Deployed over HTTP, so it has to be discoverable over HTTP — this route
  // was POST-only until this test asked for it.
  const res = await api("/api/workspaces/hello/agents");
  assert.equal(res.status, 200, "an agent deployed over the API cannot be listed over it");
  const { agents } = await res.json();
  assert.ok(
    agents.some((a: { name: string }) => a.name === "notetaker"),
    `the server does not list what was just deployed: ${JSON.stringify(agents)}`,
  );

  const flows = await api("/api/workspaces/hello/flows");
  assert.equal(flows.status, 200);
  assert.ok((await flows.json()).flows.some((f: { name: string }) => f.name === "note"));
});

// The CLI is the CI form, and CI only notices an exit code.
test("a refused deploy exits non-zero", opts, () => {
  const broken = path.join(data, "broken");
  fs.cpSync(source, broken, { recursive: true });
  fs.writeFileSync(
    path.join(broken, "flows/note.md"),
    "---\nname: note\ntrigger: manual\n---\n\n1. [[ghost]] — vanish\n",
  );

  const out = foldrun("deploy", broken, "--to", "hello");
  assert.equal(out.status, 1, "a broken workspace must fail the build");
  assert.match(out.stdout, /ghost/, "and say what was wrong");

  // and the good one is still live
  const ws = path.join(data, "store/default/workspaces/hello");
  assert.ok(fs.existsSync(path.join(ws, "agents/notetaker/agent.md")));
});

test("a dry run reports without changing anything", opts, async () => {
  const before = fs.readFileSync(
    path.join(data, "store/default/workspaces/hello/AGENTS.md"),
    "utf8",
  );
  const res = await api("/api/workspaces/hello/deploy", {
    method: "POST",
    body: JSON.stringify({
      dryRun: true,
      files: [
        { path: "AGENTS.md", content: "rewritten\n" },
        { path: "agents/writer/agent.md", content: "---\nname: writer\n---\n\nWrite.\n" },
      ],
    }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).applied, false);
  assert.equal(
    fs.readFileSync(path.join(data, "store/default/workspaces/hello/AGENTS.md"), "utf8"),
    before,
    "a dry run wrote to disk",
  );
});

// ── calling an agent ─────────────────────────────────────────────────────────

test("without wait, a run returns a receipt", opts, async () => {
  const res = await api("/api/workspaces/hello/agents/notetaker/run", {
    method: "POST",
    body: JSON.stringify({ task: "nothing, this run is abandoned deliberately" }),
  });
  assert.equal(res.status, 200);
  assert.match((await res.json()).runId, /^run-/);
});

// A failure has to arrive as a failure. Returning 200 with a null result would
// make a broken agent indistinguishable from a quiet one.
test("waiting on a run that fails answers 500, with the failure", opts, async () => {
  // Deploy a flow whose agent is not there — no model call, fails immediately.
  const res = await api("/api/workspaces/broken/deploy", {
    method: "POST",
    body: JSON.stringify({
      files: [
        { path: "AGENTS.md", content: "---\nname: broken\n---\n\nA desk.\n" },
        { path: "agents/writer/agent.md", content: "---\nname: writer\n---\n\nWrite.\n" },
        { path: "flows/go.md", content: "---\nname: go\ntrigger: manual\n---\n\n1. [[writer]] — go\n" },
      ],
    }),
  });
  assert.equal(res.status, 200, JSON.stringify(await res.json()));
  fs.rmSync(path.join(data, "store/default/workspaces/broken/agents/writer"), {
    recursive: true,
    force: true,
  });

  const run = await api("/api/workspaces/broken/flows/go/run?wait=true&timeout=30", {
    method: "POST",
  });
  assert.equal(run.status, 500);
  const body = await run.json();
  assert.equal(body.ok, false);
  assert.equal(body.status, "failed");
  assert.equal(body.steps[0].status, "failed");

  // The same verdict is available on the run itself, so a caller whose
  // first wait timed out (202) can keep asking in short requests rather
  // than hold one open past whatever proxy sits in front of the platform.
  const again = await api(`/api/workspaces/broken/runs/${body.runId}?wait=true&timeout=5`);
  assert.equal(again.status, 500);
  const verdict = await again.json();
  assert.equal(verdict.runId, body.runId);
  assert.equal(verdict.status, "failed");
  assert.equal(verdict.timedOut, undefined, "a finished run is never 'still going'");
  const missing = await api("/api/workspaces/broken/runs/run-nope?wait=true&timeout=5");
  assert.equal(missing.status, 404);
});

test("a bad workspace name is refused rather than reaching the filesystem", opts, async () => {
  const res = await api("/api/workspaces/..%2F..%2Fetc/deploy", {
    method: "POST",
    body: JSON.stringify({ files: [{ path: "AGENTS.md", content: "x" }] }),
  });
  assert.ok(res.status >= 400, `expected a refusal, got ${res.status}`);
});

// ---------------------------------------------------------------- accounts

// One browser-shaped session, threaded through the auth tests in order:
// signup mints it, everything after uses it.
let cookie = "";

test("the first signup is free, and signs you in", opts, async () => {
  const res = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "founder@example.test", password: "correct horse battery", account: "acme-e2e" }),
  });
  assert.equal(res.status, 200, await res.text());
  const set = res.headers.getSetCookie().find((c) => c.startsWith("foldrun_session="));
  assert.ok(set, "signup must set the session cookie");
  cookie = set!.split(";")[0];
});

test("the second signup needs the install to opt in", opts, async () => {
  const res = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "second@example.test", password: "hunter2hunter2", account: "second-e2e" }),
  });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /closed/);
});

test("a wrong password is one generic refusal", opts, async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "founder@example.test", password: "not-the-password" }),
  });
  assert.equal(res.status, 401);
});

test("the approvals banner lists gates, not runs, and a decided gate leaves at once", opts, async () => {
  // Two `!` steps in one group, both waiting. Written straight into the
  // store, the way the runner parks a run: the run says awaiting-approval
  // and so do both steps.
  const runsDir = path.join(data, "store/default/workspaces/hello/runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const now = new Date().toISOString();
  const step = (agent: string, ask: string) => ({
    agent, instruction: `${agent} does its thing`, group: 1, optional: false, approve: true, ask,
    status: "awaiting-approval", events: [{ t: now, type: "info", text: `waiting for an answer: ${ask}` }], result: null, costUsd: 0.01,
  });
  const run = {
    id: "run-gates-e2e", flow: "publish", status: "awaiting-approval", startedAt: now, finishedAt: null,
    steps: [step("writer", "Ship the Sydney batch?"), step("mailer", "Send the newsletter?")],
  };
  fs.writeFileSync(path.join(runsDir, `${run.id}.json`), JSON.stringify(run, null, 2));

  const listed = (await (await api("/api/approvals")).json()) as { approvals: { runId: string; step: number; agent: string; question: string; asked: boolean }[] };
  const ours = listed.approvals.filter((a) => a.runId === run.id);
  assert.equal(ours.length, 2, "one entry per waiting step");
  assert.deepEqual(ours.map((a) => [a.step, a.agent, a.question, a.asked]), [
    [0, "writer", "Ship the Sydney batch?", true],
    [1, "mailer", "Send the newsletter?", true],
  ]);

  // Decide one gate. The run is still parked (nothing is resuming it in
  // this test — exactly the window the banner used to get wrong).
  const decided = await api(`/api/workspaces/hello/runs/${run.id}/approve`, {
    method: "POST",
    body: JSON.stringify({ decision: "approve", step: 0 }),
  });
  assert.equal(decided.status, 200, await decided.text());
  const record = JSON.parse(fs.readFileSync(path.join(runsDir, `${run.id}.json`), "utf8"));
  assert.equal(record.status, "awaiting-approval", "the run is still parked until a worker resumes it");

  const after = (await (await api("/api/approvals")).json()) as { approvals: { runId: string; step: number }[] };
  assert.deepEqual(
    after.approvals.filter((a) => a.runId === run.id).map((a) => a.step),
    [1],
    "the decided gate is gone; the other still waits",
  );

  // Deciding it again is a 409, which the banner treats as "already gone".
  const again = await api(`/api/workspaces/hello/runs/${run.id}/approve`, {
    method: "POST",
    body: JSON.stringify({ decision: "approve", step: 0 }),
  });
  assert.equal(again.status, 409);
  fs.rmSync(path.join(runsDir, `${run.id}.json`));
});

test("the session cookie authenticates the API — same funnel as a key", opts, async () => {
  const res = await fetch(`${base}/api/workspaces`, { headers: { cookie } });
  assert.equal(res.status, 200);
});

// ---------------------------------------------------------------- foldrun login
//
// The browser flow, driven from both ends: the CLI's side through its own
// commands with a private FOLDRUN_HOME, the person's side through the
// session cookie signup minted above.

let cliHome = "";
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const cli = (...args: string[]) => {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    // No token and no URL in the environment: the point is that the
    // credentials file supplies both once `login` has written it.
    env: { ...process.env, FOLDRUN_TOKEN: "", FOLDRUN_URL: "", FOLDRUN_HOME: cliHome },
  });
  return { ...r, stdout: plain(r.stdout), stderr: plain(r.stderr) };
};

test("foldrun login: the code the terminal shows is the code the browser approves", opts, async () => {
  cliHome = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-home-"));

  // Start the CLI and let it wait; read its code off stdout.
  const child = spawn(process.execPath, [CLI, "login", "--url", base, "--no-browser"], {
    cwd: ROOT,
    env: { ...process.env, FOLDRUN_TOKEN: "", FOLDRUN_URL: "", FOLDRUN_HOME: cliHome },
  });
  let out = "";
  child.stdout.on("data", (d) => (out += String(d)));
  child.stderr.on("data", (d) => (out += String(d)));
  const code = await new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no code printed:\n${out}`)), 15_000);
    child.stdout.on("data", () => {
      const m = out.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);
      if (m) {
        clearTimeout(t);
        resolve(m[1]);
      }
    });
  });

  // What the browser sees before deciding — no session needed to look.
  const shown = await fetch(`${base}/api/cli/authorize?code=${code}`);
  assert.equal(shown.status, 200);
  assert.equal(((await shown.json()) as { status: string }).status, "pending");

  // Deciding needs a person.
  const anon = await fetch(`${base}/api/cli/authorize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  assert.equal(anon.status, 401);

  // The person says yes — typed carelessly, which is how codes get typed.
  const ok = await fetch(`${base}/api/cli/authorize`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ code: code.toLowerCase().replace("-", " ") }),
  });
  assert.equal(ok.status, 200, await ok.text());

  const exit = await new Promise<number | null>((r) => child.on("exit", r));
  assert.equal(exit, 0, out);
  assert.match(out, /signed in to .* as founder@example\.test/);

  const creds = JSON.parse(fs.readFileSync(path.join(cliHome, "credentials.json"), "utf8")) as {
    default: string;
    platforms: Record<string, { token: string; email: string; account: string; role: string }>;
  };
  assert.equal(creds.default, base);
  assert.match(creds.platforms[base].token, /^mda_/);
  assert.equal(creds.platforms[base].email, "founder@example.test");
  // The account's owner signs in as an admin: a key is never an owner.
  assert.equal(creds.platforms[base].role, "admin");
  assert.equal(fs.statSync(path.join(cliHome, "credentials.json")).mode & 0o777, 0o600);

  // The same code cannot be approved twice, and the CLI cannot collect twice.
  const again = await fetch(`${base}/api/cli/authorize`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ code }),
  });
  assert.equal(again.status, 404);
});

test("foldrun whoami and keys work from the credentials file alone", opts, async () => {
  const who = cli("whoami");
  assert.equal(who.status, 0, who.stderr);
  assert.match(who.stdout, /cli · /);
  assert.match(who.stdout, /account\s+acme-e2e/);
  assert.match(who.stdout, /role\s+admin/);
  assert.match(who.stdout, /credentials\.json/);

  const made = cli("keys", "create", "ci", "--role", "viewer");
  assert.equal(made.status, 0, made.stderr + made.stdout);
  const key = made.stdout.match(/\b(mda_[0-9a-f]{48})\b/)?.[1];
  assert.ok(key, made.stdout);

  const list = cli("keys", "ls");
  assert.match(list.stdout, /ci\b.*viewer · all workspaces/);
  // The key made by the CLI's key is attributed to the person behind it.
  assert.match(list.stdout, /ci\b.*by founder@example\.test/);

  // Deploy keys went with the platform's own git: asking for one is refused.
  const deployAsk = await fetch(`${base}/api/keys`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ label: "old", workspace: "hello", access: "write" }) });
  assert.equal(deployAsk.status, 400);

  const id = list.stdout.split("\n").find((l) => /\bci\b.*viewer · all workspaces/.test(l))?.match(/\b([0-9a-f]{12})\b/)?.[1];
  assert.ok(id, list.stdout);
  // A revoke asks first; with no terminal it needs --yes (every CLI delete does).
  const gone = cli("keys", "revoke", id!, "--yes");
  assert.equal(gone.status, 0, gone.stderr);
  assert.match(cli("keys", "ls").stdout, /revoked.*\bci\b/);
});

test("foldrun logout forgets the key and revokes it", opts, async () => {
  const before = (await (await fetch(`${base}/api/keys`, { headers: { cookie } })).json()) as { keys: { label: string; revokedAt: string | null }[] };
  assert.ok(before.keys.some((k) => k.label.startsWith("cli · ") && !k.revokedAt), "the CLI's key is live before logout");

  const out = cli("logout");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /signed out/);

  const after = (await (await fetch(`${base}/api/keys`, { headers: { cookie } })).json()) as typeof before;
  assert.ok(after.keys.every((k) => !k.label.startsWith("cli · ") || k.revokedAt), "the CLI's key is revoked after logout");
  assert.equal(cli("whoami").status, 1);
});

test("foldrun login --token stores a dashboard-made key after checking it", opts, async () => {
  const bad = cli("login", "--url", base, "--token", "mda_not_a_key");
  assert.equal(bad.status, 1);
  const good = cli("login", "--url", base, "--token", token);
  assert.equal(good.status, 0, good.stderr);
  assert.match(cli("whoami").stdout, /API key/);
  // Logging out forgets a --token key but does not revoke it: it was not
  // made by login, and the rest of this file still uses it.
  const out = cli("logout");
  assert.match(out.stdout, /not revoked/);
  assert.equal((await api("/api/workspaces")).status, 200);
});

test("the dashboard bounces strangers to login", opts, async () => {
  const res = await fetch(`${base}/dashboard`, { redirect: "manual" });
  assert.ok([302, 307, 308].includes(res.status), `expected a redirect, got ${res.status}`);
  assert.match(res.headers.get("location") ?? "", /\/login/);
});

test("the dashboard admits a session, whatever tenant the URL claims", opts, async () => {
  // ?tenant=default would be someone else's account — the proxy overwrites
  // it with the session's own before any page reads it.
  const res = await fetch(`${base}/dashboard?tenant=default`, { headers: { cookie } });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /acme-e2e/);
});

test("billing reads empty, and a top-up moves the balance", hosted, async () => {
  const empty = (await (await fetch(`${base}/api/billing`, { headers: { cookie } })).json()) as {
    enabled: boolean;
    balanceUsd: number;
  };
  assert.equal(empty.enabled, false);
  // No trial at signup: it lands when the owner verifies their address,
  // proven where verification is.
  assert.equal(empty.balanceUsd, 0);

  const topped = (await (
    await fetch(`${base}/api/billing`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ usd: 5, note: "e2e" }),
    })
  ).json()) as { balanceUsd: number };
  assert.equal(topped.balanceUsd, 5);
});

test("a team grows by invite link and refuses to lose its last member", opts, async () => {
  const one = (await (await fetch(`${base}/api/team`, { headers: { cookie } })).json()) as {
    members: { id: string; email: string }[];
  };
  assert.equal(one.members.length, 1);

  const invite = (await (
    await fetch(`${base}/api/team`, { method: "POST", headers: { cookie } })
  ).json()) as { path: string };
  assert.match(invite.path, /^\/signup\?invite=/);

  // The invited signup joins the existing account — no open-signup flag, no
  // account field, whatever the body claims.
  const token = decodeURIComponent(invite.path.split("invite=")[1]);
  const joined = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "teammate@example.test",
      password: "hunter2hunter2",
      account: "ignored-entirely",
      invite: token,
    }),
  });
  const joinedBody = await joined.text();
  assert.equal(joined.status, 200, joinedBody);
  assert.equal((JSON.parse(joinedBody) as { tenant: string }).tenant, "acme-e2e");

  const two = (await (await fetch(`${base}/api/team`, { headers: { cookie } })).json()) as {
    members: { id: string; email: string }[];
  };
  assert.equal(two.members.length, 2);

  // Remove the teammate; then the last member must be irremovable.
  const teammate = two.members.find((m) => m.email === "teammate@example.test")!;
  const removed = await fetch(`${base}/api/team/members/${teammate.id}`, {
    method: "DELETE",
    headers: { cookie },
  });
  assert.equal(removed.status, 200);
  const self = one.members[0];
  const refused = await fetch(`${base}/api/team/members/${self.id}`, {
    method: "DELETE",
    headers: { cookie },
  });
  assert.equal(refused.status, 400);
});

test("rotating a webhook changes its URL, twice changes it twice", opts, async () => {
  const first = (await (
    await api("/api/workspaces/hello/hooks/note/rotate", { method: "POST" })
  ).json()) as { path: string };
  const second = (await (
    await api("/api/workspaces/hello/hooks/note/rotate", { method: "POST" })
  ).json()) as { path: string };
  assert.match(first.path, /token=/);
  assert.notEqual(first.path, second.path);
});

test("a signed Stripe payment credits the ledger exactly once", hosted, async () => {
  const balance = async () =>
    ((await (await fetch(`${base}/api/billing`, { headers: { cookie } })).json()) as {
      balanceUsd: number;
    }).balanceUsd;

  const event = JSON.stringify({
    id: "evt_e2e_1",
    type: "checkout.session.completed",
    data: {
      object: {
        metadata: { tenant: "acme-e2e" },
        amount_total: 700,
        payment_status: "paid",
      },
    },
  });
  const t = Math.floor(Date.now() / 1000);
  const mac = crypto.createHmac("sha256", "whsec_e2e_testing").update(`${t}.${event}`).digest("hex");
  const deliver = () =>
    fetch(`${base}/api/billing/stripe`, {
      method: "POST",
      headers: { "stripe-signature": `t=${t},v1=${mac}` },
      body: event,
    });

  const before = await balance();
  assert.equal((await deliver()).status, 200);
  assert.equal(await balance(), before + 7, "the payment landed");
  assert.equal((await deliver()).status, 200, "a Stripe retry is acknowledged");
  assert.equal(await balance(), before + 7, "and credits nothing twice");

  // An unsigned copy of the same event is money nobody paid.
  const forged = await fetch(`${base}/api/billing/stripe`, { method: "POST", body: event });
  assert.equal(forged.status, 401);
  assert.equal(await balance(), before + 7);
});

// ---------------------------------------------------------------- triggers

// -------------------------------------------------------------- super admin
//
// The console stands outside every account. `default` (the API key's
// tenant, where workspace hello lives) is the customer; the founder on
// The founder is the super admin, because they own the platform account and for no
// other reason.

test("to a stranger and to an API key, the super admin console does not exist", hosted, async () => {
  assert.equal((await fetch(`${base}/admin`)).status, 404);
  assert.equal((await fetch(`${base}/admin/default`)).status, 404);
  // An API key names an account, never a person — it is never the super admin.
  const res = await api("/api/admin/accounts/default", { method: "POST", body: JSON.stringify({ action: "notes", notes: "x" }) });
  assert.equal(res.status, 404);
});

test("the super admin sees the customers, and one customer", hosted, async () => {
  const list = await fetch(`${base}/admin`, { headers: { cookie } });
  assert.equal(list.status, 200);
  const html = await list.text();
  assert.ok(html.includes("/admin/default"), "the customer list links the default account");
  const one = await fetch(`${base}/admin/default`, { headers: { cookie } });
  assert.equal(one.status, 200);
  assert.ok((await one.text()).includes("Levers"));
});

test("a credit needs a reason and lands on the ledger", hosted, async () => {
  const before = (await (await api("/api/billing")).json()) as { balanceUsd: number };
  const bad = await fetch(`${base}/api/admin/accounts/default`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "adjust", usd: 10, note: "  " }),
  });
  assert.equal(bad.status, 400, await bad.text());
  const ok = await fetch(`${base}/api/admin/accounts/default`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "adjust", usd: 10, note: "e2e goodwill" }),
  });
  assert.equal(ok.status, 200, await ok.text());
  const after = (await (await api("/api/billing")).json()) as { balanceUsd: number };
  assert.equal(Math.round((after.balanceUsd - before.balanceUsd) * 100), 1000);
});

test("a suspended customer starts no runs and is told why; restored, it can", hosted, async () => {
  const suspend = await fetch(`${base}/api/admin/accounts/default`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "suspend", reason: "e2e: chargeback" }),
  });
  assert.equal(suspend.status, 200, await suspend.text());
  // Refused before anything is enqueued, so this costs nothing.
  const refused = await api("/api/workspaces/hello/agents/notetaker/run", { method: "POST", body: JSON.stringify({ task: "hi" }) });
  const refusedText = await refused.text();
  assert.equal(refused.status, 423, refusedText);
  assert.match(refusedText, /suspended: e2e: chargeback/);
  // Twice is a conflict, not a second suspension.
  const again = await fetch(`${base}/api/admin/accounts/default`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "suspend", reason: "again" }),
  });
  assert.equal(again.status, 409);
  const restore = await fetch(`${base}/api/admin/accounts/default`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "restore" }),
  });
  assert.equal(restore.status, 200);
  // The gate is open again: whatever happens next is not a 423.
  const allowed = await api("/api/workspaces/hello/agents/notetaker/run", { method: "POST", body: JSON.stringify({ task: "hi" }) });
  const allowedText = await allowed.text();
  assert.notEqual(allowed.status, 423, allowedText);
});

test("the plan overrides the account, and every action is on the audit", hosted, async () => {
  const plan = await fetch(`${base}/api/admin/accounts/default`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "plan", name: "e2e-team", priority: "high", concurrency: 3, workspaces: 9 }),
  });
  assert.equal(plan.status, 200, await plan.text());
  const audit = await fetch(`${base}/admin/audit`, { headers: { cookie } });
  assert.equal(audit.status, 200);
  const html = await audit.text();
  for (const action of ["credit", "suspend", "restore", "plan"]) assert.ok(html.includes(`>${action}<`), `audit shows ${action}`);
});

test("a plan granted by hand: the bundle lands, the levers are the tier's, once a day; ended, the bundle goes and their money stays", hosted, async () => {
  const before = (await (await api("/api/billing")).json()) as { balanceUsd: number };
  const grant = await fetch(`${base}/api/admin/accounts/default`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "grant-plan", plan: "creator" }),
  });
  assert.equal(grant.status, 200, await grant.text());
  const after = (await (await api("/api/billing")).json()) as { balanceUsd: number };
  assert.equal(Math.round((after.balanceUsd - before.balanceUsd) * 100), 8800, "8,800 credits is $88");
  const plans = (await (await api("/api/billing/plans")).json()) as { current: { plan: string; cycleCredits: number; cycleRemainingCredits: number } | null; plans: { id: string }[] };
  assert.equal(plans.plans.length, 4);
  assert.equal(plans.current?.plan, "creator");
  assert.equal(plans.current?.cycleCredits, 8800);
  const state = (await (await fetch(`${base}/api/admin/accounts/default`, { headers: { cookie } })).json()) as { state: { plan?: { name?: string; concurrency?: number; priority?: string; workspaces?: number; vcpu?: number; memGiB?: number; stepVcpu?: number; stepMemGiB?: number } } };
  assert.deepEqual(state.state.plan, { name: "creator", priority: "normal", concurrency: 2, workspaces: 10, vcpu: 8, memGiB: 16, stepVcpu: 4, stepMemGiB: 8 });
  // The same day again writes nothing.
  const twice = await fetch(`${base}/api/admin/accounts/default`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "grant-plan", plan: "creator" }),
  });
  assert.equal(((await twice.json()) as { granted: boolean }).granted, false);
  assert.equal(Math.round(((await (await api("/api/billing")).json() as { balanceUsd: number }).balanceUsd - after.balanceUsd) * 100), 0);
  // Ended: the unused bundle expires; what they had before is theirs.
  const end = await fetch(`${base}/api/admin/accounts/default`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "end-plan" }),
  });
  assert.equal(end.status, 200, await end.text());
  const ended = (await (await api("/api/billing")).json()) as { balanceUsd: number };
  assert.equal(Math.round((ended.balanceUsd - before.balanceUsd) * 100), 0);
  assert.equal(((await (await api("/api/billing/plans")).json()) as { current: unknown }).current, null);
});

test("an overdraft is set with a floor, shown to the customer, and taken away", hosted, async () => {
  // The gate itself (402 below zero, the floor, the refusal wording) is
  // proven in the platform's own suite under FOLDRUN_BILLING=1; this server
  // does not enforce billing, so what is proven here is the door and the
  // window: the super admin's action, and what the customer can see.
  const allow = await fetch(`${base}/api/admin/accounts/default`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "overdraft", limitUsd: 50, note: "e2e: invoice terms" }),
  });
  assert.equal(allow.status, 200, await allow.text());
  let plans = (await (await api("/api/billing/plans")).json()) as { overdraft: { limitUsd: number | null } | null };
  assert.deepEqual(plans.overdraft, { limitUsd: 50 }, "the customer can see the terms");

  const bad = await fetch(`${base}/api/admin/accounts/default`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "overdraft", limitUsd: -5 }),
  });
  assert.equal(bad.status, 400);

  const noFloor = await fetch(`${base}/api/admin/accounts/default`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "overdraft", limitUsd: null }),
  });
  assert.equal(noFloor.status, 200);
  plans = (await (await api("/api/billing/plans")).json()) as { overdraft: { limitUsd: number | null } | null };
  assert.deepEqual(plans.overdraft, { limitUsd: null });

  const off = await fetch(`${base}/api/admin/accounts/default`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "overdraft", off: true }),
  });
  assert.equal(off.status, 200, await off.text());
  plans = (await (await api("/api/billing/plans")).json()) as { overdraft: { limitUsd: number | null } | null };
  assert.equal(plans.overdraft, null);
  const offAgain = await fetch(`${base}/api/admin/accounts/default`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "overdraft", off: true }),
  });
  assert.equal(offAgain.status, 409);
});

test("the trial lands when the owner verifies their address — once, and not at signup", hosted, async () => {
  // Mint the link the mail would have carried, with the server's own key.
  process.env.FOLDRUN_SECRET_KEY = "e2e-install-key";
  const { mintToken, VERIFY_TTL_MS } = await import("../server/auth-tokens.ts");
  const me = (await (await fetch(`${base}/api/auth/session`, { headers: { cookie } })).json()) as { user: { id: string; email: string } };
  const before = (await (await fetch(`${base}/api/billing`, { headers: { cookie } })).json()) as { balanceUsd: number };
  const token = mintToken("verify", { u: me.user.id, e: me.user.email }, VERIFY_TTL_MS);
  const first = await fetch(`${base}/api/auth/verify?token=${encodeURIComponent(token)}`, { redirect: "manual" });
  assert.equal(first.status, 307, await first.text());
  assert.match(first.headers.get("location") ?? "", /verified=1/);
  const after = (await (await fetch(`${base}/api/billing`, { headers: { cookie } })).json()) as { balanceUsd: number };
  assert.equal(Math.round((after.balanceUsd - before.balanceUsd) * 100), 300, "300 credits, three dollars");
  // Following the link again verifies again and grants nothing.
  await fetch(`${base}/api/auth/verify?token=${encodeURIComponent(token)}`, { redirect: "manual" });
  const again = (await (await fetch(`${base}/api/billing`, { headers: { cookie } })).json()) as { balanceUsd: number };
  assert.equal(again.balanceUsd, after.balanceUsd);
});

test("the super admin resets a member's password: old one dead, new one works, sessions ended", hosted, async () => {
  // The founder on acme-e2e is both super admin and the member being reset —
  // which is also the sharpest check: their OWN session must end.
  const me = (await (await fetch(`${base}/api/auth/session`, { headers: { cookie } })).json()) as { id?: string; user?: { id: string } };
  const userId = me.id ?? me.user?.id;
  assert.ok(userId, `session did not say who I am: ${JSON.stringify(me)}`);
  const res = await fetch(`${base}/api/admin/accounts/acme-e2e`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ action: "reset-password", userId }),
  });
  const resText = await res.text();
  assert.equal(res.status, 200, resText);
  const { password } = JSON.parse(resText) as { password: string };
  assert.ok(password.length >= 12);
  founderPassword = password;
  // The old password is dead …
  const old = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "founder@example.test", password: "correct horse battery" }),
  });
  assert.equal(old.status, 401);
  // … the new one signs in …
  const fresh = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "founder@example.test", password }),
  });
  assert.equal(fresh.status, 200, await fresh.text());
  const set = fresh.headers.getSetCookie().find((c) => c.startsWith("foldrun_session="));
  assert.ok(set);
  cookie = set!.split(";")[0]; // the tests after this one keep working
});

// ---------------------------------------------------------------- sign-in security

test("forgot: the same answer for every address, and a limit", opts, async () => {
  const known = await fetch(`${base}/api/auth/forgot`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "founder@example.test" }) });
  const unknown = await fetch(`${base}/api/auth/forgot`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "nobody@example.test" }) });
  assert.equal(known.status, 200); assert.equal(unknown.status, 200);
  assert.equal(await known.text(), await unknown.text(), "the body must not reveal which address has an account");
});

test("a weak password is refused at signup, at change, and at reset", opts, async () => {
  const res = await fetch(`${base}/api/auth/password`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ current: "irrelevant", next: "short" }) });
  assert.equal(res.status, 400, await res.text());
});

let resetUrl = "";
test("the super admin hands over a reset link; it works once and signs the person in", hosted, async () => {
  const me = (await (await fetch(`${base}/api/auth/session`, { headers: { cookie } })).json()) as { user?: { id: string } };
  const link = await fetch(`${base}/api/admin/accounts/acme-e2e`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ action: "reset-link", userId: me.user!.id }) });
  const linkText = await link.text();
  assert.equal(link.status, 200, linkText);
  resetUrl = JSON.parse(linkText).url;
  const token = new URL(resetUrl).searchParams.get("token")!;
  // The page exists for a stranger (it is how they get in) …
  assert.equal((await fetch(`${base}/reset?token=${encodeURIComponent(token)}`)).status, 200);
  // … a weak password is refused …
  const weak = await fetch(`${base}/api/auth/reset`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password: "short" }) });
  assert.equal(weak.status, 400);
  // … a good one works and signs in …
  const ok = await fetch(`${base}/api/auth/reset`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password: "a genuinely new passphrase" }) });
  if (ok.ok) founderPassword = "a genuinely new passphrase";
  assert.equal(ok.status, 200, await ok.text());
  const set = ok.headers.getSetCookie().find((c) => c.startsWith("foldrun_session="));
  assert.ok(set, "a reset signs you in");
  cookie = set!.split(";")[0];
  // … and the same link is dead now: the password it was bound to is gone.
  const again = await fetch(`${base}/api/auth/reset`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password: "another new passphrase" }) });
  assert.equal(again.status, 400, "a reset link works once");
  // The reset proved the inbox.
  const who = (await (await fetch(`${base}/api/auth/session`, { headers: { cookie } })).json()) as { user?: { emailVerifiedAt?: string } };
  assert.ok(who.user?.emailVerifiedAt, "using the link verifies the address");
});

test("two-factor: enrol with a real code, then sign-in needs the code, then a backup code, then disable", opts, async () => {
  const { totp } = await import("../server/totp.ts");
  const setup = (await (await fetch(`${base}/api/auth/mfa/setup`, { method: "POST", headers: { cookie } })).json()) as { secret: string; qr: string; enrol: string };
  assert.match(setup.qr, /^data:image\/png;base64,/);
  // A wrong code stores nothing.
  const bad = await fetch(`${base}/api/auth/mfa/enable`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ enrol: setup.enrol, code: "000000" }) });
  assert.equal(bad.status, 400);
  const good = await fetch(`${base}/api/auth/mfa/enable`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ enrol: setup.enrol, code: totp(setup.secret) }) });
  const goodText = await good.text();
  assert.equal(good.status, 200, goodText);
  const { backup } = JSON.parse(goodText) as { backup: string[] };
  assert.equal(backup.length, 8);

  // Sign in: the password now buys a challenge, not a session.
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "founder@example.test", password: founderPassword }) });
  const loginText = await login.text();
  assert.equal(login.status, 200, loginText);
  const l = JSON.parse(loginText) as { mfa?: boolean; challenge?: string };
  assert.equal(l.mfa, true);
  assert.ok(!login.headers.getSetCookie().some((c) => c.startsWith("foldrun_session=")), "no session before the code");
  // A wrong code is refused; the right one mints the session.
  const wrong = await fetch(`${base}/api/auth/mfa/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challenge: l.challenge, code: "000000" }) });
  assert.equal(wrong.status, 401);
  const right = await fetch(`${base}/api/auth/mfa/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challenge: l.challenge, code: totp(setup.secret) }) });
  assert.equal(right.status, 200, await right.text());
  const set1 = right.headers.getSetCookie().find((c) => c.startsWith("foldrun_session="));
  assert.ok(set1);
  // A backup code works once.
  const login2 = (await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "founder@example.test", password: founderPassword }) })).json()) as { challenge: string };
  const viaBackup = await fetch(`${base}/api/auth/mfa/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challenge: login2.challenge, code: backup[0] }) });
  assert.equal(viaBackup.status, 200, await viaBackup.text());
  const login3 = (await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "founder@example.test", password: founderPassword }) })).json()) as { challenge: string };
  const reused = await fetch(`${base}/api/auth/mfa/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challenge: login3.challenge, code: backup[0] }) });
  assert.equal(reused.status, 401, "a backup code is single-use");
  // Disable needs the password and a code; then sign-in is one step again.
  cookie = set1!.split(";")[0];
  const off = await fetch(`${base}/api/auth/mfa/disable`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ password: founderPassword, code: totp(setup.secret) }) });
  assert.equal(off.status, 200, await off.text());
  const plain = (await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "founder@example.test", password: founderPassword }) })).json()) as { mfa?: boolean };
  assert.ok(!plain.mfa);
});

test("the super admin creates a customer: an owner who sets their own password from a link", hosted, async () => {
  const res = await fetch(`${base}/api/admin/accounts`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ account: "newco-e2e", email: "owner@newco-e2e.test" }) });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const j = JSON.parse(text) as { setPasswordUrl: string; mailed: boolean };
  assert.equal(j.mailed, false, "no mail credential in the e2e; the link is the handover");
  const token = new URL(j.setPasswordUrl).searchParams.get("token")!;
  const set = await fetch(`${base}/api/auth/reset`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password: "newco chooses this" }) });
  assert.equal(set.status, 200, await set.text());
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@newco-e2e.test", password: "newco chooses this" }) });
  const l = JSON.parse(await login.text()) as { tenant?: string };
  assert.equal(login.status, 200); assert.equal(l.tenant, "newco-e2e");
  // Taken names and taken emails are refused, not overwritten.
  const dup = await fetch(`${base}/api/admin/accounts`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ account: "newco-e2e", email: "other@x.test" }) });
  assert.equal(dup.status, 409);
});

test("nothing can make a super admin from inside an account", hosted, async () => {
  // The only way in is owning the platform account. No member carries a
  // role word for it, because there is no such role.
  const res = await fetch(`${base}/api/account/members`, { method: "GET", headers: { cookie } });
  if (res.status === 200) {
    const text = await res.text();
    assert.ok(!text.includes('"operator"') && !text.includes('"superadmin"'));
  }
});

test("the scheduler's manual tick answers", opts, async () => {
  const res = await api("/api/schedule", { method: "POST" });
  assert.equal(res.status, 200);
});

test("a webhook with a wrong token is refused before anything runs", opts, async () => {
  const res = await fetch(`${base}/api/hooks/default/hello/anything?token=${"0".repeat(32)}`, {
    method: "POST",
    body: "{}",
  });
  assert.equal(res.status, 401);
});

// The whole point, and the only test here that spends money.
test("waiting on a working agent answers with the result and the cost", paid, async () => {
  const res = await api("/api/workspaces/hello/agents/notetaker/run?wait=true&timeout=180", {
    method: "POST",
    body: JSON.stringify({
      task: "In one short sentence, what is 2+2? Do not write any files.",
    }),
  });

  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text);
  assert.equal(body.ok, true);
  assert.equal(body.status, "completed");
  assert.ok(body.result && body.result.trim().length > 0, "a completed run returned no answer");
  assert.match(body.result, /four|4/i);
  assert.ok(typeof body.costUsd === "number", "a caller should be told what the call cost");
});
