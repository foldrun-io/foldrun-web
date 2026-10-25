"use client";

// Rotate one webhook URL from settings. The page re-renders with the new
// derived path; whoever held the old one is out.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui";
import { useConfirm } from "@/components/confirm";

export function RotateHookButton({ workspace, flow }: { workspace: string; flow: string }) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  return (
    <>
      {confirmDialog}
      <button
        disabled={busy}
        onClick={async () => {
          if (!(await confirm({
            title: `Rotate the webhook URL for ${workspace}/${flow}?`,
            body: "The current URL stops working immediately.",
            confirmLabel: "Rotate",
          }))) return;
          setBusy(true);
          await fetch(`/api/workspaces/${workspace}/hooks/${flow}/rotate`, { method: "POST" });
          router.refresh();
          setBusy(false);
        }}
        className={buttonClass("secondary")}
      >
        Rotate
      </button>
    </>
  );
}
