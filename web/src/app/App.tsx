import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  connectStream,
  createSession,
  DemoBusyError,
  loadIncident,
  setSpeed,
  type StreamHandle,
} from "../api/client";
import { useInvestigation } from "../state/investigation";
import { pickReplaySpeed, type Speed } from "../lib/replaySpeed";
import { readFirstVisit, safeStorage } from "../lib/firstVisit";
import { TransportBar } from "./TransportBar";
import { Stage } from "./Stage";
import { Dock } from "./Dock";
import { Walkthrough } from "../components/Walkthrough";
import { FirstVisit } from "../components/FirstVisit";

const DEFAULT_INCIDENT = "rec-mem-001";

export function App() {
  const wsRef = useRef<StreamHandle | null>(null);
  const [booting, setBooting] = useState(true);
  const [adversarial, setAdversarial] = useState(false);
  const [incident, setIncidentChoice] = useState(DEFAULT_INCIDENT);
  const [speed, setSpeedChoice] = useState<Speed>("10");
  const [demoBusy, setDemoBusy] = useState(false);
  const [bootRetry, setBootRetry] = useState(0);
  const incidentId = useInvestigation((s) => s.incidentId);
  const sessionId = useInvestigation((s) => s.sessionId);
  const lastError = useInvestigation((s) => s.lastError);
  const wsStatus = useInvestigation((s) => s.wsStatus);
  const wsRetries = useInvestigation((s) => s.wsRetries);
  const groundTruth = useInvestigation((s) => s.groundTruth);
  const setSession = useInvestigation((s) => s.setSession);
  const setIncident = useInvestigation((s) => s.setIncident);
  const setIncidentRange = useInvestigation((s) => s.setIncidentRange);
  const setError = useInvestigation((s) => s.setError);
  const setGroundTruth = useInvestigation((s) => s.setGroundTruth);
  const clearSelection = useInvestigation((s) => s.clearSelection);
  const setFirstVisit = useInvestigation((s) => s.setFirstVisit);
  const incidentEndNs = useInvestigation((s) => s.incidentEndNs);

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
        // The previous incident's range must not survive into the new load:
        // anything reading data-end-ns would seek the wrong clock.
        setIncidentRange(null, null);
        const loaded = await loadIncident(id, incident, { adversarial });
        setIncident(loaded.incident_id ?? incident);
        setIncidentRange(loaded.start_time_ns ?? null, loaded.end_time_ns ?? null);
        setGroundTruth(loaded.ground_truth ?? null);
        // A replay should take tens of seconds to watch, whatever the
        // incident's span in event time.
        const span =
          loaded.end_time_ns != null && loaded.start_time_ns != null
            ? loaded.end_time_ns - loaded.start_time_ns
            : null;
        const chosen = pickReplaySpeed(span);
        setSpeedChoice(chosen);
        await setSpeed(id, chosen);
        // Investigation-first open: the cursor stays at the start, nothing is
        // ranked, and the visitor builds the evidence by pressing Play.
        setBooting(false);
        setFirstVisit(readFirstVisit(safeStorage()));
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
    setFirstVisit,
    adversarial,
    incident,
    bootRetry,
  ]);

  if (demoBusy) {
    return (
      <div className="shell embed">
        <div className="demo-busy" data-testid="demo-busy">
          <div className="demo-busy-card">
            <span className="eyebrow">Faultline</span>
            <p>The demo is at capacity right now. Try again in a minute or two.</p>
            <button type="button" className="primary" onClick={() => setBootRetry((n) => n + 1)}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="shell embed"
      data-session={sessionId ?? undefined}
      data-end-ns={incidentEndNs != null ? String(incidentEndNs) : undefined}
    >
      <TransportBar
        adversarial={adversarial}
        onToggleAdversarial={() => setAdversarial((v) => !v)}
        incident={incident}
        onSelectIncident={setIncidentChoice}
        speed={speed}
        onSelectSpeed={setSpeedChoice}
      />

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
              Fixture ground truth (not inferred): {groundTruth.root_cause_services.join(", ")} /{" "}
              {groundTruth.fault_type}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Stage
        booting={booting}
        sessionId={sessionId}
        incidentId={incidentId ?? incident}
        adversarial={adversarial}
      />
      <Dock />
      <FirstVisit />
      <Walkthrough />
    </div>
  );
}
