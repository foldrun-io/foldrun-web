// What Settings → Models says about an account that has nothing to run on.
// With own keys on that is "add an API key"; with them off (models.byok,
// a platform admin's switch) there is no key to add, so it is "needs a plan".
// A pure function so a test can hold it (the card is a client component).

import { $t } from "@/i18n";

export function noSupplyStatus(ownKeys: boolean): { label: string; text: string } {
  return ownKeys
    ? { label: $t("components.model-key-status.noKey"), text: $t("components.model-key-status.runsOnThisAccountAreRefused") }
    : { label: $t("components.model-key-status.noPlan"), text: $t("components.model-key-status.thisAccountNeedsAPlanRuns") };
}
