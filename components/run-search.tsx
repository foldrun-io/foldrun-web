"use client";

// Search the runs by what happened inside them (FOL-72 step 9) — a tool
// called or erroring, an agent, a model, tokens, time — and keep a search
// as a named view. The same filters as GET …/runs and `foldrun runs`.

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import type { RunView } from "@/components/run-views-model";
import { SearchField } from "@/components/kit/list";
import { Button } from "@/components/kit/button";
import { Input } from "@/components/kit/input";
import { cn } from "@/components/kit/cn";
import { Count } from "@/components/kit/page";
import { Checkbox } from "@/components/kit/choice";
import { usePrompt } from "@/components/kit/prompt";
import { Tooltip } from "@/components/kit/tooltip";

/** The runs list's free-text search: the kit's search box in URL mode. The
 *  list is paged on the server, so typing writes ?q= (debounced, page
 *  reset) and the page filters before paging. */
export function RunQuery({ value, placeholder, className }: { value: string; placeholder: string; className?: string }) {
  return <SearchField url value={value} placeholder={placeholder} className={className} />;
}

const FIELDS: { key: string; label: string; placeholder: string; width: string }[] = [
  { key: "tool", label: "Tool", placeholder: "web, crm…", width: "sm:w-32" },
  { key: "agent", label: "Agent", placeholder: "writer", width: "sm:w-32" },
  { key: "model", label: "Model", placeholder: "haiku", width: "sm:w-28" },
  { key: "min_tokens", label: "At least tokens", placeholder: "50k", width: "sm:w-28" },
  { key: "min_secs", label: "At least seconds", placeholder: "120", width: "sm:w-28" },
];

export function RunSearch({ tenant }: { tenant: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, params.get(f.key) ?? ""])));
  const [errors, setErrors] = useState(params.get("tool_error") === "1");
  const [views, setViews] = useState<RunView[]>([]);
  const [ask, promptDialog] = usePrompt();
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
    const v = await ask({ title: "Name this search", fields: [{ name: "name", label: "Name", required: true }], submit: "Save" });
    const name = v?.name;
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
  const activeCount = FIELDS.filter((f) => params.get(f.key)).length + (params.get("tool_error") === "1" ? 1 : 0);
  // Open when a search inside the runs is in force, so what filters the
  // list is never hidden behind a closed button.
  const [panel, setPanel] = useState(active);
  return (
    <>
      {promptDialog}
      <Button size="md" variant="secondary" aria-expanded={panel} onClick={() => setPanel((v) => !v)} className={cn("h-10", active && "border-line-strong")}>
        <SlidersHorizontal aria-hidden />
        Inside runs
        {activeCount > 0 && <Count tone="strong">{activeCount}</Count>}
      </Button>
      {panel && (
        <div className="basis-full rounded-lg border border-line bg-surface p-4">
          <p className="mb-3 text-[13px] text-fg-muted">Find runs by what happened inside them — a tool called or erroring, an agent, a model, tokens, time.</p>
          <div className="flex flex-wrap items-end gap-3">
            {FIELDS.map((f) => (
              <label key={f.key} className={cn("flex w-full flex-col gap-1 text-[13px] text-fg-muted", f.width)}>
                {f.label}
                <Input
                  value={draft[f.key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && apply()}
                  placeholder={f.placeholder}
                />
              </label>
            ))}
            <label className="flex h-9 items-center gap-2 text-[13px] text-fg-secondary">
              <Checkbox checked={errors} onCheckedChange={(checked: boolean) => setErrors(checked)} /> A tool errored
            </label>
            <span className="flex items-center gap-2 sm:ml-auto">
              {active && (
                <Button size="md" variant="secondary" onClick={() => void save()}>
                  Save view
                </Button>
              )}
              <Button size="md" variant="primary" onClick={apply}>
                Search
              </Button>
            </span>
          </div>
          {note && <p className="mt-2 text-[13px] text-fg-muted">{note}</p>}
        </div>
      )}
      {views.length > 0 && (
        <div className="flex basis-full flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-fg-muted">Saved views</span>
          {views.map((v) => (
            <Tooltip key={v.name} label={v.query}>
              <button
                type="button"
                onClick={() => open(v)}
                className="inline-flex h-7 items-center rounded-full border border-line bg-surface px-2.5 text-fg-secondary transition-colors hover:border-line-strong hover:bg-sunken hover:text-fg"
              >
                {v.name}
              </button>
            </Tooltip>
          ))}
          {note && !panel && <span className="text-fg-muted">{note}</span>}
        </div>
      )}
    </>
  );
}
