"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Chip, Tag } from "@foldrun/ui/react/page";
import { Tooltip } from "@foldrun/ui/react/tooltip";

/**
 * The badge beside a library tool that came from the gallery: current, or
 * behind the version the platform ships now — with the one-click that
 * closes the gap. An install is a copy on purpose; this is what keeps a
 * copy from being forgotten.
 */
export function GalleryDrift({ tenant, name, status }: { tenant: string; name: string; status: "current" | "differs" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (status === "current") {
    return (
      <Tooltip label="Installed from the gallery, and identical to the version the platform ships now">
        <span>
          <Tag>gallery · current</Tag>
        </span>
      </Tooltip>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Tooltip label="Installed from the gallery, but not identical to the version the platform ships now — either the gallery moved on, or this copy was edited">
        <span>
          <Chip tone="warn">gallery · differs</Chip>
        </span>
      </Tooltip>
      <Tooltip label="Replace this copy with the gallery's current version. The previous content stays one revision back.">
      <button
        disabled={busy}
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          setBusy(true);
          await fetch("/api/library/gallery", {
            method: "POST",
            headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
            body: JSON.stringify({ tool: name }),
          });
          setBusy(false);
          router.refresh();
        }}
        className="text-xs font-medium text-link hover:underline disabled:opacity-50"
      >
        {busy ? "updating…" : "update to gallery version"}
      </button>
      </Tooltip>
    </span>
  );
}
