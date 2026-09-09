// A single place to notice that Firestore isn't reachable, so the app can say so
// once instead of failing quietly in a dozen places.
//
// The motivating case: an ad/privacy blocker blocking firestore.googleapis.com.
// The Firestore SDK treats that exactly like being offline — it parks writes in
// its local queue and retries forever — so from the app's side nothing throws in
// an obvious way, while the browser console fills with
// `net::ERR_BLOCKED_BY_CLIENT` and the user just sees things not working.
//
// Rather than probing with an extra request (which a blocker would also block,
// adding more console noise for no new information), call sites that already
// catch a Firestore error report it here. The classification lives in errors.ts,
// so "is this a connectivity problem" is decided in one place.

import { friendlyError } from "./errors";

type Listener = (blocked: boolean) => void;

const listeners = new Set<Listener>();
let blocked = false;

/** Whether we currently believe Firestore is unreachable. */
export function isFirestoreBlocked(): boolean {
  return blocked;
}

function set(next: boolean) {
  if (blocked === next) return;
  blocked = next;
  listeners.forEach((l) => l(next));
}

/**
 * Report a caught Firestore error. Only connectivity-shaped failures flip the
 * flag — a permission-denied or a bad query is a bug in the app, not something
 * the user can fix by disabling an extension, and shouldn't show the banner.
 */
export function reportFirestoreError(e: unknown): void {
  const kind = friendlyError(e).kind;
  if (kind === "blocked-by-extension" || kind === "offline" || kind === "timeout") set(true);
}

/** Report that a Firestore operation succeeded, which clears the flag. */
export function reportFirestoreOk(): void {
  set(false);
}

export function subscribeFirestoreHealth(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
