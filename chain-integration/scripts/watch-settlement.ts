/**
 * watch-settlement.ts — polls one Event Contract market until its window
 * closes and reports the real on-chain outcome for the position Streakr
 * placed via place-event-contract-call.ts.
 *
 * This is what Streakr's Cloud Function (`onCallSettled`, Phase 2) drives in
 * the background: given the positionId (marketId) a call was placed against,
 * poll the AUTHORITATIVE on-chain status until the market resolves or voids,
 * then report WIN / LOSS / VOID and the redeemable payout — and, if a signer
 * is configured, actually redeem it (winner receives `1 - settlement fee`
 * collateral per winning share; a void refunds both sides at 0.5).
 *
 * Inputs (env):
 *   POSITION_ID   the bytes32 marketId returned by place-event-contract-call.ts
 *                 (required)
 *   OUTCOME       "up" | "down" — which leg this wallet's call was on, so we
 *                 can report WIN/LOSS from the CALLER's perspective, not just
 *                 which side of the market won (required)
 *   POLL_MS       how often to poll while the window is still open (default 15000)
 *   TIMEOUT_MS    give up after this long (default 0 = no timeout, follow to expiry + buffer)
 *
 * Usage:
 *   POSITION_ID=0x0000...015373 OUTCOME=up npx tsx scripts/watch-settlement.ts
 */
import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const {
  createExchange,
  loadConfig,
  shutdown,
  MARKET_STATUS,
  claimableOutcomes,
  estimatePayout,
  settlementFeeBps,
  redeemOutcome,
  toHuman,
} = await import("@dreamdex-bot-kit/ec-core");

const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);
const statusName = (s: number) =>
  Object.keys(MARKET_STATUS).find((k) => MARKET_STATUS[k as keyof typeof MARKET_STATUS] === s) ?? String(s);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Result = "WIN" | "LOSS" | "VOID";

function parseArgs() {
  const positionId = (process.env.POSITION_ID ?? "").trim();
  const outcome = (process.env.OUTCOME ?? "").toLowerCase();
  const pollMs = Number(process.env.POLL_MS ?? "15000");
  const timeoutMs = Number(process.env.TIMEOUT_MS ?? "0");

  if (!positionId.startsWith("0x")) throw new Error(`POSITION_ID must be a 0x-prefixed marketId, got "${positionId}"`);
  if (outcome !== "up" && outcome !== "down") throw new Error(`OUTCOME must be "up" or "down", got "${process.env.OUTCOME}"`);

  return { positionId: positionId as `0x${string}`, outcome: outcome as "up" | "down", pollMs, timeoutMs };
}

async function main() {
  const args = parseArgs();
  const cfg = loadConfig();
  // Read-only unless a key is present — a watcher run purely to report status
  // (e.g. from a spectator or a UI poller) doesn't need to sign anything.
  const ctx = createExchange({ withSigner: Boolean(cfg.privateKey) });
  const callerLeg = args.outcome === "up" ? 0 : 1; // YES=0, NO=1 — same order the contracts use

  log(`watching positionId=${args.positionId} · caller called ${args.outcome.toUpperCase()} (leg ${callerLeg})`);

  const startedAt = Date.now();
  let lastStatus = -1;

  while (true) {
    const onchain = await ctx.exchange.client.getMarketOnchain(args.positionId).catch((e) => {
      throw new Error(`getMarketOnchain(${args.positionId}) failed: ${(e as Error).message}`);
    });

    if (onchain.status !== lastStatus) {
      log(`status → ${statusName(onchain.status)} (expiry ${new Date(Number(onchain.expiry) * 1000).toISOString()})`);
      lastStatus = onchain.status;
    }

    if (onchain.isResolved || onchain.isVoided) {
      let result: Result;
      if (onchain.isVoided) {
        result = "VOID";
      } else {
        result = onchain.winningOutcome === callerLeg ? "WIN" : "LOSS";
      }

      const addr = ctx.exchange.walletAddress;
      let payoutHuman = 0;
      let heldRaw = 0n;

      if (addr) {
        const held = {
          yes: await ctx.exchange.client.getOutcomeBalance({ outcomeToken: onchain.outcomeToken, account: addr, id: onchain.yesId }),
          no: await ctx.exchange.client.getOutcomeBalance({ outcomeToken: onchain.outcomeToken, account: addr, id: onchain.noId }),
        };
        heldRaw = callerLeg === 0 ? held.yes : held.no;

        const market = { symbol: args.positionId, info: { marketType: "BINARY", marketId: args.positionId } } as any;
        const feeBps = await settlementFeeBps(ctx, market, onchain).catch(() => 0n);
        const payoutRaw = estimatePayout({ onchain, outcome: callerLeg as 0 | 1, amount: heldRaw, feeBps });
        payoutHuman = toHuman(payoutRaw, onchain.decimals);

        const claims = claimableOutcomes(onchain, held);
        if (claims.length > 0 && ctx.canTrade && !cfg.dryRun) {
          for (const claimOutcome of claims) {
            const amount = claimOutcome === 0 ? held.yes : held.no;
            await redeemOutcome(ctx, market, onchain, claimOutcome, amount);
            log(`redeemed outcome ${claimOutcome} (${amount} raw units)`);
          }
        } else if (claims.length > 0) {
          log(`claimable but not redeeming (dryRun=${cfg.dryRun}, canTrade=${ctx.canTrade}) — run with DRY_RUN=false and a funded PRIVATE_KEY to redeem.`);
        }
      }

      console.log("\n=== SETTLEMENT ===");
      console.log(`positionId : ${args.positionId}`);
      console.log(`called     : ${args.outcome.toUpperCase()}`);
      console.log(`onchain    : ${onchain.isVoided ? "VOIDED" : `winningOutcome=${onchain.winningOutcome === 0 ? "YES/Up" : "NO/Down"}`}`);
      console.log(`result     : ${result}`);
      console.log(`heldShares : ${addr ? toHuman(heldRaw, onchain.decimals) : "(no signer — balance unknown)"}`);
      console.log(`payout     : ${addr ? payoutHuman.toFixed(4) + " tUSDC/USDso" : "(no signer)"}`);
      console.log("==================\n");

      await shutdown(ctx);
      return;
    }

    if (args.timeoutMs > 0 && Date.now() - startedAt > args.timeoutMs) {
      log(`timed out after ${args.timeoutMs}ms — market still ${statusName(onchain.status)}, not yet resolved/voided.`);
      await shutdown(ctx);
      process.exit(2);
    }

    await sleep(args.pollMs);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`ERROR: ${(e as Error).message}`);
    process.exit(1);
  },
);
