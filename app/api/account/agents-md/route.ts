import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAccountWide, errorResponse, refuse } from "@/server/api";
import { audit } from "@/server/audit";
import { idempotent } from "@/server/idempotency";
import { accountDir } from "@/lib/store";
import { checkFiles } from "@/lib/deploy";

// The account's own AGENTS.md, the whole file — the shared context and
// defaults every agent in every workspace reads (cloudhost, 11 Nov 2026: a CI
// sync had to copy it into each workspace's AGENTS.md for want of this).
//
//   GET                                   { content, sha256, exists }
//   PUT { content, ifMatch?, message? }   write it whole → { ok, sha256, issues }
//
// Account-wide callers only, both ways: the file can name notify and
// telemetry targets for every workspace, and it sets what every agent may
// reach — the same reason PATCH /api/account is. Writing needs an admin
// (workspace:manage). Checked as a deploy checks AGENTS.md (core checkFiles):
// an error is a 422 with the issues and nothing written; warnings come back
// with the write. `ifMatch` — the sha256 a GET answered, or null for "there
// was no file" — makes it a 409 if the file changed since.

const MAX = 256 * 1024;
const fileOf = (tenant: string) => path.join(accountDir(tenant), "AGENTS.md");
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function GET(req: NextRequest) {
  try {
    const { tenant } = await requireAccountWide(req, "workspace:read");
    const file = fileOf(tenant);
    const exists = fs.existsSync(file);
    const content = exists ? fs.readFileSync(file, "utf8") : "";
    return NextResponse.json({ content, sha256: exists ? sha(content) : null, exists });
  } catch (err) {
    return errorResponse(err);
  }
}

async function putOnce(req: NextRequest) {
  try {
    const { tenant, actor } = await requireAccountWide(req, "workspace:manage");
    let body: { content?: unknown; ifMatch?: unknown; message?: unknown };
    try {
      body = await req.json();
    } catch {
      return refuse("send { content } as JSON", 400);
    }
    if (typeof body.content !== "string") return refuse("content: the whole AGENTS.md, as a string", 400);
    if (Buffer.byteLength(body.content) > MAX) return refuse(`the file is larger than ${MAX / 1024} KB`, 413);
    if (body.ifMatch !== undefined && body.ifMatch !== null && typeof body.ifMatch !== "string") return refuse("ifMatch: the sha256 GET answered, or null", 400);

    const issues = checkFiles([{ path: "AGENTS.md", content: body.content }]);
    const errors = issues.filter((i) => i.level === "error");
    if (errors.length) {
      // The reasons in the message itself: the dashboard's editor shows the
      // error line, and a person has to know what to change (Codex review).
      const what = errors.slice(0, 3).map((i) => `${i.line ? `line ${i.line}: ` : ""}${i.message}`).join("; ");
      return NextResponse.json({ error: `AGENTS.md has ${errors.length} problem${errors.length === 1 ? "" : "s"} a deploy would refuse, so nothing was written — ${what}${errors.length > 3 ? "; …" : ""}`, issues }, { status: 422 });
    }

    const file = fileOf(tenant);
    const exists = fs.existsSync(file);
    const before = exists ? fs.readFileSync(file, "utf8") : null;
    if (body.ifMatch !== undefined) {
      const now = before === null ? null : sha(before);
      if (now !== body.ifMatch) return refuse(now === null ? "the file is gone since you read it" : "the file changed since you read it — GET it again and merge", 409);
    }
    if (before === body.content) return NextResponse.json({ ok: true, sha256: sha(body.content), unchanged: true, issues });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, body.content);
    fs.renameSync(tmp, file);
    await audit("account.agents_md_set", {
      actor: actor.name,
      tenant,
      subject: "AGENTS.md",
      detail: { bytes: Buffer.byteLength(body.content), sha256: sha(body.content), created: before === null, ...(typeof body.message === "string" ? { message: body.message.slice(0, 200) } : {}) },
    });
    return NextResponse.json({ ok: true, sha256: sha(body.content), issues });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key. */
export async function PUT(req: NextRequest) {
  return idempotent(req, () => putOnce(req));
}
