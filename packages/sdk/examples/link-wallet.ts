// Link a guest pass to a QIE Wallet. The registry needs LinkWallet signed by both keys, so neither side can claim
// the other alone.  Run: node examples/link-wallet.ts
import { getAddress, recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { linkWalletTypedData, nowSeconds, signLinkWallet } from "@showmark/sdk";

// Placeholder registry for the demo. Set SHOWMARK_REGISTRY to the deployed ShowmarkRegistry (see docs/SDK.md).
const registry = getAddress(process.env.SHOWMARK_REGISTRY ?? "0x5157000000000000000000000000000000000001");
const domain = { chainId: 1983, registry };

const passKey = privateKeyToAccount(generatePrivateKey());
// In the app this is QIE Wallet through a viem wallet client; any signer with signTypedData works.
const wallet = privateKeyToAccount(generatePrivateKey());

const link = { pass: passKey.address, wallet: wallet.address, deadline: nowSeconds() + 600n };
const passSig = await signLinkWallet({ ...domain, ...link, signer: passKey });
const walletSig = await signLinkWallet({ ...domain, ...link, signer: wallet });

for (const [name, signature, expected] of [["pass", passSig, passKey.address], ["wallet", walletSig, wallet.address]] as const) {
  const signer = await recoverTypedDataAddress({ ...linkWalletTypedData(domain, link), signature });
  console.log(`${name} signature valid`, signer === expected);
}
// Send with: new ShowmarkClient({ chain: 1983, relayUrl }).relayLinkWallet({ ...link, passSig, walletSig, relocateEventIds: [] })
