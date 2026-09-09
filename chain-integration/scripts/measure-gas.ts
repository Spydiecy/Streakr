/**
 * What do the app's two writes actually cost in gas, and what does that mean for
 * how much STT a demo wallet must hold?
 *
 * This exists because the funding requirement is NOT "gas used x gas price". The
 * SDK signs with `maxFeePerGas` at 60 gwei (10x the 6 gwei base) and a default
 * `gasLimit` of 10,000,000, and a node requires the sender to hold
 * `gasLimit x maxFeePerGas` before it will even accept the transaction. That is
 * 0.6 STT per write, sitting idle, regardless of the ~tens of thousands of gas
 * the write really burns.
 *
 * Getting this wrong fails in two different misleading ways:
 *   - ceiling too high  -> rejected pre-submission with JSON-RPC -32000
 *                          "Missing or invalid parameters" (reads as an encoding bug)
 *   - ceiling too low   -> mined and reverted, out of gas, no revert data
 *
 * Measured, not assumed: a 400,000 ceiling consumed all 400,000 and reverted.
 *
 *   npx tsx scripts/measure-gas.ts
 */
import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, formatEther, formatGwei, encodeFunctionData, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

dotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const RPC = "https://api.infra.testnet.somnia.network";
const COLLATERAL = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E" as const;
// The pool the SDK approves for a binary order (from the repro's raw calldata).
const SPENDER = "0xf95d891907b63d1dee01a97d871514a66341fe55" as const;

const chain = defineChain({
  id: 50312,
  name: "somnia-50312",
  nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const approveAbi = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

async function main() {
  const c = createPublicClient({ chain, transport: http(RPC) });
  const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

  const [gasPrice, block] = await Promise.all([c.getGasPrice(), c.getBlock()]);
  console.log(`gasPrice        : ${formatGwei(gasPrice)} gwei`);
  console.log(`baseFeePerGas   : ${block.baseFeePerGas ? formatGwei(block.baseFeePerGas) : "n/a"} gwei`);
  console.log(`block gasLimit  : ${block.gasLimit}`);

  // What the approve really needs.
  let approveGas: bigint | null = null;
  try {
    approveGas = await c.estimateGas({
      account,
      to: COLLATERAL,
      data: encodeFunctionData({
        abi: approveAbi,
        functionName: "approve",
        args: [SPENDER, 2n ** 255n],
      }),
    });
    console.log(`\napprove estimateGas: ${approveGas}`);
  } catch (e) {
    console.log(`\napprove estimateGas failed: ${(e as Error).message.slice(0, 200)}`);
  }

  // The SDK signs with this, which is what actually gates affordability.
  const MAX_FEE = 60n * 10n ** 9n;
  console.log(`\nSDK maxFeePerGas: ${formatGwei(MAX_FEE)} gwei (10x base — this is what gates funding)`);

  console.log(
    `\n${"ceiling".padEnd(12)} ${"STT required".padEnd(16)} ${"wallets from 0.95 STT".padEnd(23)} verdict`,
  );
  console.log("-".repeat(78));
  const treasury = 950_000_000_000_000_000n; // ~0.95 STT
  for (const ceiling of [10_000_000n, 3_000_000n, 2_000_000n, 1_500_000n, 1_000_000n, 600_000n, 400_000n]) {
    const need = ceiling * MAX_FEE;
    // A first call needs the approve plus the order, so budget two writes.
    const perWallet = need * 2n;
    const wallets = perWallet > 0n ? treasury / perWallet : 0n;
    const executes = approveGas === null ? "?" : ceiling > approveGas ? "executes" : "OUT OF GAS";
    console.log(
      `${String(ceiling).padEnd(12)} ${formatEther(need).padEnd(16)} ${String(wallets).padEnd(23)} ${executes}`,
    );
  }

  console.log(
    `\nMeasured facts:\n` +
      `  - a 400,000 ceiling consumed all 400,000 and reverted (out of gas)\n` +
      `  - 1,500,000 and 10,000,000 ceilings were rejected before submission,\n` +
      `    because ceiling x 60 gwei exceeded a 0.04 STT balance\n` +
      `  - so the ceiling must clear the real cost AND stay affordable`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
