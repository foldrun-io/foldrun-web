"use client";

import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/confirm";


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
      <button
        onClick={async () => {
          if (!(await confirm({ title: `Delete ${name} from the library?`, confirmLabel: "Delete" }))) return;
          // For standard skills the folder is the unit, not the SKILL.md file.
          const target = wholeFolder ? path.replace(/\/(SKILL|tool)\.md$/, "") : path;
          await fetch(`/api/library/${kind}`, {
            method: "DELETE",
            headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
            body: JSON.stringify({ path: target }),
          });
          router.refresh();
        }}
        className="text-xs font-medium text-fg-subtle transition-colors hover:text-red-600"
      >
        Delete
      </button>
    </>
  );
}
