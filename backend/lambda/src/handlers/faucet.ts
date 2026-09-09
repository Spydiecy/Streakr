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

/** Gas grant. Enough for several calls — a placeOrder costs roughly 0.005 STT. */
const STT_GRANT = parseEther(process.env.FAUCET_STT ?? "0.02");
/** Collateral grant, in whole tUSDC. Covers the $5–$50 stake buttons. */
const USDC_GRANT = BigInt(Math.round(Number(process.env.FAUCET_USDC ?? "150") * 10 ** DECIMALS));
/** Refuse to grant if the treasury would drop below this much gas. */
const TREASURY_MIN_STT = parseEther("0.03");
/** Max grants in any rolling 24h window. */
const DAILY_GRANT_CAP = Number(process.env.FAUCET_DAILY_CAP ?? "60");

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

  // One grant per address, ever. Checked before any spend.
  const existing = await grantRef.get();
  if (existing.exists) {
    return jsonResponse(200, {
      alreadyFunded: true,
      grantedAt: existing.data()?.grantedAt ?? null,
      message: "This address has already been funded.",
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
  if (treasuryUsdc < USDC_GRANT) {
    console.error(`faucet: treasury collateral too low (${formatUnits(treasuryUsdc, DECIMALS)} tUSDC)`);
    return jsonResponse(503, {
      error: "faucet is out of collateral — the treasury needs topping up",
      treasuryUsdc: formatUnits(treasuryUsdc, DECIMALS),
    });
  }

  // Record the grant BEFORE spending. A duplicate request that races this one
  // then loses on the create and cannot double-spend; the cost of failing after
  // this point is one address that has to be topped up by hand, which is much
  // cheaper than an unbounded drain.
  try {
    await grantRef.create({
      address,
      grantedAt: Date.now(),
      sttWei: STT_GRANT.toString(),
      usdcRaw: USDC_GRANT.toString(),
      status: "sending",
    });
  } catch {
    return jsonResponse(200, { alreadyFunded: true, message: "This address has already been funded." });
  }

  try {
    // Skip the gas grant if the address somehow already has enough — an external
    // wallet that's been fauceted elsewhere only needs collateral.
    let sttHash: string | null = null;
    if (recipientStt < STT_GRANT / 2n) {
      sttHash = await walletClient.sendTransaction({ to: address, value: STT_GRANT });
      await publicClient.waitForTransactionReceipt({ hash: sttHash as `0x${string}`, timeout: 60_000 });
    }

    const usdcHash = await walletClient.writeContract({
      address: COLLATERAL,
      abi: erc20Abi,
      functionName: "transfer",
      args: [address, USDC_GRANT],
    });
    await publicClient.waitForTransactionReceipt({ hash: usdcHash, timeout: 60_000 });

    await grantRef.update({ status: "sent", sttHash, usdcHash });

    return jsonResponse(200, {
      funded: true,
      address,
      stt: sttHash ? formatEther(STT_GRANT) : "0 (already had gas)",
      usdc: formatUnits(USDC_GRANT, DECIMALS),
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
