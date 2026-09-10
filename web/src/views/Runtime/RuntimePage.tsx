import { useEffect, useMemo, useState } from "react";
import { useInvestigation, type RuntimeTabId } from "../../state/investigation";
import { fmtCount, fmtDurationNs, fmtOffset } from "../../lib/format";
import { Stat } from "../../components/Stat";
import { InfoTip } from "../../components/InfoTip";
import { EmptyState } from "../../components/EmptyState";
import { RUNTIME_SECTIONS, TERMS } from "../../content/runtime";
import { buildOperatorDag } from "../../lib/operatorDag";
import { OperatorDagView } from "./OperatorDag";
import { OperatorDetail } from "./OperatorDetail";
import { WatermarkTimeline } from "./WatermarkTimeline";
import { IngestionPanel } from "./IngestionPanel";
import { QueryWorkbench } from "./QueryWorkbench";
import { ScoringFormula } from "./ScoringFormula";
import { CheckpointPanel } from "./CheckpointPanel";
import { ArchStatus } from "./ArchStatus";

type Props = { sessionId: string | null; incidentId: string; adversarial: boolean };

const EMPTY_SET = new Set<string>();

const SUB_TABS: Array<{ id: RuntimeTabId; label: string; title: string }> = [
  { id: "pipeline", label: "Pipeline", title: RUNTIME_SECTIONS.pipeline.title },
  { id: "event-time", label: "Event time", title: RUNTIME_SECTIONS.eventTime.title },
  { id: "queries", label: "Queries", title: RUNTIME_SECTIONS.query.title },
  { id: "scoring", label: "Scoring", title: RUNTIME_SECTIONS.scoring.title },
  { id: "recovery", label: "Recovery", title: RUNTIME_SECTIONS.checkpoint.title },
];

type EventTimeView = "watermark" | "ingestion";

// The Runtime tab: six glance tiles, then one sub-tab at a time, each led by
// one sentence and one visual. The sub-tab lives in the store so the
// walkthrough and the query workbench can open a specific one.
export function RuntimePage({ incidentId, adversarial }: Props) {
  const inspector = useInvestigation((s) => s.runtimeInspector);
  const heatmapMode = useInvestigation((s) => s.heatmapMode);
  const startNs = useInvestigation((s) => s.incidentStartNs);
  const selectedOperator = useInvestigation((s) => s.selectedOperator);
  const selectedHeatmapCell = useInvestigation((s) => s.selectedHeatmapCell);
  const lastQueryPlan = useInvestigation((s) => s.lastQueryPlan);
  const active = useInvestigation((s) => s.runtimeTab);
  const setRuntimeTab = useInvestigation((s) => s.setRuntimeTab);
  const [eventTimeView, setEventTimeView] = useState<EventTimeView>("watermark");

  // A selected operator (from a heatmap cell or a correlation card) is a
  // request to see the pipeline.
  useEffect(() => {
    if (selectedOperator) setRuntimeTab("pipeline");
  }, [selectedOperator, setRuntimeTab]);

  const operators = useMemo(() => inspector?.operators ?? [], [inspector]);
  const liveIds = useMemo(() => new Set(operators.map((o) => o.stable_id)), [operators]);
  const sharedIds = useMemo(() => {
    if (!lastQueryPlan) return EMPTY_SET;
    return new Set(lastQueryPlan.operator_ids.filter((id) => liveIds.has(id)));
  }, [lastQueryPlan, liveIds]);
  const ghostTypes = useMemo(() => {
    const dag = buildOperatorDag(operators);
    return new Map(dag.nodes.filter((n) => n.ghost).map((n) => [n.id, n.type]));
  }, [operators]);

  const et = inspector?.event_time;
  const bp = inspector?.backpressure;
  const session = inspector?.session;
  const gwm = et?.global_watermark_ns ?? 0;
  const selectedNode = operators.find((o) => o.stable_id === selectedOperator) ?? null;
  const totalState = operators.reduce((sum, o) => sum + (o.state_bytes ?? 0), 0);
  const activeWindows = operators.reduce((sum, o) => sum + (o.active_windows ?? 0), 0);
  const reorderCapacity =
    operators.find((o) => o.operator_type === "MetricSource")?.queue_capacity ?? 50_000;
  const pressure = (bp?.max_queue_utilization ?? 0) > 0;

  const current = SUB_TABS.find((t) => t.id === active) ?? SUB_TABS[0];

  return (
    <div data-testid="runtime-inspector" className="runtime">
      <section className="drawer-section" data-testid="inspector-overview">
        <h3>
          {RUNTIME_SECTIONS.glance.title} <InfoTip>{RUNTIME_SECTIONS.glance.lead}</InfoTip>
        </h3>
        {!inspector ? (
          <EmptyState title="No runtime projection yet" hint="Arrives with the first replay tick" />
        ) : (
          <div className="glance-grid">
            <Stat label="Projection mode" value={session?.projection_mode ?? heatmapMode} />
            <Stat label="Replay" value={`${session?.replay_state ?? "-"} @ ${session?.replay_speed ?? "-"}`} />
            <Stat
              label="Global watermark"
              mono
              value={<span title={TERMS.watermark}>{fmtOffset(gwm, startNs)}</span>}
            />
            <Stat
              label="Watermark lag"
              mono
              value={<span title={TERMS.lateness}>{fmtDurationNs(et?.watermark_lag_ns ?? 0)}</span>}
            />
            <Stat label="Events received" mono value={fmtCount(inspector.ingestion?.events_received ?? 0)} />
            <Stat
              label="Backpressure"
              value={
                <span
                  title={
                    pressure && bp?.limiting_operator_id
                      ? `${TERMS.backpressure} Limiting operator: ${bp.limiting_operator_id}.`
                      : `${TERMS.backpressure} No queue pressure.`
                  }
                >
                  {bp?.any_queue_saturated ? "saturated" : "ok"} ({((bp?.max_queue_utilization ?? 0) * 100).toFixed(0)}%)
                </span>
              }
            />
          </div>
        )}
      </section>

      <nav className="dock-tabs sub-tabs" role="tablist" aria-label="Runtime sections" data-testid="runtime-tabs">
        {SUB_TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={isActive ? "tab active" : "tab"}
              data-testid={`runtime-tab-${tab.id}`}
              title={tab.title}
              onClick={() => setRuntimeTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {current.id === "pipeline" && (
        <section className="drawer-section" data-testid="runtime-pane-pipeline">
          <h3>{RUNTIME_SECTIONS.pipeline.title}</h3>
          <p className="rt-lead">{RUNTIME_SECTIONS.pipeline.lead}</p>
          <div data-testid="inspector-operator-graph">
            {operators.length === 0 ? (
              <EmptyState title="No operators reported yet" />
            ) : (
              <>
                <OperatorDagView
                  operators={operators}
                  sharedIds={sharedIds}
                  limitingId={pressure ? (bp?.limiting_operator_id ?? null) : null}
                />
                {selectedOperator && (liveIds.has(selectedOperator) || ghostTypes.has(selectedOperator)) && (
                  <OperatorDetail id={selectedOperator} node={selectedNode} ghostType={ghostTypes.get(selectedOperator)} />
                )}
                <p className="rt-state" data-testid="inspector-state">
                  State across operators: <span className="mono">{fmtBytesInline(totalState)}</span> ·{" "}
                  <span className="mono">{fmtCount(activeWindows)}</span> open windows ·{" "}
                  <span className="mono">{fmtCount(session?.heatmap_revisions ?? 0)}</span> heatmap revisions
                  {selectedHeatmapCell && (
                    <span className="mono" data-testid="cell-operator-link">
                      {" "}
                      · selected cell: op {selectedHeatmapCell.operator_id ?? "-"} window{" "}
                      {selectedHeatmapCell.window_id ?? "-"}
                    </span>
                  )}
                </p>
              </>
            )}
          </div>
        </section>
      )}

      {current.id === "event-time" && (
        <section className="drawer-section" data-testid="runtime-pane-event-time">
          <h3>{RUNTIME_SECTIONS.eventTime.title}</h3>
          <p className="rt-lead">
            {eventTimeView === "watermark" ? RUNTIME_SECTIONS.eventTime.lead : RUNTIME_SECTIONS.ingestion.lead}
          </p>
          <div className="op-chips view-chips" role="group" aria-label="Event time view">
            <button
              type="button"
              className={eventTimeView === "watermark" ? "chip-toggle active" : "chip-toggle"}
              data-testid="runtime-view-watermark"
              onClick={() => setEventTimeView("watermark")}
            >
              Watermark
            </button>
            <button
              type="button"
              className={eventTimeView === "ingestion" ? "chip-toggle active" : "chip-toggle"}
              data-testid="runtime-view-ingestion"
              onClick={() => setEventTimeView("ingestion")}
            >
              Ingestion
            </button>
          </div>
          {eventTimeView === "watermark" ? (
            <div data-testid="inspector-watermark">
              {et ? (
                <WatermarkTimeline et={et} revisions={session?.heatmap_revisions ?? 0} />
              ) : (
                <EmptyState title="No event-time stats yet" />
              )}
            </div>
          ) : (
            <div data-testid="inspector-ingestion">
              {inspector?.ingestion && inspector.batching ? (
                <IngestionPanel
                  ingestion={inspector.ingestion}
                  batching={inspector.batching}
                  reorderCapacity={reorderCapacity}
                />
              ) : (
                <EmptyState title="No ingestion stats yet" />
              )}
            </div>
          )}
        </section>
      )}

      {current.id === "queries" && (
        <section className="drawer-section" data-testid="runtime-pane-queries">
          <h3>{RUNTIME_SECTIONS.query.title}</h3>
          <p className="rt-lead">{RUNTIME_SECTIONS.query.lead}</p>
          <QueryWorkbench liveOperatorIds={liveIds} />
        </section>
      )}

      {current.id === "scoring" && (
        <section className="drawer-section" data-testid="runtime-pane-scoring">
          <h3>{RUNTIME_SECTIONS.scoring.title}</h3>
          <p className="rt-lead">{RUNTIME_SECTIONS.scoring.lead}</p>
          <ScoringFormula />
        </section>
      )}

      {current.id === "recovery" && (
        <section className="drawer-section" data-testid="runtime-pane-recovery">
          <h3>{RUNTIME_SECTIONS.checkpoint.title}</h3>
          <p className="rt-lead">{RUNTIME_SECTIONS.checkpoint.lead}</p>
          <CheckpointPanel />
          <h4 className="rt-sub">{RUNTIME_SECTIONS.provenance.title}</h4>
          <p className="rt-lead">{RUNTIME_SECTIONS.provenance.lead}</p>
          <ArchStatus
            lines={inspector?.architecture_status ?? []}
            incidentId={incidentId}
            heatmapMode={heatmapMode}
            adversarial={adversarial}
          />
        </section>
      )}
    </div>
  );
}

function fmtBytesInline(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
