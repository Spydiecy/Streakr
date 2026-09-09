// The core path: onboarding → display name → demo wallet → create room → the
// room actually loads live markets.
//
// Worth keeping as its own script because several regressions here were silent —
// no console error, just a screen that never finished loading. The one that
// caused it most recently was a missing Firestore composite index, which made
// the room's call listener never receive a first snapshot.
//
//   node e2e/flow.mjs [url] [width] [height]
import { open, wait, signIn, createRoom, text, flat, windowChips, reportProblems } from "./lib.mjs";

const url = process.argv[2] ?? "http://localhost:8899";
const width = Number(process.argv[3] ?? 430);
const height = Number(process.argv[4] ?? 950);
const { browser, page, problems } = await open({ url, width, height });

console.log(`### ${url} @ ${width}x${height}`);
console.log("\n1. onboarding\n  " + (await flat(page)).slice(0, 200));

const name = `Probe${Math.floor(Math.random() * 900 + 100)}`;
await signIn(page, name);
const list = await text(page);
console.log("\n2. room list\n  " + list.replace(/\n+/g, " | ").slice(0, 240));
console.log(`  display name "${name}" shown: ${list.includes(name)}`);

const room = `Probe${Math.floor(Math.random() * 900 + 100)}`;
console.log(`\n3. creating room ${room}…`);
const landed = await createRoom(page, room);
console.log(`  reached the room screen: ${landed}`);

const body = await text(page);
console.log("\n4. room\n  " + body.replace(/\n+/g, " | ").slice(0, 420));

const hasMarket = /LIVE|Locked/.test(body);
const boardResolved = /No calls settled here yet|ROOM LEADERBOARD/i.test(body);
const stuck = /Reading live/.test(body);
console.log(`\n  market card resolved:  ${hasMarket}`);
console.log(`  window chips:          [${(await windowChips(page)).join(",")}]`);
console.log(`  leaderboard resolved:  ${boardResolved}`);
console.log(`  still loading at 30s:  ${stuck}${stuck ? "  *** check the Firestore indexes ***" : ""}`);

const failed = reportProblems(problems);
await browser.close();
process.exit(landed && hasMarket && !stuck && failed === 0 ? 0 : 1);
