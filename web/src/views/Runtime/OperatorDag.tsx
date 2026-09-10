import { useMemo, useRef } from "react";
import { useInvestigation } from "../../state/investigation";
import { fmtCount } from "../../lib/format";
import { buildOperatorDag, layoutOperatorDag, type OperatorDag as Dag } from "../../lib/operatorDag";
import type { OperatorNode } from "../../types/protocol";
import { InfoTip } from "../../components/InfoTip";
import { useWidth } from "./useWidth";

const NODE_W = 30;
const NODE_H = 18;
const RANK_PITCH = 64;
// Half a label plus a little: the outermost labels must stay inside the box.
const PADDING = 48;
const LABEL_DY = 13;
const STATEFUL = new Set(["Window", "P99", "TemporalJoin"]);
// Narrow drawers squeeze the sibling pitch before anything is clipped.
const PITCH_MIN = 76;
const PITCH_MAX = 132;

type Props = {
  operators: OperatorNode[];
  sharedIds: Set<string>;
  limitingId: string | null;
};

function utilization(o: OperatorNode): number {
  return o.queue_capacity > 0 ? o.queue_depth / o.queue_capacity : 0;
}

// The live operator DAG, ranked top to bottom (source first), as inline SVG
// so every label is a DOM text node the layout sweep can clip against the
// drawer's scroll box. Nodes are the engine's OperatorNodes plus the ghost
// endpoints the edges reference but the inspector does not instrument.
export function OperatorDagView({ operators, sharedIds, limitingId }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useWidth(wrapRef);
  const selectedOperator = useInvestigation((s) => s.selectedOperator);
  const selectOperator = useInvestigation((s) => s.selectOperator);

  const dag: Dag = useMemo(() => buildOperatorDag(operators), [operators]);
  const layout = useMemo(() => {
    // Sibling pitch follows the measured width so three siblings fit a
    // 290px drawer and spread out in a wider one; labels are up to ~88px.
    const siblingPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, Math.floor((width - PADDING * 2) / 2)));
    return layoutOperatorDag(dag, { direction: "vertical", rankPitch: RANK_PITCH, siblingPitch, padding: PADDING });
  }, [dag, width]);
  const byId = useMemo(() => new Map(operators.map((o) => [o.stable_id, o])), [operators]);
  const pos = useMemo(() => new Map(layout.placed.map((p) => [p.id, p])), [layout]);

  const siblingPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, Math.floor((width - PADDING * 2) / 2)));
  // The clickable region of a node: its box, both labels, and the gutter
  // around them, so a click near a node always lands on it.
  const hitW = siblingPitch - 8;
  const hitH = NODE_H + LABEL_DY * 2 + 16;
  const offsetX = Math.max(0, (width - layout.width) / 2);
  const height = layout.height + LABEL_DY * 2 + 4;
  const toggle = (id: string) => selectOperator(selectedOperator === id ? null : id);

  return (
    <>
      <div className="dag-wrap" ref={wrapRef} style={{ height }} data-testid="operator-dag">
        <svg className="dag-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="operator pipeline">
          <defs>
            <marker id="dag-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0,0.5 L8,4 L0,7.5 Z" className="dag-arrow" />
            </marker>
          </defs>
          {dag.edges.map((e) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            const from = byId.get(e.from);
            const rows = from ? from.rows_out : 0;
            const ghost = !byId.has(e.from) || !byId.has(e.to);
            const w = Math.min(4, 1 + Math.log10(Math.max(1, rows)));
            return (
              <line
                key={`${e.from}>${e.to}`}
                className={ghost ? "dag-edge ghost" : "dag-edge"}
                x1={a.x + offsetX}
                y1={a.y + NODE_H / 2 + 1}
                x2={b.x + offsetX}
                y2={b.y - NODE_H / 2 - 1}
                strokeWidth={w}
                markerEnd="url(#dag-arrow)"
              />
            );
          })}
          {dag.nodes.map((n) => {
            const p = pos.get(n.id);
            if (!p) return null;
            const op = byId.get(n.id);
            const x = p.x + offsetX;
            const u = op ? utilization(op) : 0;
            const cls = [
              "dag-node",
              n.ghost ? "ghost" : STATEFUL.has(n.type) ? "stateful" : "stateless",
              sharedIds.has(n.id) ? "shared" : "",
              selectedOperator === n.id ? "selected" : "",
              n.id === limitingId ? "limiting" : "",
              u >= 0.85 ? "hot" : u >= 0.5 ? "warm" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const sub = op ? `${fmtCount(op.rows_in)} → ${fmtCount(op.rows_out)}` : "no counters";
            return (
              <g
                key={n.id}
                className={cls}
                role="button"
                tabIndex={0}
                aria-label={`${n.type} ${n.id}`}
                aria-pressed={selectedOperator === n.id}
                onClick={() => toggle(n.id)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    toggle(n.id);
                  }
                }}
              >
                <rect
                  className="dag-hit"
                  x={x - hitW / 2}
                  y={p.y - NODE_H / 2 - 8}
                  width={hitW}
                  height={hitH}
                  rx={8}
                />
                {sharedIds.has(n.id) && (
                  <rect className="dag-underlay" x={x - NODE_W / 2 - 5} y={p.y - NODE_H / 2 - 5} width={NODE_W + 10} height={NODE_H + 10} rx={8} />
                )}
                <rect className="dag-box" x={x - NODE_W / 2} y={p.y - NODE_H / 2} width={NODE_W} height={NODE_H} rx={5} />
                <text className="dag-label dag-type" x={x} y={p.y + NODE_H / 2 + LABEL_DY} textAnchor="middle">
                  {n.type}
                </text>
                <text className="dag-label dag-sub" x={x} y={p.y + NODE_H / 2 + LABEL_DY * 2} textAnchor="middle">
                  {sub}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="op-chips" aria-label="Operators">
        {dag.nodes.map((n) => (
          <button
            key={n.id}
            type="button"
            className={selectedOperator === n.id ? "chip-toggle active" : "chip-toggle"}
            data-testid={`op-${n.id}`}
            title={n.id}
            onClick={() => toggle(n.id)}
          >
            {n.type}
          </button>
        ))}
      </div>
      <div className="dag-legend" aria-label="Node key">
        <span className="dag-key">
          <span className="dag-swatch stateful" aria-hidden="true" /> stateful
        </span>
        <span className="dag-key">
          <span className="dag-swatch stateless" aria-hidden="true" /> stateless
        </span>
        <span className="dag-key">
          <span className="dag-swatch ghost" aria-hidden="true" /> not instrumented
        </span>
        <span className="dag-key">
          <span className="dag-swatch warm" aria-hidden="true" /> queue pressure
        </span>
        <span className="dag-key">
          <span className="dag-swatch shared" aria-hidden="true" /> in last query plan
        </span>
        <InfoTip label="Node key">
          Filled: stateful (window, sketch, join). Outline: stateless. Dashed: not instrumented.
          Border turns amber at 50% queue utilization or on the limiting operator under pressure.
          Amber underlay: shared with the last query plan.
        </InfoTip>
      </div>
    </>
  );
}
