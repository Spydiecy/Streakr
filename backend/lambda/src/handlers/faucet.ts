// faucet — Lambda Function URL handler. POST { "address": "0x..." }
//
// Why this exists
// ---------------
// The onboarding screen offers a "pre-funded demo wallet", but the embedded
// wallet is generated in the browser with `generatePrivateKey()` — nothing on
// the client can fund it. A brand-new key holds 0 STT, and STT is the gas token,
// so that wallet cannot send ANY transaction. That includes the collateral
// token's own public `faucet()`, which is itself a transaction. Measured with
// chain-integration/scripts/check-demo-wallet-funding.ts:
//
//   fresh demo wallet   0 STT      0 tUSDC
//   project treasury    0.976 STT  9590 tUSDC
//
// So before this handler existed, every visitor's first call failed no matter
// which wallet path they took — an external wallet has no Shannon STT either.
//
// This grants a new address just enough to complete the loop: a little STT for
// gas plus tUSDC collateral, both transferred from the project treasury.
//
// Guards, because this spends real (testnet) treasury funds:
//   - one grant per address, ever (recorded in Firestore)
//   - a rolling 24h cap on total grants
//   - refuses to run on mainnet
//   - refuses if the treasury itself is nearly empty, so it fails loudly rather
//     than half-funding an address and leaving a confusing broken state

import { createPublicClient, createWalletClient, http, parseEther, formatEther, formatUnits, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getDb } from "../firebaseAdmin";
import { getNetwork } from "../chain";
import { jsonResponse, type LambdaHttpEvent, type LambdaHttpResponse } from "../httpTypes";

const RPC = "https://api.infra.testnet.somnia.network";
const COLLATERAL = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E" as const;
const DECIMALS = 6;

/**
 * Gas grant.
 *
 * Sized against `gasLimit x maxFeePerGas`, not against gas actually burned — a
 * node requires the sender to hold that product before it will accept a
 * transaction at all, however little the call ends up using.
 *
 * The app signs at a 2,000,000 ceiling and 12 gwei (TX_GAS_CEILING and
 * TX_MAX_FEE_PER_GAS in app/src/lib/chain.ts), so each write needs 0.024 STT
 * present. A first call makes two — the one-off collateral approve, measured at
 * 1,389,617 gas, then the order — so 0.08 STT covers that plus a couple more
 * calls.
 *
 * Undersizing this does NOT fail as "out of gas". The node refuses the
 * transaction before submission and the SDK reports it as
 * "approve reverted: Missing or invalid parameters", which points nowhere near
 * the real cause. Oversizing the ceiling instead fails the same way. See
 * chain-integration/scripts/measure-gas.ts and measure-fees.ts.
 */
const STT_GRANT = parseEther(process.env.FAUCET_STT ?? "0.08");
/** Collateral grant, in whole tUSDC. Covers the $5–$50 stake buttons. */
const USDC_GRANT = BigInt(Math.round(Number(process.env.FAUCET_USDC ?? "150") * 10 ** DECIMALS));
/** Refuse to grant if the treasury would drop below this much gas. */
const TREASURY_MIN_STT = parseEther("0.03");
/** Max grants in any rolling 24h window. */
const DAILY_GRANT_CAP = Number(process.env.FAUCET_DAILY_CAP ?? "60");
/**
 * Lifetime grants per address. More than one so a wallet that spends its gas can
 * recover, bounded so it can't be looped.
 */
const MAX_GRANTS_PER_ADDRESS = Number(process.env.FAUCET_MAX_GRANTS ?? "5");
/**
 * Only top up below this. A wallet with gas doesn't need more, and refusing above
 * the floor is what stops repeat calls draining the treasury.
 */
const GAS_FLOOR = parseEther(process.env.FAUCET_GAS_FLOOR ?? "0.05");

const erc20Abi = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const shannon = defineChain({
  id: 50312,
  name: "somnia-50312",
  nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

function parseAddress(event: LambdaHttpEvent): `0x${string}` | null {
  let raw: unknown;
  if (event.body) {
    const text = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    try {
      raw = JSON.parse(text)?.address;
    } catch {
      raw = undefined;
    }
  }
  raw = raw ?? event.queryStringParameters?.address;
  if (typeof raw !== "string") return null;
  const a = raw.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(a) ? (a.toLowerCase() as `0x${string}`) : null;
}

export const handler = async (event: LambdaHttpEvent): Promise<LambdaHttpResponse> => {
  if (getNetwork() !== "testnet") {
    return jsonResponse(400, { error: "faucet is testnet-only" });
  }

  const address = parseAddress(event);
  if (!address) {
    return jsonResponse(400, { error: "provide a valid EVM address as {\"address\":\"0x…\"}" });
  }

  const key = process.env.FAUCET_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error("faucet: FAUCET_PRIVATE_KEY missing or malformed");
    return jsonResponse(500, { error: "faucet is not configured" });
  }

  const db = getDb();
  const grantRef = db.collection("faucetGrants").doc(address);

  // Grants are capped per address, not limited to one.
  //
  // A single grant turned out to be a dead end: each call needs
  // `gasLimit x maxFeePerGas` present, so 0.08 STT covers roughly three writes.
  // A wallet that placed a few calls then ran dry could not transact again and
  // had no way to recover — the app simply stopped working for that user, and the
  // node's -32000 gave no hint why.
  //
  // Top-ups are allowed while the address is BELOW the gas floor and under a
  // lifetime cap, so a stuck wallet can recover but a script can't drain the
  // treasury by looping.
  const existing = await grantRef.get();
  const priorGrants: number = existing.exists ? (existing.data()?.grants ?? 1) : 0;

  if (priorGrants >= MAX_GRANTS_PER_ADDRESS) {
    return jsonResponse(200, {
      alreadyFunded: true,
      grants: priorGrants,
      message: `This address has reached its limit of ${MAX_GRANTS_PER_ADDRESS} funding grants.`,
    });
  }

  // Rolling 24h cap across all addresses, so a script can't drain the treasury.
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = await db.collection("faucetGrants").where("grantedAt", ">=", since).count().get();
  if (recent.data().count >= DAILY_GRANT_CAP) {
    return jsonResponse(429, { error: "faucet daily limit reached — try again tomorrow" });
  }

  const account = privateKeyToAccount(key as `0x${string}`);
  const publicClient = createPublicClient({ chain: shannon, transport: http(RPC) });
  const walletClient = createWalletClient({ account, chain: shannon, transport: http(RPC) });

  const [treasuryStt, treasuryUsdc, recipientStt] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({
      address: COLLATERAL,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    }) as Promise<bigint>,
    publicClient.getBalance({ address }),
  ]);

  if (treasuryStt < STT_GRANT + TREASURY_MIN_STT) {
    console.error(`faucet: treasury gas too low (${formatEther(treasuryStt)} STT)`);
    return jsonResponse(503, {
      error: "faucet is out of gas — the treasury needs topping up",
      treasuryStt: formatEther(treasuryStt),
    });
  }

  // A repeat request only tops up gas, and only when the wallet is actually low.
  // Collateral is handed out on the first grant only: it's the scarcer treasury
  // resource, the app can mint more via the public tUSDC faucet once it has gas,
  // and a wallet that lost its collateral lost it by trading.
  const isTopUp = priorGrants > 0;
  if (isTopUp && recipientStt >= GAS_FLOOR) {
    return jsonResponse(200, {
      alreadyFunded: true,
      grants: priorGrants,
      sttBalance: formatEther(recipientStt),
      message: "This wallet still has gas — nothing to top up.",
    });
  }
  const grantUsdc = isTopUp ? 0n : USDC_GRANT;

  if (treasuryUsdc < grantUsdc) {
    console.error(`faucet: treasury collateral too low (${formatUnits(treasuryUsdc, DECIMALS)} tUSDC)`);
    return jsonResponse(503, {
      error: "faucet is out of collateral — the treasury needs topping up",
      treasuryUsdc: formatUnits(treasuryUsdc, DECIMALS),
    });
  }

  // Record BEFORE spending. A duplicate request that races this one loses on the
  // transaction and cannot double-spend; the cost of failing after this point is
  // one address needing a manual top-up, far cheaper than an unbounded drain.
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(grantRef);
      const grants: number = snap.exists ? (snap.data()?.grants ?? 1) : 0;
      if (grants >= MAX_GRANTS_PER_ADDRESS) throw new Error("cap reached");
      tx.set(
        grantRef,
        {
          address,
          grants: grants + 1,
          grantedAt: Date.now(),
          sttWei: STT_GRANT.toString(),
          usdcRaw: grantUsdc.toString(),
          status: "sending",
        },
        { merge: true },
      );
    });
  } catch {
    return jsonResponse(200, {
      alreadyFunded: true,
      grants: priorGrants,
      message: "This address has reached its funding limit.",
    });
  }

  try {
    // Send gas whenever the wallet is below the floor.
    //
    // This used to compare against STT_GRANT/2, a second threshold that disagreed
    // with GAS_FLOOR: a wallet on 0.0478 STT passed the top-up gate (below the
    // 0.05 floor) and was then skipped here (above 0.04), so the request consumed
    // a grant, sent nothing, and still reported success. One threshold only.
    let sttHash: string | null = null;
    if (recipientStt < GAS_FLOOR) {
      sttHash = await walletClient.sendTransaction({ to: address, value: STT_GRANT });
      await publicClient.waitForTransactionReceipt({ hash: sttHash as `0x${string}`, timeout: 60_000 });
    }

    let usdcHash: string | null = null;
    if (grantUsdc > 0n) {
      usdcHash = await walletClient.writeContract({
        address: COLLATERAL,
        abi: erc20Abi,
        functionName: "transfer",
        args: [address, grantUsdc],
      });
      await publicClient.waitForTransactionReceipt({ hash: usdcHash as `0x${string}`, timeout: 60_000 });
    }

    // Nothing actually sent means nothing was needed — hand the grant back rather
    // than charging the address for a no-op, and don't claim it was funded.
    if (!sttHash && !usdcHash) {
      await grantRef.set({ grants: priorGrants, status: "noop" }, { merge: true });
      return jsonResponse(200, {
        funded: false,
        alreadyFunded: true,
        grants: priorGrants,
        sttBalance: formatEther(recipientStt),
        message: "This wallet already has gas and collateral — nothing to send.",
      });
    }

    await grantRef.update({ status: "sent", sttHash, usdcHash });

    return jsonResponse(200, {
      funded: true,
      address,
      topUp: isTopUp,
      grants: priorGrants + 1,
      stt: sttHash ? formatEther(STT_GRANT) : "0 (already had gas)",
      usdc: usdcHash ? formatUnits(grantUsdc, DECIMALS) : "0 (gas top-up only)",
      sttHash,
      usdcHash,
    });
  } catch (e) {
    // Leave the grant record in place but mark it failed, so the address can be
    // investigated rather than silently retried into a double spend.
    await grantRef.update({ status: "failed", error: String((e as Error).message ?? e) }).catch(() => {});
    console.error("faucet: transfer failed", e);
    return jsonResponse(502, { error: "funding transaction failed", detail: String((e as Error).message ?? e) });
  }
};
