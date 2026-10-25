"use client";

// The devices you are signed in on.
//
// This page used to explain that sessions were signed statements rather than
// stored rows, so changing your password did not sign anyone out and the only
// way to end them all was rotating the install key — which signs out every
// person on the install. That was true, and it was the gap. Sessions are rows
// now, so the honest answer is a list and a button.

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui";
import { LocalTime } from "@/components/local-time";

interface Row {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  isCurrent: boolean;
}

/** A user-agent string is not something to show a person. Name the shape. */
function describe(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : /Firefox\//.test(ua) ? "Firefox"
    : "Browser";
  const os =
    /iPhone|iPad/.test(ua) ? "iOS"
    : /Android/.test(ua) ? "Android"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Windows/.test(ua) ? "Windows"
    : /Linux/.test(ua) ? "Linux"
    : "";
  return os ? `${browser} on ${os}` : browser;
}

export function SessionList() {
  const [state, setState] = useState<{ revocable: boolean; sessions: Row[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch("/api/auth/sessions");
    if (!res.ok) return setError("could not load your sessions");
    setState(await res.json());
  };
  useEffect(() => {
    void load();
  }, []);

  const end = async (body: Record<string, unknown>, tag: string) => {
    setBusy(tag);
    setError("");
    const res = await fetch("/api/auth/sessions", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy("");
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      return setError(b.error ?? "could not end that session");
    }
    await load();
  };

  if (!state) return <p className="text-sm text-fg-muted">Loading…</p>;

  if (!state.revocable) {
    return (
      <p className="text-sm text-fg-tertiary">
        This install has no database, so sessions are signed statements rather than stored rows —
        they cannot be listed or ended individually. To end every session at once, rotate{" "}
        <code className="font-mono text-xs">FOLDRUN_SECRET_KEY</code>.
      </p>
    );
  }

  const others = state.sessions.filter((s) => !s.isCurrent);

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {state.sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-4 text-sm">
            <div className="min-w-0">
              <p className="truncate text-fg">
                {describe(s.userAgent)}
                {s.isCurrent && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-fg-tertiary">
                    this device
                  </span>
                )}
              </p>
              <p className="text-xs text-fg-muted">
                last used <LocalTime iso={s.lastSeenAt} /> · started <LocalTime iso={s.createdAt} />
              </p>
            </div>
            {!s.isCurrent && (
              <button
                type="button"
                className="shrink-0 text-xs text-red-600 hover:underline disabled:opacity-50"
                disabled={busy === s.id}
                onClick={() => end({ id: s.id }, s.id)}
              >
                {busy === s.id ? "ending…" : "End"}
              </button>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        type="button"
        className={buttonClass()}
        disabled={busy === "others" || others.length === 0}
        onClick={() => end({ others: true }, "others")}
      >
        {busy === "others"
          ? "Ending…"
          : others.length === 0
            ? "No other devices"
            : `Sign out ${others.length} other device${others.length === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}
