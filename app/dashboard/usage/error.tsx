"use client";

import { SegmentError } from "@/components/segment-states";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <SegmentError label="Usage" error={error} retry={retry} />;
}
