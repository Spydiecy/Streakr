// Balances for an address: gas, affordable writes, and collateral.
// Writes-affordable is the number that actually predicts whether a call can be
// placed — see TX_GAS_CEILING in src/lib/chain.ts.
import { createPublicClient, http, formatEther, formatUnits } from "viem";
const pub = createPublicClient({ transport: http("https://api.infra.testnet.somnia.network") });
const COST_PER_WRITE = 0.024; // 2M gas ceiling x 12 gwei
for (const addr of process.argv.slice(2)) {
  const stt = Number(formatEther(await pub.getBalance({ address: addr })));
  const usdc = await pub.readContract({
    address: "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
    abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "balanceOf", args: [addr],
  });
  console.log(`${addr}  STT ${stt.toFixed(8)}  writes ${Math.floor(stt / COST_PER_WRITE)}  tUSDC ${formatUnits(usdc, 6)}`);
}
