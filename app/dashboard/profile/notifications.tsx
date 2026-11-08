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
import { Card, Tag } from "@foldrun/ui/react/page";
import { Disclosure } from "@foldrun/ui/react/disclosure";
import { Switch } from "@foldrun/ui/react/choice";

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
      {error && <p className="px-5 py-3 text-sm text-danger">{error}</p>}
      {cats.map((c) => (
        <div key={c.category} className="px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">
                {c.label}
                {c.required && <Tag className="ml-2">always sent</Tag>}
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">{c.description}</p>
              {c.required && c.why && <p className="mt-1 text-xs text-fg-subtle">Cannot be turned off: {c.why}.</p>}
            </div>
            <Switch aria-label={c.label} checked={c.required || c.enabled} disabled={c.required || busy} onCheckedChange={(v) => void set(c.category, v)} />
          </div>
          {c.perWorkspace && !c.required && workspaces.length > 0 && (
            <Disclosure className="mt-2" summaryClassName="text-xs text-fg-muted hover:text-fg" summary={<>Per workspace{Object.keys(c.workspaces).length ? ` · ${Object.keys(c.workspaces).length} set` : ""}</>}>
              <ul className="mt-2 space-y-1.5">
                {workspaces.map((w) => {
                  const on = c.workspaces[w] ?? c.enabled;
                  return (
                    <li key={w} className="flex items-center justify-between gap-4 text-xs">
                      <span className="font-mono text-fg-secondary">{w}{w in c.workspaces ? "" : <span className="ml-1 font-sans text-fg-subtle">(as above)</span>}</span>
                      <Switch aria-label={`${c.label} from ${w}`} checked={on} disabled={busy} onCheckedChange={(v) => void set(c.category, v, w)} />
                    </li>
                  );
                })}
              </ul>
            </Disclosure>
          )}
        </div>
      ))}
      <p className="px-5 py-3 text-xs text-fg-subtle">
        For {email}. Every optional mail also carries a one-click unsubscribe for its own category.
      </p>
    </Card>
  );
}
