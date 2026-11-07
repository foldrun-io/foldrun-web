"use client";

// Asking for a few words: a name for a saved search, an instruction for a
// new step, a link to copy. The kit's stand-in for window.prompt (owner rule:
// no browser dialogs), on the kit's Dialog.
//
//   const [ask, promptDialog] = usePrompt();
//   const v = await ask({ title, fields: [{ name: "name", label: "Name" }], submit: "Save" });
//   if (!v) return;            // cancelled
//   v.name                     // what was typed
//
// Render `promptDialog` beside the caller. One at a time, no provider.
import * as React from "react";
import { useCallback, useState } from "react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";
import { Button } from "./button";
import { Input, Textarea, labelClass } from "./input";
import { Select } from "./select";

export type PromptField =
  | { name: string; label: string; type?: "text" | "textarea"; placeholder?: string; required?: boolean; initial?: string; readOnly?: boolean }
  | { name: string; label: string; type: "select"; options: { value: string; label: string }[]; required?: boolean; initial?: string };

export interface PromptOptions {
  title: string;
  body?: React.ReactNode;
  fields: PromptField[];
  /** The affirmative button, named for what it does. */
  submit: string;
  /** No Cancel button: the dialog only shows something (a link to copy). */
  noCancel?: boolean;
}

function PromptForm({ options, onResolve }: { options: PromptOptions; onResolve: (v: Record<string, string> | null) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(options.fields.map((f) => [f.name, f.initial ?? ""])));
  const missing = options.fields.some((f) => f.required && !values[f.name]?.trim());
  const set = (name: string, v: string) => setValues((x) => ({ ...x, [name]: v }));
  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        if (!missing) onResolve(values);
      }}
    >
      <DialogHeader>
        <DialogTitle>{options.title}</DialogTitle>
        {options.body ? <DialogDescription asChild><div>{options.body}</div></DialogDescription> : <DialogDescription className="sr-only">{options.title}</DialogDescription>}
      </DialogHeader>
      <DialogBody className="space-y-3">
        {options.fields.map((f, i) => (
          <label key={f.name} className="block space-y-1">
            <span className={labelClass}>{f.label}</span>
            {f.type === "select" ? (
              <Select autoFocus={i === 0} value={values[f.name]} onValueChange={(v) => set(f.name, v)} className="w-full">
                {!f.required && <option value="">—</option>}
                {f.required && !values[f.name] && <option value="">Choose…</option>}
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : f.type === "textarea" ? (
              <Textarea autoFocus={i === 0} rows={2} value={values[f.name]} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} className="text-sm" />
            ) : (
              <Input
                autoFocus={i === 0}
                readOnly={f.readOnly}
                onFocus={f.readOnly ? (e) => e.currentTarget.select() : undefined}
                value={values[f.name]}
                placeholder={f.placeholder}
                onChange={(e) => set(f.name, e.target.value)}
                className={f.readOnly ? "font-mono text-xs" : undefined}
              />
            )}
          </label>
        ))}
      </DialogBody>
      <DialogFooter>
        {!options.noCancel && (
          <Button variant="secondary" onClick={() => onResolve(null)}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={missing}>
          {options.submit}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The third value is whether a prompt is open (for a page that routes keys). */
export function usePrompt(): [(options: PromptOptions) => Promise<Record<string, string> | null>, React.ReactNode, boolean] {
  const [state, setState] = useState<{ options: PromptOptions; resolve: (v: Record<string, string> | null) => void } | null>(null);
  const ask = useCallback((options: PromptOptions) => new Promise<Record<string, string> | null>((resolve) => setState({ options, resolve })), []);
  const onResolve = useCallback((v: Record<string, string> | null) => {
    setState((s) => {
      s?.resolve(v);
      return null;
    });
  }, []);
  return [
    ask,
    <Dialog key="prompt" open={!!state} onOpenChange={(o) => !o && onResolve(null)}>
      <DialogContent size="sm">{state && <PromptForm key={state.options.title} options={state.options} onResolve={onResolve} />}</DialogContent>
    </Dialog>,
    !!state,
  ];
}

/** "Copy this link" when the clipboard refuses: the link, selected, in a
 *  dialog — what window.prompt was used for. */
export function useCopyFallback(): [(url: string, title?: string) => void, React.ReactNode] {
  const [ask, dialog] = usePrompt();
  const show = useCallback(
    (url: string, title = "Copy this link") => {
      void ask({ title, fields: [{ name: "url", label: "Link", initial: url, readOnly: true }], submit: "Done", noCancel: true });
    },
    [ask],
  );
  return [show, dialog];
}
