import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, errorResponse, refuse } from "@/server/api";
import { audit } from "@/server/audit";
import { idempotent } from "@/server/idempotency";
import { workspaceDir } from "@/lib/store";
import { saveSnapshot, SnapshotRefused, SNAPSHOT_LIMITS } from "@/platform/snapshots";

// Send a folder for an agent on foldrun to work on (Part B3, coding API).
//
//   POST …/snapshots   body: the folder as a .tar.gz (core snapshot-archive.ts —
//                      what `foldrun snapshot push` makes); Content-Length required
//   → 201 { snapshotId, files, bytes, compressedBytes, expiresAt, reused }
//     (200 when this workspace already had this exact folder)
//
// The archive is checked on the server whatever the client did: plain files
// and folders only, no path out, limits while it unpacks, and no secret
// (422, naming the file and line — never the value). Stored once by its hash,
// usable only in this workspace, gone 7 days after it was last sent unless a
// run uses it. platform snapshots.ts.

const MAX_BODY = SNAPSHOT_LIMITS.maxCompressedBytes;
const tooBig = () => refuse(`the archive is larger than ${MAX_BODY / 1024 / 1024} MB compressed — leave out build output and dependencies`, 413);

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    // Refuse before reading the body.
    const { tenant, actor } = await requirePermission(req, "snapshot:write");
    if (!fs.existsSync(workspaceDir(tenant, workspace))) return refuse(`workspace ${workspace} not found`, 404);
    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length > MAX_BODY) return tooBig();
    if (bytes.length === 0) return refuse("send the folder as a .tar.gz request body", 400);

    const saved = await saveSnapshot(tenant, workspace, bytes);
    await audit("snapshot.saved", {
      actor: actor.name,
      tenant,
      subject: workspace,
      detail: { workspace, snapshot: saved.snapshotId, files: saved.files, bytes: saved.bytes, reused: saved.reused },
    });
    return NextResponse.json(saved, { status: saved.reused ? 200 : 201 });
  } catch (err) {
    if (err instanceof SnapshotRefused) return refuse(`the snapshot was refused: ${err.message}`, 422);
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key. The size is checked from the header
 *  first: idempotent() reads the whole body to key it. */
export async function POST(...args: Parameters<typeof postOnce>) {
  const declared = args[0].headers.get("content-length");
  if (declared === null) return refuse("send the archive with a Content-Length", 411);
  if (Number(declared) > MAX_BODY) return tooBig();
  return idempotent(args[0], () => postOnce(...args));
}
