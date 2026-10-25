"use client";

// An incident or a maintenance window, on every dashboard page while it is
// live: amber for maintenance and minor incidents, red for a major one,
// with the latest update and a link to the status page. Reads the same open
// /api/status the public page reads, once a minute; says nothing when the
// platform is simply up. Not dismissable — it goes when the operator
// resolves it.

import { useEffect, useState } from "react";

interface Incident {
  id: string;
  kind: "incident" | "maintenance";
  title: string;
  impact: "minor" | "major" | "maintenance";
  status: string;
  startsAt: string;
  endsAt: string | null;
  updates: { at: string; status: string; body: string }[];
}

export function StatusBanner({ statusPage }: { statusPage: string }) {
  const [live, setLive] = useState<Incident[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { incidents?: Incident[]; maintenance?: Incident[] } | null) => {
          if (!alive || !d) return;
          const now = Date.now();
          const inWindow = (m: Incident) => Date.parse(m.startsAt) <= now && (!m.endsAt || Date.parse(m.endsAt) > now);
          setLive([...(d.incidents ?? []), ...(d.maintenance ?? []).filter(inWindow)]);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!live.length) return null;
  return (
    <>
      {live.map((i) => {
        const red = i.kind === "incident" && i.impact === "major";
        const last = i.updates.at(-1);
        return (
          <div
            key={i.id}
            role="status"
            className={`border-b px-6 py-2 text-sm ${red ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}
          >
            <span className="font-medium">{i.kind === "maintenance" ? "Maintenance" : red ? "Outage" : "Incident"}: {i.title}</span>
            {last && <> — {last.body}</>}{" "}
            <a href={statusPage} target="_blank" rel="noreferrer" className="whitespace-nowrap underline">
              Status page →
            </a>
          </div>
        );
      })}
    </>
  );
}
