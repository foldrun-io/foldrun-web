// The account library, in the editor shell: every shared shelf as one tree,
// the file open with its header, and a panel that says which workspaces
// and agents use it and which secrets it names. The library keeps history
// too, but has no route for it yet, so the Changes section waits.

import Link from "next/link";
import { notFound } from "next/navigation";
import matter from "@/lib/matter";
import { LIBRARY_KINDS, listLibrary, readLibraryFile, libraryUsage, type LibraryKind } from "@/lib/library";
import { listSecrets } from "@/lib/secrets";
import { EditorShell, type ContextSection } from "@/components/editor-shell";
import { kindOf, chipsFor, secretRefs, DOC_FOR, type FileKind } from "@/components/editor-context-model";
import { nowMs } from "@/components/overview-model";
import { EmptyScreen } from "@/components/ui";

export const dynamic = "force-dynamic";

const KIND_OF_SHELF: Record<string, FileKind> = { tools: "tool", skills: "skill", knowledge: "knowledge", memory: "memory", scripts: "script" };

export default async function LibraryEditPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; kind?: string; path?: string }>;
}) {
  const { tenant = "default", kind: rawKind, path: rel } = await searchParams;
  if (!LIBRARY_KINDS.includes(rawKind as LibraryKind)) notFound();
  const kind = rawKind as LibraryKind;
  const now = nowMs();
  const qs = tenant !== "default" ? `?tenant=${tenant}` : "";
  const rest = tenant !== "default" ? `&tenant=${tenant}` : "";

  // One tree for the whole shelf set: the kind is the top folder, so the
  // tree's library link style reads it back out of the path.
  const files = LIBRARY_KINDS.flatMap((k) => listLibrary(tenant, k).map((e) => `${k}/${e.path}`));
  const entries = listLibrary(tenant, kind);
  const selectedRel = rel ?? entries[0]?.path;
  const selected = selectedRel ? `${kind}/${selectedRel}` : undefined;
  let content: string | null = null;
  try {
    content = selectedRel ? readLibraryFile(tenant, kind, selectedRel) : null;
  } catch {
    content = null;
  }

  const fileKind: FileKind = selected ? (kindOf(selected) === "other" ? (KIND_OF_SHELF[kind] ?? "other") : kindOf(selected)) : "other";
  let fm: Record<string, unknown> = {};
  try {
    fm = content ? ((matter(content).data ?? {}) as Record<string, unknown>) : {};
  } catch {
    fm = {};
  }
  const chips = chipsFor(fileKind, fm);
  const sections: ContextSection[] = [];
  if (selectedRel && content !== null) {
    const entry = entries.find((e) => e.path === selectedRel);
    if (entry) {
      const uses = libraryUsage(tenant, kind, entry.name);
      sections.push({
        title: "Used by",
        items: uses.map((u) => ({
          label: u.agent ? `${u.workspace} · ${u.agent}` : u.workspace,
          href: u.agent ? `/dashboard/${u.workspace}/edit?path=${encodeURIComponent(`agents/${u.agent}/agent.md`)}${rest}` : `/dashboard/${u.workspace}${qs}`,
          meta: u.relation === "shadowed" ? "overridden" : undefined,
          tone: u.relation === "shadowed" ? ("warn" as const) : undefined,
        })),
        empty: kind === "tools" ? `No agent grants ${entry.name} yet.` : "Every workspace can read it; none overrides it.",
      });
    }
    const refs = secretRefs(content);
    if (refs.length > 0 || kind === "tools") {
      const set = new Set(listSecrets(tenant).map((s) => s.name));
      sections.push({
        title: "Secrets",
        items: refs.map((n) => ({ label: n, mono: true, meta: set.has(n) ? "set" : "missing at account scope", tone: set.has(n) ? ("ok" as const) : ("warn" as const) })),
        empty: "Names none.",
        more: { label: "Account secrets", href: `/dashboard/settings${qs}` },
      });
    }
    const doc = DOC_FOR[fileKind];
    if (doc) sections.push({ title: "Reference", items: [{ label: `How a ${fileKind} is written`, href: `/dashboard/docs/${doc}${qs}` }] });
  }

  const crumbList = [
    { label: "library", href: `/dashboard/library?kind=${kind}${rest}` },
    { label: kind, href: `/dashboard/library?kind=${kind}${rest}` },
    ...(selectedRel ? selectedRel.split("/").map((label, i, arr) => (i < arr.length - 1 ? { label } : { label })) : []),
  ];

  return (
    <EditorShell
      tenant={tenant}
      libraryKind={kind}
      files={files}
      selected={selected}
      linkBase="/dashboard/library/edit"
      linkSuffix={rest}
      linkStyle="library"
      rootName="library"
      content={content}
      crumbs={crumbList}
      chips={chips}
      kindLabel={`shared ${fileKind === "other" ? kind : fileKind}`}
      issues={[]}
      lastChange={null}
      sections={sections}
      now={now}
      treeFooter={
        <>
          Shared with every workspace. Agents reach these files at <span className="font-mono">../../../../library/</span>.{" "}
          <Link href={`/dashboard/library?kind=${kind}${rest}`} className="underline hover:text-fg-tertiary">Back to the shelf</Link>.
        </>
      }
      emptyEditor={<EmptyScreen title="Nothing here yet" description="Add a shared tool, skill, knowledge or memory file from its shelf." />}
    />
  );
}
