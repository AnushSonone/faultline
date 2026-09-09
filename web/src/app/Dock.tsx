import { useEffect } from "react";
import { useInvestigation, type TabId } from "../state/investigation";
import { SECTION_INTROS } from "../content/novice";
import { SCENARIOS } from "../content/scenarios";
import { shortTraceId } from "../lib/format";
import { InfoTip } from "../components/InfoTip";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { CasePanel } from "../components/CasePanel";
import { RootCausesPanel } from "../views/RootCauses/RootCauses";
import { DeploymentCorrelationPanel } from "../views/DeploymentCorrelation/DeploymentCorrelation";
import { AnomalyHeatmap } from "../views/AnomalyHeatmap/AnomalyHeatmap";
import { TraceWaterfall } from "../views/TraceWaterfall/TraceWaterfall";
import { CrashTestPanel } from "../views/CrashTest/CrashTest";
import { QueryInspectorPanel } from "../views/QueryInspector/QueryInspector";
import { RuntimeInspectorPanel } from "../views/RuntimeInspector/RuntimeInspector";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Stage" },
  { id: "root-causes", label: "Why?" },
  { id: "signals", label: "The raw signals" },
  { id: "case", label: "The story" },
  { id: "runtime", label: "For engineers" },
];

const TITLES: Record<TabId, string> = {
  overview: "Stage",
  "root-causes": "Why?",
  signals: "The raw signals",
  case: "The story",
  runtime: "For engineers",
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
      <nav className="dock-tabs" role="tablist" aria-label="Panels">
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
            No selection. Click a service, a rank, or a trace to link the views.
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
          engine: {heatmapMode}
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
  const inspector = useInvestigation((s) => s.runtimeInspector);
  const heatmapMode = useInvestigation((s) => s.heatmapMode);
  const scenario = SCENARIOS[incidentId];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTab("overview");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTab]);

  return (
    <aside className="panel drawer" data-testid={`page-${tab}`} aria-label={TITLES[tab]}>
      <header className="drawer-head">
        <h2>
          {TITLES[tab]} <InfoTip>{SECTION_INTROS[tab]}</InfoTip>
        </h2>
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
        <ErrorBoundary name={TITLES[tab]}>
          {tab === "root-causes" && (
            <>
              <section className="drawer-section">
                <RootCausesPanel />
              </section>
              <section className="drawer-section">
                <h3>Was something deployed just before?</h3>
                <DeploymentCorrelationPanel />
              </section>
            </>
          )}
          {tab === "signals" && (
            <>
              <section className="drawer-section">
                <h3>Slowness over time</h3>
                <p className="drawer-lead">each row is a service, darker is slower</p>
                <AnomalyHeatmap />
              </section>
              <section className="drawer-section">
                <h3>One slow request, step by step</h3>
                <TraceWaterfall />
              </section>
            </>
          )}
          {tab === "case" && (
            <>
              <CasePanel sessionId={sessionId} />
              {scenario && (
                <section className="drawer-section scenario-blurb" data-testid="scenario-blurb">
                  <h3>{scenario.title}</h3>
                  <span className="eyebrow">What happened</span>
                  <p>{scenario.whatHappened}</p>
                  <span className="eyebrow">What we evaluate</span>
                  <p>{scenario.whatWeEvaluate}</p>
                  <span className="eyebrow">What to watch</span>
                  <p>{scenario.whatToWatch}</p>
                  {scenario.caveat && <p className="panel-caption">{scenario.caveat}</p>}
                </section>
              )}
            </>
          )}
          {tab === "runtime" && (
            <>
              <section className="drawer-section">
                <h3>Checkpoint &amp; recovery</h3>
                <CrashTestPanel />
              </section>
              <section className="drawer-section">
                <h3>Query plan inspector</h3>
                <QueryInspectorPanel />
              </section>
              <section className="drawer-section">
                <h3>Runtime inspector</h3>
                <div className="panel-body">
                  <RuntimeInspectorPanel />
                </div>
              </section>
              <section className="drawer-section">
                <h3>Streaming vs precomputed</h3>
                <aside className="arch-status" data-testid="arch-status">
                  <ul>
                    {(inspector?.architecture_status ?? []).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <dl className="kv-grid">
                    <dt>Incident</dt>
                    <dd className="mono">{incidentId}</dd>
                    <dt>Heatmap values</dt>
                    <dd>{heatmapMode}</dd>
                    <dt>Arrival order</dt>
                    <dd>{adversarial ? "adversarial" : "normal"}</dd>
                  </dl>
                </aside>
              </section>
            </>
          )}
        </ErrorBoundary>
      </div>
    </aside>
  );
}
