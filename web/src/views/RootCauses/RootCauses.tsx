import { useState } from "react";
import { useInvestigation } from "../../state/investigation";
import type { RootCauseCandidate, RootCauseEvidence } from "../../types/protocol";
import { titleCase } from "../../lib/format";
import { InfoTip } from "../../components/InfoTip";
import { EmptyState } from "../../components/EmptyState";

const RIGHT: React.CSSProperties = { textAlign: "right" };

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function EvidenceItem({ ev }: { ev: RootCauseEvidence }) {
  const contradicts = ev.direction === "contradicts";
  return (
    <li className={contradicts ? "evidence contradicts" : "evidence supports"}>
      <span className="evidence-badge">{contradicts ? "contradicts" : "supports"}</span>{" "}
      {ev.human_label}
      {ev.source_refs.length > 0 && (
        <span className="muted"> ({ev.source_refs.length} refs)</span>
      )}
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

function CandidateCard({
  candidate,
  evidence,
}: {
  candidate: RootCauseCandidate;
  evidence: RootCauseEvidence[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [componentFilter, setComponentFilter] = useState<string | null>(null);
  const selectedService = useInvestigation((s) => s.selectedService);
  const selectService = useInvestigation((s) => s.selectService);
  const selected = selectedService === candidate.service;
  const width = Math.max(0, Math.min(1, candidate.score));
  const visibleEvidence = componentFilter
    ? evidence.filter((ev) => (COMPONENT_EVIDENCE[componentFilter] ?? []).includes(ev.type))
    : evidence;

  return (
    <article
      className={selected ? "correlation-card selected" : "correlation-card"}
      data-testid={`root-cause-${candidate.service}`}
      onClick={() => {
        setExpanded(!expanded);
        selectService(selected && expanded ? null : candidate.service);
      }}
    >
      <header>
        <strong>
          <span className="muted">#{candidate.rank}</span> {candidate.service}
        </strong>
        <span className="mono">{candidate.score.toFixed(3)}</span>
      </header>
      <div className="score-bar">
        <div className="score-bar-fill" style={{ width: pct(width) }} />
      </div>
      {expanded && (
        <>
          <table className="score-table" data-testid={`root-cause-breakdown-${candidate.service}`}>
            <thead>
              <tr>
                <th>Component</th>
                <th style={RIGHT}>Value</th>
                <th style={RIGHT}>Weight</th>
                <th style={RIGHT}>Contribution</th>
              </tr>
            </thead>
            <tbody>
              {candidate.components.map((c) => (
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
                    e.stopPropagation();
                    setComponentFilter(componentFilter === c.name ? null : c.name);
                  }}
                >
                  <td>{titleCase(c.name)}</td>
                  <td className="mono" style={RIGHT}>{c.feature_value.toFixed(3)}</td>
                  <td className="mono" style={RIGHT}>{c.weight.toFixed(2)}</td>
                  <td className="mono" style={RIGHT}>{c.contribution.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {componentFilter && (
            <p className="panel-caption">
              evidence filtered to <span className="mono">{componentFilter}</span>; click the row
              again to clear
            </p>
          )}
          {visibleEvidence.length > 0 && (
            <ul className="evidence-list" data-testid={`root-cause-evidence-${candidate.service}`}>
              {visibleEvidence.map((ev) => (
                <EvidenceItem key={ev.evidence_id} ev={ev} />
              ))}
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
        title="No verdict yet"
        hint="Play or seek past the incident onset to accumulate evidence."
        glyph="?"
        testId="root-causes"
      />
    );
  }

  return (
    <div className="panel-body correlation-list" data-testid="root-causes">
      <p className="panel-caption">
        Ranked candidates <InfoTip>{rootCauses.language}.</InfoTip>
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
