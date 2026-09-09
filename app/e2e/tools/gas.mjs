// Send STT to a probe wallet from the project treasury.
//
// The product faucet deliberately keeps grants small and refuses once a wallet is
// above its gas floor, which is right for real users but leaves a test wallet
// short when one run needs several writes (two orders plus a redeem, on top of the
// first-order collateral approve). This is harness funding only — nothing in any
// user-facing path calls it.
//
//   node e2e/tools/gas.mjs <address> [amountSTT]
import { createWalletClient, createPublicClient, http, parseEther, formatEther, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

export const somnia = defineChain({
  id: 50312,
  name: "Somnia Shannon",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.infra.testnet.somnia.network"] } },
});

/** Treasury account, read from chain-integration/.env rather than duplicated. */
function treasury() {
  const env = readFileSync(new URL("../../../chain-integration/.env", import.meta.url), "utf8");
  const pk = (env.match(/^PRIVATE_KEY\s*=\s*(.+)$/m) || [])[1]?.trim();
  if (!pk) throw new Error("PRIVATE_KEY not found in chain-integration/.env");
  return privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
}

export async function sendGas(to, amount = "0.4") {
  const account = treasury();
  const wallet = createWalletClient({ account, chain: somnia, transport: http() });
  const pub = createPublicClient({ chain: somnia, transport: http() });
  const hash = await wallet.sendTransaction({
    to,
    value: parseEther(String(amount)),
    // Same fee ceiling the app uses, so this behaves like an app transaction.
    maxFeePerGas: 12n * 10n ** 9n,
    maxPriorityFeePerGas: 1n * 10n ** 9n,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const held = Number(formatEther(await pub.getBalance({ address: to })));
  return { status: receipt.status, hash, held, writes: Math.floor(held / 0.024) };
}

// CLI use.
if (import.meta.url === `file://${process.argv[1]}`) {
  const to = process.argv[2];
  if (!to) {
    console.error("usage: node e2e/tools/gas.mjs <address> [amountSTT]");
    process.exit(1);
  }
  const r = await sendGas(to, process.argv[3] ?? "0.4");
  console.log(`  ${r.status}  ${r.hash}`);
  console.log(`  ${to} now holds ${r.held} STT  (${r.writes} writes)`);
}
