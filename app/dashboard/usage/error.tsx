"use client";

import { $t } from "@/i18n";
import { SegmentError } from "@/components/segment-states";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <SegmentError label={$t("usage.error.usage")} error={error} retry={retry} />;
}
