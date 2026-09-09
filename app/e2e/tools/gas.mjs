// Send STT to a probe wallet from the project treasury.
//
// The product faucet deliberately keeps grants small and refuses once a wallet is
// above its gas floor, which is right for real users but leaves a test wallet
// short when a single run needs several writes (two orders plus a redeem). This
// is harness funding only — it is not part of any user-facing path.
//
//   node e2e/tools/gas.mjs <address> [amountSTT]
import { createWalletClient, createPublicClient, http, parseEther, formatEther, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const somnia = defineChain({
  id: 50312,
  name: "Somnia Shannon",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.infra.testnet.somnia.network"] } },
});

const to = process.argv[2];
const amount = process.argv[3] ?? "0.3";
if (!to) {
  console.error("usage: node e2e/tools/gas.mjs <address> [amountSTT]");
  process.exit(1);
}

// Read the treasury key from the chain-integration env rather than duplicating it.
const env = readFileSync(new URL("../../../chain-integration/.env", import.meta.url), "utf8");
const pk = (env.match(/^PRIVATE_KEY\s*=\s*(.+)$/m) || [])[1]?.trim();
if (!pk) {
  console.error("PRIVATE_KEY not found in chain-integration/.env");
  process.exit(1);
}

const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
const wallet = createWalletClient({ account, chain: somnia, transport: http() });
const pub = createPublicClient({ chain: somnia, transport: http() });

console.log(`from ${account.address}`);
console.log(`  to ${to}   ${amount} STT`);

const hash = await wallet.sendTransaction({
  to,
  value: parseEther(amount),
  // Same fee ceiling the app uses, so this behaves like an app transaction.
  maxFeePerGas: 12n * 10n ** 9n,
  maxPriorityFeePerGas: 1n * 10n ** 9n,
});
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log(`  ${receipt.status}  ${hash}`);
console.log(`  recipient now holds ${formatEther(await pub.getBalance({ address: to }))} STT`);
