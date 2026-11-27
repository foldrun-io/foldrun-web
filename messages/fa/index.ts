// Persian sentences, by area. A key with no Persian sentence yet shows the
// English one (i18n/index.ts lays these over the English catalog), and the
// parity test names it. Today: the sign-in page's few sentences, enough to
// prove the language is chosen per request; the translation is its own work
// (foldrun-infra docs/persian-ir-plan.md, words from persian-glossary.md).
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
