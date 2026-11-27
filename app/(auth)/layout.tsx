// The sign-in pages share one thing: on a Persian host, the language switch
// in the corner (components/language-switch.tsx). Elsewhere it draws nothing.
import { LanguageCorner } from "@/components/language-switch";
import { requestLocale } from "@/server/locale";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  await requestLocale();
  return (
    <>
      <LanguageCorner />
      {children}
    </>
  );
}
