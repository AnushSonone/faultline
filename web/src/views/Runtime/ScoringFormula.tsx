import { useInvestigation } from "../../state/investigation";
import { COMPONENT_COPY } from "../../content/components";

const TRACK_MAX = 0.2;

const ORDER = [
  "anomaly_strength",
  "temporal_precedence",
  "failed_trace_coverage",
  "critical_path_contribution",
  "downstream_impact",
  "topology_consistency",
  "change_proximity",
  "log_evidence",
  "contradiction_penalty",
  "persistence",
];

// The nine weighted features and the unweighted tenth, as bars. With a
// service selected on the stage, each track also shows that candidate's
// feature value and contribution, and the footer sums them to its score.
export function ScoringFormula() {
  const rootCauses = useInvestigation((s) => s.rootCauses);
  const selectedService = useInvestigation((s) => s.selectedService);
  const hoveredService = useInvestigation((s) => s.hoveredService);
  const focus = selectedService ?? hoveredService;
  const candidate = focus ? (rootCauses?.candidates ?? []).find((c) => c.service === focus) ?? null : null;
  const byName = new Map((candidate?.components ?? []).map((c) => [c.name, c]));

  return (
    <div className="formula" data-testid="scoring-formula">
      <p className="formula-line mono">
        score = Σ wᵢ · fᵢ − 0.10 · contradiction
        {candidate ? ` = ${candidate.score.toFixed(2)} for ${candidate.service}` : ""}
      </p>
      <div className="weight-rows">
        {ORDER.map((name) => {
          const copy = COMPONENT_COPY[name];
          if (!copy) return null;
          const w = copy.weight;
          const negative = w != null && w < 0;
          const live = byName.get(name);
          const trackFrac = w == null ? 0 : Math.abs(w) / TRACK_MAX;
          const valueFrac = live ? Math.max(0, Math.min(1, live.feature_value)) : 0;
          return (
            <div
              key={name}
              className={["weight-row", negative ? "negative" : "", w == null ? "unweighted" : ""].join(" ").trim()}
              title={copy.detail}
            >
              <span className="mono weight-name">{name}</span>
              <span className="mono weight-w">
                {w == null ? "unweighted" : `${negative ? "−" : ""}${Math.abs(w).toFixed(2)}`}
              </span>
              <span className="mono weight-c">
                {live ? (w == null ? live.feature_value.toFixed(2) : live.contribution.toFixed(3)) : ""}
              </span>
              <span className="weight-track" aria-hidden="true">
                <span className="weight-fill" style={{ width: `${trackFrac * 100}%` }}>
                  {live && <span className="weight-live" style={{ width: `${valueFrac * 100}%` }} />}
                </span>
              </span>
              <span className="weight-def">{copy.plain}</span>
            </div>
          );
        })}
      </div>
      <p className="hint">
        {candidate
          ? "Bar: weight (track) and this candidate's feature value (fill). Right column: contribution, summed into the score."
          : "Bar: weight relative to the largest (0.20). Select or hover a service on the stage to overlay its feature values."}
      </p>
    </div>
  );
}
