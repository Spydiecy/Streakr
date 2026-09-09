/**
 * What maxFeePerGas does each signing path actually use, and therefore how much
 * STT must a wallet hold before a node will accept the transaction?
 *
 * A node checks `gasLimit x maxFeePerGas` up front, so the FEE, not the gas
 * actually burned, sets the funding floor. The SDK's local-signing path pins
 * maxFeePerGas at 60 gwei; the question here is whether routing through a viem
 * WalletClient lowers it, since that decides whether a fixed treasury funds a
 * handful of demo wallets or dozens.
 *
 *   npx tsx scripts/measure-fees.ts
 */
import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, formatEther, formatGwei, defineChain } from "viem";

dotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const RPC = "https://api.infra.testnet.somnia.network";
const chain = defineChain({
  id: 50312,
  name: "somnia-50312",
  nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

async function main() {
  const c = createPublicClient({ chain, transport: http(RPC) });

  const block = await c.getBlock();
  const gasPrice = await c.getGasPrice();
  console.log(`baseFeePerGas : ${block.baseFeePerGas ? formatGwei(block.baseFeePerGas) : "n/a"} gwei`);
  console.log(`eth_gasPrice  : ${formatGwei(gasPrice)} gwei`);

  let tip: bigint | null = null;
  try {
    tip = await c.estimateMaxPriorityFeePerGas();
    console.log(`eth_maxPriorityFeePerGas: ${formatGwei(tip)} gwei`);
  } catch (e) {
    console.log(`eth_maxPriorityFeePerGas unsupported: ${(e as Error).message.slice(0, 90)}`);
  }

  // What viem would actually sign with.
  let est: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint } = {};
  try {
    est = await c.estimateFeesPerGas();
    console.log(
      `\nviem estimateFeesPerGas -> maxFeePerGas ${est.maxFeePerGas ? formatGwei(est.maxFeePerGas) : "-"} gwei, ` +
        `tip ${est.maxPriorityFeePerGas ? formatGwei(est.maxPriorityFeePerGas) : "-"} gwei`,
    );
  } catch (e) {
    console.log(`\nviem estimateFeesPerGas failed: ${(e as Error).message.slice(0, 120)}`);
  }

  const SDK_FIXED = 60n * 10n ** 9n;
  const viemFee = est.maxFeePerGas ?? SDK_FIXED;
  const CEILING = 4_000_000n;
  const treasury = 950_000_000_000_000_000n;

  console.log(`\nat a ${CEILING} gas ceiling:`);
  for (const [label, fee] of [
    ["SDK local signing (fixed 60 gwei)", SDK_FIXED],
    ["viem WalletClient (estimated)", viemFee],
  ] as const) {
    const need = CEILING * fee;
    // Budget two writes: the one-off collateral approve, then the order.
    const perWallet = need * 2n;
    console.log(
      `  ${label.padEnd(36)} fee ${formatGwei(fee).padStart(5)} gwei  ` +
        `needs ${formatEther(need).padEnd(8)} STT/write  ` +
        `${(treasury / perWallet).toString().padStart(3)} wallets from 0.95 STT`,
    );
  }

  if (est.maxFeePerGas && est.maxFeePerGas >= SDK_FIXED) {
    console.log(
      `\nviem's estimate is NOT lower than the SDK's fixed fee, so switching\n` +
        `transports buys nothing — the funding floor has to be met instead.`,
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
