import { useInvestigation } from "../state/investigation";
import { EVIDENCE_INTRO, MAP_INTRO } from "../content/novice";
import { InfoTip } from "../components/InfoTip";
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
      <section className={tourTarget === "map" ? "panel stage-map tour-target" : "panel stage-map"}>
        <h2>
          Who calls whom <span className="term">dependency map</span> <InfoTip>{MAP_INTRO}</InfoTip>
        </h2>
        <p className="panel-lead">
          Each circle is one small program (a “service”). An arrow means “calls”. A circle turns red
          when that service gets slower than usual.
        </p>
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
      <section className={tourTarget === "evidence" ? "panel stage-evidence tour-target" : "panel stage-evidence"}>
        <h2>
          How Faultline reasoned <span className="term">evidence graph</span>{" "}
          <InfoTip>{EVIDENCE_INTRO}</InfoTip>
        </h2>
        <p className="panel-lead">
          Follow the arrows: something changed → some numbers went strange → some services got slow →
          the suspects, ranked.
        </p>
        <ErrorBoundary name="Evidence graph">
          <EvidenceGraphPanel />
        </ErrorBoundary>
      </section>
    </div>
  );
}
