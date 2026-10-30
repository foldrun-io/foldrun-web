"use client";

// Deleting a workspace. Creation is components/create.tsx.

import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/confirm";
import { useCan } from "@/components/role";
import type { Action } from "@/platform/permissions";

async function api(endpoint: string, tenant: string, method: string, body?: unknown) {
  const res = await fetch(endpoint, {
    method,
    headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `${res.status}`);
  }
  return res.json();
}


export function DeleteButton({
  endpoint,
  tenant,
  body,
  confirmText,
  redirectTo,
  action = "workspace:write",
}: {
  endpoint: string;
  tenant: string;
  body?: Record<string, unknown>;
  confirmText: string;
  redirectTo?: string;
  /** The permission the DELETE asks for — a run's record is erased by
   *  workspace:manage, not by whoever may write. */
  action?: Action;
}) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const mayWrite = useCan(action);
  // Deleting is a write; a viewer gets no Delete link at all. Unlike Run,
  // this one is hidden rather than disabled: a greyed "Delete" beside every
  // row is noise on a page a viewer only reads.
  if (!mayWrite) return null;
  return (
    <>
      {confirmDialog}
      <button
        onClick={async () => {
          if (!(await confirm({ title: confirmText, confirmLabel: "Delete" }))) return;
          await api(endpoint, tenant, "DELETE", body);
          if (redirectTo) router.push(redirectTo);
          else router.refresh();
        }}
        className="text-xs font-medium text-fg-subtle transition-colors hover:text-red-600"
      >
        Delete
      </button>
    </>
  );
}
