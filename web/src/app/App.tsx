import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  connectStream,
  createSession,
  DemoBusyError,
  loadIncident,
  seek,
  setSpeed,
  type StreamHandle,
} from "../api/client";
import { SCENARIOS } from "../content/scenarios";
import { useInvestigation, type TabId } from "../state/investigation";
import { shortTraceId } from "../lib/format";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { CasePanel } from "../components/CasePanel";
import { AppHeader } from "./AppHeader";
import { ReplayScrubber } from "./ReplayScrubber";
import { ServiceMap } from "../views/ServiceMap/ServiceMap";
import { IncidentTimeline } from "../views/IncidentTimeline/IncidentTimeline";
import { AnomalyHeatmap } from "../views/AnomalyHeatmap/AnomalyHeatmap";
import { TraceWaterfall } from "../views/TraceWaterfall/TraceWaterfall";
import { QueryInspectorPanel } from "../views/QueryInspector/QueryInspector";
import { RuntimeInspectorPanel } from "../views/RuntimeInspector/RuntimeInspector";
import { CrashTestPanel } from "../views/CrashTest/CrashTest";
import { DeploymentCorrelationPanel } from "../views/DeploymentCorrelation/DeploymentCorrelation";
import { EvidenceGraphPanel } from "../views/EvidenceGraph/EvidenceGraph";
import { RootCausesPanel } from "../views/RootCauses/RootCauses";

const DEFAULT_INCIDENT = "rec-mem-001";

const SECTION_LABELS: Record<TabId, string> = {
  overview: "Overview",
  "root-causes": "Root causes",
  signals: "Signals",
  runtime: "Runtime",
};

// One scrolling page: every section is always visible; the tab bar jumps.
function Section({ id, children }: { id: TabId; children: React.ReactNode }) {
  return (
    <section className="view-section" id={`section-${id}`} data-testid={`page-${id}`}>
      <span className="eyebrow section-eyebrow">{SECTION_LABELS[id]}</span>
      {children}
    </section>
  );
}

export function App({ embedded = false }: { embedded?: boolean } = {}) {
  const wsRef = useRef<StreamHandle | null>(null);
  const [booting, setBooting] = useState(true);
  const [adversarial, setAdversarial] = useState(false);
  const [incident, setIncidentChoice] = useState(DEFAULT_INCIDENT);
  const [demoBusy, setDemoBusy] = useState(false);
  const [bootRetry, setBootRetry] = useState(0);
  // Compact chrome: the `embedded` prop (direct blog embed) or ?embed=1
  // (standalone server inside an iframe). Read once on mount.
  const [embed] = useState(
    () => embedded || new URLSearchParams(window.location.search).get("embed") === "1",
  );
  const incidentId = useInvestigation((s) => s.incidentId);
  const sessionId = useInvestigation((s) => s.sessionId);
  const rootCauses = useInvestigation((s) => s.rootCauses);
  const setTab = useInvestigation((s) => s.setTab);
  const lastError = useInvestigation((s) => s.lastError);
  const wsStatus = useInvestigation((s) => s.wsStatus);
  const wsRetries = useInvestigation((s) => s.wsRetries);
  const groundTruth = useInvestigation((s) => s.groundTruth);
  const heatmapMode = useInvestigation((s) => s.heatmapMode);
  const inspector = useInvestigation((s) => s.runtimeInspector);
  const selectedService = useInvestigation((s) => s.selectedService);
  const selectedTrace = useInvestigation((s) => s.selectedTrace);
  const selectService = useInvestigation((s) => s.selectService);
  const selectTrace = useInvestigation((s) => s.selectTrace);
  const setSession = useInvestigation((s) => s.setSession);
  const setIncident = useInvestigation((s) => s.setIncident);
  const setIncidentRange = useInvestigation((s) => s.setIncidentRange);
  const setError = useInvestigation((s) => s.setError);
  const setGroundTruth = useInvestigation((s) => s.setGroundTruth);
  const clearSelection = useInvestigation((s) => s.clearSelection);

  const topCandidate = rootCauses?.candidates?.[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    setDemoBusy(false);
    setBooting(true);
    (async () => {
      try {
        const id = await createSession();
        if (cancelled) return;
        setSession(id);
        wsRef.current = connectStream(id);
        clearSelection();
        const loaded = await loadIncident(id, incident, { adversarial });
        setIncident(loaded.incident_id ?? incident);
        setIncidentRange(loaded.start_time_ns ?? null, loaded.end_time_ns ?? null);
        setGroundTruth(loaded.ground_truth ?? null);
        await setSpeed(id, "10");
        // Verdict-first open: land on the fully evidenced end state. Play
        // rewinds to the start (ReplayClock::play rewinds when stopped).
        if (loaded.end_time_ns != null) {
          await seek(id, loaded.end_time_ns);
        }
        setBooting(false);
      } catch (e) {
        if (e instanceof DemoBusyError) {
          setDemoBusy(true);
        } else {
          setError(String(e));
        }
        setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
  }, [
    setSession,
    setIncident,
    setIncidentRange,
    setError,
    setGroundTruth,
    clearSelection,
    adversarial,
    incident,
    bootRetry,
  ]);

  if (demoBusy) {
    return (
      <div className={embed ? "shell embed" : "shell"}>
        <div className="demo-busy" data-testid="demo-busy">
          <div className="demo-busy-card">
            <span className="eyebrow">Faultline</span>
            <p>The demo is at capacity right now. Try again in a minute or two.</p>
            <button
              type="button"
              className="primary"
              onClick={() => setBootRetry((n) => n + 1)}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const scenario = SCENARIOS[incidentId ?? incident];

  return (
    <div className={embed ? "shell embed" : "shell"}>
      <div className="app-chrome">
        <AppHeader />
        <ReplayScrubber
          adversarial={adversarial}
          onToggleAdversarial={() => setAdversarial((v) => !v)}
          incident={incident}
          onSelectIncident={setIncidentChoice}
        />
      </div>

      <div className="toast-stack">
        <AnimatePresence>
          {lastError && (
            <motion.div
              key="error"
              className="banner error"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
            >
              {lastError}
            </motion.div>
          )}
          {wsStatus === "reconnecting" && wsRetries >= 4 && (
            <motion.div
              key="ws-retry"
              className="banner error"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
            >
              Connection lost, retrying…
            </motion.div>
          )}
          {groundTruth && (
            <motion.div
              key="ground-truth"
              className="banner ground-truth"
              data-testid="ground-truth"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
            >
              Fixture ground truth (not inferred):{" "}
              {groundTruth.root_cause_services.join(", ")} / {groundTruth.fault_type}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {booting && (
        <div className="boot-skeleton" aria-hidden="true">
          <span className="skeleton-line" style={{ width: "38%" }} />
          <span className="skeleton-line" style={{ width: "62%" }} />
          <span className="skeleton-line" style={{ width: "45%" }} />
        </div>
      )}

      <div className="selection-bar" data-testid="selection-bar">
        {selectedService == null && selectedTrace == null && (
          <span className="selection-hint">
            No selection. Click a service, heatmap cell, or trace to link the views.
          </span>
        )}
        {selectedService != null && (
          <span className="selection-chip">
            service: {selectedService}
            <button
              type="button"
              className="chip-clear"
              aria-label="Clear service selection"
              onClick={() => selectService(null)}
            >
              ×
            </button>
          </span>
        )}
        {selectedTrace != null && (
          <span className="selection-chip" title={selectedTrace}>
            trace: {shortTraceId(selectedTrace)}
            <button
              type="button"
              className="chip-clear"
              aria-label="Clear trace selection"
              onClick={() => selectTrace(null)}
            >
              ×
            </button>
          </span>
        )}
        <span className="selection-chip selection-meta" data-testid="heatmap-mode">
          heatmap: {heatmapMode}
        </span>
      </div>

      <Section id="overview">
        <ErrorBoundary name="Overview">
          {scenario && (
            <section className="panel scenario-blurb" data-testid="scenario-blurb">
              <h2>{scenario.title}</h2>
              <div className="scenario-cols">
                <div>
                  <span className="eyebrow">What happened</span>
                  <p>{scenario.whatHappened}</p>
                </div>
                <div>
                  <span className="eyebrow">What we evaluate</span>
                  <p>{scenario.whatWeEvaluate}</p>
                </div>
                <div>
                  <span className="eyebrow">What to watch</span>
                  <p>{scenario.whatToWatch}</p>
                </div>
              </div>
              {scenario.caveat && <p className="panel-caption">{scenario.caveat}</p>}
            </section>
          )}
          <div className="overview-lead">
            <div className="verdict-hero" data-testid="verdict-hero">
              {topCandidate ? (
                <>
                  <span className="eyebrow">Likely root cause</span>
                  <div className="verdict-line">
                    <span className="verdict-service">{topCandidate.service}</span>
                    <span className="verdict-score mono">
                      score {topCandidate.score.toFixed(2)}
                    </span>
                  </div>
                  <div className="score-bar">
                    <div
                      className="score-bar-fill"
                      style={{
                        width: `${Math.min(1, Math.max(0, topCandidate.score)) * 100}%`,
                      }}
                    />
                  </div>
                  <p className="verdict-caption">
                    Faultline replayed this incident to its end and ranked likely causes
                    from streaming evidence. Press Play to watch it unfold, or open{" "}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setTab("root-causes");
                        document
                          .getElementById("section-root-causes")
                          ?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      Root causes
                    </button>{" "}
                    for the full breakdown.
                  </p>
                </>
              ) : (
                <>
                  <span className="eyebrow">Faultline</span>
                  <p className="verdict-caption">
                    Interactive incident replay: metrics, traces, logs, and deployments on
                    one event-time clock. Evidence is loading; press Play to replay the
                    incident from the start.
                  </p>
                </>
              )}
            </div>
            <CasePanel sessionId={sessionId} />
          </div>
          <div className="grid">
            <section className="panel">
              <h2>Service map</h2>
              <ServiceMap />
            </section>
            <section className="panel">
              <h2>Timeline</h2>
              <IncidentTimeline />
            </section>
          </div>
        </ErrorBoundary>
      </Section>

      <Section id="root-causes">
        <ErrorBoundary name="Root causes">
          <div className="grid">
            <section className="panel">
              <h2>Likely root causes</h2>
              <RootCausesPanel />
            </section>
            <section className="panel">
              <h2>Deployment correlation</h2>
              <DeploymentCorrelationPanel />
            </section>
            <section className="panel wide">
              <h2>Evidence graph</h2>
              <EvidenceGraphPanel />
            </section>
          </div>
        </ErrorBoundary>
      </Section>

      <Section id="signals">
        <ErrorBoundary name="Signals">
          <div className="grid">
            <section className="panel">
              <h2>Anomaly heatmap</h2>
              <AnomalyHeatmap />
            </section>
            <section className="panel">
              <h2>Trace waterfall</h2>
              <TraceWaterfall />
            </section>
          </div>
        </ErrorBoundary>
      </Section>

      <Section id="runtime">
        <ErrorBoundary name="Runtime">
          <div className="grid">
            <section className="panel wide" style={{ minHeight: "auto" }}>
              <h2>Checkpoint &amp; recovery</h2>
              <CrashTestPanel />
            </section>
            <section className="panel wide" style={{ minHeight: "auto" }}>
              <h2>Query plan inspector</h2>
              <QueryInspectorPanel />
            </section>
            <section className="panel wide">
              <h2>Runtime inspector</h2>
              <div className="panel-body">
                <RuntimeInspectorPanel />
              </div>
            </section>
            <section className="panel wide" style={{ minHeight: "auto" }}>
              <h2>Streaming vs precomputed</h2>
              <div className="panel-body">
                <aside className="arch-status" data-testid="arch-status">
                  {/* Single source of truth: the runtime projection's own status lines. */}
                  <ul>
                    {(inspector?.architecture_status ?? []).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <dl className="kv-grid">
                    <dt>Incident</dt>
                    <dd className="mono">{incidentId ?? DEFAULT_INCIDENT}</dd>
                    <dt>Heatmap values</dt>
                    <dd>{heatmapMode}</dd>
                    <dt>Arrival order</dt>
                    <dd>{adversarial ? "adversarial" : "normal"}</dd>
                  </dl>
                </aside>
              </div>
            </section>
          </div>
        </ErrorBoundary>
      </Section>
    </div>
  );
}
