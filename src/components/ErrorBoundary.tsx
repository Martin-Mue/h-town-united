import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional label shown in the fallback so it's obvious *where* it broke (e.g. "Kamera"). */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render/lifecycle errors in the wrapped subtree instead of letting them bubble up and
 * unmount the whole app to a blank white screen. Particularly valuable around features with
 * external, device-dependent failure modes (camera access, ONNX model loading on an unfamiliar
 * Android/browser combo) where a single unlucky device shouldn't be able to end a whole match.
 *
 * Deliberately minimal and dependency-free — error boundaries must be class components, and this
 * one sits high enough in the tree (and deep enough around LiveCamera) that pulling useLanguage()
 * in here isn't worth the coupling. Wiring translated copy through is a natural, low-risk follow-up
 * once this exists; today it fails safe with plain-language copy instead of a blank screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console -- only error-visibility surface we have right now
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-[12rem] flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
        <AlertTriangle className="w-6 h-6 text-destructive" />
        <div>
          <p className="text-sm font-medium">
            {this.props.label ? `${this.props.label}: ` : ""}Etwas ist schiefgelaufen.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Bitte versuche es erneut oder lade die Seite neu.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={this.reset}>Erneut versuchen</Button>
          <Button size="sm" onClick={() => window.location.reload()}>Seite neu laden</Button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
