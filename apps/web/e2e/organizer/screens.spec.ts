import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { encodeAttendeeCode } from "../../src/lib/qr/payload";
import { createState, installMocks, sampleEvent, type MockState } from "./mocks";

// Visual QA: every organizer screen and state at phone and desktop sizes, plus the door at projector size, in the
// paper and night desk themes. Skipped unless CAPTURE=1, because it writes files instead of asserting behaviour.
//
//   CAPTURE=1 pnpm --filter web exec playwright test -c e2e/organizer screens

const outDir = path.join(__dirname, "screenshots");

interface Shot {
  name: string;
  path: string;
  state(): MockState;
  /** Door screens are judged in the viewport, the way a projector shows them. */
  door?: boolean;
  wallet?: boolean;
  prepare?(page: Page): Promise<void>;
}

const now = () => Math.floor(Date.now() / 1000);

const shots: Shot[] = [
  { name: "organize-signed-out", path: "/organize", state: () => createState({ signedIn: false }) },
  {
    name: "organize-events",
    path: "/organize",
    state: () => {
      const s = createState();
      s.events.set(2n, sampleEvent({ id: 2n, name: "Design systems reading group", venue: "Library, room 3", city: "Pune", startsAt: now() + 4 * 86400, endsAt: now() + 4 * 86400 + 7200, checkedIn: 0, capacity: 40 }));
      s.events.set(3n, sampleEvent({ id: 3n, name: "Campus web3 meetup", venue: "Seminar hall", city: "Chennai", startsAt: now() - 9 * 86400, endsAt: now() - 9 * 86400 + 10800, checkedIn: 112, capacity: 0 }));
      return s;
    },
    prepare: async (page) => {
      await expect(page.getByRole("heading", { name: "Your events" })).toBeVisible();
      await expect(page.getByText("Payouts waiting for you")).toBeVisible();
    },
  },
  { name: "organize-empty", path: "/organize", state: () => createState({ events: new Map() }), prepare: async (page) => void (await expect(page.getByText("No events yet")).toBeVisible()) },
  {
    name: "organize-error",
    path: "/organize",
    state: () => createState(),
    prepare: async (page) => {
      await page.unroute("**/api/events*");
      await page.route("**/api/events?*", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "upstream_unavailable", message: "A service Showmark depends on did not answer in time.", action: "Try again in a few seconds." } }) }));
      await page.reload();
      await expect(page.getByText("Your events did not load")).toBeVisible();
    },
  },
  { name: "new-event", path: "/organize/new", state: () => createState(), prepare: async (page) => void (await expect(page.getByRole("heading", { name: "Create an event" })).toBeVisible()) },
  {
    name: "new-event-errors",
    path: "/organize/new",
    state: () => createState(),
    prepare: async (page) => {
      await page.getByLabel("Event link").fill("showmark.app");
      await page.getByRole("button", { name: "Create the event" }).click();
      await expect(page.getByText("The event name needs at least 3 characters.")).toBeVisible();
    },
  },
  {
    name: "new-event-needs-gas",
    path: "/organize/new",
    state: () => createState({ balanceWei: 0n }),
    prepare: async (page) => {
      await page.getByLabel("Event name").fill("Builders night");
      await page.getByLabel("Venue").fill("Hall B");
      await page.getByLabel("City", { exact: true }).fill("Bengaluru");
      await expect(page.getByText("You need a little QIE for gas")).toBeVisible();
    },
  },
  {
    name: "new-event-created",
    path: "/organize/new",
    state: () => createState(),
    prepare: async (page) => {
      await page.getByLabel("Event name").fill("Builders night");
      await page.getByLabel("Venue").fill("Hall B, second floor");
      await page.getByLabel("City", { exact: true }).fill("Bengaluru");
      await expect(page.getByText(/gas fee of about/)).toBeVisible();
      await page.getByRole("button", { name: "Create the event" }).click();
      await expect(page.getByText("Recorded on QIE")).toBeVisible({ timeout: 30_000 });
    },
  },
  { name: "event-console", path: "/organize/1", state: () => createState(), prepare: async (page) => void (await expect(page.getByTestId("attendee-table")).toBeVisible()) },
  { name: "event-not-found", path: "/organize/99", state: () => createState(), prepare: async (page) => void (await expect(page.getByText("There is no event 99 on Showmark")).toBeVisible()) },
  { name: "door-authorize", path: "/door/1", door: true, state: () => createState(), prepare: async (page) => void (await expect(page.getByText(/gas fee of about/)).toBeVisible()) },
  { name: "door-connect", path: "/door/1", door: true, wallet: false, state: () => createState(), prepare: async (page) => void (await expect(page.getByText("Connect the organizer’s QIE Wallet")).toBeVisible()) },
  { name: "door-running", path: "/door/1", door: true, state: () => createState({ authorizeAll: true }), prepare: async (page) => void (await expect(page.getByTestId("door-qr")).toHaveAttribute("data-url", /\/c\//)) },
  {
    name: "door-before-open",
    path: "/door/1",
    door: true,
    state: () => {
      const s = createState({ authorizeAll: true });
      s.events.set(1n, sampleEvent({ startsAt: now() + 5 * 3600, endsAt: now() + 8 * 3600, checkedIn: 0 }));
      return s;
    },
    prepare: async (page) => void (await expect(page.getByText(/Check-in opens at/)).toBeVisible()),
  },
  { name: "door-not-found", path: "/door/99", door: true, state: () => createState({ authorizeAll: true }), prepare: async (page) => void (await expect(page.getByText("There is no event 99 on Showmark")).toBeVisible()) },
  {
    name: "door-settings",
    path: "/door/1",
    door: true,
    state: () => createState({ authorizeAll: true }),
    prepare: async (page) => {
      await expect(page.getByTestId("door-qr")).toHaveAttribute("data-url", /\/c\//);
      await page.getByRole("button", { name: "Settings" }).click();
      await expect(page.getByRole("heading", { name: "Door settings" })).toBeVisible();
    },
  },
  { name: "scan", path: "/door/1/scan", state: () => createState({ authorizeAll: true }), prepare: async (page) => void (await expect(page.getByText("Saved on this device")).toBeVisible()) },
  {
    name: "scan-failure",
    path: "/door/1/scan",
    state: () => createState({ authorizeAll: true }),
    prepare: async (page) => {
      await page.getByLabel("Or type a code").fill(encodeAttendeeCode({ eventId: 7n, attendee: "0x7ae3b1c9d4f20a8e6b5c3d1f9a2e4b6c8d0f1a3b", attendeeSig: `0x${"11".repeat(65)}` }));
      await page.getByRole("button", { name: "Check in", exact: true }).click();
      await expect(page.getByTestId("scan-result")).toBeVisible();
    },
  },
];

const viewports = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
] as const;
const projector = { name: "1920", width: 1920, height: 1080 } as const;

test.describe("organizer screenshots", () => {
  test.skip(!process.env.CAPTURE, "Set CAPTURE=1 to write screenshots");
  test.describe.configure({ timeout: 120_000 });

  for (const theme of ["light", "dark"] as const) {
    for (const shot of shots) {
      test(`${shot.name} ${theme}`, async ({ browser }) => {
        const sizes = shot.door ? [...viewports, projector] : viewports;
        for (const size of sizes) {
          const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, colorScheme: theme, reducedMotion: "reduce" });
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await installMocks(page, shot.state(), { wallet: shot.wallet });
          await page.goto(shot.path);
          await shot.prepare?.(page);
          // The Next dev badge is not part of the product.
          await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(400);
          await page.screenshot({ path: path.join(outDir, `${shot.name}--${size.name}--${theme}.png`), fullPage: !shot.door });
          expect(errors, `page errors on ${shot.name}`).toEqual([]);
          await context.close();
        }
      });
    }
  }
});
