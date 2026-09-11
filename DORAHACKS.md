# Streakr

**Call BTC or ETH. Up or Down. Build a streak with your friends — every call a real
on-chain trade on DreamDEX Event Contracts.**

Live app · [streakr-opal.vercel.app](https://streakr-opal.vercel.app)
Code · [github.com/Spydiecy/Streakr](https://github.com/Spydiecy/Streakr)
Chain · Somnia Shannon testnet
Also runs as a **Telegram Mini App** — same URL, no second deployment

---

## The 30-second version

Prediction markets are powerful and almost nobody uses them casually, because the
interface is an order book and the mental model is a trading desk. Streakr wraps
DreamDEX Event Contracts in something a group chat already understands:

> **Will BTC be up or down in 5 minutes? Pick a side. Stake $5. Loser buys coffee.**

You create a **room**, your friends join, and everyone's calls land in one shared
feed with a live leaderboard. Get it right and your streak goes up. Get it wrong
and it resets to zero — and you lose exactly your stake, never more. No margin, no
liquidation, no funding rate.

Every single call is a **wallet-signed transaction on a real order book.** Nothing
is simulated anywhere in this project.

---

## Why rooms are the whole idea

Polymarket has liquidity. Perp DEXes have leverage. Neither has *the group chat* —
and that's the thing that actually makes people come back tomorrow.

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

The competitive loop is the product. The Event Contract underneath is what makes
it honest — nobody has to trust us about who won, because the chain decided.

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

**Step 12 is the part that surprised us**, and it's worth calling out because it's
a real property of Event Contracts rather than a quirk of our app. A resolved
market **does not pay out on its own.** The winning position doesn't decay into
collateral — it sits in your wallet as outcome tokens until they're burned for the
collateral behind them.

So everything above can be correct, the feed can say *"won 14.58 tUSDC"*, and the
balance still hasn't moved. Which looks exactly like the app losing your money.
We hit this ourselves:

```
won BTC down 15m
  recorded payout    : 14.577 tUSDC
  winning tokens HELD: 14.577
  market resolved    : true, voided: false
```

Nothing was lost and nothing was wrong — redemption was simply a step no surface in
the app performed. So we built it, as an explicit **Claim** action. It can't live on
the server: redeeming spends from the user's wallet, and our settlement poller
holds only a database credential. The one action that actually moves money is the
one part of settlement that can't be automated away.

---

## Real, not simulated

Every figure below was read back off-chain or out of the database after the fact.

**A verified win, end to end:**

| | |
|---|---|
| Call | BTC **UP**, 15m window |
| Staked | 5.00 tUSDC |
| Filled | **16.666 shares at 0.300** entry (a 27% implied chance) |
| Resolved | Up — the called direction |
| Payout | **16.666 tUSDC** → +11.666 profit |
| Written | streak 1, +20 XP, `first_call` badge, room + global leaderboard |
| Notified | posted to the room's Telegram with the tx link |

**A verified claim, on the fastest window:**

```
BTC up 5m  →  WON, payout 8.156 tUSDC
claim signed → collateral 140.408414 → 148.564414 tUSDC   (+8.156, exact)
```

That payout figure is the whole point of tracking share count: a winning outcome
token redeems for ~1 collateral, so `5.00 / 0.300 = 16.67`. An earlier version
computed payout from the stake instead and reported **5.00** on that same call,
making every win look like break-even.

Losses are shown just as plainly. The streak resets to zero and the loss is exactly
the stake — that cap is the reason this works as a casual game.

---

## Built on DreamDEX Event Contracts

- **`packages/ec-core`**, not the spot/perp CLOB path. Event Contracts have their
  own package, their own preflight (`ec-doctor.ts`) and their own reference
  strategies. The top-level Bot Kit quickstart points at `Pool.load` / `topOfBook`,
  which is a different product.
- **Venue** `0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c`
- **Windows are derived from live markets, never hard-coded.** The venue rotates
  which cadences it runs — at one point only 4h and 1d were live. A fixed list
  shows the user an empty screen through no fault of their own.
- **Settlement reads the authoritative on-chain `MarketStatus`**, never the
  seconds-lagging indexer. `judgeCall()` only ever reads `winningOutcome`.
- **Each leg is priced from its own asks.** Deriving DOWN as `1 − yesBid` moves the
  price the *wrong* way once slippage is added, so the order never crosses and
  returns unfilled with no error at all.

Cadences the venue actually runs, measured with our own tooling:

```
cadence   seconds  live markets  assets
5m        300      4             ETH, BTC     ← most liquid, settles in a demo
15m       900      2             BTC, ETH
1h        3600     2             ETH, BTC
4h        14400    2             BTC, ETH
1d        86400    2             ETH, BTC
```

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

**Why Lambda and not Firebase Functions:** Firestore and Auth are free on Spark;
Cloud Functions requires the paid Blaze plan even at zero usage. So all backend
logic runs on Lambda against the same Firestore. Result Cards are hand-built SVG
rather than canvas — canvas libraries ship prebuilt native binaries keyed to an
OS/arch, which is exactly what silently breaks when built on a Mac and run on
Amazon Linux.

**The trust boundary is enforced in database rules, not in app code.** A client can
create *its own* call, only as `pending`, and only with a real `txHash` and
`positionId` already attached. A client can **never** write status, payout, streak,
XP, badges, or any leaderboard entry — those are written exclusively by the
settlement Lambda through the Admin SDK. The whole point of Streakr is that
outcomes come from the chain, not from a client claiming a win.

---

## Features

| | |
|---|---|
| **Rooms** | Public or private, tied to a live BTC/ETH market. Creator-only delete, which tells you whether the room still holds calls before you confirm |
| **Shared feed** | Every call in the room, newest first, pending ones live |
| **Streaks, XP, badges** | First Call, 3/5/10-streak, Room Champion — all server-verified from the on-chain result |
| **Leaderboards** | Per-room and global, ranked by streak then XP, live via listeners |
| **Explained results** | *"Closed Up — won 16.67 tUSDC (+11.67 profit)"*, with the winning leg derived from the verdict and the amount valued from the on-chain share count |
| **Claim winnings** | The redemption step Event Contracts require, as a real button |
| **Price chart** | A sparkline sized to the window, from the same oracle feed the AI line reads — so the chart and the AI take can't contradict each other |
| **AI momentum read** | One plain sentence from Mistral `ministral-8b`, labelled *"AI take, not advice"*. The signal is real window outcomes; the model only does wording, and falls back to a deterministic template on any failure so a third party can't break the room card |
| **Telegram** | Every settlement posts to the room's **own** group — linked with `/link CODE` — carrying the streak and the tx link, so results are verifiable rather than asserted |
| **Telegram Mini App** | The same URL runs inside Telegram, so a result in the chat is one tap from the next call |
| **Result Cards** | A shareable SVG generated the moment a call settles |
| **Zero-setup onboarding** | A new wallet is granted testnet gas + collateral server-side, so a visitor places a real on-chain call in under a minute |

---

## What we found building on Somnia

We shipped [**`FEEDBACK.md`**](https://github.com/Spydiecy/Streakr/blob/main/FEEDBACK.md)
— **17 findings**, every measurement reproducible from a script in the repo rather
than recalled from memory. The issues that cost the most time were all one shape:
*a condition the SDK knows about, reported through an error that points somewhere
else.*

**The headline one, because it blocks every end-user wallet.** A node requires the
sender to *hold* `gasLimit × maxFeePerGas` before it will even accept a
transaction, regardless of what the call actually burns. The SDK defaults
`gasLimit` to 10,000,000 and pins `maxFeePerGas` at 60 gwei:

| | Required to be held, per write |
|---|---|
| SDK defaults (10,000,000 × 60 gwei) | **0.6 STT** |
| Measured and pinned (2,000,000 × 12 gwei) | **0.024 STT** |

A **25× reduction** — and without it no ordinary wallet could place a call. A judge
connecting their own MetaMask would have failed exactly like our demo wallet did.
The error? `Missing or invalid parameters` — which is JSON-RPC `-32000` and has
nothing to do with parameters. We went looking for malformed calldata for hours.

Sizing was measured, not guessed: a plain ERC-20 `approve` on this chain estimates
at **1,389,617 gas** (Somnia's block limit is 15 billion — its gas schedule is not
Ethereum's). Both directions of misconfiguration fail, and neither mentions gas:
too high is rejected pre-submission, too low is mined and reverts.

**Others include:** cadence jitter silently dropping live markets (a 15m series is
indexed as 899s as often as 900s, so an exact match returns null and the market
vanishes); `loadMarkets()` being both slow *and* hiding a live market
(**18.06s vs 2.24s**, and its derived `active` flag concealed a BTC 1h market we
then traded successfully); a reverted receipt resolving as success; and outcome-token
units being indistinguishable from collateral units, which produces a wrong payout
that looks entirely plausible.

---

## Engineering

| | |
|---|---|
| **81** app unit tests | error mapping, call outcomes, quote/book maths, cadence labelling |
| **20** backend unit tests | streak/XP/badge rules, Telegram MarkdownV2 escaping |
| **10** browser checks | headless Chrome against the **real exported build, live chain and live database** — no mocks |
| **8** Firestore indexes | one per real query shape |
| **27** chain scripts | measurement and diagnostics, so every number in our docs is reproducible |

The browser checks exist because most of this app's real failures only appear in a
browser against live data: a react-native-web layout collapsing to `height: 0` with
no console error, fonts 404ing *only* in production, a lost race between market
reads. They drive real signed transactions and assert on real settlement.

There's also a preflight, because a dry faucet treasury silently breaks onboarding
for everyone while the UI looks perfectly healthy:

```
$ node e2e/tools/preflight.mjs
treasury  2.21 STT   60713.14 tUSDC
can onboard ~27 new wallet(s)
>>> ready to demo
```

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
one thing that still needs a host. Settlement is unaffected.

Testnet funds only. Not financial advice.
