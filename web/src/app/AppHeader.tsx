import { useInvestigation } from "../state/investigation";
import { Tabs } from "./Tabs";

export function AppHeader() {
  const wsStatus = useInvestigation((s) => s.wsStatus);
  const replay = useInvestigation((s) => s.replay);

  const pillClass =
    wsStatus === "live" ? "pill live" : wsStatus === "reconnecting" ? "pill reconnecting" : "pill";
  const pillText =
    wsStatus === "live" ? "ws live" : wsStatus === "reconnecting" ? "ws reconnecting…" : "ws connecting…";

  return (
    <header className="app-header">
      <div className="brand-block">
        <span className="brand-mark" aria-hidden="true" />
        <div>
          <h1>Faultline</h1>
          <p>Interactive incident replay</p>
        </div>
      </div>

      <Tabs />

      <div className="status-cluster">
        <span className={pillClass} data-testid="connection">
          <span className="dot" aria-hidden="true" />
          {pillText}
        </span>
        <span className="pill" data-testid="replay-state">
          {replay.state}
        </span>
      </div>
    </header>
  );
}
