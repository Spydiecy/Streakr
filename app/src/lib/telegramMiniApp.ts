// Running inside a Telegram Mini App, or in a normal browser?
//
// A leaf module: no React, no SDK, no react-native imports, so it can be read by
// anything (including the onboarding screen and the link helper) without dragging
// dependencies along, and it degrades to "not Telegram" everywhere else — native
// builds included.
//
// Telegram Mini Apps are just an HTTPS page rendered in Telegram's WebView, so the
// same deployed URL serves both surfaces. Two things differ enough to matter:
//
//  1. There is no browser extension in that WebView, so an injected-wallet
//     connector can never succeed. Offering it is a dead end.
//  2. Navigation out of the app has to go through Telegram's own API, or a link
//     either does nothing or strands the user outside the chat.

/** The slice of Telegram's WebApp API this app actually uses. */
interface TelegramWebApp {
  initData?: string;
  version?: string;
  platform?: string;
  colorScheme?: "light" | "dark";
  viewportHeight?: number;
  ready?: () => void;
  expand?: () => void;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  enableClosingConfirmation?: () => void;
}

function webApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const tg = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  return tg ?? null;
}

/**
 * Is this actually a Telegram Mini App?
 *
 * `window.Telegram.WebApp` alone is not enough — the injected script defines it on
 * any page that loads it, including a normal browser tab. `platform` is "unknown"
 * outside Telegram, and real launches carry `initData`. Requiring one of those
 * avoids treating a plain web visit as a Mini App and hiding the wallet button
 * from someone who has MetaMask.
 */
export function isTelegramMiniApp(): boolean {
  const tg = webApp();
  if (!tg) return false;
  const platform = tg.platform ?? "unknown";
  return platform !== "unknown" || !!tg.initData;
}

/**
 * Tell Telegram the app has rendered, and take the full sheet height.
 *
 * Without `expand()` a Mini App opens as a short sheet covering roughly half the
 * screen, which puts the call buttons below the fold. Safe to call repeatedly and
 * a no-op outside Telegram.
 */
export function initTelegramMiniApp(): void {
  const tg = webApp();
  if (!tg || !isTelegramMiniApp()) return;
  try {
    tg.ready?.();
    tg.expand?.();
    // Match the app's own chrome so the Telegram header doesn't sit on a
    // different background than the screen beneath it.
    tg.setHeaderColor?.("#0a0b0c");
    tg.setBackgroundColor?.("#0a0b0c");
  } catch {
    // A Mini App must never fail to start because a cosmetic API is missing on an
    // older Telegram client.
  }
}

/**
 * Open an external URL from wherever the app is running.
 *
 * Inside the Telegram WebView, `window.open` and `Linking.openURL` are unreliable
 * — a blocked popup means the "View on-chain transaction" link silently does
 * nothing, which is the one link that proves a call was real. `openLink` hands the
 * URL to Telegram, which opens its own browser over the chat.
 *
 * Returns false when it didn't handle it, so the caller can fall back.
 */
export function openExternal(url: string): boolean {
  const tg = webApp();
  if (tg && isTelegramMiniApp() && tg.openLink) {
    try {
      tg.openLink(url);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** For diagnostics and the browser checks. */
export function telegramContext(): { inTelegram: boolean; platform: string | null; version: string | null } {
  const tg = webApp();
  return {
    inTelegram: isTelegramMiniApp(),
    platform: tg?.platform ?? null,
    version: tg?.version ?? null,
  };
}
