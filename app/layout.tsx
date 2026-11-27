import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { requestTheme } from "@/server/theme";
import { $t, currentDir } from "@/i18n";
import { LocaleProvider } from "@/i18n/locale-context";
import { requestLocale } from "@/server/locale";

const sans = Geist({
  variable: "--font-sans-ui",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--font-mono-ui",
  subsets: ["latin"],
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
  return (
    <html
      lang={locale}
      dir={currentDir()}
      data-theme={theme}
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><LocaleProvider locale={locale}>{children}</LocaleProvider></body>
    </html>
  );
}
