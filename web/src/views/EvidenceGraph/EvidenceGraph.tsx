import { useEffect, useRef, useState } from "react";
import cytoscape, { type Core } from "cytoscape";
import { useInvestigation } from "../../state/investigation";
import { COLORS } from "../../theme/tokens";
import { InfoTip } from "../../components/InfoTip";
import { EmptyState } from "../../components/EmptyState";

const KIND_COLORS: Record<string, string> = {
  change: COLORS.warn,
  metric_anomaly: COLORS.accent,
  log_pattern: COLORS.muted,
  service_degradation: COLORS.danger,
  root_cause_candidate: COLORS.ok,
};

export function EvidenceGraphPanel() {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const signatureRef = useRef<string>("");
  const evidenceGraph = useInvestigation((s) => s.evidenceGraph);
  const selectService = useInvestigation((s) => s.selectService);
  const [strongestOnly, setStrongestOnly] = useState(false);

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
            color: COLORS.fg,
            "font-size": 10,
            "text-wrap": "wrap",
            "text-max-width": "110",
            "text-valign": "bottom",
            "text-margin-y": 4,
            width: 20,
            height: 20,
            shape: "round-rectangle",
          },
        },
        {
          selector: "node.dim",
          style: { opacity: 0.25 },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": COLORS.borderStrong,
            "target-arrow-color": COLORS.borderStrong,
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            "font-size": 8,
            color: COLORS.muted,
            label: "data(kind)",
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
        {
          selector: "edge.dim",
          style: { opacity: 0.15 },
        },
      ],
      layout: { name: "preset" },
      userZoomingEnabled: true,
      userPanningEnabled: true,
    });
    cy.on("tap", "node", (evt) => {
      const svc = evt.target.data("service");
      if (svc) selectService(svc);
    });
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [selectService]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !evidenceGraph) return;
    const g = evidenceGraph.graph;
    const signature =
      g.nodes.map((n) => n.id).join("|") + "#" + g.edges.map((e) => e.id).join("|");
    if (signature !== signatureRef.current) {
      signatureRef.current = signature;
      cy.elements().remove();
      cy.add([
        ...g.nodes.map((n) => ({
          data: {
            id: n.id,
            label: n.label,
            service: n.service ?? undefined,
            color: KIND_COLORS[n.kind] ?? COLORS.accent,
            strength: n.strength,
          },
        })),
        ...g.edges.map((e) => ({
          data: { id: e.id, source: e.from, target: e.to, kind: e.kind },
          classes: e.kind === "contradicts" ? "contradicts" : "",
        })),
      ]);
      cy.layout({ name: "breadthfirst", directed: true, animate: false, fit: true, padding: 16 })
        .run();
    }
    // Strongest-path filter: dim nodes below median strength and edges
    // touching them.
    const strengths = g.nodes.map((n) => n.strength).sort((a, b) => a - b);
    const median = strengths.length ? strengths[Math.floor(strengths.length / 2)] : 0;
    cy.nodes().removeClass("dim");
    cy.edges().removeClass("dim");
    if (strongestOnly) {
      for (const n of g.nodes) {
        if (n.strength < median && n.kind !== "root_cause_candidate") {
          cy.$id(n.id).addClass("dim");
          cy.$id(n.id).connectedEdges().addClass("dim");
        }
      }
    }
  }, [evidenceGraph, strongestOnly]);

  // Single-view layout: sections are always visible, so track container size
  // directly instead of tab activation. Also covers the display:none -> shown
  // transition when the empty state gives way to data.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const cy = cyRef.current;
      if (!cy) return;
      cy.resize();
      if (cy.elements().length > 0) cy.fit(undefined, 16);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const empty = !evidenceGraph || evidenceGraph.graph.nodes.length === 0;

  return (
    <div className="evidence-graph-wrap" data-testid="evidence-graph">
      <div className="waterfall-toolbar">
        <button
          type="button"
          className={strongestOnly ? "chip-toggle active" : "chip-toggle"}
          data-testid="evidence-graph-strongest"
          onClick={() => setStrongestOnly(!strongestOnly)}
        >
          Strongest path
        </button>
        <InfoTip>
          This graph is an evidence explanation, not proven causality. Dashed red edges mark
          contradicting evidence.
        </InfoTip>
      </div>
      {empty && (
        <EmptyState glyph="◇" title="No evidence yet. Play or seek past the incident onset." />
      )}
      <div
        className="panel-body graph"
        ref={ref}
        style={empty ? { display: "none" } : undefined}
      />
    </div>
  );
}
