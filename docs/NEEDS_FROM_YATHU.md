# Needs from Yathu

Written once. Everything else is being built without waiting. Secrets go only into `.env.local` at the repo root, never into chat or a web page.

## Blocking right now

0. **GitHub workflow scope.** The public repo is https://github.com/23f2000979/showmark but pushes are rejected because the CLI token lacks the `workflow` scope (needed for CI). Run `! gh auth refresh -h github.com -s workflow` in this session and approve in the browser.

1. **Database and Redis (free tiers).** The Vercel project `showmark` is linked. My attempt to provision through the Marketplace was blocked by the permission system, so please run these two lines from the repo root in this session:
   `! vercel integration add neon --yes --no-claim --name showmark-db`
   `! vercel integration add upstash/upstash-kv --yes --no-claim --name showmark-kv`
   They create a free Neon Postgres and a free Upstash Redis and attach the env vars to the project.

## Blocking mainnet (needed by Mon 23 Nov)

1. **Fund two addresses with mainnet QIE.** The keys were generated locally and live only in `.env.local` (gitignored). Send about 60 QIE to the deployer and 40 QIE to the relayer. The addresses are listed in `docs/STATUS.md` under "Wallets".
2. **Create the protocol Safe** on https://safe.qie.digital with team members as owners (2 of 3 suggested) and paste its address into `.env.local` as `SAFE_ADDRESS=0x...`. Contract ownership moves there after deployment.
3. **Reward budget** for the first campaigns, in QIE or QUSDC. Fund the first campaign yourself from the sponsor console once it is live so the pool is labelled as team-funded.

## Accounts and logins

4. **Hackathon registration** at https://hackathon.qie.digital/register with the team email, team name and which members are students.
5. **Team roster**: names, GitHub usernames, colleges, owner per area. Needed for README, deck and the human ownership protocol.
6. **Vercel Marketplace terms** for Neon and Upstash (free tiers), if the CLI prompts for acceptance in the browser.
7. **QIE Wallet** on a phone and in Chrome, testnet toggle on, one QIE ID claimed. Then tell me whether the mobile app has an in-app dApp browser.

## Real-world traction (only humans can do this)

8. **Event calendar** from 26 Nov to 30 Nov and through February: date, place, expected headcount, organizer contact.
9. **Outside sponsors**: any sponsor willing to fund even a small pool.
10. **Testnet QIE** from https://www.qie.digital/faucet for the testnet relayer and deployer (2 per day per wallet).

## Optional

11. Domain, X and Telegram handles for Showmark.
12. QIE Pass sandbox keys if the QIE team grants them.
