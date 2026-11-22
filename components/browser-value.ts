"use client";

// A value only the browser knows — its zone, its address, whether this is
// the browser at all — read the way React means it to be read: the server's
// answer while the server renders and while the page hydrates, so the HTML
// and the first client render agree, and the browser's own answer from then
// on. It replaces `useState` + `useEffect(() => setX(...), [])`, which drew
// the same thing one render later.

import { useSyncExternalStore } from "react";

// Nothing here changes while the page is open, so there is nothing to
// listen to: React reads the value again on each render.
const nothingToWatch = () => () => {};

/** `read()` in the browser after hydration, `server` before. `read` must
 *  return the same value for the same state (a string, a number, a boolean). */
export function useBrowserValue<T>(read: () => T, server: T): T {
  return useSyncExternalStore(nothingToWatch, read, () => server);
}

/** False on the server and while the page hydrates, true after. */
export function useHydrated(): boolean {
  return useBrowserValue(() => true, false);
}
