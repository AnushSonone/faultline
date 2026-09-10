import { describe, expect, it } from "vitest";
import { buildOperatorDag, layoutOperatorDag, rankOperatorDag } from "./operatorDag";

// The demo pipeline as crates/engine/src/heatmap_pipeline.rs wires it.
const OPS = [
  { stable_id: "metric_source", operator_type: "MetricSource", upstream_ids: [], downstream_ids: ["filter_lat_err_mem"] },
  {
    stable_id: "filter_lat_err_mem",
    operator_type: "Filter",
    upstream_ids: ["metric_source"],
    downstream_ids: ["heatmap_tumbling", "latency_percentile"],
  },
  { stable_id: "heatmap_tumbling", operator_type: "Window", upstream_ids: ["filter_lat_err_mem"], downstream_ids: ["heatmap_sink"] },
  {
    stable_id: "latency_percentile",
    operator_type: "P99",
    upstream_ids: ["filter_lat_err_mem"],
    downstream_ids: ["heatmap_sink", "deploy_temporal_join"],
  },
  {
    stable_id: "deploy_temporal_join",
    operator_type: "TemporalJoin",
    upstream_ids: ["latency_percentile", "change_source"],
    downstream_ids: ["correlation_sink"],
  },
  {
    stable_id: "heatmap_sink",
    operator_type: "HeatmapSink",
    upstream_ids: ["heatmap_tumbling", "latency_percentile"],
    downstream_ids: [],
  },
];

describe("buildOperatorDag", () => {
  it("dedupes edges declared on both ends and synthesizes ghost nodes", () => {
    const dag = buildOperatorDag(OPS);
    expect(dag.nodes.map((n) => n.id)).toEqual([
      "metric_source",
      "filter_lat_err_mem",
      "heatmap_tumbling",
      "latency_percentile",
      "deploy_temporal_join",
      "heatmap_sink",
      "correlation_sink",
      "change_source",
    ]);
    expect(dag.nodes.find((n) => n.id === "change_source")?.ghost).toBe("source");
    expect(dag.nodes.find((n) => n.id === "correlation_sink")?.ghost).toBe("sink");
    expect(dag.edges).toHaveLength(8);
    expect(dag.edges.filter((e) => e.from === "filter_lat_err_mem")).toHaveLength(2);
  });
});

describe("rankOperatorDag", () => {
  it("ranks by longest path and tucks ghosts beside their neighbours", () => {
    const rank = rankOperatorDag(buildOperatorDag(OPS));
    expect(Object.fromEntries(rank)).toEqual({
      metric_source: 0,
      filter_lat_err_mem: 1,
      heatmap_tumbling: 2,
      latency_percentile: 2,
      deploy_temporal_join: 3,
      heatmap_sink: 3,
      change_source: 2,
      correlation_sink: 4,
    });
  });
});

describe("layoutOperatorDag", () => {
  it("places five ranks vertically with the widest rank centred", () => {
    const l = layoutOperatorDag(buildOperatorDag(OPS), { rankPitch: 60, siblingPitch: 100, padding: 20 });
    expect(l.ranks).toBe(5);
    expect(l.height).toBe(4 * 60 + 40);
    expect(l.width).toBe(2 * 100 + 40);
    const at = (id: string) => l.placed.find((p) => p.id === id)!;
    expect(at("metric_source")).toMatchObject({ x: 120, y: 20 });
    expect(at("correlation_sink").y).toBe(20 + 4 * 60);
    const rank2 = l.placed.filter((p) => p.rank === 2).map((p) => p.x).sort((a, b) => a - b);
    expect(rank2).toEqual([20, 120, 220]);
    // no two nodes share a position
    const keys = new Set(l.placed.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(l.placed.length);
  });
  it("keeps upstream order across ranks (barycenter) and swaps axes horizontally", () => {
    const v = layoutOperatorDag(buildOperatorDag(OPS));
    const h = layoutOperatorDag(buildOperatorDag(OPS), { direction: "horizontal" });
    const at = (l: typeof v, id: string) => l.placed.find((p) => p.id === id)!;
    expect(at(h, "metric_source").x).toBe(at(v, "metric_source").y);
    expect(at(h, "metric_source").y).toBe(at(v, "metric_source").x);
    // heatmap_sink hangs under heatmap_tumbling/latency_percentile, the join under percentile + change_source
    expect(at(v, "heatmap_sink").x).toBeLessThan(at(v, "deploy_temporal_join").x);
  });
});
