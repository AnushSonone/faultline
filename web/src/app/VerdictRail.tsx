import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useInvestigation } from "../state/investigation";
import { Briefing } from "../components/Briefing";
import { InfoTip } from "../components/InfoTip";
import { NowStrip } from "../components/NowStrip";
import { Tour } from "../components/Tour";
import { evidenceWord, explainCandidate, ordinal } from "../lib/explain";

const MAX_ROWS = 6;

// The verdict column beside the map: who is ranked first, the whole ranking
// as live bars, and the narration of what the replay cursor just passed.
export function VerdictRail({ booting, incidentId }: { booting: boolean; incidentId: string }) {
  const rootCauses = useInvestigation((s) => s.rootCauses);
  const sessionId = useInvestigation((s) => s.sessionId);
  const replayState = useInvestigation((s) => s.replay.state);
  // The briefing shows until the first Play of a session (transport or its
  // own button) and can be brought back with the chip.
  const [briefingOpen, setBriefingOpen] = useState(true);
  // The tour replaces the lower block while it runs; null = not running.
  const [tourStep, setTourStep] = useState<number | null>(null);
  const tourTarget = useInvestigation((s) => s.tourTarget);
  useEffect(() => {
    setBriefingOpen(true);
    setTourStep(null);
  }, [sessionId]);
  useEffect(() => {
    if (replayState === "playing") setBriefingOpen(false);
  }, [replayState]);
  const selectedService = useInvestigation((s) => s.selectedService);
  const hoveredService = useInvestigation((s) => s.hoveredService);
  const selectService = useInvestigation((s) => s.selectService);
  const hoverService = useInvestigation((s) => s.hoverService);
  const setTab = useInvestigation((s) => s.setTab);

  const hasVerdict = rootCauses != null && rootCauses.incident_onset_ns != null;
  const candidates = hasVerdict ? rootCauses!.candidates.slice(0, MAX_ROWS) : [];
  const top = candidates[0] ?? null;

  return (
    <aside className={tourTarget === "verdict" ? "panel rail tour-target" : "panel rail"} data-testid="verdict-rail">
      <div className="verdict-hero" data-testid="verdict-hero">
        {top ? (
          <>
            <span className="eyebrow rail-eyebrow">
              Most likely culprit{" "}
              <InfoTip>
                The score is a weighted sum of nine evidence features, between 0 and 1. It is a
                ranking signal, not a probability that this service is guilty.
              </InfoTip>
              <span className="term">likely root cause</span>
              {!briefingOpen && (
                <>
                  <button
                    type="button"
                    className="chip-toggle rail-chip"
                    data-testid="briefing-open"
                    onClick={() => setBriefingOpen(true)}
                  >
                    Briefing
                  </button>
                  <button
                    type="button"
                    className="chip-toggle rail-chip"
                    data-testid="tour-open"
                    onClick={() => setTourStep(0)}
                  >
                    Tour
                  </button>
                </>
              )}
            </span>
            <div className="verdict-line">
              <span className="verdict-service">{top.service}</span>
              <span className="verdict-score mono">
                Evidence: {evidenceWord(top.score)} ({top.score.toFixed(2)} of 1)
              </span>
            </div>
            {!briefingOpen && tourStep == null && (
              <p className="verdict-why" data-testid="verdict-why">
                {explainCandidate(top)}
              </p>
            )}
          </>
        ) : (
          <>
            <span className="eyebrow rail-eyebrow">
              Faultline
              {!briefingOpen && (
                <>
                  <button
                    type="button"
                    className="chip-toggle rail-chip"
                    data-testid="briefing-open"
                    onClick={() => setBriefingOpen(true)}
                  >
                    Briefing
                  </button>
                  <button
                    type="button"
                    className="chip-toggle rail-chip"
                    data-testid="tour-open"
                    onClick={() => setTourStep(0)}
                  >
                    Tour
                  </button>
                </>
              )}
            </span>
            <p className="verdict-caption">
              {booting
                ? "Connecting to the replay engine…"
                : "No verdict yet. Evidence accumulates as the replay passes the incident onset."}
            </p>
          </>
        )}
      </div>

      {candidates.length > 0 && !briefingOpen && tourStep == null && (
        <div className="rank-head" aria-hidden="true">
          <span>suspects, strongest evidence first</span>
        </div>
      )}
      {candidates.length > 0 && !briefingOpen && tourStep == null && (
        <ol className="rank-list" data-testid="rank-list">
          <AnimatePresence initial={false}>
            {candidates.map((c) => {
              const width = Math.max(0, Math.min(1, c.score)) * 100;
              const cls = [
                "rank-row",
                selectedService === c.service ? "selected" : "",
                hoveredService === c.service ? "hovered" : "",
                c.score <= 0 ? "zero" : "",
              ]
                .join(" ")
                .trim();
              return (
                <motion.li
                  key={c.service}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                  className={cls}
                  data-testid={`rank-${c.service}`}
                  onMouseEnter={() => hoverService(c.service)}
                  onMouseLeave={() => hoverService(null)}
                  onClick={() => selectService(selectedService === c.service ? null : c.service)}
                >
                  <span className="rank-n mono">{ordinal(c.rank)}</span>
                  <span className="rank-service">{c.service}</span>
                  <span className="rank-bar">
                    <span className="rank-fill" style={{ width: `${width}%` }} />
                  </span>
                  <span className="rank-score" title={`score ${c.score.toFixed(2)} of 1`}>
                    {evidenceWord(c.score)}
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}

      {tourStep != null ? (
        <Tour step={tourStep} onStep={setTourStep} onClose={() => setTourStep(null)} />
      ) : briefingOpen ? (
        <Briefing
          incidentId={incidentId}
          onClose={() => setBriefingOpen(false)}
          onTour={() => {
            setBriefingOpen(false);
            setTourStep(0);
          }}
        />
      ) : (
        <div className="now-block">
          <NowStrip />
        </div>
      )}

      <p className="rail-caption">
        {briefingOpen ? (
          "Press Play the replay to watch the incident from the start."
        ) : hasVerdict ? (
          <>
            Press Play to watch the incident from the start. Open{" "}
            <button type="button" className="link-button" onClick={() => setTab("root-causes")}>
              Why?
            </button>{" "}
            for the numbers.
          </>
        ) : (
          <>
            Play advances event time; every panel follows the cursor.
          </>
        )}
      </p>
    </aside>
  );
}
