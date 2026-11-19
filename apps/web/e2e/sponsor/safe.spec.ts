import { expect, test } from "@playwright/test";
import { decodeFunctionData, getAddress } from "viem";
import { erc20Abi, vaultAbi } from "../../src/lib/chain/abi";
import { ADDR, BASE_URL, chainState, mockApi, mockChain } from "./harness";

const SAFE = getAddress("0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe");
const SAFE_TX_HASH = `0x${"5a".repeat(32)}`;

/**
 * A stand-in for safe.qie.digital: frames the sponsor console and answers the Safe Apps SDK's postMessage calls the
 * way Safe{Wallet} does (same message shape and version field).
 */
function hostPage(appUrl: string) {
  return `<!doctype html><html><body style="margin:0">
<iframe id="app" src="${appUrl}" style="border:0;width:100vw;height:100vh"></iframe>
<script>
  window.__proposals = [];
  const answers = {
    getSafeInfo: () => ({ safeAddress: "${SAFE}", chainId: 1983, threshold: 2, owners: ["${SAFE}", "0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002"], isReadOnly: false }),
    getChainInfo: () => ({ chainName: "QIE Testnet", chainId: "1983", shortName: "qietest", nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18, logoUri: "" }, blockExplorerUriTemplate: {} }),
    sendTransactions: (params) => { window.__proposals.push(params.txs); return { safeTxHash: "${SAFE_TX_HASH}" }; },
    getTxBySafeTxHash: () => ({ txHash: null }),
  };
  window.addEventListener("message", (event) => {
    const { id, method, params } = event.data || {};
    if (!id || !answers[method]) return;
    event.source.postMessage({ id, success: true, version: "9.1.0", data: answers[method](params) }, "*");
  });
</script></body></html>`;
}

// Chrome's local network access checks block a public origin from framing localhost. The real deployment is public
// on both sides, so the check is switched off for this test only.
test.use({
  launchOptions: {
    args: ["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessForNavigations,PrivateNetworkAccessRespectPreflightResults"],
  },
});

test("inside safe.qie.digital, a QUSDC campaign is proposed to the Safe as one approve and create batch", async ({ page }) => {
  const state = chainState();
  await mockChain(page, state);
  await mockApi(page);
  await page.route("https://safe.qie.digital/**", (route) => route.fulfill({ contentType: "text/html", body: hostPage(`${BASE_URL}/sponsor/new`) }));
  await page.goto("https://safe.qie.digital/apps/open");

  const app = page.frameLocator("#app");
  await expect(app.getByRole("form", { name: "New campaign" })).toBeVisible();
  await app.getByLabel("Campaign name").fill("Treasury funded nights");
  await app.getByLabel("Sponsor name").fill("Acme DAO");
  await app.getByRole("radio", { name: /QUSDC/ }).check({ force: true });
  await app.getByLabel("QUSDC per verified person").fill("2");
  await app.getByLabel("Deposit in QUSDC").fill("500");
  await app.getByRole("button", { name: "Review and fund" }).click();
  await expect(app.getByText("Each step is proposed to your Safe. Nothing moves until the owners confirm.")).toBeVisible();
  await app.getByRole("button", { name: "Propose to the Safe" }).click();
  await expect(app.getByText(/Proposed to the Safe/)).toBeVisible();
  await expect(app.getByRole("link", { name: /Open the Safe queue/ })).toHaveAttribute(
    "href",
    `https://safe-testnet.qie.digital/transactions/queue?safe=qietest:${SAFE}`,
  );

  const proposals = (await page.evaluate(() => (window as unknown as { __proposals: unknown[] }).__proposals)) as { to: string; value: string; data: `0x${string}` }[][];
  expect(proposals).toHaveLength(1);
  const [approve, create] = proposals[0]!;
  expect(getAddress(approve!.to)).toBe(ADDR.qusdc);
  expect(decodeFunctionData({ abi: erc20Abi, data: approve!.data }).args).toEqual([ADDR.vault, 500_000_000n]);
  expect(getAddress(create!.to)).toBe(ADDR.vault);
  expect(create!.value).toBe("0");
  const call = decodeFunctionData({ abi: vaultAbi, data: create!.data });
  expect(call.functionName).toBe("createCampaign");
  // Nothing was sent from a browser wallet; the Safe owners execute it.
  expect(state.sent).toHaveLength(0);
});

test("serves the Safe App manifest cross-origin at /sponsor/manifest.json", async ({ request }) => {
  const response = await request.get(`${BASE_URL}/sponsor/manifest.json`, { headers: { origin: "https://safe.qie.digital" } });
  expect(response.status()).toBe(200);
  expect(response.headers()["access-control-allow-origin"]).toBe("*");
  const manifest = (await response.json()) as { name: string; description: string; iconPath: string };
  expect(manifest.name).toBe("Showmark");
  expect(manifest.description.length).toBeGreaterThan(20);
  const icon = await request.get(manifest.iconPath);
  expect(icon.headers()["content-type"]).toContain("image/svg+xml");
});
