import { useEffect, useState } from "react";

export function App() {
  const [health, setHealth] = useState<string>("checking…");

  useEffect(() => {
    fetch("/api/v1/health")
      .then((r) => r.json())
      .then((j) => setHealth(`${j.status} (${j.service})`))
      .catch(() => setHealth("unreachable"));
  }, []);

  return (
    <div className="shell">
      <header className="brand">
        <h1>Faultline</h1>
        <p>Interactive Incident Replay and Root-Cause Visualization</p>
      </header>
      <main>
        <p className="status">Backend: {health}</p>
        <p className="muted">Scaffold shell (TA-001). Views arrive in M2.</p>
      </main>
    </div>
  );
}
