"use client";

// Search the runs by what happened inside them (FOL-72 step 9) — a tool
// called or erroring, an agent, a model, tokens, time — and keep a search
// as a named view. The same filters as GET …/runs and `foldrun runs`.

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { RunView } from "@/components/run-views-model";

const FIELDS: { key: string; label: string; placeholder: string; width: string }[] = [
  { key: "tool", label: "tool", placeholder: "web, crm…", width: "w-28" },
  { key: "agent", label: "agent", placeholder: "writer", width: "w-28" },
  { key: "model", label: "model", placeholder: "haiku", width: "w-24" },
  { key: "min_tokens", label: "≥ tokens", placeholder: "50k", width: "w-20" },
  { key: "min_secs", label: "≥ secs", placeholder: "120", width: "w-20" },
];

export function RunSearch({ tenant }: { tenant: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, params.get(f.key) ?? ""])));
  const [errors, setErrors] = useState(params.get("tool_error") === "1");
  const [views, setViews] = useState<RunView[]>([]);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/me/preferences", { headers: { "x-foldrun-tenant": tenant } })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { runViews?: RunView[] } | null) => b?.runViews && setViews(b.runViews))
      .catch(() => undefined);
  }, [tenant]);
  const go = (next: URLSearchParams) => {
    next.delete("page");
    router.push(`${path}${next.toString() ? `?${next}` : ""}`);
  };
  const apply = () => {
    const next = new URLSearchParams(params.toString());
    for (const f of FIELDS) (draft[f.key]?.trim() ? next.set(f.key, draft[f.key]!.trim()) : next.delete(f.key));
    if (errors) next.set("tool_error", "1");
    else next.delete("tool_error");
    go(next);
  };
  const save = async () => {
    const name = window.prompt("Name this search");
    if (!name?.trim()) return;
    const query = new URLSearchParams(params.toString());
    query.delete("page");
    query.delete("tenant");
    const list = [...views.filter((v) => v.name !== name.trim()), { name: name.trim(), query: query.toString() }];
    const res = await fetch("/api/me/preferences", { method: "PATCH", headers: { "content-type": "application/json", "x-foldrun-tenant": tenant }, body: JSON.stringify({ runViews: list }) });
    const body = (await res.json().catch(() => ({}))) as { runViews?: RunView[]; error?: string };
    if (res.ok && body.runViews) setViews(body.runViews);
    setNote(res.ok ? `saved “${name.trim()}”` : body.error ?? "could not save");
  };
  const open = (v: RunView) => {
    const next = new URLSearchParams(v.query);
    if (tenant !== "default") next.set("tenant", tenant);
    go(next);
  };
  const active = FIELDS.some((f) => params.get(f.key)) || params.get("tool_error") === "1";
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2 text-xs">
      {FIELDS.map((f) => (
        <label key={f.key} className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wide text-fg-subtle">
          {f.label}
          <input
            value={draft[f.key] ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            placeholder={f.placeholder}
            className={`${f.width} rounded border border-line bg-surface px-1.5 py-1 text-xs normal-case tracking-normal text-fg`}
          />
        </label>
      ))}
      <label className="flex items-center gap-1 pb-1 text-fg-muted">
        <input type="checkbox" checked={errors} onChange={(e) => setErrors(e.target.checked)} /> a tool errored
      </label>
      <button type="button" onClick={apply} className="rounded-md px-2.5 py-1 font-medium text-fg-secondary ring-1 ring-inset ring-line hover:bg-sunken">search</button>
      {active && (
        <button type="button" onClick={() => void save()} className="rounded-md px-2.5 py-1 font-medium text-fg-muted ring-1 ring-inset ring-line hover:bg-sunken">save view</button>
      )}
      {views.length > 0 && (
        <span className="flex flex-wrap items-center gap-1 pb-1">
          <span className="text-fg-subtle">views:</span>
          {views.map((v) => (
            <button key={v.name} type="button" onClick={() => open(v)} title={v.query} className="rounded-full bg-muted px-2 py-0.5 text-fg-secondary hover:bg-muted-strong">
              {v.name}
            </button>
          ))}
        </span>
      )}
      {note && <span className="pb-1 text-fg-subtle">{note}</span>}
    </div>
  );
}
