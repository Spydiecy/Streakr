// sentiment — Lambda Function URL handler. GET ?asset=BTC|ETH
//
// Computes a momentum signal from real BTC/ETH price history, then asks an LLM
// to phrase it as ONE plain sentence. Purely informational — it never places a
// trade, suggests a size, or predicts a direction.
//
// The signal is the substance; the model only does wording. If the LLM is
// unavailable, misconfigured, or slow, a deterministic template renders the same
// numbers and the endpoint still succeeds — so the room card cannot break
// because of a third party.
//
// Provider is Mistral by default (OpenAI-compatible shape); override with
// LLM_BASE_URL / LLM_MODEL.

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
    `Narrate recent crypto momentum for a casual prediction game.\n\n` +
    `Asset: ${signal.asset}\n` +
    `Last ${signal.windowsChecked} one-hour windows: ${signal.upCount} closed up, ` +
    `${signal.downCount} closed down.\n` +
    `Net change across those ${signal.windowsChecked} hours: ${signal.pctChange.toFixed(2)}%.\n\n` +
    `Rules: exactly ONE sentence, 14 words or fewer. Refer to the span as hours — ` +
    `never days or weeks. State only what the data shows. No advice, no ` +
    `prediction, no "should", no emoji, no disclaimer (the app adds its own). ` +
    `Do not use quotation marks.\n\n` +
    `Sentence:`
  );
}

/** Strip anything the model added around the sentence we asked for. */
function tidy(raw: string): string {
  let s = raw.trim().replace(/^["'`]+|["'`]+$/g, "");
  // Models occasionally prefix a label despite the instruction.
  s = s.replace(/^(sentence|answer|output)\s*:\s*/i, "");
  // Keep the first sentence only.
  const m = s.match(/^[^.!?]*[.!?]/);
  if (m) s = m[0];
  return s.trim();
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
    // Mistral's chat completions API is OpenAI-shaped, so the request and
    // response handling are identical; LLM_BASE_URL keeps the provider swappable
    // without touching this code.
    const baseUrl = process.env.LLM_BASE_URL ?? "https://api.mistral.ai/v1/chat/completions";
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.LLM_MODEL ?? "ministral-8b-latest",
        messages: [{ role: "user", content: buildPrompt(signal) }],
        // A single short sentence — capped tight so a chatty model can't turn
        // the card into a paragraph.
        max_tokens: 48,
        temperature: 0.3,
      }),
      // The room screen waits on this; a slow model shouldn't hold up the card.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`LLM call failed: ${res.status} ${(await res.text()).slice(0, 160)}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = tidy(data.choices?.[0]?.message?.content ?? "");
    if (!text) throw new Error("LLM returned no content");
    return { text, source: "llm" };
  } catch (e) {
    // Never fail the endpoint over this — the template says the same thing from
    // the same real data, just less fluently.
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
