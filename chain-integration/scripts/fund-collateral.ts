/**
 * One-off helper: mint testnet tUSDC collateral to the signer via the public
 * faucet(uint256) on the collateral token (testnet only). Not part of the
 * bot-kit's own scripts/ — added for Streakr's dev workflow so the doctor
 * script's "collateral 0.0000" reading can be fixed without a manual cast call.
 *
 *   npx tsx scripts/fund-collateral.ts
 */
import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const { createExchange, loadConfig, shutdown, toHuman } = await import("@dreamdex-bot-kit/ec-core");

async function main() {
  const cfg = loadConfig();
  if (cfg.network === "mainnet") {
    throw new Error("refusing to faucet on mainnet — this only exists for testnet tUSDC.");
  }
  const ctx = createExchange({ withSigner: true });
  const addr = ctx.exchange.walletAddress!;
  const collateral = ctx.config.addresses.collateral ?? ctx.config.addresses.testUsdc;
  if (!collateral) throw new Error("no collateral address configured");

  const before = await ctx.exchange.client.getErc20Balance(collateral, addr);
  console.log(`collateral before: ${toHuman(before, ctx.config.decimals)} (addr ${addr})`);

  const res = await ctx.exchange.trader.faucet();
  console.log(`faucet tx: ${res.hash ?? "(no hash returned)"}`);

  await new Promise((r) => setTimeout(r, 3000));
  const after = await ctx.exchange.client.getErc20Balance(collateral, addr);
  console.log(`collateral after:  ${toHuman(after, ctx.config.decimals)}`);

  await shutdown(ctx);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
