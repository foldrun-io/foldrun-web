"use client";

// A listing row that opens into an editor in place. Clicking a memory, skill
// or tool shouldn't send you to a different page — the list is the context
// you want while editing (what else exists, at what scope), so the editor
// expands underneath the row instead of replacing the view.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExpandableTitle } from "@/components/expandable";
import { ToolTest } from "@/components/tool-test";
import { InlineEditor } from "@/components/inline-editor";
import { useConfirm } from "@/components/confirm";
import { buttonClass } from "@/components/ui";

// Shared by every listing that edits a markdown file in place — assets,
// agents, flows. Expanding a row beats navigating away: the list around it is
// the context you want while editing (what else exists, at what scope).
export function AssetRow({
  search,
  workspace,
  tenant,
  path,
  name,
  description,
  extra,
  kind,
  account = false,
  transport,
  files,
  scriptArgs,
  onDeleted,
}: {
  /** What the list's search box matches this row on. */
  search?: string;
  workspace: string;
  tenant: string;
  path: string;
  name: string;
  description: string;
  extra?: React.ReactNode;
  /** Enables "Move to shared" — omit where promotion doesn't apply. */
  kind?: "skills" | "memory" | "knowledge" | "tools" | "hooks" | "scripts";
  /** An account-library entry: read and written through the library API, and
   *  shared by every workspace — so edits here affect more than this one. */
  account?: boolean;
  /** For tools: how it connects, so the test can offer a path box for http. */
  transport?: "http" | "script" | "mcp";
  /** A folder tool's files. One row edits all of them. */
  files?: string[];
  /** For script tools: declared `args:`, rendered as inputs by the test. */
  scriptArgs?: string[];
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  // Account entries live in a different store; everything below routes through
  // these two so the row itself doesn't care which scope it is.
  const readUrl = account
    ? `/api/library/${kind}?path=${encodeURIComponent(path)}`
    : `/api/workspaces/${workspace}/source?path=${encodeURIComponent(path)}`;
  const writeUrl = account ? `/api/library/${kind}` : `/api/workspaces/${workspace}/source`;

  const [open, setOpen] = useState(false);
  // Which file of a folder tool is being edited. The definition first,
  // because that is what the tool *is*.
  const [editing, setEditing] = useState<string | null>(null);
  // Whether the open editor holds unsaved text — the Test button needs to
  // know, because it runs the file on disk and not the text on screen.
  const [dirty, setDirty] = useState(false);
  // "+ Add file" inside a folder tool: a helper module, a requirements file.
  // The platform always allowed a second file in the folder; the file tree's
  // "+ New file" forced .md, so there was no door.
  const [adding, setAdding] = useState(false);
  const [newFile, setNewFile] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // The folder a tool lives in, for adding to it: `tools/x/tool.md` → `tools/x`.
  const folder = files?.length ? path.slice(0, path.lastIndexOf("/")) : null;
  const addFile = async () => {
    const base = newFile.trim();
    if (!folder || !base) return;
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*\.[a-z0-9]+$/.test(base)) {
      setAddError("a file name with an extension, e.g. helpers.py");
      return;
    }
    const rel = `${folder}/${base}`;
    if (files?.includes(rel)) {
      setAddError("that file already exists");
      return;
    }
    setAddError(null);
    // The library API keys files by path within the kind; the workspace API
    // by path within the workspace. `path` already carries the right form.
    const res = await fetch(writeUrl, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      body: JSON.stringify({ path: rel, content: "" }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setAddError(data.error ?? `failed (${res.status})`);
      return;
    }
    setAdding(false);
    setNewFile("");
    setEditing(rel);
    router.refresh();
  };
  // What the move is doing, or why it stopped. Rendered outside the hover-only
  // action bar: a failure the user can only see while the pointer is still on
  // the row is not much better than no failure at all.
  const [status, setStatus] = useState<{ text: string; failed?: boolean } | null>(null);
  const moving = status !== null && !status.failed;

  // Promote to the account scope. Without this, "this turned out to be useful
  // everywhere" means copying the file by hand and deleting the original.
  const promote = async () => {
    if (!kind) return;
    if (!(await confirm({
      title: `Move ${name} to shared?`,
      body: "Every workspace in this account will be able to use it.",
      confirmLabel: "Move",
      destructive: false,
    }))) return;
    setStatus({ text: "moving…" });
    try {
      const body = await loadContent();
      // A standard skill is a folder; the library keeps the same shape.
      const rel = path.endsWith("/SKILL.md")
        ? `${path.split("/").at(-2)}/SKILL.md`
        : path.split("/").pop()!;
      const put = await fetch(`/api/library/${kind}`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify({ path: rel, content: body }),
      });
      if (!put.ok) {
        const data = await put.json().catch(() => ({}));
        throw new Error(data.error ?? `${put.status}`);
      }
      // Only remove the original once the copy is safely written.
      const target = path.endsWith("/SKILL.md") ? path.replace(/\/SKILL\.md$/, "") : path;
      const del = await fetch(`/api/workspaces/${workspace}/source`, {
        method: "DELETE",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify({ path: target }),
      });
      // The copy is already in the library at this point, so a failure here
      // leaves the file in both scopes rather than losing it — say so, because
      // silence would read as a clean move and the duplicate would be found
      // later by whoever edits the wrong one.
      if (!del.ok) {
        const data = await del.json().catch(() => ({}));
        throw new Error(
          `copied to shared, but the original could not be removed — ${data.error ?? del.status}`,
        );
      }
      setStatus(null);
      onDeleted?.();
      router.refresh();
    } catch (err) {
      setStatus({
        text: err instanceof Error ? `could not move — ${err.message}` : "could not move",
        failed: true,
      });
    }
  };

  const loadContent = async () => {
    const res = await fetch(readUrl, { headers: { "x-foldrun-tenant": tenant } });
    const data = await res.json();
    return (data.content ?? "") as string;
  };

  const remove = async () => {
    const where = account ? " from every workspace in this account" : "";
    if (!(await confirm({ title: `Delete ${name}${where}?`, confirmLabel: "Delete" }))) return;
    // A folder is the unit — a skill's, and a folder tool's. Sending tool.md
    // alone was refused by the store ("delete the whole folder instead"), so
    // the row's Delete button on every folder tool failed with that message.
    const target = path.replace(/\/(SKILL|tool)\.md$/, "");
    await fetch(writeUrl, {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      body: JSON.stringify({ path: target }),
    });
    onDeleted?.();
    router.refresh();
  };

  return (
    <li className="group" data-search={search}>
      {confirmDialog}
      <div className="flex items-center gap-4 px-5 py-3">
        <ExpandableTitle
          open={open}
          onToggle={() => setOpen((o) => !o)}
          name={name}
          badges={extra}
          subtitle={description || "No description"}
          meta={path}
        />

        {status && (
          <span
            role="status"
            aria-live="polite"
            className={`shrink-0 text-xs font-medium ${status.failed ? "text-red-600" : "text-fg-subtle"}`}
          >
            {status.text}
          </span>
        )}

        <span className="flex shrink-0 items-center gap-3 opacity-0 transition-opacity group-hover:opacity-100">
          <Link
            href={
              account
                ? `/dashboard/library/edit?kind=${kind}&path=${encodeURIComponent(path)}${tenant !== "default" ? `&tenant=${tenant}` : ""}`
                : `/dashboard/${workspace}/edit?path=${encodeURIComponent(path)}${tenant !== "default" ? `&tenant=${tenant}` : ""}`
            }
            className="text-xs font-medium text-fg-subtle hover:text-fg"
            title="Open in the file editor"
          >
            Open
          </Link>
          {/* Not a hook: promote copies one file, and a hook is a folder whose
              run.mjs would be deleted with it. `foldrun hook add --library`. */}
          {kind && kind !== "hooks" && !account && (
            <button
              onClick={promote}
              disabled={moving}
              title="Move to the shared library, usable by every workspace"
              className="text-xs font-medium text-fg-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
            >
              Move to shared
            </button>
          )}
          <button
            onClick={remove}
            className="text-xs font-medium text-fg-subtle transition-colors hover:text-red-600"
          >
            Delete
          </button>
        </span>
      </div>

      {open && (
        <div className="space-y-4 border-t border-line-faint bg-sunken/60 px-5 py-4">
          {/* A tool is one thing with two files, so one row edits all of it —
              the files as tabs, the definition first because it is what the
              tool *is*. The editor comes before the test: when you are
              writing, the loop is edit → test → read the output → edit, and
              the panel you read should sit under the text you change, not
              above it. */}
          {files && files.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {files.map((f) => {
                // Relative to the folder the tool lives in. The frontmatter
                // name is not the folder name (page_check sits in
                // page-check/), and slicing by it produced "check/tool.md".
                const label = folder && f.startsWith(`${folder}/`) ? f.slice(folder.length + 1) : f;
                const on = (editing ?? files[0]) === f;
                return (
                  <button
                    key={f}
                    onClick={() => setEditing(f)}
                    className={`rounded-md px-2 py-0.5 font-mono text-[11px] transition-colors ${
                      on
                        ? "bg-ink text-on-ink"
                        : "text-fg-muted ring-1 ring-inset ring-line hover:bg-surface"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
              {folder && !adding && (
                <button
                  onClick={() => setAdding(true)}
                  className="rounded-md px-2 py-0.5 font-mono text-[11px] text-fg-subtle hover:text-fg"
                  title="Add another file to this tool's folder — a helper module, a requirements file"
                >
                  + Add file
                </button>
              )}
              {adding && (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void addFile();
                  }}
                >
                  {/* Same box as the chips beside it: a full-height input and
                      button on a row of 22px tabs read as a different control
                      that wandered in. */}
                  <input
                    autoFocus
                    value={newFile}
                    onChange={(e) => setNewFile(e.target.value)}
                    placeholder="helpers.py"
                    spellCheck={false}
                    className="h-[22px] w-32 rounded-md border border-line-strong bg-surface px-2 font-mono text-[11px] leading-none focus:border-gray-900 focus:outline-none"
                  />
                  <button className={buttonClass("primary", "!h-[22px] !py-0 px-2 text-[11px] leading-none")}>Add</button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setAddError(null);
                    }}
                    className="h-[22px] px-1.5 text-[11px] leading-none text-fg-subtle hover:text-fg"
                  >
                    Cancel
                  </button>
                  {addError && <span className="text-[11px] text-red-600">{addError}</span>}
                </form>
              )}
            </div>
          )}
          {/* No key on the path: keeping one editor mounted across a folder
              tool's tabs is what lets it cache each file and switch without a
              refetch, a loading box, or the panels below jumping. */}
          <InlineEditor
            workspace={workspace}
            tenant={tenant}
            path={files?.length ? (editing ?? files[0]) : path}
            libraryKind={account ? kind : undefined}
            onDirtyChange={setDirty}
            hideSibling={Boolean(files && files.length > 1)}
          />
          {/* Tools are the one kind you can be wrong about silently, so the
              check sits with the code rather than somewhere else — and it
              knows when the code on screen is not the code on disk. */}
          {kind === "tools" && account && (
            // A test runs from an agent's folder in a workspace — secrets,
            // state and paths all resolve there. The library has none of
            // that, so say where to go rather than run it from nowhere.
            <p className="border-t border-line pt-3 text-xs text-fg-subtle">
              Test it from a workspace that grants it — a run stands in that workspace, not here.
            </p>
          )}
          {kind === "tools" && !account && (
            <div className="border-t border-line pt-4">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">Try it</p>
              <ToolTest
                workspace={workspace}
                tenant={tenant}
                tool={name}
                transport={transport ?? null}
                scriptArgs={scriptArgs ?? []}
                stale={dirty}
              />
            </div>
          )}
        </div>
      )}
    </li>
  );
}
