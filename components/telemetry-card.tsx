"use client";

// telemetry: on the account's Settings → API keys → API — where each finished run goes
// as an OpenTelemetry trace. One header here (the one a collector's token
// rides in); more are written in AGENTS.md. The token itself is a vault
// secret, named, never typed into this form.

import { $rich, $t } from "@/i18n";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@foldrun/ui/react/input";
import { SettingsCard, Field, Callout } from "@foldrun/ui/react/page";
import { Button } from "@foldrun/ui/react/button";
import type { TelemetryConfig } from "./defaults-model";

const SECRET_REF = /^\$\{([A-Z][A-Z0-9_]{1,63})\}$/;

export function TelemetryCard({ tenant, initial, mayEdit }: { tenant: string; initial: (TelemetryConfig & { hidden?: true }) | null; mayEdit: boolean }) {
  const router = useRouter();
  // The one header this form edits: the first whose value is a secret.
  // Every other header — a literal one too — is kept as AGENTS.md has it.
  const edited = Object.entries(initial?.headers ?? {}).find(([, v]) => SECRET_REF.test(String(v)));
  const [endpoint, setEndpoint] = useState(initial?.endpoint ?? "");
  const [header, setHeader] = useState(edited?.[0] ?? "authorization");
  const [secret, setSecret] = useState(edited ? (SECRET_REF.exec(String(edited[1]))?.[1] ?? "") : "");
  // Which header the stored block holds for this form, tracked by name so a
  // refresh that reorders the block cannot make a save drop another one.
  const [owns, setOwns] = useState<string | null>(edited?.[0] ?? null);
  const [busy, setBusy] = useState<"save" | "clear" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const headers = { "content-type": "application/json", "x-foldrun-tenant": tenant };

  const save = async (clear: boolean) => {
    setBusy(clear ? "clear" : "save");
    setError(null);
    setNote(null);
    // The other headers in AGENTS.md are kept: this form edits one.
    const others = Object.fromEntries(Object.entries(initial?.headers ?? {}).filter(([k]) => k !== owns));
    const telemetry = clear
      ? null
      : { otlp: endpoint.trim(), headers: { ...others, ...(secret.trim() ? { [header.trim().toLowerCase()]: `\${${secret.trim()}}` } : {}) } };
    try {
      const res = await fetch("/api/account", { method: "PATCH", headers, body: JSON.stringify({ telemetry }) });
      const answer = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(answer.error ?? `HTTP ${res.status}`);
      else {
        setNote(clear ? $t("components.telemetry-card.runsAreNoLongerSent") : $t("components.telemetry-card.savedEveryRunThatFinishesFrom"));
        setOwns(clear || !secret.trim() ? null : header.trim().toLowerCase());
        if (clear) setEndpoint("");
        router.refresh();
      }
    } catch (err) {
      setError($t("components.telemetry-card.couldNotReachThePlatform", { v0: String(err instanceof Error ? err.message : String(err)) }));
    }
    setBusy(null);
  };

  const test = async () => {
    setBusy("test");
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/account/telemetry/test", { method: "POST", headers, body: "{}" });
      const answer = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: number; error?: string; spans?: number };
      if (!res.ok) setError(answer.error ?? `HTTP ${res.status}`);
      else if (answer.ok) setNote($t("components.telemetry-card.theCollectorTookItSpansHttp", { v0: String(answer.spans ?? 0), status: String(answer.status) }));
      else setError($t("components.telemetry-card.notDelivered", { v0: String(answer.error ?? $t("components.telemetry-card.noAnswer")) }));
    } catch (err) {
      setError($t("components.telemetry-card.couldNotReachThePlatform", { v0: String(err instanceof Error ? err.message : String(err)) }));
    }
    setBusy(null);
  };

  return (
    <SettingsCard
      id="telemetry"
      title={$t("components.telemetry-card.sendRunsToYourTracing")}
      description={
        <>
          {$rich("components.telemetry-card.eachFinishedRunGoesToYour2", { code: (chunks) => <code className="font-mono">{chunks}</code> })}
        </>
      }
      hint={mayEdit ? <>{$rich("components.telemetry-card.telemetryInAgentsMd", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}</> : $t("components.telemetry-card.anAdminOfThisAccountCan")}
      footer={
        mayEdit && (
          <>
            {initial && (
              <>
                <Button variant="ghost" disabled={busy !== null} onClick={() => save(true)}>
                  {busy === "clear" ? "Stopping…" : $t("components.telemetry-card.stopSending")}
                </Button>
                <Button variant="secondary" disabled={busy !== null} onClick={test}>
                  {busy === "test" ? "Sending…" : $t("components.telemetry-card.sendATestTrace")}
                </Button>
              </>
            )}
            <Button variant="primary" disabled={busy !== null || !endpoint.trim()} onClick={() => save(false)}>
              {busy === "save" ? "Saving…" : $t("components.telemetry-card.save")}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {note && <Callout tone="success" role="status">{note}</Callout>}
        {error && <Callout tone="danger" role="alert">{error}</Callout>}
        {/* A member limited to some workspaces is told it is set, not where
            runs go or with which header (GET /api/account, 30 Oct 2026). */}
        {initial?.hidden && <p className="text-sm text-fg-muted">{$t("components.telemetry-card.runsAreSentToACollector")}</p>}
        {!initial?.hidden && (
          <>
            <Field label={$t("components.telemetry-card.collectorUrlOtlpHttpTraces")}>
              <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://otel.example.com/v1/traces" disabled={!mayEdit} className="w-full font-mono" />
            </Field>
            <div className="flex flex-wrap gap-4">
              <Field label={$t("components.telemetry-card.header")}>
                <Input value={header} onChange={(e) => setHeader(e.target.value)} disabled={!mayEdit} className="w-48 font-mono" />
              </Field>
              <Field label={$t("components.telemetry-card.itsValueAVaultSecretBy")}>
                <Input value={secret} onChange={(e) => setSecret(e.target.value.toUpperCase())} placeholder="OTEL_TOKEN" disabled={!mayEdit} className="w-56 font-mono" />
              </Field>
            </div>
          </>
        )}
      </div>
    </SettingsCard>
  );
}
