"use client";

// Links written before the page had tabs name a section by its anchor —
// the notify: failure email says `/triggers#deliveries`. Each anchor now
// lives on a tab; this opens that tab when the page is reached that way.

import { useEffect } from "react";

const TAB_OF: Record<string, string> = { deliveries: "outbound", filters: "deliveries", a2a: "a2a" };

export function HashTab({ tab }: { tab: string }) {
  useEffect(() => {
    const anchor = window.location.hash.replace(/^#/, "");
    const want = TAB_OF[anchor];
    if (!want || want === tab) return;
    const u = new URL(window.location.href);
    u.searchParams.set("tab", want);
    window.location.replace(u.toString());
  }, [tab]);
  return null;
}
