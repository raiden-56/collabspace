import { useSyncExternalStore } from "react";

/**
 * Guest mode: a frontend-only session that signs in as the demo user and answers every API request
 * in the browser from sample data (see ./mock-api.ts). Enabled at build time with
 * NEXT_PUBLIC_GUEST_MODE=true (the GitHub Pages build has no backend); when the flag is off nothing
 * here is active and the app behaves exactly as without it.
 *
 * The session lives in sessionStorage, so it survives reloads in the same tab and ends with it.
 * A non-HttpOnly marker cookie lets the server-side route guard (proxy.ts) admit guests when the
 * app runs with a Node server.
 */

export const GUEST_MODE_ENABLED = process.env.NEXT_PUBLIC_GUEST_MODE === "true";

const STORAGE_KEY = "collabspace:guest-session";
export const GUEST_COOKIE = "cs_guest";

const listeners = new Set<() => void>();

export function isGuestSession(): boolean {
  if (!GUEST_MODE_ENABLED || typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setCookie(value: string | null) {
  document.cookie = value === null ? `${GUEST_COOKIE}=; path=/; max-age=0; samesite=lax` : `${GUEST_COOKIE}=${value}; path=/; samesite=lax`;
}

export function startGuestSession() {
  if (!GUEST_MODE_ENABLED) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* storage blocked: the session still works until the next reload */
  }
  setCookie("1");
  for (const l of listeners) l();
}

export function endGuestSession() {
  if (!GUEST_MODE_ENABLED || typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  setCookie(null);
  // Drop the in-memory sample data so the next guest session starts fresh.
  void import("./mock-api").then((m) => m.resetGuestData());
  void import("./collab").then((m) => m.resetGuestCollab());
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Reactive guest flag; false during prerendering/hydration so the static HTML matches. */
export function useGuestSession(): boolean {
  return useSyncExternalStore(subscribe, isGuestSession, () => false);
}
