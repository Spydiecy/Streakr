/**
 * Is a freshly-generated demo wallet actually usable?
 *
 * The onboarding screen offers a "pre-funded demo wallet", but the embedded
 * wallet is created client-side with `generatePrivateKey()` — nothing funds it.
 * This prints the native STT and tUSDC balances for a brand-new key next to the
 * project's own treasury wallet, which is the difference between "the demo works
 * for a visitor" and "the first call always fails".
 *
 *   npx tsx scripts/check-demo-wallet-funding.ts
 */
import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, formatEther, formatUnits } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

dotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const RPC = "https://api.infra.testnet.somnia.network";
const COLLATERAL = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E" as const;
const DECIMALS = 6;

const erc20 = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

async function main() {
  const client = createPublicClient({ transport: http(RPC) });

  const fresh = privateKeyToAccount(generatePrivateKey()).address;
  const treasury = process.env.PRIVATE_KEY
    ? privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`).address
    : null;

  const targets: [string, string][] = [["fresh demo wallet", fresh]];
  if (treasury) targets.push(["project treasury", treasury]);

  console.log(`${"who".padEnd(20)} ${"address".padEnd(44)} ${"STT (gas)".padEnd(14)} tUSDC`);
  console.log("-".repeat(92));

  for (const [who, addr] of targets) {
    const [stt, usdc] = await Promise.all([
      client.getBalance({ address: addr as `0x${string}` }),
      client.readContract({
        address: COLLATERAL,
        abi: erc20,
        functionName: "balanceOf",
        args: [addr as `0x${string}`],
      }) as Promise<bigint>,
    ]);
    console.log(
      `${who.padEnd(20)} ${addr.padEnd(44)} ${formatEther(stt).padEnd(14)} ${formatUnits(usdc, DECIMALS)}`,
    );
  }

  const freshStt = await client.getBalance({ address: fresh as `0x${string}` });
  console.log(
    `\nA fresh demo wallet has ${formatEther(freshStt)} STT, so it cannot send ANY transaction —\n` +
      "including the tUSDC faucet, which is itself a transaction. Both wallet paths\n" +
      "therefore dead-end at the first call unless something funds the address.",
  );

  await client.transport.value?.destroy?.();
}

main().then(
  () => process.exit(0),
  (e) => { console.error(e); process.exit(1); },
);
