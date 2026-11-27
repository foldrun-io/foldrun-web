import type { Metadata } from "next";
import { Geist, Geist_Mono, Vazirmatn } from "next/font/google";
import "./globals.css";
import { requestTheme } from "@/server/theme";
import { $t, currentDir } from "@/i18n";
import { PageLocale } from "@/i18n/persian-provider";
import { DirectionProvider } from "@foldrun/ui/react/direction";
import { requestLocale, requestLocaleChoice } from "@/server/locale";

const sans = Geist({
  variable: "--font-sans-ui",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--font-mono-ui",
  subsets: ["latin"],
});

// Persian pages are set in Vazirmatn (owner, 27 Nov 2026). Not preloaded: an
// English page never asks for it, and a Persian one fetches it by the rule in
// globals.css. Latin letters inside Persian text stay in Geist.
const persian = Vazirmatn({
  variable: "--font-fa-ui",
  subsets: ["arabic"],
  preload: false,
});

// The pitch moved to site/. This title is what a signed-in person sees in a
// browser tab full of tabs, so it names the product, not the argument for it.
export async function generateMetadata(): Promise<Metadata> {
  await requestLocale();
  return { title: "foldrun", description: $t("app.layout.agentsAreJustFoldersWriteThem") };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requestLocale();
  // Light, dark or system — the signed-in person's choice, written here so
  // the first paint is already in it (components/theme-model.ts).
  const theme = await requestTheme();
  const locale = await requestLocale();
  const choice = await requestLocaleChoice();
  return (
    <html
      lang={locale}
      dir={currentDir()}
      data-theme={theme}
      className={`${sans.variable} ${mono.variable} ${persian.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><PageLocale locale={locale} choice={choice}><DirectionProvider dir={currentDir()}>{children}</DirectionProvider></PageLocale></body>
    </html>
  );
}
