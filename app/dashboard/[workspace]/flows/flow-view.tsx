"use client";

// Canvas or List — the same flow, two ways to edit it. The canvas is the
// default; the choice is remembered per viewer (this browser), and a phone
// width starts on the list, where a left-to-right canvas has no room.

import { useSyncExternalStore, type ReactNode } from "react";
import { ListOrdered, Network } from "lucide-react";
import { Segmented } from "@/components/kit/segmented";

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
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          role="tablist"
          label="How to show this flow"
          value={view ?? ""}
          onChange={(v) => choose(v as View)}
          items={[
            { key: "canvas", label: "Canvas", icon: <Network aria-hidden /> },
            { key: "list", label: "List", icon: <ListOrdered aria-hidden /> },
          ]}
        />
        {toolbar && <div className="ml-auto flex flex-wrap items-center gap-2">{toolbar}</div>}
      </div>
      {view === null ? <div className="h-[300px]" /> : view === "canvas" ? canvas : list}
    </div>
  );
}
