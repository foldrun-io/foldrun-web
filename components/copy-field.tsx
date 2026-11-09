"use client";

// A value to copy — a flow's webhook URL. A read-only input with a Copy
// button, because a URL you have to select by hand is a URL you get one
// character short of.

import { useState } from "react";
import { Input } from "@foldrun/ui/react/input";
import { Button } from "@foldrun/ui/react/button";
import { Check, Copy } from "lucide-react";

export function CopyField({ value, className = "" }: { value: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="h-8 flex-1 font-mono text-xs" />
      <Button
        type="button"
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          } catch {
            // the input is selectable; the button was a convenience
          }
        }}
      >
        {done ? <Check aria-hidden /> : <Copy aria-hidden />}
        {done ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
