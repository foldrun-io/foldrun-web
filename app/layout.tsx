import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { requestTheme } from "@/server/theme";

const inter = Inter({
  variable: "--font-sans-ui",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--font-mono-ui",
  subsets: ["latin"],
});

// The pitch moved to site/. This title is what a signed-in person sees in a
// browser tab full of tabs, so it names the product, not the argument for it.
export const metadata: Metadata = {
  title: "foldrun",
  description: "Agents are just folders. Write them, check them, run them, deploy them.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Light, dark or system — the signed-in person's choice, written here so
  // the first paint is already in it (components/theme-model.ts).
  const theme = await requestTheme();
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${inter.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
