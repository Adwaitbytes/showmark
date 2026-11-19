# Phase 0 verification

Checked on 19 Nov 2026 between 07:15 and 08:25 UTC against the live chain and live docs. Mainnet head was about block 12,014,350, testnet head about 9,857,680. Every claim below comes from a command run or a page fetched in that window. Tools: Foundry `cast` 1.8.4, `curl`, the Blockscout REST API, the QIE Wallet MCP, and a headless browser for pages that render client side.

Facts the lead had already verified (PUSH0 works, no TSTORE on mainnet, QUSDC 6 decimals, Zone supply, oracle decimals, QIEDEX addresses, no QUSDC or Zone or oracle or router on testnet) are not repeated here.

## Surprises that change the design

1. **Do not use `Zone.balanceOf(user) > 0` as proof of a QIE ID.** Zone tokens can be created outside the official registries, so a Zone balance can be faked cheaply. The registries are the source of truth. Details are held back from this public file while they go to the QIE team privately (see section 1).
2. **Names do not live in Zone.** They live in two upgradeable registries: a free registry (one name per wallet, has `userDomain(address)`) and a paid registry (many names per wallet). See section 1 for the exact calls.
3. **The QIE/USDT oracle is a single owner-pushed feed with gaps up to 50 hours,** and the price moved 47% (0.119 to 0.175) inside the 14-day window. Keep it off the settlement path if at all possible (section 2).
4. **QIE Wallet is in the WalletConnect registry** with a mobile deep link `qiemobilewalletconnect://`. That is the mobile connection path. There is no evidence of an in-app dApp browser (section 3).
5. **QUSDC depth is about 4,631 QUSDC in one pool.** Buying more than about 145 QUSDC costs over 3% price impact, and 500 QUSDC costs about 11% (section 5).
6. **The testnet faucet page has no request form,** and the faucet wallet has not paid out since 14 Nov. Testnet gas is 7 wei, so any leftover test QIE on any wallet is enough for everything (section 12).
7. **Vercel Hobby cannot connect to a Git repository owned by a GitHub organization,** and Hobby cron runs at most once a day. The newer Vercel Schedules allow every 15 minutes on Hobby, capped at 5,000 runs a month (section 9).
8. **The whole chain has only 16 to 56 active sending accounts a day.** Relayed check-ins all come from one relayer address, so the explorer's "active accounts" chart will not show attendees unless attendees send something themselves (section 11).
9. **Closest overlap: Northeside's `HostRewards`** (verified 12 Nov). Sponsors fund QUSDC campaigns that pay hosts per verified returning player, through operator-posted Merkle roots. It is online prediction leagues, not physical presence, and it has 0 transactions. It is close enough that the pitch must name the difference (section 10).
10. **The submission form has no field for contract addresses or team members, and a single category.** Contract addresses go in the description and README (section 10).

## 1. Zone (QIE ID) contract

### Answer

Zone (`0x9aab56e7727af53A3131985BFB16d845319b7bdc`, name `qie`, symbol `.qie`) is a plain ERC-721 Enumerable built with solc 0.8.3. It stores only token ownership. It does not store name strings.

- **Token id of a name.** `tokenId = uint256(keccak256(abi.encodePacked(parent, label)))`, parent first. For `alice.qie` the label is `alice` and the parent is `qie` (no dot).
- **Name to owner on Zone.** `domainOwnerByName(string label, string parent)`, for example `domainOwnerByName("qwtff250", "qie")`. It reverts with `ERC721: owner query for nonexistent token` when the name does not exist. Swapping the arguments reverts too. `domainExistsByName(string label, string parent)` returns a bool and never reverts.
- **Names live in two registries,** both UUPS proxies owned by the EOA `0x9a689036A798cF1a96e65c1911cE7B444C4e06a4` (the same EOA owns Zone):
  - Free registry `0x1D69d75AD7b77b91C3760F84faC52E651710f62e` (implementation `0xE7697ffEE71660Bc4e065611ef4F20CeF1303DeE`). This is the `RootRegistry` source inside the Zone verified bundle. One name per wallet (`Registry:User domain minted`). 12,921 transactions.
  - Paid registry `0x26cCB3fABd6db18834987134d715Ba2346CE7223` (implementation `0xc6d98E2b050e6f38330604D0fd3B4912707Bc2B0`, not verified). Many names per wallet. 886 transactions.
  - Both expose `resolver(string fqn) returns (uint256 tokenId, address owner)`, `domainNames(uint256[] tokenIds) returns (string[])`, `domainInfo(string)` and `domainExist(string)`. The fqn includes the dot, for example `"qwtff250.qie"`. An unknown name returns `(0, 0x0)` and does not revert.
- **Wallet to primary name.** Call `userDomain(address)` on the free registry. It returns the wallet's free name (for example `"qwtff250.qie"`) or `""` when there is none. On the paid registry, `userDomains(address,uint256)` exists in the bytecode but reverted for every wallet tried, so do not rely on it.
- **Wallet to any name.** Call `Zone.tokenOfOwnerByIndex(wallet, i)` for `i < balanceOf(wallet)`, then `domainNames([tokenId])` on both registries. The registry that does not know the token returns `""`.
- **Free QIE IDs are in this same Zone contract.** A backend minter EOA `0xdD4B6dc6100FdBf2AFd76b25e22e2456a3691E2F` calls `mintDomain((owner,parent,label,zone), isFree)` (selector `0xbc96db3f`) on the free registry with `isFree = true` (example tx `0xb02d06b5...` minting `qwtff250.qie`). The paid registry is called the same way with `isFree = false` (tx `0x88c1def5...` minting `pricetest123.qie`). Free names carry a validity of 157,680,000 s (5 years) in the metadata contract, so none will expire during the hackathon.
- **Reverse record.** There is no ENS-style reverse resolver. The verified bundle includes a `DefaultDomain` contract with `resolve(address)`, but no deployed instance was found (no Blockscout match, no `DefaultSet` events in the last 120,000 blocks). In practice the free registry's `userDomain(address)` is the reverse record. The QIE Wallet MCP's `qie_reverse_lookup` returns the same names and labels the source `default-name` or `wallet-registry`.
- **Metadata (record) contracts.** Free names use `0x8777d01d509D0eA71FB38F88F79867da558d5018` (PaymentMetadata). Paid names use `0xCFBcBCA93c607590b211c81C7DBcdbd7eD6CC6ED` (Metadata). `resolveCurrency(fqn, "qie")` returns the QIE address record.
- **Security note.** We do not treat a Zone token balance as proof of a QIE ID. Showmark checks the name registry instead (`userDomain`). A related observation has been passed privately to the QIE team.

### Evidence

```
$ curl -s https://mainnet.qie.digital/api/v2/smart-contracts/0x9aab56e7727af53A3131985BFB16d845319b7bdc
name Zone, compiler v0.8.3+commit.8d00100c, optimizer 200, verified_at 2026-11-03, 43 additional sources
function _namehash(string label, string parent) ... uint(keccak256(abi.encodePacked(parent, label)))

$ cast to-dec $(cast keccak $(cast concat-hex $(cast from-utf8 qie) $(cast from-utf8 qwtff250)))
79722223565134752417658914920960191315647125215296663662786529629166858321416   # equals the minted tokenId in the Transfer log

$ cast call $ZONE 'domainOwnerByName(string,string)(address)' qwtff250 qie
0x8d858aaEA1cdA41D4E9c187c4Dc079E6342486bA
$ cast call $ZONE 'domainOwnerByName(string,string)(address)' qie qwtff250
execution reverted: ERC721: owner query for nonexistent token
$ cast call $ZONE 'domainExistsByName(string,string)(bool)' showmark qie
false

$ cast call 0x1D69...f62e 'userDomain(address)(string)' 0x8d858aaEA1cdA41D4E9c187c4Dc079E6342486bA
"qwtff250.qie"
$ cast call 0x1D69...f62e 'userDomain(address)(string)' 0x190F2Be6E7Ca00744401AcD38203918EC6Dc3b34
""                                      # this wallet holds only a paid name
$ cast call 0x26cC...7223 'resolver(string)(uint256,address)' wkfzk92101.qie
91619238884361854020789898837751165767861666636917581851767308988201769726790 0x190F2Be6E7Ca00744401AcD38203918EC6Dc3b34
$ cast call 0x1D69...f62e 'domainNames(uint256[])(string[])' "[28999...8268,11422...0364]"
["ashishkumar.qie", ""]
$ cast call 0x26cC...7223 'domainNames(uint256[])(string[])' "[28999...8268,11422...0364]"
["", "nuscr0532.qie"]

$ cast calldata-decode 'mintDomain((address,string,string,string),bool)' <input of 0xb02d06b5...>
(0x8d858aaEA1cdA41D4E9c187c4Dc079E6342486bA, "qie", "qwtff250", "qie")  true
$ cast call 0x8777...5018 'validity()(uint256)'
157680000

QIE Wallet MCP qie_reverse_lookup 0x6D23b3af...6D82 -> {"name":"ashishkumar.qie","registry":"wallet","source":"default-name"}
QIE Wallet MCP qie_resolve_name pricetest123.qie -> {"address":"0x6D23...6D82","registry":"paid","contract":"0xCFBc...C6ED"}
```

### What it means for the build

- QIE ID gating (D-007) must read the registries, not Zone. The cheapest sound check is `bytes(IFreeRegistry(0x1D69...).userDomain(wallet)).length > 0`. `eth_estimateGas` for that call as a whole transaction was 29,965, so the read itself costs well under 10k gas.
- To include paid-only holders, have the user present an fqn when linking and check `resolver(fqn).owner == wallet` on the free registry, falling back to the paid one. `resolver` never reverts.
- Pass both registry addresses to the constructor as immutables. They are upgradeable proxies controlled by one EOA, which is a trust assumption to state in SECURITY.md.
- A free QIE ID is one per wallet, not one per person, and wallets are free. QIE ID gating raises the cost of a sybil but does not stop one. D-006's one-to-one pass link remains the real sybil control.
- Display names: use `userDomain` first, then token enumeration, or the MCP's `qie_reverse_lookup` server side.
- `showmark.qie` is still free (`domainExistsByName("showmark","qie") == false`).

## 2. QIE/USDT oracle cadence

### Answer

The feed (`0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17`, `AggregatorV3`, solc 0.8.20, evm paris) is updated by one owner key through `updateAnswer(int256)`. The owner is `0x725Ccc2C1C86c9BC31A90020128D99Ff8D351aA0`. Round ids are sequential, `startedAt == updatedAt`, and `answer >= 0` is the only check, so zero is a legal answer. Updates come in bursts: 27 rounds on some days, none on others. Consecutive rounds differ by as little as 0.015%, so there is no fixed deviation threshold and no heartbeat.

Over the 14 days to 19 Nov 07:52 UTC there were 111 rounds (ids 20166 to 20276):

| Gap statistic | Seconds | Hours |
| --- | --- | --- |
| Minimum | 58 | 0.02 |
| Median | 1,620 | 0.45 |
| p90 | 31,322 | 8.7 |
| p95 | 50,492 | 14.0 |
| p99 | 106,145 | 29.5 |
| Maximum | 180,480 | 50.1 (6 Nov 12:09 to 8 Nov 14:18 UTC) |

Share of wall-clock time the feed was older than a threshold: over 6 h 49%, over 12 h 29%, over 24 h 9.6%, over 36 h 4.2%, over 48 h 0.6%. At measurement time the latest round was already 23.6 hours old. The price ranged from 0.11892323 to 0.17496525 in the window, the largest single step was 22.7%, and the median step was 0.23%.

**Recommendation: `maxOracleAge = 172800` (48 hours), only if the oracle must be on chain at all.** 48 hours covers p99 (29.5 h) with margin. It would have deferred settlement only 0.6% of the time in this window, around the one 50-hour gap. Anything tighter defers often (24 hours would have deferred 9.6% of the time). The cost of a 48-hour tolerance is price risk, because QIE moved 47% in the window. So the better design is to denominate each campaign in the token it pays out (a fixed QIE or QUSDC amount per verified check-in) and use the oracle only for USD display and reports, read off chain. If a USD-pegged QIE campaign is kept, add sanity bounds (answer greater than zero and inside a sponsor-set min and max), keep settlement retryable as in D-003, and alert the team when the feed age passes 30 hours.

### Evidence

```
$ cast call 0x3Bc6...3D17 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
20276  16491619  1794989758  1794989758  20276          # now = 1795074715, age 84,957 s
$ cast call 0x3Bc6...3D17 'owner()(address)'
0x725Ccc2C1C86c9BC31A90020128D99Ff8D351aA0
verified source: function updateAnswer(int256 answer) external onlyOwner { require(answer >= 0, "negative answer"); ... }

$ python3 -I oracle_walk.py 0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17 14   # batched getRoundData(uint80) walk
window 14.0d: rounds in window 111 (ids 20166..20276), gaps counted 111
gap seconds: min 58 median 1620 p90 31322 p95 50492 p99 106145 max 180480
  share of time age > 24h: 9.6%   > 36h: 4.2%   > 48h: 0.6%
largest gaps (h): 50.13, 30.18, 23.2, 20.0, 18.15, 16.5, 11.55, 10.95
abs % change between consecutive rounds: min 0.015 median 0.228 max 22.663
rounds per day: 11-06 2, 11-07 0, 11-08 2, 11-09 27, 11-10 13, ... 11-17 27, 11-18 10, 11-19 0
```

Docs claim "Cryptocurrencies are updated every few minutes" (https://docs.qie.digital/qie-oracle/faqs/how-often-does-qie-oracle-update-prices.md). The chain shows otherwise.

### What it means for the build

D-003 stands, with 48 hours as the constructor value. Prefer fixed-amount campaigns so a stale feed never touches a payout. Show "price as of" with the feed age wherever a USD figure appears.

## 3. QIE Wallet integration

### Answer

Source: https://docs.qie.digital/qie-wallet-integration-guide-for-websites.md, which covers the Chrome extension only.

- **EIP-6963:** `rdns: "me.qiewallet"`, `name: "QIE Wallet"`. `window.qie` is always set and is QIE Wallet only. `window.ethereum` is claimed only if no other wallet holds it.
- **Quirks:**
  - `isMetaMask` is `true`.
  - `eth_chainId` returns lowercase `0x7c6`, so compare chain ids numerically.
  - No `disconnect` event is ever emitted. Site disconnection arrives as `accountsChanged` with `[]`.
  - The docs recommend reloading on `chainChanged`.
  - Testnet is hidden until the user turns on the testnet toggle. Until then, switching to 1983 returns `4902` and `wallet_addEthereumChain` does not help.
  - No injection on `file://` pages.
  - After auto-lock, `eth_accounts` still returns the granted address, but signing first opens an unlock prompt and may come back as `4001`.
  - Unknown methods are forwarded to the active chain's RPC.
  - Undocumented extra methods (as of v4.2.2): `wallet_watchAsset`, `wallet_requestPermissions`, `wallet_revokePermissions`, `net_version`, `eth_sign`, `eth_signTypedData`, `eth_signTypedData_v3`.
- **Typed data:** `eth_signTypedData_v4` is supported and shown in the popup as readable structured fields. The guide's example uses domain `{ name, version, chainId: 1990, verifyingContract }`.
- **`wallet_addEthereumChain` for mainnet, exactly as documented:**

```js
{
  chainId: '0x7c6',
  chainName: 'QIE Blockchain Mainnet',
  nativeCurrency: { name: 'QIE', symbol: 'QIE', decimals: 18 },
  rpcUrls: ['https://rpc1mainnet.qie.digital', 'https://rpc5mainnet.qie.digital'],
  blockExplorerUrls: ['https://mainnet.qie.digital'],
}
```

- **Testnet:** the guide says to "swap in chain ID `0x7bf`, the testnet RPC, and the testnet explorer". With the guide's own testnet table:

```js
{
  chainId: '0x7bf',
  chainName: 'QIE Testnet',
  nativeCurrency: { name: 'QIE', symbol: 'QIE', decimals: 18 },
  rpcUrls: ['https://rpc1testnet.qie.digital'],
  blockExplorerUrls: ['https://testnet.qie.digital'],
}
```

  The www.qie.digital faucet page lists `https://rpc2testnet.qie.digital` as the primary testnet RPC. Both respond. `rpc3testnet` did not respond today (section 7).
- **Mobile:**
  - The guide says nothing about mobile.
  - The WalletConnect WalletGuide lists QIE Wallet with `supports_wc: true`, devices `Browser Extension` and `Mobile`, `mobile_link: "qiemobilewalletconnect://"`, `link_mode: "https://www.qiewallet.me/"`, `rdns: "me.qiewallet"`, and wallet id `7eb95f5e01a3c45f7f0111f736d73e5c88aa5f268256c6a38b7f631216f620fb`.
  - The App Store listing (v2.8.6, iOS 17+, developer VORTEX PAY (PTY) LTD) mentions no dApp browser and no WalletConnect. Its latest note is "Allow Sign In with QIE from partners".
  - id.qie.digital itself loads Reown AppKit (`api.web3modal.org/appkit/v1/config?...sv=react-ethers5-1.8.19`), so QIE's own site connects wallets through WalletConnect.
  - No evidence of an in-app dApp browser was found anywhere.

### Evidence

```
docs guide: "EIP-6963: rdns: me.qiewallet, name: QIE Wallet"; "The provider also reports isMetaMask = true";
"Do not rely on a disconnect listener with QIE Wallet: the provider never emits that event."
walletguide.walletconnect.com/?search=QIE page data:
{"name":"QIE Wallet","mobile_link":"qiemobilewalletconnect://","link_mode":"https://www.qiewallet.me/",
 "rdns":"me.qiewallet","supports_wc":true,"devices":["Browser Extension","Mobile"], ...}
apps.apple.com/us/app/qie-wallet/id6445826746: version 2.8.6, no mention of dApp browser or WalletConnect
```

### What it means for the build

- Desktop: EIP-6963 with `me.qiewallet`, then `window.qie`, as D-008 already plans.
- Mobile: WalletConnect v2 with QIE Wallet pinned by its wallet id, deep link `qiemobilewalletconnect://`. This needs a free Reown project id. Load it lazily, off the check-in route, to protect the 170 kB budget. The attendee check-in itself never needs a wallet (D-006 pass key). Only linking and claiming do.
- Before building on this, Yathu must test on a real phone that a WalletConnect session to chain 1990 opens and that `eth_signTypedData_v4` signs over WalletConnect. Neither is documented.

## 4. KYC status and trust score

### Answer

Neither is readable on chain or through a public API today.

- id.qie.digital/verify says the KYC record is shared off chain. After the user approves in QIE Wallet, "a full copy of your KYC record goes to that partner's own KYC-provider account". Partners integrate "through the QIE API, with every call signed using HMAC-SHA256, or through email matching inside their KYC provider's WebSDK", sandbox first.
- The partner docs at `https://getpass.qie.digital/dashboard/docs` redirect to `/auth/login`.
- The id site's API `https://domains.qie.digital/api/*` returns 401 for everything except `/api/tld`.
- The page claims an "On-Chain Trust Layer" with credential status anchored on chain, but no such contract was found among the 148 verified contracts.
- Two other teams bridge QIE Pass with their own off-chain attester. Northeside's `IdentityAdapter` (0x7Bdef385...): "Northeside's backend confirms Pass status with QIE, then the attester key signs an EIP-712 attestation". RemitChain's `KYCRegistry` (0xF050a0cE...) carries the comment "TODO(qie): Replace passOracle sig path with native QIE Pass on-chain verification once the QIE Pass contract interface is published."
- The trust score exists only as press coverage of a proposed 0 to 100 reputation score (https://pro.edgex.exchange/en-US/news/article/qie-blockchain-wallet-reputation-score). No endpoint was found.
- The explorer's address API has no KYC or trust fields. The only score link in its frontend config is a generic third-party one (`NEXT_PUBLIC_XSTAR_SCORE_URL`).

### Evidence

```
$ curl -sL https://getpass.qie.digital/dashboard/docs -w '%{url_effective}'   -> https://getpass.qie.digital/auth/login
$ curl -s -o /dev/null -w '%{http_code}' https://domains.qie.digital/api/kyc   -> 401
$ curl -s https://mainnet.qie.digital/api/v2/addresses/0x6D23...6D82 | keys   -> no kyc, trust or score fields
```

### What it means for the build

Do not promise KYC gating in Tier 1. The usable identity signal is a registry-backed QIE ID (section 1). If QIE grants partner sandbox keys, the only workable pattern is the one other teams use: our backend checks QIE Pass, and an attester key signs an EIP-712 attestation that a contract verifies. That is a trusted attester, and it must be disclosed as one.

## 5. QUSDC acquisition and liquidity

### Answer

There is one real QIE to QUSDC pool: WQIE/QUSDC pair `0x73a3ccf7da7e473ed2e9994ae764f0e30f4e4dfe` (token0 WQIE, token1 QUSDC, 0.30% fee). At block 12,014,316 its reserves were 28,237.54 WQIE and 4,631.14 QUSDC, about $9,134 of liquidity. The on-chain `getReserves()` and `factory.getPair` match the API. Mid price was 0.164006 QUSDC per QIE, against 0.16491619 on the oracle and 0.164996 on Blockscout. Activity is thin: 24-hour volume $1.35 (2 trades), 7-day $253, 30-day $13,725. The other six QUSDC pools are dust (the largest is QUSDC/BROQ with 503.5 QUSDC).

Quotes from `/quote` with native QIE as the `0xeeee...eeee` sentinel and 50 bps slippage:

| Trade | Out or in | Price impact |
| --- | --- | --- |
| 100 QIE in | 16.293916 QUSDC | 0.35% |
| 1,000 QIE in | 157.938047 QUSDC | 3.41% |
| 5,000 QIE in | 694.896621 QUSDC | 15.00% |
| 500 QUSDC out | 3,427.93 QIE in | 10.80% |

The API's own size guidance: 1% impact at 286 QIE, 3% at 876 QIE, 10% at 3,147 QIE.

`/swap` returns the quote plus:

- an unsigned router transaction `tx {to: router 0x08cd...53ef, data, value (hex), chainId: 1990}`. For native QIE in, the method is `swapExactETHForTokens` (`0x7ff36ab5`). For QUSDC to QIE, the method is `0x18cbafe5`.
- `deadline`, about 20 minutes from the quote
- `approval` (null for native input; for an ERC-20 input it holds a ready `approve(router, amount)` transaction plus `currentAllowance`)
- `warnings` (for example `KEEP_GAS_RESERVE` and `INSUFFICIENT_BALANCE`)
- `balance` when `from` is passed
- `routerCheck`, `alternatives` and `requiresConfirmation`

Response headers confirm the limits: `x-ratelimit-limit: 120` and `x-quote-ratelimit-limit: 60`. CORS is open (`*`). The warning policy is impact warn at 3%, danger at 10%, and low liquidity below $1,000.

The other path is to mint. stable.qie.digital/stable/trade bridges USDC from Ethereum to QIE as WUSDC (2 to 5 minutes, needs Ethereum gas), then locks WUSDC 1:1 to mint QUSDC.

### Evidence

```
$ curl -s https://api.dex.qie.digital/pairs   -> WQIE/QUSDC 0x73a3...4dfe reserve0 28237.539588918300797359 reserve1 4631.139519 liquidityUsd 9134.34
$ cast call 0x73a3...4dfe 'getReserves()(uint112,uint112,uint32)'   -> 28237539588918300797359 4631139519 1795074751
$ cast call 0x8E23...398C 'getPair(address,address)(address)' WQIE QUSDC   -> 0x73a3cCF7da7e473ed2e9994aE764f0E30f4e4DFe
$ curl -s 'https://api.dex.qie.digital/quote?tokenIn=0xeeee...eeee&tokenOut=0x3F43...5DA5&amountInDecimal=1000&slippageBps=50'
  amountOutDecimal 157.938047, priceImpactPct 3.4103, maxAmountInFor1PctImpactDecimal 286.08
$ curl -s 'https://api.dex.qie.digital/swap?tokenIn=0xeeee...&tokenOut=0x3F43...&amountInDecimal=100&slippageBps=50&recipient=0x...dEaDbeEf'
  tx.to 0x08cd2e72e156d8563b4351eb4065c262a9f553ef, tx.data 0x7ff36ab5..., tx.value 0x56bc75e2d63100000, approval null
$ curl -s https://api.dex.qie.digital/summary   -> tvlUsd 26541.73, volumeUsd24h 1.35, trades24h 2
```

### What it means for the build

- Team-funded and small campaigns should default to native QIE.
- QUSDC suits sponsors who already hold it or who mint through the bridge. A $500 QUSDC pool bought on QIEDEX would lose about 11% to impact and move the price for everyone.
- If the sponsor console offers "fund with QIE, pay out in QUSDC", it must show the `/quote` impact, enforce `minAmountOut`, refuse above 3% impact without explicit confirmation, and call `/swap` from the server so the 60-per-minute bucket is shared sanely.
- A $1,000 QUSDC pool would be 11% of all QUSDC in existence (9,171).

## 6. Contract verification on QIE Blockscout

### Answer

- **Supported methods.** Both explorers list verification methods `standard-input`, `multi-part`, `flattened-code` and Vyper variants, but not Sourcify. Solidity compilers are listed up to `v0.8.38+commit.1835d247` (96 versions). EVM versions are listed up to `cancun`.
- **Foundry flags.** The Etherscan-compatible endpoint at `https://<mainnet|testnet>.qie.digital/api` answers (`checkverifystatus` returns `Unknown UID` for a fake guid). Public QIE repos verify with these Foundry flags:
  - `forge verify-contract <addr> src/X.sol:X --chain-id 1990 --verifier blockscout --verifier-url https://mainnet.qie.digital/api/ --constructor-args $(cast abi-encode ...)` (Onegeex/IMOLE README)
  - `forge script ... --broadcast --verify --verifier blockscout --verifier-url 'https://testnet.qie.digital/api/' --slow` (codebuster22/simplr-events-qie-contracts, whose `Event`, `EventFactory` and `AccessPassNFT` are fully verified on mainnet)
  - `--verifier blockscout --verifier-url https://<mainnet|testnet>.qie.digital/api` (RemitChain `Deploy.s.sol`)
  - RemitChain's `foundry.toml` notes "any non-empty string is accepted as API key".
- **Recent settings.** Of the 63 contracts verified since 1 Aug:
  - evmVersion: paris 26, shanghai 20, default or unset 14 (Safe 0.7.6 and the QIE ID contracts), berlin 2, cancun 1. RemitChain's three contracts (June) were also verified with cancun on 0.8.24.
  - 28 carry remappings and `src/` paths, which marks Foundry standard-input verification.
  - The newest Foundry ones (Kawal, Tola, Northeside, Patungan, 11 to 17 Nov) use solc 0.8.28, shanghai, optimizer 200, viaIR false.
- **Bytecode hash.** Every contract verified with `bytecodeHash: "none"` (12 of 12) shows as only partially verified. Every one with `ipfs` (17 of 17) is fully verified.

### Evidence

```
$ curl -s https://testnet.qie.digital/api/v2/smart-contracts/verification/config
verification_options ['multi-part','vyper-multi-part','vyper-standard-input','flattened-code','standard-input','vyper-code']
solidity_evm_versions [..., 'paris', 'shanghai', 'cancun', 'default']; latest solc v0.8.38+commit.1835d247
$ curl -s 'https://testnet.qie.digital/api?module=contract&action=checkverifystatus&guid=0x...abcdef'
{"message":"OK","result":"Unknown UID","status":"1"}
verified_details (148 contracts, /api/v2/smart-contracts/{addr}):
  since Aug: evm Counter({('paris','paris'): 26, ('shanghai','shanghai'): 20, ('default', None): 14, ('berlin','berlin'): 2, ('cancun','cancun'): 1})
  bytecodeHash vs fully verified: (None, True) 29, ('ipfs', True) 17, ('none', False) 12, (None, False) 5
2026-11-17 KawalAttest v0.8.28 evm shanghai opt 200 viaIR False bytecodeHash ipfs fully True
```

### What it means for the build

The repo's `packages/contracts/foundry.toml` (solc 0.8.38, `evm_version = "shanghai"`, `bytecode_hash = "ipfs"`) matches what verifies fully here. Use:

```
forge verify-contract <addr> src/X.sol:X --chain-id 1983 \
  --verifier blockscout --verifier-url https://testnet.qie.digital/api/ \
  --compiler-version v0.8.38+commit.1835d247 --evm-version shanghai \
  --constructor-args <hex> --watch
```

Use chain id 1990 and `https://mainnet.qie.digital/api/` for mainnet. Keep `bytecode_hash = "ipfs"`. A real testnet deploy and verify round trip is still owed, and it needs testnet QIE (section 12).

## 7. eth_getLogs range and RPC health

### Answer

All five mainnet RPCs and rpc1 testnet accept at most 10,001 blocks per `eth_getLogs` call (`toBlock - fromBlock <= 10000`). Above that they return `-32000 maximum [from, to] blocks distance: 10000`. rpc1 to rpc5 mainnet all respond with chain id `0x7c6` and are within 2 blocks of each other. Testnet rpc1, 2, 4, 5 and 6 respond. rpc3testnet did not respond. JSON-RPC batches of 500 calls worked on rpc1mainnet, and one batch of 1,000 timed out. All RPCs answer CORS preflight with `Access-Control-Allow-Origin: *`. Gas: mainnet `eth_gasPrice` 1,125,000,000 wei with base fee 1 gwei. Testnet `eth_gasPrice` 7 wei with base fee 7 wei.

### Evidence

```
$ getlogs.sh https://rpc1mainnet.qie.digital $((B-10000)) $B <Zone>   -> OK range=10001 logs=4
$ getlogs.sh https://rpc1mainnet.qie.digital $((B-10001)) $B <Zone>   -> ERR {"code":-32000,"message":"maximum [from, to] blocks distance: 10000"}
same boundary on rpc2, rpc3, rpc4, rpc5 mainnet and rpc1 testnet
rpc1..rpc5 mainnet eth_blockNumber: 0xb75310, 0xb75310, 0xb75311, 0xb75311, 0xb75312
testnet rpc3: no response (curl 000)
$ cast gas-price --rpc-url https://rpc1testnet.qie.digital   -> 7
```

### What it means for the build

The indexer pages logs in 10,000-block windows, which is about 10 hours of chain at 3.6 s blocks. A full backfill from a deploy block a week old is about 17 calls. Use rpc1 as primary, with rpc2 to rpc5 as fallbacks in a viem `fallback` transport. Never put rpc3testnet in the testnet list.

## 8. ISO 20022 gateway

### Answer

`https://api.iso.qie.digital` is documented by its own OpenAPI 3.1 file at `/openapi.json` (title "QIE ISO 20022 Gateway", version 0.2.0). The description reads: "pain.001 in, unsigned QIE/QUSDC transactions and exact settlement records out. This is not a claim of ISO 20022 certification, bank acceptance, or SWIFT membership. Phase 1 is testnet only." The `/health` response, however, says `network: mainnet`.

- **Public:** `GET /`, `GET /health`, `GET /v1/network` and `GET /openapi.json`.
- **Need `X-Api-Key`:** `POST /v1/pain.001/parse`, `POST /v1/pain.001/prepare`, `GET /v1/instructions/{id}`, `/settlement`, `/report` (camt.054-style), `POST /v1/instructions/{id}/broadcast`, `POST /v1/instructions/{id}/institution-confirm` (partner only) and `GET /v1/transactions/{txHash}`. Without a key they return 401 `API key required`.
- **`/v1/network`** pins QUSDC `0x3F43...5DA5`, 2 confirmations, `uetrAlgorithm: SHA-256(qie:{chainId}:{instructionId})`, and lists an extra RPC `https://evm-rpc.qie.digital`.
- **Health:** `officialXsd` is false for both pain.001 versions, and the schema pack is "structural".

### Evidence

```
$ curl -s https://api.iso.qie.digital/health   -> {"status":"ok","service":"qie-iso20022-gateway","version":"0.2.0","phase":1,"network":"mainnet",...,"startedAt":"2026-11-14T10:11:44.172Z"}
$ curl -s -X POST https://api.iso.qie.digital/v1/pain.001/parse   -> 401 {"error":"unauthorized","message":"API key required"}
```

### What it means for the build

The gateway is not usable without a key from QIE. It is worth asking for one only if we want a Tier 3 "export sponsor settlement as a camt.054-style report" feature. Not on the critical path.

## 9. Free-tier limits

### Answer

**Vercel Hobby**

| Item | Limit |
| --- | --- |
| Cron Jobs (legacy) | 100 per project, minimum interval once per day, precision plus or minus 59 minutes; more frequent expressions fail at deploy |
| Vercel Schedules (beta, replacing cron) | most frequent every 15 minutes, jitter always 15 minutes, 5,000 runs and 500 dynamic schedules per billing period, 100 static schedules per deployment; over the limit, scheduled runs are skipped until the next period |
| Function duration | 300 s default and maximum |
| Function memory | 2 GB with 1 vCPU |
| Request or response body | 4.5 MB |
| Included usage per month | 1,000,000 invocations, 4 CPU-hours of Active CPU, 360 GB-hours of memory, 100 GB Fast Data Transfer, 1,000,000 CDN requests |
| Exceeding limits | "In most cases ... you will have to wait until 30 days have passed before you can use the feature again" |
| Deployments | 100 per day |
| Runtime logs | kept for 1 hour |
| Git | "Vercel does not support connecting a project on your Hobby team to Git repositories owned by Git organizations." |

**Neon Free** (pricing page, last updated 2026-11-04)

| Item | Limit |
| --- | --- |
| Compute | 100 CU-hours per project per month |
| Projects | 100 |
| Storage | 1 GB per project, 20 GB account total |
| Compute size | up to 2 CU (8 GB RAM) |
| Scale to zero | after 5 minutes, and it cannot be turned off |
| Branches | 10 per project |
| Egress | 5 GB |
| History | 6 hours |
| Connections | `max_connections` is 112 at 0.25 CU, 225 at 0.5 CU, 450 at 1 CU and 901 at 2 CU; the pooler takes up to 10,000 client connections (`max_client_conn=10000`, `default_pool_size = 0.9 × max_connections`) |

**Upstash Redis Free**

| Item | Limit |
| --- | --- |
| Commands | 500,000 per month (no daily cap is stated any more) |
| Data | 256 MB (250 MB in the summary) |
| Bandwidth | 10 GB per month |
| Request size | 10 MB maximum |
| Record size | 100 MB maximum |
| Throughput | 10,000 commands per second |
| Databases | 1 |
| Over the limit | behavior is not stated for the free tier |

### Evidence

- https://vercel.com/docs/cron-jobs/usage-and-pricing (last updated 2026-07-15)
- https://vercel.com/docs/schedules/limits
- https://vercel.com/docs/functions/limitations (2026-08-24)
- https://vercel.com/docs/plans/hobby (2026-11-12)
- https://vercel.com/docs/limits (2026-09-16), section "Connecting a project to a Git repository"
- https://neon.com/pricing
- https://neon.com/docs/connect/connection-pooling (2026-11-14)
- https://upstash.com/pricing/redis
- https://upstash.com/docs/redis/overall/pricing

### What it means for the build

- **Git connection.** The team-org repo cannot be connected to a Vercel Hobby project through the Git integration. Either deploy from GitHub Actions with the Vercel CLI (`vercel pull`, `vercel build`, `vercel deploy --prebuilt --prod` with a token stored as a repo secret), or host the repo under a personal account. This is Yathu's call because it touches where the public repo lives.
- **Retries.** Settlement retries cannot ride on Hobby cron, which runs once a day. Settle inline right behind the check-in (D-004). For a sweeper, use one Vercel Schedule every 15 minutes (2,880 runs a month, within 5,000). A second 15-minute schedule would exceed the cap.
- **Neon compute.** An always-on 0.25 CU uses about 182 CU-hours a month, which is over 100. Scale to zero must stay on, so expect a cold start of a few hundred milliseconds on the first query after 5 idle minutes. Warm the database before doors open at an event. Use the `-pooler` connection string from functions.
- **Upstash.** 500,000 commands a month is about 16,000 a day. Budget about 10 Redis commands per check-in (rate limit, nonce lock, idempotency) and that is roughly 50,000 check-ins a month. Do not poll Redis in loops.

## 10. Overlap scan and hackathon rules

### Answer: overlap

All 148 verified mainnet contracts were listed (`/api/v2/smart-contracts`, 3 pages) and their names and ABIs were scanned for presence, attendance, check-in, event, sponsor, escrow, host, ticket, badge, campaign and reward terms. Relevant hits:

| Contract | Address | Verified | What it is | Overlap |
| --- | --- | --- | --- | --- |
| HostRewards (Northeside) | 0x8b2f938F40c6A6d62C79f82a1f2d8DB12b6D6246 | 12 Nov | "Sponsors fund campaigns in QUSDC. After each finalized matchweek the operator posts one Merkle root of host payouts (computed off-chain from verified, returning players), and after a 24-hour review delay hosts claim with a proof." Launch caps 500 QUSDC per campaign, 2,000 total. 0 transactions. | Closest. Sponsor pays per verified person. But it pays for online prediction players, not physical presence, settles by operator Merkle root rather than per check-in, and pays hosts only. |
| IdentityAdapter (Northeside) | 0x7Bdef3854f9bC0B25271Cee756274fEb3d33eAA9 | 12 Nov | QIE Pass to personHash via an attester EIP-712 signature, up to 3 wallets per person | Identity pattern, not presence |
| NorthesideMatchweeks | 0xb9B7FF15Ab687621bF0B6D93064857f24F070d0B | 12 Nov | Commit-reveal football predictions | None |
| Event, EventFactory, AccessPassNFT (Simplr Events) | 0x9FEFaf2D..., 0x9aF4D4D6..., 0xFEcc3e86... | Dec 2025 | ERC-1155 tiered tickets with EIP-712 gatekeeper redemption | Door redemption, but no sponsorship money |
| EscrowCore, EscrowVault, AlibiCreditEscrow | various | Jun to Oct 2026 | Generic, remittance and credit escrow | None per attendee |
| QieIdGatedAllowlist | 0x31423638af5b8d2a9096B6ab58c62f07844Bc461 | 28 Aug | Allowlist gated on Zone `balanceOf > 0` | Uses the check section 1 warns against |

Only 148 of 844 contracts are verified, so unverified contracts were not scanned.

### Answer: hackathon rules

Sources: https://hackathon.qie.digital (home, FAQ expanded in a browser), https://hackathon.qie.digital/terms (last updated 11/18/2026), and the public JavaScript of https://hackathon.qie.digital/submit.

- **Tracks and examples.**
  - DeFi and Financial Infrastructure.
  - AI and Autonomous Agents.
  - Consumer Apps and Social: Creator Economy, Messaging, Communities, Loyalty, Identity, Monetization.
  - Commerce and Real World: Merchant Payments, Invoicing, **Ticketing**, POS, Supply Chain, Subscriptions.
  - Developer Infrastructure and Tooling.
- **Judging.** The FAQ gives Innovation 30, Technical Quality 25, User Experience 15, Mainnet Integration 15, Business Potential 15. The Terms give 25 each for innovation, technical implementation, impact and presentation. Bonus for integrating several of QIE Wallet, QIE, QIE ID, QIEDEX and Oracles.
- **Mandatory.** "mainnet deployment, open-source smart contracts, live public app, public repository, demo video, documentation, and team presentation". Testnet-only projects are not eligible. The Terms add: one submission per team, 18 or older, a valid QIE wallet address, no QIE employees.
- **Exact submission form** (5-step wizard, from the `/submit` page bundle):
  - Step 1, Basic Info, all required: Team Name, Project Name, Category (single select from the five tracks; "Project category is required."), Description.
  - Step 2, Links: LinkedIn, Website, GitHub (required), Video (required, YouTube placeholder `https://youtube.com/watch?v=...`).
  - Step 3, Social, optional: Twitter/X, Discord, Telegram.
  - Step 4, Wallet, required: QIE Wallet Address, verified by `window.ethereum.request({method:"eth_requestAccounts"})` followed by a "verify" button that just waits 2 seconds. No signature.
  - Step 5, Review.
  - The record also stores `status`, `scores`, `prize`, `rank`, `is_category_winner` and review comments, and submissions can be edited later from the profile.
  - There is no field for contract addresses, team members, student status or a presentation link.
- **Not stated anywhere public:** demo video length or format, whether one project can win several awards, how Most Traction and Community Choice are decided, or what counts as a student team. The single `prize` and `rank` fields hint, weakly, at one prize per submission. These stay on the questions for the QIE team.

### Evidence

```
$ curl -s https://mainnet.qie.digital/api/v2/smart-contracts/counters   -> {"smart_contracts":"844","verified_smart_contracts":"148"}
$ curl -s https://mainnet.qie.digital/api/v2/addresses/0x8b2f938F40c6A6d62C79f82a1f2d8DB12b6D6246/counters   -> {"transactions_count":"0",...}
submit bundle: P=e=>{switch(e){case 1:return!!(y.teamName&&y.projectName&&y.description&&y.category);
               case 2:return!!(y.githubRepo&&y.productVideo);case 3:case 5:return!0;case 4:return y.qieWalletVerified;...}}
submit bundle: Z=[{id:1,title:"Basic Info"},{id:2,title:"Links"},{id:3,title:"Social"},{id:4,title:"Wallet"},{id:5,title:"Review"}]
```

### What it means for the build

- **Pitch.** It must name HostRewards and state the difference in one line: physical presence proved at the door, money released per check-in on chain, and the attendee paid too, not an operator Merkle root paying hosts for online activity.
- **Track.** Commerce and Real World lists Ticketing, and Simplr Events (an earlier ticketing entry) would sit there. Consumer Apps and Social is still the better fit for the brief's attendee story.
- **Submission description.** Put contract addresses with explorer links, team, student status and the presentation link in the Description field and the README, because the form has no other place for them.
- **Wallet step.** Do it with only QIE Wallet enabled in the browser. The form uses `window.ethereum`, which another installed wallet could capture.

## 11. Chain stats (traction baseline)

### Answer

On 19 Nov 2026 about 07:55 UTC:

| Metric | Value |
| --- | --- |
| Total transactions | 544,680 (stats service: 544,754) |
| Transactions on 18 Nov | 1,688 |
| Daily transactions, 30 days to 18 Nov | mean 2,040, median 1,724, min 1,346, max 7,686 |
| Total addresses | 158,123 |
| Total accounts (stats service) | 17,070 |
| Active accounts per day, 5 to 18 Nov | 16 to 56 (for example 18 Nov: 24) |
| New accounts per day, same period | 2 to 15 |
| Contracts | 844, of which 148 verified |
| Average block time | 3.616 s |
| QIE price (Blockscout) | 0.164996 |
| Gas price (Blockscout) | 1.19 gwei |
| Account abstraction wallets | 0 |

### Evidence

```
$ curl -s https://mainnet.qie.digital/api/v2/stats
"total_addresses": "158123", "total_transactions": "544680", "transactions_today": "1688", "average_block_time": 3616.0
$ curl -s https://stats.qie.digital/api/v1/counters   -> totalAccounts 17070, newTxns24h 1734, totalContracts 844, totalVerifiedContracts 148
$ curl -s 'https://stats.qie.digital/api/v1/lines/activeAccounts?from=2026-11-05&to=2026-11-18'
[('11-05','29'),('11-06','16'),('11-07','20'),('11-08','19'),('11-09','56'),('11-10','51'),('11-11','32'),('11-12','28'),('11-13','18'),('11-14','21'),('11-15','18'),('11-16','18'),('11-17','32'),('11-18','24')]
```

### What it means for the build

- **Scale.** A single event with 100 attendees is several times the chain's daily active senders. That is the traction story.
- **Counting attendees.** Relayed check-ins are sent by one relayer address. Blockscout's active-accounts chart counts senders, so it will count us as 1 a day. `/traction` should count unique pass keys and linked wallets from our own events, which is still provable on chain.
- **Showing up on QIE's charts.** If we also want attendees in QIE's own charts (the "wallet growth" and "recurring users" milestones), make one step user-sent from the attendee's QIE Wallet. Linking or claiming is the natural one. This is a product decision for the lead.

## 12. Testnet faucet

### Answer

- **The page.** https://www.qie.digital/faucet currently has no request form. It shows chain facts and a link to the docs guide, and the rendered page has no faucet input. The docs guide (https://docs.qie.digital/getting-started-with-qie-blockchain/4.-get-testnet-coins-faucet.md) still describes the old flow: "Connect with Keplr or MetaMask, enter your wallet address, click Request Test Coins, coins appear within 1 minute". It mentions no captcha and no login. The hackathon quickstart says the same.
- **The faucet wallet.** `0xdb7Db55298e930F1c22b7C6c31d98CAba2df538C` pays exactly 2 QIE per drip and has made 4,722 transactions. It holds 565.85 test QIE, and its last drip was 14 Nov 18:36 UTC, with nothing in the 4.5 days since. When it was live, the same address received several drips minutes apart, so there was no strict per-address daily limit.
- **Cost of testnet activity.** Testnet gas is 7 wei. A 50,000-gas transaction costs about 3.5e-13 QIE, so one 2 QIE drip covers practically unlimited testnet traffic, load tests included.

### Evidence

```
rendered www.qie.digital/faucet: "Get free test QIE from the testnet faucet ... The faucet guide in the QIE docs shows how to request test coins. Open the testnet faucet guide" (no form)
$ cast balance 0xdb7Db55298e930F1c22b7C6c31d98CAba2df538C --ether --rpc-url https://rpc1testnet.qie.digital   -> 565.851246724305818050
latest outgoing (testnet Blockscout): 2026-11-14T18:36 2.0, 2026-11-14T17:17 2.0, 2026-11-14T16:38 2.0, ...
$ curl -s 'https://testnet.qie.digital/api/v2/transactions?filter=validated'   -> gas_price 7, fee 336364 wei for 48,052 gas
```

### What it means for the build

Testnet funding is a coordination problem, not a quantity problem.

1. Ask in the QIE Telegram for a manual drip to the deployer address, quoting the faucet address and its last payout date.
2. Any teammate wallet that already holds even 0.01 test QIE can fund every test wallet and the relayer for the whole hackathon.
3. Do not plan around "2 QIE per day per wallet". Plan around one top-up.
