import { useEffect, useMemo, useRef } from "react";
import cytoscape, { type Core } from "cytoscape";
import { useInvestigation } from "../../state/investigation";
import { COLORS } from "../../theme/tokens";
import { EmptyState } from "../../components/EmptyState";
import {
  buildMapModel,
  layoutMap,
  mapSignature,
  type MapDirection,
  type MapModel,
} from "../../lib/mapModel";
import { checkCyLabels, exposeForTests, layoutCheckEnabled } from "../../lib/layoutCheck";

const FONT = '"Inter Variable", Inter, system-ui, -apple-system, sans-serif';

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  const c = (x: number, y: number) => Math.round(x + (y - x) * k);
  return `#${[c(r1, r2), c(g1, g2), c(b1, b2)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Fit and centre, but never zoom past 1.25: labels are designed at 11px and
// a three-node graph should not fill a 900px panel with three giant circles.
const FIT_PAD = 24;
function fitCapped(cy: Core) {
  cy.fit(undefined, FIT_PAD);
  if (cy.zoom() > 1.25) cy.zoom(1.25);
  cy.center();
}

// Position every drawn node for the given direction and refit.
function applyLayout(cy: Core, model: MapModel, direction: MapDirection) {
  const positions = layoutMap(model, { direction });
  cy.nodes().forEach((n) => {
    const p = positions[n.id()];
    if (p) n.position(p);
  });
  fitCapped(cy);
}

// Wide panels read left -> right, tall ones top -> bottom. The dead band
// between the two thresholds stops a panel near square from flapping.
function pickDirection(width: number, height: number, current: MapDirection): MapDirection {
  if (height <= 0) return current;
  const ratio = width / height;
  if (ratio >= 1.35) return "horizontal";
  if (ratio <= 1.05) return "vertical";
  return current;
}

// One diameter for every traced service: size carried no information a
// beginner could read, and a diameter that tracked cumulative traffic grew
// on every tick of the replay. Metrics-only services are smaller and dimmed.
const NODE_PX = 34;
const NODE_UNOBSERVED_PX = 26;
function nodeSize(observed: boolean): number {
  return observed ? NODE_PX : NODE_UNOBSERVED_PX;
}

// What widens a node's drawn bbox without changing the graph's identity.
function fitKey(model: MapModel): string {
  const top1 = model.nodes.find((n) => n.rank === 1 && (n.score ?? 0) > 0)?.id ?? "";
  const deployed = model.nodes.filter((n) => n.deployed).map((n) => n.id).join(",");
  return `${top1}|${deployed}`;
}

function nodeData(n: MapModel["nodes"][number]) {
  const ranked = n.rank === 1 && (n.score ?? 0) > 0;
  return {
    id: n.id,
    label: ranked ? `#1 ${n.id}` : n.id,
    color: n.observed ? mixHex(COLORS.accent, COLORS.danger, n.heat) : COLORS.faint,
    size: nodeSize(n.observed),
    borderWidth: n.deployed ? 4 : 0,
    borderColor: COLORS.warn,
    borderStyle: n.deployed ? "double" : "solid",
    weight: ranked ? 600 : 500,
  };
}

// The dependency map. Arrows point caller to callee, laid out from the entry
// service. Colour is latency heat at the replay cursor, a double ring is a
// landed deployment, and metrics-only services sit dimmed one level past the
// traced graph so the map shows the whole system, not only the traced part.
// The legend is in flow under the canvas, so the fit never hides a node.
export function ServiceMap() {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const signatureRef = useRef<string>("");
  // Label widths change with the #1 badge and the deploy ring; refit when
  // they do, one frame after cytoscape has restyled.
  const fitKeyRef = useRef<string>("");
  const hotRef = useRef<Set<string>>(new Set());
  const directionRef = useRef<MapDirection>("horizontal");
  const modelRef = useRef<MapModel | null>(null);
  const topology = useInvestigation((s) => s.topology);
  const heatmap = useInvestigation((s) => s.heatmap);
  const rootCauses = useInvestigation((s) => s.rootCauses);
  const correlations = useInvestigation((s) => s.correlations);
  const evidenceGraph = useInvestigation((s) => s.evidenceGraph);
  const cursor = useInvestigation((s) => s.selectedEventTime);
  const selectedService = useInvestigation((s) => s.selectedService);
  const hoveredService = useInvestigation((s) => s.hoveredService);
  const selectService = useInvestigation((s) => s.selectService);
  const hoverService = useInvestigation((s) => s.hoverService);

  const model = useMemo(
    () =>
      buildMapModel({ topology, heatmap, rootCauses, correlations, evidenceGraph, cursorNs: cursor }),
    [topology, heatmap, rootCauses, correlations, evidenceGraph, cursor],
  );

  useEffect(() => {
    if (!ref.current || cyRef.current) return;
    const cy = cytoscape({
      container: ref.current,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "background-color": "data(color)",
            width: "data(size)",
            height: "data(size)",
            "border-width": "data(borderWidth)",
            "border-color": "data(borderColor)",
            "border-style": "data(borderStyle)" as unknown as "solid",
            color: COLORS.fg,
            "font-family": FONT,
            "font-size": 11,
            "font-weight": "data(weight)" as unknown as number,
            "text-valign": "bottom",
            "text-halign": "center",
            "text-margin-y": 6,
            "text-background-color": COLORS.panel,
            "text-background-opacity": 0.92,
            "text-background-padding": "2px",
            "text-background-shape": "roundrectangle",
            "overlay-opacity": 0,
            "transition-property": "background-color, border-width",
            "transition-duration": 300,
          },
        },
        { selector: "node.unobserved", style: { opacity: 0.55 } },
        {
          selector: "node.hot",
          style: {
            "overlay-color": COLORS.danger,
            "overlay-opacity": 0.12,
            "overlay-padding": 7,
          },
        },
        {
          selector: "node.hovered",
          style: { "border-width": 3, "border-color": COLORS.accent, "border-style": "solid" },
        },
        {
          selector: "node.selected",
          style: { "border-width": 3, "border-color": COLORS.accent, "border-style": "solid" },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": COLORS.borderStrong,
            "target-arrow-color": COLORS.borderStrong,
            "target-arrow-shape": "triangle",
            "arrow-scale": 1.1,
            "curve-style": "bezier",
            "transition-property": "line-color, width",
            "transition-duration": 300,
          },
        },
        {
          selector: "edge.propagating",
          style: {
            width: 3,
            "line-color": COLORS.danger,
            "target-arrow-color": COLORS.danger,
            "line-style": "dashed",
            "line-dash-pattern": [6, 4],
          },
        },
      ],
      layout: { name: "preset" },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      autounselectify: true,
    });
    cy.on("tap", "node", (evt) => selectService(evt.target.data("id")));
    cy.on("tap", (evt) => {
      if (evt.target === cy) selectService(null);
    });
    cy.on("mouseover", "node", (evt) => {
      hoverService(evt.target.data("id"));
      if (ref.current) ref.current.style.cursor = "pointer";
    });
    cy.on("mouseout", "node", () => {
      hoverService(null);
      if (ref.current) ref.current.style.cursor = "";
    });
    cyRef.current = cy;
    if (ref.current) exposeForTests(ref.current, cy);
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [selectService, hoverService]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (model.nodes.length === 0) {
      // Incident switched: nothing is known yet, so nothing may stay drawn.
      cy.elements().remove();
      signatureRef.current = "";
      hotRef.current = new Set();
      modelRef.current = null;
      return;
    }
    modelRef.current = model;
    const signature = `${mapSignature(model)}#${directionRef.current}`;
    if (signature !== signatureRef.current) {
      signatureRef.current = signature;
      hotRef.current = new Set();
      cy.elements().remove();
      cy.add([
        ...model.nodes.map((n) => ({
          data: nodeData(n),
          classes: n.observed ? "observed" : "unobserved",
        })),
        ...model.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target } })),
      ]);
      applyLayout(cy, model, directionRef.current);
      fitKeyRef.current = fitKey(model);
    }
    // Same graph identity: update heat, badges, propagation in place.
    const nextHot = new Set<string>();
    for (const n of model.nodes) {
      const el = cy.$id(n.id);
      if (el.empty()) continue;
      el.data(nodeData(n));
      if (n.hot) {
        nextHot.add(n.id);
        el.addClass("hot");
        if (!hotRef.current.has(n.id) && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          // One pulse per transition; a new pulse replaces one still running.
          el.stop(true, false);
          el.animate(
            { style: { "overlay-padding": 12, "overlay-opacity": 0.22 } },
            {
              duration: 260,
              queue: false,
              complete: () =>
                el.animate({ style: { "overlay-padding": 7, "overlay-opacity": 0.12 } }, { duration: 400, queue: false }),
            },
          );
        }
      } else {
        el.removeClass("hot");
      }
    }
    hotRef.current = nextHot;
    const key = fitKey(model);
    if (key !== fitKeyRef.current) {
      fitKeyRef.current = key;
      requestAnimationFrame(() => {
        if (cyRef.current === cy && cy.elements().length > 0) fitCapped(cy);
      });
    }
    for (const e of model.edges) {
      const el = cy.$id(e.id);
      if (el.empty()) continue;
      if (e.propagating) el.addClass("propagating");
      else el.removeClass("propagating");
    }
    if (layoutCheckEnabled()) requestAnimationFrame(() => checkCyLabels(cy, "service-map"));
  }, [model]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass("selected hovered");
    if (selectedService) cy.$id(selectedService).addClass("selected");
    if (hoveredService && hoveredService !== selectedService) cy.$id(hoveredService).addClass("hovered");
  }, [selectedService, hoveredService]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const cy = cyRef.current;
      if (!cy) return;
      cy.resize();
      const next = pickDirection(el.clientWidth, el.clientHeight, directionRef.current);
      const model = modelRef.current;
      if (next !== directionRef.current) {
        directionRef.current = next;
        if (model && cy.elements().length > 0) {
          // Re-lay out in place and record it, so the next data update
          // does not lay out a second time.
          signatureRef.current = `${mapSignature(model)}#${next}`;
          applyLayout(cy, model, next);
          return;
        }
      }
      if (cy.elements().length > 0) fitCapped(cy);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Cytoscape owns the container's children, so React must never render
  // inside it. Overlays are siblings.
  return (
    <div className="panel-body graph map-wrap" data-testid="service-map">
      <div className="graph-canvas map-canvas" ref={ref} />
      {model.nodes.length === 0 && (
        <div className="graph-overlay">
          <EmptyState title="Waiting for topology" hint="Appears as soon as the session loads" />
        </div>
      )}
      {model.nodes.length > 0 && (
        <div className="map-legend" aria-hidden="true">
          <span className="legend-item">
            <span className="legend-swatch round" style={{ background: COLORS.accent }} /> nominal
          </span>
          <span className="legend-item">
            <span className="legend-swatch round" style={{ background: COLORS.danger }} /> anomalous
          </span>
          <span className="legend-item">
            <span className="legend-swatch round ring" /> deployed
          </span>
          <span className="legend-item">
            <span className="legend-swatch round" style={{ background: COLORS.faint, opacity: 0.55 }} />{" "}
            metrics only (no spans)
          </span>
        </div>
      )}
    </div>
  );
}
