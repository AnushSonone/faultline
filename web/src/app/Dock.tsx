import { useEffect } from "react";
import { useInvestigation, type TabId } from "../state/investigation";
import { SECTION_LEADS } from "../content/novice";
import { shortTraceId } from "../lib/format";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { CaseFilePage } from "../views/CaseFile/CaseFilePage";
import { RootCausesPanel } from "../views/RootCauses/RootCauses";
import { DeploymentCorrelationPanel } from "../views/DeploymentCorrelation/DeploymentCorrelation";
import { AnomalyHeatmap } from "../views/AnomalyHeatmap/AnomalyHeatmap";
import { TraceWaterfall } from "../views/TraceWaterfall/TraceWaterfall";
import { RuntimePage } from "../views/Runtime/RuntimePage";

const TABS: Array<{ id: TabId; label: string; hint: string }> = [
  { id: "overview", label: "Overview", hint: "Dependency graph, ranking, evidence graph" },
  { id: "case", label: "Case file", hint: "What was recorded, routes, the injected signal, ground truth" },
  { id: "signals", label: "Telemetry", hint: "p99 heatmap and trace waterfall" },
  { id: "root-causes", label: "Ranking", hint: "Root-cause ranking and score decomposition" },
  { id: "runtime", label: "Runtime", hint: "Operators, watermarks, query plans, checkpoints" },
];

const TITLES: Record<TabId, string> = {
  overview: "Overview",
  "root-causes": "Root-cause ranking",
  signals: "Telemetry",
  case: "Case file",
  runtime: "Runtime",
};

// Bottom strip: dock tabs on the left, the linked-selection chips on the
// right. Nothing here scrolls; the tabs open a drawer inside the stage.
export function Dock() {
  const activeTab = useInvestigation((s) => s.activeTab);
  const setTab = useInvestigation((s) => s.setTab);
  const selectedService = useInvestigation((s) => s.selectedService);
  const selectedTrace = useInvestigation((s) => s.selectedTrace);
  const selectService = useInvestigation((s) => s.selectService);
  const selectTrace = useInvestigation((s) => s.selectTrace);
  const heatmapMode = useInvestigation((s) => s.heatmapMode);

  return (
    <div className="dock">
      <nav className="dock-tabs" role="tablist" aria-label="Panels" data-walk="dock">
        {TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={active ? "tab active" : "tab"}
              data-testid={`tab-${tab.id}`}
              title={tab.hint}
              onClick={() => setTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
      <div className="selection-bar" data-testid="selection-bar">
        {selectedService == null && selectedTrace == null && (
          <span className="selection-hint">
            No selection. Click a service, a candidate, or a trace to link the views.
          </span>
        )}
        {selectedService != null && (
          <span className="selection-chip">
            service: {selectedService}
            <button
              type="button"
              className="chip-clear"
              aria-label="Clear service selection"
              onClick={() => selectService(null)}
            >
              ×
            </button>
          </span>
        )}
        {selectedTrace != null && (
          <span className="selection-chip" title={selectedTrace}>
            trace: {shortTraceId(selectedTrace)}
            <button
              type="button"
              className="chip-clear"
              aria-label="Clear trace selection"
              onClick={() => selectTrace(null)}
            >
              ×
            </button>
          </span>
        )}
        <span className="selection-chip selection-meta" data-testid="heatmap-mode">
          projection: {heatmapMode}
        </span>
      </div>
    </div>
  );
}

type DrawerProps = {
  tab: Exclude<TabId, "overview">;
  sessionId: string | null;
  incidentId: string;
  adversarial: boolean;
};

// The drawer replaces the verdict column while a dock tab is open. The map
// and the evidence graph stay on screen the whole time.
export function DockDrawer({ tab, sessionId, incidentId, adversarial }: DrawerProps) {
  const setTab = useInvestigation((s) => s.setTab);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTab("overview");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTab]);

  return (
    <aside className="panel drawer" data-testid={`page-${tab}`} aria-label={TITLES[tab]} data-walk="drawer">
      <header className="drawer-head">
        <h2>{TITLES[tab]}</h2>
        <button
          type="button"
          className="chip-toggle"
          aria-label="Close panel"
          onClick={() => setTab("overview")}
        >
          Close
        </button>
      </header>
      <div className="drawer-body">
        <p className="drawer-lead drawer-intro">{SECTION_LEADS[tab]}</p>
        <ErrorBoundary name={TITLES[tab]}>
          {tab === "root-causes" && (
            <>
              <section className="drawer-section">
                <RootCausesPanel />
              </section>
              <section className="drawer-section">
                <h3>Change proximity</h3>
                <p className="drawer-lead">A temporal interval join between deployments and anomaly onsets on the event-time clock.</p>
                <DeploymentCorrelationPanel />
              </section>
            </>
          )}
          {tab === "signals" && (
            <>
              <section className="drawer-section">
                <h3>Anomaly heatmap</h3>
                <p className="drawer-lead">One row per service, one column per 1 s tumbling window; intensity is approximate p99 latency via DDSketch, not a z-score.</p>
                <AnomalyHeatmap />
              </section>
              <section className="drawer-section">
                <h3>Trace waterfall</h3>
                <p className="drawer-lead">One sampled trace at the cursor with its critical path marked, comparable against a healthy baseline trace.</p>
                <TraceWaterfall />
              </section>
            </>
          )}
          {tab === "case" && <CaseFilePage sessionId={sessionId} incidentId={incidentId} />}
          {tab === "runtime" && (
            <RuntimePage sessionId={sessionId} incidentId={incidentId} adversarial={adversarial} />
          )}
        </ErrorBoundary>
      </div>
    </aside>
  );
}
