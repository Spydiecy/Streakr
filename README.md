<div align="center">

# 🔥 Streakr

**A social, gamified prediction game built on DreamDEX Event Contracts (Somnia L1)**

Call BTC or ETH. Up or Down. Real wallet-signed calls, settled automatically from real on-chain outcomes.
No liquidation. No margin. Loss capped at your stake.

[![Live Demo](https://img.shields.io/badge/demo-streakr--opal.vercel.app-7c5cff?style=for-the-badge)](https://streakr-opal.vercel.app)
[![Network](https://img.shields.io/badge/network-Somnia%20Shannon%20Testnet-22d3ee?style=for-the-badge)](https://docs.dreamdex.io)

</div>

---

Every on-chain call in this repo's history is real — signed and submitted on
Shannon testnet, settled from real on-chain outcomes. No simulated trades,
no mocked settlements, anywhere in this codebase.

## Contents

- [What it is](#what-it-is)
- [Architecture](#architecture)
- [Call lifecycle](#call-lifecycle)
- [Data model](#data-model)
- [Repo layout](#repo-layout)
- [Key design decisions](#key-design-decisions)
- [Setup](#setup)
- [Testing a full call cycle](#testing-a-full-call-cycle)
- [Verified on-chain](#verified-on-chain)
- [Demo walkthrough](DEMO.md) → shot-by-shot script, plus what to check first
- [DreamDEX SDK feedback](#dreamdex-sdk--docs-feedback) → full write-up in [`FEEDBACK.md`](FEEDBACK.md)
- [Deliverables checklist](#deliverables-checklist)

---

## What it is

DreamDEX Event Contracts let anyone pick BTC or ETH, choose a window, and call
**Up** or **Down**. Right, and the position redeems at a fixed payout. Wrong, and
you lose exactly your stake — nothing more, no margin call, no liquidation.

Streakr offers whichever of 5m / 15m / 1h / 4h / 1d the venue is actually running,
read from live markets rather than hard-coded, because the venue rotates its
cadences and a fixed list shows the user an empty screen through no fault of
their own.

Streakr wraps that primitive in a social layer:

| Feature | What it does |
|---|---|
| 🏠 **Rooms** | Create or join a room (public or private), tied to a live BTC/ETH market. Creator-only delete, which tells you whether the room still holds calls before you confirm |
| 💬 **Room feed** | Every call made in the room, newest first, with pending ones shown live — the shared surface that makes a room feel like a group rather than a scoreboard |
| ✍️ **Real calls** | Every Up/Down is a wallet-signed transaction on the actual DreamDEX order book — never simulated. Collateral is checked *before* signing, so an empty wallet is caught without spending gas |
| 🔥 **Streaks** | Consecutive correct calls build a streak; one loss resets it to zero |
| ⭐ **XP & badges** | First Call, 3/5/10-streak, and Room Champion badges, all server-verified |
| 🏆 **Leaderboards** | Per-room and global, ranked by streak then XP, live via Firestore listeners |
| 🧾 **Explained results** | Each settled call says what actually happened — "Closed Up — won 16.67 tUSDC (+11.67 profit)" — with the resolved leg derived from the verdict and the amount valued from the on-chain share count |
| 📈 **Price chart** | A sparkline of recent closes for the asset being called, sized to the window (minute candles over 30m for a 5m call, hourly over 2d for a 1d call), from the same oracle feed the momentum line reads — so the chart and the AI take can't contradict each other |
| 🔔 **Telegram** | Every settlement posts to the room's own group chat — linked with `/link CODE` — carrying the streak and a link to the transaction, so a result is verifiable rather than asserted |
| 💰 **Claim winnings** | A resolved Event Contract doesn't pay out on its own — winning outcome tokens sit in the wallet until they're burned for the collateral behind them. Won calls carry a **Claim** action that redeems the position and moves the tUSDC into the wallet for real |
| 🖼️ **Result Cards** | A shareable SVG generated the moment a call settles — the viral loop |
| 📜 **Lists that stay put** | Room calls, room leaderboard and call history each stop growing and scroll inside themselves, so a busy room can't push the sections below it off the page. Capped by `maxHeight`, so a two-call room still renders two rows |
| 🤖 **Momentum read** | One plain sentence phrased by Mistral `ministral-8b` from real recent window outcomes, labelled "AI take, not advice". The signal is the substance; the model only does wording, and falls back to a deterministic template on any failure so a third party can't break the room card |
| 🚰 **Zero-setup onboarding** | A new wallet is granted testnet gas + collateral server-side, so a visitor can place a real call in under a minute |
| 📲 **Telegram Mini App** | The **same deployed URL** also runs inside Telegram, so a result posted in the group is one tap from placing the next call. The app detects the WebView and leads with the funded demo wallet, because no browser extension can exist there |

## Architecture

Three independent deployables, one shared source of truth (Firestore), and
one source of real money movement (the Somnia chain itself):

```text
┌───────────────────────────────────────────────────────────────────────────┐
│  CLIENT — one Expo build, three surfaces                                  │
│  web · native · Telegram Mini App (the same deployed URL)                 │
│                                                                           │
│  React Native UI  ⇄  Wallet layer (RainbowKit/wagmi · demo wallet)        │
└──────┬────────────────────────┬───────────────────────────┬───────────────┘
       │ read markets, books,   │ sign a call               │ anonymous auth
       │ balances, price feed   │ redeem a won position     │ read/write docs
       ▼                        ▼                           ▼
┌──────────────────────────────────────────┐   ┌──────────────────────────────┐
│  SOMNIA SHANNON TESTNET                  │   │  FIREBASE  (Spark/free)      │
│                                          │   │                              │
│  @somnia-chain/markets-sdk               │   │  Anonymous Auth              │
│                ⇅                         │   │  Firestore                   │
│  DreamDEX Event Contracts                │   │    users · rooms · calls     │
│  (binary Up/Down markets)                │   │    leaderboard · resultCards │
└──────────────────────────────────────────┘   └──────────────┬───────────────┘
                    ▲                                         ▲
                    │ read on-chain settlement                │ write status,
                    │ status (never the indexer)               │ streak, XP,
                    │                                          │ badges, boards
┌───────────────────┴──────────────────────────────────────────┴────────────┐
│  AWS LAMBDA — 6 functions  (not Cloud Functions: Firestore is free on     │
│                             Spark, Cloud Functions needs paid Blaze)      │
│                                                                           │
│  poll-pending-calls   ◄── EventBridge, rate(1 minute)                     │
│  faucet · sentiment · render-result-card · pre-lock-nudge                 │
│  telegram-webhook     ◄── /link CODE binds a group chat to a room         │
└──────┬─────────────────────────────────┬──────────────────────────────────┘
       │ phrase the momentum signal      │ post the outcome
       ▼                                 ▼
  Mistral ministral-8b            Telegram group chat
                                  (per room, via /link)
```

<details>
<summary>Same diagram as Mermaid</summary>

```mermaid
flowchart TB
    subgraph Client["📱 Client — Expo App (web + native)"]
        UI[React Native UI]
        Wallet["Wallet layer<br/>RainbowKit/wagmi on web<br/>· demo wallet fallback"]
        UI <--> Wallet
    end

    subgraph Chain["⛓️ Somnia Shannon Testnet"]
        SDK["@somnia-chain/markets-sdk"]
        EC["DreamDEX Event Contracts<br/>(binary Up/Down markets)"]
        SDK <--> EC
    end

    subgraph GCP["🔥 Firebase (Spark / free plan)"]
        Auth[Anonymous Auth]
        FS[(Firestore<br/>users · rooms · calls · leaderboard)]
    end

    subgraph AWS["☁️ AWS Lambda (6 functions)"]
        Poll["streakr-poll-pending-calls<br/>(EventBridge, every 1 min)"]
        Faucet["streakr-faucet<br/>(Function URL, POST)"]
        Sentiment["streakr-sentiment<br/>(Function URL)"]
        Card["streakr-render-result-card<br/>(Function URL)"]
        Nudge["streakr-pre-lock-nudge<br/>(Function URL)"]
        TgHook["streakr-telegram-webhook<br/>(Function URL)"]
    end

    Mistral(("Mistral<br/>ministral-8b"))

    subgraph N8N["🔔 n8n (optional second path)"]
        Notify[Settlement Notify Workflow]
        NudgeFlow[Pre-Lock Nudge Workflow]
    end

    Telegram(("Telegram"))

    Wallet -- "sign & submit call" --> SDK
    Wallet -- "redeem a won position" --> SDK
    UI -- "read live markets/books" --> SDK
    UI -- "read price history (chart)" --> SDK
    UI -- "read tUSDC balance" --> SDK
    UI <--> Auth
    UI <--> FS
    UI -- "POST address" --> Faucet
    UI -- "GET ?asset=BTC" --> Sentiment
    UI -- "GET ?cardId=..." --> Card
    Faucet -- "send STT + tUSDC" --> SDK
    Faucet -- "record grant" --> FS
    Sentiment -- "read BTC/ETH price feed" --> SDK
    Sentiment -- "phrase the signal" --> Mistral
    Card --> FS
    Poll -- "read settlement status" --> SDK
    Poll -- "write streak/XP/badges/leaderboard" --> FS
    Poll -- "post outcome" --> Telegram
    Telegram -- "/link CODE" --> TgHook
    TgHook -- "bind chat to room" --> FS
    Poll -. "POST outcome (optional)" .-> Notify
    Notify -.-> Telegram
    NudgeFlow -- "GET rooms closing soon" --> Nudge
    Nudge --> FS
    NudgeFlow --> Telegram

    style Client fill:#171c26,stroke:#7c5cff,color:#f8fafc
    style Chain fill:#171c26,stroke:#22d3ee,color:#f8fafc
    style GCP fill:#171c26,stroke:#ffc857,color:#f8fafc
    style AWS fill:#171c26,stroke:#2fd47a,color:#f8fafc
    style N8N fill:#171c26,stroke:#ff5470,color:#f8fafc
```

</details>

Solid edges are live. The one dotted edge is the poller → n8n webhook, which needs
n8n reachable at a public URL; the poller posts to Telegram directly regardless,
so notifications don't depend on it. See
[step 5](#5--telegram-notifications).

**Why AWS Lambda instead of Firebase Cloud Functions:** Firestore and
Firebase Auth stay on Firebase's free Spark plan. Cloud Functions requires
the paid Blaze plan even at free-tier-sized usage, so all backend *logic*
(settlement polling, sentiment, Result Card rendering, pre-lock nudges) runs
on AWS Lambda instead, talking to the same Firestore database via
`firebase-admin` with a service-account credential. See
[`backend/lambda/DEPLOY.md`](backend/lambda/DEPLOY.md) for the full deploy
walkthrough.

## Call lifecycle

What actually happens between a tap and a settled streak:

```text
 1  USER       taps BTC ▲ UP, stake 5 tUSDC
 2  APP        sheet opens OVER the room — payout, loss, capped-risk line,
               so the countdown and the book stay visible while deciding
 3  USER       Sign & place call
 4  WALLET     signs an IOC order              ──►  EVENT CONTRACT   (real tx)
 5  CHAIN      returns txHash + positionId (the marketId)
 6  APP        writes calls/{id}, status=pending  ──►  FIRESTORE
 7  APP        Result screen opens, live listener attached

    ┌─────────────────────── every 60 s, EventBridge ────────────────────────┐
 8  │ POLLER   getMarketOnchain(positionId)     ──►  EVENT CONTRACT           │
 9  │ CHAIN    Trading → Locked → Resolved | Voided                           │
    └────────────────────────────────────────────────────────────────────────┘
                                   │
                   window closes, market resolves on-chain
                                   ▼
10  POLLER     reads winningOutcome from the resolved market
               (Streakr never decides who won)
11  POLLER     ONE Firestore transaction:
                 · call status  won | lost | void
                 · user streak, XP, badges
                 · room + global leaderboard
12  POLLER     writes resultCards/{id}          (shareable SVG)
13  POLLER     posts the outcome to the room's Telegram chat, with the tx link
14  FIRESTORE  live listener fires  ──►  Result screen updates itself
15  USER       sees WON · streak +1 · +20 XP

    ══════════════ the payout is RECORDED here, not yet PAID ══════════════
      A resolved Event Contract does not pay out on its own. The winning
      position does not decay into collateral — it sits in the wallet as
      outcome tokens. The feed can say "won 14.58" while the balance has
      not moved. Redemption is what moves money, and it needs the user's
      key, so the poller structurally cannot do it.

16  USER       taps Claim on the won call        (Profile → Call history)
17  WALLET     signs redeem(winning leg balance) ──►  EVENT CONTRACT
18  CHAIN      burns the outcome tokens, transfers the collateral
19  WALLET     balance finally moves
```

<details>
<summary>Same diagram as Mermaid</summary>

```mermaid
sequenceDiagram
    actor U as User
    participant App as Expo App
    participant W as Embedded Wallet
    participant EC as DreamDEX Event Contract
    participant FS as Firestore
    participant L as Lambda Poller
    participant N8N as n8n

    U->>App: Tap BTC ▲ UP, stake $5
    App->>App: Show stake / potential payout /<br/>capped-risk confirmation
    U->>App: Sign & Submit
    App->>W: Request signature
    W->>EC: Signed IOC order (real tx)
    EC-->>App: txHash + positionId (marketId)
    App->>FS: Create calls/{id} as pending
    App->>U: Show Result screen (live listener attached)

    loop every 60s until resolved
        L->>EC: getMarketOnchain(positionId)
        EC-->>L: status: Trading / Locked / Resolved / Voided
    end

    Note over L,EC: Window closes → market resolves on-chain

    L->>EC: read winningOutcome
    L->>FS: Transaction:<br/>update call status (won/lost/void)<br/>update user streak/XP/badges<br/>refresh room + global leaderboard
    L->>FS: Write resultCards/{id}
    L->>N8N: POST settlement payload
    N8N->>N8N: Post message to Room Telegram chat

    FS-->>App: Live listener fires — Result screen updates instantly
    App->>U: 🎉 Streak +1, +20 XP, Share Result Card

    Note over U,EC: The payout is RECORDED, not yet PAID

    U->>App: Tap Claim on the won call (Profile)
    App->>W: Request signature
    W->>EC: redeem(winning leg balance)
    EC-->>W: collateral transferred — balance finally moves
```

</details>

The key property: **Streakr never decides who won.** `judgeCall()` only
reads `onchain.winningOutcome` from the real settled market — the same
authoritative status every other DreamDEX client reads, never the lagging
indexer.

The second property, and the one that surprised us: **settling and getting paid
are different events.** A resolved Event Contract does not pay out on its own —
the winning position doesn't decay into collateral, it sits in the wallet as
outcome tokens until they're burned for the collateral behind them. So everything
above can be correct, the feed can say "won 14.58 tUSDC", and the wallet balance
still won't have moved. Redemption is the step that moves money, and it's the last
four lines of the diagram rather than something the poller can do — see
[the claim decision](#key-design-decisions).

## Data model

```text
  users                      rooms                      calls
  ─────────────────────      ─────────────────────      ────────────────────────
  uid                 PK     roomId              PK     callId              PK
  walletAddress              name                       roomId              FK
  displayName                isPublic                   uid                 FK
  xp                         memberUids[]               symbol   BTC | ETH
  currentStreak              createdBy                  direction   up | down
  bestStreak                 activeMarket{}             window  5m|15m|1h|4h|1d
  badges[]                                              stakeUsdso
                                                        txHash
                                                        positionId
                                                        status
                                                          pending|won|lost|void
                                                        payout

  leaderboard/{scope}/entries          resultCards
  ─────────────────────────────        ─────────────────────
  uid                       PK         cardId            PK
  displayName                          callId            FK
  currentStreak
  xp

  RELATIONSHIPS
    users        1 ──< many  calls          a user makes calls
    rooms        1 ──< many  calls          a room holds calls
    users        1 ──< many  entries        a user ranks in leaderboards
    rooms        1 ──< many  entries        a room has its own board
    calls        1 ──  1     resultCards    a settled call generates a card

  WHO MAY WRITE WHAT  (backend/firestore.rules)
    client  ─ may CREATE its own call, status "pending" only, and only with a
              real txHash + positionId already attached
    client  ─ may NEVER write status, payout, streak, xp, badges or any
              leaderboard entry
    Lambda  ─ writes all of the above via the Admin SDK, which bypasses rules
              entirely. Outcomes come from the chain, not from a client
              claiming a win — that is the whole point of the product.
```

<details>
<summary>Same diagram as Mermaid</summary>

```mermaid
erDiagram
    users {
        string uid PK
        string walletAddress
        string displayName
        int xp
        int currentStreak
        int bestStreak
        array badges
    }
    rooms {
        string roomId PK
        string name
        bool isPublic
        array memberUids
        string createdBy
        object activeMarket
    }
    calls {
        string callId PK
        string roomId FK
        string uid FK
        string symbol
        string direction
        string window
        number stakeUsdso
        string txHash
        string positionId
        string status
        number payout
    }
    leaderboard {
        string scope PK
    }
    leaderboard_entries {
        string uid PK
        int currentStreak
        int xp
    }
    resultCards {
        string cardId PK
        string callId FK
    }

    users ||--o{ calls : "makes"
    rooms ||--o{ calls : "hosts"
    rooms ||--o{ leaderboard : "scopes"
    leaderboard ||--o{ leaderboard_entries : "ranks"
    calls ||--|| resultCards : "generates"
```

</details>

Firestore security rules ([`backend/firestore.rules`](backend/firestore.rules))
enforce the trust boundary directly: a client can create its **own** call,
only in `status: "pending"`, only with a real `txHash`/`positionId` already
attached — and can never write `status`, `payout`, streaks, XP, badges, or
leaderboard entries. Those are exclusively written by the Lambda settlement
poller via the Admin SDK, which bypasses rules entirely. The whole point of
Streakr is that outcomes come from the chain, not from a client claiming a win.

## Repo layout

```
Streakr/
├── chain-integration/    DreamDEX Bot Kit (cloned + extended)
│   └── scripts/          25 scripts; the ones referenced elsewhere in this README:
│       ├── ec-doctor.ts                    preflight: venue + wallet check
│       ├── place-event-contract-call.ts    real signed call submission
│       ├── watch-settlement.ts             poll on-chain status → WIN/LOSS/VOID
│       ├── fund-collateral.ts              testnet tUSDC faucet helper
│       ├── find-claimable.ts               unredeemed winning positions for a signer
│       ├── redeem-position.ts              redeem with an arbitrary key, PK=0x…
│       ├── measure-gas.ts / measure-fees.ts        the gas + fee measurements
│       ├── repro-approve-revert.ts         minimal repro of the approve revert
│       ├── profile-market-reads.ts         listBinaryMarkets vs loadMarkets timings
│       ├── check-cadence-labels.ts         catches 899s-indexed 15m series
│       ├── list-cadences.ts               live cadences WITHOUT the app's allowlist
│       ├── one-live-market.ts             soonest-expiring live market id
│       ├── check-demo-wallet-funding.ts    proves a browser wallet can't bootstrap
│       └── inspect-book.ts                 every resting level on both legs
│
├── backend/
│   ├── firestore.rules            security rules — client create-only
│   ├── firestore.indexes.json     8 composite indexes, one per real query shape
│   └── lambda/                    AWS Lambda handlers (NOT Cloud Functions)
│       ├── src/
│       │   ├── handlers/
│       │   │   ├── pollPendingCalls.ts   settlement sweep, every 1 min (EventBridge)
│       │   │   ├── faucet.ts             grants a new wallet gas + collateral
│       │   │   ├── sentiment.ts          momentum one-liner
│       │   │   ├── renderResultCard.ts   SVG share-card generator
│       │   │   ├── preLockNudge.ts       "2 min to lock" data for n8n
│       │   │   └── telegramWebhook.ts    /link CODE -> bind a group to a room
│       │   ├── gamification.ts      streak/XP/badge rules (10 unit tests)
│       │   ├── telegram.ts          message building + MarkdownV2 escaping (10 tests)
│       │   ├── resultCard.ts        hand-built SVG, no native deps
│       │   ├── chain.ts             on-chain settlement reads
│       │   ├── firebaseAdmin.ts     service-account Firestore client
│       │   └── n8n.ts               optional settlement webhook post
│       ├── scripts/
│       │   ├── set-env.mjs          safe Lambda env merge — use this, not raw CLI
│       │   ├── inspect-pending.mjs  why is a call still pending?
│       │   ├── inspect-nudge.mjs    why is the pre-lock nudge returning nothing?
│       │   ├── recent-calls.mjs     latest calls with status + payout
│       │   ├── verify-telegram-5m.mjs  build a real notification and send it
│       │   ├── purge-test-rooms.mjs delete rooms by name, plus their leaderboard
│       │   └── purge-probe-data.mjs remove all test-run leftovers (dry run first)
│       └── DEPLOY.md              AWS CLI deploy walkthrough, per function
│
├── app/                  Expo (React Native) — the actual product
│   ├── src/
│   │   ├── lib/           wallet, chain client, Firestore API, session, error mapping
│   │   │   ├── chain.ts             SDK clients + the gas ceiling / fee override
│   │   │   ├── eventContracts.ts    market discovery, books, placeCall, claim, faucet
│   │   │   ├── errors.ts            chain/SDK/Firestore errors -> human sentences
│   │   │   ├── quote.ts             leaf module: per-leg pricing + book quality
│   │   │   ├── windows.ts           leaf module: cadence -> window label (30 tests)
│   │   │   ├── telegramMiniApp.ts   leaf module: am I in Telegram's WebView?
│   │   │   ├── callOutcome.ts       leaf module: what a settled call actually did
│   │   │   ├── priceFeed.ts         oracle candles for the sparkline
│   │   │   ├── firestoreApi.ts      every Firestore read/write + live listeners
│   │   │   ├── SessionContext.tsx   anonymous auth + the user profile
│   │   │   ├── faucetApi.ts         client for the server-side funding grant
│   │   │   ├── networkConfig.ts     leaf module: network + collateral decimals
│   │   │   ├── firebase.ts / .web.ts    persistence differs per platform
│   │   │   ├── keyStore.ts / .web.ts    SecureStore vs localStorage
│   │   │   ├── WalletProvider.tsx   native: embedded wallet
│   │   │   └── WalletProvider.web.tsx  web: RainbowKit + demo fallback
│   │   ├── navigation/    RootNavigator + typed route params
│   │   ├── screens/       Onboarding, RoomList, Room, Result, Profile, Leaderboard
│   │   └── components/    CallSheet (confirm in place), ClaimRow (redeem a win),
│   │                      Countdown, PriceChart, ui/ScrollBox (capped lists)
│   │                      + design-system primitives
│   ├── e2e/               headless-Chrome checks against the real build + chain
│   │   └── tools/         preflight.mjs (can we still onboard?), bal.mjs, gas.mjs
│   │                      + sweep.mjs (treasury in/out), probe-window.mjs,
│   │                      probe-http.mjs, shot.mjs / shot-noname.mjs
│   └── scripts/           icon generation, build gates (asset relocation, env verify,
│                          Telegram Mini App script injection)
│
├── scripts/              repo-wide doc checks
│   ├── check-docs.mjs           fence + <details> structure (a bad fence eats the file)
│   └── check-docs-coverage.mjs  every script is mentioned somewhere
│
└── n8n-workflows/        Telegram settlement notify + pre-lock nudge (JSON exports)
```

### Platform splits

Metro resolves `.web.tsx` / `.web.ts` for the web target, so three modules exist
twice — each because the shared dependency genuinely has no browser
implementation:

| Module | Native | Web | Why |
|---|---|---|---|
| `WalletProvider` | embedded wallet | RainbowKit + wagmi | RainbowKit is browser-only (DOM modals, vanilla-extract CSS) |
| `firebase` | `getReactNativePersistence` | `browserLocalPersistence` | that export exists only in Firebase's react-native build |
| `keyStore` | `expo-secure-store` | `localStorage` | SecureStore has no web implementation at all |

## Key design decisions

<details>
<summary><strong>Event Contracts use <code>ec-core</code>, not the spot/perp CLOB path</strong></summary>

<br>

The original brief described using the Bot Kit's `Pool.load` /
`createChainContext` / `topOfBook()` pattern. That's the **spot/perp CLOB**
path, not Event Contracts. Event Contracts have their own dedicated package,
`packages/ec-core`, built on `@somnia-chain/markets-sdk`, with its own
preflight script (`scripts/ec-doctor.ts`) and reference strategies
(`ec-starter`, `ec-settlement`, etc.) — confirmed directly against
[docs.dreamdex.io/developers/event-contracts](https://docs.dreamdex.io/developers/event-contracts).
`chain-integration/` uses the correct EC-specific tooling throughout.

</details>

<details>
<summary><strong>Pinning the gas ceiling and fee — without this, no wallet can place a call</strong></summary>

<br>

The most consequential fix in the project, and it took a long time to find
because the error points somewhere else entirely.

A node requires the sender to hold `gasLimit × maxFeePerGas` before it will
*accept* a transaction, regardless of what the call actually burns. The SDK
defaults `gasLimit` to 10,000,000 and pins `maxFeePerGas` at 60 gwei — 10× the
6 gwei base fee — so **every write demanded 0.6 STT sitting idle**. That is far
more than a normal faucet grant, so a judge connecting their own MetaMask would
have failed exactly like our demo wallet did. This was never a demo-wallet
problem.

The fee is applied even when the trader is built with a viem `WalletClient` that
would otherwise estimate ~7.2 gwei itself, so changing transport achieves
nothing. Confirmed by decoding the raw signed transaction.

Both directions of misconfiguration fail, and neither mentions gas:

| Ceiling | Outcome | Reported as |
|---|---|---|
| too high | rejected pre-submission | `Missing or invalid parameters` — looks like bad calldata |
| too low | mined, reverted | `reverted (no revert data recoverable)` — looks like a contract bug |

Sizing is measured, not guessed: a plain ERC-20 `approve` on this chain estimates
at **1,389,617 gas** (Somnia's block limit is 15 billion, so its gas schedule is
not Ethereum's). A 400,000 ceiling burned all 400,000 and reverted.

`app/src/lib/chain.ts` therefore pins a 2,000,000 ceiling and overrides
`maxFeePerGas` to 12 gwei via a `Proxy` on the wallet client's write methods —
fees are chosen before the transport is reachable, so that's the last available
hook. Requirement per write drops from 0.6 STT to 0.024 STT, a 25× reduction.

Reproduce: `chain-integration/scripts/measure-gas.ts`, `measure-fees.ts`,
`repro-approve-revert.ts`.

</details>

<details>
<summary><strong>A server-side faucet, because a browser-made wallet can't bootstrap itself</strong></summary>

<br>

The demo wallet's key is generated in the browser, so it starts with 0 STT. STT
is the gas token, which means that wallet cannot send **any** transaction —
including the collateral token's own public `faucet()`, because that is itself a
transaction. It's a closed circle, and only something already holding gas can
break it.

Measured with `scripts/check-demo-wallet-funding.ts`:

```
fresh demo wallet   0 STT      0 tUSDC
project treasury    0.976 STT  9590 tUSDC
```

So funding moved server-side. `streakr-faucet` grants STT + tUSDC from the
treasury, with guards proportionate to spending real (testnet) funds: one grant
per address ever, a rolling 24h cap, a mainnet refusal, and a low-treasury
refusal so it fails loudly rather than half-funding an address. The grant record
is written *before* any transfer, so a racing duplicate loses on the create
instead of double-spending.

`faucetGrants` is closed to clients in `firestore.rules` — create access would let
an address lock itself out of funding, delete access would allow unbounded
re-requests.

</details>

<details>
<summary><strong>RainbowKit on web, embedded wallet as a labelled fallback</strong></summary>

<br>

RainbowKit is the primary path on web and the real answer for a consumer app.
But an external wallet a visitor brings holds no Shannon STT or tUSDC, and there
is no way to faucet *someone else's* wallet on their behalf — so a
RainbowKit-only build dead-ends at the first call. The demo wallet is auto-funded
(above), which keeps the full loop demonstrable, and it's labelled as such rather
than pretending to be the user's own wallet.

RainbowKit cannot run on native at all — browser DOM, vanilla-extract CSS, no
React Native support — so Metro's `.web` resolution keeps it out of the native
bundle entirely. The proper native equivalent is Reown AppKit for React Native,
noted as future work.

</details>

<details>
<summary><strong>AWS Lambda instead of Firebase Cloud Functions</strong></summary>

<br>

Firestore and Firebase Auth are both free on the Spark plan. Cloud Functions
requires the paid Blaze plan even at free-tier usage volumes, so all backend
logic was rebuilt as six plain Lambda handlers instead, talking to the same
Firestore via a service-account credential. The Result Card renderer uses
hand-built SVG rather than `@napi-rs/canvas` for the same reason canvas
libraries are a bad fit for a hand-uploaded Lambda zip: they ship
prebuilt native binaries keyed to a specific OS/architecture, which is
exactly the kind of thing that silently breaks when built on a Mac and run
on Amazon Linux. SVG has zero native dependencies and is still a real,
shareable image.

</details>

<details>
<summary><strong>Claiming has to happen client-side — the poller has no user key</strong></summary>

<br>

A resolved market doesn't pay out on its own, so something has to call `redeem`.
That something cannot be the settlement poller: redeeming spends from the user's
wallet, and the poller holds only a Firestore service-account credential. It has
no user private key and shouldn't ever have one. So the one action that actually
moves money is the one piece of the settlement path that can't be done on the
server.

That's why `claimCall()` lives in `app/src/lib/eventContracts.ts` alongside
`placeCall`, and why the claim surface is a per-row button in the profile's call
history (`app/src/components/ClaimRow.tsx`) rather than something automatic.

Three details worth stating, because each was a bug first:

- **`redeem`'s `amount` is in outcome tokens.** Not collateral, and not the payout
  figure already on screen. Passing either under-redeems and silently strands the
  remainder — the same units confusion as `estPayoutFor`, in a second place.
- **The held balance is the authority, not the recorded payout.** `claimCall`
  reads the winning leg's on-chain balance and redeems that, so a mis-recorded
  payout can't cause an over- or under-claim.
- **The row reads the chain before rendering.** `getClaimableShares` returns 0
  once redeemed, so a claimed history goes quiet instead of showing buttons that
  would fail. That's also what makes tapping Claim twice harmless.

</details>

<details>
<summary><strong>Long lists are capped with <code>maxHeight</code>, never a fixed <code>height</code></strong></summary>

<br>

Room calls, the room leaderboard and call history all grow without limit. A room
with a dozen calls pushed the leaderboard and everything under it off the bottom
of the page, so reaching the next section meant scrolling past every row.
`app/src/components/ui/ScrollBox.tsx` caps each one and scrolls it in place.

`maxHeight` rather than `height` because a fixed height is wrong in the common
case: a room with two calls should render a two-row card, not a mostly-empty box
padded out to 320px. The cap only engages once there's more content than fits.

The fade at the bottom isn't decoration. A nested scroller shows no scrollbar on
a touch device, so without it a capped list is indistinguishable from a complete
one — the user has no way to know rows continue. It renders only while there's
content still below, and sits in a `pointerEvents="none"` overlay so it can't
swallow a tap meant for the last row.

Verified against real data by `e2e/scrollbox.mjs`, which asserts the box overflows
before claiming the cap works — otherwise a short list would pass trivially.

</details>

<details>
<summary><strong><code>RoomList</code> stays beneath <code>Room</code> when the result screen resets</strong></summary>

<br>

The result screen is a terminal state for a call, so "Back to room" resets the
navigation stack rather than calling `goBack()` — otherwise a back-swipe returns
to a result the user already dismissed.

Resetting to `[Room]` alone, though, left Room as the *only* route in the stack.
Its own back button then had nowhere to go, so after placing any call the user was
stranded in the room with no route to the rooms list, their profile or the global
leaderboard short of reloading the page. Since claiming a win lives on the
profile, the feature was unreachable by the path a user actually takes to it.

The reset is now `[RoomList, Room]` with `index: 1`: same screen in front, back
still works behind it.

</details>

<details>
<summary><strong>Settlement is polled, not event-triggered</strong></summary>

<br>

Nothing about a `calls` document changes on its own when a market settles —
the state change happens on-chain, and something has to go *look*. A
Firestore `onUpdate` trigger has nothing to react to. So `pollPendingCalls`
runs on an EventBridge schedule every 60 seconds, scans every `pending` call,
and reads each one's real on-chain status directly — gating on the
authoritative on-chain `MarketStatus`, never the (seconds-lagging) indexer.

</details>

<details>
<summary><strong>Market discovery via <code>listBinaryMarkets</code>, not <code>loadMarkets</code></strong></summary>

<br>

Measured with `scripts/profile-market-reads.ts`:

| Call | Time | Scope |
|---|---|---|
| `loadMarkets(true)` | **18.06s** | 608 markets, every venue |
| `listBinaryMarkets({ venueId, status: "Trading", limit: 60 })` | **2.24s** | our venue only |
| `getMarketOnchain` ×50 parallel | 1.69s | |

8× faster is the smaller reason. The deciding one: `loadMarkets`' derived `active`
flag **hid a live BTC 1h market** that the indexer reported as `Trading` and that
we then traded against successfully. Trusting `active` shows the user fewer
markets than exist.

</details>

<details>
<summary><strong>Window labels snap to the nearest cadence, and the window list is derived</strong></summary>

<br>

Two separate traps in how the venue reports time.

**Cadence jitter.** `intervalSec` is derived from `expiry − tradingStart`, and
trading routinely opens a second or two late, so a 15-minute series is indexed as
899 or 898 as often as 900. Matching exactly returns `null`, the market gets
dropped, and the UI's window chips appear and disappear at random. Caught live by
`scripts/check-cadence-labels.ts` — an ETH series indexed at 899s. Labels now snap
to the nearest rung within a scaled tolerance.

**The venue rotates cadences.** At one point only 4h and 1d were live; at another
all of 5m/15m/1h/4h/1d. Hard-coding a window list shows the user an empty screen
through no fault of their own, so the list is derived from live markets via
`availableWindows()`.

**But "derived" only means derived from cadences we have a label for**, and that
distinction hid a whole window. An earlier version of this section listed 5m
alongside genuine noise (1m, and oddities like 3s and 52s) as series Streakr
deliberately didn't surface. Re-measuring with
`chain-integration/scripts/list-cadences.ts`, which lists live cadences with the
app's allowlist taken out of the way:

```
cadence   seconds  markets  assets     app shows it as
5m        300      4        ETH,BTC    *** DROPPED — no label ***
15m       900      2        BTC,ETH    15m
1h        3600     2        ETH,BTC    1h
4h        14400    2        BTC,ETH    4h
1d        86400    2        ETH,BTC    1d
```

5m was not noise. It was the venue's **most-populated cadence**, on both assets,
with quoted books on both legs — and the fastest-settling window available, which
makes it the best one for a live demo. `labelWindow(300)` snapped it to the 15m
rung, missed the tolerance by 600s, returned `null`, and `availableWindows()`
dropped it. No error, no log, nothing on screen.

That failure mode is why the labelling logic now lives in a leaf module
(`app/src/lib/windows.ts`) with 30 unit tests: it can silently hide real,
tradable markets, and both bugs it has had were found by querying the chain
rather than by using the app. The tests assert the drift cases, that neighbouring
rungs can't merge, and that no two rungs sit inside each other's tolerance — so
adding a cadence later can't quietly break an existing one.

1m and the sub-minute oddities stay unlabelled on purpose: a window that closes
faster than a signed transaction confirms isn't a game, it's a coin flip with
extra steps.

</details>

<details>
<summary><strong>Each leg is priced from its own asks</strong></summary>

<br>

Deriving the DOWN price as `1 − yesBid` and then adding slippage moves the price
the **wrong direction**, so the IOC never crosses and returns unfilled with no
error at all — indistinguishable from an empty book. `getBinaryOrderBook(pool)`
returns all four sides, so each leg reads its own asks: `yesAsks` for UP,
`noAsks` for DOWN.

Related: the SDK resolves `placeOrder` even when the receipt status is
`reverted`, so a failed call looks successful unless checked explicitly. Streakr
checks, because otherwise it would record a database row for a transaction that
never happened.

</details>

<details>
<summary><strong>Errors are mapped to sentences a person can act on</strong></summary>

<br>

What reached the UI before was, verbatim:

```
@somnia-chain/markets-sdk: placeBinaryOrder reverted:
ERC20InsufficientBalance(0x2ec8175015Bef5ad1C0BE1587C4A377bC083A2d8, 0, 5000000)
```

`app/src/lib/errors.ts` maps observed failures to a title, one actionable
sentence, and a `kind` the screens branch on — so the funding case can render a
"Fund this wallet" button rather than just complaining. The example above becomes:

> **Not enough tUSDC** — This call needs 5.00 tUSDC but the wallet holds 0.00.

18 test cases cover it, asserting both the classification and that no SDK jargon
or wallet address survives into user copy. Collateral is also checked *before*
requesting a signature, so an underfunded wallet is caught without the user paying
gas to discover it.

</details>

## Setup

### 1 · Chain integration

```bash
cd chain-integration
npm install
cp .env.example .env
```

Edit `.env`:

| Variable | Value | Why |
|---|---|---|
| `PRIVATE_KEY` | a **fresh** testnet-only key | never reuse a real wallet key — generate one with `node -e "console.log(require('viem/accounts').generatePrivateKey())"` |
| `NETWORK` | `testnet` | default |
| `MM_LOT` | `1000` | **required.** Measured against the live venue: it enforces a 1000-raw-unit lot grid, not the bot-kit's documented default of `1` — omitting this reverts every order with `InvalidQuantity` |

Fund the wallet:

1. **Gas (STT)** — [Somnia Shannon faucet](https://t.me/+XHq0F0JXMyhmMzM0) (hackathon Telegram) or the Google Cloud Web3 faucet
2. **Collateral (tUSDC)** — self-serve once gas lands: `npx tsx scripts/fund-collateral.ts` (mints 10,000 tUSDC via the SDK's public testnet faucet)

Verify:

```bash
npx tsx scripts/ec-doctor.ts   # Event Contracts venue + wallet check
```

### 2 · Backend — Firestore

```bash
cd backend
firebase login
firebase use --add
firebase deploy --only firestore
```

In the Firebase console:
- **Build → Firestore Database** → create one if needed
- **Build → Authentication → Sign-in method** → enable **Anonymous**
- **Project settings → General** → add a Web app → copy config into `app/.env`
- **Project settings → Service accounts** → generate a private key → you'll need this JSON for step 3

### 3 · Backend — AWS Lambda

```bash
cd backend/lambda
npm install
npm run test        # 20 unit tests: streak/XP/badge logic + Telegram formatting
npm run package      # bundles + zips all 6 handlers into deploy/*.zip
```

Then follow **[`backend/lambda/DEPLOY.md`](backend/lambda/DEPLOY.md)** — the six
functions, env vars, the EventBridge schedule, and Function URLs.

| Function | Trigger | Purpose |
|---|---|---|
| `streakr-poll-pending-calls` | EventBridge, `rate(1 minute)` | reads on-chain settlement, writes streak/XP/badges/leaderboard |
| `streakr-faucet` | Function URL (POST) | grants a new wallet STT + tUSDC so it can transact at all |
| `streakr-sentiment` | Function URL (GET) | momentum signal, phrased by Mistral |
| `streakr-render-result-card` | Function URL (GET) | shareable SVG for a settled call |
| `streakr-pre-lock-nudge` | Function URL (GET + secret) | rooms closing soon, for n8n |
| `streakr-telegram-webhook` | Function URL (POST from Telegram) | `/link CODE` binds a group to a room |

Two optional env vars change behaviour rather than enabling it:

- `LLM_API_KEY` + `LLM_MODEL` on `streakr-sentiment` — without them the same
  signal renders through a deterministic template. Currently set to Mistral
  `ministral-8b-latest`. (Note the id is *ministral*, not *mistral* —
  `mistral-8b-latest` does not exist.)
- `N8N_SETTLEMENT_WEBHOOK_URL` on the poller — unset, so no Telegram ping. The
  poller logs a warning and continues; settlement is unaffected.

### 4 · App

```bash
cd app
npm install
cp .env.example .env    # Firebase config + the 3 Lambda Function URLs
npm run web              # fastest for a demo

npm run typecheck        # tsc --noEmit
# from the repo root:
#   node scripts/check-docs.mjs           docs structure
#   node scripts/check-docs-coverage.mjs  no script left undocumented
npm run test             # 81 unit tests: error mapping, call outcomes, quote/book
                         # maths, cadence labelling
npm run build:web        # clean export + asset relocation + build gates
```

`EXPO_PUBLIC_FAUCET_URL` is effectively required. Without it a browser-generated
demo wallet has no gas and cannot place a call — see the faucet decision above.

**Always build via `npm run build:web`, never a bare `expo export`.** It runs two
gates that catch failures which are otherwise invisible until production:

- **`relocate-vendor-assets.mjs`** — `expo export` mirrors an asset's source path
  into the output, so icon fonts land under `dist/assets/node_modules/...`. The
  Vercel CLI strips any path containing a `node_modules` segment from a static
  upload, so all 30 of them 404 *in production only* — icons render as blank boxes
  and the failed font fetch surfaces as an unhandled `NetworkError`. This moves
  them and rewrites the URLs.
- **`verify-web-build.mjs`** — Metro caches its env inlining, so editing `.env`
  without `--clear` ships a bundle carrying the *previous* `EXPO_PUBLIC_*` values
  with no warning at all. This asserts every value from `.env` is actually present
  in the output, and that no asset URL lacks a file on disk.

Icons are generated from the same source the UI uses — the Ionicons flame glyph on
the lime gradient, rendered from the real TTF in headless Chrome so the app icon
can't drift from the in-app mark:

```bash
node scripts/generate-icons.mjs
```

### 5 · Telegram notifications

There are **two independent paths**, and they compose — set either, or both.
Neither is required: settlement, streaks, XP and leaderboards work regardless.

Two notifications exist, and they are **not** delivered the same way:

| Notification | When | Status |
|---|---|---|
| **Settlement** — "X called BTC UP and won 16.67" | a call resolves on-chain | **live**, posted by the poller |
| **Pre-lock nudge** — "your window locks in 2 minutes" | 0–120s before a window closes | **needs n8n running** — see B |

### Telegram Mini App — the same URL, no second deployment

A Mini App is just an HTTPS page rendered in Telegram's WebView, so
`https://streakr-opal.vercel.app` serves both surfaces. The bot's menu button
points at it:

```bash
curl -X POST "https://api.telegram.org/bot<token>/setChatMenuButton" \
  -H 'content-type: application/json' \
  -d '{"menu_button":{"type":"web_app","text":"Open Streakr",
       "web_app":{"url":"https://streakr-opal.vercel.app"}}}'
```

That needs no BotFather interaction. For a shareable direct link
(`t.me/streak_r_bot/streakr`), send `/newapp` to
[@BotFather](https://t.me/BotFather) and give it the same URL.

Why this closes a loop rather than adding a surface: settled calls already post to
the room's group chat, so the result and the next call now live in the same place.

Three things had to change, and each was a real dead end otherwise:

- **No wallet extension exists in a WebView.** `EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID`
  is unset, so the connector list degrades to injected-only — inside Telegram that
  modal offers wallets that physically cannot connect. Onboarding detects the host
  and leads with the demo wallet instead, which is a browser-generated key funded
  by the server faucet and works identically in a WebView. The external option is
  dropped rather than left to fail, and the copy says why.
- **A Mini App opens at about half screen height.** Without `expand()` the call
  buttons sit below the fold. `initTelegramMiniApp()` calls `ready()` + `expand()`
  and matches the Telegram header to the app background.
- **`Linking.openURL` becomes a blocked popup.** "View on-chain transaction" — the
  one link that proves a call was real — silently did nothing. It now goes through
  `Telegram.WebApp.openLink` when in Telegram and falls back to `openURL` in a
  browser.

Detection deliberately requires `platform !== "unknown"` or a non-empty
`initData`, not merely the presence of `window.Telegram.WebApp`. The script is
served on every page and defines that namespace in ordinary browsers too, so
checking for it alone would hide the wallet button from someone who has MetaMask.

`telegram-web-app.js` is added to the exported shell by
`scripts/inject-telegram-webapp.mjs` rather than imported through Metro: it must
define `window.Telegram.WebApp` synchronously before the bundle's first line, and
modular HTML (`+html.tsx`) is an Expo Router feature this app doesn't use. The
script asserts its own result, like the other build gates.

`e2e/telegram.mjs` covers all three cases in one run — as a Mini App (with a
locked stub, since the real script would otherwise overwrite it), as a plain
website that must behave exactly as before, and with a genuine Telegram launch
hash through the real script, which is what proves detection fires in production.

### Per-room chats

Each room shows a code (`/link ABC123`). Send it in any Telegram group that has
`@streak_r_bot` in it, and that room's settled calls post there instead of the
shared fallback chat. `/unlink` detaches.

`streakr-telegram-webhook` handles it. A webhook rather than polling
`getUpdates`, because polling needs a scheduler, holds an offset cursor, and
breaks if anything else consumes the same feed.

Two things it gets right that are easy to miss:

- **Telegram echoes a secret header** (`x-telegram-bot-api-secret-token`), which
  is checked. Without it, anyone who found the Function URL could forge an update
  and repoint any room's notifications at a chat they control.
- **`telegramChatId` is not client-writable.** `firestore.rules` limits client
  room updates to `name` / `activeMarket` / `isPublic`, so only the webhook (admin
  SDK) can set it. The `linkCode` is a claim ticket rather than a secret —
  claiming it only redirects that room's own notifications.

Group messages arrive addressed to the bot (`/link@streak_r_bot abc123`), so the
command parser handles the mention and is case-insensitive on the code.

```bash
# One-time registration; Telegram remembers it.
curl "https://api.telegram.org/bot<token>/setWebhook" -H 'content-type: application/json' \
  -d '{"url":"<function url>","secret_token":"<secret>","allowed_updates":["message","edited_message","channel_post"]}'
curl "https://api.telegram.org/bot<token>/getWebhookInfo"   # verify, check last_error_message
```

The nudge is different because `streakr-pre-lock-nudge` is only a *read* endpoint:
it answers "which rooms are about to lock?" and sends nothing itself. Something
has to both call it on a schedule and post the result, which is n8n's job. With
n8n down, nobody asks, so no nudges go out. Settlement notifications are
unaffected.

There's a second limit worth stating plainly, because it's a design consequence
rather than a bug. The endpoint only considers a room whose stored
`activeMarket.positionMarketId` is *still trading*, and that pointer is written by
the room screen while the room's **creator** has it open. It goes stale as soon as
they leave, and on a short cadence it goes stale fast — a 5m market is resolved
five minutes later. So the nudge reminds people about the window a room was last
pointed at, which means it can't reliably pull someone back to a room nobody is
watching. `scripts/inspect-nudge.mjs` shows the pointer against the market's real
on-chain state, which is the distinction an empty response hides:

```
test   activeMarket: ETH 1h   on-chain: status=resolved, expired 127209s ago
       -> SKIPPED: pointer is stale
```

The nudge also used to post every reminder to the shared fallback chat. The n8n
workflow reads `telegramChatId` and falls back if it's absent, but the handler
never returned that field — so a room linked to its own group got its results
there and its reminders somewhere else. Fixed; the nudge now routes per-room the
same way settlement does.

**A · Direct from the Lambda** *(live)*

The poller posts the outcome straight to the Bot API. No hosting, nothing to keep
awake, so this is the one that survives a closed laptop:

```bash
cd backend/lambda
node scripts/set-env.mjs streakr-poll-pending-calls \
  TELEGRAM_BOT_TOKEN=<token> TELEGRAM_CHAT_ID=<chat id>
```

**Use that script rather than `aws lambda update-function-configuration` directly.**
The raw command replaces the whole environment, so every existing variable has to
be passed back in — and round-tripping `FIREBASE_SERVICE_ACCOUNT_JSON` through the
API turns its `\n` escapes into real newlines. That kills the function at startup
with `Bad control character in string literal in JSON`, pointing at `getDb` rather
than at the deploy that broke it. It cost us two debugging sessions before the
script existed. `set-env.mjs` merges into the current environment, re-reads the
credential from disk, and asserts the escaping before and after writing.

Get a token from [@BotFather](https://t.me/BotFather), add the bot to a group,
send one message there, then read the chat id from
`https://api.telegram.org/bot<token>/getUpdates`. **A group chat id is negative**
(e.g. `-5298062119`).

Message text is built in `src/telegram.ts` and covered by 10 unit tests — mostly
around MarkdownV2 escaping, since a single unescaped `.` or `_` makes Telegram
reject the whole send, and display names and badge keys are full of them.

**B · Via n8n** *(workflows import and run; no instance currently hosted)*

Richer if you want to branch or add steps. Import without touching the UI:

```bash
npm install -g n8n
n8n import:credentials --input=telegram-cred.json   # {"type":"telegramApi","data":{"accessToken":"..."}}
n8n import:workflow --separate --input=n8n-workflows/
n8n update:workflow --id=<id> --active=true         # both workflows

N8N_BLOCK_ENV_ACCESS_IN_NODE=false \
STREAKR_PRE_LOCK_NUDGE_URL="<nudge Function URL>" \
STREAKR_N8N_SHARED_SECRET="<must equal N8N_SHARED_SECRET on that Lambda>" \
STREAKR_DEFAULT_TELEGRAM_CHAT_ID="<chat id>" \
n8n start
```

The two workflows have different reachability needs, which is worth knowing
before choosing where to host:

| Workflow | Direction | Needs a public URL? |
|---|---|---|
| Pre-Lock Nudge | schedule, calls **out** to the nudge Lambda | **no** — works from a local n8n |
| Settlement Notify | **receives** a POST from the poller | **yes** — set `N8N_SETTLEMENT_WEBHOOK_URL` to its production webhook |

`n8n start --tunnel` was removed in n8n 2.x, so exposing the webhook now means
hosting n8n somewhere reachable (n8n Cloud, or Docker on a small box) rather than
tunnelling from a laptop. A notification that only works while a laptop is awake
isn't a working feature, which is why the settlement path was moved into the
always-on Lambda and n8n's copy of it is redundant. Its one unique contribution
is the nudge.

Both workflows were verified working: imported via CLI, credentialed, activated,
and recorded `success` executions against the live bot. Making the nudge always-on
without n8n would mean an EventBridge rule plus letting the nudge Lambda post
directly — the same shape as path A.

## Testing a full call cycle

```text
  Connect wallet ──► create or join a room ──► pick BTC | ETH + window
        │
        └──► tap Up or Down ──► confirm stake & risk ──► sign & submit
                   │
                   └──► wait for the window   (Lambda polls every 60 s)
                              │
                              └──► result updates live  (Firestore listener)
                                        │
                                        └──► streak / XP / badges update
                                                  ├──► share the result card
                                                  └──► CLAIM the win
                                                       (redeem → balance moves)
```

<details>
<summary>Same diagram as Mermaid</summary>

```mermaid
flowchart LR
    A[Connect Wallet] --> B[Create / Join Room]
    B --> C[Pick BTC/ETH + window]
    C --> D[Tap Up or Down]
    D --> E[Confirm stake & risk]
    E --> F[Sign & Submit]
    F --> G["Wait for window to close<br/>(Lambda polls every 60s)"]
    G --> H["Result updates live<br/>(Firestore listener)"]
    H --> I[Streak / XP / Badges update]
    I --> J[Share Result Card]
    I --> K["Claim the win<br/>(redeem → balance moves)"]
```

</details>

### Preflight: can it still onboard anyone?

```bash
cd app && node e2e/tools/preflight.mjs
```

Run this before any demo. Every new visitor is funded from **one treasury**, and
if that treasury is dry the faucet returns `503 faucet is out of gas` and nobody
can place a call. Nothing in the UI announces it — a visitor just sees an unfunded
wallet, and the failure is invisible until someone tries.

It has happened here. A day of automated runs took the treasury from 4.78 STT to
0.052, because every probe wallet takes a grant (0.08 STT + 150 tUSDC) and each
browser check signs in as a new wallet. Seven checks is seven grants.

```
treasury
  2.212655 STT   60713.14 tUSDC
  can onboard ~27 new wallet(s)   (gas allows 27, collateral allows 404)
  ok    27 wallet(s) fundable
>>> ready to demo
```

Two independent limits, and the preflight reports whichever binds first:

| Limit | Symptom | Fix |
|---|---|---|
| Treasury **STT** below `FAUCET_GAS_FLOOR` (0.05) | faucet `503`, no wallet can be funded | the [Somnia testnet faucet](https://testnet.somnia.network) — STT can't be minted from a contract |
| Treasury **tUSDC** below one grant (150) | faucet `503` | `cd chain-integration && npx tsx scripts/fund-collateral.ts` — the collateral token has a public `faucet()`, 10,000 per call |
| Rolling 24h grant cap (`FAUCET_DAILY_CAP`, 60) | faucet `429` | nothing — it decays as grants age out of the window |

Testing shouldn't be a one-way drain, so `e2e/tools/sweep.mjs` returns STT and
tUSDC from throwaway probe wallets to the treasury:

```bash
node e2e/tools/sweep.mjs <privateKey>…    # recovered 3.00 STT + 422 tUSDC in one run
```

`e2e/claim.mjs` prints the key it generates precisely so a probe wallet can be
swept afterwards rather than stranded.

**Two things to know before demoing**, both venue behaviour rather than app bugs:

- **Check the book before tapping.** The venue frequently quotes only one leg
  (`UP 0.020  DOWN —`). Calling the unpriced side cannot fill; the app says
  "Nobody on the other side" honestly, but pick the side showing a number.
- **5m windows settle inside a demo**, and 15m usually will too; 1h takes up to an
  hour. The window chips only ever show cadences the venue is actually running, so
  pick the shortest one on screen.

### Browser checks

`app/e2e/` drives the real exported build against live Somnia testnet and the real
Firestore project — no mocks, because most of this app's actual failures only
appear in a browser against live data (a react-native-web layout collapsing to
`height: 0` with no console error; fonts 404ing only in production; a lost race
between market reads).

```bash
npm i -D puppeteer-core          # not a runtime dep, drives system Chrome
npm run build:web && npx http-server dist -p 8899

node e2e/flow.mjs     http://localhost:8899        # onboarding -> room -> live markets
node e2e/switch.mjs   http://localhost:8899        # no stale data on asset/window switch
node e2e/roomfeed.mjs http://localhost:8899        # a placed call appears in the room
node e2e/fullcall.mjs http://localhost:8899        # the whole loop, real signed tx
node e2e/errpath.mjs  http://localhost:8899        # funding gate, no raw SDK jargon on screen
node e2e/history.mjs  http://localhost:8899        # settled rows explain themselves
node e2e/align.mjs    http://localhost:8899 1512   # measures rendered layout geometry
node e2e/scrollbox.mjs http://localhost:8899       # long lists cap and scroll in place
node e2e/claim.mjs    http://localhost:8899 4      # redeeming a win raises the balance
node e2e/telegram.mjs http://localhost:8899        # works as a Mini App AND as a website
```

Each exits non-zero on failure. Point any of them at the deployed URL to check
production instead.

`e2e/tools/` holds helpers rather than checks:

```bash
node e2e/tools/preflight.mjs                  # can this still onboard anyone?
node e2e/tools/bal.mjs <address>…             # STT, affordable writes, tUSDC
node e2e/tools/gas.mjs <address> [amount]     # treasury top-up (harness only)
node e2e/tools/sweep.mjs <privateKey>…        # return probe funds to the treasury
node e2e/tools/probe-window.mjs <url> [5m]    # is a window really tradable?
node e2e/tools/probe-http.mjs <url> [load|signin|room]   # every non-2xx, with its URL
node e2e/tools/shot.mjs <url> <out.png> [profile|room] [pk]
node e2e/tools/shot-noname.mjs <url> <out.png>
```

`probe-http.mjs` earns its place: the checks report a bare
`Failed to load resource: 503` from the console, which names no URL. This drives
sign-in and room creation — nothing 503s at page load — and prints the address
behind it. That's how the drained-treasury faucet outage was found.

`bal.mjs` reports **affordable writes** alongside the balance, because that's the
number that predicts whether a call can be placed — at a 2,000,000 gas ceiling and
12 gwei, each write needs 0.024 STT held. `gas.mjs` exists because the product
faucet correctly refuses a wallet already above its gas floor, which is right for
users but leaves a test wallet short when one run needs four writes.

### Diagnostics

For when something is wrong in live data rather than in the UI:

```bash
cd backend/lambda
node scripts/inspect-pending.mjs [limit]   # why is a call still pending?
node scripts/recent-calls.mjs [limit]      # latest calls, status + payout
npx tsx scripts/inspect-nudge.mjs [secs]   # why is the pre-lock nudge empty?
node scripts/purge-test-rooms.mjs "Name"   # delete rooms by exact name
node scripts/purge-probe-data.mjs          # DRY RUN: all test-run leftovers
node scripts/purge-probe-data.mjs --yes    # …and actually remove them

TELEGRAM_BOT_TOKEN=… TELEGRAM_CHAT_ID=… \
  npx tsx scripts/verify-telegram-5m.mjs --send   # a real settlement notification

cd chain-integration
npx tsx scripts/list-cadences.ts                       # cadences the venue really runs
npx tsx scripts/one-live-market.ts                     # id of the soonest-expiring live market
npx tsx scripts/find-claimable.ts                      # unredeemed wins for the signer
PK=0x… npx tsx scripts/redeem-position.ts [marketId]   # redeem with a specific key
```

Verifying the nudge needs a market that's still trading, and short cadences roll
every few minutes, so the two compose:

```bash
cd chain-integration && npx tsx scripts/one-live-market.ts   # -> 0x… BTC 4h 2664s
cd ../backend/lambda
NUDGE_URL=… N8N_SHARED_SECRET=… MARKET_ID=0x… MARKET_WINDOW=4h MARKET_SYMBOL=BTC \
  npx tsx scripts/verify-nudge-fix.mjs
```

`verify-nudge-fix.mjs` points a linked room at that live market, calls the real
endpoint, asserts the response carries the room's own `telegramChatId`, and
restores the pointer in a `finally` — including restoring "no pointer at all".
It's the only way to observe the per-room routing, since the endpoint reports
nothing for a room whose pointer has gone stale.

`purge-probe-data.mjs` exists because each browser check signs in as a fresh
anonymous user and often creates a room, so a day of runs leaves dozens of
one-member rooms and probe accounts in the public list and on the global
leaderboard. It's dry-run by default and deliberately conservative: probe names
come from grepping the actual `signIn()` calls in `app/e2e` rather than from what
looks automated, a `0x…` display name is **never** treated as a probe (that's a
real visitor who skipped the name field), and a room is never deleted if it has a
Telegram chat linked or holds calls from a real account.

`verify-telegram-5m.mjs` builds a settlement message from a real settled call with
the production formatter and then **sends** it. Printing it proves nothing: one
unescaped MarkdownV2 character makes Telegram reject the entire send, so the
notification silently never arrives. Telegram's own accept/reject is the authority.

`inspect-pending.mjs` separates the two failures that look identical from the UI:
a poller not picking a call up, versus a market that simply hasn't resolved yet. It
prints `closesAtSec` against now, so "overdue" is visible rather than inferred.

`redeem-position.ts` mirrors what the app's Claim button does, against the same SDK
surface, reporting collateral either side. Note it goes through the bot kit's
**default** trader with no fee override, so it needs ~1.2 STT on hand — running it
reproduces the 60 gwei problem from the other direction, reverting with
`setOperator reverted: Missing or invalid parameters` on a wallet that holds plenty
for the app's own path.

## Verified on-chain

Every call below was signed, submitted and settled for real on Shannon testnet.

**Through the app** — 13 calls settled, 9 won and 4 lost, each one a real signed
transaction valued from its real on-chain resolution. A representative win, with
every figure read back out of Firestore after the poller settled it:

| Field | Value |
|---|---|
| Call | BTC **UP**, 15m window |
| Staked | 5.00 tUSDC |
| Filled | 16.666 shares at **0.300** entry (a 27% implied chance) |
| Resolved | Up — the called direction |
| Payout | **16.666 tUSDC** → +11.666 profit |
| Written | streak 1, +20 XP, `first_call` badge, room + global leaderboard |
| Notified | posted to the room's Telegram with the tx link |

That payout is the whole point of the share count: a winning outcome token
redeems for ~1 collateral, so `5.00 / 0.300 = 16.67`. An earlier version computed
the payout from the stake instead and reported **5.00** on that same call, making
every win look like break-even.

A loss resets the streak to zero while still awarding XP, and the loss is exactly
the stake — showing that honestly matters more than hiding it.

**Through the CLI**, during Phase 1 chain integration:

| Call | Window | Market resolved | Result | Payout |
|---|---|---|---|---|
| BTC **UP** | 1h | YES / Up | ✅ **WIN** | full payout |
| ETH **DOWN** | 1h | YES / Up | ❌ **LOSS** | $0 — capped exactly at stake |

The CLI pair went through `scripts/place-event-contract-call.ts` and were tracked
by `scripts/watch-settlement.ts`. The in-app calls were settled by
`streakr-poll-pending-calls` reading on-chain `MarketStatus` on its 60-second
schedule, which is the same path any user's call takes.

The share count used to value a settled call is read **from chain** at settlement
(the wallet's ERC-6909 balance on the called leg), not taken from the call
document — otherwise a client could report any fill it liked and inflate the
payout shown in a shared room feed. The recorded value is only a fallback if that
read fails.

## DreamDEX SDK & docs feedback

> **The full write-up is in [`FEEDBACK.md`](FEEDBACK.md)** — 17 findings with
> measurements, reproduction scripts, and suggested fixes ranked by impact.
> Highlights: a fixed 60 gwei `maxFeePerGas` that makes any ordinary end-user
> wallet unable to place a call; `approve` costing 1,389,617 gas on Somnia;
> cadence jitter silently dropping live markets; and the NO-leg pricing trap that
> fails with no error at all.

A few of the docs-level points, in brief:

- **Lot-size default is stale for at least one live testnet venue.** The
  bot-kit's `packages/ec-core/src/config.ts` documents testnet as having "no
  lot constraint in practice" (`MM_LOT=1`). Measured against the live
  Shannon testnet venue: every order at that default reverted with
  `InvalidQuantity(<requested>, 1000)` — the venue actually enforces a
  1000-raw-unit lot grid.
- **The main Bot Kit README and the Event Contracts docs disagree on which
  primitive to use.** The top-level README's overview table describes
  `packages/core` / `Pool.load` as *the* client pattern and never mentions
  `packages/ec-core` — you only find it by drilling into `strategies/ec-*`
  or reading `docs/event-contracts.md` directly. A newcomer following the
  top-level quickstart would build against the wrong primitive for a binary
  market.
- **No documented wallet-onboarding pattern** (WalletConnect or otherwise)
  exists anywhere in the Bot Kit or Event Contracts docs — everything
  assumes a raw `PRIVATE_KEY` in `.env`. For anything with a real end user
  (not a bot), that's a real gap.
- **`estPayoutFor`'s settlement fee isn't easily discoverable read-only.**
  `settlementFeeBps` needs either an indexer row with fee fields populated,
  or a signer-free on-chain read through a hand-copied minimal ABI — there's
  no plain read method on the unified SDK surface for it.

## Deliverables checklist

- [x] Working prototype on Somnia testnet — real Event Contract calls, not mocked
- [x] Public GitHub repo, clean README — [github.com/Spydiecy/Streakr](https://github.com/Spydiecy/Streakr)
- [x] Live deployment — [streakr-opal.vercel.app](https://streakr-opal.vercel.app)
- [x] All chain interactions traceable to real testnet tx hashes
- [x] Real DreamDEX Event Contracts integration, social/gamified UX, AI feature
- [x] Full call cycle verified in-app: fund → call → on-chain → settle → streak
- [x] Developer feedback — [`FEEDBACK.md`](FEEDBACK.md)
- [x] Tests — 81 app unit tests, 20 backend unit tests, 10 browser checks
- [x] Telegram Mini App — the same deployed URL, opened inside Telegram
- [x] Telegram settlement notifications — live from the poller
- [x] Demo walkthrough — [`DEMO.md`](DEMO.md)
- [ ] Pre-lock nudge — workflow built and verified, but needs n8n hosted to run

---

<div align="center">
<sub>Built for a hackathon. Testnet funds only. Not financial advice.</sub>
</div>
