// First-visit detection for the choice card. Per browser via localStorage:
// the card shows until a choice is made, then never again. Storage can throw
// (sandboxed iframes, blocked site data): then the card never shows, which
// beats showing it on every load.

export const VISITED_KEY = "faultline.visited.v1";

type ReadStorage = Pick<Storage, "getItem"> | null;
type WriteStorage = Pick<Storage, "setItem"> | null;

export function readFirstVisit(storage: ReadStorage): boolean {
  try {
    return storage != null && storage.getItem(VISITED_KEY) == null;
  } catch {
    return false;
  }
}

export function markVisited(storage: WriteStorage): void {
  try {
    storage?.setItem(VISITED_KEY, "1");
  } catch {
    /* storage blocked: nothing to remember */
  }
}

export function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}
