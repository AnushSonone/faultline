import { useEffect, useRef } from "react";
import cytoscape, { type Core } from "cytoscape";
import { useInvestigation } from "../../state/investigation";
import { COLORS } from "../../theme/tokens";
import { EmptyState } from "../../components/EmptyState";

function graphSignature(topology: {
  graph: {
    nodes: Array<{ service: string }>;
    edges: Array<{ from: string; to: string }>;
  };
}): string {
  const nodes = topology.graph.nodes.map((n) => n.service).sort().join("|");
  const edges = topology.graph.edges
    .map((e) => `${e.from}->${e.to}`)
    .sort()
    .join("|");
  return `${nodes}#${edges}`;
}

export function ServiceMap() {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const signatureRef = useRef<string>("");
  const topology = useInvestigation((s) => s.topology);
  const selectedService = useInvestigation((s) => s.selectedService);
  const selectService = useInvestigation((s) => s.selectService);

  useEffect(() => {
    if (!ref.current || cyRef.current) return;
    const cy = cytoscape({
      container: ref.current,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "background-color": COLORS.accent,
            color: COLORS.fg,
            "font-size": 10,
            "text-valign": "center",
            width: 28,
            height: 28,
            shape: "ellipse",
          },
        },
        {
          selector: "node.hot",
          style: {
            "background-color": COLORS.danger,
            "border-width": 2,
            "border-color": COLORS.dangerSoft,
          },
        },
        {
          selector: "node.selected",
          style: {
            "border-width": 3,
            "border-color": COLORS.accent,
          },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": COLORS.borderStrong,
            "target-arrow-color": COLORS.borderStrong,
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
          },
        },
      ],
      layout: { name: "preset" },
      userZoomingEnabled: true,
      userPanningEnabled: true,
    });
    cy.on("tap", "node", (evt) => {
      selectService(evt.target.data("id"));
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) selectService(null);
    });
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [selectService]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !topology) return;
    const signature = graphSignature(topology);
    const nodes = topology.graph.nodes.map((n) => {
      const err = Number(n.error_count ?? 0);
      const req = Number(n.request_count ?? 1);
      return {
        data: { id: n.service, label: n.service },
        classes: err / Math.max(req, 1) > 0.05 ? "hot" : "",
      };
    });
    const edges = topology.graph.edges.map((e, i) => ({
      data: { id: `e-${i}`, source: e.from, target: e.to },
    }));

    if (signature !== signatureRef.current) {
      signatureRef.current = signature;
      cy.elements().remove();
      cy.add([...nodes, ...edges]);
      cy.layout({ name: "circle", animate: false, fit: true }).run();
      return;
    }

    // Same topology identity: update hot classes without re-layout.
    for (const n of nodes) {
      const el = cy.$id(n.data.id);
      if (el.empty()) continue;
      el.removeClass("hot");
      if (n.classes.includes("hot")) el.addClass("hot");
    }
  }, [topology]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass("selected");
    if (selectedService) {
      cy.$id(selectedService).addClass("selected");
    }
  }, [selectedService]);

  // Single-view layout: sections are always visible, so track container size
  // directly instead of tab activation.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const cy = cyRef.current;
      if (!cy) return;
      cy.resize();
      if (cy.elements().length > 0) cy.fit(undefined, 20);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Cytoscape owns the container's children, so React must never render
  // inside it (removeChild conflicts). The empty state is a sibling overlay;
  // the testid stays on the wrapper so it is present in both states.
  return (
    <div className="panel-body graph graph-wrap" data-testid="service-map">
      <div className="graph-canvas" ref={ref} />
      {!topology && (
        <div className="graph-overlay">
          <EmptyState
            title="Waiting for topology"
            hint="Appears as soon as the session loads"
          />
        </div>
      )}
    </div>
  );
}
