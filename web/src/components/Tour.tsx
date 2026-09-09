import { useEffect } from "react";
import { TOUR_STEPS } from "../content/novice";
import { useInvestigation } from "../state/investigation";

type Props = {
  step: number;
  onStep: (n: number) => void;
  onClose: () => void;
};

// The 30-second tour: one card in the rail per step, and the panel it talks
// about gets an outline through the store's tourTarget. No overlay, so the
// rest of the page stays clickable.
export function Tour({ step, onStep, onClose }: Props) {
  const last = TOUR_STEPS.length - 1;
  const i = Math.max(0, Math.min(last, step));
  const current = TOUR_STEPS[i];

  useEffect(() => {
    useInvestigation.getState().setTourTarget(current.target);
    return () => useInvestigation.getState().setTourTarget(null);
  }, [current.target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isLast = i === last;

  return (
    <section className="tour-card" data-testid="tour-card" aria-label="Tour">
      <span className="eyebrow">
        Tour · step {i + 1} of {TOUR_STEPS.length}
      </span>
      <h3>{current.title}</h3>
      <p>{current.text}</p>
      <div className="tour-actions">
        <button
          type="button"
          className="chip-toggle"
          data-testid="tour-back"
          disabled={i === 0}
          onClick={() => onStep(i - 1)}
        >
          Back
        </button>
        {!isLast && (
          <button type="button" className="primary" data-testid="tour-next" onClick={() => onStep(i + 1)}>
            Next
          </button>
        )}
        <button
          type="button"
          className={isLast ? "primary" : "chip-toggle"}
          data-testid="tour-done"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </section>
  );
}
