/**
 * Renders the app icons from /dev/ui/icons (the Showmark seal set in Instrument Serif) into PNGs.
 *
 *   pnpm --filter web dev --port 3100
 *   node apps/web/e2e/visual/icons.mts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../..");
const baseUrl = process.env.VISUAL_BASE_URL ?? "http://localhost:3100";

const outputs = [
  { id: "icon-512", file: "public/icons/icon-512.png", transparent: false },
  { id: "icon-192", file: "public/icons/icon-192.png", transparent: false },
  { id: "maskable-512", file: "public/icons/maskable-512.png", transparent: false },
  { id: "apple-180", file: "src/app/apple-icon.png", transparent: false },
  { id: "favicon-64", file: "src/app/icon.png", transparent: true },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ colorScheme: "light", deviceScaleFactor: 1 });
  await page.goto(new URL("/dev/ui/icons", baseUrl).toString(), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  // The page paints paper and grain on <html> and <body>; clear them so the favicon keeps its alpha.
  await page.addStyleTag({ content: "html, body { background: transparent !important; } nextjs-portal { display: none !important; }" });
  for (const output of outputs) {
    const file = path.join(web, output.file);
    await page.locator(`#${output.id}`).screenshot({ path: file, omitBackground: output.transparent });
    console.log(`${output.id} -> ${path.relative(process.cwd(), file)}`);
  }
} finally {
  await browser.close();
}
