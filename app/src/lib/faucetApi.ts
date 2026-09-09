// Client for the server-side faucet (backend/lambda/src/handlers/faucet.ts).
//
// This is what makes the demo wallet's "pre-funded" claim true. A key generated
// in the browser holds 0 STT, and STT is the gas token, so it cannot send any
// transaction at all — including the collateral token's own public `faucet()`,
// which is itself a transaction. Only something already holding gas can break
// that circle, so the grant has to come from the server.
//
// One grant per address, enforced server-side; calling this repeatedly is safe
// and cheap.

const FAUCET_URL = process.env.EXPO_PUBLIC_FAUCET_URL ?? "";

export const HAS_FAUCET = FAUCET_URL.length > 0;

export interface FaucetResult {
  funded: boolean;
  alreadyFunded: boolean;
  stt?: string;
  usdc?: string;
  message?: string;
}

/**
 * Ask the server to fund `address` with gas + collateral.
 *
 * Resolves (rather than throwing) when the address was already funded — that's
 * an expected outcome on a returning visitor, not an error. Throws only when the
 * request itself failed or the faucet refused, so callers can surface a real
 * message.
 */
export async function requestFaucet(address: string, timeoutMs = 90_000): Promise<FaucetResult> {
  if (!HAS_FAUCET) {
    throw new Error("Faucet is not configured (EXPO_PUBLIC_FAUCET_URL is unset).");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(FAUCET_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
      signal: controller.signal,
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      // The handler's own message is written for humans, so prefer it.
      throw new Error(
        typeof data.error === "string"
          ? data.error
          : `Faucet request failed (${res.status}).`,
      );
    }

    return {
      funded: data.funded === true,
      alreadyFunded: data.alreadyFunded === true,
      stt: typeof data.stt === "string" ? data.stt : undefined,
      usdc: typeof data.usdc === "string" ? data.usdc : undefined,
      message: typeof data.message === "string" ? data.message : undefined,
    };
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error("Funding the wallet timed out. It may still land — retry in a moment.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
