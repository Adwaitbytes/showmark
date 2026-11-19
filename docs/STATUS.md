# Status

Updated 19 Nov 2026, 16:25 IST. Read this first to catch up in two minutes.

## Where we are

Gate 0 is met and Gate 1 is mostly met, two days early. The full product is live on https://showmark.vercel.app against QIE testnet, and the first real check-in and payout went through it end to end (see EVIDENCE.md).

| Area | State |
|---|---|
| Contracts | Done and audited twice. 218 tests, 100% coverage. A third bond fix (N2-01, N2-02) is being made, then a final audit pass |
| Testnet deployment | Live and source-verified on testnet.qie.digital (all nine contracts) |
| Relayer, indexer, API | Live on Vercel with Neon and Upstash. Indexer caught up, cron every 2 minutes |
| Attendee app | Live. Check-in to stamp in about 8 s on testnet. One bug: passport stuck after "Open my passport"; fix in progress |
| Organizer console and door screen | Built and tested with mocks; needs a live run with a real wallet |
| Sponsor console, reports, Safe App, QIEDEX funding | Built and tested with mocks; needs a live run with a real wallet |
| SDK and MCP server | Done: 85 and 15 tests, MCP live at /api/mcp |
| Docs | Architecture, security, SDK, Phase 0, decisions, launch kit drafts done; README pending |
| QA | Independent sweep of every production page at 390 and 1440 in progress |

## Blocked, and on whom

- Mainnet deployment: needs mainnet QIE on the deployer and relayer, and the protocol Safe (Yathu, NEEDS items 4 and 5).
- Real events and traction: event calendar and any outside sponsor (Yathu, NEEDS items 10 and 11).
- Wallet journeys on a phone: someone with QIE Wallet on a phone to test linking and withdrawing (Yathu, NEEDS item 9).

## Wallets

| Role | Address | Key |
|---|---|---|
| Deployer | 0xA8C849C243BA940102d2deB99971e4c713411926 | `.env.local` only |
| Relayer | 0xAaca310b66413Ebbf240b59dFE75Fb873d903660 | `.env.local` only |

## Links

- App: https://showmark.vercel.app
- Repo: https://github.com/Adwaitbytes/showmark
- Vercel project: showmark (team adwaitbytes-projects), root `apps/web`

## Next

1. Final bond fix, final audit pass, redeploy testnet with `scripts/set-vercel-env.sh 1983`.
2. Fix QA findings; live runs of organizer and sponsor journeys with a wallet.
3. README with live links and integrations table.
4. Mainnet deploy the moment funds and the Safe exist.
