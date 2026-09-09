import { useState } from "react";
import { Newspaper, Sparkles } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { generateMatchReport } from "@/lib/matchReport";

interface AiMatchReportProps {
  gameId: string;
}

/**
 * KI-Spielbericht (2026-09-09): opt-in AI-generated post-match recap, offered right on the winner
 * overlay next to MatchReflection — same self-contained-component pattern (own loading/error
 * state, mounted only once the game is durably saved, gameId is a foreign key into `games`). Unlike
 * MatchReflection this isn't private: the generated text is also folded into the existing PNG
 * share card (see shareResult() in Game.tsx, which re-reads games.ai_report at share time rather
 * than needing this component's state lifted up).
 *
 * Deliberately a manual button, not automatic-on-finish — generate-player-portrait (the only other
 * AI-backed feature in this app) is opt-in the same way, and a club that plays dozens of games a
 * night shouldn't have every single one silently spend an AI call whether anyone reads the result
 * or not.
 */
const AiMatchReport = ({ gameId }: AiMatchReportProps) => {
  const { t, language } = useLanguage();
  const { session } = useAuth();
  const [report, setReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!session?.user?.id) return null;

  const generate = async () => {
    if (loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const text = await generateMatchReport(gameId, language, session.access_token);
      setReport(text);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  if (report) {
    return (
      <div className="bg-muted/30 border border-primary/30 rounded-lg p-3 mb-4 text-left">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <Newspaper className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-display uppercase text-primary">{t("aiReport.title")}</span>
          </div>
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Sparkles className="w-2.5 h-2.5" /> {t("aiReport.aiGeneratedTag")}
          </span>
        </div>
        <p className="text-sm text-foreground/90 leading-relaxed">{report}</p>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-col items-center gap-1.5">
      <Button variant="outline" size="sm" onClick={generate} disabled={loading} className="gap-1.5">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Newspaper className="w-3.5 h-3.5" />}
        {loading ? t("aiReport.generating") : t("aiReport.generateBtn")}
      </Button>
      {failed && <p className="text-[10px] text-destructive">{t("aiReport.generateFailed")}</p>}
    </div>
  );
};

export default AiMatchReport;
