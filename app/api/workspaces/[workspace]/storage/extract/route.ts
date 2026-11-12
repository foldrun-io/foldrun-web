import { NextRequest } from "next/server";
import { ApiError, actorOf, errorResponse, refuse, requirePermission } from "@/server/api";
import { idempotent } from "@/server/idempotency";
import { jsonObject } from "@/server/body";
import { answerFor, credentialOf, waitSeconds } from "@/server/extract";
import { getFile, readFileBytes, requireWorkspace } from "@/lib/storage";
import { extractMaxBytes, parseExtractOptions, startExtractJob, waitForJob } from "@/platform/extract";

// A stored file to text (12 Nov 2026; foldrun-docs extract.md).
//
//   POST …/storage/extract  { path, lang?, ocr?, engine?, write?: true, wait?: 0..60 }
//   → 200 the text (platform extract.ts ExtractResult) + wrote: "<path>.txt" | null
//   → 202 { id, status: "running", poll: "/api/extract/<id>" } when it is not done within `wait`
//
// With write (the default) the text is written to `<path>.txt` beside the
// file, by whoever asked, once it is done — also when the caller stopped
// waiting — so an agent can read it as a file. That needs workspace:write;
// write: false only reads (workspace:read). A .txt is not extracted into
// another .txt.

/** Who wrote a file, as the storage listing shows it (the storage route's rule). */
async function writer(req: NextRequest): Promise<string> {
  const who = await actorOf(req);
  return who.includes("@") ? `user:${who}` : who;
}

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    // Refused before the body is read; writing asks for more below.
    const { tenant, actor } = await requirePermission(req, "workspace:read");
    const body = await jsonObject(req);
    if (body.write !== undefined && typeof body.write !== "boolean") throw new ApiError("write is true or false", 400);
    const write = body.write !== false;
    if (write) await requirePermission(req, "workspace:write");
    if (typeof body.path !== "string" || !body.path) throw new ApiError("expected { path } — a file in this workspace's storage", 400);
    // Already relative to the storage root (what the file browser sends): a
    // file may itself live under a folder named storage/ — never rewritten.
    const rel = body.path;
    const options = parseExtractOptions({ name: rel, lang: body.lang, ocr: body.ocr, engine: body.engine });
    const wait = waitSeconds(body.wait);
    requireWorkspace(tenant, workspace);
    if (write && /\.txt$/i.test(rel)) throw new ApiError(`${rel} is already text — nothing to write beside it (send write: false to read it)`, 400);
    const record = getFile(tenant, workspace, rel);
    if (!record) return refuse(`no file ${rel} in ${workspace}'s storage`, 404);
    const max = extractMaxBytes();
    if (record.size > max) return refuse(`${rel} is ${(record.size / 1024 / 1024).toFixed(1)} MB; text is extracted from files of at most ${Math.round(max / 1024 / 1024)} MB`, 413);
    const bytes = await readFileBytes(tenant, workspace, rel);
    if (!bytes) return refuse(`no file ${rel} in ${workspace}'s storage`, 404);
    const job = await startExtractJob({
      tenant,
      workspace,
      actor: credentialOf(actor),
      bytes,
      options: { ...options },
      ...(write ? { write: { path: `${record.path}.txt`, by: await writer(req) } } : {}),
    });
    return answerFor(await waitForJob(tenant, job.id, wait, req.signal), (j) => ({ wrote: j.wrote }));
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
