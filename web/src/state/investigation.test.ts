import { describe, expect, it } from "vitest";
import { useInvestigation } from "./investigation";

describe("investigation store", () => {
  it("applies topology snapshot and selection", () => {
    useInvestigation.setState({
      lastSequence: 0,
      needsResync: false,
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

  it("flags sequence gaps for resync", () => {
    useInvestigation.setState({
      lastSequence: 1,
      needsResync: false,
      lastError: null,
    });
    useInvestigation.getState().applyWs({
      protocol_version: 1,
      session_id: "s",
      sequence: 4,
      server_time_ns: 0,
      event_time_ns: 10,
      type: "clock.tick",
      payload: { event_time_ns: 10 },
    });
    expect(useInvestigation.getState().needsResync).toBe(true);
  });

  const envelope = (sequence: number, type: string, payload: unknown) => ({
    protocol_version: 1,
    session_id: "s",
    sequence,
    server_time_ns: 0,
    event_time_ns: 0,
    type,
    payload,
  });

  it("marks the replay completed only on a playing -> stopped@end transition", () => {
    const st = useInvestigation.getState();
    useInvestigation.setState({
      lastSequence: 0,
      incidentStartNs: 0,
      incidentEndNs: 100,
      replay: { state: "stopped" },
      replayCompleted: false,
    });
    // Boot seek: stopped -> stopped at the end does not count.
    st.applyWs(envelope(1, "replay.status", { state: "stopped", event_time_ns: 100 }));
    expect(useInvestigation.getState().replayCompleted).toBe(false);
    st.applyWs(envelope(2, "replay.status", { state: "playing", event_time_ns: 0 }));
    // Pausing mid-way does not count.
    st.applyWs(envelope(3, "replay.status", { state: "paused", event_time_ns: 40 }));
    expect(useInvestigation.getState().replayCompleted).toBe(false);
    st.applyWs(envelope(4, "replay.status", { state: "playing", event_time_ns: 40 }));
    st.applyWs(envelope(5, "replay.status", { state: "stopped", event_time_ns: 100 }));
    expect(useInvestigation.getState().replayCompleted).toBe(true);
    // A new session clears it.
    st.clearSelection();
    expect(useInvestigation.getState().replayCompleted).toBe(false);
  });

  it("marks the replay completed when a tick reaches the end while playing", () => {
    const st = useInvestigation.getState();
    useInvestigation.setState({
      lastSequence: 0,
      incidentEndNs: 100,
      replay: { state: "playing" },
      replayCompleted: false,
    });
    st.applyWs(envelope(1, "clock.tick", { event_time_ns: 99 }));
    expect(useInvestigation.getState().replayCompleted).toBe(false);
    st.applyWs(envelope(2, "clock.tick", { event_time_ns: 100 }));
    expect(useInvestigation.getState().replayCompleted).toBe(true);
  });

  it("latches investigation progress and resets it with the session", () => {
    const st = useInvestigation.getState();
    st.clearSelection();
    useInvestigation.setState({ lastSequence: 0, incidentEndNs: 100, walkStep: null, briefOpen: true });
    // Opening a tab records the visit; the ranking tab counts as reading it.
    st.setTab("signals");
    st.setTab("root-causes");
    expect(useInvestigation.getState().visitedTabs).toEqual(["signals", "root-causes"]);
    expect(useInvestigation.getState().sawRanking).toBe(true);
    // Playing closes the brief and counts as running the replay.
    st.applyWs(envelope(1, "replay.status", { state: "playing", event_time_ns: 0 }));
    expect(useInvestigation.getState().playedOnce).toBe(true);
    expect(useInvestigation.getState().briefOpen).toBe(false);
    // The earliest anomaly time is cached, and the cursor passing it latches.
    st.applyWs(
      envelope(2, "evidence.updated", {
        projection_version: 1,
        cursor_event_time_ns: 0,
        graph: { nodes: [{ id: "a", kind: "metric_anomaly", label: "x", time_ns: 40 }], edges: [] },
      }),
    );
    expect(useInvestigation.getState().anomalyOnsetNs).toBe(40);
    expect(useInvestigation.getState().sawAnomaly).toBe(false);
    st.applyWs(envelope(3, "clock.tick", { event_time_ns: 39 }));
    expect(useInvestigation.getState().sawAnomaly).toBe(false);
    st.applyWs(envelope(4, "clock.tick", { event_time_ns: 40 }));
    expect(useInvestigation.getState().sawAnomaly).toBe(true);
    // Seeking back never un-ticks.
    st.applyWs(envelope(5, "clock.tick", { event_time_ns: 0 }));
    expect(useInvestigation.getState().sawAnomaly).toBe(true);
    // Skip records the brief as read.
    st.setBriefOpen(false, { read: true });
    expect(useInvestigation.getState().briefRead).toBe(true);
    st.clearSelection();
    const after = useInvestigation.getState();
    expect(after.visitedTabs).toEqual([]);
    expect(after.playedOnce).toBe(false);
    expect(after.sawAnomaly).toBe(false);
    expect(after.sawRanking).toBe(false);
    expect(after.briefRead).toBe(false);
    expect(after.briefOpen).toBe(true);
  });

  it("mutes progress after the tour until the replay reports the start", () => {
    const st = useInvestigation.getState();
    st.clearSelection();
    useInvestigation.setState({
      lastSequence: 0,
      incidentStartNs: 0,
      incidentEndNs: 100,
      walkStep: null,
      anomalyOnsetNs: 10,
      selectedEventTime: 100,
    });
    st.muteProgress();
    st.applyWs(envelope(1, "clock.tick", { event_time_ns: 100 }));
    expect(useInvestigation.getState().sawAnomaly).toBe(false);
    st.applyWs(envelope(2, "replay.status", { state: "stopped", event_time_ns: 0 }));
    expect(useInvestigation.getState().progressMuted).toBe(false);
    st.applyWs(envelope(3, "clock.tick", { event_time_ns: 50 }));
    expect(useInvestigation.getState().sawAnomaly).toBe(true);
  });

  it("does not latch progress while the walkthrough drives the replay", () => {
    const st = useInvestigation.getState();
    st.clearSelection();
    useInvestigation.setState({ lastSequence: 0, incidentEndNs: 100, walkStep: 4, anomalyOnsetNs: 10 });
    st.setTab("signals");
    st.applyWs(envelope(1, "replay.status", { state: "playing", event_time_ns: 0 }));
    st.applyWs(envelope(2, "clock.tick", { event_time_ns: 50 }));
    const s = useInvestigation.getState();
    expect(s.visitedTabs).toEqual([]);
    expect(s.playedOnce).toBe(false);
    expect(s.sawAnomaly).toBe(false);
  });
});
