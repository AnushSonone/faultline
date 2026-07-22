import { useEffect, useRef } from "react";
import cytoscape, { type Core } from "cytoscape";
import { useInvestigation } from "../../state/investigation";

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
            "background-color": "#3d9bfd",
            color: "#e8eef4",
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
            "background-color": "#e85d4c",
            "border-width": 2,
            "border-color": "#ffb4a8",
          },
        },
        {
          selector: "node.selected",
          style: {
            "border-width": 3,
            "border-color": "#f5d76e",
          },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "line-color": "#5a6b7d",
            "target-arrow-color": "#5a6b7d",
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

  return <div className="panel-body graph" ref={ref} data-testid="service-map" />;
}
