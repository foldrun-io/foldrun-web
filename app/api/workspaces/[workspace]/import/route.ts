import { NextRequest, NextResponse } from "next/server";
import { flushRevisions } from "@/lib/workspace-revisions";
import { listRevisions } from "@/lib/history";
import { requirePermission, errorResponse, reportError, actorOf, refuse } from "@/server/api";
import { audit } from "@/server/audit";
import { readPackage, planImport, applyImport, PackageError } from "@/lib/package";
import { idempotent } from "@/server/idempotency";
import { workspaceCapRefusal } from "@/server/workspace-cap";
import { assertMayChangeWorkspacePolicy, auditPolicyEvents } from "@/server/workspace-policy";

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
    if (bytes.length > MAX_BODY) return refuse(`the package is larger than ${MAX_BODY / 1024 / 1024} MB`, 413);
    if (bytes.length === 0) return refuse("send the .zip as the request body", 400);

    const pkg = readPackage(bytes);
    const plan = planImport(tenant, workspace, pkg);
    const q = req.nextUrl.searchParams;
    const flag = (k: string) => q.get(k) === "1" || q.get(k) === "true";
    if (flag("dryRun")) return NextResponse.json({ dryRun: true, ...plan });

    if (plan.creates) {
      await requirePermission(req, "workspace:manage");
      // The plan's workspace count, as POST /api/workspaces checks it.
      const overCap = await workspaceCapRefusal(tenant, workspace);
      if (overCap) return refuse(overCap, 402);
    }
    const by = await actorOf(req);
    // What the import would write over its AGENTS.md (or add beside a
    // project.md) may not change the policy keys past an editor
    // (server/workspace-policy.ts, 30 Oct 2026); a new workspace's published
    // flows meet the published-flow checks too (FOL-112).
    const written = new Set([...plan.added, ...(flag("overwrite") ? plan.overwritten : [])]);
    const policyEvents = assertMayChangeWorkspacePolicy(actor, tenant, workspace, pkg.files.filter((f) => written.has(f.path)), "merge");
    // `expect`: the permission and plan checks above were for this answer to
    // "is it new?" — if that changed since, applyImport refuses.
    const started = new Date().toISOString();
    const result = applyImport(tenant, workspace, pkg, { overwrite: flag("overwrite"), expect: plan.creates ? "create" : "merge", ...(by ? { by } : {}) });
    await auditPolicyEvents(policyEvents, actor.name, tenant);
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
    // Committed as a revision before the answer (when revisions are on): the
    // folder is already changed, so a store that is down only leaves it queued.
    const flushed = await flushRevisions({ tenant, workspace });
    const revision = result.revision ? await importRevision(tenant, workspace, result.revision, result.written, by, started, flushed.pending) : null;
    return NextResponse.json({ ok: true, ...result, revision });
  } catch (err) {
    // A write that failed is the server's fault, and its message is a Node
    // error naming the data path (30 Oct 2026): logged by reportError, and
    // the caller hears only what reportError lets through.
    if (err instanceof PackageError && err.status >= 500 && err.cause !== undefined) {
      return refuse(`the import could not be written, and nothing was kept: ${reportError(err.cause).message}`, err.status);
    }
    if (err instanceof PackageError) return refuse(err.message, err.status);
    return errorResponse(err);
  }
}

/** The id History knows this import by. Where the history is this disk's,
 *  that is the id the writer made; where it is the revision store's, the store
 *  names a revision when it is published (a pod on its own disk keeps no
 *  history of its own, FOL-126) — so it is the published revision by this
 *  actor, since the import started, that changed every file it wrote. Null
 *  when that cannot be told: still queued, or not found (never the newest
 *  revision of someone else's — Codex review, 13 Nov 2026). */
async function importRevision(tenant: string, workspace: string, local: string, written: string[], by: string | undefined, since: string, pending: number): Promise<string | null> {
  const rows = await listRevisions(tenant, workspace, { limit: 20 });
  if (rows.some((r) => r.id === local)) return local;
  if (pending > 0) return null;
  const hit = rows.find((r) => r.at >= since && (!by || r.by === by) && written.every((p) => r.paths.includes(p)));
  return hit?.id ?? null;
}

/** At most once per Idempotency-Key — server/idempotency.ts. The size is
 *  checked first, from the header: idempotent() reads the whole body to key
 *  it, so a body with no length, or too long a one, is refused before
 *  anything is read. fetch() and the CLI always send a Content-Length. */
export async function POST(...args: Parameters<typeof postOnce>) {
  const declared = args[0].headers.get("content-length");
  if (declared === null) return refuse("send the .zip with a Content-Length", 411);
  if (Number(declared) > MAX_BODY) return refuse(`the package is larger than ${MAX_BODY / 1024 / 1024} MB`, 413);
  return idempotent(args[0], () => postOnce(...args));
}
