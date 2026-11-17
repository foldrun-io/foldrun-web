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

import { $t } from "@/i18n";
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
        setError($t("workspace.storage-storage-tools.isTheLimitIsMb", { name: String(file.name), v1: String(humanSize(file.size)), maxMb: String(maxMb) }));
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
      {busy && <Chip tone="info">{$t("workspace.storage-storage-tools.uploading", { busy: busy })}</Chip>}
      {error && (
        <Tooltip label={error}>
          <span role="alert" className="max-w-xs truncate text-[13px] text-danger">
            {error}
          </span>
        </Tooltip>
      )}
      <Tooltip label={$t("workspace.storage-storage-tools.anyFileUpToMbEach", { maxMb: String(maxMb) })}>
        <Button variant="primary" size="md" onClick={picker.open} disabled={!!busy}>
          <Upload />{" "}{$t("workspace.storage-storage-tools.upload")}
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
      <RingProgress value={share} label={$t("workspace.storage-storage-tools.ofTheQuota", { v0: String(Math.round(share * 100)) })} />
      <span className="min-w-0 truncate tabular-nums">
        {$t("workspace.storage-storage-tools.ofMbFile", { used: humanSize(used), quotaMb: String(quotaMb), count: count })}{" "}{driver === "s3" ? $t("workspace.storage-storage-tools.objectStorage") : $t("workspace.storage-storage-tools.thisServer")}
      </span>
    </span>
  );
}
