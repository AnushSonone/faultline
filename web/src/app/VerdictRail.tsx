import { AnimatePresence, motion } from "framer-motion";
import { useInvestigation } from "../state/investigation";
import { Briefing } from "../components/Briefing";
import { Checklist } from "../components/Checklist";
import { NowStrip } from "../components/NowStrip";
import { scoreBand, explainCandidate, ordinal } from "../lib/explain";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useState } from "react";

const MAX_ROWS = 6;

// The verdict column beside the map: who is ranked first, the whole ranking
// as live bars, the investigation checklist, and either the case brief or
// the evidence timeline up to the replay cursor.
export function VerdictRail({ booting, incidentId }: { booting: boolean; incidentId: string }) {
  const rootCauses = useInvestigation((s) => s.rootCauses);
  // The case brief shows until the first Play (the store closes it on
  // "playing") and can be brought back with the chip.
  const briefOpen = useInvestigation((s) => s.briefOpen);
  const setBriefOpen = useInvestigation((s) => s.setBriefOpen);
  const tourTarget = useInvestigation((s) => s.tourTarget);
  const setWalkStep = useInvestigation((s) => s.setWalkStep);
  const selectedService = useInvestigation((s) => s.selectedService);
  const hoveredService = useInvestigation((s) => s.hoveredService);
  const selectService = useInvestigation((s) => s.selectService);
  const hoverService = useInvestigation((s) => s.hoverService);
  const setTab = useInvestigation((s) => s.setTab);

  const hasVerdict = rootCauses != null && rootCauses.incident_onset_ns != null;
  // Short rails fold the checklist to one line; expanding it takes the
  // timeline's slot so nothing is ever cut in half.
  const shortRail = useMediaQuery("(max-height: 820px)");
  const [checkExpanded, setCheckExpanded] = useState(false);
  const checkCompact = (hasVerdict && !briefOpen) || shortRail;
  const showChecklistRows = checkCompact && checkExpanded;
  const candidates = hasVerdict ? rootCauses!.candidates.slice(0, MAX_ROWS) : [];
  const top = candidates[0] ?? null;

  const briefChip = !briefOpen && (
    <button
      type="button"
      className="chip-toggle rail-chip"
      data-testid="briefing-open"
      onClick={() => setBriefOpen(true)}
    >
      Case brief
    </button>
  );

  return (
    <aside className={tourTarget === "verdict" ? "panel rail tour-target" : "panel rail"} data-testid="verdict-rail">
      <div className="verdict-hero" data-testid="verdict-hero" data-walk="verdict">
        {top ? (
          <>
            <span className="eyebrow rail-eyebrow">
              Top root-cause candidate
              {briefChip}
            </span>
            <div className="verdict-line">
              <span className="verdict-service">{top.service}</span>
              <span className="verdict-score mono">
                score {top.score.toFixed(2)} · {scoreBand(top.score)} evidence
              </span>
            </div>
            {!briefOpen && (
              <p className="verdict-why" data-testid="verdict-why">
                {explainCandidate(top)}
              </p>
            )}
          </>
        ) : (
          <>
            <span className="eyebrow rail-eyebrow">
              Top root-cause candidate
              {briefChip}
            </span>
            <p className="verdict-caption">
              {booting
                ? "Connecting to the replay engine…"
                : "Nothing is ranked yet; candidates appear when the replay cursor passes the incident onset."}
            </p>
          </>
        )}
      </div>

      {candidates.length > 0 && !briefOpen && (
        <div className="rank-head" aria-hidden="true">
          <span>candidates by evidence score</span>
        </div>
      )}
      {candidates.length > 0 && !briefOpen && (
        <ol className="rank-list" data-testid="rank-list" data-walk="ranking">
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
                  <span className="rank-score mono" title={`${scoreBand(c.score)} evidence`}>
                    {c.score.toFixed(2)}
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}

      <Checklist compact={checkCompact} expanded={checkExpanded} onExpandedChange={setCheckExpanded} />

      {showChecklistRows ? null : briefOpen ? (
        <Briefing
          incidentId={incidentId}
          onClose={() => setBriefOpen(false, { read: true })}
          onTour={() => {
            setBriefOpen(false);
            setWalkStep(0);
          }}
        />
      ) : (
        <div className="now-block" data-walk="feed">
          <NowStrip />
        </div>
      )}

      <p className="rail-caption">
        {briefOpen ? (
          "Press Run replay to stream the incident from the start."
        ) : hasVerdict ? (
          <>
            Open{" "}
            <button type="button" className="link-button" onClick={() => setTab("root-causes")}>
              Ranking
            </button>{" "}
            for the score decomposition.
          </>
        ) : (
          <>Play advances event time; every panel follows the cursor.</>
        )}
      </p>
    </aside>
  );
}
