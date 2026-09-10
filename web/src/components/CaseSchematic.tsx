import { useEffect, useMemo, useState } from "react";
import type { CaseSchematic as SchematicData } from "../content/scenarios";

type Props = { schematic: SchematicData };

const W = 264;
const H = 104;
const R = 11;
const NODE_Y_TOP = 30;
const NODE_Y_BOTTOM = 68;

// Column x positions: the origin sits right, propagation waves step left,
// bystanders (unaffected callees) sit below the origin.
function columnX(index: number, columns: number): number {
  const pad = 40;
  if (columns <= 1) return W - pad;
  const span = W - pad * 2;
  return W - pad - (span / (columns - 1)) * index;
}

function shortName(service: string): string {
  return service.replace(/service$/i, "");
}

const SIGNAL_TERM: Record<SchematicData["signal"], string> = {
  memory: "memory",
  cpu: "CPU",
  latency: "p99 latency",
};

type Placed = {
  id: string;
  x: number;
  y: number;
  wave: number;
  column: number;
  role: "origin" | "wave" | "bystander";
};

// The case as a diagram: the injected fault at the origin, propagating along
// caller edges hop by hop. Click to replay it; the static frame is the end
// state so the schematic reads without motion.
export function CaseSchematic({ schematic }: Props) {
  const [playing, setPlaying] = useState(false);
  const [run, setRun] = useState(0);

  const placed = useMemo<Placed[]>(() => {
    const columns = 1 + schematic.waves.length;
    const out: Placed[] = [
      { id: schematic.origin, x: columnX(0, columns), y: NODE_Y_TOP, wave: 0, column: 0, role: "origin" },
    ];
    schematic.waves.forEach((wave, i) => {
      const x = columnX(i + 1, columns);
      const ys = wave.length === 1 ? [NODE_Y_TOP] : wave.map((_, j) => (j === 0 ? NODE_Y_TOP : NODE_Y_BOTTOM));
      wave.forEach((svc, j) => out.push({ id: svc, x, y: ys[j], wave: i + 1, column: i + 1, role: "wave" }));
    });
    (schematic.bystanders ?? []).forEach((svc) => {
      out.push({ id: svc, x: columnX(0, columns), y: NODE_Y_BOTTOM, wave: -1, column: 0, role: "bystander" });
    });
    return out;
  }, [schematic]);

  const byId = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const lastWave = schematic.waves.length;
  // Timeline in ms: deploy pulse, origin flares, each hop lands 600 ms later.
  const originAt = schematic.deploy ? 500 : 100;
  const hopAt = (wave: number) => originAt + 500 + (wave - 1) * 600;
  const totalMs = hopAt(lastWave) + 900;

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setPlaying(false), totalMs);
    return () => clearTimeout(t);
  }, [playing, run, totalMs]);

  useEffect(() => {
    setPlaying(false);
  }, [schematic]);

  const start = () => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPlaying(false);
      return;
    }
    setRun((n) => n + 1);
    setPlaying(true);
  };

  const delay = (ms: number) => (playing ? { animationDelay: `${ms}ms` } : undefined);
  const callers = schematic.waves.reduce((n, w) => n + w.length, 0);

  return (
    <figure
      className={playing ? "schematic playing" : "schematic"}
      data-testid="briefing-schematic"
      role="button"
      tabIndex={0}
      aria-label="Replay the fault propagation schematic"
      title="Click to replay the propagation"
      onClick={start}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          start();
        }
      }}
    >
      <svg key={run} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-hidden="true">
        <defs>
          <marker id="schematic-arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" className="schematic-arrowhead" />
          </marker>
        </defs>
        {schematic.edges.map(([caller, callee]) => {
          const a = byId.get(caller);
          const b = byId.get(callee);
          if (!a || !b) return null;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const x1 = a.x + ux * (R + 2);
          const y1 = a.y + uy * (R + 2);
          const x2 = b.x - ux * (R + 3);
          const y2 = b.y - uy * (R + 3);
          // The hop lands when the caller's wave does; bystander edges never light up.
          const affected = a.role === "wave" && b.role !== "bystander";
          const cls = affected ? "schematic-edge affected" : "schematic-edge";
          const style = affected ? delay(hopAt(a.wave) - 350) : undefined;
          // An edge that skips a column arcs over the nodes in between.
          if (Math.abs(a.column - b.column) >= 2) {
            const mx = (x1 + x2) / 2;
            const my = Math.min(y1, y2) - 22;
            return (
              <path
                key={`${caller}-${callee}`}
                className={cls}
                d={`M ${x1} ${y1 - 4} Q ${mx} ${my} ${x2} ${y2 - 4}`}
                fill="none"
                markerEnd="url(#schematic-arrow)"
                style={style}
              />
            );
          }
          return (
            <line
              key={`${caller}-${callee}`}
              className={cls}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              markerEnd="url(#schematic-arrow)"
              style={style}
            />
          );
        })}
        {placed.map((p) => {
          const at = p.role === "origin" ? originAt : p.role === "wave" ? hopAt(p.wave) : 0;
          const cls = `schematic-node ${p.role}`;
          return (
            <g key={p.id} className={cls} style={p.role === "bystander" ? undefined : delay(at)}>
              {p.role === "origin" && schematic.deploy && (
                <circle className="schematic-deploy" cx={p.x} cy={p.y} r={R + 4} style={delay(0)} />
              )}
              <circle className="schematic-dot" cx={p.x} cy={p.y} r={R} />
              <text className="schematic-label" x={p.x} y={p.y + R + 11} textAnchor="middle">
                {shortName(p.id)}
              </text>
            </g>
          );
        })}
        {schematic.deploy && (
          <text className="schematic-tag" x={byId.get(schematic.origin)?.x ?? W - 40} y={10} textAnchor="middle">
            deploy t+{schematic.deploy.atS} s
          </text>
        )}
        <text className="schematic-caption" x={4} y={H - 4} style={delay(hopAt(lastWave) + 200)}>
          {SIGNAL_TERM[schematic.signal]} anomaly at t+{schematic.injectedAtS} s, then {callers}{" "}
          {callers === 1 ? "caller degrades" : "callers degrade"}
        </text>
      </svg>
    </figure>
  );
}
