// The people and things the authorization matrix (authz-matrix.test.ts)
// aims at: account A with every role and every kind of thing it holds, each
// carrying a canary, and a stranger's account B (plus the operator's own
// account) that must never see or change any of it.
//
// Importing this file sets the environment, so it is the test's FIRST import.
// Nothing here runs an agent: no worker, no scheduler, an invalid model key.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-authz-"));
process.env.FOLDRUN_DATA = DATA;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
process.env.FOLDRUN_API_RATE_LIMIT = "off"; // 3000 calls from one process; the limits have their own tests
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_OPEN_SIGNUP = "1"; // so the stranger and the operator can each open an account
process.env.FOLDRUN_SECRET_KEY = "authz-matrix-install-key";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-invalid-authz-matrix";
// FOLDRUN_TEST_DATABASE_URL runs the same matrix with people, keys, sessions and shares in Postgres.
export const DB = !!process.env.FOLDRUN_TEST_DATABASE_URL;
if (DB) {
  const u = new URL(process.env.FOLDRUN_TEST_DATABASE_URL!);
  process.env.FOLDRUN_DATABASE_URL = `${u.protocol}//${u.username}@${u.host}${u.pathname}`;
  process.env.FOLDRUN_DATABASE_PASSWORD = u.password;
}
for (const k of [...(DB ? [] : ["FOLDRUN_DATABASE_URL"]), "FOLDRUN_DEV_NO_AUTH", "FOLDRUN_REDIS_URL", "FOLDRUN_PUBLIC_URL", "FOLDRUN_SETUP_TOKEN", "FOLDRUN_RUN_ISOLATION", "STRIPE_SECRET_KEY", "FOLDRUN_RESEND_API_KEY"]) delete process.env[k];

// FOLDRUN_EDITION=hosted (with the private overlay laid over this tree) runs the hosted edition's routes too.
if (process.env.FOLDRUN_EDITION === "hosted") (await import("../../foldrun-core/src/platform.ts")).registerPlatform({ edition: () => "hosted" });
if (DB) await (await import("../../foldrun-platform/src/db.ts")).migrate();
const { createApiKey } = await import("../server/auth.ts");
const users = await import("../server/users.ts");
const { writeRun } = await import("../../foldrun-core/src/store.ts");
const { setSecret } = await import("../../foldrun-core/src/secrets.ts");
const { eventUrl, webhookToken, approveToken } = await import("../../foldrun-core/src/webhook.ts");
const { append: ledgerAppend } = await import("../../foldrun-platform/src/ledger.ts");
const { createShare } = await import("../../foldrun-platform/src/shares.ts");

export const TAG = crypto.randomBytes(6).toString("hex");
/** Strings that exist only inside account A. Seen by anyone outside it, or in any response at all for the ones that are secrets, they are a leak. */
export const A = {
  tenant: `alphaco-${TAG}`,
  ws: "desk",
  side: "side",
  /** A workspace only A has (B and the operator have none of that name): a stranger asking for it must be told what it is told for a name nobody has. */
  vault: "vault",
  sideContent: `CANARY-SIDE-${TAG}`,
  run: `run-alpha-${TAG}`,
  flow: "daily",
  agent: "writer",
  eval: "quality",
  content: `CANARY-CONTENT-${TAG}`,
  secretValue: `CANARY-SECRET-VALUE-${TAG}`,
  accountSecretValue: `CANARY-ACCOUNT-SECRET-VALUE-${TAG}`,
  secretName: `ALPHA_TOKEN_${TAG.toUpperCase()}`,
  runText: `CANARY-RUN-${TAG}`,
  emailDomain: `alpha-${TAG}.test`,
  password: "Correct-horse-battery-9",
};
export const B = { tenant: `bravoco-${TAG}`, content: `BRAVO-CONTENT-${TAG}`, emailDomain: `bravo-${TAG}.test` };
// The operator's own account (platformAccount()): named per run so a database that outlives the run does not refuse it.
export const OP = { tenant: `foldrun-${TAG}` };
process.env.FOLDRUN_PLATFORM_ACCOUNT = OP.tenant;

const em = (who: string, d: string) => `${who}@${d}`;
export const EMAILS = {
  owner: em("owner", A.emailDomain), admin: em("admin", A.emailDomain), editor: em("editor", A.emailDomain),
  viewer: em("viewer", A.emailDomain), scoped: em("scoped", A.emailDomain),
  b: em("owner", B.emailDomain), op: em("ops", `op-${TAG}.test`),
  invited: em("invitee", A.emailDomain),
};

const mkdir = (p: string) => fs.mkdirSync(p, { recursive: true });

function seedWorkspace(tenant: string, ws: string, tag: string) {
  const root = path.join(DATA, tenant, "workspaces", ws);
  for (const d of ["flows", `agents/${A.agent}`, "knowledge", "memory", "evals", "storage/public", "tools"]) mkdir(path.join(root, d));
  fs.writeFileSync(path.join(root, "AGENTS.md"), `---\nname: ${ws}\n---\n\n${tag} shared context\n`);
  fs.writeFileSync(path.join(root, `agents/${A.agent}/agent.md`), `---\nname: ${A.agent}\ndescription: writes\n---\n\n${tag} persona\n`);
  fs.writeFileSync(path.join(root, "flows", `${A.flow}.md`), `---\nname: ${A.flow}\ntrigger: webhook\n---\n\n1. [[${A.agent}]] — ${tag}\n`);
  fs.writeFileSync(path.join(root, "knowledge/notes.md"), `${tag} knowledge\n`);
  fs.writeFileSync(path.join(root, "memory/learned.md"), `${tag} memory\n`);
  fs.writeFileSync(path.join(root, "storage/public/report.txt"), `${tag} file\n`);
  fs.writeFileSync(path.join(root, "evals", `${A.eval}.md`), `---\nname: ${A.eval}\nagent: ${A.agent}\n---\n\n${tag} case\n`);
}

function seedRun(tenant: string, ws: string, id: string, tag: string) {
  writeRun(tenant, ws, {
    id, flow: A.flow, status: "completed", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    steps: [{ agent: A.agent, instruction: tag, group: 1, optional: false, status: "completed", events: [{ t: new Date().toISOString(), type: "text", text: tag }], result: tag, costUsd: 0 }],
  } as never);
  const out = path.join(DATA, tenant, "workspaces", ws, "runs", id, "outputs", A.agent);
  mkdir(out);
  fs.writeFileSync(path.join(out, "report.md"), `# ${tag}\n`);
}

export interface Who {
  /** What it sends: a bearer key, or a session cookie, or nothing. */
  headers: Record<string, string>;
  label: string;
  /** "A" = account A, "B" = the stranger, "OP" = the operator's own account, "none". */
  account: "A" | "B" | "OP" | "none";
  role: "viewer" | "editor" | "admin" | "owner" | null;
  via: "key" | "session" | "none";
  /** Workspaces it is limited to; null = all. */
  scope: string[] | null;
}

async function member(email: string, tenant: string, role: "viewer" | "editor" | "admin", workspaces: string[] | null = null) {
  return users.createUser(email, A.password, tenant, { joining: true, role, workspaces });
}
const cookie = async (u: Awaited<ReturnType<typeof users.createUser>>) => `${users.SESSION_COOKIE}=${(await users.mintSession(u)).value}`;

export const WHO: Record<string, Who> = {};
export const KEYS: { id: string; secret: string }[] = [];
export const IDS: Record<string, string> = {};

const owner = await users.createUser(EMAILS.owner, A.password, A.tenant, { request: "free" });
const adminU = await member(EMAILS.admin, A.tenant, "admin");
const editorU = await member(EMAILS.editor, A.tenant, "editor");
const viewerU = await member(EMAILS.viewer, A.tenant, "viewer");
const scopedU = await member(EMAILS.scoped, A.tenant, "editor", [A.side]);
const bOwner = await users.createUser(EMAILS.b, A.password, B.tenant, { request: "free" });
const opOwner = await users.createUser(EMAILS.op, A.password, OP.tenant, { request: "free" });
IDS.owner = owner.id; IDS.admin = adminU.id; IDS.editor = editorU.id; IDS.viewer = viewerU.id; IDS.scoped = scopedU.id; IDS.bOwner = bOwner.id;

seedWorkspace(A.tenant, A.ws, A.content);
seedWorkspace(A.tenant, A.side, A.sideContent);
seedWorkspace(A.tenant, A.vault, `CANARY-VAULT-${TAG}`);
mkdir(path.join(DATA, A.tenant, "library", "knowledge"));
fs.writeFileSync(path.join(DATA, A.tenant, "library", "knowledge", "shared.md"), `${A.content} library\n`);
// B has a workspace of the SAME name, so a route that took the name without the account would answer with B's own — or with A's.
seedWorkspace(B.tenant, A.ws, B.content);
seedRun(A.tenant, A.ws, A.run, A.runText);
seedRun(A.tenant, A.side, `run-side-${TAG}`, `${A.sideContent}-RUN`);
seedRun(B.tenant, A.ws, `run-bravo-${TAG}`, B.content);
// A run parked on `wait: event` and one on a person: the first's event URL is printed into its own trace (runner.ts), the second's approve link goes out by mail.
const AT = new Date().toISOString();
export const PARKED = A.run; // A's run IS the parked one, so every run route is asked about it
writeRun(A.tenant, A.ws, {
  id: PARKED, flow: A.flow, status: "awaiting-approval", startedAt: AT, finishedAt: null,
  steps: [{ agent: A.agent, instruction: A.runText, group: 1, optional: false, waitFor: "event", approve: true, ask: "ship it?", status: "awaiting-approval", result: A.runText,
    events: [{ t: AT, type: "info", text: `waiting for an external event — release it with POST ${eventUrl(A.tenant, A.ws, PARKED, { step: 0, at: AT })}` }], costUsd: null }],
} as never);
{
  const out = path.join(DATA, A.tenant, "workspaces", A.ws, "runs", PARKED, "outputs", A.agent);
  mkdir(out);
  fs.writeFileSync(path.join(out, "report.md"), `# ${A.runText}\n`);
}
// What A's other workspace spent: a charge with a figure no other number in the answers looks like. A caller limited to `side` must not learn it.
export const SPEND = "13.3742";
await ledgerAppend(A.tenant, { t: new Date().toISOString(), kind: "run", usd: -Number(SPEND), cost: -Number(SPEND), workspace: A.vault, flow: A.flow, run: `run-ledger-${TAG}` } as never);
await ledgerAppend(A.tenant, { t: new Date(Date.now() - 86_400_000).toISOString(), kind: "topup", usd: 100.5 } as never); // so the balance (87.1258) is not the figure the charge is, and the balance may be shown while the charge may not
/** Capabilities: a URL or token whose possession IS the permission. Only those the design lets see them may. */
export const TOKENS = {
  hook: webhookToken(A.tenant, A.ws, A.flow),
  approve: approveToken(A.tenant, A.ws, PARKED),
  event: new URL(eventUrl(A.tenant, A.ws, PARKED, { step: 0, at: AT }), "http://x").searchParams.get("token")!,
};
setSecret(A.tenant, A.secretName, A.secretValue, A.ws);
setSecret(A.tenant, `${A.secretName}_ACCOUNT`, A.accountSecretValue);
export const SHARE = await createShare(A.tenant, A.ws, "storage/public/report.txt", { createdBy: EMAILS.owner });

async function key(tenant: string, label: string, role: "viewer" | "editor" | "admin", workspaces: string[] | null, by: string) {
  const k = await createApiKey(tenant, label, by, undefined, role, workspaces);
  KEYS.push({ id: k.record.id, secret: k.key });
  return k;
}
const kViewer = await key(A.tenant, "viewer", "viewer", null, EMAILS.viewer);
const kEditor = await key(A.tenant, "editor", "editor", null, EMAILS.editor);
const kAdmin = await key(A.tenant, "admin", "admin", null, EMAILS.admin);
const kScoped = await key(A.tenant, "scoped", "admin", [A.side], EMAILS.admin);
const kB = await key(B.tenant, "bravo", "admin", null, EMAILS.b);
IDS.keyViewer = kViewer.record.id; IDS.keyAdmin = kAdmin.record.id; IDS.keyEditor = kEditor.record.id; IDS.keyScoped = kScoped.record.id; IDS.keyB = kB.record.id;

const bearer = (k: { key: string }) => ({ authorization: `Bearer ${k.key}` });
const USERS: Record<string, Awaited<ReturnType<typeof users.createUser>>> = { viewerSession: viewerU, editorSession: editorU, adminSession: adminU, ownerSession: owner, scopedSession: scopedU, strangerSession: bOwner, operatorSession: opOwner };
/** With a database a sign-out or a password change really ends sessions, and nothing puts them back: the people sign in again here. */
export async function reSignIn(): Promise<void> {
  for (const [label, u] of Object.entries(USERS)) WHO[label].headers = { cookie: await cookie(u) };
}
const W = (label: string, account: Who["account"], role: Who["role"], via: Who["via"], scope: string[] | null, headers: Record<string, string>) => (WHO[label] = { label, account, role, via, scope, headers });
W("anon", "none", null, "none", null, {});
W("viewerKey", "A", "viewer", "key", null, bearer(kViewer));
W("viewerSession", "A", "viewer", "session", null, { cookie: await cookie(viewerU) });
W("editorKey", "A", "editor", "key", null, bearer(kEditor));
W("editorSession", "A", "editor", "session", null, { cookie: await cookie(editorU) });
W("adminKey", "A", "admin", "key", null, bearer(kAdmin));
W("adminSession", "A", "admin", "session", null, { cookie: await cookie(adminU) });
W("ownerSession", "A", "owner", "session", null, { cookie: await cookie(owner) });
W("scopedKey", "A", "admin", "key", [A.side], bearer(kScoped));
W("scopedSession", "A", "editor", "session", [A.side], { cookie: await cookie(scopedU) });
W("strangerSession", "B", "owner", "session", null, { cookie: await cookie(bOwner) });
W("strangerKey", "B", "admin", "key", null, bearer(kB));
W("operatorSession", "OP", "owner", "session", null, { cookie: await cookie(opOwner) });

/** Everything of A's that is a secret in the strong sense: no caller of any account or role ever sees it in a response. */
export const NEVER_SHOWN = [A.secretValue, A.accountSecretValue, ...KEYS.filter((k) => k.id !== kB.record.id).map((k) => k.secret), kB.key, A.password];
/** Content strings of A: only A's own callers may see them. */
export const A_ONLY = [SPEND, `run-ledger-${TAG}`, A.content, A.runText, A.secretName, A.emailDomain, A.tenant, `run-side-${TAG}`, A.sideContent, `CANARY-VAULT-${TAG}`, SHARE.token];
/** What a caller limited to `side` must not see: everything of A's outside that workspace. */
export const NOT_SIDE = [SPEND, `run-ledger-${TAG}`, A.content, A.runText, A.run, A.secretName, `CANARY-VAULT-${TAG}`, SHARE.token];
