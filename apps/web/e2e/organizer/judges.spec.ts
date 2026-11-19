import { expect, test, type Page } from "@playwright/test";
import { createState, installMocks } from "./mocks";

// The judges' desk page with the pass API and the chain mocked: it must show the server's signed code as a QR,
// fetch a new one every 15 seconds, show the live count and say plainly who runs it.

async function readDeskQr(page: Page): Promise<string> {
  const hasDecoder = await page.evaluate(() => typeof (window as unknown as { jsQR?: unknown }).jsQR === "function");
  if (!hasDecoder) await page.addScriptTag({ path: require.resolve("jsqr/dist/jsQR.js") });
  return page.evaluate(async () => {
    const svg = document.querySelector('[data-testid="door-qr"] svg');
    if (!svg) return "";
    const size = 600;
    const img = new Image(size, size);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.outerHTML)}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size + 80;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 40, 40, size, size);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const decode = (window as unknown as { jsQR: (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null }).jsQR;
    return decode(data.data, data.width, data.height)?.data ?? "";
  });
}

test("shows the server's pass as a QR, refreshes it every 15 seconds and shows the count", async ({ page }) => {
  test.setTimeout(60_000);
  const state = await installMocks(page, createState(), { wallet: false });
  await page.goto("/judges");

  await expect(page.getByTestId("desk-name")).toHaveText("Builders night at Hall B");
  await expect(page.getByTestId("door-count")).toHaveText("41");
  await expect(page.getByTestId("desk-honest-line")).toHaveText(
    "This desk is run by the Showmark team so judges can try a real check-in from their own phone. Its pool is team-funded.",
  );

  const qr = page.getByTestId("door-qr");
  await expect(qr).not.toHaveAttribute("data-issued-at", "", { timeout: 5_000 });
  await expect.poll(() => readDeskQr(page)).toBe(state.deskUrls.at(-1));
  const first = await readDeskQr(page);
  const seen = state.deskUrls.length;
  expect(first).toMatch(/\/c\/1\.\d+\.[A-Za-z0-9_-]{87}#[A-Za-z0-9_-]{43}$/);

  // A new pass, with a new ticket key, within one rotation.
  await expect.poll(() => state.deskUrls.length, { timeout: 17_000 }).toBeGreaterThan(seen);
  await expect.poll(() => readDeskQr(page), { timeout: 5_000 }).toBe(state.deskUrls.at(-1));
  expect((await readDeskQr(page)).split("#")[1]).not.toBe(first.split("#")[1]);

  state.events.get(1n)!.checkedIn = 42;
  await expect(page.getByTestId("door-count")).toHaveText("42", { timeout: 8_000 });
});

test("says the desk is not open when the server has no desk configured", async ({ page }) => {
  await installMocks(page, createState({ desk: "not-open" }), { wallet: false });
  await page.goto("/judges");
  await expect(page.getByRole("heading", { name: "The judges' desk is not open yet" })).toBeVisible();
  await expect(page.getByTestId("door-qr")).toHaveCount(0);
});
