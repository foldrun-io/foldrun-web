"use client";

// The files a run is handed (FOL-163), picked from the workspace's storage.
// The step finds them in inputs/ and can read images and PDFs; the run keeps
// them as they are when it starts.

import { useEffect, useMemo, useState } from "react";
import { Input } from "@foldrun/ui/react/input";
import { Checkbox } from "@foldrun/ui/react/choice";
import { fileSize, matchFiles, pickProblem, PICK_LIMITS, type StoredFile } from "@/components/run-inputs-model";

export function RunInputsPicker({ workspace, tenant, picked, onChange, active }: { workspace: string; tenant: string; picked: string[]; onChange: (paths: string[]) => void; active: boolean }) {
  const [files, setFiles] = useState<StoredFile[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let live = true;
    fetch(`/api/workspaces/${workspace}/storage`, { headers: { "x-foldrun-tenant": tenant } })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { files?: StoredFile[]; error?: string };
        if (!res.ok) throw new Error(body.error ?? `could not list storage (${res.status})`);
        if (live) setFiles((body.files ?? []).map((f) => ({ path: f.path, size: f.size })));
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [active, workspace, tenant]);
  const shown = useMemo(() => matchFiles(files ?? [], filter), [files, filter]);
  const problem = files ? pickProblem(picked, files) : null;
  const toggle = (p: string, on: boolean) => onChange(on ? [...picked, p] : picked.filter((x) => x !== p));

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-fg-muted">Files</span>
        <span className="text-[11px] text-fg-subtle">
          {picked.length ? `${picked.length} of ${PICK_LIMITS.files} picked` : "optional — handed to the first step in inputs/"}
        </span>
      </div>
      {files === null && !error && <p className="mt-1 text-[11px] text-fg-subtle">Loading storage…</p>}
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
      {files?.length === 0 && <p className="mt-1 text-[11px] text-fg-muted">Nothing in storage yet. Upload a file on the Storage page first.</p>}
      {files && files.length > 0 && (
        <>
          {files.length > 6 && (
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files" aria-label="Filter storage files" className="mt-1 w-full text-xs" />
          )}
          <ul className="mt-1 max-h-36 overflow-y-auto rounded-md border border-line">
            {shown.map((f) => (
              <li key={f.path} className="border-b border-line-faint last:border-b-0">
                <label className="flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-muted">
                  <Checkbox checked={picked.includes(f.path)} onCheckedChange={(on: boolean) => toggle(f.path, on)} />
                  <span className="min-w-0 flex-1 truncate font-mono text-fg">{f.path}</span>
                  <span className="shrink-0 tabular-nums text-fg-subtle">{fileSize(f.size)}</span>
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="px-2 py-1 text-[11px] text-fg-muted">No file matches.</li>}
          </ul>
        </>
      )}
      {problem && <p className="mt-1 text-[11px] text-danger">{problem}</p>}
    </div>
  );
}
