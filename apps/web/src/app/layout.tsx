import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif, Noto_Sans_Devanagari, Tiro_Devanagari_Hindi } from "next/font/google";
import { ViewTransition } from "react";
import { SITE } from "@/lib/copy/site";
import { THEME_STORAGE_KEY } from "@/ui/theme";
import "./globals.css";
import { SkipLink } from "@/ui/SkipLink";

// Only Geist, the interface face, is preloaded: it sets the text on every screen, including the
// check-in route, where preloading three fonts held back the first script by about a second on 4G.
// The serif and mono faces swap in when first used. adjustFontFallback sizes a local fallback to
// each font's metrics so the swap barely moves the layout.
const display = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
  preload: false,
  adjustFontFallback: true,
  fallback: ["Georgia", "Times New Roman", "serif"],
});

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
  preload: true,
  adjustFontFallback: true,
  fallback: ["Arial", "system-ui", "sans-serif"],
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
  preload: false,
  adjustFontFallback: true,
  fallback: ["ui-monospace", "Menlo", "monospace"],
});

// Hindi copy: Geist and Instrument Serif have no Devanagari, so these fill in for those glyphs only.
// Not preloaded; the browser fetches them only when a page actually contains Devanagari text.
const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  variable: "--font-devanagari",
  display: "swap",
  preload: false,
});

const devanagariDisplay = Tiro_Devanagari_Hindi({
  weight: "400",
  subsets: ["devanagari"],
  variable: "--font-devanagari-display",
  display: "swap",
  preload: false,
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: `${SITE.name}: sponsors pay only for people who actually show up`, template: `%s | ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  appleWebApp: { capable: true, title: SITE.name, statusBarStyle: "default" },
  formatDetection: { telephone: false, address: false, email: false },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name}: sponsors pay only for people who actually show up`,
    description: SITE.description,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3efe6" },
    { media: "(prefers-color-scheme: dark)", color: "#12110f" },
  ],
  colorScheme: "light dark",
};

// Runs before first paint so a saved paper or night desk choice never flashes the wrong theme.
const restoreTheme = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} ${devanagari.variable} ${devanagariDisplay.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: restoreTheme }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <SkipLink />
        <ViewTransition>{children}</ViewTransition>
      </body>
    </html>
  );
}
