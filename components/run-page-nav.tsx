"use client";

// The run page's keys: ← an older run, → a newer one, u back to the list.
// Typing in a field is never navigation.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function RunPageKeys({ older, newer, list }: { older: string | null; newer: string | null; list: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft" && older) router.push(older);
      else if (e.key === "ArrowRight" && newer) router.push(newer);
      else if (e.key === "u") router.push(list);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [older, newer, list, router]);
  return null;
}
