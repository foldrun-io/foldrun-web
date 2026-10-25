"use client";

// Create a new file (skill, memory, flow) from the editor sidebar.
// e.g. agents/writer/skills/tone.md · agents/writer/memory/style.md · flows/nightly.md

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, inputClass, dashedButtonClass } from "@/components/ui";
import { KINDS } from "@/lib/kinds";

// A path decides a document's kind, so a new file at that path starts as that
// kind. This was a fourth hand-written copy of the templates and had drifted
// exactly as a copy does: its memory/ branch still wrote the pre-OKF shape —
// `name:` and `description:`, no `type:` — so a memory created here was
// non-conformant the moment it existed, and knowledge/ had no branch at all
// and fell through to a bare `name:`. KINDS is the table every other creation
// path reads; this one reads it too now.
const TEMPLATE = (rel: string) => {
  const base = rel.split("/").pop()!.replace(/\.md$/, "");
  // The innermost directory wins, which is just "a document's kind is its
  // path" applied to a nested one: `agents/x/memory/y.md` is a memory, not an
  // agent. Derived from KINDS rather than listed here — a second copy of the
  // kind names is the thing this whole table exists to prevent.
  const kind = (Object.keys(KINDS) as (keyof typeof KINDS)[])
    .filter((k) => new RegExp(`(^|/)${k}/`).test(rel))
    .sort((a, b) => rel.lastIndexOf(`${b}/`) - rel.lastIndexOf(`${a}/`))[0];

  if (!kind) {
    // Outside every kind — state/, outputs/ and anything else. No frontmatter
    // to guess at, so don't invent one.
    return "";
  }
  return KINDS[kind].template(base, { firstAgent: "my-agent" });
};

// `scope`: the editor is narrowed to one folder (Knowledge, Memory, Skills),
// so the new file starts in it and the page stays narrowed after — a file
// made at the root would vanish from the tree the moment it was created.
export function NewFile({ workspace, tenant, scope }: { workspace: string; tenant: string; scope?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState(scope ? `${scope}/` : "");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={dashedButtonClass("mt-2")}
      >
        + New file
      </button>
    );
  }

  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const rel = path.endsWith(".md") ? path : `${path}.md`;
        const res = await fetch(`/api/workspaces/${workspace}/source`, {
          method: "PUT",
          headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
          body: JSON.stringify({ path: rel, content: TEMPLATE(rel) }),
        });
        if (res.ok) {
          setOpen(false);
          setPath(scope ? `${scope}/` : "");
          router.push(
            `/dashboard/${workspace}/edit?path=${encodeURIComponent(rel)}${tenant !== "default" ? `&tenant=${tenant}` : ""}${scope ? `&scope=${scope}` : ""}`,
          );
          router.refresh();
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? `failed (${res.status})`);
        }
      }}
    >
      <input
        autoFocus
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder={scope === "skills" ? "skills/<name>/SKILL.md" : scope ? `${scope}/<name>.md` : "agents/writer/skills/tone.md"}
        className={inputClass("font-mono")}
      />
      <div className="flex items-center gap-2">
        <button className={buttonClass("primary")}>Create</button>
        <button type="button" onClick={() => setOpen(false)} className={buttonClass("minimal")}>
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
