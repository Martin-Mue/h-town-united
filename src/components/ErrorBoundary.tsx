import { Component, type ErrorInfo, type ReactNode, type ContextType } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { LanguageContext } from "@/contexts/LanguageContext";

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
 * Error boundaries must be class components, so translated copy comes via React's static
 * contextType (LanguageContext itself, not the useLanguage() hook, which only works in function
 * components) rather than the usual t() call — see LanguageContext.tsx's own doc comment on why
 * that context is exported at all. Round 4 Rang 4: this used to be plain hardcoded German, with
 * a comment here calling that out as a deliberate, low-risk follow-up once it was worth doing;
 * it's still dependency-light (one context read, no other coupling) and still fails safe with
 * plain-language copy instead of a blank screen if something above ever renders this without a
 * LanguageProvider in the tree.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  static contextType = LanguageContext;
  declare context: ContextType<typeof LanguageContext>;

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
    const { t } = this.context;
    return (
      <div className="min-h-[12rem] flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
        <AlertTriangle className="w-6 h-6 text-destructive" />
        <div>
          <p className="text-sm font-medium">
            {this.props.label ? `${this.props.label}: ` : ""}{t("errorBoundary.title")}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("errorBoundary.hint")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={this.reset}>{t("errorBoundary.retryBtn")}</Button>
          <Button size="sm" onClick={() => window.location.reload()}>{t("errorBoundary.reloadBtn")}</Button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
