import { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

interface MatchReflectionProps {
  gameId: string;
}

/**
 * Post-match mini reflection: 1-3 short, entirely optional/skippable questions offered once a
 * game finishes (see the winner overlay in Game.tsx) — a few seconds of self-reflection instead
 * of yet another public stat. Written to its own `match_reflections` table (see the matching
 * migration), which deliberately has NO admin-visibility policy at all: unlike almost everything
 * else in this app, this is private to the player who wrote it, full stop — user_id/club_id are
 * left off the payload entirely and picked up from that table's own auth.uid()/current_club_id()
 * column defaults, so there's no way for this component to accidentally attribute a reflection
 * to the wrong person.
 *
 * The caller only mounts this once the game has actually been saved AND isn't sitting in the
 * offline queue (see the gameSaved/!queuedOffline check in Game.tsx) — game_id is a foreign key
 * into `games`, so writing a reflection before that row exists server-side would just fail. A
 * reflection typed in the rare "finished a match with no connection" window is the one case this
 * doesn't cover; that's an accepted gap rather than something worth a bespoke offline queue for.
 */
const MatchReflection = ({ gameId }: MatchReflectionProps) => {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { session } = useAuth();
  const [rating, setRating] = useState<number | null>(null);
  const [wentWell, setWentWell] = useState("");
  const [improveNext, setImproveNext] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<"skipped" | "saved" | null>(null);

  if (!session?.user?.id) return null;
  if (done === "skipped") return null;
  if (done === "saved") {
    return (
      <p className="text-[10px] text-muted-foreground mt-1 mb-2 flex items-center justify-center gap-1">
        <Check className="w-3 h-3" /> {t("reflection.savedThanks")}
      </p>
    );
  }

  const save = async () => {
    // Nothing filled in at all — treat exactly like the skip button rather than writing an
    // entirely empty row.
    if (rating === null && !wentWell.trim() && !improveNext.trim()) {
      setDone("skipped");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("match_reflections").upsert(
        {
          game_id: gameId,
          focus_rating: rating,
          went_well: wentWell.trim() || null,
          improve_next: improveNext.trim() || null,
        },
        { onConflict: "user_id,game_id" },
      );
      if (error) throw error;
      setDone("saved");
    } catch {
      toast({ title: t("reflection.saveFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-muted/30 border border-border/60 rounded-lg p-3 mb-4 text-left">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-display uppercase text-primary">{t("reflection.title")}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{t("reflection.private")}</span>
      </div>

      <p className="text-xs text-muted-foreground mb-1.5">{t("reflection.focusQuestion")}</p>
      <div className="flex items-center gap-1.5 mb-3">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            aria-label={`${n}/5`}
            className={`w-7 h-7 rounded-full text-xs font-display border transition-colors ${
              rating === n
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/50"
            }`}
          >
            {n}
          </button>
        ))}
      </div>

      <label className="text-xs text-muted-foreground block mb-1">{t("reflection.wentWellLabel")}</label>
      <Textarea
        value={wentWell}
        onChange={(e) => setWentWell(e.target.value)}
        placeholder={t("reflection.placeholderOptional")}
        maxLength={280}
        className="text-sm min-h-[52px] mb-2"
      />
      <label className="text-xs text-muted-foreground block mb-1">{t("reflection.improveNextLabel")}</label>
      <Textarea
        value={improveNext}
        onChange={(e) => setImproveNext(e.target.value)}
        placeholder={t("reflection.placeholderOptional")}
        maxLength={280}
        className="text-sm min-h-[52px] mb-3"
      />

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => setDone("skipped")} disabled={saving}>
          {t("reflection.skip")}
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "…" : t("reflection.save")}
        </Button>
      </div>
    </div>
  );
};

export default MatchReflection;
