"use client";

// A workspace's name and what it is for. Both live in AGENTS.md.
//
// The rename is the one destructive-ish edit in the product. A workspace's
// name is in every webhook URL *and* in the token those URLs carry, so
// renaming doesn't 404 an old hook, it fails its signature check — which
// looks like an attack in the logs rather than a rename anyone did on
// purpose. That is said before the button is pressed, not after.

import { $rich, $t } from "@/i18n";
import { useRouter } from "next/navigation";
import { SettingsForm, useSettingsForm } from "./settings-form";
import { Field, Callout } from "@foldrun/ui/react/page";
import { Input } from "@foldrun/ui/react/input";

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
    const res = await fetch(`/v1/workspaces/${workspace}`, {
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
    <SettingsForm form={form} id="identity" title={$t("components.workspace-identity.nameAndDescription")} description={$t("components.workspace-identity.whatThisWorkspaceIsCalledAnd")} saveLabel={renaming ? $t("components.workspace-identity.renameAndSave") : $t("components.workspace-identity.save")} hint={<>{$rich("components.workspace-identity.nameAndDescriptionInAgentsMd", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}</>}>
      <Field label={$t("components.workspace-identity.name")} hint={$t("components.workspace-identity.kebabCaseThisIsTheFolder")}>
        <Input value={form.value.name} onChange={(e) => form.setValue({ ...form.value, name: e.target.value })} spellCheck={false} className="w-full max-w-sm font-mono" />
      </Field>
      <Field label={$t("components.workspace-identity.description")} hint={$t("components.workspace-identity.shownOnTheWorkspaceCardAnd")}>
        <Input value={form.value.description} onChange={(e) => form.setValue({ ...form.value, description: e.target.value })} placeholder={$t("components.workspace-identity.whatThisWorkspaceIsFor")} className="w-full" />
      </Field>
      {renaming && webhookFlows.length > 0 && (
        <Callout tone="warning" className="px-3 py-2 text-xs">
          {$rich("components.workspace-identity.thisBreaksWebhookUrlTheName", { length: webhookFlows.length, strong: (chunks) => <strong>{chunks}</strong>, join: webhookFlows.join(", "), span: (chunks) => <span className="font-mono">{chunks}</span> })}
        </Callout>
      )}
    </SettingsForm>
  );
}
