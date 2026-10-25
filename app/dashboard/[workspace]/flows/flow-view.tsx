"use client";

// Canvas or List — the same flow, two ways to edit it. The canvas is the
// default; the choice is remembered per viewer (this browser), and a phone
// width starts on the list, where a left-to-right canvas has no room.

import { useSyncExternalStore, type ReactNode } from "react";

type View = "canvas" | "list";
const KEY = "foldrun.flows.view";
const EVENT = "foldrun:flows-view";
// When storage is refused (a private window, blocked site data) the choice
// still holds for this page's life.
let memory: View | null = null;

function read(): View {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "canvas" || v === "list") return v;
  } catch {
    // storage unavailable — fall through to memory and the width rule
  }
  if (memory) return memory;
  return window.matchMedia("(max-width: 639px)").matches ? "list" : "canvas";
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

function choose(v: View) {
  memory = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // remembered in memory only
  }
  window.dispatchEvent(new Event(EVENT));
}

export function FlowView({ canvas, list, toolbar }: { canvas: ReactNode; list: ReactNode; toolbar?: ReactNode }) {
  // null on the server and the first client render: the choice lives in the
  // browser, so nothing is drawn until it is known — no flash of the wrong tab.
  const view = useSyncExternalStore<View | null>(subscribe, read, () => null);
  const tab = (v: View, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === v}
      onClick={() => choose(v)}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        view === v ? "bg-ink text-on-ink" : "text-fg-tertiary hover:bg-muted hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="mt-3 first:mt-0">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="How to show this flow" className="inline-flex gap-1 rounded-lg border border-line p-0.5">
          {tab("canvas", "Canvas")}
          {tab("list", "List")}
        </div>
        {toolbar && <div className="ml-auto flex flex-wrap items-center gap-1.5">{toolbar}</div>}
      </div>
      {view === null ? <div className="h-[300px]" /> : view === "canvas" ? canvas : list}
    </div>
  );
}
