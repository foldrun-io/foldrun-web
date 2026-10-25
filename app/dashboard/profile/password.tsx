"use client";

// Change your password. Three fields and one rule the server also enforces —
// the confirmation is checked here because a typo you can see immediately is
// better than a round trip that says "not your current password" about the
// wrong field.

import { useState } from "react";
import { buttonClass, inputClass, FIELD_LABEL_CLASS } from "@/components/ui";

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [state, setState] = useState<{ error?: string; done?: string }>({});
  const [busy, setBusy] = useState(false);

  const mismatch = again.length > 0 && next !== again;

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setState({});
        if (next !== again) return setState({ error: "the two new passwords do not match" });
        setBusy(true);
        const res = await fetch("/api/auth/password", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ current, next }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setBusy(false);
        if (res.ok) {
          setState({ done: body.message ?? "Changed." });
          setCurrent("");
          setNext("");
          setAgain("");
        } else {
          setState({ error: body.error ?? "could not change your password" });
        }
      }}
    >
      <div className="grid gap-3">
        <label className="block sm:max-w-xs">
          <span className={`${FIELD_LABEL_CLASS} pb-1`}>Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={inputClass("w-full py-2")}
          />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={`${FIELD_LABEL_CLASS} pb-1`}>New password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className={inputClass("w-full py-2")}
          />
        </label>
        <label className="block">
          <span className={`${FIELD_LABEL_CLASS} pb-1`}>New password again</span>
          <input
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            className={inputClass("w-full py-2")}
          />
        </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line-faint pt-3">
        <button
          type="submit"
          disabled={busy || !current || next.length < 8 || mismatch}
          className={buttonClass("primary")}
        >
          {busy ? "Changing…" : "Change password"}
        </button>
        {mismatch && <span className="text-xs text-red-600">The two new passwords do not match.</span>}
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
        {state.done && <span className="text-xs text-green-700">{state.done}</span>}
        {!mismatch && !state.error && !state.done && (
          <span className="text-xs text-fg-muted">At least 8 characters.</span>
        )}
      </div>
    </form>
  );
}
