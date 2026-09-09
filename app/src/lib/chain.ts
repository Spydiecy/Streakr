// Chain client for the Streakr app — mirrors chain-integration/packages/ec-core's
// createExchange/config, reimplemented against @somnia-chain/markets-sdk
// directly so the mobile app doesn't depend on the bot-kit workspace package
// (Metro can't resolve a sibling npm workspace outside the Expo project the
// way Node's workspaces resolution can).
//
// Keep any behavior change to address/network config in sync with
// chain-integration/packages/ec-core/src/{addresses,config}.ts if the venue
// redeploys — see docs/event-contracts.md for how those values move.

import "react-native-get-random-values"; // must be imported before viem/wallet code on RN
import { SomniaMarkets, SOMNIA_TESTNET_PRICE_FEED } from "@somnia-chain/markets-sdk";
import { createWalletClient, defineChain, http, type Chain, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NETWORK, COLLATERAL_DECIMALS, type Network } from "./networkConfig";

// Re-exported so existing importers of `NETWORK` / `Network` from this module
// keep working; the definitions live in networkConfig.ts, which has no imports.
export { NETWORK, type Network };

const ENDPOINTS: Record<Network, { rpc: string; ws: string; indexer: string }> = {
  testnet: {
    rpc: "https://api.infra.testnet.somnia.network",
    ws: "wss://api.infra.testnet.somnia.network/ws",
    indexer: "https://dev.smk.somnia.host/v1/graphql",
  },
  mainnet: {
    rpc: "https://api.infra.mainnet.somnia.network",
    ws: "wss://api.infra.mainnet.somnia.network/ws",
    indexer: "https://prd.smk.somnia.host/v1/graphql",
  },
};

const CORE = {
  binaryModule: "0x3ecC694Cef705358864a646142ac17A90E29e388",
  marketsCore: "0x2802504314685D89bF6C992CA5a8e7cC78bc0294",
  clobFactory: "0xb2BE8EE02F96379DB75f01802384593EBa9bfF04",
  binaryPoolImpl: "0x82A1FcdaA2daC2fC7D5f9909D43E68021eE966FD",
  binarySettlement: "0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23",
  collateralRouter: "0xbC0C9834B15ACE38bB50dDaa7d7f7C7CC4DC183C",
  marketCreatorFactory: "0xE6bEE93cE87c9E6e62aCb621caa7832EE47b4F6B",
  oracleHub: "0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b",
} as const;

const DEPLOYMENTS: Record<Network, { chainId: number; decimals: number; addresses: Record<string, string> }> = {
  testnet: {
    chainId: 50312,
    decimals: COLLATERAL_DECIMALS.testnet,
    addresses: {
      ...CORE,
      collateral: "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
      testUsdc: "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
      marketCreator: "0x5Ce69567dB39C8fBAd7e048bEfdbcCdfE67B44e6",
    },
  },
  mainnet: {
    chainId: 5031,
    decimals: COLLATERAL_DECIMALS.mainnet,
    addresses: {
      ...CORE,
      collateral: "0x00000022dA000002656c64D9eA6011ea952D008A",
      testUsdc: "0x00000022dA000002656c64D9eA6011ea952D008A",
      marketCreator: "0x62627805965705Cc303A7F6282DD5059921980aD",
    },
  },
};

// Measured on the Shannon testnet DreamDEX venue (2026-09-06): the binary lot
// grid enforces 1000 raw units (0.001 share) — see
// chain-integration/.env.example for the same note against the bot-kit.
export const LOT_RAW = 1000n;
export const TICK_RAW = 1000n;

export const VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";

export function deployment() {
  return DEPLOYMENTS[NETWORK];
}

export function makeChain(): Chain {
  const d = deployment();
  const ep = ENDPOINTS[NETWORK];
  return defineChain({
    id: d.chainId,
    name: `somnia-${d.chainId}`,
    nativeCurrency:
      d.chainId === 5031
        ? { name: "Somnia", symbol: "SOMI", decimals: 18 }
        : { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
    rpcUrls: { default: { http: [ep.rpc], webSocket: [ep.ws] } },
  });
}

let _readOnly: SomniaMarkets | undefined;

/**
 * Read-only exchange — no signer. Safe to construct before wallet unlock.
 *
 * Cached as a module singleton. Constructing a SomniaMarkets opens its own
 * websocket and its market registry is per-instance, so building a fresh one
 * on every poll meant re-downloading the whole registry every 15 seconds —
 * measured at ~20s to resolve one market card. Reusing the instance lets the
 * SDK's own caching and live-tail do their job.
 */
export function createReadOnlyExchange(): SomniaMarkets {
  if (_readOnly) return _readOnly;
  const ep = ENDPOINTS[NETWORK];
  _readOnly = new SomniaMarkets({
    indexerUrl: ep.indexer,
    chain: makeChain(),
    wsRpcUrl: ep.ws,
    addresses: deployment().addresses as any,
    priceFeed: NETWORK === "testnet" ? SOMNIA_TESTNET_PRICE_FEED : undefined,
  });
  return _readOnly;
}

/** Signing exchange, bound to the user's embedded wallet private key. */
export function createSignerExchange(privateKey: `0x${string}`): SomniaMarkets {
  const ep = ENDPOINTS[NETWORK];
  return new SomniaMarkets({
    indexerUrl: ep.indexer,
    chain: makeChain(),
    wsRpcUrl: ep.ws,
    addresses: deployment().addresses as any,
    priceFeed: NETWORK === "testnet" ? SOMNIA_TESTNET_PRICE_FEED : undefined,
    privateKey,
  });
}

/**
 * Signing exchange bound to an external wallet (RainbowKit / wagmi).
 *
 * The SDK accepts a viem WalletClient in place of a raw private key; on that
 * path it asks the wallet to sign and confirms via the newHeads subscription
 * rather than signing locally with a tracked nonce. Same trader surface either
 * way, so callers don't branch beyond constructing the right exchange.
 */
export function createWalletClientExchange(walletClient: unknown): SomniaMarkets {
  const ep = ENDPOINTS[NETWORK];
  return new SomniaMarkets({
    indexerUrl: ep.indexer,
    chain: makeChain(),
    wsRpcUrl: ep.ws,
    addresses: deployment().addresses as any,
    priceFeed: NETWORK === "testnet" ? SOMNIA_TESTNET_PRICE_FEED : undefined,
    walletClient: walletClient as any,
  } as any);
}

/**
 * Gas ceiling for the app's transactions.
 *
 * The SDK defaults to 10,000,000 per write. That is not just wasteful — it is a
 * hard funding gate, because a node requires the sender to hold
 * `gasLimit x gasPrice` up front regardless of what the transaction actually
 * burns. At Shannon's 6 gwei that default demands 0.06 STT sitting in the wallet
 * for every single write.
 *
 * That made small wallets unusable in a way that pointed nowhere near gas: the
 * RPC rejects the transaction with `-32602`, which the SDK surfaces as
 * "approve reverted: Missing or invalid parameters". The project treasury never
 * hit it because it holds ~1 STT.
 *
 * The ceiling has to clear what these writes genuinely cost, and on Somnia that
 * is far more than EVM intuition suggests — the collateral `approve` alone
 * estimates at 1,389,617 gas (the chain's block limit is 15 billion, so its gas
 * schedule is not Ethereum's). Measured with scripts/measure-gas.ts in
 * chain-integration.
 *
 * Both directions fail, and both mislead:
 *   too low   a 400,000 ceiling burned all 400,000 and reverted out of gas,
 *             reported as "reverted (no revert data recoverable)"
 *   too high  the transaction is refused before submission with JSON-RPC
 *             -32000, surfaced as "Missing or invalid parameters" — which reads
 *             like malformed calldata rather than a funding problem
 *
 * 4M leaves roughly 3x headroom over the approve for the order itself, while
 * keeping the required balance at ~0.032 STT per write at the current base fee.
 */
export const TX_GAS_CEILING = 2_000_000n;

/**
 * Fee the app signs with, replacing the SDK's fixed 60 gwei.
 *
 * The SDK pins `maxFeePerGas` at 60 gwei — 10x Shannon's 6 gwei base fee — on
 * every path, including when it's handed a viem WalletClient that would
 * otherwise estimate ~7.2 gwei. Because a node requires the sender to hold
 * `gasLimit x maxFeePerGas` before it will accept a transaction, that fixed
 * markup multiplies the balance a wallet must sit on by 10 for no benefit: at a
 * 2M ceiling it's 0.12 STT instead of 0.024 STT.
 *
 * On a treasury that has no self-serve refill, that is the difference between
 * funding a couple of demo wallets and funding dozens.
 *
 * 2x the base fee is ample headroom on a chain whose base fee has been flat at
 * 6 gwei. It does need to stay above the base fee — if Shannon's ever rises past
 * this, transactions will be rejected as underpriced.
 */
export const TX_MAX_FEE_PER_GAS = 12n * 10n ** 9n;

/**
 * Wrap a WalletClient so every write it sends carries TX_MAX_FEE_PER_GAS.
 *
 * A proxy rather than a spread copy: the SDK reaches for several members of the
 * client, and only the two write methods need rewriting. Fees are decided before
 * the transport is involved, so this is the last point at which they can be
 * changed — there's no transport-level hook that would work.
 */
function withFeeOverride(client: WalletClient): WalletClient {
  const fees = { maxFeePerGas: TX_MAX_FEE_PER_GAS, maxPriorityFeePerGas: 0n };
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "sendTransaction" || prop === "writeContract") {
        const fn = (target as any)[prop].bind(target);
        return (args: any) => fn({ ...args, ...fees });
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as WalletClient;
}

/**
 * A Trader with that ceiling applied as its default.
 *
 * Built explicitly rather than using `exchange.trader`, because the ceiling has
 * to cover writes the SDK issues internally — the collateral `approve` that
 * precedes a first order is the one that actually failed, and a per-call `gas`
 * override cannot reach it.
 */
export function createTrader(exchange: SomniaMarkets, signer: { privateKey: `0x${string}` } | { walletClient: unknown }) {
  // Always go through a viem WalletClient, even when we hold the key.
  //
  // The SDK's own local-signing path is faster (fixed fees, locally-tracked
  // nonce, one round-trip) but it signs with maxFeePerGas pinned at 60 gwei —
  // 10x Shannon's 6 gwei base. Since a node requires the sender to hold
  // `gasLimit x maxFeePerGas` before it will accept a transaction at all, that
  // fixed 60 gwei multiplies the balance a wallet must sit on by ~8x for no
  // benefit: at a 4M ceiling it's 0.24 STT rather than 0.032 STT.
  //
  // With a WalletClient, viem derives the fee from the current base fee, so the
  // requirement tracks reality. On a treasury that can't be faucet-refilled that
  // is the difference between funding a handful of demo wallets and dozens.
  const base =
    "privateKey" in signer
      ? createWalletClient({
          account: privateKeyToAccount(signer.privateKey),
          chain: makeChain(),
          transport: http(ENDPOINTS[NETWORK].rpc),
        })
      : (signer.walletClient as WalletClient);

  return exchange.client.createTrader({
    walletClient: withFeeOverride(base) as any,
    decimals: deployment().decimals,
    gas: TX_GAS_CEILING,
  });
}

export function explorerTxUrl(hash: string): string {
  return NETWORK === "testnet"
    ? `https://shannon-explorer.somnia.network/tx/${hash}`
    : `https://explorer.somnia.network/tx/${hash}`;
}
