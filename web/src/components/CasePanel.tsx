import { useEffect, useState } from "react";
import { fetchCase, type CaseInfo } from "../api/client";
import { useInvestigation } from "../state/investigation";
import { fmtCount, fmtOffset } from "../lib/format";
import { Stat } from "./Stat";

type Props = {
  sessionId: string | null;
};

// Case brief for the loaded incident: what is always known (system, fault
// type, injection time, counts, sampling caveats) vs the answer, which stays
// behind an explicit reveal. The ranker never sees labels either way.
export function CasePanel({ sessionId }: Props) {
  const incidentId = useInvestigation((s) => s.incidentId);
  const startNs = useInvestigation((s) => s.incidentStartNs);
  const [info, setInfo] = useState<CaseInfo | null>(null);
  const [revealed, setRevealed] = useState(false);
  const rootCauses = useInvestigation((s) => s.rootCauses);

  useEffect(() => {
    setInfo(null);
    setRevealed(false);
    if (!sessionId || !incidentId) return;
    let cancelled = false;
    fetchCase(sessionId, false)
      .then((c) => {
        if (!cancelled) setInfo(c);
      })
      .catch(() => {
        /* panel is optional; stay quiet on failure */
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, incidentId]);

  const reveal = () => {
    if (!sessionId) return;
    fetchCase(sessionId, true)
      .then((c) => {
        setInfo(c);
        setRevealed(true);
      })
      .catch(() => {
        /* keep unrevealed state on failure */
      });
  };

  if (!info) {
    return (
      <section className="panel case-panel" data-testid="case-panel" style={{ minHeight: "auto" }}>
        <h2>Case</h2>
        <div className="panel-body">
          <p className="muted">Case brief loads with the session.</p>
        </div>
      </section>
    );
  }

  const counts = info.event_counts ?? {};
  const durationS =
    info.end_time_ns != null && info.start_time_ns != null
      ? Math.round((info.end_time_ns - info.start_time_ns) / 1e9)
      : null;
  const topCandidate = rootCauses?.candidates?.[0] ?? null;
  const agrees =
    topCandidate != null &&
    (info.answer?.root_cause_services ?? []).includes(topCandidate.service);

  return (
    <section className="panel case-panel" data-testid="case-panel" style={{ minHeight: "auto" }}>
      <h2>Case</h2>
      <div className="panel-body">
        <div className="stat-grid">
          <Stat label="System" value={info.system ?? "-"} />
          <Stat label="Fault type" value={info.fault_type ?? "-"} />
          <Stat
            label="Injected at"
            value={
              info.fault_start_time_ns != null ? fmtOffset(info.fault_start_time_ns, startNs) : "-"
            }
            mono
          />
          <Stat label="Duration" value={durationS != null ? `${durationS}s` : "-"} />
          {Object.entries(counts).map(([signal, n]) => (
            <Stat key={signal} label={signal} value={fmtCount(n)} />
          ))}
          {info.adversarial && <Stat label="Arrival order" value="adversarial" />}
        </div>
        {info.notes && <p className="panel-caption">{info.notes}</p>}
        <div className="case-answer-row">
          {!revealed && (
            <button type="button" data-testid="case-reveal-button" onClick={reveal}>
              Reveal answer
            </button>
          )}
          {revealed && info.answer && (
            <div data-testid="case-answer" className="case-answer">
              <span className="eyebrow">Answer (fixture ground truth, not inferred)</span>
              <span className="case-answer-value">
                {info.answer.root_cause_services.join(", ")}
              </span>
              {topCandidate && (
                <span className="hint">
                  {agrees
                    ? `Matches the top-ranked candidate (${topCandidate.service}).`
                    : `Top-ranked candidate is ${topCandidate.service}, which disagrees.`}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
