// Persian sentences, by area. A key with no Persian sentence yet shows the
// English one (i18n/index.ts lays these over the English catalog), and the
// parity test names it. SPIKE (FOL-429): a handful of sentences, enough to
// prove the language is chosen per request; the translation itself is later.
export const CATALOG_FA = {
  app: { layout: { agentsAreJustFoldersWriteThem: "ایجنت‌ها فقط پوشه‌اند." } },
  auth: {
    "login-page": {
      signIn: "ورود",
      yourAgentsKeptWorkingSeeWhat: "ایجنت‌های شما در این مدت کار کرده‌اند؛ ببینید چه کرده‌اند.",
    },
    "auth-form": { email: "ایمیل", password: "رمز عبور", signIn: "ورود" },
  },
} as const;
