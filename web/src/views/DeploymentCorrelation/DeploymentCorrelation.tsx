import { useInvestigation } from "../../state/investigation";

function fmtNs(ns: number | null | undefined): string {
  if (ns == null) return "-";
  // Fixture times are absolute; show seconds offset within the ns value for readability.
  return `${(ns / 1e9).toFixed(3)}s`;
}

function fmtMs(v: number | null | undefined): string {
  if (v == null) return "-";
  return `${v.toFixed(1)} ms`;
}

export function DeploymentCorrelationPanel() {
  const correlations = useInvestigation((s) => s.correlations);
  const selectedChangeId = useInvestigation((s) => s.selectedChangeId);
  const selectChange = useInvestigation((s) => s.selectChange);
  const selectService = useInvestigation((s) => s.selectService);
  const selectOperator = useInvestigation((s) => s.selectOperator);

  if (!correlations.length) {
    return (
      <div className="panel-body muted" data-testid="deployment-correlation">
        No deployment correlations yet (play or seek past a deploy marker).
      </div>
    );
  }

  return (
    <div className="panel-body correlation-list" data-testid="deployment-correlation">
      <p className="hint">
        Temporal association only. Nearby deployments support investigation; they are not
        proven root causes.
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
            <ul>
              <li>Deployed: {fmtNs(c.deployed_at_ns)}</li>
              <li>First anomaly: {fmtNs(c.first_anomaly_ns)}</li>
              <li>
                Delay:{" "}
                {c.delay_ns != null ? `${(c.delay_ns / 1e9).toFixed(1)} seconds` : "-"}
              </li>
              <li>Associated anomalous windows: {c.associated_anomalous_windows}</li>
              <li>p99 before: {fmtMs(c.p99_before)}</li>
              <li>p99 after: {fmtMs(c.p99_after)}</li>
              <li className="muted">{c.language}</li>
            </ul>
            {selected && c.evidence_refs.length > 0 && (
              <p className="mono" data-testid="correlation-evidence">
                evidence: {c.evidence_refs.slice(0, 6).join(", ")}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
