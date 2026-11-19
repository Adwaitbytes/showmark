/**
 * Visual QA capture: full-page screenshots of the public pages at phone (390 x 844) and desktop
 * (1440 x 900) sizes, in paper and night desk themes.
 *
 *   pnpm --filter web dev --port 3100
 *   node apps/web/e2e/visual/capture.mts                      # every route
 *   VISUAL_ROUTES=/,/traction node apps/web/e2e/visual/capture.mts
 *
 * Screenshots land in apps/web/e2e/visual/screenshots/{route}--{viewport}--{theme}.png.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "screenshots");
const baseUrl = process.env.VISUAL_BASE_URL ?? "http://localhost:3100";

const DEFAULT_ROUTES = [
  "/",
  "/traction",
  "/e/1",
  "/p/0x7aE3b1c9D4f20a8E6B5c3D1f9A2e4B6c8D0f1A3b",
  "/docs",
  "/docs/check-in",
  "/docs/organizers",
  "/docs/sponsors",
  "/docs/security",
  "/docs/sdk",
  "/dev/ui",
  "/dev/ui/traction",
  "/dev/ui/event",
  "/dev/ui/passport",
  "/this-page-does-not-exist",
];

const routes = (process.env.VISUAL_ROUTES ?? DEFAULT_ROUTES.join(",")).split(",").filter(Boolean);
const viewports = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
] as const;
const themes = (process.env.VISUAL_THEMES ?? "light,dark").split(",") as ("light" | "dark")[];

function slug(route: string): string {
  const trimmed = route.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "home";
  return trimmed.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 48);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const failures: string[] = [];
  try {
    for (const theme of themes) {
      for (const viewport of viewports) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: theme,
          reducedMotion: "reduce",
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => failures.push(`${route(page.url())}: ${error.message}`));
        for (const route of routes) {
          const response = await page.goto(new URL(route, baseUrl).toString(), { waitUntil: "networkidle" });
          await page.evaluate(() => document.fonts.ready);
          // Hide the Next.js dev indicator so screenshots show only the product.
          await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
          const file = path.join(outDir, `${slug(route)}--${viewport.name}--${theme}.png`);
          await page.screenshot({ path: file, fullPage: true });
          console.log(`${response?.status() ?? "???"} ${route} ${viewport.name} ${theme} -> ${path.relative(process.cwd(), file)}`);
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(`Page errors:\n${failures.join("\n")}`);
    process.exitCode = 1;
  }
}

function route(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

await main();
