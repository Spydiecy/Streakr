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
import { defineChain, type Chain } from "viem";
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

export function explorerTxUrl(hash: string): string {
  return NETWORK === "testnet"
    ? `https://shannon-explorer.somnia.network/tx/${hash}`
    : `https://explorer.somnia.network/tx/${hash}`;
}
