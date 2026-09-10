import { useEffect, useRef } from "react";
import { markVisited, safeStorage } from "../lib/firstVisit";
import { useInvestigation } from "../state/investigation";

// The first-visit choice: take the walkthrough, or investigate alone. Shown
// once per browser (see lib/firstVisit.ts); the transport bar keeps a
// permanent Walkthrough button for everyone else. Rendered as a shell child
// beside the walkthrough overlay, centred over the whole embed and styled as
// one of its callouts; every sibling is inert while it shows.
export function FirstVisit() {
  const firstVisit = useInvestigation((s) => s.firstVisit);
  const walkStep = useInvestigation((s) => s.walkStep);
  const setFirstVisit = useInvestigation((s) => s.setFirstVisit);
  const setBriefOpen = useInvestigation((s) => s.setBriefOpen);
  const setWalkStep = useInvestigation((s) => s.setWalkStep);
  const ref = useRef<HTMLDivElement>(null);
  const shown = firstVisit && walkStep == null;

  const investigate = () => {
    markVisited(safeStorage());
    setFirstVisit(false);
  };
  const tour = () => {
    markVisited(safeStorage());
    setFirstVisit(false);
    setBriefOpen(false);
    setWalkStep(0);
  };

  // Siblings under the card are inert while it shows: keyboard focus cannot
  // land under the scrim and the layout sweep sees only the card.
  useEffect(() => {
    if (!shown) return;
    const shell = ref.current?.parentElement;
    if (!shell) return;
    const siblings = Array.from(shell.children).filter((el) => el !== ref.current);
    for (const el of siblings) {
      el.setAttribute("aria-hidden", "true");
      el.setAttribute("inert", "");
    }
    ref.current?.querySelector<HTMLButtonElement>("button.primary")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        investigate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      for (const el of siblings) {
        el.removeAttribute("aria-hidden");
        el.removeAttribute("inert");
      }
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  if (!shown) return null;

  return (
    <div className="first-visit" ref={ref} data-testid="first-visit" role="dialog" aria-modal="true" aria-labelledby="first-visit-title">
      <div className="callout-card first-visit-card">
        <div className="walk-head">
          <span className="eyebrow">Faultline</span>
          <h3 id="first-visit-title">How do you want to start?</h3>
        </div>
        <p>A recorded incident is loaded at its start; nothing is ranked yet.</p>
        <div className="walk-actions">
          <button type="button" className="chip-toggle" data-testid="first-visit-investigate" onClick={investigate}>
            Investigate on my own
          </button>
          <button type="button" className="primary" data-testid="first-visit-tour" onClick={tour}>
            Take the walkthrough
          </button>
        </div>
      </div>
    </div>
  );
}
