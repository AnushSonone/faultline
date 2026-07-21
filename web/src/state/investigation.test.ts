import { describe, expect, it } from "vitest";
import { useInvestigation } from "./investigation";

describe("investigation store", () => {
  it("applies topology snapshot and selection", () => {
    useInvestigation.setState({
      lastSequence: 0,
      topology: null,
      selectedService: null,
    });
    useInvestigation.getState().applyWs({
      protocol_version: 1,
      session_id: "s",
      sequence: 1,
      server_time_ns: 0,
      event_time_ns: 10,
      type: "topology.snapshot",
      payload: {
        projection_version: 1,
        cursor_event_time_ns: 10,
        graph: { nodes: [{ service: "frontend" }], edges: [] },
      },
    });
    expect(useInvestigation.getState().topology?.graph.nodes[0].service).toBe("frontend");
    useInvestigation.getState().selectService("frontend");
    expect(useInvestigation.getState().selectedService).toBe("frontend");
  });
});
