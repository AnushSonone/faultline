import { play } from "../api/client";
import { checklistRows, type CheckId } from "../lib/progress";
import { useInvestigation } from "../state/investigation";

const LABELS: Record<CheckId, { label: string; hint: string; lockedHint?: string }> = {
  case: { label: "Read the case file", hint: "The brief in this column, or the Case file tab." },
  replay: { label: "Run the replay", hint: "Press Play; events stream in event-time order." },
  graph: { label: "Watch the dependency graph turn red", hint: "Nodes redden as a metric leaves its own baseline." },
  telemetry: { label: "Inspect the telemetry", hint: "Open Telemetry: the p99 heatmap and a trace waterfall." },
  ranking: { label: "Read the ranking", hint: "Candidates by evidence score; Ranking shows the decomposition." },
  truth: {
    label: "Compare with ground truth",
    hint: "Open Case file and reveal the fault-injection label.",
    lockedHint: "Unlocks after one full replay.",
  },
};

const NEXT_HINT: Record<CheckId, string> = {
  case: "read the case file",
  replay: "run the replay",
  graph: "watch the dependency graph",
  telemetry: "inspect the telemetry",
  ranking: "read the ranking",
  truth: "compare with ground truth",
};

type Props = {
  // Fold to one line (the ranking or a short rail needs the space).
  compact?: boolean;
  // Expanded from the compact line; owned by the rail so it can hide the
  // evidence timeline while the rows show.
  expanded?: boolean;
  onExpandedChange?: (v: boolean) => void;
};

// The investigation checklist: six things a visitor does to reach the
// ranking on their own. Rows latch in the store; this only renders them.
export function Checklist({ compact = false, expanded = false, onExpandedChange }: Props) {
  const sessionId = useInvestigation((s) => s.sessionId);
  const briefRead = useInvestigation((s) => s.briefRead);
  const visitedTabs = useInvestigation((s) => s.visitedTabs);
  const playedOnce = useInvestigation((s) => s.playedOnce);
  const sawAnomaly = useInvestigation((s) => s.sawAnomaly);
  const sawRanking = useInvestigation((s) => s.sawRanking);
  const replayCompleted = useInvestigation((s) => s.replayCompleted);
  const groundTruthRevealed = useInvestigation((s) => s.groundTruthRevealed);
  const setTab = useInvestigation((s) => s.setTab);
  const setExpanded = (v: boolean) => onExpandedChange?.(v);

  const rows = checklistRows({
    briefRead,
    visitedTabs,
    playedOnce,
    sawAnomaly,
    sawRanking,
    replayCompleted,
    groundTruthRevealed,
  });
  const done = rows.filter((r) => r.done).length;
  const next = rows.find((r) => !r.done);

  const act = (id: CheckId) => {
    switch (id) {
      case "case":
      case "truth":
        setTab("case");
        break;
      case "replay":
        if (sessionId) void play(sessionId);
        break;
      case "telemetry":
        setTab("signals");
        break;
      case "ranking":
        setTab("root-causes");
        break;
      default:
        break;
    }
  };

  if (compact && !expanded) {
    return (
      <div className="checklist compact" data-testid="checklist" data-done={done}>
        <span className="check-summary">
          Investigation · {done} of {rows.length}
          {next ? ` · next: ${NEXT_HINT[next.id]}` : " · complete"}
        </span>
        <button
          type="button"
          className="chip-toggle"
          data-testid="checklist-toggle"
          onClick={() => setExpanded(true)}
        >
          Show
        </button>
      </div>
    );
  }

  return (
    <div className={compact ? "checklist expanded" : "checklist"} data-testid="checklist" data-done={done}>
      <div className="check-head">
        <span className="eyebrow">
          Investigation · {done} of {rows.length}
        </span>
        {compact && (
          <button
            type="button"
            className="chip-toggle"
            data-testid="checklist-toggle"
            onClick={() => setExpanded(false)}
          >
            Hide
          </button>
        )}
      </div>
      <ol className="check-list">
        {rows.map((r) => {
          const copy = LABELS[r.id];
          const passive = r.id === "graph";
          const locked = r.locked === true && !r.done;
          const hint = locked ? (copy.lockedHint ?? copy.hint) : copy.hint;
          const inner = (
            <>
              <span className="check-tick" aria-hidden="true">
                {r.done ? "✓" : ""}
              </span>
              <span className="check-body">
                <span className="check-label">{copy.label}</span>
                <span className="check-hint">{hint}</span>
              </span>
            </>
          );
          return (
            <li
              key={r.id}
              className={["check-row", r.done ? "done" : "", locked ? "locked" : ""].join(" ").trim()}
              data-testid={`check-${r.id}`}
              data-done={r.done ? "true" : "false"}
              data-locked={locked ? "true" : undefined}
            >
              {passive ? (
                <span className="check-static">{inner}</span>
              ) : (
                <button type="button" className="check-button" disabled={locked} onClick={() => act(r.id)}>
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
