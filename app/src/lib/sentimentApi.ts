// Calls the `streakr-sentiment` AWS Lambda (backend/lambda/src/handlers/sentiment.ts)
// via its Function URL. Each Lambda Function URL is its own standalone
// endpoint (unlike Cloud Functions, which group under one Functions base URL
// with /<name> paths appended) — set EXPO_PUBLIC_SENTIMENT_URL to that
// function's Function URL directly (see backend/lambda/DEPLOY.md step 6).

import type { Symbol_ } from "./types";

function sentimentUrl(): string | undefined {
  return process.env.EXPO_PUBLIC_SENTIMENT_URL;
}

export interface SentimentResponse {
  asset: Symbol_;
  text: string;
  source: "llm" | "template";
  label: string;
}

export async function fetchSentiment(asset: Symbol_): Promise<SentimentResponse | null> {
  const base = sentimentUrl();
  if (!base) return null; // not configured — Room screen just hides the card
  const url = base.endsWith("/") ? `${base}?asset=${asset}` : `${base}/?asset=${asset}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sentiment fetch failed: ${res.status}`);
  return (await res.json()) as SentimentResponse;
}
