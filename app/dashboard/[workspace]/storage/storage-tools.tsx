"use client";

// The storage page's upload button and its usage meter. The file list,
// previews, drag-and-drop onto the list and the download and share actions
// are components/file-browser.tsx.
//
// Uploads go to the bucket directly wherever the deployment has one: the
// browser hashes the file, asks for a presigned PUT, sends the bytes there,
// and only then tells the platform the file exists. The hash is the key —
// the same document uploaded twice stores one object. On the fs driver
// there is no bucket, `url` comes back null, and the bytes go to the
// platform instead.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@foldrun/ui/react/button";
import { Chip, RingProgress } from "@foldrun/ui/react/page";
import { fmtBytes as humanSize } from "@/components/step-io-model";
import { uploadFile } from "@/components/upload";
import { useFilePicker } from "@foldrun/ui/react/file-button";
import { Tooltip } from "@foldrun/ui/react/tooltip";

/** The header's Upload: a file picker that checks each file against the
 *  size limit before sending it. Drop files on the list to upload too. */
export function UploadZone({ workspace, tenant, maxMb }: { workspace: string; tenant: string; maxMb: number; used?: number; quotaMb?: number; count?: number; driver?: "fs" | "s3" }) {
  const router = useRouter();
  const picker = useFilePicker({ multiple: true, onFiles: (files) => void upload(files) });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    router.refresh();
  };

  return (
    <>
      {busy && <Chip tone="info">Uploading {busy}…</Chip>}
      {error && (
        <Tooltip label={error}>
          <span role="alert" className="max-w-xs truncate text-[13px] text-danger">
            {error}
          </span>
        </Tooltip>
      )}
      <Tooltip label={`Any file, up to ${maxMb} MB each — or drop files on the list`}>
        <Button variant="primary" size="md" onClick={picker.open} disabled={!!busy}>
          <Upload /> Upload
        </Button>
      </Tooltip>
      {picker.input}
    </>
  );
}

/** How much of the desk's quota is used, for the header's meta row. */
export function StorageUsage({ used, quotaMb, count, driver }: { used: number; quotaMb: number; count: number; driver: "fs" | "s3" }) {
  const share = used / (quotaMb * 1024 * 1024);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <RingProgress value={share} label={`${Math.round(share * 100)}% of the quota`} />
      <span className="min-w-0 truncate tabular-nums">
        {humanSize(used)} of {quotaMb} MB · {count} file{count === 1 ? "" : "s"} · {driver === "s3" ? "object storage" : "this server"}
      </span>
    </span>
  );
}
