"use client";

// Light, dark, or whatever your computer is set to. Saved to your profile, so
// it follows you to every browser you sign in on; applied at once by setting
// <html data-theme>, the same attribute the server writes on every page.

import { useState } from "react";
import { THEMES, THEME_LABELS, type Theme } from "@/components/theme-model";
import { Segmented } from "@foldrun/ui/react/segmented";

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
      <Segmented role="radiogroup" label="Theme" value={theme} disabled={busy} onChange={(t) => choose(t as Theme)} items={THEMES.map((t) => ({ key: t, label: THEME_LABELS[t] }))} />
      <p className="text-xs text-fg-muted">{HINT[theme]}</p>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
