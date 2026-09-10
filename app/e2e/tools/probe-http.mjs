// Every non-2xx response the app triggers, WITH the URL.
//
// The browser checks surface a bare "Failed to load resource: 503" from the
// console, which names no URL — enough to fail a run, useless for fixing it.
// This turns that into an address.
//
// A plain page load is not enough: nothing 503s at load. The failure appears once
// the app starts calling its own backends, so this can drive the same sequence the
// checks do.
//
//   node e2e/tools/probe-http.mjs [url] [load|signin|room] [seconds]
import puppeteer from "puppeteer-core";
import { CHROME, wait, tap, typeInto, text } from "../lib.mjs";

const url = process.argv[2] ?? "https://streakr-opal.vercel.app";
const mode = process.argv[3] ?? "signin";
const secs = Number(process.argv[4] ?? 15);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 950 });

const bad = [];
page.on("response", (r) => {
  const s = r.status();
  if (s < 400) return;
  bad.push({ status: s, method: r.request().method(), url: r.url() });
});
page.on("requestfailed", (r) =>
  bad.push({ status: "FAILED", method: r.request().method(), url: r.url(), err: r.failure()?.errorText }),
);

console.log(`mode=${mode}  ${url}`);
await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });
await wait(3500);

if (mode === "signin" || mode === "room") {
  // Signing in is what fires the faucet, the first real backend call.
  await typeInto(page, "Display name", "HttpProbe");
  await tap(page, "Use the demo wallet");
  console.log("  signed in, waiting for the faucet grant…");
  await wait(25_000);
}

if (mode === "room") {
  await tap(page, "New Room");
  await wait(2500);
  await typeInto(page, "Room name", `HttpProbe${Math.floor(Math.random() * 900 + 100)}`);
  await tap(page, "Create room");
  console.log("  creating a room, waiting for the market read…");
  for (let i = 0; i < 15; i++) {
    await wait(2000);
    if (/LIVE|No live/.test(await text(page))) break;
  }
}

await wait(secs * 1000);

console.log(`\nnon-2xx / failed responses: ${bad.length}`);
// Group identical failures so a retry loop doesn't bury the distinct ones.
const grouped = new Map();
for (const b of bad) {
  const key = `${b.status} ${b.method} ${b.url}`;
  grouped.set(key, (grouped.get(key) ?? 0) + 1);
}
for (const [key, n] of grouped) {
  const [status, method, ...rest] = key.split(" ");
  console.log(`  ${String(status).padEnd(7)} ${method.padEnd(5)} x${n}  ${rest.join(" ").slice(0, 150)}`);
}

await browser.close();
