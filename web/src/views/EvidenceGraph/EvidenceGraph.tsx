import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
import { useInvestigation } from "../../state/investigation";
import { COLORS } from "../../theme/tokens";
import { KIND_COLORS, KIND_LABELS } from "../../theme/kinds";
import { InfoTip } from "../../components/InfoTip";
import { EmptyState } from "../../components/EmptyState";
import { LANE_TITLES, layoutEvidence, type EvidenceLayout } from "../../lib/evidenceLayout";
import { condenseEvidence } from "../../lib/evidenceCondense";
import { stableServiceOrder } from "../../lib/evidenceOrder";
import { fmtOffset } from "../../lib/format";
import { checkCyLabels, exposeForTests, layoutCheckEnabled } from "../../lib/layoutCheck";

const FONT = '"Inter Variable", Inter, system-ui, -apple-system, sans-serif';
const LABEL_FONT = `11px ${FONT}`;
const NODE = 16;
const LABEL_GAP = 8;
const ROW_PITCH_MAX = 30;
const ROW_PITCH_MIN = 22;
const ENTER_MS = 320;
const ENTER_SLIDE = 14;
const MOVE_MS = 300;
const EDGE_FADE_MS = 160;

const HEAD_FONT = `11px ${FONT}`;
const HEAD_TRACKING = 11 * 0.06; // letter-spacing on .lane-head

let ctx: CanvasRenderingContext2D | null = null;
// Width of a lane header as the DOM draws it (uppercase, tracked).
function measureHead(text: string): number {
  if (!ctx) measure("");
  if (!ctx) return text.length * 7;
  ctx.font = HEAD_FONT;
  return ctx.measureText(text.toUpperCase()).width + HEAD_TRACKING * text.length;
}
function measure(text: string): number {
  if (!ctx) {
    const c = document.createElement("canvas").getContext("2d");
    if (!c) return text.length * 6.5;
    ctx = c;
  }
  ctx.font = LABEL_FONT;
  return ctx.measureText(text).width;
}

type Tip = { x: number; y: number; title: string; meta: string } | null;
type XY = { x: number; y: number };

function sameXY(a: XY | undefined, b: XY): boolean {
  return a != null && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}

// Lane layout: change/log → metric anomalies → degradations → ranked causes,
// grouped by service. Positions are deterministic (lib/evidenceLayout) and
// the group order has memory (lib/evidenceOrder), so frames that change
// nothing move nothing. Every motion is one purposeful tween: a node slides
// in from the left when it lands, glides once when its slot changes, and a
// retarget replaces the tween in flight rather than queueing behind it.
export function EvidenceGraphPanel() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const targetRef = useRef<Map<string, XY>>(new Map());
  const dataSigRef = useRef<Map<string, string>>(new Map());
  const orderRef = useRef<string[]>([]);
  const pitchRef = useRef<{ pitch: number; w: number }>({ pitch: ROW_PITCH_MAX, w: 0 });
  const panRef = useRef<XY | null>(null);
  const evidenceGraph = useInvestigation((s) => s.evidenceGraph);
  const sessionId = useInvestigation((s) => s.sessionId);
  const cursor = useInvestigation((s) => s.selectedEventTime);
  const startNs = useInvestigation((s) => s.incidentStartNs);
  const selectedService = useInvestigation((s) => s.selectedService);
  const hoveredService = useInvestigation((s) => s.hoveredService);
  const selectService = useInvestigation((s) => s.selectService);
  const hoverService = useInvestigation((s) => s.hoverService);
  const [strongestOnly, setStrongestOnly] = useState(false);
  const [tip, setTip] = useState<Tip>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<XY>({ x: 0, y: 0 });
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  // Display graph: raw for small incidents, condensed per service/metric for
  // real ones (RE2-OB carries ~1450 anomaly nodes).
  const display = useMemo(
    () => condenseEvidence(evidenceGraph?.graph.nodes ?? [], evidenceGraph?.graph.edges ?? []),
    [evidenceGraph],
  );
  const nodes = display.nodes;
  const empty = nodes.length === 0;

  // Session memory: group order and row pitch reset when the incident does.
  useEffect(() => {
    orderRef.current = [];
    pitchRef.current = { pitch: ROW_PITCH_MAX, w: 0 };
    targetRef.current = new Map();
    dataSigRef.current = new Map();
  }, [sessionId]);

  const order = useMemo(() => {
    const next = stableServiceOrder(orderRef.current, nodes);
    orderRef.current = next;
    return next;
  }, [nodes]);

  // Row pitch shrinks (never below 22px) so the whole graph fits the panel
  // height where it can, and only ever shrinks within a session so adding a
  // row never reflows the rows above it. A real resize (width off by more
  // than 10%) recomputes from scratch.
  const rowPitch = useMemo(() => {
    const rows = layoutEvidence(nodes, { measure, measureHead, compact: true, order, nodeSize: NODE, labelGap: LABEL_GAP }).rows;
    let computed = ROW_PITCH_MAX;
    if (rows > 1 && viewport.h > 0) {
      const avail = viewport.h - 2 * 12 - NODE;
      computed = Math.max(ROW_PITCH_MIN, Math.min(ROW_PITCH_MAX, Math.floor(avail / (rows - 1))));
    }
    const prev = pitchRef.current;
    const resized = prev.w > 0 && Math.abs(viewport.w - prev.w) / prev.w > 0.1;
    const pitch = resized || prev.w === 0 ? computed : Math.min(prev.pitch, computed);
    pitchRef.current = { pitch, w: viewport.w };
    return pitch;
  }, [nodes, order, viewport.h, viewport.w]);

  const layout: EvidenceLayout = useMemo(
    () => layoutEvidence(nodes, { measure, measureHead, compact: true, order, nodeSize: NODE, labelGap: LABEL_GAP, rowPitch }),
    [nodes, order, rowPitch],
  );

  useEffect(() => {
    if (!canvasRef.current || cyRef.current) return;
    const cy = cytoscape({
      container: canvasRef.current,
      style: [
        {
          selector: "node",
          style: {
            shape: "round-rectangle",
            width: NODE,
            height: NODE,
            "background-color": "data(color)",
            label: "data(label)",
            color: COLORS.fg,
            "font-family": FONT,
            "font-size": 11,
            "text-halign": "right",
            "text-valign": "center",
            "text-margin-x": LABEL_GAP,
            "text-background-color": COLORS.panel,
            "text-background-opacity": 0.92,
            "text-background-padding": "2px",
            "text-background-shape": "roundrectangle",
            "overlay-opacity": 0,
            "transition-property": "opacity",
            "transition-duration": 200,
          },
        },
        { selector: "node.future", style: { opacity: 0.25 } },
        { selector: "node.dim", style: { opacity: 0.18 } },
        { selector: "node.spot", style: { "border-width": 2, "border-color": COLORS.accent } },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": COLORS.borderStrong,
            "target-arrow-color": COLORS.borderStrong,
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.8,
            "curve-style": "bezier",
            "transition-property": "opacity",
            "transition-duration": 200,
          },
        },
        {
          selector: "edge.contradicts",
          style: {
            "line-color": COLORS.danger,
            "target-arrow-color": COLORS.danger,
            "line-style": "dashed",
          },
        },
        { selector: "edge.dim", style: { opacity: 0.12 } },
        { selector: "edge.future", style: { opacity: 0.2 } },
      ],
      layout: { name: "preset" },
      userZoomingEnabled: false,
      userPanningEnabled: false,
      boxSelectionEnabled: false,
      autounselectify: true,
    });
    cy.on("tap", "node", (evt) => {
      const svc = evt.target.data("service");
      if (svc) selectService(svc);
    });
    cy.on("mouseover", "node", (evt) => {
      const n = evt.target;
      const rp = n.renderedPosition();
      setTip({ x: rp.x + NODE, y: rp.y + NODE, title: n.data("full"), meta: n.data("meta") });
      const svc = n.data("service");
      if (svc) hoverService(svc);
      if (canvasRef.current) canvasRef.current.style.cursor = "pointer";
    });
    cy.on("mouseout", "node", () => {
      setTip(null);
      hoverService(null);
      if (canvasRef.current) canvasRef.current.style.cursor = "";
    });
    cyRef.current = cy;
    if (canvasRef.current) exposeForTests(canvasRef.current, cy);
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [selectService, hoverService]);

  // Diff the graph into cytoscape. Only a changed target moves a node, and a
  // move replaces any tween already running on it.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (!evidenceGraph) {
      cy.elements().remove();
      targetRef.current = new Map();
      dataSigRef.current = new Map();
      return;
    }
    const g = display;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nextIds = new Set(g.nodes.map((n) => n.id));
    cy.nodes().forEach((n) => {
      if (!nextIds.has(n.id())) {
        n.remove();
        targetRef.current.delete(n.id());
        dataSigRef.current.delete(n.id());
      }
    });
    const edgeIds = new Set(g.edges.map((e) => e.id));
    cy.edges().forEach((e) => {
      if (!edgeIds.has(e.id())) e.remove();
    });
    const placed = new Map(layout.placed.map((p) => [p.id, p]));
    const firstFill = targetRef.current.size === 0;
    const arrived = new Set<string>();
    cy.batch(() => {
      for (const n of g.nodes) {
        const p = placed.get(n.id);
        if (!p) continue;
        const target = { x: p.x, y: p.y };
        const data = {
          id: n.id,
          label: p.label,
          full: n.label,
          meta: [
            KIND_LABELS[n.kind] ?? n.kind,
            n.time_ns != null ? `first ${fmtOffset(n.time_ns, startNs)}` : null,
            n.count != null && n.count > 1 ? `${n.count} raw anomalies` : null,
            `strength ${n.strength.toFixed(2)}`,
          ]
            .filter(Boolean)
            .join(" · "),
          service: n.service ?? undefined,
          kind: n.kind,
          time: n.time_ns ?? null,
          color: KIND_COLORS[n.kind],
          strength: n.strength,
        };
        const sig = `${data.label}|${data.meta}|${data.color}|${data.time}`;
        const existing = cy.$id(n.id);
        if (existing.empty()) {
          arrived.add(n.id);
          if (reduce || firstFill) {
            cy.add({ data, position: target });
          } else {
            const el = cy.add({ data, position: { x: target.x - ENTER_SLIDE, y: target.y } });
            el.style("opacity", 0);
            el.animate(
              { position: target, style: { opacity: 1 } },
              { duration: ENTER_MS, easing: "ease-out-cubic", queue: false, complete: () => el.removeStyle("opacity") },
            );
          }
          targetRef.current.set(n.id, target);
          dataSigRef.current.set(n.id, sig);
          continue;
        }
        if (dataSigRef.current.get(n.id) !== sig) {
          existing.data(data);
          dataSigRef.current.set(n.id, sig);
        }
        if (!sameXY(targetRef.current.get(n.id), target)) {
          targetRef.current.set(n.id, target);
          if (reduce) {
            existing.stop(true, false);
            existing.position(target);
          } else {
            existing.stop(true, false);
            existing.animate({ position: target }, { duration: MOVE_MS, easing: "ease-in-out", queue: false });
          }
        }
      }
      for (const e of g.edges) {
        if (cy.$id(e.id).nonempty()) continue;
        if (cy.$id(e.from).empty() || cy.$id(e.to).empty()) continue;
        const el = cy.add({
          data: { id: e.id, source: e.from, target: e.to, kind: e.kind },
          classes: e.kind === "contradicts" ? "contradicts" : "",
        });
        const fresh = arrived.has(e.from) || arrived.has(e.to);
        if (fresh && !reduce && !firstFill) {
          el.style("opacity", 0);
          // A fresh edge has an empty queue, so delay + animate is one sequence.
          el.delay(ENTER_MS - EDGE_FADE_MS).animate(
            { style: { opacity: 1 } },
            { duration: EDGE_FADE_MS, complete: () => el.removeStyle("opacity") },
          );
        }
      }
    });
    if (layoutCheckEnabled()) requestAnimationFrame(() => checkCyLabels(cy, "evidence-graph"));
  }, [evidenceGraph, display, layout, startNs]);

  // Visual state that does not move anything: future (ahead of the cursor),
  // dim (strongest-path filter or a spotlighted service), spot (that service).
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !evidenceGraph) return;
    const strengths = display.nodes.map((n) => n.strength).sort((a, b) => a - b);
    const median = strengths.length ? strengths[Math.floor(strengths.length / 2)] : 0;
    const focus = hoveredService ?? selectedService;
    cy.batch(() => {
      cy.elements().removeClass("dim future spot");
      cy.nodes().forEach((n) => {
        const t = n.data("time") as number | null;
        const svc = n.data("service") as string | undefined;
        const weak = strongestOnly && n.data("strength") < median && n.data("kind") !== "root_cause_candidate";
        const offFocus = focus != null && svc !== focus;
        if (cursor != null && t != null && t > cursor) n.addClass("future");
        if (weak || offFocus) n.addClass("dim");
        if (focus != null && svc === focus) n.addClass("spot");
      });
      cy.edges().forEach((e) => {
        const s = e.source();
        const d = e.target();
        if (s.hasClass("dim") || d.hasClass("dim")) e.addClass("dim");
        else if (s.hasClass("future") || d.hasClass("future")) e.addClass("future");
      });
    });
  }, [evidenceGraph, display, cursor, strongestOnly, hoveredService, selectedService]);

  // Size the canvas to the layout, pick a zoom that fits the width (never
  // above 1), and centre the graph: horizontally always, vertically when it
  // is shorter than the box. Taller graphs pin to the top and scroll.
  const applyViewport = useCallback(() => {
    const wrap = scrollRef.current;
    const cy = cyRef.current;
    if (!wrap || !cy) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    setViewport({ w, h });
    const z = layout.width > 0 ? Math.min(1, w / layout.width) : 1;
    // Centre what is actually drawn: node bodies, their labels, and the lane
    // headers (DOM text that does not scale with the canvas), not the
    // layout's reserved width.
    let leftExt = Number.POSITIVE_INFINITY;
    let rightExt = 0;
    for (const p of layout.placed) {
      leftExt = Math.min(leftExt, (p.x - NODE / 2) * z);
      rightExt = Math.max(rightExt, (p.x + NODE / 2 + LABEL_GAP + measure(p.label)) * z);
    }
    const headScale = Math.max(8.5 / 11, z); // must match the lane-head font scaling below
    layout.laneX.forEach((x, i) => {
      const left = (x - NODE / 2) * z;
      leftExt = Math.min(leftExt, left);
      rightExt = Math.max(rightExt, left + measureHead(LANE_TITLES[i]) * headScale);
    });
    if (!Number.isFinite(leftExt)) leftExt = 0;
    const drawnW = rightExt - leftExt;
    const drawnH = layout.height * z;
    const next = {
      x: Math.max(0, (w - drawnW) / 2 - leftExt),
      y: drawnH < h ? (h - drawnH) / 2 : 0,
    };
    setZoom(z);
    setPan(next);
    cy.resize();
    const prevPan = cy.pan();
    const prevZoom = cy.zoom();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const firstFill = panRef.current == null;
    panRef.current = next;
    if (reduce || firstFill || prevZoom !== z) {
      cy.zoom(z);
      cy.pan(next);
      return;
    }
    // Growth re-centres the block: glide the pan instead of jumping it.
    if (Math.abs(prevPan.x - next.x) > 0.5 || Math.abs(prevPan.y - next.y) > 0.5) {
      cy.stop(true, false);
      cy.animate({ pan: next }, { duration: MOVE_MS, easing: "ease-in-out", queue: false });
    }
  }, [layout.width, layout.height]);

  useLayoutEffect(() => {
    applyViewport();
  }, [applyViewport, empty]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => applyViewport());
    observer.observe(el);
    return () => observer.disconnect();
  }, [applyViewport]);

  const canvasHeight = Math.max(viewport.h, Math.ceil(layout.height * zoom));

  return (
    <div className="evidence-graph-wrap" data-testid="evidence-graph">
      <div className="evidence-toolbar">
        <button
          type="button"
          className={strongestOnly ? "chip-toggle active" : "chip-toggle"}
          data-testid="evidence-graph-strongest"
          onClick={() => setStrongestOnly(!strongestOnly)}
        >
          Strongest path
        </button>
        <InfoTip>
          Strongest path dims evidence below the median strength. Hover a node for its full
          label; hover a service anywhere to spotlight its evidence here.
        </InfoTip>
        <div className="legend" aria-hidden="true">
          {Object.entries(KIND_LABELS).map(([kind, label]) => (
            <span key={kind} className="legend-item">
              <span className="legend-swatch" style={{ background: KIND_COLORS[kind] }} /> {label}
            </span>
          ))}
          <span className="legend-item">
            <span className="legend-swatch dashed" /> points the other way
          </span>
        </div>
      </div>
      {empty && (
        <EmptyState glyph="◇" title="No evidence yet. Play or seek past the incident onset." />
      )}
      <div className="lane-heads" aria-hidden="true" style={empty ? { display: "none" } : undefined}>
        {layout.laneX.map((x, i) => {
          const headScale = Math.max(8.5 / 11, zoom);
          const headW = measureHead(LANE_TITLES[i]) * headScale;
          const raw = pan.x + (x - NODE / 2) * zoom;
          // Never let a header run past the box (headers do not scale with zoom).
          const left = viewport.w > 0 ? Math.max(0, Math.min(raw, viewport.w - headW)) : raw;
          return (
            <span
              key={LANE_TITLES[i]}
              className="lane-head"
              style={{ left: `${left}px`, fontSize: `${(11 * headScale).toFixed(2)}px` }}
            >
              {LANE_TITLES[i]}
            </span>
          );
        })}
      </div>
      <div className="evidence-scroll" ref={scrollRef} style={empty ? { display: "none" } : undefined}>
        <div className="evidence-canvas" ref={canvasRef} style={{ height: `${canvasHeight}px` }} />
        {tip && (
          <div className="graph-tooltip" style={{ left: tip.x, top: tip.y }} role="tooltip">
            <strong>{tip.title}</strong>
            <span>{tip.meta}</span>
          </div>
        )}
      </div>
    </div>
  );
}
