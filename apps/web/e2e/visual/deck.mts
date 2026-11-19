/**
 * Screenshots every slide of /deck: 1920 x 1080 (projector) and 390 x 844 (phone), paper theme,
 * plus slide 1 with speaker notes and the whole phone scroll (deck-all--390.png). Output: e2e/visual/screenshots/deck-{nn}--{1920|390}.png
 *
 *   node apps/web/e2e/visual/deck.mts
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "screenshots");
const baseUrl = process.env.VISUAL_BASE_URL ?? "http://localhost:3100";

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const viewport of [
    { name: "1920", width: 1920, height: 1080 },
    { name: "390", width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport, colorScheme: "light", reducedMotion: "reduce" });
    page.on("pageerror", (error) => console.error(`page error: ${error.message}`));
    await page.goto(new URL("/deck", baseUrl).toString(), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.waitForTimeout(5000);
    await page.addStyleTag({ content: 'a[href="#main"] { display: none !important; }' });
    if (viewport.name === "390") {
      // The phone deck is one vertical scroll; keep the whole of it as well as each slide's first screen.
      await page.screenshot({ path: path.join(outDir, "deck-all--390.png"), fullPage: true });
    }
    for (let n = 1; n <= 10; n++) {
      const slide = page.locator(`[data-slide="${n}"]`);
      // scrollIntoView scrolls whichever box owns the scroll: the window on phones, <main> on a projector.
      await slide.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "instant" }));
      await page.waitForTimeout(300);
      await page.waitForTimeout(n === 3 ? 1500 : 250);
      const file = path.join(outDir, `deck-${String(n).padStart(2, "0")}--${viewport.name}.png`);
      await page.screenshot({ path: file });
      console.log(path.relative(process.cwd(), file));
    }
    if (viewport.name === "1920") {
      await page.goto(new URL("/deck?notes=1#1", baseUrl).toString(), { waitUntil: "load" });
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.locator('[data-slide="1"]').screenshot({ path: path.join(outDir, "deck-01-notes--1920.png") });
    }
    await page.close();
  }
} finally {
  await browser.close();
}
