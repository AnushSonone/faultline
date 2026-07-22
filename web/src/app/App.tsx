import { useEffect, useRef, useState } from "react";
import {
  connectStream,
  createSession,
  loadIncident,
  pause,
  play,
  reset,
  setSpeed,
  type StreamHandle,
} from "../api/client";
import { useInvestigation } from "../state/investigation";
import { ServiceMap } from "../views/ServiceMap/ServiceMap";
import { IncidentTimeline } from "../views/IncidentTimeline/IncidentTimeline";
import { AnomalyHeatmap } from "../views/AnomalyHeatmap/AnomalyHeatmap";
import { TraceWaterfall } from "../views/TraceWaterfall/TraceWaterfall";

const DEFAULT_INCIDENT = "rec-mem-001";

export function App() {
  const wsRef = useRef<StreamHandle | null>(null);
  const [booting, setBooting] = useState(true);
  const sessionId = useInvestigation((s) => s.sessionId);
  const connected = useInvestigation((s) => s.connected);
  const replay = useInvestigation((s) => s.replay);
  const incidentId = useInvestigation((s) => s.incidentId);
  const lastError = useInvestigation((s) => s.lastError);
  const groundTruth = useInvestigation((s) => s.groundTruth);
  const selectedService = useInvestigation((s) => s.selectedService);
  const selectedTrace = useInvestigation((s) => s.selectedTrace);
  const selectedEventTime = useInvestigation((s) => s.selectedEventTime);
  const setSession = useInvestigation((s) => s.setSession);
  const setIncident = useInvestigation((s) => s.setIncident);
  const setError = useInvestigation((s) => s.setError);
  const setGroundTruth = useInvestigation((s) => s.setGroundTruth);
  const clearSelection = useInvestigation((s) => s.clearSelection);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const id = await createSession();
        if (cancelled) return;
        setSession(id);
        wsRef.current = connectStream(id);
        clearSelection();
        const loaded = await loadIncident(id, DEFAULT_INCIDENT);
        setIncident(loaded.incident_id ?? DEFAULT_INCIDENT);
        setGroundTruth(loaded.ground_truth ?? null);
        await setSpeed(id, "10");
        setBooting(false);
      } catch (e) {
        setError(String(e));
        setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
  }, [setSession, setIncident, setError, setGroundTruth, clearSelection]);

  return (
    <div className="shell investigation">
      <header className="brand">
        <div>
          <h1>Faultline</h1>
          <p>Interactive Incident Replay</p>
        </div>
        <div className="controls" data-testid="replay-controls">
          <button
            type="button"
            disabled={!sessionId}
            onClick={() => sessionId && play(sessionId)}
          >
            Play
          </button>
          <button
            type="button"
            disabled={!sessionId}
            onClick={() => sessionId && pause(sessionId)}
          >
            Pause
          </button>
          <button
            type="button"
            disabled={!sessionId}
            onClick={() => sessionId && reset(sessionId)}
          >
            Reset
          </button>
          <span className="pill" data-testid="connection">
            {connected ? "ws live" : "ws down"}
          </span>
          <span className="pill" data-testid="replay-state">
            {replay.state}
          </span>
          <span className="pill">{incidentId ?? "-"}</span>
        </div>
      </header>

      {lastError && <div className="banner error">{lastError}</div>}
      {groundTruth && (
        <div className="banner ground-truth" data-testid="ground-truth">
          Fixture ground truth (not inferred):{" "}
          {groundTruth.root_cause_services.join(", ")} / {groundTruth.fault_type}
        </div>
      )}
      {booting && <p className="muted">Loading session…</p>}

      <div className="selection-bar" data-testid="selection-bar">
        <span>time: {selectedEventTime ?? "-"}</span>
        <span>service: {selectedService ?? "-"}</span>
        <span>trace: {selectedTrace ?? "-"}</span>
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
        <section className="panel">
          <h2>Anomaly heatmap</h2>
          <AnomalyHeatmap />
        </section>
        <section className="panel">
          <h2>Trace waterfall</h2>
          <TraceWaterfall />
        </section>
      </div>
    </div>
  );
}
