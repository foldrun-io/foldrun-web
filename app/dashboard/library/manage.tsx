"use client";

import { $t } from "@/i18n";
import { useRouter } from "next/navigation";
import { useConfirm } from "@foldrun/ui/react/confirm";
import { Trash2 } from "lucide-react";
import { Button } from "@foldrun/ui/react/button";
import { Tooltip } from "@foldrun/ui/react/tooltip";


export function DeleteLibraryItem({
  kind,
  tenant,
  path,
  name,
  wholeFolder,
}: {
  kind: string;
  tenant: string;
  path: string;
  name: string;
  wholeFolder?: boolean;
}) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      {confirmDialog}
      <Tooltip label={$t("library.manage.delete")}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={$t("library.manage.delete2", { name: String(name) })}
        className="hover:text-danger"
        onClick={async () => {
          if (!(await confirm({ title: $t("library.manage.deleteFromTheLibrary", { name: String(name) }), confirmLabel: $t("library.manage.delete") }))) return;
          // For standard skills the folder is the unit, not the SKILL.md file.
          const target = wholeFolder ? path.replace(/\/(SKILL|tool)\.md$/, "") : path;
          await fetch(`/v1/library/${kind}`, {
            method: "DELETE",
            headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
            body: JSON.stringify({ path: target }),
          });
          router.refresh();
        }}
      >
        <Trash2 />
      </Button>
      </Tooltip>
    </>
  );
}
