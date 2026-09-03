// renderResultCard — Lambda Function URL handler. GET ?cardId=...
//
// Renders a Result Card as SVG rather than a rasterized PNG. The Cloud
// Functions version used @napi-rs/canvas, which ships prebuilt native
// binaries per OS/CPU architecture — exactly the kind of dependency that
// breaks silently in a hand-zipped Lambda upload if the wrong prebuild ends
// up in the zip (Lambda's runtime is Amazon Linux x86_64 or arm64, and a
// canvas package installed on a Mac laptop bundles the Mac binary unless you
// specifically cross-install). SVG is plain text — zero native deps, and it
// still renders as a normal image when shared (every major platform's image
// preview and <img> tag support SVG). Twitter/X's card unfurler in
// particular does render SVG previews fine as of this writing; if a target
// share surface turns out not to, swap this for a PNG rendered by an
// image-conversion Lambda Layer rather than reintroducing a native npm dep.

import { getDb } from "../firebaseAdmin";
import type { ResultCardDoc } from "../types";
import { jsonResponse, type LambdaHttpEvent, type LambdaHttpResponse } from "../httpTypes";

const COLORS = {
  won: { bg: "#0f2f1f", accent: "#22c55e", label: "WON" },
  lost: { bg: "#2f1414", accent: "#ef4444", label: "LOST" },
  void: { bg: "#1f2937", accent: "#94a3b8", label: "VOID" },
} as const;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSvg(card: ResultCardDoc): string {
  const W = 1080;
  const H = 1080;
  const palette = COLORS[card.status as "won" | "lost" | "void"] ?? COLORS.void;
  const payoutLine =
    typeof card.payout === "number" && card.payout > 0
      ? `<text x="60" y="780" fill="#ffffff" font-size="56" font-weight="700" font-family="sans-serif">${card.payout.toFixed(2)} USDso</text>
         <text x="60" y="815" fill="#9ca3af" font-size="28" font-family="sans-serif">payout</text>`
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${palette.bg}" />
  <rect width="${W}" height="16" fill="${palette.accent}" />

  <text x="60" y="110" fill="#ffffff" font-size="48" font-weight="700" font-family="sans-serif">Streakr</text>
  <text x="60" y="150" fill="#9ca3af" font-size="24" font-family="sans-serif">dreamDEX Event Contracts · Somnia</text>

  <text x="60" y="320" fill="#ffffff" font-size="96" font-weight="700" font-family="sans-serif">${esc(card.symbol)} ${esc(card.direction.toUpperCase())}</text>
  <text x="60" y="420" fill="${palette.accent}" font-size="64" font-weight="700" font-family="sans-serif">${palette.label}</text>

  <text x="60" y="620" fill="#ffffff" font-size="140" font-weight="700" font-family="sans-serif">🔥 ${card.streakAfter}</text>
  <text x="60" y="660" fill="#9ca3af" font-size="32" font-family="sans-serif">current streak</text>

  ${payoutLine}

  <text x="60" y="960" fill="#ffffff" font-size="36" font-family="sans-serif">@${esc(card.displayName)}</text>
  <text x="60" y="1010" fill="#6b7280" font-size="22" font-family="sans-serif">Real on-chain call · testnet · not financial advice</text>
</svg>`;
}

export const handler = async (event: LambdaHttpEvent): Promise<LambdaHttpResponse> => {
  const cardId = String(event.queryStringParameters?.cardId ?? "");
  if (!cardId) {
    return jsonResponse(400, { error: "cardId query param required" });
  }
  const db = getDb();
  const snap = await db.collection("resultCards").doc(cardId).get();
  if (!snap.exists) {
    return jsonResponse(404, { error: "not found" });
  }
  const card = snap.data() as ResultCardDoc;
  const svg = buildSvg(card);

  return {
    statusCode: 200,
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=31536000, immutable",
    },
    body: svg,
  };
};
