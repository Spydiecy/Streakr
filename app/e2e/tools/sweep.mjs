// Return STT and tUSDC from throwaway probe wallets to the treasury.
//
// The treasury funds every new visitor through the faucet, so draining it breaks
// onboarding for everyone — the faucet starts answering 503 "faucet is out of gas"
// and nobody can place a call. A day of automated runs does drain it: each probe
// wallet takes a grant, and harness gas top-ups take more.
//
// This is the other half of e2e/tools/gas.mjs. Testing should not be a one-way
// transfer out of the treasury.
//
//   node e2e/tools/sweep.mjs <privateKey>…
//
// Sends the full tUSDC balance first, then sweeps the remaining STT minus exactly
// the gas that last transfer costs.
import {
  createWalletClient, createPublicClient, http, formatEther, formatUnits,
  encodeFunctionData, defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";

const somnia = defineChain({
  id: 50312,
  name: "Somnia Shannon",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: ["https://api.infra.testnet.somnia.network"] } },
});

const COLLATERAL = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E";
const ERC20 = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "transfer", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
];
const MAX_FEE = 12n * 10n ** 9n;
const PRIORITY = 1n * 10n ** 9n;

function treasuryAddress() {
  const env = readFileSync(new URL("../../../chain-integration/.env", import.meta.url), "utf8");
  const pk = (env.match(/^PRIVATE_KEY\s*=\s*(.+)$/m) || [])[1]?.trim();
  if (!pk) throw new Error("PRIVATE_KEY not found in chain-integration/.env");
  return privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`).address;
}

const keys = process.argv.slice(2);
if (keys.length === 0) {
  console.error("usage: node e2e/tools/sweep.mjs <privateKey>…");
  process.exit(1);
}

const to = treasuryAddress();
const pub = createPublicClient({ chain: somnia, transport: http() });
console.log(`sweeping to treasury ${to}\n`);

let sttTotal = 0n;
let usdcTotal = 0n;

for (const pk of keys) {
  const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
  if (account.address.toLowerCase() === to.toLowerCase()) {
    console.log(`${account.address}  is the treasury, skipping`);
    continue;
  }
  const wallet = createWalletClient({ account, chain: somnia, transport: http() });
  console.log(account.address);

  // ---- collateral first, because it needs gas to move
  try {
    const usdc = await pub.readContract({ address: COLLATERAL, abi: ERC20, functionName: "balanceOf", args: [account.address] });
    if (usdc > 0n) {
      const hash = await wallet.writeContract({
        address: COLLATERAL, abi: ERC20, functionName: "transfer", args: [to, usdc],
        maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: PRIORITY,
      });
      const r = await pub.waitForTransactionReceipt({ hash });
      console.log(`  tUSDC ${formatUnits(usdc, 6).padEnd(12)} ${r.status}`);
      if (r.status === "success") usdcTotal += usdc;
    } else {
      console.log("  tUSDC 0");
    }
  } catch (e) {
    console.log(`  tUSDC failed: ${String(e.shortMessage ?? e.message ?? e).slice(0, 90)}`);
  }

  // ---- then everything left over, minus this transfer's own cost
  try {
    const balance = await pub.getBalance({ address: account.address });
    const gas = await pub.estimateGas({ account, to, value: 1n }).catch(() => 21_000n);
    // A little headroom: the node rejects a transaction it cannot fully cover.
    const cost = (gas + gas / 5n) * MAX_FEE;
    if (balance <= cost) {
      console.log(`  STT   ${formatEther(balance)} — below the cost of moving it, leaving`);
    } else {
      const value = balance - cost;
      const hash = await wallet.sendTransaction({
        to, value, gas, maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: PRIORITY,
      });
      const r = await pub.waitForTransactionReceipt({ hash });
      console.log(`  STT   ${formatEther(value).padEnd(12)} ${r.status}`);
      if (r.status === "success") sttTotal += value;
    }
  } catch (e) {
    console.log(`  STT   failed: ${String(e.shortMessage ?? e.message ?? e).slice(0, 90)}`);
  }
}

const held = await pub.getBalance({ address: to });
const heldUsdc = await pub.readContract({ address: COLLATERAL, abi: ERC20, functionName: "balanceOf", args: [to] });
console.log(`\nrecovered  ${formatEther(sttTotal)} STT   ${formatUnits(usdcTotal, 6)} tUSDC`);
console.log(`treasury   ${formatEther(held)} STT   ${formatUnits(heldUsdc, 6)} tUSDC`);
// The faucet's own gas floor: below this it refuses and onboarding stops.
console.log(`faucet can fund about ${Math.floor(Number(formatEther(held)) / 0.08)} more wallet(s)`);
