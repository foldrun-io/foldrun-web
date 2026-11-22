"use client";

// The devices you are signed in on.
//
// This page used to explain that sessions were signed statements rather than
// stored rows, so changing your password did not sign anyone out and the only
// way to end them all was rotating the install key — which signs out every
// person on the install. That was true, and it was the gap. Sessions are rows
// now, so the honest answer is a list and a button.

import { $el, $rich, $t } from "@/i18n";
import { useEffect, useState } from "react";
import { buttonVariants } from "@foldrun/ui/react/button";
import { LocalTime } from "@/components/local-time";
import { Tag } from "@foldrun/ui/react/page";

interface Row {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  method?: "password" | "email-code";
  isCurrent: boolean;
}

/** A user-agent string is not something to show a person. Name the shape. */
function describe(ua: string | null): string {
  if (!ua) return $t("profile.sessions.unknownDevice");
  const browser =
    /Edg\//.test(ua) ? $t("profile.sessions.edge")
    : /OPR\//.test(ua) ? $t("profile.sessions.opera")
    : /Chrome\//.test(ua) ? $t("profile.sessions.chrome")
    : /Safari\//.test(ua) ? $t("profile.sessions.safari")
    : /Firefox\//.test(ua) ? $t("profile.sessions.firefox")
    : $t("profile.sessions.browser");
  const os =
    /iPhone|iPad/.test(ua) ? "iOS"
    : /Android/.test(ua) ? $t("profile.sessions.android")
    : /Mac OS X/.test(ua) ? "macOS"
    : /Windows/.test(ua) ? $t("profile.sessions.windows")
    : /Linux/.test(ua) ? $t("profile.sessions.linux")
    : "";
  return os ? $t("profile.sessions.browserOnOs", { browser, os }) : browser;
}

export function SessionList() {
  const [state, setState] = useState<{ revocable: boolean; sessions: Row[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  // The answer is set when it arrives, never in the same tick as the call,
  // so the effect below only starts the request.
  const load = () =>
    fetch("/api/auth/sessions").then(async (res) => {
      if (!res.ok) return setError($t("profile.sessions.couldNotLoadYourSessions"));
      setState(await res.json());
    });
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
      return setError(b.error ?? $t("profile.sessions.couldNotEndThatSession"));
    }
    await load();
  };

  if (!state) return <p className="text-sm text-fg-muted">{$t("profile.sessions.loading")}</p>;

  if (!state.revocable) {
    return (
      <p className="text-sm text-fg-tertiary">
        {$rich("profile.sessions.thisInstallHasNoDatabaseSo", { code: (chunks) => <code className="font-mono text-xs">{chunks}</code> })}
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
                  <Tag className="ml-2">{$t("profile.sessions.thisDevice")}</Tag>
                )}
              </p>
              <p className="text-xs text-fg-muted">
                {$rich("profile.sessions.lastUsedStartedSignedInWith", { localTime: $el(<LocalTime iso={s.lastSeenAt} />), localTime2: $el(<LocalTime iso={s.createdAt} />) })}{" "}{s.method === "email-code" ? $t("profile.sessions.anEmailCode") : $t("profile.sessions.aPassword")}
              </p>
            </div>
            {!s.isCurrent && (
              <button
                type="button"
                className="shrink-0 text-xs text-danger hover:underline disabled:opacity-50"
                disabled={busy === s.id}
                onClick={() => end({ id: s.id }, s.id)}
              >
                {busy === s.id ? $t("profile.sessions.ending") : $t("profile.sessions.end")}
              </button>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="text-xs text-danger">{error}</p>}

      <button
        type="button"
        className={buttonVariants({ variant: "primary" })}
        disabled={busy === "others" || others.length === 0}
        onClick={() => end({ others: true }, "others")}
      >
        {busy === "others"
          ? $t("profile.sessions.ending2")
          : others.length === 0
            ? $t("profile.sessions.noOtherDevices")
            : $t("profile.sessions.signOutOtherDevice", { length: String(others.length), v1: others.length })}
      </button>
    </div>
  );
}
