import { useState } from "react";
import { useInvestigation } from "../../state/investigation";
import type { RootCauseCandidate, RootCauseEvidence } from "../../types/protocol";
import { titleCase } from "../../lib/format";
import { scoreBand, ordinal } from "../../lib/explain";
import { COMPONENT_COPY } from "../../content/components";
import { InfoTip } from "../../components/InfoTip";
import { EmptyState } from "../../components/EmptyState";

const MAX_EVIDENCE = 6;

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function EvidenceItem({ ev }: { ev: RootCauseEvidence }) {
  const contradicts = ev.direction === "contradicts";
  return (
    <li className={contradicts ? "evidence contradicts" : "evidence supports"}>
      <span className="evidence-badge">{contradicts ? "contradicts" : "supports"}</span>
      <span className="evidence-text">
        {ev.human_label}
        {ev.source_refs.length > 0 && (
          <span className="muted"> ({ev.source_refs.length} refs)</span>
        )}
      </span>
    </li>
  );
}

/// Which evidence types a score component's click filters down to
/// (spec 20.6: clicking a feature contribution filters the evidence list).
const COMPONENT_EVIDENCE: Record<string, string[]> = {
  anomaly_strength: ["metric_anomaly"],
  temporal_precedence: ["temporal_precedence"],
  failed_trace_coverage: ["failed_trace_coverage"],
  critical_path_contribution: ["critical_path_increase"],
  downstream_impact: ["dependency_propagation"],
  topology_consistency: ["dependency_propagation"],
  change_proximity: ["deployment_proximity"],
  log_evidence: ["log_template_spike"],
  contradiction_penalty: ["contradiction"],
};

// One candidate: rank, service, score, and on expansion the score
// decomposition (one row per feature, two lines each) and the evidence that
// carried it. The top candidate opens by default. Clicking anywhere in the
// card selects that service everywhere; the header and its chip expand and
// collapse, so a click inside an open card never folds it away.
function CandidateCard({
  candidate,
  evidence,
}: {
  candidate: RootCauseCandidate;
  evidence: RootCauseEvidence[];
}) {
  const [expanded, setExpanded] = useState(candidate.rank === 1);
  const [componentFilter, setComponentFilter] = useState<string | null>(null);
  const selectedService = useInvestigation((s) => s.selectedService);
  const selectService = useInvestigation((s) => s.selectService);
  const selected = selectedService === candidate.service;
  const width = Math.max(0, Math.min(1, candidate.score));
  const visibleEvidence = componentFilter
    ? evidence.filter((ev) => (COMPONENT_EVIDENCE[componentFilter] ?? []).includes(ev.type))
    : evidence;
  const shownEvidence = visibleEvidence.slice(0, MAX_EVIDENCE);
  const hiddenEvidence = visibleEvidence.length - shownEvidence.length;

  return (
    <article
      className={selected ? "correlation-card selected" : "correlation-card"}
      data-testid={`root-cause-${candidate.service}`}
      aria-expanded={expanded}
      onClick={() => selectService(candidate.service)}
    >
      <header
        className="candidate-head"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(!expanded);
          selectService(expanded && selected ? null : candidate.service);
        }}
      >
        <span className="rank-n mono">{ordinal(candidate.rank)}</span>
        <strong className="candidate-name" title={candidate.service}>
          {candidate.service}
        </strong>
        <button
          type="button"
          className="chip-toggle candidate-toggle"
          data-testid={`root-cause-toggle-${candidate.service}`}
          aria-label={expanded ? "Hide features" : "Show features"}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {expanded ? "features ▴" : "features ▾"}
        </button>
      </header>
      <div className="score-row">
        <div className="score-bar">
          <div className="score-bar-fill" style={{ width: pct(width) }} />
        </div>
        <span className="mono candidate-score" title={`${scoreBand(candidate.score)} evidence`}>
          {candidate.score.toFixed(2)}
        </span>
      </div>
      {expanded && (
        <>
          <table className="score-table" data-testid={`root-cause-breakdown-${candidate.service}`}>
            <thead>
              <tr>
                <th>
                  Feature{" "}
                  <InfoTip label="How to read this table">
                    One row per feature. Value is the normalized feature in [0, 1]; Weight is
                    the fixed coefficient from spec 18.4; Adds is their product. The score is
                    the sum of contributions, with the contradiction penalty negative.
                  </InfoTip>
                </th>
                <th className="num">Value</th>
                <th className="num">Weight</th>
                <th className="num">Adds</th>
              </tr>
            </thead>
            <tbody>
              {candidate.components.map((c) => {
                const copy = COMPONENT_COPY[c.name];
                const definition = copy?.plain ?? titleCase(c.name);
                return (
                  <tr
                    key={c.name}
                    className={[
                      c.contribution < 0 ? "negative" : "",
                      componentFilter === c.name ? "filtered" : "",
                    ]
                      .join(" ")
                      .trim() || undefined}
                    data-testid={`score-component-${c.name}`}
                    onClick={(e) => {
                      // Filter the evidence to this feature, and link the
                      // rest of the UI to the candidate the row belongs to.
                      e.stopPropagation();
                      setComponentFilter(componentFilter === c.name ? null : c.name);
                      selectService(candidate.service);
                    }}
                  >
                    <td title={copy ? `${definition}. ${copy.detail}` : definition}>
                      <span className="feature-key mono">{c.name}</span>
                      <span className="feature-def">{definition}</span>
                    </td>
                    <td className="mono num">
                      <span className="value-cell">
                        <span className="mini-bar" aria-hidden="true">
                          <span
                            style={{
                              width: `${Math.round(Math.max(0, Math.min(1, c.feature_value)) * 100)}%`,
                            }}
                          />
                        </span>
                        {c.feature_value.toFixed(2)}
                      </span>
                    </td>
                    <td className="mono num">{c.weight.toFixed(2)}</td>
                    <td className="mono num">{c.contribution.toFixed(3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {componentFilter && (
            <p className="panel-caption">
              evidence filtered to <span className="mono">{componentFilter}</span>; click the row
              again to clear
            </p>
          )}
          {shownEvidence.length > 0 && (
            <ul className="evidence-list" data-testid={`root-cause-evidence-${candidate.service}`}>
              {shownEvidence.map((ev) => (
                <EvidenceItem key={ev.evidence_id} ev={ev} />
              ))}
              {hiddenEvidence > 0 && (
                <li className="hint">
                  {hiddenEvidence} more evidence {hiddenEvidence === 1 ? "item" : "items"} not shown
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </article>
  );
}

export function RootCausesPanel() {
  const rootCauses = useInvestigation((s) => s.rootCauses);

  if (!rootCauses || rootCauses.incident_onset_ns == null) {
    return (
      <EmptyState
        title="No ranking yet"
        hint="Play or seek past the incident onset to accumulate evidence."
        glyph="?"
        testId="root-causes"
      />
    );
  }

  return (
    <div className="panel-body correlation-list" data-testid="root-causes">
      <p className="panel-caption">
        Candidates by evidence score <InfoTip>{rootCauses.language}.</InfoTip>
      </p>
      {rootCauses.candidates.map((candidate) => (
        <CandidateCard
          key={candidate.service}
          candidate={candidate}
          evidence={rootCauses.evidence.filter(
            (ev) => ev.candidate_service === candidate.service,
          )}
        />
      ))}
    </div>
  );
}
