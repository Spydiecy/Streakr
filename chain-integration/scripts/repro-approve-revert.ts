/**
 * Reproduce "approve reverted: Missing or invalid parameters" outside the browser
 * and print the RAW error, so the cause is read rather than guessed.
 *
 * Context: a funded demo wallet (0.04 STT, 150 tUSDC — verified on-chain) still
 * fails on the collateral approve that precedes its first order. The message is
 * JSON-RPC -32602, which looks like a client encoding bug. Two candidate causes
 * worth separating:
 *
 *   1. gasLimit x gasPrice exceeding the balance — nodes sometimes report this
 *      as -32602 instead of "insufficient funds"
 *   2. the SDK's `realtime_sendRawTransaction` path (it signs locally and sends
 *      over the WebSocket) being rejected by the endpoint
 *
 * Runs the same construction the app uses, then the same call, at three gas
 * ceilings and over both transports.
 *
 *   npx tsx scripts/repro-approve-revert.ts
 */
import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, formatEther, defineChain } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SomniaMarkets, SOMNIA_TESTNET_PRICE_FEED } from "@somnia-chain/markets-sdk";

dotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const RPC = "https://api.infra.testnet.somnia.network";
const WS = "wss://api.infra.testnet.somnia.network/ws";
const INDEXER = "https://dev.smk.somnia.host/v1/graphql";
const FAUCET = process.env.FAUCET_URL ?? "https://traduksvuuiewaazk36gpjzskm0zbmar.lambda-url.us-east-1.on.aws/";
const VENUE_ID = process.env.VENUE_ID as `0x${string}`;

const CORE = {
  binaryModule: "0x3ecC694Cef705358864a646142ac17A90E29e388",
  marketsCore: "0x2802504314685D89bF6C992CA5a8e7cC78bc0294",
  clobFactory: "0xb2BE8EE02F96379DB75f01802384593EBa9bfF04",
  binaryPoolImpl: "0x82A1FcdaA2daC2fC7D5f9909D43E68021eE966FD",
  binarySettlement: "0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23",
  collateralRouter: "0xbC0C9834B15ACE38bB50dDaa7d7f7C7CC4DC183C",
  marketCreatorFactory: "0xE6bEE93cE87c9E6e62aCb621caa7832EE47b4F6B",
  oracleHub: "0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b",
  collateral: "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
  testUsdc: "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
  marketCreator: "0x5Ce69567dB39C8fBAd7e048bEfdbcCdfE67B44e6",
};

const chain = defineChain({
  id: 50312,
  name: "somnia-50312",
  nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [RPC], webSocket: [WS] } },
});

const dump = (label: string, e: any) => {
  console.log(`\n  ${label}`);
  console.log(`    name    : ${e?.name}`);
  console.log(`    message : ${String(e?.message ?? e).slice(0, 400)}`);
  for (const k of ["errorName", "reason", "data", "functionName", "address", "code", "details", "shortMessage"]) {
    if (e?.[k] !== undefined) console.log(`    ${k.padEnd(8)}: ${String(e[k]).slice(0, 200)}`);
  }
  if (e?.cause) {
    console.log(`    cause.name   : ${e.cause?.name}`);
    console.log(`    cause.message: ${String(e.cause?.message ?? "").slice(0, 400)}`);
    if (e.cause?.code !== undefined) console.log(`    cause.code   : ${e.cause.code}`);
    if (e.cause?.cause) {
      console.log(`    cause.cause.message: ${String(e.cause.cause?.message ?? "").slice(0, 300)}`);
      if (e.cause.cause?.code !== undefined) console.log(`    cause.cause.code: ${e.cause.cause.code}`);
    }
  }
};

async function main() {
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const gasPrice = await pub.getGasPrice();
  console.log(`gasPrice: ${Number(gasPrice) / 1e9} gwei`);

  // Fresh wallet, funded through the same faucet the app uses.
  const pk = generatePrivateKey();
  const addr = privateKeyToAccount(pk).address;
  console.log(`\nfresh wallet: ${addr}`);
  const res = await fetch(FAUCET, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: addr }),
  });
  console.log(`faucet: ${JSON.stringify(await res.json()).slice(0, 200)}`);
  await new Promise((r) => setTimeout(r, 6000));
  const bal = await pub.getBalance({ address: addr });
  console.log(`balance: ${formatEther(bal)} STT`);

  const exchange = new SomniaMarkets({
    indexerUrl: INDEXER,
    chain,
    wsRpcUrl: WS,
    addresses: CORE as any,
    priceFeed: SOMNIA_TESTNET_PRICE_FEED,
    privateKey: pk,
  });

  // Find something live to trade against.
  const rows = await exchange.client.listBinaryMarkets({ venueId: VENUE_ID, status: "Trading", limit: 60 });
  let target: any = null;
  for (const r of rows as any[]) {
    if (r.asset !== "BTC" && r.asset !== "ETH") continue;
    const onchain = await exchange.client.getMarketOnchain(r.marketId);
    if (onchain.status !== 1) continue;
    const book = await exchange.client.getBinaryOrderBook(onchain.pool).catch(() => null);
    if (!book?.yesAsks?.[0]) continue;
    target = { row: r, onchain, book };
    break;
  }
  if (!target) {
    console.log("\nno live market with a YES ask right now — cannot reproduce the order path");
    process.exit(0);
  }

  const { onchain, book } = target;
  const one = 10n ** BigInt(onchain.decimals);
  console.log(`\ntarget: ${target.row.asset} ${target.row.interval}  pool=${onchain.pool}`);
  console.log(`best YES ask: ${Number(book.yesAsks[0].price) / Number(one)}`);

  const price = ((BigInt(book.yesAsks[0].price) + 30_000n) / 1000n) * 1000n;
  const quantity = 5_000_000n; // 5 shares on the 1000-unit lot grid

  // Does routing through a viem WalletClient actually lower the signed fee?
  // viem estimates ~7.2 gwei against the SDK's fixed 60 gwei, which is the
  // difference between funding 1 demo wallet and 16.
  {
    const { createWalletClient } = await import("viem");
    const base = createWalletClient({
      account: privateKeyToAccount(pk),
      chain,
      transport: http(RPC),
    });

    // The SDK sets maxFeePerGas to a fixed 60 gwei even on this path, which is
    // 10x the base fee and inflates the balance a node demands up front by the
    // same factor. Fees are chosen before the transport sees anything, so
    // intercept the two write methods and substitute a fee tied to the real
    // base fee.
    const FEE_CAP = 12n * 10n ** 9n; // 2x the 6 gwei base
    const patch = (args: any) => ({ ...args, maxFeePerGas: FEE_CAP, maxPriorityFeePerGas: 0n });
    const wc = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === "sendTransaction" || prop === "writeContract") {
          const fn = (target as any)[prop].bind(target);
          return (args: any) => fn(patch(args));
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    // Must clear the approve's measured 1,389,617 gas while keeping
    // ceiling x fee under the wallet balance.
    const gas = 2_000_000n;
    console.log(`\n=== walletClient + fee override (${Number(FEE_CAP) / 1e9} gwei), ceiling ${gas} ===`);
    console.log(`    requires ${formatEther(gas * FEE_CAP)} STT, have ${formatEther(bal)}`);
    const trader = exchange.client.createTrader({
      walletClient: wc as any,
      decimals: onchain.decimals,
      gas,
    });
    try {
      const r = await trader.placeOrder({
        pool: onchain.pool,
        side: "BUY_YES",
        price,
        quantity,
        outcomeToken: onchain.outcomeToken,
        yesId: onchain.yesId,
        noId: onchain.noId,
        orderType: 1,
        expireTimestampNs: BigInt(Math.floor(Date.now() / 1000) + 60) * 1_000_000_000n,
      } as any);
      console.log(`  SUCCEEDED  hash=${r.hash} fills=${(r.fills ?? []).length}`);
      const tx = await pub.getTransaction({ hash: r.hash });
      console.log(`  signed maxFeePerGas: ${Number(tx.maxFeePerGas ?? 0n) / 1e9} gwei  gasLimit=${tx.gas}`);
      process.exit(0);
    } catch (e) {
      dump("walletClient path FAILED", e);
    }
  }

  // The gas ceiling is the variable under test.
  for (const gas of [10_000_000n, 1_500_000n, 400_000n]) {
    const required = gas * gasPrice;
    console.log(
      `\n=== gas ceiling ${gas} -> requires ${formatEther(required)} STT (have ${formatEther(bal)}) ${
        required > bal ? "*** UNAFFORDABLE ***" : "affordable"
      }`,
    );
    const trader = exchange.client.createTrader({ privateKey: pk, decimals: onchain.decimals, gas });
    try {
      const r = await trader.placeOrder({
        pool: onchain.pool,
        side: "BUY_YES",
        price,
        quantity,
        outcomeToken: onchain.outcomeToken,
        yesId: onchain.yesId,
        noId: onchain.noId,
        orderType: 1,
        expireTimestampNs: BigInt(Math.floor(Date.now() / 1000) + 60) * 1_000_000_000n,
      } as any);
      console.log(`  SUCCEEDED  hash=${r.hash} fills=${(r.fills ?? []).length}`);
      break;
    } catch (e) {
      dump("FAILED", e);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
