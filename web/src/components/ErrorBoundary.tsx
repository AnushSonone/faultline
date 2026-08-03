import { Component } from "react";

type Props = {
  name: string;
  children: React.ReactNode;
};

type State = {
  error: Error | null;
};

// Per-tab crash isolation: one broken view degrades to a message instead of
// taking down the whole page. The session and the other tabs keep running.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="panel error-boundary">
          <h2>{this.props.name} crashed</h2>
          <div className="panel-body">
            <p className="muted">
              This view hit an error. The session is still running; the other tabs are
              unaffected.
            </p>
            <pre className="plan-tree mono">{String(this.state.error.message)}</pre>
            <button type="button" onClick={() => this.setState({ error: null })}>
              Reset view
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
