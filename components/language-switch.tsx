"use client";

// فارسی / English, on a Persian host only (FOLDRUN_FA_HOSTS): there a person
// may read the dashboard in either. On an English site this draws nothing,
// and the proxy ignores a stored choice. Choosing writes the choice where
// the proxy reads it (server/locale-host.ts) and reloads: the document's
// language is what every sentence is drawn from, so none is left behind in
// the old one.

import { use } from "react";
import { $t, currentLocale, type Locale } from "@/i18n";
import { LocaleChoiceContext } from "@/i18n/locale-context";
import { MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator } from "@foldrun/ui/react/menu";
import { Segmented } from "@foldrun/ui/react/segmented";

const COOKIE = "foldrun_locale";
const YEAR = 60 * 60 * 24 * 365;

function choose(next: Locale) {
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${COOKIE}=${next}; path=/; max-age=${YEAR}; samesite=lax${secure}`;
  location.reload();
}

/** The two-way control itself; null where the host offers one language. */
export function LanguageSwitch() {
  const offered = use(LocaleChoiceContext);
  if (!offered) return null;
  const now = currentLocale();
  return (
    <Segmented
      role="radiogroup"
      size="sm"
      label={$t("components.language-switch.language")}
      value={now}
      onChange={(l) => l !== now && choose(l as Locale)}
      items={[
        { key: "fa", label: $t("components.language-switch.persian") },
        { key: "en", label: $t("components.language-switch.english") },
      ]}
    />
  );
}

/** In the user menu: the two languages as the menu's own radio items, so
 *  the arrow keys reach them like every other item. Nothing on an English
 *  site. */
export function LanguageMenuItems() {
  const offered = use(LocaleChoiceContext);
  if (!offered) return null;
  const now = currentLocale();
  return (
    <>
      <MenuSeparator />
      <MenuLabel>{$t("components.language-switch.language")}</MenuLabel>
      <MenuRadioGroup value={now} onValueChange={(l) => l !== now && choose(l as Locale)}>
        <MenuRadioItem value="fa">{$t("components.language-switch.persian")}</MenuRadioItem>
        <MenuRadioItem value="en">{$t("components.language-switch.english")}</MenuRadioItem>
      </MenuRadioGroup>
    </>
  );
}

/** On the sign-in pages: in the corner, before anyone is signed in. */
export function LanguageCorner() {
  const offered = use(LocaleChoiceContext);
  if (!offered) return null;
  return (
    <div className="fixed end-4 top-4 z-10">
      <LanguageSwitch />
    </div>
  );
}
