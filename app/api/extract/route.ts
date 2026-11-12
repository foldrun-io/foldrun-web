import { NextRequest } from "next/server";
import { ApiError, errorResponse, refuse, requirePermission } from "@/server/api";
import { idempotent } from "@/server/idempotency";
import { bodyCut } from "@/server/body-limit";
import { answerFor, credentialOf, waitSeconds } from "@/server/extract";
import { extractMaxBytes, parseExtractOptions, startExtractJob, waitForJob } from "@/platform/extract";

// A file to text (12 Nov 2026; foldrun-docs extract.md).
//
//   POST /api/extract?name=&lang=fa|en|auto&ocr=auto|always|never&engine=docling&wait=0..60
//        body: the file's raw bytes, with a Content-Length
//   → 200 the text (platform extract.ts ExtractResult), when it is done within `wait`
//   → 202 { id, status: "running", poll: "/api/extract/<id>" } when it is not
//
// Images, PDFs, Word/PowerPoint/Excel, HTML, text, audio and video: OCR, text
// layers and speech, all on foldrun's own pods. Account-level: the file is
// not stored; the text is kept as this account's artifact, so the same file
// again comes back at once (`cached: true`). Starting one takes what
// starting a run takes (run:start). A file in a workspace's storage is
// …/storage/extract, which also writes `<file>.txt` beside it.

const tooBig = (max: number) => refuse(`text is extracted from files of at most ${Math.round(max / 1024 / 1024)} MB`, 413);

async function postOnce(req: NextRequest) {
  try {
    const { tenant, actor } = await requirePermission(req, "run:start");
    const q = req.nextUrl.searchParams;
    const options = parseExtractOptions({ name: q.get("name") ?? undefined, lang: q.get("lang") ?? undefined, ocr: q.get("ocr") ?? undefined, engine: q.get("engine") ?? undefined });
    const wait = waitSeconds(q.get("wait") ?? undefined);
    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length === 0) throw new ApiError("send the file's bytes as the request body", 400);
    if (bytes.length > extractMaxBytes()) return tooBig(extractMaxBytes());
    const cut = bodyCut(req.headers.get("content-length"), bytes.length);
    if (cut) return refuse(cut.error, cut.status);
    const job = await startExtractJob({ tenant, workspace: null, actor: credentialOf(actor), bytes, options: { ...options } });
    return answerFor(await waitForJob(tenant, job.id, wait, req.signal));
  } catch (err) {
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key. The length is checked from the header
 *  first: idempotent() reads the whole body to key it. */
export async function POST(req: NextRequest) {
  const declared = req.headers.get("content-length");
  if (declared === null) return refuse("send the file with a Content-Length", 411);
  if (Number(declared) > extractMaxBytes()) return tooBig(extractMaxBytes());
  return idempotent(req, () => postOnce(req));
}
