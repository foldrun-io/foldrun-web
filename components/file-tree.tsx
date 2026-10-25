"use client";

// VS Code-style file explorer: collapsible folders, chevrons, indent guides,
// and inline creation — hover a folder to add a file or subfolder inside it.
//
// Client-side because expansion and creation are interactive state; it takes a
// link *template* rather than a function (functions can't cross the server
// component boundary).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useConfirm } from "@/components/confirm";
import { matchesQuery } from "@/components/list-search-model";

interface TreeNode {
  name: string;
  /** Full path from the workspace root — unique, so it doubles as the React key
   *  and the expansion-state key. Folder names alone collide: every agent has
   *  its own skills/ and memory/ folder at the same depth. */
  id: string;
  path?: string; // set on files only
  children: Map<string, TreeNode>;
}

function buildTree(files: string[], pendingFolders: string[]): TreeNode {
  const root: TreeNode = { name: "", id: "", children: new Map() };
  const add = (parts: string[], filePath?: string) => {
    let node = root;
    parts.forEach((part, i) => {
      const id = parts.slice(0, i + 1).join("/");
      let next = node.children.get(part);
      if (!next) {
        next = { name: part, id, children: new Map() };
        node.children.set(part, next);
      }
      if (filePath && i === parts.length - 1) next.path = filePath;
      node = next;
    });
  };
  for (const file of files) add(file.split("/"), file);
  // Folders created in the UI but not yet holding a file. A directory only
  // exists on disk once something is in it, so these live in client state
  // until the first file lands — the same way git treats empty directories.
  for (const folder of pendingFolders) add(folder.split("/"));
  return root;
}

const isFolder = (n: TreeNode) => n.children.size > 0 || n.path === undefined;

const sortNodes = (nodes: Map<string, TreeNode>) =>
  [...nodes.values()].sort(
    (a, b) => Number(isFolder(b)) - Number(isFolder(a)) || a.name.localeCompare(b.name),
  );

// A new file's starting content, chosen from where it was created.
function templateFor(rel: string): string {
  const base = rel.split("/").pop()!.replace(/\.[^.]+$/, "");
  if (/\/skills\/[^/]+\/SKILL\.md$/.test(rel)) {
    return `---\nname: ${rel.split("/").slice(-2)[0]}\ndescription: What this skill does, and when to use it.\n---\n\n# ${base}\n\nStep-by-step instructions.\n`;
  }
  if (/\/memory\/MEMORY\.md$/.test(rel)) return `# Memory index\n\n- [Title](file.md) — one-line hook\n`;
  // memory/ and knowledge/ are OKF bundles — `type` is the spec's one
  // required field, so a file created here is conformant from birth.
  if (/\/memory\//.test(rel)) {
    return `---\ntype: Fact\nname: ${base}\ndescription: One durable fact.\nstatus: stable\n---\n\nThe fact.\n\n**Why:** what made it worth remembering.\n`;
  }
  if (/\/knowledge\//.test(rel)) {
    return `---\ntype: Reference\nname: ${base}\ndescription: Reference material agents look up. Given, not learned.\nstatus: stable\n---\n\nThe reference content. Agents read this and never rewrite it.\n`;
  }
  if (rel.startsWith("evals/")) {
    return `---\nname: ${base}\nagent: agent-name\nmodel: fast\n---\n\n## it does the thing\ntask: Ask it to do the thing.\nexpect:\n  - contains: text the answer must include\n  - judge: the answer actually does what was asked\n`;
  }
  if (rel.startsWith("tools/")) {
    return `---\nname: ${base}\ntype: http\nbase: https://api.example.com/v1\ndescription: What this API is for, and when to call it.\nmethods: [GET]\n---\n\nAgents grant it with tools: [${base}]\n`;
  }
  if (/agent\.md$/.test(rel)) {
    return `---\nname: ${rel.split("/")[1] ?? base}\ndescription: What this agent does.\nmodel: default\ntools:\n  - files\n---\n\nInstructions for this agent.\n`;
  }
  if (rel.startsWith("flows/")) {
    return `---\nname: ${base}\ntrigger: manual\n---\n\n1. [[agent-name]] — describe this step\n`;
  }
  if (/scripts\//.test(rel)) {
    return `#!/usr/bin/env python3\n"""${base}"""\nimport argparse\n\np = argparse.ArgumentParser()\nargs = p.parse_args()\n`;
  }
  return `---\nname: ${base}\n---\n`;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-fg-subtle"
    >
      {open ? <path d="m6 9 6 6 6-6" /> : <path d="m9 18 6-6-6-6" />}
    </svg>
  );
}

function NewFileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" /><path d="M12 18v-6" /><path d="M9 15h6" />
    </svg>
  );
}

function RenameIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function NewFolderIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V6a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v3" />
      <path d="M4 19h9" /><path d="M18 15v6" /><path d="M15 18h6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

// Why a file may not move or die, in the same sentences the server uses
// (store.ts#anchoredReason — that one is authoritative; this mirror exists
// because a client component cannot import a module that reads disk).
// Location is meaning in this format, and the refusal must say so: a drag
// that silently fails to start teaches nothing, a named reason teaches the
// format.
function anchoredWhy(rel: string): string | null {
  const base = rel.split("/").pop()!;
  if (rel === "AGENTS.md" || rel === "project.md") {
    return `${base} is the workspace's own identity — it cannot move; rename or delete the workspace instead`;
  }
  if (base === "agent.md") return "agent.md is the agent because of where it sits — to rename the agent, rename its folder";
  if (base === "SKILL.md") return "SKILL.md names its skill — to rename the skill, rename its folder";
  if (base === "tool.md") return "tool.md names its tool — to rename the tool, rename its folder";
  if (/(^|\/)(knowledge|memory)\/(.*\/)?(index|log)\.md$/.test(rel)) {
    return `${base} is generated from the files around it — it is rebuilt in place on the next write`;
  }
  return null;
}
const deleteWhy = (rel: string): string | null => {
  const why = anchoredWhy(rel);
  if (!why) return null;
  const base = rel.split("/").pop()!;
  if (/^(agent|SKILL|tool)\.md$/.test(base)) {
    return `${base} is its folder's identity — delete the whole folder instead`;
  }
  return why;
};
// Folder units the server knows how to delete whole.
const deletableFolder = (id: string) =>
  /^agents\/[a-z0-9-]+$/.test(id) ||
  /^(skills|tools)\/[a-z0-9-]+$/.test(id) ||
  /^agents\/[a-z0-9-]+\/skills\/[a-z0-9-]+$/.test(id);

type Draft = { parent: string; kind: "file" | "folder" } | null;

function Node({
  node, depth, expanded, toggle, selected, hrefFor, draft, setDraft, create, error,
  renaming, setRenaming, rename, canEdit, move, remove, onAnchored, dropTarget, setDropTarget,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  selected?: string;
  hrefFor: (path: string) => string;
  draft: Draft;
  setDraft: (d: Draft) => void;
  create: (parent: string, name: string, kind: "file" | "folder") => void;
  error: string | null;
  /** The file path currently being renamed inline, if any. */
  renaming: string | null;
  setRenaming: (p: string | null) => void;
  rename: (from: string, newName: string) => void;
  canEdit: boolean;
  move: (from: string, toFolder: string) => void;
  remove: (rel: string, folder: boolean) => void;
  /** A refused gesture reports its reason here — shown on the tree's error line. */
  onAnchored: (why: string) => void;
  dropTarget: string | null;
  setDropTarget: (id: string | null) => void;
}) {
  const folder = isFolder(node);
  const open = expanded.has(node.id);
  const active = node.path !== undefined && node.path === selected;
  const indent = depth * 14;

  if (!folder) {
    if (renaming === node.path) {
      return (
        <RenameRow
          depth={depth}
          initial={node.name}
          error={error}
          onCancel={() => setRenaming(null)}
          onSubmit={(name) => rename(node.path!, name)}
        />
      );
    }
    return (
      <span
        className="group/file flex items-center"
        draggable={canEdit}
        onDragStart={(e) => {
          // The refusal happens where the gesture starts, with the reason —
          // an undraggable row that just doesn't respond reads as a bug.
          const why = anchoredWhy(node.path!);
          if (why) {
            e.preventDefault();
            onAnchored(why);
            return;
          }
          e.dataTransfer.setData("text/foldrun-path", node.path!);
          e.dataTransfer.effectAllowed = "move";
        }}
      >
        <Link
          href={hrefFor(node.path!)}
          style={{ paddingLeft: indent + 6 }}
          title={node.path}
          className={`flex min-w-0 flex-1 items-center gap-1 rounded py-[3px] pr-2 font-mono text-xs leading-6 transition-colors ${
            active ? "bg-ink text-on-ink" : "text-fg-tertiary hover:bg-muted hover:text-fg"
          }`}
        >
          <span className="w-3.5 shrink-0" />
          <span className="truncate">{node.name}</span>
        </Link>
        {canEdit && (
          <button
            type="button"
            title={anchoredWhy(node.path!) ?? "Rename"}
            onClick={() => {
              const why = anchoredWhy(node.path!);
              if (why) return onAnchored(why);
              setRenaming(node.path!);
            }}
            className={`mr-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover/file:opacity-100 ${
              active ? "text-gray-300 hover:text-white" : "text-fg-subtle hover:bg-muted-strong hover:text-fg"
            }`}
          >
            <RenameIcon />
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            title={deleteWhy(node.path!) ?? "Delete"}
            onClick={() => {
              const why = deleteWhy(node.path!);
              if (why) return onAnchored(why);
              remove(node.path!, false);
            }}
            className={`mr-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover/file:opacity-100 ${
              active ? "text-gray-300 hover:text-white" : "text-fg-subtle hover:bg-muted-strong hover:text-red-600"
            }`}
          >
            <TrashIcon />
          </button>
        )}
      </span>
    );
  }

  return (
    <>
      <div
        style={{ paddingLeft: indent + 6 }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("text/foldrun-path")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropTarget(node.id);
        }}
        onDragLeave={() => dropTarget === node.id && setDropTarget(null)}
        onDrop={(e) => {
          const from = e.dataTransfer.getData("text/foldrun-path");
          setDropTarget(null);
          if (from) move(from, node.id);
        }}
        className={`group flex items-center gap-1 rounded py-[3px] pr-1 font-mono text-xs leading-6 text-fg-tertiary hover:bg-muted ${
          dropTarget === node.id ? "bg-muted-strong/80 ring-1 ring-inset ring-gray-400" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => toggle(node.id)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left hover:text-fg"
        >
          <Chevron open={open} />
          <span className="truncate font-medium text-gray-800">{node.name}<span className="text-gray-300">/</span></span>
        </button>
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            title="New file"
            onClick={() => {
              if (!open) toggle(node.id);
              setDraft({ parent: node.id, kind: "file" });
            }}
            className="rounded p-0.5 text-fg-subtle hover:bg-muted-strong hover:text-fg"
          >
            <NewFileIcon />
          </button>
          <button
            type="button"
            title="New folder"
            onClick={() => {
              if (!open) toggle(node.id);
              setDraft({ parent: node.id, kind: "folder" });
            }}
            className="rounded p-0.5 text-fg-subtle hover:bg-muted-strong hover:text-fg"
          >
            <NewFolderIcon />
          </button>
          {canEdit && deletableFolder(node.id) && (
            <button
              type="button"
              title="Delete this and everything in it"
              onClick={() => remove(node.id, true)}
              className="rounded p-0.5 text-fg-subtle hover:bg-muted-strong hover:text-red-600"
            >
              <TrashIcon />
            </button>
          )}
        </span>
      </div>

      {open && (
        <div className="relative">
          <span
            aria-hidden
            className="absolute inset-y-0 border-l border-line/80"
            style={{ left: indent + 13 }}
          />
          <div>
            {draft?.parent === node.id && (
              <DraftRow
                depth={depth + 1}
                kind={draft.kind}
                error={error}
                onCancel={() => setDraft(null)}
                onSubmit={(name) => create(node.id, name, draft.kind)}
              />
            )}
            {sortNodes(node.children).map((child) => (
              <Node
                key={child.id}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                toggle={toggle}
                selected={selected}
                hrefFor={hrefFor}
                draft={draft}
                setDraft={setDraft}
                create={create}
                error={error}
                renaming={renaming}
                setRenaming={setRenaming}
                rename={rename}
                canEdit={canEdit}
                move={move}
                remove={remove}
                onAnchored={onAnchored}
                dropTarget={dropTarget}
                setDropTarget={setDropTarget}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function DraftRow({
  depth, kind, error, onSubmit, onCancel,
}: {
  depth: number;
  kind: "file" | "folder";
  error: string | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <div style={{ paddingLeft: depth * 14 + 6 }} className="py-[3px] pr-2">
      <div className="flex items-center gap-1">
        <span className="w-3.5 shrink-0" />
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => (name.trim() ? onSubmit(name.trim()) : onCancel())}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onSubmit(name.trim());
            if (e.key === "Escape") onCancel();
          }}
          placeholder={kind === "folder" ? "folder-name" : "file.md"}
          className="w-full min-w-0 rounded border border-line-strong bg-surface px-1 py-0.5 font-mono text-xs text-fg focus:border-gray-500 focus:outline-none"
        />
      </div>
      {error && <p className="mt-1 pl-7 text-[11px] leading-tight text-red-600">{error}</p>}
    </div>
  );
}

function RenameRow({
  depth, initial, error, onSubmit, onCancel,
}: {
  depth: number;
  initial: string;
  error: string | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <div style={{ paddingLeft: depth * 14 + 6 }} className="py-[3px] pr-2">
      <div className="flex items-center gap-1">
        <span className="w-3.5 shrink-0" />
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => {
            // Select the stem, keep the extension — the part people rename.
            const dot = e.target.value.lastIndexOf(".");
            e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
          }}
          onBlur={() => (name.trim() && name.trim() !== initial ? onSubmit(name.trim()) : onCancel())}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onSubmit(name.trim());
            if (e.key === "Escape") onCancel();
          }}
          className="w-full min-w-0 rounded border border-line-strong bg-surface px-1 py-0.5 font-mono text-xs text-fg focus:border-gray-500 focus:outline-none"
        />
      </div>
      {error && <p className="mt-1 pl-7 text-[11px] leading-tight text-red-600">{error}</p>}
    </div>
  );
}

export function FileTree({
  files,
  selected,
  linkBase,
  linkSuffix = "",
  linkStyle = "path",
  rootName,
  readOnly = false,
  workspace,
  tenant,
  filter = "",
}: {
  files: string[];
  /** Narrow the tree to paths matching this; every folder left is open. */
  filter?: string;
  selected?: string;
  /** e.g. "/dashboard/vaza/edit" — the path query is appended. */
  linkBase: string;
  /**
   * How to build a link. "library" treats the first path segment as the kind,
   * because the account library is edited through a different route.
   * A string, not a callback: functions can't cross the server/client boundary.
   */
  linkStyle?: "path" | "library";
  /** The folder everything below sits in — shown as the tree's root. */
  rootName?: string;
  /** Hide the create affordances: some trees are a view, not a workspace. */
  readOnly?: boolean;
  /** e.g. "&tenant=acme" */
  linkSuffix?: string;
  /** Set to enable creating files and folders. */
  workspace?: string;
  tenant?: string;
}) {
  const router = useRouter();
  const [pendingFolders, setPendingFolders] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const narrowed = useMemo(() => (filter.trim() ? files.filter((f) => matchesQuery(f, filter)) : files), [files, filter]);
  const root = useMemo(() => buildTree(narrowed, filter.trim() ? [] : pendingFolders), [narrowed, pendingFolders, filter]);

  // Collapsed by default. Every top-level folder used to open on mount, which
  // put the whole workspace on screen at once — nine directories of agents,
  // flows, evals, skills, memory, knowledge, tools, scripts and state — and
  // buried the one file you came for. A tree is for choosing where to look.
  //
  // The exception is the file already open: collapsing its ancestors would
  // hide what the page is showing, so the path down to it stays expanded.
  const initial = useMemo(() => {
    const open = new Set<string>();
    if (selected) {
      const parts = selected.split("/");
      for (let i = 1; i < parts.length; i++) open.add(parts.slice(0, i).join("/"));
    }
    return open;
  }, [selected]);

  const [expanded, setExpanded] = useState<Set<string>>(initial);
  // A filtered tree is a set of answers, not a place to browse: every folder
  // it still contains is open, so the matches are on screen.
  const shown = useMemo(() => {
    if (!filter.trim()) return expanded;
    const all = new Set<string>();
    for (const f of narrowed) {
      const parts = f.split("/");
      for (let i = 1; i < parts.length; i++) all.add(parts.slice(0, i).join("/"));
    }
    return all;
  }, [filter, narrowed, expanded]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const create = async (parent: string, name: string, kind: "file" | "folder") => {
    setError(null);
    const rel = parent ? `${parent}/${name}` : name;

    if (kind === "folder") {
      // Nothing to persist yet — a folder appears once it holds a file.
      setPendingFolders((prev) => [...new Set([...prev, rel])]);
      setExpanded((prev) => new Set(prev).add(rel));
      setDraft({ parent: rel, kind: "file" });
      return;
    }

    const res = await fetch(`/api/workspaces/${workspace}/source`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant ?? "default" },
      body: JSON.stringify({ path: rel, content: templateFor(rel) }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `could not create ${rel}`);
      return;
    }
    setDraft(null);
    setPendingFolders((prev) => prev.filter((f) => !rel.startsWith(`${f}/`)));
    router.push(`${linkBase}?path=${encodeURIComponent(rel)}${linkSuffix}`);
    router.refresh();
  };

  const [confirm, confirmDialog] = useConfirm();
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // A drop is a move: same file, new folder. The server holds the real
  // rules (an agent.md cannot leave agents/, kinds have extensions) — the
  // tree already refused the drags that can never work, and whatever else
  // the server refuses surfaces as the tree's error line.
  const move = async (from: string, toFolder: string) => {
    setError(null);
    const to = `${toFolder}/${from.split("/").pop()}`;
    if (to === from || from === toFolder || toFolder.startsWith(`${from}/`)) return;
    const res = await fetch(`/api/workspaces/${workspace}/source`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant ?? "default" },
      body: JSON.stringify({ from, to }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `could not move ${from}`);
      return;
    }
    if (selected === from) router.push(`${linkBase}?path=${encodeURIComponent(to)}${linkSuffix}`);
    router.refresh();
  };

  const remove = async (rel: string, folder: boolean) => {
    setError(null);
    if (
      !(await confirm({
        title: `Delete ${rel}?`,
        body: folder
          ? "Everything inside it is deleted with it."
          : "Runs and agents that expect this file stop finding it.",
        confirmLabel: "Delete",
      }))
    )
      return;
    const res = await fetch(`/api/workspaces/${workspace}/source`, {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant ?? "default" },
      body: JSON.stringify({ path: rel }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `could not delete ${rel}`);
      return;
    }
    if (selected === rel || selected?.startsWith(`${rel}/`)) {
      router.push(`${linkBase}${linkSuffix ? `?${linkSuffix.slice(1)}` : ""}`);
    }
    router.refresh();
  };

  const rename = async (from: string, newName: string) => {
    setError(null);
    // The input edits the basename; the file stays in its folder. Moving
    // between folders is a different intention with different consequences
    // (an agent.md leaving agents/ is not a rename), so it is not this.
    const to = [...from.split("/").slice(0, -1), newName].join("/");
    if (to === from) {
      setRenaming(null);
      return;
    }
    const res = await fetch(`/api/workspaces/${workspace}/source`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant ?? "default" },
      body: JSON.stringify({ from, to }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `could not rename ${from}`);
      return;
    }
    setRenaming(null);
    // If the renamed file is the one open, follow it to its new name.
    if (selected === from) router.push(`${linkBase}?path=${encodeURIComponent(to)}${linkSuffix}`);
    router.refresh();
  };

  const hrefFor = (rel: string) => {
    if (linkStyle === "library") {
      const [kind, ...rest] = rel.split("/");
      return `${linkBase}?kind=${kind}&path=${encodeURIComponent(rest.join("/"))}${linkSuffix}`;
    }
    return `${linkBase}?path=${encodeURIComponent(rel)}${linkSuffix}`;
  };
  const canCreate = Boolean(workspace) && !readOnly;

  return (
    <div className="select-none py-0.5">
      <div className="mb-1 flex items-center justify-between gap-2 border-b border-b-gray-200/70 px-1.5 pb-1.5">
          <span className="flex min-w-0 items-baseline gap-1 font-mono text-xs">
            <span className="truncate font-semibold text-fg">{rootName ?? "files"}</span>
            <span className="text-gray-300">/</span>
          </span>
          {canCreate && (
          <span className="flex items-center gap-0.5">
            <button
              type="button"
              title="New file at workspace root"
              onClick={() => setDraft({ parent: "", kind: "file" })}
              className="rounded p-0.5 text-fg-subtle hover:bg-muted hover:text-fg"
            >
              <NewFileIcon />
            </button>
            <button
              type="button"
              title="New folder at workspace root"
              onClick={() => setDraft({ parent: "", kind: "folder" })}
              className="rounded p-0.5 text-fg-subtle hover:bg-muted hover:text-fg"
            >
              <NewFolderIcon />
            </button>
          </span>
          )}
        </div>

      {draft?.parent === "" && (
        <DraftRow
          depth={0}
          kind={draft.kind}
          error={error}
          onCancel={() => setDraft(null)}
          onSubmit={(name) => create("", name, draft.kind)}
        />
      )}

      {sortNodes(root.children).map((node) => (
        <Node
          key={node.id}
          node={node}
          depth={0}
          expanded={shown}
          toggle={toggle}
          selected={selected}
          hrefFor={hrefFor}
          draft={canCreate ? draft : null}
          setDraft={setDraft}
          create={create}
          error={error}
          renaming={renaming}
          setRenaming={setRenaming}
          rename={rename}
          canEdit={canCreate}
          move={move}
          remove={remove}
          onAnchored={setError}
          dropTarget={dropTarget}
          setDropTarget={setDropTarget}
        />
      ))}
      {confirmDialog}
    </div>
  );
}
