import { useState } from "react";
import { Shuffle, Swords, RotateCw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";

export interface MatchmakingPlayer {
  id: string;
  name: string;
  emoji: string;
  elo_rating?: number | null;
}

interface Pairing {
  a: MatchmakingPlayer;
  b: MatchmakingPlayer;
}

/** Picks a random bye (if the pool is odd) and pairs the rest by ADJACENT Elo rank after sorting
 *  descending — minimizes the worst-case rating gap across all pairs, which is the actual
 *  definition of "fair" here (top-vs-bottom seeding would maximize gaps, not minimize them). The
 *  bye is randomized each call rather than always landing on the lowest-rated player, since nobody
 *  should be the permanent one sitting out across repeated Neu-mischen presses. */
function generatePairings(pool: MatchmakingPlayer[]): { pairs: Pairing[]; bye: MatchmakingPlayer | null } {
  let remaining = [...pool];
  let bye: MatchmakingPlayer | null = null;
  if (remaining.length % 2 === 1) {
    const idx = Math.floor(Math.random() * remaining.length);
    bye = remaining[idx];
    remaining = remaining.filter((_, i) => i !== idx);
  }
  const sorted = remaining.sort((x, y) => (y.elo_rating ?? 1000) - (x.elo_rating ?? 1000));
  const pairs: Pairing[] = [];
  for (let i = 0; i < sorted.length; i += 2) {
    pairs.push({ a: sorted[i], b: sorted[i + 1] });
  }
  return { pairs, bye };
}

/** "Faire Paarungen" tool — pick who's actually here tonight from the full roster, then get
 *  Elo-balanced 1v1 pairings instead of everyone picking opponents ad hoc. Pure client-side
 *  computation from data the roster already has (elo_rating) — no writes, nothing persisted. */
const MatchmakingDialog = ({ players }: { players: MatchmakingPlayer[] }) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ pairs: Pairing[]; bye: MatchmakingPlayer | null } | null>(null);

  const reset = () => {
    setSelected(new Set());
    setResult(null);
  };

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const generate = () => {
    const pool = players.filter((p) => selected.has(p.id));
    setResult(generatePairings(pool));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5"><Shuffle className="w-4 h-4" /> {t("players.fairPairings")}</Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display uppercase flex items-center gap-2"><Swords className="w-4 h-4 text-primary" /> {t("players.fairPairings")}</DialogTitle>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">{t("players.fairPairingsDesc")}</p>
            <div className="space-y-1 max-h-[45vh] overflow-y-auto -mx-1 px-1">
              {players.map((p) => (
                <label key={p.id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-muted/50 cursor-pointer">
                  <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                  <span className="text-lg shrink-0">{p.emoji}</span>
                  <span className="flex-1 min-w-0 truncate text-sm">{p.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{Math.round(p.elo_rating ?? 1000)} Elo</span>
                </label>
              ))}
            </div>
            <Button className="w-full gap-1.5" disabled={selected.size < 2} onClick={generate}>
              <Shuffle className="w-4 h-4" /> {t("players.generatePairings")} ({selected.size})
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {result.pairs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">{t("players.notEnoughForPairing")}</p>
            ) : (
              <div className="space-y-2">
                {result.pairs.map((pair, i) => (
                  <div key={pair.a.id} className="rounded-lg border border-border bg-muted/30 p-3 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground shrink-0 w-4">{i + 1}.</span>
                    <div className="flex-1 min-w-0 text-right">
                      <p className="text-sm font-semibold truncate">{pair.a.emoji} {pair.a.name}</p>
                      <p className="text-[10px] text-muted-foreground">{Math.round(pair.a.elo_rating ?? 1000)} Elo</p>
                    </div>
                    <span className="text-xs font-display text-muted-foreground shrink-0 px-1">VS</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{pair.b.emoji} {pair.b.name}</p>
                      <p className="text-[10px] text-muted-foreground">{Math.round(pair.b.elo_rating ?? 1000)} Elo</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {result.bye && (
              <p className="text-xs text-accent text-center">{result.bye.emoji} {result.bye.name} {t("players.sitsOutThisRound")}</p>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" className="gap-1.5" onClick={() => setResult(null)}>
                <ArrowLeft className="w-4 h-4" /> {t("players.backToSelection")}
              </Button>
              <Button variant="outline" className="flex-1 gap-1.5" onClick={generate}>
                <RotateCw className="w-4 h-4" /> {t("players.reshuffle")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default MatchmakingDialog;
