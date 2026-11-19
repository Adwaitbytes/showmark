# Needs from Yathu

Updated 19 Nov 2026, 17:35 IST. Done so far: GitHub (Adwaitbytes/showmark), Neon, Upstash, testnet QIE. Everything else is built and running on testnet at https://showmark.vercel.app. Secrets go only into `.env.local` at the repo root, never into chat or a web page.

## To go live on mainnet (about 10 minutes of your time)

1. **Create the protocol Safe** on https://safe.qie.digital (network: QIE Mainnet), with two or three team members as owners and a threshold of 2. Add its address to `.env.local` as `SAFE_ADDRESS=0x...` (or paste the address in chat; it is public).
2. **Send mainnet QIE**:
   - about 30 QIE to the deployer `0xA8C849C243BA940102d2deB99971e4c713411926` (deployment costs well under 1 QIE; the rest funds the Judges' desk pool and the first team-funded campaign);
   - about 30 QIE to the relayer `0xAaca310b66413Ebbf240b59dFE75Fb873d903660` (pays gas for every attendee check-in; each costs about 0.0001 QIE).
3. Tell me when both are done. I run `scripts/mainnet-launch.sh`, which checks the Safe and balances, deploys, verifies every contract on the explorer and writes `docs/safe/accept-ownership-1990.json`.
4. **The Safe owners accept ownership once**: in safe.qie.digital open Apps, then Transaction Builder, load that JSON file, and sign. One batch covers all four contracts.

## For traction (only humans can do this)

5. **Event calendar** from 26 Nov to 30 Nov and through February: date, place, expected headcount, organizer contact. The organizer playbook is ready in English and Hindi (`docs/ORGANIZER_PLAYBOOK.md`).
6. **Outside sponsors**: anyone willing to fund even a small pool. Outside money is what separates us on Most Traction.
7. **A phone test**: QIE Wallet on an Android phone, open https://showmark.vercel.app/judges on a laptop, scan with the phone camera, and tell me the time to stamp and anything confusing.

## Information for the submission

8. **Hackathon registration** at https://hackathon.qie.digital/register, if not done.
9. **Team roster**: names, GitHub usernames, colleges, who is a student, who owns which area.
10. **Privately to the QIE team**: the access-control observation on the Zone (QIE ID) contract from Phase 0. It is deliberately not in this public repo.

## Optional

11. A domain, plus X and Telegram handles for Showmark.
12. QIE Pass sandbox keys if the QIE team grants them.
