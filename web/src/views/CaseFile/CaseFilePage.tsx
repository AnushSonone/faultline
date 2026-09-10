import { useEffect, useMemo, useState } from "react";
import { fetchCase, type CaseInfo } from "../../api/client";
import { useInvestigation } from "../../state/investigation";
import { SCENARIOS, SOURCE_LABELS } from "../../content/scenarios";
import { CaseSchematic } from "../../components/CaseSchematic";
import { RecordingTimeline } from "./RecordingTimeline";
import { SignalInventory } from "./SignalInventory";
import { RouteList } from "./RouteList";
import { FaultSeries } from "./FaultSeries";
import { RawRecords } from "./RawRecords";

type Props = {
  sessionId: string | null;
  incidentId: string;
};

const LEADS = {
  recording:
    "Event-time extent of the fixture: the shaded band is the fault-injection window from labels.json, the amber tick a deployment, the blue line the replay cursor.",
  recorded:
    "Envelope totals per signal from the manifest; per service, counted from the timeline projection up to the cursor, so the grid fills as the replay runs.",
  rows:
    "The records themselves, newest first at the cursor, read through the same SQL subset the Runtime tab exposes.",
  routes:
    "Distinct caller-to-callee chains from a sample of up to 8 traces at the cursor, failed traces first; the chain through the injected service is marked.",
  series:
    "The injected metric at the origin, read through the SQL subset at the cursor, against the same metric on its nearest caller. Real cases are bucketed with TUMBLE and AVG; the two queries register in the session query list.",
  propagates:
    "Curated from labels.json and the topology: the injected service, the callers that degrade per hop, and the bystanders that do not.",
};

// The incident record: what was recorded, which routes it covers, the
// injected signal, how it propagates, and the fault-injection label, which
// unlocks after one full replay and which the ranker never reads.
export function CaseFilePage({ sessionId, incidentId }: Props) {
  const startNs = useInvestigation((s) => s.incidentStartNs);
  const endNs = useInvestigation((s) => s.incidentEndNs);
  const cursorNs = useInvestigation((s) => s.selectedEventTime);
  const topology = useInvestigation((s) => s.topology);
  const timeline = useInvestigation((s) => s.timeline);
  const traces = useInvestigation((s) => s.traces);
  const rootCauses = useInvestigation((s) => s.rootCauses);
  const correlations = useInvestigation((s) => s.correlations);
  const unlocked = useInvestigation((s) => s.replayCompleted);
  const markGroundTruthRevealed = useInvestigation((s) => s.markGroundTruthRevealed);
  const [info, setInfo] = useState<CaseInfo | null>(null);
  const [revealed, setRevealed] = useState(false);

  const scenario = SCENARIOS[incidentId];

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
        /* the record is optional; stay quiet on failure */
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
        markGroundTruthRevealed();
      })
      .catch(() => {
        /* keep unrevealed state on failure */
      });
  };

  const services = useMemo(() => (topology?.graph?.nodes ?? []).map((n) => n.service), [topology]);
  const listedIds = useMemo(() => (traces?.traces ?? []).map((t) => t.trace_id), [traces]);
  const failedIds = useMemo(
    () => rootCauses?.candidates?.[0]?.features?.failed_trace_ids ?? [],
    [rootCauses],
  );
  const origin = scenario?.schematic.origin ?? null;
  const deployNs = useMemo(() => {
    const fromCorr = correlations.find((c) => c.service === origin)?.deployed_at_ns ?? correlations[0]?.deployed_at_ns;
    if (fromCorr != null) return fromCorr;
    if (scenario?.schematic.deploy && startNs != null) return startNs + scenario.schematic.deploy.atS * 1e9;
    return null;
  }, [correlations, origin, scenario, startNs]);

  const topCandidate = rootCauses?.candidates?.[0] ?? null;
  const agrees =
    topCandidate != null && (info?.answer?.root_cause_services ?? []).includes(topCandidate.service);
  const durationS =
    endNs != null && startNs != null ? Math.round((endNs - startNs) / 1e9) : null;

  return (
    <section className="case-panel" data-testid="case-panel">
      <div className="case-head">
        <div>
          <strong>{info?.system ?? scenario?.headline ?? incidentId}</strong>
          {info?.dataset_id && (
            <span className="muted">
              {" "}
              · {info.dataset_id} {info.dataset_version ?? ""}
            </span>
          )}
        </div>
        <div className="case-chips">
          {info?.fault_type && <span className="pill mono">fault {info.fault_type}</span>}
          {durationS != null && <span className="pill mono">{durationS} s</span>}
          {info?.adversarial && <span className="pill">adversarial arrival</span>}
          {scenario && <span className="pill">{SOURCE_LABELS[scenario.source]}</span>}
        </div>
      </div>

      <section className="drawer-section">
        <h3>Recording</h3>
        <p className="drawer-lead">{LEADS.recording}</p>
        {startNs != null && endNs != null ? (
          <RecordingTimeline
            startNs={startNs}
            endNs={endNs}
            faultStartNs={info?.fault_start_time_ns ?? null}
            faultEndNs={info?.fault_end_time_ns ?? null}
            deployNs={deployNs}
            cursorNs={cursorNs}
          />
        ) : (
          <p className="hint">The recording loads with the session.</p>
        )}
      </section>

      <section className="drawer-section">
        <h3>What was recorded</h3>
        <p className="drawer-lead">{LEADS.recorded}</p>
        <SignalInventory
          eventCounts={info?.event_counts ?? {}}
          events={timeline?.events ?? []}
          services={services}
          origin={origin}
        />
      </section>

      <section className="drawer-section" data-testid="case-rows-section">
        <h3>Raw records</h3>
        <p className="drawer-lead">{LEADS.rows}</p>
        <RawRecords sessionId={sessionId} startNs={startNs} />
      </section>

      <section className="drawer-section">
        <h3>Request routes observed</h3>
        <p className="drawer-lead">{LEADS.routes}</p>
        <RouteList sessionId={sessionId} listedIds={listedIds} failedIds={failedIds} origin={origin} />
      </section>

      {scenario && startNs != null && endNs != null && (
        <section className="drawer-section">
          <h3>The fault signal</h3>
          <p className="drawer-lead">{LEADS.series}</p>
          <FaultSeries
            sessionId={sessionId}
            scenario={scenario}
            startNs={startNs}
            endNs={endNs}
            faultStartNs={info?.fault_start_time_ns ?? null}
            faultEndNs={info?.fault_end_time_ns ?? null}
            cursorNs={cursorNs}
          />
        </section>
      )}

      {scenario && (
        <section className="drawer-section">
          <h3>How it propagates</h3>
          <p className="drawer-lead">{LEADS.propagates}</p>
          <CaseSchematic schematic={scenario.schematic} />
          <dl className="brief-grid case-brief">
            <dt>Fault</dt>
            <dd>{scenario.brief.fault}</dd>
            <dt>Change event</dt>
            <dd>{scenario.brief.changeEvent}</dd>
            <dt>Signals</dt>
            <dd>{scenario.brief.signals}</dd>
            <dt>Outcome</dt>
            <dd>{scenario.brief.outcome}</dd>
          </dl>
        </section>
      )}

      {(info?.notes || scenario?.caveat) && (
        <section className="drawer-section">
          <h3>Notes</h3>
          {info?.notes && <p className="panel-caption">{info.notes}</p>}
          {scenario?.caveat && <p className="panel-caption">{scenario.caveat}</p>}
        </section>
      )}

      <section className="drawer-section">
        <h3>Ground truth</h3>
        <div className="case-answer-row">
          {!revealed && (
            <>
              <button
                type="button"
                data-testid="case-reveal-button"
                disabled={!unlocked || !info}
                data-locked={unlocked ? undefined : "true"}
                onClick={reveal}
              >
                {unlocked ? "Reveal ground truth" : "Reveal ground truth (locked until the replay completes)"}
              </button>
              {!unlocked && (
                <p className="hint case-lock-hint">
                  Fault-injection labels are the answer key. The ranker never reads them. Run the
                  replay to the end first, then compare the label with the ranking.
                </p>
              )}
            </>
          )}
          {revealed && info?.answer && (
            <div data-testid="case-answer" className="case-answer">
              <span className="eyebrow">Ground truth (fault-injection label, not inferred)</span>
              <span className="case-answer-value">{info.answer.root_cause_services.join(", ")}</span>
              {info.answer.root_cause_indicators.length > 0 && (
                <span className="hint mono">indicator {info.answer.root_cause_indicators.join(", ")}</span>
              )}
              {info.answer.expected_downstream_services.length > 0 && (
                <span className="hint">expected downstream: {info.answer.expected_downstream_services.join(", ")}</span>
              )}
              {topCandidate && (
                <span className="hint">
                  {agrees
                    ? `Matches the top-ranked candidate (${topCandidate.service}).`
                    : `Top-ranked candidate is ${topCandidate.service}; the ranking disagrees.`}
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {scenario && (
        <section className="drawer-section scenario-blurb" data-testid="scenario-blurb">
          <h3>{scenario.title}</h3>
          <span className="eyebrow">What happened</span>
          <p>{scenario.whatHappened}</p>
          <span className="eyebrow">What we evaluate</span>
          <p>{scenario.whatWeEvaluate}</p>
          <span className="eyebrow">What to watch</span>
          <p>{scenario.whatToWatch}</p>
        </section>
      )}
    </section>
  );
}
