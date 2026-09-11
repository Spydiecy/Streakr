# Streakr

### Someone in your group chat says *"BTC's dumping, watch."*

Five minutes later the chain has settled it, a bot has posted the receipt with a
transaction link, and they've lost their streak in front of everyone.

That's Streakr.

**Live app** · [streakr-opal.vercel.app](https://streakr-opal.vercel.app)
**Telegram Mini App** · [t.me/streak_r_bot](https://t.me/streak_r_bot) → tap **Open Streakr**
**Code** · [github.com/Spydiecy/Streakr](https://github.com/Spydiecy/Streakr)
**Chain** · Somnia Shannon testnet · DreamDEX Event Contracts

The Telegram link runs the *same deployment* as the web app — same URL, no second
build, no separate hosting.

| A live 5m market | Confirming a call | Inside Telegram |
|---|---|---|
| ![Room screen](https://raw.githubusercontent.com/Spydiecy/Streakr/main/docs/screenshots/03-room.png) | ![Call sheet](https://raw.githubusercontent.com/Spydiecy/Streakr/main/docs/screenshots/05-call-sheet.png) | ![Telegram Mini App](https://raw.githubusercontent.com/Spydiecy/Streakr/main/docs/screenshots/06-telegram-miniapp.png) |
| 1:47 left · UP pays 5.71× · DOWN pays 1.18× · sparkline sized to the window | Risk 5.00 → win 28.57, and the sentence that makes it a game: *downside is capped at your stake* | The same deployed URL, leading with the funded wallet because no extension can exist in a WebView |

---

## By the numbers

| Count | What it counts |
|---|---|
| **111** | automated checks — 81 app unit, 20 backend unit, 10 browser, **0 mocks** |
| **6** | AWS Lambdas, one on a 60-second schedule |
| **5** | market cadences, all derived from live venue state, none hard-coded |
| **3** | surfaces from one codebase — web, native, Telegram Mini App |
| **17** | documented SDK findings, every number reproducible from a script |
| **25×** | reduction in gas a wallet must hold per write, after measuring it |
| **27** | chain scripts written to measure rather than guess |

---

## The problem

Prediction markets are the best-designed financial primitive almost nobody uses
casually. The maths is elegant, the incentives are honest, and the interface is an
order book — so the mental model you need is *trading desk*, and normal people
bounce off it in seconds.

Meanwhile, the single most-used prediction market on earth has no smart contract at
all. It's a group chat:

> *"£20 says ETH closes red."*
> *"You're on."*

That bet has no settlement layer, no record, and no way to prove who was right last
Tuesday. Streakr is that bet, wired to a real order book.

---

## The idea

> **Will BTC be up or down in 5 minutes? Pick a side. Stake $5. Loser buys coffee.**

You create a **room**, your friends join, and every call lands in one shared feed
with a live leaderboard. Get it right, your streak climbs. Get it wrong, it resets
to zero — and you lose *exactly* your stake, never more. No margin. No liquidation.
No funding rate. No way to lose your rent.

Every single call is a **wallet-signed transaction against a real order book.**
Nothing in this project is simulated, anywhere.

---

## The room

| The shared feed and board | Getting started |
|---|---|
| ![Room feed and leaderboard](https://raw.githubusercontent.com/Spydiecy/Streakr/main/docs/screenshots/04-room-feed.png) | ![Room list](https://raw.githubusercontent.com/Spydiecy/Streakr/main/docs/screenshots/02-rooms.png) |
| Every call in the room, pending ones live, with the per-room leaderboard directly beneath — and a note confirming this room's results post to its own Telegram group | Public rooms with live market chips. A visitor is funded and placing a real on-chain call in under a minute |

---

## Why rooms are the whole product

Polymarket has liquidity. Perp DEXes have leverage. Neither has *the group chat* —
and the group chat is the thing that makes someone come back tomorrow.

```
        A prediction market                 Streakr
  ┌────────────────────────────┐   ┌────────────────────────────────┐
  │  you   vs  the market      │   │  you  vs  your friends         │
  │                            │   │                                │
  │  · an order book           │   │  · a room, a feed, a board     │
  │  · a P&L number            │   │  · a streak you can lose       │
  │  · you close the tab       │   │  · results in your group chat  │
  └────────────────────────────┘   └────────────────────────────────┘
            solitary                        something to defend
```

A streak is a genuinely nasty little psychological hook, and it costs nothing to
implement: it's just a counter that a loss sets to zero. But once you're on 4, a
$5 call stops being about $5.

The Event Contract underneath is what makes it *honest*. Nobody has to trust us
about who won, because we never decide. The chain does.

---

## How a call works

```
 1  USER      taps BTC ▲ UP, stake 5 tUSDC
 2  APP       sheet opens OVER the room — payout, max loss, capped-risk line,
              so the countdown and the book stay visible while deciding
 3  WALLET    signs an IOC order       ──►  DREAMDEX EVENT CONTRACT   (real tx)
 4  CHAIN     returns txHash + positionId
 5  APP       writes the call as `pending`, shows a live result screen

    ┌────────────────── every 60s, AWS EventBridge ───────────────────┐
 6  │ POLLER   getMarketOnchain(positionId)                            │
 7  │ CHAIN    Trading → Locked → Resolved | Voided                    │
    └──────────────────────────────────────────────────────────────────┘

 8  POLLER    reads `winningOutcome` from the RESOLVED market
              (Streakr never decides who won)
 9  POLLER    one atomic write: status · streak · XP · badges · leaderboards
10  POLLER    posts the result to the room's own Telegram group, with the tx link
11  APP       live listener fires — the result screen updates itself

    ═════════ the payout is RECORDED here, not yet PAID ═════════

12  USER      taps Claim
13  WALLET    signs redeem(winning leg)  ──►  EVENT CONTRACT
14  CHAIN     burns the outcome tokens, transfers the collateral
```

### The bit that nearly broke our trust in our own app

Step 12 exists because of something we learned the hard way, and it's a real
property of Event Contracts rather than a quirk of our code.

**A resolved market does not pay out on its own.** The winning position doesn't
decay into collateral — it sits in your wallet as outcome tokens until somebody
burns them for the collateral behind them.

So every step above can be correct, the group chat can say *"won 14.58 tUSDC"*, and
the balance still hasn't moved. Which looks exactly like the app eating your money.
We spent a while convinced we had a settlement bug:

```
won BTC down 15m
  recorded payout    : 14.577 tUSDC
  winning tokens HELD: 14.577
  market resolved    : true, voided: false
```

Everything reconciled. Nothing was lost. Redemption was simply a step no surface in
the app performed — so we built it, as an explicit **Claim** action.

And it *cannot* live on the server. Redeeming spends from the user's wallet, and our
settlement poller holds only a database credential — no user key, and it should
never have one. The one action that actually moves money is the one part of
settlement that can't be automated away.

---

## Real, not simulated

Every figure here was read back off-chain or out of the database after the fact.

**A verified win, end to end**

| Field | Value |
|---|---|
| Call | BTC **UP**, 15m window |
| Staked | 5.00 tUSDC |
| Filled | **16.666 shares at 0.300** entry (a 27% implied chance) |
| Resolved | Up — the called direction |
| Payout | **16.666 tUSDC** → +11.666 profit |
| Written | streak 1, +20 XP, `first_call` badge, room + global leaderboard |
| Notified | posted to the room's Telegram with the tx link |

**A verified claim, on the fastest window**

```
BTC up 5m  →  WON, payout 8.156 tUSDC
claim signed → collateral 140.408414 → 148.564414 tUSDC   (+8.156, exact)
```

That payout is the whole reason we track share count. A winning outcome token
redeems for ~1 collateral, so `5.00 / 0.300 = 16.67`. An earlier version computed
the payout from the *stake* instead and reported **5.00** on that same call — making
every win in the app look like break-even. Units that are indistinguishable at the
type level produce wrong answers that look completely plausible.

Losses are shown just as plainly. The streak resets to zero and the loss is exactly
the stake. That cap is the entire reason this works as a casual game.

---

## Architecture

Three independently deployable pieces, one shared source of truth, and exactly one
source of real money movement — the chain.

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT — one Expo build, three surfaces                             │
│  web · native · Telegram Mini App (the same deployed URL)            │
│  React Native UI  ⇄  RainbowKit/wagmi · funded demo wallet           │
└─────┬──────────────────────┬─────────────────────────┬───────────────┘
      │ markets, books,      │ sign a call             │ anonymous auth
      │ balances, price feed │ redeem a win            │ read/write docs
      ▼                      ▼                         ▼
┌────────────────────────────────────┐   ┌──────────────────────────────┐
│  SOMNIA SHANNON TESTNET            │   │  FIREBASE  (free tier)       │
│  @somnia-chain/markets-sdk         │   │  Anonymous Auth              │
│              ⇅                     │   │  Firestore — users, rooms,   │
│  DreamDEX Event Contracts          │   │  calls, leaderboards, cards  │
└────────────────────────────────────┘   └──────────────┬───────────────┘
                 ▲                                      ▲
                 │ read on-chain settlement             │ write status, streak,
                 │ (never the indexer)                  │ XP, badges, boards
┌────────────────┴──────────────────────────────────────┴──────────────┐
│  AWS LAMBDA — 6 functions                                            │
│  poll-pending-calls  ◄── EventBridge, every 60s                      │
│  faucet · sentiment · render-result-card · pre-lock-nudge            │
│  telegram-webhook    ◄── /link CODE binds a group chat to a room     │
└─────┬────────────────────────────────┬───────────────────────────────┘
      │ phrase the momentum signal     │ post the outcome
      ▼                                ▼
 Mistral ministral-8b            Telegram group chat (per room)
```

**The trust boundary is enforced in database rules, not app code.** A client can
create *its own* call, only as `pending`, and only with a real `txHash` and
`positionId` already attached. A client can **never** write status, payout, streak,
XP, badges, or any leaderboard entry — those are written exclusively by the
settlement Lambda through the Admin SDK, which bypasses rules entirely.

That matters more than it sounds. The whole premise of Streakr is that outcomes come
from the chain rather than from a client claiming a win — so we made it structurally
impossible for a client to claim one, instead of merely not offering a button.

---

## Tech stack

### Chain & markets

| Component | Role |
|---|---|
| `@dreamdex-bot-kit/ec-core` | the **Event Contracts** package specifically — not the spot/perp CLOB path the top-level quickstart points at |
| `@somnia-chain/markets-sdk` **0.29** | market registry, order books, order placement, settlement reads |
| `viem` **2.56** | chain client, raw transaction decoding, custom fee overrides |
| Somnia Shannon testnet | chain id **50312**, ~6 gwei base fee, 15-billion block gas limit |
| Venue | `0x679795a0…35e8a28c` — binary BTC/ETH Up/Down markets |
| SDK surface used | `listBinaryMarkets` · `getMarketOnchain` · `getBinaryOrderBook` · `estPayoutFor` · `placeBinaryOrder` · `trader.redeem` · `getOutcomeBalance` · `fetchPriceOHLCV` |
| Token standards | ERC-20 collateral (tUSDC, 6dp) + ERC-1155-style outcome tokens per leg |

### Client

| Layer | What it does |
|---|---|
| Expo **SDK 57** · React Native **0.86** · React **19.2** | one codebase, three targets |
| TypeScript, strict | `tsc --noEmit` clean on every commit |
| `react-native-web` **0.21** | the primary demo surface is the browser |
| React Navigation **7** (native-stack) | typed routes, explicit stack resets |
| `react-native-reanimated` **4.5** + `react-native-worklets` | 60fps countdown ring, press physics |
| `react-native-svg` **15** | the price sparkline, drawn from oracle candles |
| `expo-blur` · `expo-linear-gradient` · `expo-haptics` · `expo-clipboard` | the call sheet blurs over the live room rather than navigating away |
| `@expo/vector-icons` (Ionicons) | one closed icon vocabulary, no emoji filler |
| **3 platform splits** (`.web.ts` resolution) | `WalletProvider`, `firebase`, `keyStore` — each because the shared dependency genuinely has no browser implementation |
| **Leaf-module architecture** | `quote.ts`, `callOutcome.ts`, `windows.ts`, `networkConfig.ts`, `telegramMiniApp.ts` are dependency-free so they're unit-testable — importing them via the SDK layer drags in Flow-typed react-native sources and breaks the test transform |

### Wallets & signing

| Piece | Why it's there |
|---|---|
| RainbowKit **2.2** + wagmi **2.19** | real wallets on web |
| `expo-secure-store` / `localStorage` | platform-split key storage for the demo wallet |
| Server-funded demo wallet | a browser-generated key holds 0 STT, and STT *is* gas — so it can't send **any** transaction, including the faucet call that would fund it. That circle can only be broken server-side |
| Host detection | the same screen adapts to where it's running (below) |
| **Custom `Proxy` fee override** | wraps the wallet client's write methods to pin `gas` and `maxFeePerGas`. The SDK applies its own 60 gwei even on the walletClient path, and fees are chosen before the transport is reachable — so a Proxy is the last available hook. Confirmed by decoding the raw signed transaction |

**One screen, two hosts.** Detection requires a real `platform` or non-empty
`initData`, not merely the presence of `window.Telegram` — the Mini App script is
served on every page and defines that namespace in ordinary browsers too, so
checking for it alone would hide the wallet button from someone who *has* MetaMask:

| In a browser | In Telegram |
|---|---|
| ![Web onboarding](https://raw.githubusercontent.com/Spydiecy/Streakr/main/docs/screenshots/01-onboarding.png) | ![Telegram onboarding](https://raw.githubusercontent.com/Spydiecy/Streakr/main/docs/screenshots/06-telegram-miniapp.png) |
| **Connect Wallet** first, demo wallet as the alternative | demo wallet only, and the copy explains why — offering a connector that physically cannot work is a dead end the user can't recover from |

### Data & auth

| Component | Role |
|---|---|
| Firestore | live listeners drive the shared feed and both leaderboards for free |
| Firebase Anonymous Auth | a visitor is playing in seconds, no signup |
| **8 composite indexes** | one per real query shape, each annotated with its call site |
| **Security rules as the trust boundary** | client create-only, `pending` only, real `txHash`/`positionId` required, and no client write to any outcome field |

### Backend — 6 AWS Lambdas

| Function | Trigger | Job |
|---|---|---|
| `poll-pending-calls` | EventBridge `rate(1 minute)` | reads on-chain settlement, writes streak/XP/badges/boards, posts to Telegram |
| `faucet` | Function URL | grants a new wallet STT + tUSDC so it can transact at all |
| `sentiment` | Function URL | momentum signal, phrased by Mistral |
| `render-result-card` | Function URL | shareable SVG for a settled call |
| `pre-lock-nudge` | Function URL + shared secret | rooms closing soon |
| `telegram-webhook` | Function URL (from Telegram) | `/link CODE` binds a group chat to a room |

Built with `esbuild` into single-file bundles, `firebase-admin` for privileged
writes, `vitest` for the logic tests. **Lambda rather than Firebase Functions**
because Firestore and Auth are free on Spark while Cloud Functions requires the paid
Blaze plan even at zero usage.

### AI, notifications, images

| Piece | Detail |
|---|---|
| Mistral **`ministral-8b`** | one sentence of *wording* over a real computed signal, labelled "AI take, not advice", with a deterministic template fallback so a third-party outage can't break a room card |
| Telegram Bot API, direct from the poller | no hosting to keep awake, so notifications survive a closed laptop |
| Telegram webhook + secret-token verification | without it, anyone finding the Function URL could repoint a room's notifications at a chat they control |
| MarkdownV2 escaping, unit-tested | one unescaped `.` or `_` makes Telegram reject the **whole** send, and display names and badge keys are full of them |
| Telegram Mini App SDK | `ready()` / `expand()` / `openLink`, injected into the HTML shell at build time because it must define its global before the bundle's first line |
| Hand-built SVG result cards | canvas libraries ship OS/arch-specific native binaries — precisely what silently breaks when built on a Mac and run on Amazon Linux |

### Build & deploy

| Step | Why it exists |
|---|---|
| Vercel static export | one URL serves web *and* the Mini App |
| **3 build gates**, because each catches a production-only failure | asset relocation (icon fonts land under `node_modules/` and Vercel strips that path, so all 30 fonts 404 *only* in production) · env verification (Metro caches env inlining, shipping the *previous* values with no warning) · Telegram script injection |
| `set-env.mjs` for Lambda config | the raw AWS CLI replaces the whole environment, and round-tripping the service-account JSON converts its `\n` escapes to real newlines — killing the function at startup with an error pointing at the database layer instead of the deploy |

### Testing & tooling

| Suite | Covers |
|---|---|
| **81** app unit tests (`tsx`) | error mapping, call outcomes, quote/book maths, cadence labelling |
| **20** backend unit tests (`vitest`) | streak/XP/badge rules, Telegram escaping |
| **10** browser checks (`puppeteer-core`) | headless Chrome against the **real exported build, live chain, live database** |
| **27** chain scripts | gas and fee measurement, book inspection, cadence discovery, settlement watching, redemption |
| Ops tooling | a **preflight** that answers "can this still onboard anyone?", a treasury **sweep** to return test funds, an HTTP probe that names the URL behind a bare console `503` |
| Doc checks | fence/`<details>` structure, plus an assertion that no script is left undocumented |

---

## Built on DreamDEX Event Contracts

- **`packages/ec-core`**, not the spot/perp CLOB path. Event Contracts have their
  own package, their own preflight (`ec-doctor.ts`) and their own reference
  strategies. The top-level Bot Kit quickstart points at `Pool.load` / `topOfBook`,
  which is a different product entirely.
- **Windows are derived from live markets, never hard-coded.** The venue rotates
  which cadences it runs — at one point only 4h and 1d were live. A fixed list
  shows the user an empty screen through no fault of their own.
- **Settlement reads the authoritative on-chain `MarketStatus`**, never the
  seconds-lagging indexer. `judgeCall()` only ever reads `winningOutcome`.
- **Each leg is priced from its own asks.** Deriving DOWN as `1 − yesBid` moves the
  price the *wrong* way once slippage is added, so the order never crosses and
  returns unfilled — with no error at all, indistinguishable from an empty book.

Cadences the venue actually runs, measured with our own tooling:

```
cadence   seconds  live markets  assets
5m        300      4             ETH, BTC     ← most liquid, settles inside a demo
15m       900      2             BTC, ETH
1h        3600     2             ETH, BTC
4h        14400    2             BTC, ETH
1d        86400    2             ETH, BTC
```

---

## What we found building on Somnia

We shipped [**`FEEDBACK.md`**](https://github.com/Spydiecy/Streakr/blob/main/FEEDBACK.md)
— **17 findings**, every measurement reproducible from a script in the repo rather
than recalled from memory. Nearly all of them share one shape: *a condition the SDK
already knows about, reported through an error that points somewhere else entirely.*

### The one that blocks every end-user wallet

A node requires the sender to **hold** `gasLimit × maxFeePerGas` before it will even
*accept* a transaction — regardless of what the call actually burns. The SDK
defaults `gasLimit` to 10,000,000 and pins `maxFeePerGas` at 60 gwei, ten times the
base fee:

| Configuration | Must be held, per write |
|---|---|
| SDK defaults — 10,000,000 gas × 60 gwei | **0.6 STT** |
| Measured and pinned — 2,000,000 gas × 12 gwei | **0.024 STT** |

A **25× reduction**, and without it no ordinary wallet can place a call — a judge
connecting their own MetaMask would have failed exactly like our demo wallet did.
This was never a demo-wallet problem.

The error it surfaces as? `Missing or invalid parameters`. That's JSON-RPC `-32000`
and has nothing to do with parameters. We went hunting for malformed calldata for
hours.

Sizing was measured, not guessed: a plain ERC-20 `approve` on this chain estimates
at **1,389,617 gas** — Somnia's block limit is 15 billion, so its gas schedule is
simply not Ethereum's. And both directions of misconfiguration fail while mentioning
gas in neither: too high is rejected pre-submission, too low is mined and reverts
with no recoverable revert data.

### A few of the others

- **Cadence jitter silently drops live markets.** `intervalSec` is derived from
  `expiry − tradingStart` and trading opens a second or two late, so a 15m series is
  indexed as **899s** as often as 900. An exact match returns null, the market is
  dropped, and window chips appear and vanish at random.
- **`loadMarkets()` is slow *and* hides markets** — **18.06s vs 2.24s**, and its
  derived `active` flag concealed a live BTC 1h market that we then traded against
  successfully.
- **A reverted receipt resolves as success**, so a failed transaction is recorded as
  a placed order unless you check `status` yourself.
- **Outcome-token units are indistinguishable from collateral units** at the type
  level. Confusing them produces a wrong payout that looks entirely plausible — it
  bit us twice, in `estPayoutFor` and again in `redeem`.

---

## Features

| Feature | What it does |
|---|---|
| **Rooms** | Public or private, tied to a live BTC/ETH market. Creator-only delete, which tells you whether the room still holds calls before you confirm |
| **Shared feed** | Every call in the room, newest first, pending ones live |
| **Streaks, XP, badges** | First Call, 3/5/10-streak, Room Champion — all server-verified from the on-chain result |
| **Leaderboards** | Per-room and global, ranked by streak then XP, live via listeners |
| **Explained results** | *"Closed Up — won 16.67 tUSDC (+11.67 profit)"*, with the winning leg derived from the verdict and the amount valued from the on-chain share count |
| **Claim winnings** | The redemption step Event Contracts require, as a real button |
| **Price chart** | A sparkline sized to the window, from the same oracle feed the AI line reads — so the chart and the AI take can't contradict each other |
| **AI momentum read** | One plain sentence from Mistral `ministral-8b`, labelled *"AI take, not advice"* |
| **Telegram** | Every settlement posts to the room's **own** group — linked with `/link CODE` — carrying the streak and the tx link |
| **Telegram Mini App** | The same URL runs inside Telegram, so a result in the chat is one tap from the next call |
| **Result Cards** | A shareable SVG generated the moment a call settles |
| **Zero-setup onboarding** | A new wallet is granted testnet gas + collateral server-side, so a visitor places a real on-chain call in under a minute |

---

## Honest status

**Live and verified:** rooms, real signed calls on 5m/15m/1h/4h/1d, on-chain
settlement, streaks/XP/badges, both leaderboards, claim/redeem, per-room Telegram
notifications, the AI momentum line, Result Cards, the funded-wallet onboarding, and
the Telegram Mini App.

**Built but not hosted:** the pre-lock nudge ("your window locks in 2 minutes").
Both n8n workflows are exported in the repo and import cleanly, but the nudge needs
n8n reachable on a schedule, and `n8n start --tunnel` was removed in n8n 2.x. A
notification that only works while a laptop is awake isn't a working feature, so we
moved settlement notifications into the always-on Lambda and left the nudge as the
one piece that still needs a host. Settlement is unaffected.

Testnet funds only. Not financial advice.
