"use client";

// The same fire time, in the reader's clock.
//
// A schedule is written in the zone the WORK belongs to — usually the
// audience's, not the author's — so the preview quotes that zone first. But
// someone checking whether a run will land while they are asleep needs it in
// their own, and doing that conversion in your head is exactly the kind of
// thing software should not ask for.
//
// Says nothing when the two zones agree, which is the common case and where a
// second reading would only be noise.

import { useViewerTime, useResolvedTimeZone } from "@/components/viewer-time";

export function ScheduleInYourTime({ iso, zone }: { iso: string | null; zone: string }) {
  const mine = useResolvedTimeZone();
  const text = useViewerTime(iso ?? "", { dateStyle: "medium", timeStyle: "short" });
  if (!iso || !mine || mine === zone || !text) return null;
  return <span className="text-fg-subtle"> · {text} your time</span>;
}
