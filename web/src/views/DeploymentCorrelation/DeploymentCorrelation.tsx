import { useInvestigation } from "../../state/investigation";
import { fmtCount, fmtDurationNs, fmtOffset } from "../../lib/format";
import { InfoTip } from "../../components/InfoTip";

const MS_TO_NS = 1e6;

export function DeploymentCorrelationPanel() {
  const correlations = useInvestigation((s) => s.correlations);
  const incidentStartNs = useInvestigation((s) => s.incidentStartNs);
  const selectedChangeId = useInvestigation((s) => s.selectedChangeId);
  const selectChange = useInvestigation((s) => s.selectChange);
  const selectService = useInvestigation((s) => s.selectService);
  const selectOperator = useInvestigation((s) => s.selectOperator);

  if (!correlations.length) {
    return (
      <div className="empty-state" data-testid="deployment-correlation">
        <span className="glyph" aria-hidden="true">
          ⇅
        </span>
        <span>No deployment correlations yet. Play or seek past a deploy marker.</span>
      </div>
    );
  }

  return (
    <div className="panel-body correlation-list" data-testid="deployment-correlation">
      <p className="panel-caption">
        Deployments near the anomaly onset{" "}
        <InfoTip>
          Temporal association only. Nearby deployments support investigation; they are not
          proven root causes.
        </InfoTip>
      </p>
      {correlations.map((c) => {
        const selected = selectedChangeId === c.change_id;
        return (
          <article
            key={c.change_id}
            className={selected ? "correlation-card selected" : "correlation-card"}
            data-testid={`correlation-${c.change_id}`}
            onClick={() => {
              selectChange(selected ? null : c.change_id);
              selectService(c.service);
              selectOperator("deploy_temporal_join");
            }}
          >
            <header>
              <strong>
                Deployment: {c.service}
                {c.deployed_version ? ` ${c.deployed_version}` : ""}
              </strong>
            </header>
            <dl className="kv-grid">
              <dt>Deployed</dt>
              <dd className="mono">{fmtOffset(c.deployed_at_ns, incidentStartNs)}</dd>
              <dt>First anomaly</dt>
              <dd className="mono">{fmtOffset(c.first_anomaly_ns, incidentStartNs)}</dd>
              <dt>Delay</dt>
              <dd className="mono">{fmtDurationNs(c.delay_ns)}</dd>
              <dt>Windows</dt>
              <dd className="mono">{fmtCount(c.associated_anomalous_windows)}</dd>
              <dt>p99</dt>
              <dd className="mono">
                {c.p99_before != null ? fmtDurationNs(c.p99_before * MS_TO_NS) : "-"} →{" "}
                {c.p99_after != null ? fmtDurationNs(c.p99_after * MS_TO_NS) : "-"}
              </dd>
            </dl>
            {selected && c.evidence_refs.length > 0 && (
              <div className="metric-chips" data-testid="correlation-evidence">
                {c.evidence_refs.slice(0, 6).map((ref) => (
                  <span key={ref} className="metric-chip">
                    <span className="metric-key">evidence</span>
                    <span className="metric-value mono">{ref}</span>
                  </span>
                ))}
              </div>
            )}
            <p className="panel-caption">{c.language}</p>
          </article>
        );
      })}
    </div>
  );
}
