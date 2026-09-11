import { useEffect, useMemo, useState } from "react";
import { fetchCase } from "../../api/client";
import { useInvestigation } from "../../state/investigation";
import { SCENARIOS, SOURCE_LABELS, THE_INPUTS, THE_QUESTION } from "../../content/scenarios";
import { CaseSchematic } from "../../components/CaseSchematic";
import { CaseSection } from "../../components/CaseSection";
import { fmtWindowS } from "../../lib/format";
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
  // The unlabelled record is fetched once when the session loads (App.tsx) and
  // shared with the rail dossier; only the reveal is this page's own request.
  const info = useInvestigation((s) => s.caseInfo);
  const setCaseInfo = useInvestigation((s) => s.setCaseInfo);
  const [revealed, setRevealed] = useState(false);

  const scenario = SCENARIOS[incidentId];

  // A new session clears caseInfo, so the reveal has to re-arm with it.
  useEffect(() => {
    setRevealed(false);
  }, [sessionId, incidentId]);

  const reveal = () => {
    if (!sessionId) return;
    fetchCase(sessionId, true)
      .then((c) => {
        setCaseInfo(c);
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

  const faultPhrase =
    scenario?.brief.fault.split(",")[0] ?? (info?.fault_type ? `fault ${info.fault_type}` : null);
  // One muted line of facts under the headline, in place of coloured pills.
  const meta = [
    faultPhrase,
    durationS != null ? `${fmtWindowS(durationS)} recorded` : null,
    scenario ? SOURCE_LABELS[scenario.source] : null,
    info?.adversarial ? "adversarial arrival" : null,
    info?.dataset_id ? `${info.dataset_id} ${info.dataset_version ?? ""}`.trim() : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // One section order, read top to bottom: what happened, what is asked, how
  // it propagated, the fault record, the evidence, the engineering, the
  // answer key, and the method. Every section is a title, an optional caption
  // and its content, separated by a hairline at one rhythm.
  return (
    <section className="case-panel" data-testid="case-panel">
      <header className="case-head">
        {meta && <p className="case-meta">{meta}</p>}
        <strong>{scenario?.headline ?? info?.system ?? incidentId}</strong>
      </header>

      <div className="case-doc">
        {scenario && (
          <CaseSection title="The incident">
            <p>{scenario.caseSummary.symptom}</p>
            <p>{scenario.caseSummary.system}</p>
          </CaseSection>
        )}

        {scenario && (
          <CaseSection title="The question">
            <p>
              {THE_QUESTION} {THE_INPUTS}
            </p>
          </CaseSection>
        )}

        {scenario && (
          <CaseSection title="How it propagates" caption={LEADS.propagates}>
            <CaseSchematic schematic={scenario.schematic} />
          </CaseSection>
        )}

        {scenario && (
          <CaseSection title="Fault record">
            <dl className="case-kv">
              <dt>Fault</dt>
              <dd>{scenario.brief.fault}</dd>
              <dt>Change event</dt>
              <dd>{scenario.brief.changeEvent}</dd>
              <dt>Signals</dt>
              <dd>{scenario.brief.signals}</dd>
            </dl>
          </CaseSection>
        )}

        <CaseSection title="Recording" caption={LEADS.recording}>
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
            <p>The recording loads with the session.</p>
          )}
        </CaseSection>

        <CaseSection title="What was recorded" caption={LEADS.recorded}>
          <SignalInventory
            eventCounts={info?.event_counts ?? {}}
            events={timeline?.events ?? []}
            services={services}
            origin={origin}
          />
        </CaseSection>

        {scenario && startNs != null && endNs != null && (
          <CaseSection title="The fault signal" caption={LEADS.series}>
            <FaultSeries
              sessionId={sessionId}
              scenario={scenario}
              startNs={startNs}
              endNs={endNs}
              faultStartNs={info?.fault_start_time_ns ?? null}
              faultEndNs={info?.fault_end_time_ns ?? null}
              cursorNs={cursorNs}
            />
          </CaseSection>
        )}

        {/* Never folded and never behind a control: revamp.spec asserts
            case-rows and case-rows-table are visible, and a closed <details>
            gives its children a 0x0 box. */}
        <CaseSection title="Raw records" caption={LEADS.rows} testId="case-rows-section">
          <RawRecords sessionId={sessionId} startNs={startNs} />
        </CaseSection>

        <CaseSection title="Request routes observed" caption={LEADS.routes}>
          <RouteList sessionId={sessionId} listedIds={listedIds} failedIds={failedIds} origin={origin} />
        </CaseSection>

        {(info?.notes || scenario?.caveat) && (
          <CaseSection title="Notes and caveats">
            {info?.notes && <p>{info.notes}</p>}
            {scenario?.caveat && <p>{scenario.caveat}</p>}
          </CaseSection>
        )}

        <CaseSection title="Ground truth">
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
                  <p className="case-caption case-lock-hint">
                    Fault-injection labels are the answer key. The ranker never reads them. Run the
                    replay to the end first, then compare the label with the ranking.
                  </p>
                )}
              </>
            )}
            {revealed && info?.answer && (
              <div data-testid="case-answer" className="case-answer">
                <dl className="case-kv">
                  <dt>Root cause</dt>
                  <dd>{info.answer.root_cause_services.join(", ")}</dd>
                  {info.answer.root_cause_indicators.length > 0 && (
                    <>
                      <dt>Indicator</dt>
                      <dd>{info.answer.root_cause_indicators.join(", ")}</dd>
                    </>
                  )}
                  {info.answer.expected_downstream_services.length > 0 && (
                    <>
                      <dt>Downstream</dt>
                      <dd>{info.answer.expected_downstream_services.join(", ")}</dd>
                    </>
                  )}
                  {topCandidate && (
                    <>
                      <dt>Ranking</dt>
                      <dd>
                        {agrees
                          ? `Matches the top-ranked candidate (${topCandidate.service}).`
                          : `Top-ranked candidate is ${topCandidate.service}; the ranking disagrees.`}
                      </dd>
                    </>
                  )}
                  {scenario && (
                    <>
                      <dt>Benchmark</dt>
                      <dd>{scenario.brief.outcome}</dd>
                    </>
                  )}
                </dl>
                <p className="case-caption">From the fault-injection label, which the ranker never reads.</p>
              </div>
            )}
          </div>
        </CaseSection>

        {scenario && (
          <CaseSection title="Method" testId="scenario-blurb">
            <p>
              <strong>What happened.</strong> {scenario.whatHappened}
            </p>
            <p>
              <strong>What we evaluate.</strong> {scenario.whatWeEvaluate}
            </p>
            <p>
              <strong>What to watch.</strong> {scenario.whatToWatch}
            </p>
          </CaseSection>
        )}
      </div>
    </section>
  );
}
