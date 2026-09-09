import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listIncidents, pause, play, reset, seek, setProjectionMode, setSpeed } from "../api/client";
import { SCENARIOS } from "../content/scenarios";
import { useInvestigation } from "../state/investigation";
import { InfoTip } from "../components/InfoTip";
import { fmtIn, fmtOffset } from "../lib/format";
import { SPEEDS, type Speed } from "../lib/replaySpeed";
import { KIND_COLORS } from "../theme/kinds";

type Props = {
  adversarial: boolean;
  onToggleAdversarial: () => void;
  incident: string;
  onSelectIncident: (id: string) => void;
  speed: Speed;
  onSelectSpeed: (s: Speed) => void;
};

const ROOT_ID = "faultline-demo-root";
const MAX_LOG_MARKERS = 12;

function useFullscreen() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const onChange = () => {
      const root = document.getElementById(ROOT_ID);
      setActive(document.fullscreenElement != null && document.fullscreenElement === root);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggle = useCallback(() => {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    if (document.fullscreenElement === root) {
      void document.exitFullscreen?.();
    } else {
      void root.requestFullscreen?.();
    }
  }, []);
  const supported = typeof document !== "undefined" && "requestFullscreen" in document.documentElement;
  return { active, toggle, supported };
}

// Transport + timeline in one track: the scrubber is the timeline. Deploy
// markers, evidence ticks and the playhead share one time scale, so there is
// exactly one place on screen that answers "when".
export function TransportBar({
  adversarial,
  onToggleAdversarial,
  incident,
  onSelectIncident,
  speed,
  onSelectSpeed,
}: Props) {
  const sessionId = useInvestigation((s) => s.sessionId);
  const startNs = useInvestigation((s) => s.incidentStartNs);
  const endNs = useInvestigation((s) => s.incidentEndNs);
  const cursor = useInvestigation((s) => s.selectedEventTime);
  const heatmapMode = useInvestigation((s) => s.heatmapMode);
  const tourTarget = useInvestigation((s) => s.tourTarget);
  const wsStatus = useInvestigation((s) => s.wsStatus);
  const replay = useInvestigation((s) => s.replay);
  const timeline = useInvestigation((s) => s.timeline);
  const evidenceGraph = useInvestigation((s) => s.evidenceGraph);
  const correlations = useInvestigation((s) => s.correlations);
  const selectedChangeId = useInvestigation((s) => s.selectedChangeId);
  const selectChange = useInvestigation((s) => s.selectChange);
  const selectService = useInvestigation((s) => s.selectService);
  const selectOperator = useInvestigation((s) => s.selectOperator);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragNs, setDragNs] = useState<number | null>(null);
  const [available, setAvailable] = useState<string[] | null>(null);
  const fullscreen = useFullscreen();

  useEffect(() => {
    let cancelled = false;
    listIncidents()
      .then((list) => {
        if (cancelled) return;
        const served = new Set(list.map((i) => i.incident_id));
        setAvailable(Object.keys(SCENARIOS).filter((id) => served.has(id)));
      })
      .catch(() => {
        /* keep the single-option fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const incidentOptions =
    available == null || !available.includes(incident)
      ? [incident, ...(available ?? []).filter((id) => id !== incident)]
      : available;

  const ready = sessionId != null && startNs != null && endNs != null && endNs > startNs;
  const shownNs = dragNs ?? cursor ?? startNs ?? 0;
  const frac = ready ? Math.min(1, Math.max(0, (shownNs - startNs) / (endNs - startNs))) : 0;
  const toFrac = useCallback(
    (ns: number) => (ready ? Math.min(1, Math.max(0, (ns - startNs) / (endNs - startNs))) : 0),
    [ready, startNs, endNs],
  );

  const nsFromPointer = useCallback(
    (clientX: number): number | null => {
      const el = trackRef.current;
      if (!el || startNs == null || endNs == null) return null;
      const rect = el.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(startNs + f * (endNs - startNs));
    },
    [startNs, endNs],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = nsFromPointer(e.clientX);
    if (t != null) setDragNs(t);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragNs == null) return;
    const t = nsFromPointer(e.clientX);
    if (t != null) setDragNs(t);
  };
  const onPointerUp = () => {
    if (dragNs != null && sessionId) void seek(sessionId, dragNs);
    setDragNs(null);
  };

  // Timeline layers, in track fractions so the SVG can stay 0..100 wide.
  // Deploys and config changes always get a marker. Logs do too, unless the
  // incident carries so many that they would paint the whole track (RE2-OB
  // caps logs at 4000 lines).
  const markers = useMemo(() => {
    if (!timeline) return [];
    const changes = timeline.events.filter(
      (e) => e.signal === "deployment" || e.signal === "configuration",
    );
    const logs = timeline.events.filter((e) => e.signal === "log");
    return logs.length <= MAX_LOG_MARKERS ? [...changes, ...logs] : changes;
  }, [timeline]);
  const ticks = useMemo(() => {
    const nodes = evidenceGraph?.graph.nodes ?? [];
    return nodes.filter((n) => n.time_ns != null && n.kind !== "root_cause_candidate");
  }, [evidenceGraph]);
  const axis = useMemo(() => {
    if (!ready) return [];
    return [0, 1 / 3, 2 / 3, 1].map((f) => ({ f, label: fmtOffset(startNs + f * (endNs - startNs), startNs) }));
  }, [ready, startNs, endNs]);
  const selectedDeploy = correlations.find((c) => c.change_id === selectedChangeId);

  const pillClass =
    wsStatus === "live" ? "pill live" : wsStatus === "reconnecting" ? "pill reconnecting" : "pill";
  const pillText =
    wsStatus === "live" ? "connected" : wsStatus === "reconnecting" ? "reconnecting…" : "connecting…";
  const stateText = replay.state === "stopped" ? "ready" : replay.state;

  return (
    <div className="transport" data-testid="replay-scrubber">
      <div className="brand-block">
        <span className="brand-mark" aria-hidden="true" />
        <h1>Faultline</h1>
      </div>

      <select
        className="speed-select incident-select"
        data-testid="incident-picker"
        aria-label="Incident"
        value={incident}
        onChange={(e) => onSelectIncident(e.target.value)}
      >
        {incidentOptions.map((id) => (
          <option key={id} value={id}>
            {SCENARIOS[id]?.title ?? id}
          </option>
        ))}
      </select>

      <div className="transport-group" data-testid="replay-controls">
        <button
          type="button"
          className="primary"
          title="Replays the incident from the start"
          disabled={!sessionId}
          onClick={() => sessionId && play(sessionId)}
        >
          Play
        </button>
        <button type="button" disabled={!sessionId} onClick={() => sessionId && pause(sessionId)}>
          Pause
        </button>
        <button type="button" disabled={!sessionId} onClick={() => sessionId && reset(sessionId)}>
          Reset
        </button>
      </div>

      <div
        ref={trackRef}
        className={tourTarget === "track" ? "scrubber tour-target" : "scrubber"}
        role="slider"
        aria-label="Replay position"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(frac * 100)}
        data-testid="timeline"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="scrubber-track">
          <div className="scrubber-fill" style={{ width: `${frac * 100}%` }} />
        </div>
        {ticks.map((n) => (
          <span
            key={n.id}
            className="evidence-tick"
            style={{
              left: `${toFrac(n.time_ns!) * 100}%`,
              background: KIND_COLORS[n.kind],
              opacity: n.time_ns! <= shownNs ? 1 : 0.35,
            }}
            aria-hidden="true"
          />
        ))}
        {markers.map((m) => {
          const isSelected = selectedDeploy != null && m.event_time_ns === selectedDeploy.deployed_at_ns;
          const isDeploy = m.signal !== "log";
          return (
            <button
              key={m.event_id}
              type="button"
              className={`deploy-marker${isDeploy ? " deploy" : " log"}${isSelected ? " selected" : ""}`}
              data-testid="deploy-marker"
              title={`${fmtOffset(m.event_time_ns, startNs)} · ${m.summary}`}
              style={{ left: `${toFrac(m.event_time_ns) * 100}%` }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                const match = correlations.find((c) => c.deployed_at_ns === m.event_time_ns);
                if (match) {
                  selectChange(match.change_id);
                  selectService(match.service);
                  selectOperator("deploy_temporal_join");
                } else if (m.service) {
                  selectService(m.service);
                }
              }}
            />
          );
        })}
        <div className="scrubber-thumb" style={{ left: `${frac * 100}%` }} />
        <div className="scrubber-axis" aria-hidden="true">
          {axis.map((a, i) => (
            <span
              key={a.f}
              className="axis-tick"
              style={{
                left: `${a.f * 100}%`,
                transform: i === 0 ? "none" : i === axis.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {a.label}
            </span>
          ))}
        </div>
      </div>

      <span
        className="scrubber-time"
        data-testid="scrubber-time"
        title={ready && startNs != null ? `${fmtOffset(shownNs, startNs)} after the incident recording starts` : undefined}
      >
        {ready && startNs != null ? fmtIn(shownNs, startNs) : "0.0 s in"}
      </span>
      <InfoTip label="Event time, explained">
        The clock runs on event time: when the telemetry actually happened inside the incident,
        not when it arrived. Drag anywhere on the track to seek; yellow bars are deployments and
        logs, small dots are pieces of evidence as they land.
      </InfoTip>

      <select
        className="speed-select"
        data-testid="speed-select"
        aria-label="Replay speed"
        value={speed}
        disabled={!sessionId}
        onChange={(e) => {
          const v = e.target.value as Speed;
          onSelectSpeed(v);
          if (sessionId) void setSpeed(sessionId, v);
        }}
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            speed {s}×
          </option>
        ))}
      </select>

      <details className="engine-menu">
        <summary className="chip-toggle">Advanced</summary>
        <div className="engine-pop">
          <button
            type="button"
            className="chip-toggle"
            disabled={!sessionId}
            data-testid="heatmap-mode-toggle"
            onClick={() => {
              if (!sessionId) return;
              const next = heatmapMode === "streaming" ? "precomputed" : "streaming";
              void setProjectionMode(sessionId, next);
            }}
          >
            Heatmap: {heatmapMode}
          </button>
          <button
            type="button"
            className="chip-toggle"
            data-testid="adversarial-toggle"
            onClick={onToggleAdversarial}
          >
            {adversarial ? "Adversarial on" : "Adversarial off"}
          </button>
          <p className="hint">
            Adversarial replays the same incident with events delivered late and out of order. The
            engine should reach the same answer.
          </p>
        </div>
      </details>

      {fullscreen.supported && (
        <button
          type="button"
          className="chip-toggle theater-button"
          data-testid="theater-toggle"
          aria-pressed={fullscreen.active}
          onClick={fullscreen.toggle}
        >
          {fullscreen.active ? "Exit full screen" : "Full screen"}
        </button>
      )}

      <div className="status-cluster">
        <span className={pillClass} data-testid="connection">
          <span className="dot" aria-hidden="true" />
          {pillText}
        </span>
        <span className="pill" data-testid="replay-state">
          {stateText}
        </span>
      </div>
    </div>
  );
}
