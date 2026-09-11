import { useMemo } from "react";
import { play } from "../api/client";
import { SCENARIOS, SHORT_SOURCE, THE_INPUTS, THE_QUESTION } from "../content/scenarios";
import { useInvestigation } from "../state/investigation";
import { CaseSection } from "./CaseSection";
import { CaseSchematic } from "./CaseSchematic";
import { SignalTotals } from "./SignalTotals";
import { RecordingTimeline } from "../views/CaseFile/RecordingTimeline";
import { fmtWindowS } from "../lib/format";

type Props = {
  incidentId: string;
  onClose: () => void;
  onTour: () => void;
};

// The case brief in the rail, opened from the Case brief chip. It follows the
// Case file tab's section order in a shorter form: the incident, the question,
// how it propagates, the fault record, what was recorded, and the method
// folded away.
//
// A fixed head, a scrolling body and a pinned action row: the rail is 260 to
// 480 px wide, so the card is a document, and making the card itself the
// scroller once put Run replay below the fold.
export function Briefing({ incidentId, onClose, onTour }: Props) {
  const sessionId = useInvestigation((s) => s.sessionId);
  const caseInfo = useInvestigation((s) => s.caseInfo);
  const startNs = useInvestigation((s) => s.incidentStartNs);
  const endNs = useInvestigation((s) => s.incidentEndNs);
  const cursorNs = useInvestigation((s) => s.selectedEventTime);
  const correlations = useInvestigation((s) => s.correlations);
  const scenario = SCENARIOS[incidentId];
  const headline = scenario?.headline ?? incidentId;

  // The deploy tick: from the correlation payload once it exists, otherwise
  // from the fixture's own schematic. RCAEval cases have neither.
  const origin = scenario?.schematic.origin ?? null;
  const deployNs = useMemo(() => {
    const fromCorr =
      correlations.find((c) => c.service === origin)?.deployed_at_ns ?? correlations[0]?.deployed_at_ns;
    if (fromCorr != null) return fromCorr;
    if (scenario?.schematic.deploy && startNs != null) {
      return startNs + scenario.schematic.deploy.atS * 1e9;
    }
    return null;
  }, [correlations, origin, scenario, startNs]);

  // One muted line of facts under the headline, in place of coloured pills.
  const meta = useMemo(
    () =>
      [
        scenario?.brief.fault.split(",")[0],
        startNs != null && endNs != null ? `${fmtWindowS((endNs - startNs) / 1e9)} recorded` : null,
        scenario ? SHORT_SOURCE[scenario.source] : null,
      ]
        .filter(Boolean)
        .join(" · "),
    [scenario, startNs, endNs],
  );

  const counts = caseInfo?.event_counts ?? null;

  return (
    <section className="briefing" data-testid="briefing" aria-label="Case brief">
      <header className="briefing-head">
        {meta && <p className="case-meta">{meta}</p>}
        <h3 className="briefing-title" title={headline}>
          {headline}
        </h3>
      </header>

      {/* Only this scrolls. Keyed on the incident so switching cases starts at
          the top instead of inheriting the previous scroll offset. */}
      <div className="briefing-body case-doc" key={incidentId}>
        {/* Both sentences stay inside case-summary: briefing.spec reads
            "Online Boutique" and "checkout slows" out of it. */}
        {scenario && (
          <CaseSection title="The incident" testId="case-summary">
            <p>{scenario.caseSummary.symptom}</p>
            <p className="case-system">{scenario.caseSummary.system}</p>
          </CaseSection>
        )}

        {scenario && (
          <CaseSection title="The question">
            <p>
              {THE_QUESTION} {THE_INPUTS}
            </p>
          </CaseSection>
        )}

        {scenario && (
          <CaseSection title="How it propagates" className="case-propagation">
            <CaseSchematic schematic={scenario.schematic} />
          </CaseSection>
        )}

        {scenario && (
          <CaseSection title="Fault record">
            <dl className="case-kv">
              <dt>Fault</dt>
              <dd>{scenario.brief.fault}</dd>
              <dt>Change event</dt>
              <dd>{scenario.brief.changeEvent}</dd>
            </dl>
          </CaseSection>
        )}

        <CaseSection title="What was recorded">
          {counts ? (
            <SignalTotals eventCounts={counts} />
          ) : (
            <p>{scenario?.brief.signals ?? "Signal totals load with the session."}</p>
          )}
          {startNs != null && endNs != null && (
            <div className="dossier-block">
              <RecordingTimeline
                startNs={startNs}
                endNs={endNs}
                faultStartNs={caseInfo?.fault_start_time_ns ?? null}
                faultEndNs={caseInfo?.fault_end_time_ns ?? null}
                deployNs={deployNs}
                cursorNs={cursorNs}
              />
            </div>
          )}
        </CaseSection>

        {/* The method last, and folded. The sweep skips closed-details
            subtrees and toContainText still reads their text, so the spec's
            "Features to watch" and "nine-feature ranker" checks hold. */}
        {scenario && (
          <details className="case-fold" data-testid="briefing-blurb">
            <summary>Method and features to watch</summary>
            <div className="case-doc">
              <CaseSection title="Method">
                <p>
                  <strong>What happened.</strong> {scenario.whatHappened}
                </p>
                <p>
                  <strong>What we evaluate.</strong> {scenario.whatWeEvaluate}
                </p>
                <p>
                  <strong>What to watch.</strong> {scenario.whatToWatch}
                </p>
                {scenario.caveat && (
                  <p>
                    <strong>Caveat.</strong> {scenario.caveat}
                  </p>
                )}
              </CaseSection>
              <CaseSection title="Features to watch">
                <ul className="briefing-watch">
                  {scenario.watch.map((line) => {
                    const m = /^([a-z_]+(?: and [a-z_]+)?):\s*(.*)$/.exec(line);
                    return (
                      <li key={line}>
                        {m ? (
                          <>
                            <code>{m[1]}</code> {m[2]}
                          </>
                        ) : (
                          line
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CaseSection>
            </div>
          </details>
        )}
      </div>

      {/* Pinned: the primary action is never below the fold. */}
      <div className="briefing-actions">
        <button
          type="button"
          className="primary"
          data-testid="briefing-play"
          disabled={!sessionId}
          onClick={() => {
            if (sessionId) void play(sessionId);
            onClose();
          }}
        >
          Run replay
        </button>
        <button type="button" className="chip-toggle" data-testid="briefing-skip" onClick={onClose}>
          Skip
        </button>
        <button
          type="button"
          className="link-button briefing-tour-link"
          data-testid="briefing-tour"
          title="Start the walkthrough"
          onClick={onTour}
        >
          Walkthrough
        </button>
      </div>
    </section>
  );
}
