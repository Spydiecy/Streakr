// Is the deployment actually able to onboard a new visitor right now?
//
// Run this before a demo. Everything else can be perfect and the product still
// dead on arrival: the faucet funds every new wallet out of one treasury, and if
// that treasury is dry the faucet answers 503 and nobody can place a call. There
// is no way to tell from the UI other than watching a visitor fail.
//
// It has happened. A day of automated test runs drained the treasury from 4.78 STT
// to 0.05, which is 503 for everyone. Recover with e2e/tools/sweep.mjs.
//
//   node e2e/tools/preflight.mjs [faucetUrl]
import { createPublicClient, http, formatEther, formatUnits } from "viem";
import { readFileSync } from "node:fs";

const RPC = "https://api.infra.testnet.somnia.network";
const COLLATERAL = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E";
const TREASURY = "0x016ffD6f7048218e2100E6F5e340D554f2387715";
const GRANT_STT = 0.08;   // FAUCET_STT
const GRANT_USDC = 150;   // FAUCET_USDC
const FLOOR = 0.05;       // FAUCET_GAS_FLOOR — refuses below this

// Default to the URL the app is actually built with.
function faucetUrlFromEnv() {
  try {
    const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
    return (env.match(/^EXPO_PUBLIC_FAUCET_URL\s*=\s*(.+)$/m) || [])[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

const faucetUrl = process.argv[2] ?? faucetUrlFromEnv();
const pub = createPublicClient({ transport: http(RPC) });

let problems = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const warn = (m) => { console.log(`  WARN  ${m}`); };
const fail = (m) => { console.log(`  FAIL  ${m}`); problems++; };

console.log("treasury");
const stt = Number(formatEther(await pub.getBalance({ address: TREASURY })));
const usdc = Number(
  formatUnits(
    await pub.readContract({
      address: COLLATERAL,
      abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
      functionName: "balanceOf",
      args: [TREASURY],
    }),
    6,
  ),
);
const byStt = Math.floor((stt - FLOOR) / GRANT_STT);
const byUsdc = Math.floor(usdc / GRANT_USDC);
const wallets = Math.max(0, Math.min(byStt, byUsdc));

console.log(`  ${stt.toFixed(6)} STT   ${usdc.toFixed(2)} tUSDC`);
console.log(`  can onboard ~${wallets} new wallet(s)   (gas allows ${Math.max(0, byStt)}, collateral allows ${byUsdc})`);

if (stt <= FLOOR) fail(`below the faucet's ${FLOOR} STT floor — every new visitor gets a 503`);
else if (wallets < 5) fail(`only ${wallets} wallet(s) fundable — top up before demoing`);
else if (wallets < 15) warn(`${wallets} wallet(s) fundable — thin for a public demo`);
else ok(`${wallets} wallet(s) fundable`);

console.log("\nfaucet endpoint");
if (!faucetUrl) {
  fail("EXPO_PUBLIC_FAUCET_URL not found in app/.env");
} else {
  console.log(`  ${faucetUrl}`);
  // An empty POST: enough to see whether the function answers, without spending a
  // grant. A validation error is a healthy response here.
  try {
    const res = await fetch(faucetUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.text();
    console.log(`  HTTP ${res.status}  ${body.slice(0, 140)}`);
    if (res.status === 400) ok("reachable and validating input (400 on an empty body is correct)");
    else if (res.status === 503) fail("503 — the treasury is dry, onboarding is broken");
    else if (res.status === 429) warn("429 — the rolling 24h grant cap is currently full; it decays");
    else if (res.status < 500) ok(`reachable (HTTP ${res.status})`);
    else fail(`server error HTTP ${res.status}`);
  } catch (e) {
    fail(`unreachable: ${String(e.message ?? e).slice(0, 90)}`);
  }
}

console.log(`\n>>> ${problems === 0 ? "ready to demo" : `${problems} blocker(s)`}`);
process.exit(problems === 0 ? 0 : 1);
