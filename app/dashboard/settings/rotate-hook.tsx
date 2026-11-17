"use client";

// Rotate one webhook URL from settings. The page re-renders with the new
// derived path; whoever held the old one is out.

import { $t } from "@/i18n";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@foldrun/ui/react/button";
import { useConfirm } from "@foldrun/ui/react/confirm";

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
            title: $t("settings.rotate-hook.rotateTheWebhookUrlFor", { workspace: String(workspace), flow: String(flow) }),
            body: $t("settings.rotate-hook.theCurrentUrlStopsWorkingImmediately"),
            confirmLabel: $t("settings.rotate-hook.rotate"),
          }))) return;
          setBusy(true);
          await fetch(`/api/workspaces/${workspace}/hooks/${flow}/rotate`, { method: "POST" });
          router.refresh();
          setBusy(false);
        }}
        className={buttonVariants({ variant: "secondary" })}
      >
        {$t("settings.rotate-hook.rotate")}
      </button>
    </>
  );
}
