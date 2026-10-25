"use client";

// A workspace's name and what it is for. Both live in AGENTS.md.
//
// The rename is the one destructive-ish edit in the product. A workspace's
// name is in every webhook URL *and* in the token those URLs carry, so
// renaming doesn't 404 an old hook, it fails its signature check — which
// looks like an attack in the logs rather than a rename anyone did on
// purpose. That is said before the button is pressed, not after.

import { useRouter } from "next/navigation";
import { SettingsForm, Field, useSettingsForm } from "./settings-form";
import { inputClass } from "./ui";

export function WorkspaceIdentity({
  tenant,
  workspace,
  description,
  /** Flows triggered by webhook — the ones a rename breaks. */
  webhookFlows,
}: {
  tenant: string;
  workspace: string;
  description: string;
  webhookFlows: string[];
}) {
  const router = useRouter();
  const form = useSettingsForm({ name: workspace, description }, async (v) => {
    const res = await fetch(`/api/workspaces/${workspace}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-foldrun-tenant": tenant },
      body: JSON.stringify({ name: v.name, description: v.description }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `${res.status}`);
    // The old URL no longer resolves after a rename, so follow it.
    if (data.renamed) router.push(`/dashboard/${data.name}/settings${tenant !== "default" ? `?tenant=${tenant}` : ""}`);
    else router.refresh();
  });
  const renaming = form.value.name !== workspace;

  return (
    <SettingsForm form={form} saveLabel={renaming ? "Rename and save" : "Save"} hint="name: and description: in AGENTS.md">
      <Field label="Name" help="Kebab-case. This is the folder name and the URL.">
        <input value={form.value.name} onChange={(e) => form.setValue({ ...form.value, name: e.target.value })} spellCheck={false} className={inputClass("w-full max-w-sm font-mono")} />
      </Field>
      <Field label="Description" help="Shown on the workspace card and in Find.">
        <input value={form.value.description} onChange={(e) => form.setValue({ ...form.value, description: e.target.value })} placeholder="What this workspace is for." className={inputClass("w-full")} />
      </Field>
      {renaming && webhookFlows.length > 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>This breaks {webhookFlows.length} webhook URL{webhookFlows.length === 1 ? "" : "s"}.</strong> The name is part of the URL and of the token it
          carries, so anything calling <span className="font-mono">{webhookFlows.join(", ")}</span> will start failing its signature check. Copy the new URLs
          from each flow afterwards and re-point the caller.
        </p>
      )}
    </SettingsForm>
  );
}
