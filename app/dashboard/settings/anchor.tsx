"use client";

// An old link into the one-column Settings page — `/dashboard/settings#provider`,
// from the bar's banner, an email already sent, a bookmark — lands on the
// tab that section is on now, and scrolls to it there.

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SECTION_TAB, settingsHref } from "./tabs";

export function SettingsAnchor({ tenant, current, tabs }: { tenant: string; current: string; tabs: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const handled = useRef<string | null>(null);
  const allowed = tabs.join(",");
  useEffect(() => {
    const go = () => {
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (!id) return;
      // Once per address: a refresh after a save must not scroll the page back.
      const where = `${window.location.search}#${id}`;
      if (handled.current === where) return;
      handled.current = where;
      const tab = SECTION_TAB[id];
      if (!tab || tab === current) {
        document.getElementById(id)?.scrollIntoView({ block: "start" });
        return;
      }
      // A section on a tab this person does not have (Team without a
      // session) stays where it is.
      if (tab !== "backups" && tab !== "audit" && !allowed.split(",").includes(tab)) return;
      router.replace(settingsHref(id, tenant));
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [router, params, tenant, current, allowed]);
  return null;
}

/** The same for any page with ?tab= sections: an old `#section` link goes
 *  to `base?tab=<its tab>#section`. `base` carries the page's other query. */
export function HashTab({ sections, current, base, defaultTab }: { sections: Record<string, string>; current: string; base: string; defaultTab: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const go = () => {
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      if (!id) return;
      const where = `${window.location.search}#${id}`;
      if (handled.current === where) return;
      handled.current = where;
      const tab = sections[id];
      if (!tab || tab === current) {
        document.getElementById(id)?.scrollIntoView({ block: "start" });
        return;
      }
      const sep = base.includes("?") ? "&" : "?";
      router.replace(tab === defaultTab ? `${base}#${id}` : `${base}${sep}tab=${tab}#${id}`);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [router, params, sections, current, base, defaultTab]);
  return null;
}
