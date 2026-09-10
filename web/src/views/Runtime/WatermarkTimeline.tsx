import { useRef } from "react";
import { useInvestigation } from "../../state/investigation";
import { fmtCount, fmtDurationNs, fmtOffset } from "../../lib/format";
import { InfoTip } from "../../components/InfoTip";
import { TERMS } from "../../content/runtime";
import type { EventTimeStats } from "../../types/protocol";
import { useWidth } from "./useWidth";

// Late-revision grace is not on the wire (only allowed lateness is). Mirrors
// WatermarkConfig.late_revision_grace_ns in crates/engine/src/heatmap_pipeline.rs.
const GRACE_NS = 1_000_000_000;
const H = 96;
const AXIS_Y = 50;
const MAX_TICKS = 12;

type Props = { et: EventTimeStats; revisions: number };

// A number line in event time. Bands: beyond grace (dropped), the revision
// grace (re-opens a window), the allowed lateness (on time). Markers: the
// global watermark and the maximum event time seen. Ticks: per-partition
// watermarks.
export function WatermarkTimeline({ et, revisions }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useWidth(wrapRef);
  const startNs = useInvestigation((s) => s.incidentStartNs);

  const gwm = et.global_watermark_ns;
  const maxEt = Math.max(et.max_event_time_ns, gwm);
  const lateness = Math.max(et.allowed_lateness_ns, 1);
  const lo = Math.min(gwm - GRACE_NS - lateness, ...et.partition_watermarks.map((p) => p.watermark_ns));
  const hi = maxEt + lateness / 2;
  const span = Math.max(hi - lo, 1);
  const padL = 8;
  const padR = 8;
  const x = (ns: number) => padL + ((ns - lo) / span) * (width - padL - padR);

  const wmLabel = `watermark ${fmtOffset(gwm, startNs)}`;
  const maxLabel = `max event time ${fmtOffset(maxEt, startNs)}`;
  const wmX = x(gwm);
  const maxX = x(maxEt);
  // Labels sit on different rows (watermark above the axis, max event time
  // below) and each flips to the side with more room so neither clips.
  const wmLeft = wmX < width / 2;
  const maxLeft = maxX < width / 2;
  const ticks = et.partition_watermarks.slice(0, MAX_TICKS);

  return (
    <>
      <div className="wm-wrap" ref={wrapRef}>
        <svg
          className="wm-svg"
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          role="img"
          aria-label={`${wmLabel}; ${maxLabel}`}
          data-testid="wm-timeline"
        >
          <rect className="wm-band-late" x={padL} y={AXIS_Y - 10} width={Math.max(0, x(gwm - GRACE_NS) - padL)} height={20} />
          <rect className="wm-band-grace" x={x(gwm - GRACE_NS)} y={AXIS_Y - 10} width={Math.max(0, wmX - x(gwm - GRACE_NS))} height={20} />
          <rect className="wm-band-lateness" x={wmX} y={AXIS_Y - 10} width={Math.max(0, maxX - wmX)} height={20} />
          <line className="wm-axis" x1={padL} x2={width - padR} y1={AXIS_Y} y2={AXIS_Y} />
          {ticks.map((p, i) => (
            <line
              key={p.partition}
              className="wm-tick"
              x1={x(p.watermark_ns)}
              x2={x(p.watermark_ns)}
              y1={AXIS_Y + 10}
              y2={AXIS_Y + 16 + (i % 2) * 3}
            >
              <title>{`${p.partition}: ${fmtOffset(p.watermark_ns, startNs)}`}</title>
            </line>
          ))}
          <line className="wm-mark-wm" x1={wmX} x2={wmX} y1={AXIS_Y - 22} y2={AXIS_Y + 10} />
          <text
            className="wm-label wm-label-wm"
            x={wmLeft ? wmX + 4 : wmX - 4}
            y={AXIS_Y - 26}
            textAnchor={wmLeft ? "start" : "end"}
          >
            {wmLabel}
          </text>
          <line className="wm-mark-max" x1={maxX} x2={maxX} y1={AXIS_Y - 12} y2={AXIS_Y + 22} />
          <text
            className="wm-label"
            x={maxLeft ? maxX + 4 : maxX - 4}
            y={AXIS_Y + 34}
            textAnchor={maxLeft ? "start" : "end"}
          >
            {maxLabel}
          </text>
        </svg>
      </div>
      <div className="wm-badges">
        <span className="metric-chip" title={TERMS.revision}>
          <span className="metric-key">late, revisable</span>
          <span className="metric-value">{fmtCount(et.late_but_revisable_events)}</span>
        </span>
        <span className="metric-chip" title={TERMS.grace}>
          <span className="metric-key">beyond grace</span>
          <span className="metric-value">{fmtCount(et.beyond_grace_events)}</span>
        </span>
        <span className="metric-chip" title={TERMS.partition}>
          <span className="metric-key">idle partitions</span>
          <span className="metric-value">{fmtCount(et.idle_partitions)}</span>
        </span>
        <span className="metric-chip" title={TERMS.lateness}>
          <span className="metric-key">lag</span>
          <span className="metric-value">{fmtDurationNs(et.watermark_lag_ns)}</span>
        </span>
        <span className="metric-chip" title={TERMS.revision}>
          <span className="metric-key">revisions</span>
          <span className="metric-value">{fmtCount(revisions)}</span>
        </span>
      </div>
      <p className="wm-key">
        <span className="wm-key-item">
          <span className="wm-swatch late" /> dropped (beyond grace)
        </span>
        <span className="wm-key-item">
          <span className="wm-swatch grace" /> revision grace {fmtDurationNs(GRACE_NS)}
        </span>
        <span className="wm-key-item">
          <span className="wm-swatch lateness" /> allowed lateness {fmtDurationNs(et.allowed_lateness_ns)}
        </span>
      </p>
      <details className="rt-details">
        <summary>
          Partition watermarks ({fmtCount(et.partition_watermarks.length)}){" "}
          <InfoTip>{TERMS.partition}</InfoTip>
        </summary>
        <dl className="kv-grid part-list">
          {et.partition_watermarks.map((p) => (
            <PartitionRow key={p.partition} partition={p.partition} ns={p.watermark_ns} startNs={startNs} />
          ))}
        </dl>
      </details>
    </>
  );
}

function PartitionRow({ partition, ns, startNs }: { partition: string; ns: number; startNs: number | null }) {
  return (
    <>
      <dt className="mono part-name" title={partition}>
        {partition}
      </dt>
      <dd className="mono">{fmtOffset(ns, startNs)}</dd>
    </>
  );
}
