import { play } from "../api/client";
import { SCENARIOS, SOURCE_LABELS } from "../content/scenarios";
import { useInvestigation } from "../state/investigation";
import { CaseSchematic } from "./CaseSchematic";

type Props = {
  incidentId: string;
  onClose: () => void;
  onTour: () => void;
};

// The case brief shown in the rail until the first Play: what was injected,
// whether a change event exists, which signals are present, how the ranker
// did, a propagation schematic, and the features worth watching. What
// Faultline itself is lives in the walkthrough's first step, not here.
export function Briefing({ incidentId, onClose, onTour }: Props) {
  const sessionId = useInvestigation((s) => s.sessionId);
  const scenario = SCENARIOS[incidentId];
  const headline = scenario?.headline ?? incidentId;

  return (
    <section className="briefing" data-testid="briefing" aria-label="Case brief">
      <span className="eyebrow">
        Case brief{scenario ? ` · ${SOURCE_LABELS[scenario.source]}` : ""}
      </span>
      <h3 className="briefing-title" title={headline}>
        {headline}
      </h3>
      {scenario && (
        <dl className="brief-grid">
          <dt>Fault</dt>
          <dd>{scenario.brief.fault}</dd>
          <dt>Change event</dt>
          <dd>{scenario.brief.changeEvent}</dd>
          <dt>Signals</dt>
          <dd>{scenario.brief.signals}</dd>
          <dt>Outcome</dt>
          <dd>{scenario.brief.outcome}</dd>
        </dl>
      )}
      {scenario && <CaseSchematic schematic={scenario.schematic} />}
      <p className="briefing-abstract">
        {scenario?.abstract ?? "A fault is injected into one service and its callers degrade in turn."}
      </p>
      {scenario && (
        <>
          <span className="eyebrow briefing-watch-head">Watch</span>
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
        </>
      )}
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
      </div>
      <p className="briefing-more">
        New here?{" "}
        <button type="button" className="link-button" data-testid="briefing-tour" onClick={onTour}>
          Start the walkthrough
        </button>
      </p>
    </section>
  );
}
