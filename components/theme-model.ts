// Light or dark: one person's choice, and what it comes to on a given screen.
//
// Three choices, "system" the default: follow the operating system's
// prefers-color-scheme. The choice lives in the person's prefs (users.prefs,
// key `theme`) and the root layout writes it on <html data-theme>, so the
// first paint is already right — no flash of the wrong theme while a script
// works it out. "system" is resolved by CSS (globals.css), never by a guess
// on the server, which cannot know the OS setting.

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_PREF = "theme";

export const THEME_LABELS: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** The stored preference, or "system" for anything absent or unknown. */
export function themePreference(prefs: Record<string, unknown> | null | undefined): Theme {
  const v = prefs?.[THEME_PREF];
  return isTheme(v) ? v : "system";
}

/** What a screen shows: the choice, or the OS's when the choice is system. */
export function effectiveTheme(pref: Theme, systemPrefersDark: boolean): "light" | "dark" {
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return pref;
}
