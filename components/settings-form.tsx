"use client";

// The one shape a setting takes: cloudhost's settings card — a title and a
// line about it, the fields, and a footer with a quiet note on the left and
// Save on the right (Cancel while something changed, and what happened).
// Every form on a settings page is this plus its fields, so they all save
// the same way, disable the same way, and say "Saved" the same way.

import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "./kit/button";
import { cn } from "./kit/cn";

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
  title,
  description,
  id,
  compact = false,
  children,
}: {
  form: { dirty: boolean; busy: boolean; error: string | null; done: boolean; save: () => Promise<void>; reset: () => void };
  saveLabel?: string;
  /** A short sentence in the footer — where the value lives, what it changes. */
  hint?: ReactNode;
  /** The card's title and its line (cloudhost's settings card). */
  title?: ReactNode;
  description?: ReactNode;
  id?: string;
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
        <Button type="submit" variant="secondary" disabled={!form.dirty || form.busy}>
          {form.busy ? "Saving…" : saveLabel}
        </Button>
        {form.dirty && !form.busy && (
          <Button type="button" variant="ghost" onClick={form.reset}>
            Cancel
          </Button>
        )}
        {form.error && <span className="text-xs text-danger">{form.error}</span>}
        {form.done && !form.dirty && <span className="text-xs text-success">Saved</span>}
      </form>
    );
  }
  return (
    <form id={id} onSubmit={onSubmit} className="mb-6 min-w-0 scroll-mt-24 overflow-hidden rounded-lg border border-line bg-surface">
      <div className="space-y-4 p-5 sm:p-6">
        {(title || description) && (
          <div className="min-w-0 space-y-1.5">
            {title && <h2 className="text-lg font-semibold text-fg">{title}</h2>}
            {description && <div className="text-sm text-fg-muted">{description}</div>}
          </div>
        )}
        {children}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-sunken px-5 py-3 text-sm text-fg-muted sm:px-6">
        <div className="min-w-0">
          {form.error ? (
            <span role="alert" className="text-danger">
              {form.error}
            </span>
          ) : form.done && !form.dirty ? (
            <span className="text-success">Saved</span>
          ) : (
            hint
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {form.dirty && !form.busy && (
            <Button type="button" variant="ghost" onClick={form.reset}>
              Cancel
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={!form.dirty || form.busy}>
            {form.busy ? "Saving…" : saveLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** A labelled field: the label above, the control, one line under it. */
export function Field({ label, help, children, className }: { label: string; help?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="block text-sm font-medium text-fg">{label}</span>
      <div className="mt-1.5">{children}</div>
      {help && <span className="mt-1.5 block text-xs text-fg-muted">{help}</span>}
    </label>
  );
}
