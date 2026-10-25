// The whole account as one tree, in the editor shell.
//
// Every workspace's source plus the shared shelf, laid out as the disk is —
// `library/` and `workspaces/<name>/` — because a file explorer that
// invents its own shape teaches the wrong thing. The platform's own
// bookkeeping (the revision store, runtime caches, file-store indexes) is
// not listed: real paths, but not files anyone reads here. A shared or
// workspace markdown file opens in the editor; a record opens pretty; the
// vault and the ledger say why they will not open.

import { scopeAllows } from "@/platform/scope";
import { viewerScope } from "@/server/users";
import Link from "next/link";
import { readLibraryFile } from "@/lib/library";
import { listAccountFiles, readAccountFile, accountFileSealed, listWorkspaces, readWorkspaceFile } from "@/lib/store";
import { EditorShell, type ContextSection } from "@/components/editor-shell";
import { CodeView } from "@/components/code-view";
import { kindOf, crumbs } from "@/components/editor-context-model";
import { nowMs } from "@/components/overview-model";
import { EmptyScreen, Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AccountFilesPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; path?: string }>;
}) {
  const { tenant = "default", path: filePath } = await searchParams;
  const now = nowMs();
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const rest = tenant !== "default" ? `&tenant=${tenant}` : "";

  // A member scoped to some workspaces sees only those, here as everywhere —
  // and this listing walks the whole account dir, workspaces included.
  const scope = await viewerScope();
  const inScope = (ws: string) => scopeAllows(scope, ws);
  const files = listAccountFiles(tenant).filter((f) => {
    const [head, ws] = f.split("/");
    return head !== "workspaces" || !ws || inScope(ws);
  });
  const workspaces = listWorkspaces(tenant).filter((w) => inScope(w.name));
  const selected = filePath && files.includes(filePath) ? filePath : (filePath && files.find((f) => f.startsWith(`${filePath}/`))) || files.find((f) => !accountFileSealed(f)) || files[0];
  const segments = (selected ?? "").split("/");
  const isShared = segments[0] === "library" && segments.length > 2;
  const isWorkspaceFile = segments[0] === "workspaces" && segments.length > 2;
  const owner = segments[1];
  const relative = segments.slice(2).join("/");
  const sealed = selected ? accountFileSealed(selected) : null;

  let content: string | null = null;
  try {
    if (!selected || sealed) content = null;
    else if (isShared) content = readLibraryFile(tenant, owner as never, relative);
    else if (isWorkspaceFile) content = readWorkspaceFile(tenant, owner, relative);
    else {
      const got = readAccountFile(tenant, selected);
      content = "content" in got ? got.content : null;
    }
  } catch {
    content = null;
  }

  // Markdown in a workspace or on the shelf is edited; anything else is shown.
  const editable = content !== null && (isShared || isWorkspaceFile) && /\.(md|py|sh|[mc]?js|ts|rb|sql|txt|json|ya?ml|toml)$/i.test(selected ?? "");
  const kind = selected ? (isWorkspaceFile ? kindOf(relative) : isShared ? kindOf(`${owner}/${relative}`) : "other") : "other";

  const sections: ContextSection[] = [];
  if (selected) {
    if (isWorkspaceFile) {
      sections.push({
        title: "Where",
        items: [
          { label: owner, href: `/dashboard/${owner}${qs}`, meta: "workspace" },
          { label: "Open in its editor", href: `/dashboard/${owner}/edit?path=${encodeURIComponent(relative)}${rest}` },
        ],
      });
    } else if (isShared) {
      sections.push({
        title: "Where",
        items: [
          { label: `shared ${owner}`, href: `/dashboard/library?kind=${owner}${rest}`, meta: "shelf" },
          { label: "Open in the shelf editor", href: `/dashboard/library/edit?kind=${owner}&path=${encodeURIComponent(relative)}${rest}` },
        ],
      });
    } else {
      sections.push({ title: "Where", items: [{ label: "account root", meta: sealed ? "sealed" : "read-only here", tone: "muted" }] });
    }
  }
  sections.push({
    title: "This tree",
    items: [
      { label: "library/", href: `/dashboard/library${qs}`, meta: "the shared shelf" },
      { label: "workspaces/", href: `/dashboard${qs}`, meta: `${workspaces.length}` },
    ],
  });

  const viewer =
    !selected ? undefined
    : sealed ? (
      <Card className="p-6">
        <p className="font-mono text-sm text-fg">{selected}</p>
        <p className="mt-2 text-sm text-fg-tertiary">This file is on disk and listed here, but its contents are not served: {sealed}</p>
      </Card>
    )
    : content !== null && !editable ? <CodeView path={selected} text={content} />
    : undefined;

  return (
    <EditorShell
      tenant={tenant}
      {...(editable && isWorkspaceFile ? { workspace: owner } : {})}
      {...(editable && isShared ? { libraryKind: owner } : {})}
      files={files}
      selected={editable ? relative : selected}
      linkBase="/dashboard/library/files"
      linkSuffix={rest}
      rootName={tenant}
      treeReadOnly
      content={editable ? content : null}
      viewer={viewer}
      crumbs={[{ label: tenant, href: `/dashboard${qs}` }, ...(selected ? crumbs(selected).map((c, i, arr) => (i < arr.length - 1 ? { label: c.label, href: `/dashboard/library/files?path=${encodeURIComponent(c.prefix)}${rest}` } : { label: c.label })) : [])]}
      chips={[]}
      kindLabel={sealed ? "sealed" : editable ? kind : /\.jsonl?$/i.test(selected ?? "") ? "record" : "file"}
      issues={[]}
      lastChange={null}
      sections={sections}
      now={now}
      treeFooter={
        <>
          {files.length} files, as they sit on disk minus the platform&apos;s own bookkeeping. Add or remove under{" "}
          <Link href={`/dashboard/library${qs}`} className="underline hover:text-fg-tertiary">each shelf</Link> or in a workspace.
        </>
      }
      emptyEditor={<EmptyScreen title="Nothing here yet" description="Create a workspace, or add a shared tool or skill that every workspace can use." />}
    />
  );
}
