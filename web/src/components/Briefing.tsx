import { play } from "../api/client";
import { SCENARIOS } from "../content/scenarios";
import { useInvestigation } from "../state/investigation";

type Props = {
  incidentId: string;
  onClose: () => void;
  onTour: () => void;
};

// The story card shown in the rail until the first Play: a headline, what is
// about to happen, one thing to watch for, and one obvious action. What
// Faultline itself is lives in the tour's first step, not here.
export function Briefing({ incidentId, onClose, onTour }: Props) {
  const sessionId = useInvestigation((s) => s.sessionId);
  const scenario = SCENARIOS[incidentId];
  const headline = scenario?.headline ?? incidentId;
  const story = scenario?.story ?? "A fault is injected into one service and the others react.";
  const watchFor = scenario?.watchFor ?? "which circle turns red first.";

  return (
    <section className="briefing" data-testid="briefing" aria-label="Briefing">
      <span className="eyebrow">Before you press play</span>
      <h3 className="briefing-title" title={headline}>
        {headline}
      </h3>
      <p className="briefing-story">{story}</p>
      <p className="briefing-watch">
        <strong>Watch for:</strong> {watchFor}
      </p>
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
          Play the replay
        </button>
        <button type="button" className="chip-toggle" data-testid="briefing-skip" onClick={onClose}>
          Skip
        </button>
      </div>
      <p className="briefing-more">
        Not sure what you're looking at?{" "}
        <button type="button" className="link-button" data-testid="briefing-tour" onClick={onTour}>
          Take the tour
        </button>
      </p>
    </section>
  );
}
