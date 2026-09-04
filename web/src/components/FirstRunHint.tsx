import { useState } from "react";

const KEY = "faultline-hint-dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return true; // storage unavailable: never show rather than show forever
  }
}

// Dismissible in-flow strip (never an overlay, so it cannot intercept clicks)
// shown once to first-time visitors, directly under the app chrome.
export function FirstRunHint() {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;
  return (
    <div className="first-run-hint" data-testid="first-run-hint">
      <p>
        New here? The verdict below is already computed. Press <strong>Play</strong> to
        rewind the incident and watch it unfold, then scroll down for the evidence.
      </p>
      <button
        type="button"
        className="chip-toggle"
        onClick={() => {
          try {
            window.localStorage.setItem(KEY, "1");
          } catch {
            /* best effort */
          }
          setDismissed(true);
        }}
      >
        Got it
      </button>
    </div>
  );
}
