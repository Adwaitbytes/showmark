# Showmark design system (`src/ui`)

Every screen in Showmark is built from these primitives. The visual idea is a passport and its stamps: the page is a desk, documents are paper, every mark is ink, and one vermilion stamp is the only loud thing on a screen. Tokens were locked at Gate 1 (docs/INTERFACES.md section 5) and live in `src/app/globals.css`.

No component library is used. Import primitives by path (`@/ui/Button`, `@/ui/stamp/Stamp`); there is no barrel file, so client and server modules never get bundled together by accident. See every primitive and state at `/dev/ui` in development (hidden in production), plus full-page previews at `/dev/ui/traction`, `/dev/ui/event` and `/dev/ui/passport`.

## Rules for every screen

- Use the role colours only: `paper`, `sheet`, `paper-deep`, `ink`, `ink-soft`, `ink-faint`, `vermilion`, `vermilion-ink`, `on-vermilion`, `stamp-blue`, `ledger-green`, `rule`, `rule-soft`, `focus`, `chart-1`, `chart-2`. Tailwind's default palette is removed, so `bg-zinc-100` does not exist.
- Never write `dark:` for colour. The night desk theme swaps the values of the same variables, so `bg-paper text-ink` is right in both themes.
- One vermilion primary action per screen (`<Button variant="primary">`). Vermilion text below 24 px uses `text-vermilion-ink`.
- Radius: `rounded-doc` (2 px) for anything that is a document or control, `rounded-pill` only for compact status marks and round things. No other radii.
- Spacing uses the 4 px scale, steps 1 2 3 4 6 8 12 16 24 32.
- Mono (`font-mono`) is only for addresses, amounts, hashes and code. Display serif (`font-display`) is only for headings and big names.
- Every page renders exactly one `<main id="main">` (use `<PageShell>`); the skip link in the root layout targets it.
- Tap targets are at least 44 px (`min-h-11`). Focus is a 2 px stamp-blue ring from the base styles; do not remove outlines.
- Copy: sentence case, plain words, specific numbers, no em or en dashes, no exclamation marks, no emoji. Errors say what happened and what to do next.
- Never render fixture data outside `/dev/ui`. When there is no data, render a designed empty state.

## Tokens

| Token | Paper (light) | Night desk | Use |
|---|---|---|---|
| `--paper` | #F3EFE6 | #12110F | Page background, the desk |
| `--sheet` | #FAF7F0 | #1A1916 | Documents lying on the desk |
| `--paper-deep` | #E9E3D6 | #23211D | Insets, slips, chips, skeletons |
| `--ink` | #141311 | #EDE7DB | Text, rules, primary marks |
| `--ink-soft` | #4A4640 | #A9A296 | Secondary text |
| `--ink-faint` | #67615A | #938C80 | Tertiary text, footnotes |
| `--vermilion` | #E4442B | #EB5A40 | The one accent: primary action, the check-in stamp |
| `--vermilion-ink` | #B33822 | #EB5A40 | Vermilion at text sizes (errors, small labels) |
| `--on-vermilion` | #141311 | #12110F | Text on a vermilion fill |
| `--stamp-blue` | #2B4BD9 | #8DA0FF | Secondary marks, links on data, focus ring |
| `--ledger-green` | #1F6B45 | #58B987 | Success |
| `--rule` | #8A8378 | #757064 | Control borders (3:1) |
| `--rule-soft` | ink at 13% | ink at 12% | Decorative hairlines |
| `--chart-1` / `--chart-2` | #2B4BD9 / #E4442B | #7489F2 / #EB5A40 | Two-series charts, validated for colour-blind separation |
| `--night` | #12110F | #12110F | Constant |

Type: Instrument Serif (display, `font-display`), Geist (interface, `font-sans`), Geist Mono (`font-mono`), all loaded with `next/font/google` in the root layout.

| Class | Size | Line height | Typical use |
|---|---|---|---|
| `text-xs` | 0.75 rem | 1.45 | Field labels on the passport, axis labels |
| `text-sm` | 0.875 rem | 1.5 | Hints, footnotes, metadata |
| `text-base` | 1 rem | 1.6 | Body and controls |
| `text-md` | 1.125 rem | 1.6 | Lead paragraphs on phones |
| `text-lg` | 1.375 rem | 1.35 | Lead paragraphs, small headings |
| `text-xl` | 1.75 rem | 1.18 | Serif card titles |
| `text-2xl` | 2.25 rem | 1.08 | Section headings |
| `text-3xl` | 3 rem | 1.02 | Page headings on desktop |
| `text-4xl` | 4 rem | 0.98 | Page titles |
| `text-5xl` | 5.5 rem | 0.94 | The landing headline |

Motion: the stamp press is `animate-stamp-press` (180 ms, `cubic-bezier(.2,1.4,.4,1)`, a small overshoot); page changes cross-fade over 220 ms with React `<ViewTransition>` and the header stays still. Under `prefers-reduced-motion` all animation and view transitions are instant and every element is shown in its final state.

Themes: the system preference decides by default. `<ThemeToggle>` cycles device, paper and night desk, stores the choice in `localStorage` (`showmark-theme`), and a script in the root layout applies it before first paint via `<html data-theme="light|dark">`.

## Contrast (WCAG 2.2, computed, not eyeballed)

Every text pair passes AA (4.5:1 for normal text). Pairs below 4.5 are used only for large display text or non-text graphics, which need 3:1.

| Text on background | Paper | Night desk |
|---|---|---|
| ink on paper / sheet / paper-deep | 16.18 / 17.35 / 14.52 | 15.33 / 14.28 / 13.05 |
| ink-soft on paper / sheet / paper-deep | 8.17 / 8.76 / 7.33 | 7.45 / 6.94 / 6.35 |
| ink-faint on paper / sheet / paper-deep | 5.33 / 5.72 / 4.78 | 5.66 / 5.28 / 4.82 |
| stamp-blue on paper / sheet / paper-deep | 5.88 / 6.31 / 5.28 | 7.73 / 7.20 / 6.58 |
| ledger-green on paper / sheet | 5.64 / 6.04 | 7.82 / 7.29 |
| vermilion-ink on paper / sheet / paper-deep | 5.22 / 5.60 / 4.69 | 5.45 / 5.08 / 4.64 |
| on-vermilion on vermilion (primary button) | 4.56 | 5.45 |
| paper on ink (secondary button, hover ink-soft) | 16.18 (8.17) | 15.33 (7.45) |
| vermilion on paper (display text 48 px and up, fills only) | 3.55 | 5.45 |
| rule on paper / sheet (control borders, non-text) | 3.27 / 3.51 | 3.83 / 3.56 |

QR codes inside `<QrFrame>` are always #141311 on #FAF7F0 (17.35:1) in both themes, because many phone cameras fail on inverted codes.

## Primitives

### Layout

- **`PageShell`** (`@/ui/PageShell`): header, `<main id="main">` and footer. `<PageShell current="traction">…</PageShell>`. Pass `footer={false}` for focused task screens.
- **`SiteHeader`**, **`SiteFooter`**: used by PageShell. Pass `current` (a `NavKey` from `@/lib/copy/site`) to mark the active section. The header keeps its place during view transitions.
- **`Container`**: page gutters (16, 24, 32 px) and max widths. `width="prose" | "default" | "wide"`.
- **`Sheet`** and **`SheetSection`**: the document surface. `tone="sheet"` (raised, grain, shadow) or `tone="inset"` (a slip printed into the page). `edge="stub-bottom" | "stub-top" | "stub-both"` cuts a real perforated edge with a CSS mask.
- **`Perforation`**: a tear line with half-circle bites, horizontal or `orientation="vertical"`. Put it between two `SheetSection`s. Set `--notch` on a parent if the sheet sits on something other than the page.
- **`Prose`**: long-form reading. Write plain `h1`, `p.lead`, `h2`, `ul`, `pre`, `table` inside and it is typeset.
- **`Wordmark`**, **`ShowmarkSeal`**: the name in Instrument Serif with the vermilion seal.

### Actions and input

- **`Button`**: `variant="primary" | "secondary" | "quiet"`, `size="md" | "lg"`, `block`, `leading`, `trailing`. With `href` it renders a Next `Link`; with `href` and `external` an `<a target="_blank">` with an icon and a spoken "opens in a new tab"; otherwise a `<button>` that takes `pending` (disables and shows an ink pulse, sets `aria-busy`).
  `<Button variant="primary" pending={sending} onClick={checkIn}>Check in</Button>`
- **`TextField`**, **`SelectField`**, **`TextareaField`** (`@/ui/Field`): label, optional hint, error and the control, wired with `aria-describedby` and `aria-invalid`. `id` is required. Add `mono` for addresses and amounts, `optional` to mark the label.
  `<TextField id="amount" label="Amount per verified person" hint="Paid once per person." mono error={errors.amount} />`
  Bare `Input`, `Select`, `Textarea` and the `Field` wrapper are exported for custom layouts.
- **`Tabs`** (client): in-page tabs with the WAI-ARIA keyboard pattern. `<Tabs label="Proof modes" tabs={[{ id, label, content }]} />`
- **`LinkTabs`**: route-level tabs as a nav with `aria-current`. `<LinkTabs label="Campaign" current={pathname} items={[{ href, label }]} />`
- **`ThemeToggle`** (client): cycles device, paper and night desk.
- **`CopyButton`** (client): copies a value, confirms in place and announces it. `<CopyButton value={hash} what="transaction hash" />`

### Chain data

- **`AddressChip`**: a `.qie` name when there is one, the short mono address, copy, and a link. `link="explorer" | "passport" | "none"`. `<AddressChip address={organizer} name={organizerName} />`
- **`Amount`**: token base units (decimal string) to a readable mono figure with its symbol. Truncates, never rounds up. QUSDC always shows cents. `<Amount value={campaign.attendeeAmount} symbol="QUSDC" usd={1.2} />`
- **`TxLink`**: a transaction on the QIE explorer, short hash plus icon. `<TxLink hash={tx} />` or `<TxLink hash={tx}>View on explorer</TxLink>`
- **`Ledger`** and **`LedgerRow`**: labelled figures joined by dotted leaders, as on a receipt. `total` emphasises the last row, `note` explains where a number comes from.
- **`StatusMark`**: the one place pills are used. `tone="live" | "scheduled" | "ended" | "attention" | "neutral"`. Static, never pulses.
- Formatters in `@/ui/format`: `formatTokenAmount`, `formatUsd`, `formatCount`, `formatPercent`, `formatDate`, `formatTime`, `formatEventWindow`, `shortAddress`, `shortHash`, `basisPointsToPercent`. Dates and times are always shown in IST and say so.

### Signature marks

- **`Guilloche`** (`@/ui/patterns/guilloche`): deterministic banknote line work from a seed. `variant="rosette"` (a seal, 400 by 400) or `variant="band"` (a strip). Each layer is one closed curve repeated through `<use>` with rotations or offsets, so a rosette is a few kilobytes. The same address gives the same pattern in any letter case; different addresses differ in lobe counts, wobble, the hypotrochoid inside and the ink pair. Pure geometry is exported as `guillocheGeometry(seed, variant)`.
  `<Guilloche seed={wallet} className="size-48" label="Your passport seal" />`
- **`stampSvg(params): string`** (`@/ui/stamp/stampSvg`): a rubber stamp as a standalone SVG string, safe on the server and in route handlers. The event id seeds the shape (round, oval or box) and the ink, so everyone at an event gets the same stamp; event plus holder seeds the tilt (2 to 9.5 degrees either way), so each impression lands differently. Mode 2 (door scans you) adds a second inner rim. All on-chain text is cleaned and XML-escaped. The ink-bleed filter roughens edges with `feTurbulence` and `feDisplacementMap`, thins coverage in soft patches and drops a few pinholes. `color: "css"` paints with theme variables; `color: "print"` uses fixed hex inks for images. `stampDataUri(params)` returns a base64 data URI. `stampSpec(params)` returns the shape, ink, tilt and spoken label.
- **`Stamp`** (`@/ui/stamp/Stamp`): the same artwork inline, tilted with CSS, multiplied onto paper. Size it with a width class. `press` plays the press once on mount.
  `<Stamp eventId={id} eventName={name} city={city} at={at} mode={mode} holder={pass} className="w-40" />`
- **`StampPress`** and **`pressHaptic()`** (client, `@/ui/stamp/StampPress`): replays the 180 ms press whenever `pressKey` changes and fires a 14 ms vibration where supported (Android Chrome; iOS ignores it). Call `pressHaptic()` inside the tap handler, because browsers only vibrate after a user gesture.
  `<StampPress pressKey={txHash}><Stamp {...stamp} /></StampPress>`
- **`QrFrame`**: registration corners and a quiet zone for door codes and attendee codes. Draw the QR modules in `currentColor`. `<QrFrame label="Door code for Campus meetup" caption="Scan with your phone camera" status="New code in 12 s">{svg}</QrFrame>`

### States

- **`Skeleton`**, **`SkeletonText`**, **`SkeletonStamp`**, wrapped in **`LoadingRegion label="Loading the event"`** so assistive tech hears one message.
- **`EmptyState`**: a blank stamp ring, a serif title, one or two sentences and the next action. `as="h1" | "h2" | "h3"` to fit the outline.
- **`ErrorState`**: a struck-through ring, what happened, what to do, an optional `reference` (error digest) and the recovery action.
- **`Notice`**: an inline slip with `tone="info" | "success" | "warning" | "danger"`; the tone is spoken, not only coloured.
- **`SectionBoundary`** (client, built on `catchError` from `next/error`): contains a failure to one section and offers Try again. Wrap server data sections in it, outside their `<Suspense>`.

## Data on server pages

Pages under `(public)` read through `@/server/queries` inside `<Suspense>`, call `connection()` (or `requestTime()` from `(public)/_components/load.ts`) so live numbers are read per request, and use `load()` to turn the server's `AppError` copy into an `ErrorState`. Each route has a `loading.tsx` skeleton and a designed not-found state.

## Visual QA

`node apps/web/e2e/visual/capture.mts` (with `pnpm --filter web dev --port 3100` running) writes full-page screenshots at 390 by 844 and 1440 by 900, paper and night desk, to `apps/web/e2e/visual/screenshots/`. `node apps/web/e2e/visual/icons.mts` re-renders the app icons from `/dev/ui/icons`.
