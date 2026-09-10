import { useInvestigation } from "../state/investigation";
import { EVIDENCE_LEAD, MAP_LEAD } from "../content/novice";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ServiceMap } from "../views/ServiceMap/ServiceMap";
import { EvidenceGraphPanel } from "../views/EvidenceGraph/EvidenceGraph";
import { VerdictRail } from "./VerdictRail";
import { DockDrawer } from "./Dock";

type Props = {
  booting: boolean;
  sessionId: string | null;
  incidentId: string;
  adversarial: boolean;
};

// The one screen. Map top-left, verdict (or an open drawer) top-right,
// evidence graph across the bottom. Grid tracks own the height; panels never
// grow past them.
export function Stage({ booting, sessionId, incidentId, adversarial }: Props) {
  const activeTab = useInvestigation((s) => s.activeTab);
  const tourTarget = useInvestigation((s) => s.tourTarget);
  return (
    <div className="stage" data-testid="page-overview">
      <section
        className={tourTarget === "map" ? "panel stage-map tour-target" : "panel stage-map"}
        data-walk="map"
      >
        <h2>Dependency graph</h2>
        <p className="panel-lead">{MAP_LEAD}</p>
        <ErrorBoundary name="Dependency map">
          <ServiceMap />
        </ErrorBoundary>
      </section>
      {activeTab === "overview" ? (
        <VerdictRail booting={booting} incidentId={incidentId} />
      ) : (
        <DockDrawer
          tab={activeTab}
          sessionId={sessionId}
          incidentId={incidentId}
          adversarial={adversarial}
        />
      )}
      <section
        className={tourTarget === "evidence" ? "panel stage-evidence tour-target" : "panel stage-evidence"}
        data-walk="evidence"
      >
        <h2>Evidence graph</h2>
        <p className="panel-lead">{EVIDENCE_LEAD}</p>
        <ErrorBoundary name="Evidence graph">
          <EvidenceGraphPanel />
        </ErrorBoundary>
      </section>
    </div>
  );
}
