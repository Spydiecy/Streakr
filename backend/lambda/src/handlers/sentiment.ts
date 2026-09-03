// sentiment — Lambda Function URL handler. GET ?asset=BTC|ETH
//
// AI Sentiment Assistant (Phase 5): computes a simple momentum signal from
// real BTC/ETH price history and asks an LLM for ONE plain-English sentence.
// Purely informational — never places or suggests a trade size. Falls back
// to a template sentence when LLM_API_KEY is unset.

import { getExchange, getNetwork } from "../chain";
import { jsonResponse, type LambdaHttpEvent, type LambdaHttpResponse } from "../httpTypes";

export interface MomentumSignal {
  asset: "BTC" | "ETH";
  windowsChecked: number;
  upCount: number;
  downCount: number;
  pctChange: number;
}

export async function computeMomentum(asset: "BTC" | "ETH", lookback = 4): Promise<MomentumSignal> {
  const network = getNetwork();
  if (network === "mainnet") {
    throw new Error(
      "computeMomentum: no mainnet price-feed endpoint bundled yet. Set PRICE_FEED_URL to enable this on mainnet.",
    );
  }
  const exchange = getExchange(network);
  // The SDK's price feed only serves "1m" | "1h" | "1d" timeframes (measured:
  // "5m" throws "unknown price timeframe"). 1h candles line up naturally with
  // Streakr's own 1h call windows anyway, so this reads as "the last N
  // windows" rather than an arbitrary sub-window slice.
  const candles: [number, number, number, number, number, number][] = await exchange.fetchPriceOHLCV(
    asset,
    "1h",
    undefined,
    lookback + 1,
  );
  if (!candles || candles.length < 2) {
    throw new Error(`computeMomentum: not enough price candles returned for ${asset}`);
  }
  const CLOSE = 4;
  let upCount = 0;
  let downCount = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i][CLOSE] >= candles[i - 1][CLOSE]) upCount++;
    else downCount++;
  }
  const first = candles[0][CLOSE];
  const last = candles[candles.length - 1][CLOSE];
  const pctChange = ((last - first) / first) * 100;

  return { asset, windowsChecked: candles.length - 1, upCount, downCount, pctChange };
}

function buildPrompt(signal: MomentumSignal): string {
  return (
    `You are a terse crypto market narrator for a casual prediction game. ` +
    `Given this data, write EXACTLY ONE short plain-English sentence (max 20 words) ` +
    `describing recent momentum. No advice, no "should", no emojis, no hedging disclaimers ` +
    `(the app shows its own disclaimer separately).\n\n` +
    `Asset: ${signal.asset}\n` +
    `Of the last ${signal.windowsChecked} windows: ${signal.upCount} closed up, ${signal.downCount} closed down.\n` +
    `Net change over that span: ${signal.pctChange.toFixed(2)}%.\n\n` +
    `Sentence:`
  );
}

function templateSentence(signal: MomentumSignal): string {
  const majority = signal.upCount >= signal.downCount ? "Up" : "Down";
  return `${signal.asset} has closed ${majority} in ${Math.max(signal.upCount, signal.downCount)} of the last ${signal.windowsChecked} windows (${signal.pctChange >= 0 ? "+" : ""}${signal.pctChange.toFixed(2)}% overall).`;
}

export async function getSentimentOneLiner(asset: "BTC" | "ETH"): Promise<{ text: string; source: "llm" | "template" }> {
  const signal = await computeMomentum(asset);
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    return { text: templateSentence(signal), source: "template" };
  }
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.LLM_MODEL ?? "gpt-4o-mini",
        messages: [{ role: "user", content: buildPrompt(signal) }],
        max_tokens: 40,
        temperature: 0.4,
      }),
    });
    if (!res.ok) throw new Error(`LLM call failed: ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("LLM returned no content");
    return { text, source: "llm" };
  } catch (e) {
    console.error("getSentimentOneLiner: LLM call failed, falling back to template:", e);
    return { text: templateSentence(signal), source: "template" };
  }
}

export const handler = async (event: LambdaHttpEvent): Promise<LambdaHttpResponse> => {
  const asset = String(event.queryStringParameters?.asset ?? "BTC").toUpperCase();
  if (asset !== "BTC" && asset !== "ETH") {
    return jsonResponse(400, { error: 'asset must be "BTC" or "ETH"' });
  }
  try {
    const result = await getSentimentOneLiner(asset as "BTC" | "ETH");
    return jsonResponse(200, { asset, text: result.text, source: result.source, label: "AI take, not advice" });
  } catch (e) {
    console.error("sentiment endpoint failed:", e);
    return jsonResponse(502, { error: (e as Error).message });
  }
};
