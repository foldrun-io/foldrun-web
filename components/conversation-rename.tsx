"use client";

// Rename one conversation of the project (FOL-264): the kit's prompt, then
// PATCH …/sessions/<context>. An empty name takes the name away.

import { $t } from "@/i18n";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@foldrun/ui/react/button";
import { usePrompt } from "@foldrun/ui/react/prompt";
import { Toast } from "@foldrun/ui/react/toast";

export function ConversationRename({ workspace, tenant, context, name }: { workspace: string; tenant: string; context: string; name: string | null }) {
  const router = useRouter();
  const [ask, promptDialog] = usePrompt();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const rename = async () => {
    const v = await ask({
      title: $t("components.conversation-rename.title"),
      body: $t("components.conversation-rename.body"),
      fields: [{ name: "name", label: $t("components.conversation-rename.name"), initial: name ?? "" }],
      submit: $t("components.conversation-rename.save"),
    });
    if (!v) return;
    setBusy(true);
    try {
      const r = await fetch(`/v1/workspaces/${encodeURIComponent(workspace)}/sessions/${encodeURIComponent(context)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
        body: JSON.stringify({ name: v.name.trim() ? v.name.trim() : null }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? $t("components.conversation-rename.failed", { status: String(r.status) }));
      router.refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="ghost" size="sm" disabled={busy} onClick={rename}>
        {$t("components.conversation-rename.rename")}
      </Button>
      {promptDialog}
      {toast && <Toast onDone={() => setToast(null)}>{toast}</Toast>}
    </>
  );
}
