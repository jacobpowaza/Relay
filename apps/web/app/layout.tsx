import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

const geist = Geist({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-interface",
});

const geistMono = Geist_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Relay - Development that remembers",
  description: "Persistent development planning, evidence, context, and handoffs.",
};

const themeInitScript = `
(() => {
  try {
    const stored = window.localStorage.getItem("relay:appearance");
    const appearance = stored === "dark" || stored === "light" || stored === "system" ? stored : "light";
    const root = document.documentElement;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.remove("theme-light", "theme-dark", "theme-system");
    root.classList.add("theme-" + appearance);
    root.style.colorScheme = appearance === "dark" || (appearance === "system" && prefersDark) ? "dark" : "light";
  } catch {
    document.documentElement.classList.add("theme-light");
  }
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="theme-light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${geist.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
