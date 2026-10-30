// A body that is not a JSON object, or a field of the wrong type, is the
// caller's mistake: 400, never 500 (30 Oct 2026). `null`, `[]` and `7` are
// valid JSON, and the routes below used to read `body.x` off them and throw
// a TypeError — "something went wrong on our side". server/body.ts reads the
// body for them now.
//
//   node --import ./tests/register.mjs --test tests/json-body.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-json-body-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_OPEN_SIGNUP = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { createUser, mintSession, SESSION_COOKIE } = await import("../server/users.ts");
const { jsonObject } = await import("../server/body.ts");
const { ApiError } = await import("../server/api.ts");
type Handler = (req: InstanceType<typeof NextRequest>, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;
const library = (await import("../app/api/library/[kind]/route.ts")) as unknown as Record<string, Handler>;
const gallery = (await import("../app/api/library/gallery/route.ts")) as unknown as Record<string, Handler>;
const authorize = (await import("../app/api/cli/authorize/route.ts")) as unknown as Record<string, Handler>;
const flowRoute = (await import("../app/api/workspaces/[workspace]/flows/[flow]/route.ts")) as unknown as Record<string, Handler>;
const wsRoute = (await import("../app/api/workspaces/[workspace]/route.ts")) as unknown as Record<string, Handler>;
const storage = (await import("../app/api/workspaces/[workspace]/storage/route.ts")) as unknown as Record<string, Handler>;
const uploadUrl = (await import("../app/api/workspaces/[workspace]/storage/upload-url/route.ts")) as unknown as Record<string, Handler>;

const TENANT = "acme";
const WS = "desk";
const ws = path.join(DATA, TENANT, "workspaces", WS);
fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
const FLOW = "---\nname: morning\n---\n\n1. [[researcher]] — find it\n";
const flowFile = path.join(ws, "flows/morning.md");
fs.writeFileSync(flowFile, FLOW);
const { key } = await createApiKey(TENANT, "test", "owner@acme.test", undefined, "admin");

/** A request with this exact body text (undefined: none at all). */
const req = (method: string, url: string, body?: string, headers: Record<string, string> = { authorization: `Bearer ${key}` }) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body }) });
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });
async function is400(res: Response) {
  const text = await res.clone().text();
  assert.equal(res.status, 400, text);
  assert.ok(((await res.json()) as { error?: string }).error, "says what was wrong");
}

test("jsonObject: an object passes; null, arrays, scalars, malformed and empty are 400", async () => {
  const read = (body: string, optional = false) => jsonObject(new Request("http://x", { method: "POST", body }), { optional });
  assert.deepEqual(await read('{"a":1}'), { a: 1 });
  for (const bad of ["null", "[]", "7", '"x"', "true", "{", ""]) {
    await assert.rejects(read(bad), (e: unknown) => e instanceof ApiError && e.status === 400, bad);
  }
  assert.deepEqual(await read("", true), {}, "optional: an empty body is {}");
  await assert.rejects(read("null", true), (e: unknown) => e instanceof ApiError && e.status === 400, "optional never accepts null");
});

test("library POST/PUT/DELETE and gallery POST: a null body is 400", async () => {
  await is400(await library.POST(req("POST", "/api/library/skills", "null"), params({ kind: "skills" })));
  await is400(await library.PUT(req("PUT", "/api/library/skills", "null"), params({ kind: "skills" })));
  await is400(await library.DELETE(req("DELETE", "/api/library/skills", "null"), params({ kind: "skills" })));
  await is400(await library.POST(req("POST", "/api/library/skills", JSON.stringify({ name: "ok-name", template: 7 })), params({ kind: "skills" })));
  await is400(await library.PUT(req("PUT", "/api/library/skills", JSON.stringify({ path: 1, content: "x" })), params({ kind: "skills" })));
  await is400(await gallery.POST(req("POST", "/api/library/gallery", "null")));
  await is400(await gallery.POST(req("POST", "/api/library/gallery", JSON.stringify({ tool: ["web"] }))));
});

test("cli authorize: no body, a null body or a non-string code is 400", async () => {
  const user = await createUser("body@acme-body.test", "a long enough password 1", "acme-body");
  const cookie = `${SESSION_COOKIE}=${(await mintSession(user)).value}`;
  for (const body of [undefined, "null", "[]", JSON.stringify({ code: 12345678 })]) {
    await is400(await authorize.POST(req("POST", "/api/cli/authorize", body, { cookie })));
  }
});

test("flow PATCH: edits [null], a numeric schedule, bad groups are 400 and the file is unchanged", async () => {
  const p = params({ workspace: WS, flow: "morning" });
  await is400(await flowRoute.PATCH(req("PATCH", `/api/workspaces/${WS}/flows/morning`, "null"), p));
  await is400(await flowRoute.PATCH(req("PATCH", `/api/workspaces/${WS}/flows/morning`, JSON.stringify({ edits: [null] })), p));
  await is400(await flowRoute.PATCH(req("PATCH", `/api/workspaces/${WS}/flows/morning`, JSON.stringify({ trigger: { trigger: "schedule", schedule: 5 } })), p));
  // A cron that names no real date would silently never run.
  await is400(await flowRoute.PATCH(req("PATCH", `/api/workspaces/${WS}/flows/morning`, JSON.stringify({ trigger: { trigger: "schedule", schedule: "0 0 30 2 *" } })), p));
  await is400(await flowRoute.PATCH(req("PATCH", `/api/workspaces/${WS}/flows/morning`, JSON.stringify({ groups: [["a"]] })), p));
  await is400(await flowRoute.POST(req("POST", `/api/workspaces/${WS}/flows/morning`, "null"), p));
  assert.equal(fs.readFileSync(flowFile, "utf8"), FLOW);
});

test("workspace PATCH: no body, a null body or a numeric name is 400", async () => {
  const p = params({ workspace: WS });
  await is400(await wsRoute.PATCH(req("PATCH", `/api/workspaces/${WS}`), p));
  await is400(await wsRoute.PATCH(req("PATCH", `/api/workspaces/${WS}`, "null"), p));
  await is400(await wsRoute.PATCH(req("PATCH", `/api/workspaces/${WS}`, JSON.stringify({ name: 42 })), p));
  assert.ok(fs.existsSync(ws), "not renamed");
});

test("storage POST and upload-url: no body or a null body is 400", async () => {
  const p = params({ workspace: WS });
  for (const body of [undefined, "null"]) {
    await is400(await storage.POST(req("POST", `/api/workspaces/${WS}/storage`, body), p));
    await is400(await uploadUrl.POST(req("POST", `/api/workspaces/${WS}/storage/upload-url`, body), p));
  }
});
