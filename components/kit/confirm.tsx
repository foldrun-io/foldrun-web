"use client";

// The one confirmation dialog, on Radix's AlertDialog: focus is trapped and
// returned, it is announced as an alertdialog, and it is drawn like the
// kit's Dialog.
//
// `window.confirm` did this job in eleven places once, and it is the wrong
// tool for every one of them: the browser titles it with the *origin*, so a
// destructive action announces itself as "192.168.1.20 says" — the box people
// are trained to dismiss. It cannot name the dangerous button or show what is
// about to be deleted.
//
//   useConfirm()     a hook returning an async ask() — for the callbacks that
//                    read `if (!(await confirm({...}))) return;`
//   <ConfirmDialog>  the dialog itself, for a caller that owns its state
//
// Escape and the scrim both cancel, because the safe answer must be the easy
// one; focus lands on Cancel. Enter confirms only when the action is not
// destructive: a modal that deletes on a stray Enter has traded one accident
// for another.
import { useCallback, useRef, useState, type ReactNode } from "react";
import { AlertDialog as A } from "radix-ui";
import { Button } from "./button";

export interface ConfirmOptions {
  title: string;
  /** What actually happens, in the user's terms. The sentence people read. */
  body?: ReactNode;
  /** The affirmative button. Name the verb — "Delete", never "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, and no Enter-to-confirm. Default true: everything
   *  reaching for a confirmation is destructive until someone says it isn't. */
  destructive?: boolean;
}

export function ConfirmDialog({ open, options, onResolve }: { open: boolean; options: ConfirmOptions | null; onResolve: (ok: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  if (!options) return null;
  const destructive = options.destructive ?? true;
  return (
    <A.Root open={open} onOpenChange={(o) => !o && onResolve(false)}>
      <A.Portal>
        <A.Overlay className="fixed inset-0 z-50 bg-gray-950/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" onClick={() => onResolve(false)} />
        <A.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            cancelRef.current?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !destructive) {
              e.preventDefault();
              onResolve(true);
            }
          }}
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-line bg-surface text-left shadow-overlay outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="p-5 sm:p-6">
            <A.Title className="text-lg font-semibold text-fg">{options.title}</A.Title>
            {options.body ? (
              <A.Description asChild>
                <div className="mt-2 text-sm leading-relaxed text-fg-muted">{options.body}</div>
              </A.Description>
            ) : (
              <A.Description className="sr-only">{options.title}</A.Description>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line bg-sunken px-5 py-3 sm:px-6">
            <Button ref={cancelRef} variant="secondary" onClick={() => onResolve(false)}>
              {options.cancelLabel ?? "Cancel"}
            </Button>
            <Button variant={destructive ? "danger" : "primary"} onClick={() => onResolve(true)}>
              {options.confirmLabel ?? "Confirm"}
            </Button>
          </div>
        </A.Content>
      </A.Portal>
    </A.Root>
  );
}

/**
 * `const [confirm, confirmDialog] = useConfirm()` then
 * `if (!(await confirm({...}))) return;` — render `confirmDialog` alongside.
 * No provider: a dialog that is only ever one at a time needs no tree-wide
 * singleton.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);
  const ask = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ options, resolve })), []);
  const onResolve = useCallback((ok: boolean) => {
    setState((s) => {
      s?.resolve(ok);
      return null;
    });
  }, []);
  return [ask, <ConfirmDialog key="confirm" open={!!state} options={state?.options ?? null} onResolve={onResolve} />];
}
