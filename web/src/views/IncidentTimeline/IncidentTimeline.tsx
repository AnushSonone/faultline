import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { useInvestigation } from "../../state/investigation";
import { seek } from "../../api/client";

export function IncidentTimeline() {
  const svgRef = useRef<SVGSVGElement>(null);
  const timeline = useInvestigation((s) => s.timeline);
  const selected = useInvestigation((s) => s.selectedEventTime);
  const selectedService = useInvestigation((s) => s.selectedService);
  const sessionId = useInvestigation((s) => s.sessionId);

  const markers = useMemo(() => {
    if (!timeline) return [];
    return timeline.events.filter((e) => {
      if (e.signal !== "deployment" && e.signal !== "log" && e.signal !== "configuration") {
        return e.signal === "change" || e.signal === "deployment";
      }
      return true;
    });
  }, [timeline]);

  const deployOrLog = useMemo(() => {
    if (!timeline) return [];
    return timeline.events.filter(
      (e) =>
        e.signal === "deployment" ||
        e.signal === "log" ||
        e.signal === "configuration" ||
        (e.summary || "").toLowerCase().includes("deploy"),
    );
  }, [timeline]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!timeline || timeline.events.length === 0) return;

    const width = 640;
    const height = 72;
    const times = timeline.events.map((e) => e.event_time_ns);
    const minT = d3.min(times)!;
    const maxT = d3.max(times)!;
    const x = d3.scaleLinear().domain([minT, maxT]).range([16, width - 16]);

    svg.attr("viewBox", `0 0 ${width} ${height}`);

    svg
      .append("line")
      .attr("x1", 16)
      .attr("x2", width - 16)
      .attr("y1", 36)
      .attr("y2", 36)
      .attr("stroke", "#5a6b7d")
      .attr("stroke-width", 2);

    const filtered = selectedService
      ? timeline.events.filter((e) => !e.service || e.service === selectedService)
      : timeline.events;

    svg
      .selectAll("circle.evt")
      .data(filtered.filter((_, i) => i % 8 === 0))
      .enter()
      .append("circle")
      .attr("class", "evt")
      .attr("cx", (d) => x(d.event_time_ns))
      .attr("cy", 36)
      .attr("r", 3)
      .attr("fill", "#8b9aab");

    svg
      .selectAll("rect.mark")
      .data(deployOrLog)
      .enter()
      .append("rect")
      .attr("class", "mark")
      .attr("x", (d) => x(d.event_time_ns) - 2)
      .attr("y", 18)
      .attr("width", 4)
      .attr("height", 36)
      .attr("fill", "#f5d76e");

    if (selected != null) {
      svg
        .append("line")
        .attr("x1", x(selected))
        .attr("x2", x(selected))
        .attr("y1", 8)
        .attr("y2", 64)
        .attr("stroke", "#3d9bfd")
        .attr("stroke-width", 2);
    }

    svg.on("click", async (event) => {
      if (!sessionId) return;
      const [mx] = d3.pointer(event);
      const t = Math.round(x.invert(mx));
      await seek(sessionId, t);
    });
  }, [timeline, selected, selectedService, sessionId, deployOrLog, markers]);

  return (
    <div className="panel-body" data-testid="timeline">
      <svg ref={svgRef} width="100%" height={72} role="img" aria-label="Incident timeline" />
      <p className="hint">Click timeline to scrub event time. Yellow = deploy/log markers.</p>
    </div>
  );
}
