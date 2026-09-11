import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { reset, seek } from "../api/client";
import { WALK_STEPS } from "../content/novice";
import { placeCallout, type Rect } from "../lib/callout";
import { useInvestigation } from "../state/investigation";

const PAD = 6;
const CARD_FALLBACK = { width: 340, height: 150 };

// The spotlight walkthrough. One scrim over the whole embed, a cutout on the
// current region (measured from its `data-walk` attribute), and a callout
// card anchored to the cutout with a pointer. Siblings of the overlay are
// made inert and aria-hidden while it runs, so the card is the only live UI.
// Steps that need evidence seek the replay to the end once; closing the tour
// resets it, so the visitor leaves on the same nominal start they came from.
export function Walkthrough() {
  const step = useInvestigation((s) => s.walkStep);
  const setWalkStep = useInvestigation((s) => s.setWalkStep);
  const setTab = useInvestigation((s) => s.setTab);
  const setRuntimeTab = useInvestigation((s) => s.setRuntimeTab);
  const setTourTarget = useInvestigation((s) => s.setTourTarget);
  const setBriefOpen = useInvestigation((s) => s.setBriefOpen);
  const muteProgress = useInvestigation((s) => s.muteProgress);
  const sessionId = useInvestigation((s) => s.sessionId);
  const cursor = useInvestigation((s) => s.selectedEventTime);
  const endNs = useInvestigation((s) => s.incidentEndNs);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const seekedRef = useRef(false);
  // False until the first measured placement has been painted, so that
  // placement snaps into position and only later step changes glide.
  const settledRef = useRef(false);
  const [spot, setSpot] = useState<Rect | null>(null);
  const [shellSize, setShellSize] = useState({ width: 0, height: 0 });
  const [cardSize, setCardSize] = useState(CARD_FALLBACK);
  const [placed, setPlaced] = useState(false);

  const active = step != null;
  const last = WALK_STEPS.length - 1;
  const i = step == null ? 0 : Math.max(0, Math.min(last, step));
  const current = WALK_STEPS[i];

  const close = useCallback(() => {
    // Order matters: the brief closes and the tab resets while the tour is
    // still active so neither latches a checklist row; the mute then covers
    // the ticks between here and the reset landing.
    setBriefOpen(false);
    setTab("overview");
    if (seekedRef.current && sessionId) {
      seekedRef.current = false;
      muteProgress();
      void reset(sessionId);
    }
    setWalkStep(null);
  }, [setWalkStep, setTab, setBriefOpen, muteProgress, sessionId]);

  // Open the tab the step talks about (or return to the stage), and mirror
  // the target into the store for the panel outlines.
  useEffect(() => {
    if (!active) return;
    setTab(current.tab ?? "overview");
    if (current.runtimeTab) setRuntimeTab(current.runtimeTab);
    setTourTarget(current.target);
  }, [active, current, setTab, setRuntimeTab, setTourTarget]);

  // Evidence steps need the ranking; seek to the end once.
  useEffect(() => {
    if (!active || !current.needsEvidence || seekedRef.current) return;
    if (!sessionId || endNs == null) return;
    if (cursor != null && cursor >= endNs) return;
    seekedRef.current = true;
    void seek(sessionId, endNs);
  }, [active, current, sessionId, endNs, cursor]);

  useEffect(() => {
    if (active) return;
    setTourTarget(null);
    settledRef.current = false;
  }, [active, setTourTarget]);

  useEffect(() => {
    if (placed) settledRef.current = true;
  }, [placed, i]);

  // Everything but the overlay is inert while the walkthrough runs.
  useEffect(() => {
    if (!active) return;
    const shell = overlayRef.current?.parentElement;
    if (!shell) return;
    const siblings = Array.from(shell.children).filter((el) => el !== overlayRef.current);
    for (const el of siblings) {
      el.setAttribute("aria-hidden", "true");
      el.setAttribute("inert", "");
    }
    return () => {
      for (const el of siblings) {
        el.removeAttribute("aria-hidden");
        el.removeAttribute("inert");
      }
    };
  }, [active]);

  // Measure the target relative to the shell; re-measure on anything that
  // can move it (resize, fullscreen, internal scroll, framer layout springs).
  useLayoutEffect(() => {
    if (!active) return;
    const shell = overlayRef.current?.parentElement;
    if (!shell) return;
    let raf = 0;
    const id = current.tab ? "drawer" : current.target;
    const find = () => (id ? shell.querySelector<HTMLElement>(`[data-walk="${id}"]`) : null);
    const measure = () => {
      raf = 0;
      const s = shell.getBoundingClientRect();
      setShellSize({ width: s.width, height: s.height });
      const el = find();
      if (!el) {
        setSpot(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setSpot({
        left: r.left - s.left - PAD,
        top: r.top - s.top - PAD,
        width: r.width + PAD * 2,
        height: r.height + PAD * 2,
      });
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(measure);
    };
    measure();
    const late = window.setTimeout(measure, 500);
    const ro = new ResizeObserver(schedule);
    ro.observe(shell);
    const target = find();
    if (target) ro.observe(target);
    window.addEventListener("resize", schedule);
    document.addEventListener("fullscreenchange", schedule);
    shell.addEventListener("scroll", schedule, true);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(late);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("fullscreenchange", schedule);
      shell.removeEventListener("scroll", schedule, true);
    };
  }, [active, current, i]);

  // The card's own size feeds the placement. It stays hidden until both
  // measurements land, so the guessed position is never painted, and that
  // first placement is applied with no transition.
  useLayoutEffect(() => {
    if (!active) {
      setPlaced(false);
      return;
    }
    const el = cardRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setCardSize({ width: r.width, height: r.height });
    };
    read();
    // Opening the walkthrough closes the brief and inerts the stage, so the
    // shell relayouts in the same frame. Read again on the next one and only
    // then reveal, or the card paints once at the pre-relayout centre.
    const raf = requestAnimationFrame(() => {
      read();
      setPlaced(true);
    });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [active, i]);

  useEffect(() => {
    if (!active) return;
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          close();
          break;
        case "ArrowRight":
        case "Enter":
          e.preventDefault();
          if (i < last) setWalkStep(i + 1);
          else close();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (i > 0) setWalkStep(i - 1);
          break;
        case "Home":
          e.preventDefault();
          setWalkStep(0);
          break;
        case "End":
          e.preventDefault();
          setWalkStep(last);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, i, last, close, setWalkStep]);

  if (!active) return null;

  const isLast = i === last;
  const place = placeCallout(spot, cardSize, shellSize.width > 0 ? shellSize : { width: 1200, height: 700 });
  const pointerStyle =
    place.side === "below" || place.side === "above" ? { left: place.pointer } : { top: place.pointer };

  return (
    <div className="walk-overlay" ref={overlayRef} data-testid="walkthrough">
      <motion.div
        className="walk-spot"
        aria-hidden="true"
        initial={false}
        animate={
          spot
            ? { left: spot.left, top: spot.top, width: spot.width, height: spot.height, opacity: 1 }
            : { opacity: 1, left: -PAD, top: -PAD, width: 0, height: 0 }
        }
        transition={{ duration: 0.24, ease: [0.2, 0.8, 0.3, 1] }}
      />
      <motion.div
        className={`callout-card walk-card ${place.side}`}
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="walk-title"
        tabIndex={-1}
        data-testid="tour-card"
        data-side={place.side}
        initial={false}
        style={{ visibility: placed ? "visible" : "hidden" }}
        animate={{ left: place.left, top: place.top }}
        transition={{ duration: settledRef.current ? 0.24 : 0, ease: [0.2, 0.8, 0.3, 1] }}
      >
        {place.side !== "center" && <span className="walk-pointer" style={pointerStyle} aria-hidden="true" />}
        <div className="walk-head">
          <span className="eyebrow">
            Walkthrough · step {i + 1} of {WALK_STEPS.length}
          </span>
          <h3 id="walk-title">{current.title}</h3>
        </div>
        <p>{current.text}</p>
        <div className="walk-actions">
          <button
            type="button"
            className="chip-toggle"
            data-testid="tour-back"
            disabled={i === 0}
            onClick={() => setWalkStep(i - 1)}
          >
            Back
          </button>
          <button
            type="button"
            className={isLast ? "primary" : "chip-toggle"}
            data-testid="tour-done"
            onClick={close}
          >
            {isLast ? "Done" : "Skip"}
          </button>
          {!isLast && (
            <button type="button" className="primary" data-testid="tour-next" onClick={() => setWalkStep(i + 1)}>
              Next
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
