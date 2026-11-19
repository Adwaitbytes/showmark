# Status

Updated 19 Nov 2026, 13:40 IST. Read this first to catch up in two minutes.

## Where we are

Gate 0 in progress (target: Fri 20 Nov morning).

| Workstream | State |
|---|---|
| Lead | Brief saved, rules in CLAUDE.md, name chosen (Showmark), chain probed, interfaces written, repo and Vercel project created |
| A Protocol | Building contracts and tests in `packages/contracts` |
| B Backend | Building relayer, indexer, API, database in `apps/web/src/server` and `src/app/api` |
| C Design and public pages | Building tokens, primitives, landing, traction, passport and docs pages |
| G SDK and MCP | Building `@showmark/sdk`, React components and the MCP server |
| Phase 0 research | Verifying QIE facts into `docs/PHASE0.md` |
| D, E, F (attendee, organizer, sponsor) | Start once the design primitives land |
| H Verification | Contract audit and QA start when A and the first screens are done |

## Blocked, and on whom

- Push to GitHub: needs the `workflow` scope on the gh token (Yathu, see NEEDS item 1).
- Neon and Upstash: need Yathu to run two provisioning commands (NEEDS item 2).
- Testnet deploy: needs testnet QIE on the deployer (NEEDS item 3). Until then contracts are proven on a local anvil chain with chain id 1983.
- Mainnet deploy: needs mainnet QIE and the Safe (NEEDS items 4 and 5), plus a clean security review.

## Wallets

| Role | Address | Key |
|---|---|---|
| Deployer | 0xA8C849C243BA940102d2deB99971e4c713411926 | `.env.local` only |
| Relayer | 0xAaca310b66413Ebbf240b59dFE75Fb873d903660 | `.env.local` only |

## Links

- Repo: https://github.com/23f2000979/showmark (push pending)
- Vercel project: showmark (team adwaitbytes-projects), root `apps/web`

## Next gate

Gate 0: Phase 0 written up, interfaces done, a contract on testnet, one relayed check-in end to end.
