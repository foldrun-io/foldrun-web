"use client";

// The one shape a setting takes: a card with fields, a footer with Save,
// Cancel while something changed, and what happened. Every form on a
// settings page is this plus its fields, so they all save the same way,
// disable the same way, and say "Saved" the same way.

import { useState, type FormEvent, type ReactNode } from "react";
import { buttonClass } from "./ui";

export function useSettingsForm<T>(initial: T, submit: (value: T) => Promise<void | T>) {
  const [value, setValue] = useState<T>(initial);
  const [saved, setSaved] = useState<T>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  const save = async () => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const next = await submit(value);
      const settled = next === undefined ? value : (next as T);
      setSaved(settled);
      setValue(settled);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setValue(saved);
    setError(null);
    setDone(false);
  };
  return { value, setValue, dirty, busy, error, done, save, reset };
}

export function SettingsForm({
  form,
  saveLabel = "Save",
  hint,
  compact = false,
  children,
}: {
  form: { dirty: boolean; busy: boolean; error: string | null; done: boolean; save: () => Promise<void>; reset: () => void };
  saveLabel?: string;
  /** A short sentence in the footer — where the value lives, what it changes. */
  hint?: ReactNode;
  /** Drop the card: no border, no footer bar, the Save button inline. For a
   *  control that already sits inside a row of its own — a settings page
   *  wants the card, a list of twenty workspaces wants one line each, and
   *  the card chrome repeated twenty times is what made that page a stack
   *  of tall empty boxes. */
  compact?: boolean;
  children: ReactNode;
}) {
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (form.dirty && !form.busy) void form.save();
  };
  if (compact) {
    return (
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
        {children}
        <button type="submit" disabled={!form.dirty || form.busy} className={buttonClass("secondary")}>
          {form.busy ? "Saving…" : saveLabel}
        </button>
        {form.dirty && !form.busy && (
          <button type="button" onClick={form.reset} className={buttonClass("minimal")}>
            Cancel
          </button>
        )}
        {form.error && <span className="text-xs text-red-600">{form.error}</span>}
        {form.done && !form.dirty && <span className="text-xs text-emerald-600">Saved</span>}
      </form>
    );
  }
  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-line bg-surface">
      <div className="space-y-4 p-5">{children}</div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line-faint bg-sunken/60 px-5 py-3">
        <button type="submit" disabled={!form.dirty || form.busy} className={buttonClass("primary")}>
          {form.busy ? "Saving…" : saveLabel}
        </button>
        {form.dirty && !form.busy && (
          <button type="button" onClick={form.reset} className={buttonClass("minimal")}>
            Cancel
          </button>
        )}
        {form.done && !form.dirty && <span className="text-xs text-emerald-600">Saved</span>}
        {form.error && <span className="text-xs text-red-600">{form.error}</span>}
        {hint && <span className="ml-auto text-xs text-fg-subtle">{hint}</span>}
      </div>
    </form>
  );
}

/** A labelled field: the label above, the control, one line under it. */
export function Field({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{label}</span>
      <div className="mt-1">{children}</div>
      {help && <span className="mt-1 block text-xs text-fg-subtle">{help}</span>}
    </label>
  );
}
