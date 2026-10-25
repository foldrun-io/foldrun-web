"use client";

// A value to copy — a flow's webhook URL. A read-only input with a Copy
// button, because a URL you have to select by hand is a URL you get one
// character short of.

import { useState } from "react";
import { buttonClass, inputClass } from "@/components/ui";

export function CopyField({ value, className = "" }: { value: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className={inputClass("flex-1 font-mono text-xs")} />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          } catch {
            // the input is selectable; the button was a convenience
          }
        }}
        className={buttonClass("secondary")}
      >
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
