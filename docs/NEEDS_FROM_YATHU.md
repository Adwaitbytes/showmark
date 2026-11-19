# Needs from Yathu

Everything else is being built without waiting. Secrets go only into `.env.local` at the repo root, never into chat or a web page. Commands starting with `!` can be typed straight into this Claude Code session.

## Blocking right now

1. **GitHub workflow scope.** The public repo is https://github.com/23f2000979/showmark, but pushes are rejected because the CLI token lacks the `workflow` scope that the CI file needs. Run `! gh auth refresh -h github.com -s workflow` and approve in the browser.
2. **Redis on the free tier.** Postgres is done (Neon URL received 19 Nov, migrations applied, stored in `.env.local` and Vercel). Still needed: Upstash Redis for the relayer's nonce lock and rate limits. Either run `! vercel integration add upstash/upstash-kv --yes --no-claim --name showmark-kv`, or paste `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from a free database at console.upstash.com.
3. **Testnet QIE.** The faucet at https://www.qie.digital/faucet needs a connected browser wallet, and I will not import a key into a web page. From your QIE Wallet on testnet, request coins and send 1.5 QIE each to the deployer `0xA8C849C243BA940102d2deB99971e4c713411926` and the relayer `0xAaca310b66413Ebbf240b59dFE75Fb873d903660`. Repeat daily if you can.

## Blocking mainnet (needed by Mon 23 Nov)

4. **Mainnet QIE.** The keys were generated locally and live only in `.env.local` (gitignored). Send about 60 QIE to the deployer `0xA8C849C243BA940102d2deB99971e4c713411926` and 40 QIE to the relayer `0xAaca310b66413Ebbf240b59dFE75Fb873d903660`.
5. **Protocol Safe.** Create a Safe on https://safe.qie.digital with team members as owners (2 of 3 suggested) and add its address to `.env.local` as `SAFE_ADDRESS=0x...`. Contract ownership moves there after deployment.
6. **Reward budget** for the first campaigns, in QIE or QUSDC. You fund the first campaign from the sponsor console so it is labelled team-funded on /traction.

## Accounts and people

7. **Hackathon registration** at https://hackathon.qie.digital/register with the team email, team name and which members are students.
8. **Team roster**: names, GitHub usernames, colleges, owner per area. Needed for the README, the deck and the human ownership protocol.
9. **QIE Wallet** on a phone and in Chrome, testnet toggle on, one QIE ID claimed. Then tell me whether the mobile app has an in-app dApp browser.

## Real-world traction (only humans can do this)

10. **Event calendar** from 26 Nov to 30 Nov and through February: date, place, expected headcount, organizer contact.
11. **Outside sponsors**: anyone willing to fund even a small pool.

## Optional

12. Domain, X and Telegram handles for Showmark.
13. QIE Pass sandbox keys if the QIE team grants them.
