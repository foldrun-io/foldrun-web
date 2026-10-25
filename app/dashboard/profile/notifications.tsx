"use client";

// What mail you get. One row per category: a switch, what it covers, and —
// for the categories that are about one workspace — the workspaces where you
// want it different. Required mail is shown, switched on and locked, with
// the reason: a list that hid it would let a person believe they had turned
// off everything and then be surprised by a password reset.
//
// The same choices an unsubscribe link in a mail makes, and the ones
// `foldrun notifications set` makes.

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";

interface Category {
  category: string;
  label: string;
  description: string;
  required: boolean;
  why?: string;
  perWorkspace: boolean;
  enabled: boolean;
  workspaces: Record<string, boolean>;
}

function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? "bg-ink" : "bg-gray-300"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-surface transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

export function NotificationPreferences({ workspaces }: { workspaces: string[] }) {
  const [cats, setCats] = useState<Category[] | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/me/notifications")
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        setCats(body.categories);
        setEmail(body.email);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const set = async (category: string, enabled: boolean, workspace?: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category, enabled, ...(workspace ? { workspace } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
      else setCats(body.categories);
    } finally {
      setBusy(false);
    }
  };

  if (!cats) return <Card className="p-5"><p className="text-sm text-fg-subtle">{error ?? "Loading…"}</p></Card>;

  return (
    <Card className="divide-y divide-line-faint">
      {error && <p className="px-5 py-3 text-sm text-red-700">{error}</p>}
      {cats.map((c) => (
        <div key={c.category} className="px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">
                {c.label}
                {c.required && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">always sent</span>}
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">{c.description}</p>
              {c.required && c.why && <p className="mt-1 text-xs text-fg-subtle">Cannot be turned off: {c.why}.</p>}
            </div>
            <Switch label={c.label} on={c.required || c.enabled} disabled={c.required || busy} onChange={(v) => void set(c.category, v)} />
          </div>
          {c.perWorkspace && !c.required && workspaces.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg">
                Per workspace{Object.keys(c.workspaces).length ? ` · ${Object.keys(c.workspaces).length} set` : ""}
              </summary>
              <ul className="mt-2 space-y-1.5">
                {workspaces.map((w) => {
                  const on = c.workspaces[w] ?? c.enabled;
                  return (
                    <li key={w} className="flex items-center justify-between gap-4 text-xs">
                      <span className="font-mono text-fg-secondary">{w}{w in c.workspaces ? "" : <span className="ml-1 font-sans text-fg-subtle">(as above)</span>}</span>
                      <Switch label={`${c.label} from ${w}`} on={on} disabled={busy} onChange={(v) => void set(c.category, v, w)} />
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </div>
      ))}
      <p className="px-5 py-3 text-xs text-fg-subtle">
        For {email}. Every optional mail also carries a one-click unsubscribe for its own category.
      </p>
    </Card>
  );
}
