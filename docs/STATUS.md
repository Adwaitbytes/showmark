# Status

Updated 19 Nov 2026, 18:25 IST. Read this first to catch up in two minutes.

## Where we are

Gate 1 met, Gate 2 waiting only on mainnet funds and the Safe. Everything runs on https://showmark.vercel.app against QIE testnet with the final audited contracts.

| Area | State |
|---|---|
| Contracts | Final. Four audit rounds, verdict go for mainnet. 238 tests, 100% coverage, verified on testnet |
| Mainnet | One command (`scripts/mainnet-launch.sh`) once the Safe and funds exist |
| Attendee journey | Live on testnet: scan to stamp 7.4 s and 8.9 s measured in Chrome; later production runs measured 11 to 15 s with outliers, latency work in progress |
| Judges' desk | Live on testnet at /judges with a server-held door key and a team-funded pool |
| Organizer, sponsor, link and withdraw | Proven live on testnet with real transactions (EVIDENCE.md, wallet journeys). Organizer withdraw bug found and being fixed |
| QA | Independent sweep: 1 blocker, 7 major, 19 minor found; all fixed or explained (QA_REPORT.md) |
| Docs | README, ARCHITECTURE, SECURITY (with audit table), SDK, DECISIONS, EVIDENCE, launch kit drafts |

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

1. Fix organizer withdraw, stale link state, and cut scan-to-stamp latency below 10 s on production (in progress).
2. Mainnet launch the moment the Safe and funds exist, then the Safe accepts ownership.
3. Refresh the launch kit (deck, demo script, judge Q&A, SUBMISSION.md) with mainnet addresses and real numbers.
