"use client";

// The storage page's upload zone. The file list, previews and the
// download and share actions are components/file-browser.tsx.
//
//
// Uploads go to the bucket directly wherever the deployment has one: the
// browser hashes the file, asks for a presigned PUT, sends the bytes there,
// and only then tells the platform the file exists. The hash is the key —
// the same document uploaded twice stores one object. On the fs driver
// there is no bucket, `url` comes back null, and the bytes go to the
// platform instead.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";

import { fmtBytes as humanSize } from "@/components/step-io-model";
import { uploadFile } from "@/components/upload";

export function UploadZone({ workspace, tenant, maxMb, used, quotaMb, count, driver }: { workspace: string; tenant: string; maxMb: number; used: number; quotaMb: number; count: number; driver: "fs" | "s3" }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const upload = async (chosen: FileList | File[]) => {
    setError(null);
    for (const file of Array.from(chosen)) {
      if (file.size > maxMb * 1024 * 1024) {
        setError(`${file.name} is ${humanSize(file.size)} — the limit is ${maxMb} MB`);
        continue;
      }
      setBusy(file.name);
      try {
        await uploadFile(workspace, tenant, file);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    setBusy(null);
    if (input.current) input.current.value = "";
    router.refresh();
  };

  const pct = Math.min(100, Math.round((used / (quotaMb * 1024 * 1024)) * 100));
  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        role="button"
        className={`cursor-pointer rounded-lg border border-dashed px-3 py-3 text-center text-xs transition-colors ${dragging ? "border-gray-500 bg-sunken" : "border-line-strong hover:border-gray-400 hover:bg-sunken/60"}`}
      >
        <span className="text-fg-tertiary">Drop files here, or <span className="font-medium text-fg underline underline-offset-2">browse</span></span>
        <span className="mt-0.5 block text-[11px] text-fg-subtle">up to {maxMb} MB each</span>
        <input ref={input} type="file" multiple hidden onClick={(e) => e.stopPropagation()} onChange={(e) => e.target.files && void upload(e.target.files)} />
      </div>
      {busy && <Badge variant="info">uploading {busy}…</Badge>}
      {error && <Badge variant="error">{error}</Badge>}
      <div className="flex items-center gap-2 text-[11px] text-fg-subtle">
        <div className="h-1 w-20 overflow-hidden rounded-full bg-muted"><div className={`h-full ${pct > 90 ? "bg-red-400" : "bg-gray-400"}`} style={{ width: `${pct}%` }} /></div>
        <span>{humanSize(used)} of {quotaMb} MB · {count} file{count === 1 ? "" : "s"} · {driver === "s3" ? "object storage" : "this server"}</span>
      </div>
    </div>
  );
}
