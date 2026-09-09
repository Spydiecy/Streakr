/**
 * Redeem a settled winning position with an arbitrary key, and prove the
 * collateral balance moved.
 *
 * This is the on-chain half of verifying the app's Claim action. The UI path is
 * `claimCall()` in app/src/lib/eventContracts.ts; this performs the same three
 * steps against the same SDK surface — read the market, read the winning leg's
 * balance, redeem that balance — while reporting collateral either side, which is
 * the only evidence that redemption actually pays out.
 *
 * It exists because a claim needs the *user's* key. The settlement poller has no
 * access to one, and the treasury holds no positions, so there was nothing to
 * exercise the path with until a run generated a wallet that won.
 *
 *   PK=0x... npx tsx scripts/redeem-position.ts [marketId]
 *
 * With no marketId, scans recent settled markets and redeems the first position
 * holding value.
 */
import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
dotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const pk = process.env.PK;
if (!pk) {
  console.error("set PK to the private key holding the position");
  process.exit(1);
}
// The bot kit reads the signer from PRIVATE_KEY, so point it at the key we want.
process.env.PRIVATE_KEY = pk;

const { createPublicClient, http } = await import("viem");
const { createExchange, shutdown, toHuman } = await import("@dreamdex-bot-kit/ec-core");

async function main() {
  const ctx = createExchange({ withSigner: true });
  const me = ctx.exchange.walletAddress! as `0x${string}`;
  console.log("signer:", me);

  // Read the collateral ERC-20 directly: the SDK client has no
  // getCollateralBalance, and the token address is the one the app uses
  // (NETWORKS.testnet.addresses.collateral).
  const pub = createPublicClient({ transport: http(process.env.RPC_URL ?? "https://api.infra.testnet.somnia.network") });
  const COLLATERAL = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E" as const;
  const collateral = () =>
    pub.readContract({
      address: COLLATERAL,
      abi: [
        {
          name: "balanceOf",
          type: "function",
          stateMutability: "view",
          inputs: [{ type: "address" }],
          outputs: [{ type: "uint256" }],
        },
      ],
      functionName: "balanceOf",
      args: [me],
    }) as Promise<bigint>;

  const wanted = process.argv[2] as `0x${string}` | undefined;
  const candidates: `0x${string}`[] = [];

  if (wanted) {
    candidates.push(wanted);
  } else {
    const rows = await ctx.exchange.client.listPastBinaryMarkets({
      venueId: process.env.VENUE_ID as `0x${string}`,
      limit: 40,
    } as never);
    console.log("settled markets scanned:", (rows as any[]).length);
    for (const r of rows as any[]) candidates.push(r.marketId);
  }

  for (const marketId of candidates) {
    const onchain = await ctx.exchange.client.getMarketOnchain(marketId).catch(() => null);
    if (!onchain || !(onchain.isResolved || onchain.isVoided)) continue;

    const [yes, no] = await Promise.all([
      ctx.exchange.client.getOutcomeBalance({ outcomeToken: onchain.outcomeToken, account: me, id: onchain.yesId }),
      ctx.exchange.client.getOutcomeBalance({ outcomeToken: onchain.outcomeToken, account: me, id: onchain.noId }),
    ]);

    // On a void, both legs are redeemable; otherwise only the winning one.
    const outcomeIdx = onchain.isVoided ? (yes > 0n ? 0 : 1) : onchain.winningOutcome;
    const amount = onchain.isVoided ? (yes > 0n ? yes : no) : outcomeIdx === 0 ? yes : no;
    if (amount <= 0n) continue;

    console.log(`\nmarket ${marketId}`);
    console.log(`  resolved=${onchain.isResolved} voided=${onchain.isVoided} winning=${onchain.winningOutcome}`);
    console.log(`  held YES ${toHuman(yes, onchain.decimals)}   held NO ${toHuman(no, onchain.decimals)}`);
    console.log(`  redeeming ${toHuman(amount, onchain.decimals)} outcome tokens from leg ${outcomeIdx}`);

    const before = await collateral();
    console.log(`  collateral before: ${toHuman(before, onchain.decimals)}`);

    // amount is in OUTCOME TOKENS, not collateral and not the displayed payout —
    // passing either of those under-redeems and strands the remainder.
    const res = await ctx.exchange.trader.redeem({
      marketId,
      market: onchain.marketAddress,
      outcomeToken: onchain.outcomeToken,
      outcomeIdx,
      amount,
    });
    console.log(`  tx ${res.txHash ?? res.hash ?? "(none)"}`);

    const after = await collateral();
    console.log(`  collateral after : ${toHuman(after, onchain.decimals)}`);
    const delta = after - before;
    console.log(`  delta            : +${toHuman(delta, onchain.decimals)}`);

    if (delta > 0n) {
      console.log("\n  ok — redemption moved collateral into the wallet");
      await shutdown(ctx);
      return;
    }
    console.log("\n  *** redemption did not increase collateral ***");
    await shutdown(ctx);
    process.exit(1);
  }

  console.log("\nno position with claimable value found for this signer");
  await shutdown(ctx);
}

main().then(() => process.exit(0), (e) => { console.error(e.stack ?? e.message ?? e); process.exit(1); });
