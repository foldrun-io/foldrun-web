import { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse, requirePermission } from "@/server/api";
import { uploadUrl } from "@/lib/storage";
import { idempotent } from "@/server/idempotency";

// Phase one of an upload: ask where to put the bytes.
//
// A non-null `url` is a presigned PUT — the browser sends the file straight
// to the bucket and then POSTs back to ../files to register it. Null means
// this deployment has no object store (the fs driver, i.e. a laptop), and the
// browser should PUT the bytes to ../storage?path= instead.
//
// The client hashes the file before asking, because the key is the hash: two
// people uploading the same 200MB catalogue store one object, and a retry
// after a dropped connection overwrites the same immutable key rather than
// leaving a half-written second one.
//
// And says how long it is (30 Oct 2026). The per-file limit and the quota are
// checked here, before a byte moves, and the length is signed into the URL,
// so the bucket refuses a PUT of any other length. Without it a presigned
// PUT took any size, and an object PUT and never registered sat in the
// bucket outside every limit. `size` stays optional so a CLI released
// before this keeps uploading (a newly required field is an API break):
// without it the URL is signed as before, and registerUpload still measures
// the real object against the limit and quota and deletes one it refuses.

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    const tenant = (await requirePermission(req, "workspace:write")).tenant;
    const body = (await req.json()) as { path?: unknown; sha?: unknown; size?: unknown };
    if (typeof body.path !== "string" || !body.path || typeof body.sha !== "string" || !body.sha || (body.size !== undefined && typeof body.size !== "number")) {
      throw new ApiError("expected { path, sha, size? } — size is the file's length in bytes", 400);
    }
    return NextResponse.json({ url: await uploadUrl(tenant, workspace, body.path, body.sha, body.size as number | undefined) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. */
export async function POST(...args: Parameters<typeof postOnce>) {
  return idempotent(args[0], () => postOnce(...args));
}
