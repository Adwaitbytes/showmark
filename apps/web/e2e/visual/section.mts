/**
 * Screenshot one element (or the first viewport) of a page, for close-up design review.
 *
 *   node apps/web/e2e/visual/section.mts <url> <css selector | viewport> <out.png> [light|dark] [width]
 *   node apps/web/e2e/visual/section.mts http://localhost:3100/ "section[aria-labelledby=judges-desk]" /tmp/jd.png dark 390
 *
 * Prints console errors and page errors so a broken state is never mistaken for a design choice.
 */
import { chromium } from "@playwright/test";

const [, , url, selector, out, theme = "light", width = "1440"] = process.argv;
if (!url || !selector || !out || (theme !== "light" && theme !== "dark")) {
  console.error("usage: section.mts <url> <selector|viewport> <out.png> [light|dark] [width]");
  process.exit(2);
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: Number(width), height: 900 },
    colorScheme: theme,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") console.log(`console ${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => console.log(`page error: ${error.message}`));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  if (selector === "viewport") await page.screenshot({ path: out });
  else await page.locator(selector).first().screenshot({ path: out });
} finally {
  await browser.close();
}
