"use client";

// Settings → General → Beta features (13 Nov 2026): the account joins or
// leaves the beta — every flag marked beta is on for it before its rollout
// reaches everyone. The same choice as `foldrun account beta on|off` and
// PUT /api/account/beta. Only an admin of every workspace may change it; the
// others see where it stands.

import { useState } from "react";
import { Switch } from "@foldrun/ui/react/choice";

interface BetaFlag { name: string; description: string; on: boolean; source: string }

export function BetaFeatures({ initial, flags: initialFlags, canChange }: { initial: boolean; flags: BetaFlag[]; canChange: boolean }) {
  const [beta, setBeta] = useState(initial);
  const [flags, setFlags] = useState(initialFlags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/beta", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ beta: next }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? `HTTP ${res.status}`); return; }
      setBeta(body.beta);
      setFlags(body.flags ?? []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <label className="flex items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-fg">Get beta features first</span>
          <span className="block text-sm text-fg-muted">
            New features reach this account before everyone else. They are finished, but may still change; turn it off at any time.
          </span>
        </span>
        <Switch checked={beta} disabled={!canChange || busy} onCheckedChange={(v) => void set(v)} aria-label="Beta features" />
      </label>
      {!canChange && <p className="text-sm text-fg-subtle">Only an admin of every workspace can change this.</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {flags.length > 0 && (
        <ul className="divide-y divide-line-faint rounded-md border border-line">
          {flags.map((f) => (
            <li key={f.name} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
              <span className="min-w-0">
                <span className="block font-mono text-xs text-fg">{f.name}</span>
                <span className="block text-fg-muted">{f.description}</span>
              </span>
              <span className={f.on ? "shrink-0 text-success" : "shrink-0 text-fg-subtle"}>{f.on ? "on" : "off"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
