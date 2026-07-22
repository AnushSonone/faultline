import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { useInvestigation } from "../../state/investigation";
import { seek } from "../../api/client";

export function IncidentTimeline() {
  const svgRef = useRef<SVGSVGElement>(null);
  const timeline = useInvestigation((s) => s.timeline);
  const selected = useInvestigation((s) => s.selectedEventTime);
  const selectedService = useInvestigation((s) => s.selectedService);
  const selectedChangeId = useInvestigation((s) => s.selectedChangeId);
  const correlations = useInvestigation((s) => s.correlations);
  const selectChange = useInvestigation((s) => s.selectChange);
  const selectService = useInvestigation((s) => s.selectService);
  const selectOperator = useInvestigation((s) => s.selectOperator);
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

    const deployTimes = new Set(
      correlations.map((c) => c.deployed_at_ns).filter((t) => Number.isFinite(t)),
    );
    const selectedDeploy = correlations.find((c) => c.change_id === selectedChangeId);

    svg
      .selectAll("rect.mark")
      .data(deployOrLog)
      .enter()
      .append("rect")
      .attr("class", "mark")
      .attr("data-testid", "deploy-marker")
      .attr("x", (d) => x(d.event_time_ns) - 2)
      .attr("y", 18)
      .attr("width", 4)
      .attr("height", 36)
      .attr("fill", (d) => {
        if (selectedDeploy && d.event_time_ns === selectedDeploy.deployed_at_ns) {
          return "#e85d4c";
        }
        if (deployTimes.has(d.event_time_ns)) return "#f5d76e";
        return "#f5d76e";
      })
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        event.stopPropagation();
        const match = correlations.find((c) => c.deployed_at_ns === d.event_time_ns);
        if (match) {
          selectChange(match.change_id);
          selectService(match.service);
          selectOperator("deploy_temporal_join");
        } else if (d.service) {
          selectService(d.service);
        }
      });

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
  }, [
    timeline,
    selected,
    selectedService,
    sessionId,
    deployOrLog,
    markers,
    correlations,
    selectedChangeId,
    selectChange,
    selectService,
    selectOperator,
  ]);

  return (
    <div className="panel-body" data-testid="timeline">
      <svg ref={svgRef} width="100%" height={72} role="img" aria-label="Incident timeline" />
      <p className="hint">
        Click timeline to scrub. Yellow markers are deployments/logs (precomputed base events).
        Selecting a deploy highlights the associated service via streaming temporal join.
      </p>
    </div>
  );
}
