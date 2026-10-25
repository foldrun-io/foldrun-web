"use client";

// Light, dark, or whatever your computer is set to. Saved to your profile, so
// it follows you to every browser you sign in on; applied at once by setting
// <html data-theme>, the same attribute the server writes on every page.

import { useState } from "react";
import { THEMES, THEME_LABELS, type Theme } from "@/components/theme-model";

const HINT: Record<Theme, string> = {
  system: "Follows your computer's light or dark setting.",
  light: "Always light.",
  dark: "Always dark.",
};

export function AppearanceForm({ current }: { current: Theme }) {
  const [theme, setTheme] = useState<Theme>(current);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function choose(next: Theme) {
    if (next === theme || busy) return;
    const before = theme;
    setError("");
    setBusy(true);
    setTheme(next);
    document.documentElement.dataset.theme = next;
    const res = await fetch("/api/me/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme: next }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      setTheme(before);
      document.documentElement.dataset.theme = before;
      setError(body?.error ?? "could not save your theme");
    }
  }

  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-md border border-line-strong bg-sunken p-0.5">
        {THEMES.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={theme === t}
            disabled={busy}
            onClick={() => choose(t)}
            className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
              theme === t ? "bg-surface text-fg shadow-sm ring-1 ring-line" : "text-fg-muted hover:text-fg"
            }`}
          >
            {THEME_LABELS[t]}
          </button>
        ))}
      </div>
      <p className="text-xs text-fg-muted">{HINT[theme]}</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
