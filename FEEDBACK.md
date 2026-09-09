# Developer feedback — building Streakr on DreamDEX Event Contracts

Findings from building [Streakr](https://github.com/Spydiecy/Streakr), a social
prediction app on DreamDEX Event Contracts (Somnia Shannon testnet), during the
hackathon window.

Everything below was hit for real while shipping, and every measurement is
reproducible from a script in this repo rather than recalled from memory. Where a
number appears, the script that produced it is named.

The SDK did the hard parts well — one client surface for reads, books, writes and
settlement, and a genuinely good doc-comment culture (several gotchas below are
*documented* in the type definitions, just not enforced or surfaced where a
consumer would look). The issues that cost the most time were all of one shape:
**a condition the SDK knows about, reported through an error that points
somewhere else.**

Sections:

1. [Blockers](#1-blockers) — stopped the product working for end users
2. [Correctness traps](#2-correctness-traps) — code that looks right and silently isn't
3. [Discoverability](#3-discoverability) — right answer exists, hard to find
4. [Ecosystem](#4-ecosystem-liquidity) — liquidity
5. [Suggested fixes, ranked](#5-suggested-fixes-ranked)
6. [Non-Somnia issues](#6-non-somnia-issues) — for other teams on the same stack

---

## 1 · Blockers

### 1.1 A fixed 60 gwei `maxFeePerGas` makes every end-user wallet unusable

**Severity: highest.** This is the single biggest issue we hit. It has nothing to
do with our architecture — it affects *any* wallet a real user brings.

The trader signs with `maxFeePerGas` pinned at **60 gwei**, which is 10× Shannon's
6 gwei base fee, and defaults `gasLimit` to **10,000,000**. A node requires the
sender to hold `gasLimit × maxFeePerGas` before it will *accept* a transaction,
regardless of what the call actually burns. So every single write demands:

```
10,000,000 × 60 gwei = 0.6 STT
```

sitting idle in the wallet. Not spent — just held. A judge connecting MetaMask
with a normal faucet grant has nowhere near that, so their first call fails.

The fee is applied even when the trader is constructed with a viem
`WalletClient` that would otherwise estimate the fee itself:

```
viem estimateFeesPerGas  ->  7.2 gwei      (baseFee 6 gwei, tip 0)
what actually gets signed ->  60 gwei
```

So switching transport does not help. Confirmed by decoding the raw signed
transaction — `measure-fees.ts` prints both, `repro-approve-revert.ts` dumps the
raw tx.

**And the error points nowhere near gas.** The node rejects with JSON-RPC
`-32000`, which the SDK surfaces as:

```
@somnia-chain/markets-sdk: approve reverted: Missing or invalid parameters.
Double check you have provided the correct parameters.
```

That reads as malformed calldata. We spent a long time inspecting ABI encoding
before decoding the raw transaction and finding the fee.

**Workaround** (`app/src/lib/chain.ts`): route through a viem `WalletClient`
wrapped in a `Proxy` that overrides `maxFeePerGas` on `sendTransaction` and
`writeContract`. Fees are chosen before the transport is reachable, so a proxy on
the client is the last available hook. With 12 gwei and a 2,000,000 ceiling the
requirement drops from 0.6 STT to 0.024 STT per write — a 25× reduction, and the
difference between funding one demo wallet from our treasury and funding dozens.

**Suggested fix:** derive `maxFeePerGas` from the current base fee, or expose it
on `TraderConfig` alongside `gas`. `TraderConfig.gas` already exists; a
`maxFeePerGas` sibling would have made this a one-line configuration instead of a
day.

---

### 1.2 Somnia's gas costs are ~30× what EVM experience predicts

A plain ERC-20 `approve` on the testnet collateral token:

```
eth_estimateGas  ->  1,389,617
```

On Ethereum that call is ~46,000 gas. Somnia's block gas limit is
**15,000,000,000**, so the gas schedule is clearly its own thing — but nothing in
the docs says "our gas numbers are an order of magnitude larger than you expect",
and every instinct about sizing a gas limit is wrong as a result.

This interacts badly with 1.1: the ceiling must clear ~1.4M to execute, but
`ceiling × 60 gwei` must stay affordable. Those two constraints nearly exclude
each other on a normally-funded wallet.

Measured by `chain-integration/scripts/measure-gas.ts`.

**Suggested fix:** a short "gas on Somnia" doc note with typical costs for the
common Event Contract operations (approve, placeOrder, redeem). One table would
have saved the entire investigation.

---

### 1.3 Getting the gas ceiling wrong fails in two opposite, equally misleading ways

Neither failure mode mentions gas:

| Ceiling | What happens | What you see |
|---|---|---|
| Too high | rejected before submission | `-32000` → *"Missing or invalid parameters"* — looks like bad calldata |
| Too low | mined, then reverted | *"reverted (no revert data recoverable)"* — looks like a contract bug |

We measured a 400,000 ceiling consuming all 400,000 and reverting. There is no
`out of gas` anywhere in either message.

**Suggested fix:** in the SDK's error wrapper, when a write fails with `-32000` /
`-32602`, compare the signer's balance against `gasLimit × maxFeePerGas` and say
so. The SDK has every input needed to diagnose this precisely.

---

## 2 · Correctness traps

### 2.1 Cadence jitter silently drops live markets

`intervalSec` is derived from `expiry − tradingStart`, and trading routinely opens
a second or two late. A 15-minute series is therefore indexed as **899** or
**898** as often as 900.

The SDK documents this and applies a ±`CADENCE_TOLERANCE_SEC` band to its *own*
`intervalSec` filter — but a consumer mapping `intervalSec` to a label naturally
writes `=== 900`, and then live markets vanish from the UI at random.

Caught live by `chain-integration/scripts/check-cadence-labels.ts`:

```
asset  intervalSec  sdkLabel  exact  snapped
ETH    899          15m       NULL   15m      <-- dropped by exact match
```

In our app this presented as the 4h/1d window chips appearing and disappearing
between polls, which looked like a UI bug for a long time before we found the
real cause.

Note also that `interval` labels `86400` as `"24h"`, so a consumer using `"1d"`
in its own vocabulary will render a mismatch against its own chips.

**Suggested fix:** have the SDK expose a `cadence` field already snapped to its
`CADENCE_LADDER_SEC` rung. It does this internally for `interval`; exposing the
snapped seconds too would remove the trap entirely.

---

### 2.2 The NO leg cannot be priced as `1 − yesBid`

This one produces *no error at all* — the order just never fills, which is the
worst possible failure mode.

Deriving the NO price as `1 − yesBid` and then adding slippage moves the price the
**wrong direction**, so an IOC never crosses and silently returns unfilled. It
looks exactly like an empty book.

The fix is to read each leg's own asks — `yesAsks` for UP, `noAsks` for DOWN.
`getBinaryOrderBook(pool)` already returns all four sides, so the right answer is
one field away from the wrong one.

**Suggested fix:** a warning in `getBinaryOrderBook`'s doc comment, or a
`quoteFor(side)` helper that picks the correct side. This is a very easy mistake
to make and gives no feedback when made.

---

### 2.3 A reverted receipt still resolves successfully

`placeOrder` resolves rather than throwing when the receipt status is `reverted`.
A failed call therefore looks like a successful one unless the caller explicitly
checks:

```ts
if (res.receipt?.status === "reverted") throw new Error(...)
```

For an app that records calls to a database on success, this means writing a row
for a transaction that reverted. We hit this and now check explicitly
(`app/src/lib/eventContracts.ts`).

**Suggested fix:** throw by default on a reverted receipt, or return a
discriminated result so the failure can't be ignored by omission.

---

### 2.4 `loadMarkets()` is slow *and* hides live markets

Measured with `chain-integration/scripts/profile-market-reads.ts`:

| Call | Time | Result |
|---|---|---|
| `loadMarkets(true)` | **18.06s** | 608 markets, all venues |
| `listBinaryMarkets({ venueId, status: "Trading", limit: 60 })` | **2.24s** | our venue only |
| `getMarketOnchain` ×50 parallel | 1.69s | |

8× slower is the smaller problem. The real problem: `loadMarkets`' derived
`active` flag **hid a live BTC 1h market** that the indexer reported as
`Trading` and that we successfully traded against via the targeted query. A
consumer trusting `active` sees fewer markets than exist.

**Suggested fix:** document what `active` actually derives from, and point new
consumers at `listBinaryMarkets` for discovery. `loadMarkets` reads as the obvious
entry point and is the wrong one for this use case.

---

### 2.5 Lot grid: documented default is wrong for the live venue

`packages/ec-core/src/config.ts` documents testnet as having "no lot constraint in
practice" (`MM_LOT=1`). Measured against the live Shannon venue, every order at
that default reverted:

```
InvalidQuantity(9652509, 1000)
```

The venue enforces a **1000-raw-unit** grid (0.001 share). The second argument is
the required lot size, which is helpful — but only once you know to read it that
way.

**Suggested fix:** read the lot size from the venue rather than from config, or
default `MM_LOT` to the observed venue value.

---

### 2.6 Price feed timeframes are undocumented and fail at runtime

`fetchPriceOHLCV` accepts only `1m`, `1h`, `1d`. Passing `"5m"` — a completely
ordinary candle interval — throws *"unknown price timeframe"* at runtime. We had
built our momentum signal on 5m before discovering this.

There is also **no mainnet price-feed endpoint**, which means the same code path
cannot run on mainnet at all.

**Suggested fix:** type the parameter as a union so it fails at compile time, and
state the mainnet gap in the docs.

---

### 2.7 `venueId` moves, and nothing warns you

Venue IDs changed three times in the first week of August. Markets from every
venue sit side by side in the indexer, so a stale `venueId` returns **zero rows**
rather than an error — indistinguishable from "no markets are live right now".

We ended up documenting "if a bot reports no markets, read the venueId off a live
market row rather than trusting this file" in our own `.env`.

**Suggested fix:** a `listVenues()` helper, or have the scoped queries warn when a
`venueId` matches nothing in the index.

---

### 2.8 Settlement is invisible, and winnings don't arrive

Two related behaviours that are correct but easy to miss:

- **Nothing about a market's local representation changes when it settles.** The
  state change is on-chain and something has to go look. There is no event or
  subscription that fires on resolution, so an app must poll. We run an
  EventBridge-scheduled Lambda every 60 seconds.
- **A settled market pays out only when asked.** The position doesn't decay into
  collateral; it sits there. A bot that trades for a week and never redeems has
  its balance spread across finalised markets while its wallet reads near zero.

The bot-kit's own comments say this clearly — credit where due — but it's the kind
of thing worth stating in the *first* Event Contracts doc a developer reads, not
in a source comment they may never open.

---

## 3 · Discoverability

### 3.1 The top-level README points newcomers at the wrong primitive

The Bot Kit README's overview table presents `packages/core` / `Pool.load` /
`topOfBook()` as *the* client pattern and never mentions `packages/ec-core`. But
Event Contracts have their own package, their own preflight script
(`ec-doctor.ts`) and their own reference strategies.

A newcomer following the top-level quickstart builds against the spot/perp CLOB
path and gets a long way before realising binary markets aren't served by it. You
only find `ec-core` by drilling into `strategies/ec-*` or opening
`docs/event-contracts.md` directly.

**Suggested fix:** one line in the overview table: *"binary / Event Contracts →
`packages/ec-core`"*.

---

### 3.2 No wallet-onboarding pattern exists for end-user apps

Every example assumes a raw `PRIVATE_KEY` in `.env`. That's correct for bots,
which is what the kit is for — but the hackathon explicitly invited consumer apps,
and there is no reference anywhere for WalletConnect, an embedded//AA wallet, or
even a "here's how to accept a viem `WalletClient`" note.

We found the `walletClient` option in the type definitions rather than the docs,
and its behavioural difference from the `privateKey` path (pre-send RPCs, confirm
via `newHeads`, versus local signing with a tracked nonce) is documented in a
type comment that's easy to miss and materially affects both latency and — per
1.1 — funding.

**Suggested fix:** one worked example of a browser wallet placing an Event
Contract order. This is the single most valuable doc addition for consumer
builders.

---

### 3.3 `settlementFeeBps` isn't readable from the unified surface

`estPayoutFor` needs `settlementFeeBps`, but getting it requires either an indexer
row with fee fields populated, or a signer-free on-chain read through a
hand-copied minimal ABI. There's no plain read method on the unified SDK surface.

We ended up parsing `getBinaryPoolParams()` through a hand-written ABI fragment.

---

## 4 · Ecosystem: liquidity

Not an SDK bug, but the thing most likely to make a working integration look
broken — and worth flagging because we were far from alone. Several other teams
independently reported the same:

- one measured 83.5% of 5,000 markets never seeing a single trade
- another watched 8 live markets for 32 minutes with zero trades

Our own experience matches. Repeatedly, **only one leg of a market was priced**:

```
BTC 1h    UP 0.020    DOWN —
ETH 4h    UP —        DOWN 0.538
```

Calling the unpriced side cannot fill, no matter how correct the integration is.
We also saw asks at `0.020` and `0.996` — prices implying 2% and 99.6%
probability on a coin-flip-ish 1h window, i.e. a stale or thin book rather than a
real market.

Two knock-on effects worth naming:

- **The venue rotates which cadences it runs.** At one point only 4h and 1d were
  live; at another, 15m/1h/4h/1d all were. It also runs series we don't surface
  (1m, 5m, and oddities like 3s, 5s, 52s). An app that hard-codes its window list
  shows the user an empty screen through no fault of its own. We derive the list
  from live markets (`availableWindows()`).
- **Demos are hostage to it.** Our app now reports "Nobody on the other side"
  honestly rather than surfacing a confusing revert, but no amount of error
  handling creates a counterparty.

**Suggested fix:** a house market maker on the flagship BTC/ETH series, even at a
wide spread, would transform the developer and demo experience. Right now the
most common first-run outcome for a correctly-built integration is an unfillable
order.

---

## 5 · Suggested fixes, ranked

If only a few of these are actioned, we'd argue for this order:

1. **Derive `maxFeePerGas` from the base fee, or make it configurable.** (1.1)
   Single highest-impact change. Today no ordinary end-user wallet can place a
   call without a workaround.
2. **Diagnose the funding condition in the error.** (1.3) The SDK has the balance,
   the gas limit and the fee; it can say "wallet holds X, this transaction
   requires Y" instead of "Missing or invalid parameters".
3. **A house market maker on BTC/ETH.** (4) Turns a correct integration into a
   working demo.
4. **Publish typical gas costs for Somnia.** (1.2) One table.
5. **Expose a snapped `cadence`.** (2.1) Removes a whole class of silent
   market-dropping.
6. **One browser-wallet example.** (3.2) Unblocks every consumer app.
7. **Throw on reverted receipts.** (2.3) Prevents recording failed transactions as
   successful.

---

## 6 · Non-Somnia issues

Not DreamDEX's concern, but every one of these cost real time and any team using
Expo web + Firebase + Vercel will hit them. Recording them here in case it saves
someone the debugging.

**Vercel strips `node_modules` from static uploads.** `expo export` mirrors an
asset's source path into the output, so `@expo/vector-icons` fonts land in
`dist/assets/node_modules/...` — and all 30 of them 404 in production only. Icons
render as blank boxes and the failed font fetch appears as an unhandled
`NetworkError`. Fixed by relocating them post-export
(`app/scripts/relocate-vendor-assets.mjs`).

**Metro caches env inlining.** Editing `.env` without `--clear` produces a bundle
carrying the *previous* `EXPO_PUBLIC_*` values, with no warning. We now assert
every value is present in the output (`app/scripts/verify-web-build.mjs`).

**`Alert.alert` with buttons is a no-op on react-native-web.** Callbacks never
fire, so a confirmation dialog silently does nothing on the primary demo surface.
Needed a real in-app dialog component.

**Firebase's browser build has no `getReactNativePersistence`.** It exists only in
the react-native build, so a shared import fails at runtime with
`(0,n.getReactNativePersistence) is not a function`. Needs a platform split.

**`expo-secure-store` has no web implementation** — `getValueWithKeyAsync is not a
function`. Also needs a platform split.

**RainbowKit's `<div data-rk>` collapses a react-native-web layout.** It's
`display: block; height: auto`, which breaks the flex chain and silently yields
`height: 0` — no console error, blank screen. Fixed with a targeted CSS override.

**`porto`** (transitive via wagmi connectors) ships TypeScript source with
`.js`-extension imports that Metro can't resolve; needs a resolver stub.

---

<sub>Written while building Streakr for the Somnia/DreamDEX hackathon. Every
measurement above is reproducible from `chain-integration/scripts/` — see
`measure-gas.ts`, `measure-fees.ts`, `repro-approve-revert.ts`,
`check-cadence-labels.ts`, `check-window-timing.ts`, `profile-market-reads.ts`
and `check-demo-wallet-funding.ts`.</sub>
