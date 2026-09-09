# Browser checks

Headless Chrome scripts that drive the real exported web build against the real
Somnia testnet and the real Firestore project. No mocks — the point is to catch
the class of bug that only appears in a browser against live data, which is
where most of this app's actual failures have come from:

- a react-native-web layout collapse that produced `height: 0` with no console error
- `Alert.alert` silently doing nothing, so a confirm button appeared inert
- icon fonts 404ing in production only, because Vercel strips `node_modules` paths
- a lost race between market reads showing one asset's heading over another's prices
- window chips vanishing because a cadence label matched exactly instead of snapping

## Setup

Not wired into `package.json` on purpose — these need a real Chrome and take
minutes, so they're a manual tool rather than part of `npm test`.

```bash
cd app
npm i -D puppeteer-core            # not a runtime dep; installs no browser
npm run build:web                  # the scripts test dist/, not the dev server
npx http-server dist -p 8899       # or: cd dist && python3 -m http.server 8899
```

Chrome is expected at the macOS default path; override with `CHROME=`.

## Scripts

| Script | What it checks |
|---|---|
| `flow.mjs` | Onboarding → display name → create room → room loads with live markets |
| `switch.mjs` | Asset/window switching never shows stale data; window chips stay stable across poll cycles |
| `roomfeed.mjs` | A placed call appears in the room feed, plus balance readout and refresh controls |
| `fullcall.mjs` | The whole loop for real: funded wallet → live market → signed on-chain order |
| `align.mjs` | Measures rendered box centres to find off-centre children and horizontal overflow |
| `errpath.mjs` | The funding gate on an unfunded wallet, and that no raw SDK jargon reaches the screen |
| `history.mjs` | Settled call rows explain the outcome, not just a WON/LOST badge |
| `scrollbox.mjs` | Room calls / leaderboard / history cap out and scroll in place, and the section below stays reachable |
| `claim.mjs` | Places both legs of one 15m market so a win is guaranteed, then redeems it and checks the collateral balance rose |

`tools/` holds helpers rather than checks: `bal.mjs` (balances plus affordable
writes), `gas.mjs` (treasury top-up for a probe wallet), `shot.mjs` /
`shot-noname.mjs` (screenshots for eyeballing layout).

```bash
node e2e/flow.mjs    http://localhost:8899 430 900
node e2e/switch.mjs  http://localhost:8899
node e2e/align.mjs   http://localhost:8899 430
node e2e/align.mjs   http://localhost:8899 1512   # desktop
node e2e/errpath.mjs http://localhost:8899
node e2e/scrollbox.mjs http://localhost:8899
node e2e/claim.mjs   http://localhost:8899 2      # 0 to skip placing and just claim
```

`claim.mjs` prints the key it generates, so a run can be resumed against the same
wallet with `CLAIM_PK=0x… node e2e/claim.mjs <url> 0`. Two things it has to work
around: calls are keyed by Firebase **uid**, not wallet address, so reloading and
signing in again mints a new uid and an empty history — the session must survive
the whole run. And switching windows refetches, during which the call buttons read
"no liquidity", so it waits for the market card rather than sleeping a fixed time.

Point any of them at `https://streakr-opal.vercel.app` to check production
instead of a local build.

## Two things that will bite you

**Query the visible screen only.** react-navigation keeps the previous screen
mounted and marks it `aria-hidden="true"`. The room list underneath renders its
own `"ETH 4h"` chip, so an unscoped `document.querySelectorAll` reads that
instead of the market card and reports a mismatch that isn't on screen. Every
helper here filters on `!el.closest('[aria-hidden="true"]')`.

**Icon glyphs are text content.** An Ionicons glyph is a private-use character
inside a `<Text>`, so a call button's `innerText` is `"\uF10C\nUP"`, not `"UP"`.
Matching text exactly finds the order-book label instead of the button. Match on
the trailing token plus a minimum box size.

## Housekeeping

These create real rooms in the shared Firestore project. Clear them out after a
run:

```bash
cd ../backend/lambda
node scripts/purge-test-rooms.mjs "Probe" "AlignAudit" "SwitchProbe"
```
