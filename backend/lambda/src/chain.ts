// Minimal chain-read layer, talking directly to @somnia-chain/markets-sdk.
// Mirrors chain-integration/packages/ec-core's createExchange/config — kept
// as an inlined copy (not a workspace import) so each Lambda's bundle is
// self-contained. Keep in sync with chain-integration/packages/ec-core/src/
// {addresses,config}.ts if the venue redeploys.

import { SomniaMarkets, estPayoutFor, SOMNIA_TESTNET_PRICE_FEED, type MarketOnchain } from "@somnia-chain/markets-sdk";
import { defineChain } from "viem";

export type Network = "testnet" | "mainnet";

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
    decimals: 6,
    addresses: {
      ...CORE,
      collateral: "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
      testUsdc: "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
      marketCreator: "0x5Ce69567dB39C8fBAd7e048bEfdbcCdfE67B44e6",
    },
  },
  mainnet: {
    chainId: 5031,
    decimals: 18,
    addresses: {
      ...CORE,
      collateral: "0x00000022dA000002656c64D9eA6011ea952D008A",
      testUsdc: "0x00000022dA000002656c64D9eA6011ea952D008A",
      marketCreator: "0x62627805965705Cc303A7F6282DD5059921980aD",
    },
  },
};

let cachedExchange: { network: Network; exchange: SomniaMarkets } | null = null;

/** A read-only (no signer) SomniaMarkets client, cached across warm Lambda invocations. */
export function getExchange(network: Network): SomniaMarkets {
  if (cachedExchange && cachedExchange.network === network) return cachedExchange.exchange;
  const deployment = DEPLOYMENTS[network];
  const ep = ENDPOINTS[network];
  const chain = defineChain({
    id: deployment.chainId,
    name: `somnia-${deployment.chainId}`,
    nativeCurrency:
      deployment.chainId === 5031
        ? { name: "Somnia", symbol: "SOMI", decimals: 18 }
        : { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
    rpcUrls: { default: { http: [ep.rpc], webSocket: [ep.ws] } },
  });
  const exchange = new SomniaMarkets({
    indexerUrl: ep.indexer,
    chain,
    wsRpcUrl: ep.ws,
    addresses: deployment.addresses as any,
    priceFeed: network === "testnet" ? SOMNIA_TESTNET_PRICE_FEED : undefined,
  });
  cachedExchange = { network, exchange };
  return exchange;
}

export interface SettlementRead {
  status: "trading" | "locked" | "settling" | "resolved" | "voided" | "unknown";
  isResolved: boolean;
  isVoided: boolean;
  winningOutcome: 0 | 1 | null;
  expiry: number;
  onchain: MarketOnchain;
}

export async function readSettlement(network: Network, positionId: string): Promise<SettlementRead> {
  const exchange = getExchange(network);
  const onchain = await exchange.client.getMarketOnchain(positionId as `0x${string}`);
  let status: SettlementRead["status"] = "unknown";
  if (onchain.isVoided) status = "voided";
  else if (onchain.isResolved) status = "resolved";
  else if (onchain.status === 1) status = "trading";
  else if (onchain.status === 2) status = "locked";
  else if (onchain.status === 3) status = "settling";

  return {
    status,
    isResolved: onchain.isResolved,
    isVoided: onchain.isVoided,
    winningOutcome: onchain.isVoided ? null : onchain.isResolved ? (onchain.winningOutcome === 0 ? 0 : 1) : null,
    expiry: Number(onchain.expiry),
    onchain,
  };
}

export function judgeCall(direction: "up" | "down", settlement: SettlementRead): "won" | "lost" | "void" | "pending" {
  if (settlement.status === "voided") return "void";
  if (settlement.status !== "resolved") return "pending";
  const calledLeg = direction === "up" ? 0 : 1;
  return settlement.winningOutcome === calledLeg ? "won" : "lost";
}

export function estimatePayoutRaw(settlement: SettlementRead, calledLeg: 0 | 1, amountRaw: bigint, feeBps = 0n): bigint {
  if (!settlement.isResolved && !settlement.isVoided) return 0n;
  return estPayoutFor({
    marketId: "",
    pool: settlement.onchain.pool,
    outcomeIdx: calledLeg,
    amount: amountRaw,
    winningOutcome: settlement.isVoided ? null : settlement.onchain.winningOutcome,
    voided: settlement.isVoided,
    status: settlement.isResolved || settlement.isVoided ? "Resolved" : "Trading",
    settlementFeeBps: feeBps,
  });
}

export function getNetwork(): Network {
  const n = (process.env.NETWORK ?? "testnet").toLowerCase();
  return n === "mainnet" ? "mainnet" : "testnet";
}
