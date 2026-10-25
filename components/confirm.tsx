"use client";

// The one confirmation dialog.
//
// `window.confirm` was doing this job in eleven places, and it is the wrong
// tool for every one of them: the browser renders it with the *origin* as
// the title, so a destructive action on this platform announces itself as
// "192.168.1.20 says" — a chrome-coloured box that looks like the phishing
// warnings people are trained to dismiss. It cannot say which button is the
// dangerous one, it cannot show what is about to be deleted, and it blocks
// the main thread while it waits.
//
// Two ways in, sharing one dialog:
//
//   useConfirm()   a hook returning an async ask() — for the callbacks that
//                  already read `if (!confirm(...)) return;`, which stay one
//                  line and keep their control flow.
//   <ConfirmDialog>  the dialog itself, for the rare caller that wants to
//                    own its open state.
//
// Escape and the backdrop both cancel, because the safe answer must be the
// easy one. Enter confirms only when the action is not destructive: a modal
// that deletes on a stray Enter has traded one accident for another.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { buttonClass } from "@/components/ui";

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

export function ConfirmDialog({
  open,
  options,
  onResolve,
}: {
  open: boolean;
  options: ConfirmOptions | null;
  onResolve: (ok: boolean) => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Focus lands on Cancel, not Confirm — the same reason Escape cancels.
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onResolve(false);
      if (e.key === "Enter" && !options?.destructive) onResolve(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, options?.destructive, onResolve]);

  if (!open || !options) return null;
  const destructive = options.destructive ?? true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={() => onResolve(false)}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        // text-left explicitly: the dialog renders wherever the hook was
        // called from — inside a right-aligned table cell, say — and a
        // question that inherits that alignment reads ragged.
        className="w-full max-w-md rounded-xl border border-line bg-surface p-5 text-left shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-sm font-semibold text-fg">
          {options.title}
        </h2>
        {options.body && (
          <div className="mt-1.5 text-sm leading-relaxed text-fg-muted">{options.body}</div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button ref={cancelRef} onClick={() => onResolve(false)} className={buttonClass("secondary")}>
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            onClick={() => onResolve(true)}
            className={
              destructive
                ? `${buttonClass("primary")} !bg-red-600 hover:!bg-red-700`
                : buttonClass("primary")
            }
          >
            {options.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * `const confirm = useConfirm()` then `if (!(await confirm({...}))) return;`
 *
 * Deliberately the same shape as the `window.confirm` it replaces, so a call
 * site changes by one `await` and keeps its early return. Returns the JSX to
 * render alongside — no provider, no context, because a dialog that is only
 * ever one-at-a-time does not need a tree-wide singleton to prove it.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<{
    options: ConfirmOptions;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const ask = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setState({ options, resolve })),
    [],
  );

  const onResolve = useCallback(
    (ok: boolean) => {
      setState((s) => {
        s?.resolve(ok);
        return null;
      });
    },
    [],
  );

  return [
    ask,
    <ConfirmDialog key="confirm" open={!!state} options={state?.options ?? null} onResolve={onResolve} />,
  ];
}
