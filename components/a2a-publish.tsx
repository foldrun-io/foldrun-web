"use client";

// "Publish over A2A" on a flow card (1 Nov 2026): whether outside agents with
// an A2A key may call this flow, and what its agent card says. It edits the
// flow's `a2a:` through PATCH /api/workspaces/<ws>/flows/<f> { a2a } — the
// same file everything else edits — and shows where the card is served, with
// a curl to try it. Publishing is an admin's (workspace:manage); the server
// refuses anyone else, and the control says so before they try.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, chipButtonClass, inputClass, FIELD_LABEL_CLASS } from "@/components/ui";
import { CopyField } from "@/components/copy-field";
import { useCan } from "@/components/role";
import { a2aBodyOf, a2aCurl, a2aFormOf, type A2aForm } from "@/components/a2a-model";

interface Published {
  publish: boolean;
  name: string | null;
  description: string | null;
  examples: string[];
  publicCard: boolean;
  input?: unknown;
}

interface Where {
  card: string;
  url: string;
}

export function A2aPublish({ workspace, tenant, flow, initial }: { workspace: string; tenant: string; flow: string; initial: Published | null }) {
  const router = useRouter();
  const mayManage = useCan("workspace:manage");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<A2aForm>(a2aFormOf(initial));
  const [saved, setSaved] = useState<A2aForm>(a2aFormOf(initial));
  const [where, setWhere] = useState<Where | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headers: Record<string, string> = { "content-type": "application/json", ...(tenant !== "default" ? { "x-foldrun-tenant": tenant } : {}) };

  // Where the card is served — the server's answer, from the install's own
  // address (never this browser's), read when the panel opens.
  async function locate() {
    const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/a2a`, { headers }).catch(() => null);
    const d = res && res.ok ? ((await res.json().catch(() => null)) as { flows?: { flow: string; card: string; url: string }[] } | null) : null;
    const hit = d?.flows?.find((f) => f.flow === flow);
    setWhere(hit ? { card: hit.card, url: hit.url } : null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspace)}/flows/${encodeURIComponent(flow)}`, { method: "PATCH", headers, body: JSON.stringify({ a2a: a2aBodyOf(form) }) });
      const d = (await res.json().catch(() => ({}))) as { error?: string; flow?: { a2a?: Published | null } };
      if (!res.ok) throw new Error(d.error ?? `${res.status}`);
      const next = a2aFormOf(d.flow?.a2a ?? null);
      setForm(next);
      setSaved(next);
      await locate();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = <K extends keyof A2aForm>(k: K, v: A2aForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void locate();
        }}
        className={chipButtonClass()}
        title={initial?.publish ? "Published over A2A — outside agents with an A2A key naming this flow may call it" : "Let outside agents call this flow over A2A"}
      >
        {initial?.publish ? "A2A: published…" : "Publish over A2A…"}
      </button>
    );
  }

  return (
    <div className="w-full rounded-md border border-line bg-sunken p-3">
      <p className="text-xs text-fg-muted">
        A published flow can be called by an outside agent over A2A 1.0 — only with an A2A key that names it (Settings → API keys). A person still approves every gate.
        {!mayManage && <span className="ml-1 font-medium text-fg-secondary">Publishing needs the admin role.</span>}
      </p>
      <fieldset disabled={!mayManage || busy} className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-fg-secondary sm:col-span-2">
          <input type="checkbox" checked={form.publish} onChange={(e) => set("publish", e.target.checked)} />
          Published — outside agents with an A2A key may call it
        </label>
        <label>
          <span className={FIELD_LABEL_CLASS}>Card name</span>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={flow} maxLength={100} className={inputClass("w-full")} />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-fg-secondary">
          <input type="checkbox" checked={form.publicCard} onChange={(e) => set("publicCard", e.target.checked)} />
          Public card — readable without a key (calling it never is)
        </label>
        <label className="sm:col-span-2">
          <span className={FIELD_LABEL_CLASS}>Description</span>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="What this agent does, for the agents that call it. Written for strangers: no internal names, no secrets."
            className={inputClass("w-full")}
          />
        </label>
        <label className="sm:col-span-2">
          <span className={FIELD_LABEL_CLASS}>Example requests — one per line</span>
          <textarea value={form.examples} onChange={(e) => set("examples", e.target.value)} rows={2} className={inputClass("w-full font-mono text-xs")} />
        </label>
      </fieldset>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={!mayManage || busy || !dirty} className={buttonClass("primary")} title={mayManage ? undefined : "Publishing a flow needs the admin role (workspace:manage)"}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => { setForm(saved); setError(null); setOpen(false); }} className={buttonClass("minimal")}>
          Close
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
        <span className="ml-auto text-xs text-fg-subtle">a2a: in the flow</span>
      </div>
      {where && saved.publish && (
        <div className="mt-3 space-y-2 border-t border-line-faint pt-3">
          <div>
            <span className={FIELD_LABEL_CLASS}>Agent card</span>
            <CopyField value={where.card} className="mt-1" />
          </div>
          <div>
            <span className={FIELD_LABEL_CLASS}>Try it — with an A2A key in $FOLDRUN_A2A_KEY</span>
            <CopyBlock text={a2aCurl(where.url, { text: saved.examples.split("\n")[0]?.trim() || "Hello" })} />
          </div>
        </div>
      )}
      {!saved.publish && <p className="mt-3 text-xs text-fg-subtle">Not published: the card and the endpoint answer 404 to every key.</p>}
    </div>
  );
}

/** A multi-line command with a Copy button (CopyField is one line). */
function CopyBlock({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-1">
      <pre className="overflow-x-auto rounded-md border border-line bg-surface p-2 font-mono text-[11px] leading-relaxed text-fg-secondary">{text}</pre>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          } catch {
            // the block is selectable; the button was a convenience
          }
        }}
        className={buttonClass("secondary", "mt-1")}
      >
        {done ? "Copied" : "Copy curl"}
      </button>
    </div>
  );
}
