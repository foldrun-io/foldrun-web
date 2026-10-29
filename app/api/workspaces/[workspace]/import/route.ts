import { NextRequest, NextResponse } from "next/server";
import { requirePermission, errorResponse, actorOf } from "@/server/api";
import { audit } from "@/server/audit";
import { listWorkspaces } from "@/lib/store";
import { readPackage, planImport, applyImport, PackageError } from "@/lib/package";
import { platform } from "@/lib/platform";
import { billing } from "@/platform/billing";
import { idempotent } from "@/server/idempotency";
import { settingText } from "@/platform/settings";

// Import a package (what …/export downloads) into this workspace — or, for
// a workspace package, make this workspace from it. The body is the .zip.
//
//   POST …/import?dryRun=1     what it would add, overwrite and still need; writes nothing
//   POST …/import              apply; refused (409) when it would overwrite a file
//   POST …/import?overwrite=1  apply, replacing those files
//
// Never deletes a file. One revision, so History can undo it. See core package.ts.

const MAX_BODY = 20 * 1024 * 1024;

async function postOnce(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    // Refuse before reading the body. Writing into a workspace needs write;
    // making a new one needs manage, checked below once we know it is new.
    const { tenant, actor } = await requirePermission(req, "workspace:write");
    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length > MAX_BODY) return NextResponse.json({ error: `the package is larger than ${MAX_BODY / 1024 / 1024} MB` }, { status: 413 });
    if (bytes.length === 0) return NextResponse.json({ error: "send the .zip as the request body" }, { status: 400 });

    const pkg = readPackage(bytes);
    const plan = planImport(tenant, workspace, pkg);
    const q = req.nextUrl.searchParams;
    const flag = (k: string) => q.get(k) === "1" || q.get(k) === "true";
    if (flag("dryRun")) return NextResponse.json({ dryRun: true, ...plan });

    if (plan.creates) {
      await requirePermission(req, "workspace:manage");
      // The plan's workspace count, as POST /api/workspaces checks it.
      const cap = (await billing().plan(tenant))?.workspaces ?? Number(settingText("FOLDRUN_PLAN_WORKSPACES"));
      if (Number.isFinite(cap) && cap > 0 && platform.edition() === "hosted" && listWorkspaces(tenant).length >= cap) {
        return NextResponse.json({ error: `this plan includes ${cap} workspace${cap === 1 ? "" : "s"} — delete one or upgrade` }, { status: 402 });
      }
    }
    const by = await actorOf(req);
    // `expect`: the permission and plan checks above were for this answer to
    // "is it new?" — if that changed since, applyImport refuses.
    const result = applyImport(tenant, workspace, pkg, { overwrite: flag("overwrite"), expect: plan.creates ? "create" : "merge", ...(by ? { by } : {}) });
    await audit("workspace.imported", {
      actor: actor.name,
      tenant,
      subject: workspace,
      detail: {
        workspace,
        kind: result.kind,
        name: result.name,
        from: result.from,
        created: result.creates,
        written: result.written.length,
        overwritten: flag("overwrite") ? result.overwritten.length : 0,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof PackageError) return NextResponse.json({ error: err.message }, { status: err.status });
    return errorResponse(err);
  }
}

/** At most once per Idempotency-Key — server/idempotency.ts. The size is
 *  checked first, from the header: idempotent() reads the whole body to key
 *  it, so a body with no length, or too long a one, is refused before
 *  anything is read. fetch() and the CLI always send a Content-Length. */
export async function POST(...args: Parameters<typeof postOnce>) {
  const declared = args[0].headers.get("content-length");
  if (declared === null) return NextResponse.json({ error: "send the .zip with a Content-Length" }, { status: 411 });
  if (Number(declared) > MAX_BODY) return NextResponse.json({ error: `the package is larger than ${MAX_BODY / 1024 / 1024} MB` }, { status: 413 });
  return idempotent(args[0], () => postOnce(...args));
}
