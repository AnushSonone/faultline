import { useCallback, useEffect, useRef, useState } from "react";
import { listIncidents, pause, play, reset, seek, setProjectionMode, setSpeed } from "../api/client";
import { SCENARIOS } from "../content/scenarios";
import { useInvestigation } from "../state/investigation";

const SPEEDS = ["1", "10", "60"] as const;

function fmtOffset(ns: number, startNs: number): string {
  return `t+${((ns - startNs) / 1e9).toFixed(2)}s`;
}

type Props = {
  adversarial: boolean;
  onToggleAdversarial: () => void;
  incident: string;
  onSelectIncident: (id: string) => void;
};

export function ReplayScrubber({
  adversarial,
  onToggleAdversarial,
  incident,
  onSelectIncident,
}: Props) {
  const sessionId = useInvestigation((s) => s.sessionId);
  const startNs = useInvestigation((s) => s.incidentStartNs);
  const endNs = useInvestigation((s) => s.incidentEndNs);
  const cursor = useInvestigation((s) => s.selectedEventTime);
  const heatmapMode = useInvestigation((s) => s.heatmapMode);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragNs, setDragNs] = useState<number | null>(null);
  const [speed, setSpeedLocal] = useState<string>("10");
  const [available, setAvailable] = useState<string[] | null>(null);

  // Which curated scenarios the server can actually serve. Fetched once;
  // while loading (or on failure) the picker shows just the current incident.
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
  const frac = ready
    ? Math.min(1, Math.max(0, (shownNs - startNs) / (endNs - startNs)))
    : 0;

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
    if (dragNs != null && sessionId) {
      void seek(sessionId, dragNs);
    }
    setDragNs(null);
  };

  return (
    <div className="scrubber-row" data-testid="replay-scrubber">
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
      </div>
      <div
        ref={trackRef}
        className="scrubber"
        role="slider"
        aria-label="Replay position"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(frac * 100)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="scrubber-track">
          <div className="scrubber-fill" style={{ width: `${frac * 100}%` }} />
        </div>
        <div className="scrubber-thumb" style={{ left: `${frac * 100}%` }} />
      </div>
      <span className="scrubber-time" data-testid="scrubber-time">
        {ready && startNs != null ? fmtOffset(shownNs, startNs) : "t+0.00s"}
      </span>
      <select
        className="speed-select"
        data-testid="speed-select"
        aria-label="Replay speed"
        value={speed}
        disabled={!sessionId}
        onChange={(e) => {
          const v = e.target.value;
          setSpeedLocal(v);
          if (sessionId) void setSpeed(sessionId, v);
        }}
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      <div className="mode-group">
        <span className="eyebrow">Engine</span>
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
      </div>
    </div>
  );
}
