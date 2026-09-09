# Demo script

A ~3 minute walkthrough of Streakr on Somnia Shannon testnet, structured so the
strongest claim lands first and every number on screen is real.

**Live app:** https://streakr-opal.vercel.app

---

## Before you record

Five minutes of prep that removes almost every way a take can fail.

| Check | Why it matters |
|---|---|
| **Turn off ad/privacy blockers** for the site | They block `firestore.googleapis.com`, and rooms silently stop saving. There's a banner for it now, but don't fight it on camera |
| **Use a browser profile you've already connected once** | The wallet is already funded, so you skip the ~20s faucet wait. A fresh profile means a fresh wallet and a fresh grant |
| **Don't hit "Disconnect wallet"** between takes | It deletes the key, so the next connect generates a *different* address and burns another treasury grant |
| **Check the treasury** | `npx tsx chain-integration/scripts/check-demo-wallet-funding.ts` — STT is the binding constraint and has no self-serve faucet |
| **Have the Telegram group visible** | Second monitor or a phone. The settlement message is the payoff shot |
| **Pick your window before recording** | See below — this is the one thing most likely to waste a take |

### Choosing a window and a side

Two venue realities to work around. Neither is a bug, but both will bite an
unprepared take.

**Use a 15m window** if you want to show settlement on camera. 1h and 4h are
often better priced but won't resolve inside a recording.

**Check both prices before you tap.** The venue frequently quotes only one leg —
you'll see `UP 82%` / `DOWN —`, and the unquoted side's button reads *no bids* and
is disabled. Call the side showing a number.

**Prefer the side with the bigger payout** for a better shot. A 27% call paying
`win 18.52` is far more compelling on screen than a 94% call paying `win 5.32`.

---

## The script

### 0:00 — Open on a room, not on a login

Start already signed in, inside a room, with a live market on screen.

> "This is Streakr. It's a group chat for market calls — you and your friends call
> Bitcoin or Ethereum up or down, and your streak is public to the room."

Point at the card: **BTC**, the window chips, the countdown ring, the payout
multiples, and the price sparkline underneath.

> "Everything here is live from the chain. That countdown is the actual expiry of
> a real Event Contract on DreamDEX, those multiples are the current order book,
> and the chart is the oracle price feed — the same feed the AI line reads, so
> they can never disagree."

If the book happens to be one-sided you'll see *"only one side is quoted"* instead
of a percentage. Worth calling out rather than hiding — it's an honest read of a
thin market, and most apps would show a meaningless number there.

**Why open here:** two other hackathon submissions pitch "one-tap UP/DOWN with
streaks". Rooms is the thing neither of them has. Lead with it.

### 0:25 — The AI take

> "Before you call, there's a one-line read on recent momentum — built from the
> last four hourly closes and phrased by a small model. It's labelled 'not
> advice', it never suggests a direction, and it never places a trade."

Keep this short. It's a supporting feature, not the story.

### 0:40 — Place a real call

Tap a stake, then tap the side that's quoted. The sheet opens **over** the room.

> "Risk five, win eighteen fifty-two if I'm right. Lose exactly five if I'm
> wrong — that's the whole downside, there's no liquidation and no margin call,
> because a binary Event Contract can't take more than your stake."

Point at **Implied chance**.

> "27% implied. That's why the payout is 3.7x — the cheaper side pays more."

Tap **Sign & place call**.

> "That's a real signed transaction going to Somnia right now."

**Why the sheet matters:** the market is expiring while you decide. Confirming in
place keeps the countdown and the book visible — a pushed screen would hide both.

### 1:05 — It's on-chain

The result screen appears showing **SETTLING**.

> "It's submitted. That's a live transaction hash — you can open it in the
> explorer."

Click through to the explorer if you have the seconds to spare. Seeing a real
Shannon transaction is worth more than any slide.

### 1:20 — Back to the room: the social layer

Go back. Your call is in **Room calls**, marked `LIVE`.

> "Everyone in the room sees the call the moment it's placed — who called what,
> for how much, and whether it's still live. That's the part that makes it a
> group rather than a scoreboard."

Show the room leaderboard beneath it, then the Telegram link card:

> "And a room can point its results at its own Telegram group — you drop the bot
> in and send this code."


### 1:40 — While it settles: profile

> "Streaks, XP, badges. All of this is written server-side from the on-chain
> result — the client can't award itself anything."

Scroll to **Call history** and point at a settled row.

> "And every settled call says what actually happened, not just win or lose:
> 'Closed Up — won 16.67 tUSDC, +11.67 profit'."

### 2:00 — Settlement lands 🎯

When the window closes, the result screen updates itself and the Telegram message
arrives. **This is the shot.** Have the group visible.

> "A Lambda polls every minute, reads the real on-chain resolution, updates the
> streak and the leaderboard, and pings the room's Telegram."

Read the message aloud:

> "'Spy called BTC UP 15m and won. Returned 16.67 tUSDC. Streak: 1.' With a link
> to the transaction — so the result is verifiable, not asserted."

### 2:15 — Claim the winnings

On the won row in **Call history**, tap **Claim**. The balance at the top of the
profile goes up.

> "One thing worth showing, because it surprised us. A resolved Event Contract
> doesn't pay out on its own. You hold winning outcome tokens, and they're worth
> the payout only once you burn them for the collateral behind them. So a user can
> see 'you won 14.58' while their balance hasn't moved — which looks exactly like
> the app losing their money. It isn't, but that distinction is invisible unless
> you already know how these contracts settle. So we made redeeming a real button,
> and this is it moving the tUSDC into the wallet."

**Why show this:** it's a two-second interaction that demonstrates you understood
the settlement model rather than assuming it worked like a centralised exchange.
It's also the fix for the single most confusing thing a first-time user hits.

### 2:25 — Show a loss

Either from history or by calling the unlikely side deliberately.

> "And here's a loss. The streak resets to zero, and the loss is exactly the
> stake — no more. That cap is the reason this works as a casual game."

**Do this.** Everyone demos a win. Showing the downside honestly signals a real
product rather than a happy path, and the capped-loss story is genuinely your
strongest risk argument.

### 2:40 — Close on what you learned

> "The hardest part wasn't the app. Somnia's SDK signs every transaction with a
> ten-million gas limit at a fixed sixty gwei, which means a node demands 0.6 STT
> held before it will even accept it — so no ordinary wallet could place a call,
> and the error said 'missing or invalid parameters'. We measured it, fixed it,
> and wrote it up."

> "That's in FEEDBACK.md — eighteen findings, every number reproducible from a
> script in the repo."

**Why close here:** most submissions end on features. Ending on evidence that you
understood the platform deeply enough to find its sharp edges is far more
memorable, and it's true.

---

## If something goes wrong mid-take

| Symptom | What it is | What to do |
|---|---|---|
| Button says *no bids* | That leg has no resting order | Call the other side, or switch window |
| *Nobody on the other side* after signing | The book moved between quote and fill | Retry; it's venue liquidity, not the app |
| *Not enough tUSDC* | Wallet unfunded | Tap **Fund this wallet** — grants gas + collateral server-side |
| Window chips vanish | Venue rotated cadences | They're derived from live markets; pick one that's showing |
| Rooms won't save | Ad blocker on `googleapis.com` | Disable for the site and reload |
| Countdown at `0:0x` | Window about to lock | Don't start a call; wait for the next roll |

---

## What's live vs what isn't

Be accurate if asked. The gap is small and stating it plainly is better than
being caught.

**Live:** the app, five Lambdas, settlement polling every minute, the server-side
faucet, Mistral-phrased sentiment, Result Card SVGs, and **settlement
notifications to Telegram** (posted directly by the poller — no hosting
dependency).

**Built, not running:** the **pre-lock nudge** ("your window locks in 2 minutes").
It needs n8n running to both schedule and send, and n8n isn't hosted. The two
workflows are in `n8n-workflows/` and import cleanly; the endpoint they call is
live and returns real data. Settlement notifications don't depend on it.

If asked why: `n8n start --tunnel` was removed in n8n 2.x, so exposing a webhook
from a laptop is no longer possible, and a notification that dies when a laptop
closes isn't a feature. The settlement path was moved into the always-on Lambda
instead.

---

## Numbers you can quote

All verified, all reproducible:

- **9 wins, 4 losses** settled from real on-chain outcomes
- a real call: **5.00 staked → 16.67 returned** (16.666 shares at 0.300 entry)
- **51 app unit tests, 20 backend unit tests, 7 browser checks**
- **5 Lambdas**, settlement polling on a 1-minute schedule
- an ERC-20 `approve` on Somnia costs **1,389,617 gas** — ~30x EVM intuition
- `loadMarkets()` **18.06s** vs the targeted query **2.24s**, and the former's
  `active` flag *hid* a live market we then traded successfully
