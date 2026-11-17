import { $t } from "@/i18n";
import { SegmentLoading } from "@/components/segment-states";

export default function Loading() {
  return <SegmentLoading label={$t("usage.loading.usage")} />;
}
