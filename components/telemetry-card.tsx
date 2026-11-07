"use client";

// telemetry: on the account's Settings → API — where each finished run goes
// as an OpenTelemetry trace. One header here (the one a collector's token
// rides in); more are written in AGENTS.md. The token itself is a vault
// secret, named, never typed into this form.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/kit/input";
import { SettingsCard, Field, Callout } from "@/components/kit/page";
import { Button } from "@/components/kit/button";
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
        setNote(clear ? "Runs are no longer sent." : "Saved. Every run that finishes from now on is sent.");
        setOwns(clear || !secret.trim() ? null : header.trim().toLowerCase());
        if (clear) setEndpoint("");
        router.refresh();
      }
    } catch (err) {
      setError(`could not reach the platform — ${err instanceof Error ? err.message : String(err)}`);
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
      else if (answer.ok) setNote(`The collector took it: ${answer.spans ?? 0} spans, HTTP ${answer.status}. Look for the trace "run foldrun-telemetry-test".`);
      else setError(`Not delivered — ${answer.error ?? "no answer"}.`);
    } catch (err) {
      setError(`could not reach the platform — ${err instanceof Error ? err.message : String(err)}`);
    }
    setBusy(null);
  };

  return (
    <SettingsCard
      id="telemetry"
      title="Send runs to your tracing"
      description={
        <>
          Each finished run goes to your OpenTelemetry collector as one trace — run, steps, model calls and tool calls, with tokens, cost and each agent&apos;s owner. A workspace&apos;s own{" "}
          <code className="font-mono">telemetry:</code> in its AGENTS.md replaces this one.
        </>
      }
      hint={mayEdit ? <><code className="font-mono text-xs">telemetry:</code> in AGENTS.md</> : "An admin of this account can set this."}
      footer={
        mayEdit && (
          <>
            {initial && (
              <>
                <Button variant="ghost" disabled={busy !== null} onClick={() => save(true)}>
                  {busy === "clear" ? "Stopping…" : "Stop sending"}
                </Button>
                <Button variant="secondary" disabled={busy !== null} onClick={test}>
                  {busy === "test" ? "Sending…" : "Send a test trace"}
                </Button>
              </>
            )}
            <Button variant="primary" disabled={busy !== null || !endpoint.trim()} onClick={() => save(false)}>
              {busy === "save" ? "Saving…" : "Save"}
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
        {initial?.hidden && <p className="text-sm text-fg-muted">Runs are sent to a collector. Where, and with which header, is shown only to members with every workspace.</p>}
        {!initial?.hidden && (
          <>
            <Field label="Collector URL (OTLP/HTTP traces)">
              <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://otel.example.com/v1/traces" disabled={!mayEdit} className="w-full font-mono" />
            </Field>
            <div className="flex flex-wrap gap-4">
              <Field label="Header">
                <Input value={header} onChange={(e) => setHeader(e.target.value)} disabled={!mayEdit} className="w-48 font-mono" />
              </Field>
              <Field label="Its value: a vault secret, by name">
                <Input value={secret} onChange={(e) => setSecret(e.target.value.toUpperCase())} placeholder="OTEL_TOKEN" disabled={!mayEdit} className="w-56 font-mono" />
              </Field>
            </div>
          </>
        )}
      </div>
    </SettingsCard>
  );
}
