import { Component, type ErrorInfo, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("OweMe screen error", error, info.componentStack);
  }
  render() {
    return this.state.failed ? (
      <div className="screen-loading">
        <ShieldCheck size={30} />
        <h1>Let's reopen your notebook.</h1>
        <p>
          This screen could not load. Your saved records stay on this device.
        </p>
        <button
          className="button primary"
          onClick={() => window.location.reload()}
        >
          Reload OweMe
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
