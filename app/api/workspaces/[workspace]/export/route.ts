import { NextRequest, NextResponse } from "next/server";
import { requireCaller, errorResponse } from "@/server/api";
import { audit } from "@/server/audit";
import { packageOf, packageZip, packageFilename, PackageError, type PackageKind } from "@/lib/package";

// Export this workspace, one flow or one agent as a .zip — the authored
// source it needs, never memory, state, storage or a secret's value. The
// same file "Import" takes in any account. See core package.ts.
//
//   GET …/export                         the whole workspace
//   GET …/export?kind=flow&name=publish  a flow and everything it runs
//   GET …/export?kind=agent&name=writer  an agent and what it grants
export async function GET(req: NextRequest, ctx: { params: Promise<{ workspace: string }> }) {
  try {
    const { workspace } = await ctx.params;
    // A read: every role may export what it may read. requireCaller checks
    // the path's workspace against a scoped key.
    const { tenant, actor } = await requireCaller(req);
    const kindParam = req.nextUrl.searchParams.get("kind") ?? "workspace";
    if (kindParam !== "workspace" && kindParam !== "flow" && kindParam !== "agent") {
      return NextResponse.json({ error: "kind is workspace, flow or agent" }, { status: 400 });
    }
    const kind = kindParam as PackageKind;
    const name = req.nextUrl.searchParams.get("name") ?? undefined;
    const pkg = packageOf(tenant, workspace, kind, name);
    const body = packageZip(pkg);
    await audit("workspace.exported", {
      actor: actor.name,
      tenant,
      subject: workspace,
      detail: { workspace, kind, name: pkg.manifest.name, files: pkg.files.length },
    });
    const filename = packageFilename(pkg.manifest);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "content-type": "application/zip",
        "content-length": String(body.length),
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof PackageError) return NextResponse.json({ error: err.message }, { status: err.status });
    return errorResponse(err);
  }
}
