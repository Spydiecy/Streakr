// Which network the app talks to, and the facts about it that don't require a
// client to know.
//
// Deliberately a leaf module with no imports. It used to live in chain.ts, but
// chain.ts also constructs the markets SDK and pulls in
// react-native-get-random-values, so anything wanting just "how many decimals
// does the collateral have" transitively imported a websocket-opening chain
// client. That made error formatting untestable outside a bundler, and it's the
// wrong dependency direction regardless.

export type Network = "testnet" | "mainnet";

// Hardcoded to testnet for the hackathon demo — flip via EXPO_PUBLIC_NETWORK if
// mainnet support is ever wired up (it needs its own price-feed endpoint, see
// docs/event-contracts.md "Known limitation").
export const NETWORK: Network = (process.env.EXPO_PUBLIC_NETWORK as Network) ?? "testnet";

/**
 * Decimal scale of the collateral token: tUSDC is 6 on testnet, USDso is 18 on
 * mainnet. Every raw on-chain amount the UI formats goes through this.
 */
export const COLLATERAL_DECIMALS: Record<Network, number> = {
  testnet: 6,
  mainnet: 18,
};

export function collateralDecimals(): number {
  return COLLATERAL_DECIMALS[NETWORK];
}
