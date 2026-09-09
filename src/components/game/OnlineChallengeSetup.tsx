import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Wifi } from "lucide-react";
import { DartLoaderIcon as Loader2 } from "@/components/icons/DartIcons";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useClubBranding } from "@/contexts/ClubBrandingContext";
import { supabase } from "@/integrations/supabase/client";
import { usePlayers } from "@/hooks/usePlayers";
import { notifyChallengeCreated } from "@/lib/onlineMatchNotify";

const MODES = ["501", "301", "cricket", "custom"] as const;
const BEST_OF_OPTIONS = [1, 3, 5];
const STARTER_OPTIONS = ["challenger", "opponent", "random"] as const;
type StarterChoice = (typeof STARTER_OPTIONS)[number];

/** "mehr Einstellungen für Online-Spiele" (2026-09-09): a challenge row may fail with a schema-cache
 *  error if this device is on an older PostgREST schema cache than the just-added columns/mode
 *  value (see 20260909200000_add_online_match_settings.sql) — same class of break as the league
 *  creation bug this session already hit once. Detected the same way as every other fallback in
 *  this codebase (Tournament.tsx's missingLivePlayColumn/missingSetsColumn, League.tsx's
 *  missingLeagueNameColumn): Postgres code 42703, or the column name showing up in the message. */
const missingOnlineSettingsColumn = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === "42703" || ["double_in", "double_out", "custom_start_score", "starter"].some((c) => String(error.message || "").includes(c)));
/** The narrower case: the new columns exist, but 'custom' hasn't been added to online_matches'
 *  mode CHECK constraint yet on this DB — a distinct Postgres error (23514, check violation) from
 *  the column-missing case above. */
const modeCheckViolation = (error: { code?: string; message?: string } | null) =>
  !!error && error.code === "23514" && String(error.message || "").includes("mode");
/** Round 3 Rang 9: an opponent within this many Elo points of your own rating is flagged as a
 *  "good match" in the challenge list below — a common chess/Elo-style convention for "close
 *  enough to be a genuinely competitive game", not a hard cutoff on who you CAN challenge. */
const ELO_CLOSE_MATCH_THRESHOLD = 100;

/** The "online" half of Game.tsx's plain-game setup toggle — challenge a real club member to a
 *  synced two-device match instead of entering local names. Moved here from a standalone dialog
 *  on Players.tsx (2026-09-04): starting/requesting a game belongs where every other way to start
 *  a game already lives, not on the member roster. */
const OnlineChallengeSetup = ({ onBack }: { onBack: () => void }) => {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { user } = useAuth();
  const { clubId } = useClubBranding();
  const navigate = useNavigate();
  // Round 3 Rang 4: shared/cached club roster instead of this component's own fetchClubPlayers()
  // mount effect — see usePlayers.ts. Defaults to [] while loading, same as the old useState did.
  const { data: players = [] } = usePlayers();
  const [opponentId, setOpponentId] = useState<string>("");
  const [mode, setMode] = useState<(typeof MODES)[number]>("501");
  const [bestOf, setBestOf] = useState(1);
  const [customStartScore, setCustomStartScore] = useState(701);
  const [doubleIn, setDoubleIn] = useState(false);
  const [doubleOut, setDoubleOut] = useState(true);
  const [starter, setStarter] = useState<StarterChoice>("challenger");
  const [sending, setSending] = useState(false);

  // Round 3 Rang 9: my own Elo, to sort/flag opponents by skill match below. Undefined if I
  // haven't claimed my own club profile yet (players.user_id) — the sort/badge below just no-ops
  // in that case, same as it always effectively did before this rank (a flat, unsorted list).
  const myElo = players.find((p) => p.user_id === user?.id)?.elo_rating;
  const isCloseMatch = (elo: number) => myElo !== undefined && Math.abs(elo - myElo) <= ELO_CLOSE_MATCH_THRESHOLD;
  const challengeable = players
    .filter((p) => p.user_id && p.user_id !== user?.id)
    // Closest-Elo opponents first instead of the roster's default (alphabetical) order — the
    // whole point of a challenge list is finding someone worth playing, and burying the one
    // skill-appropriate name among everyone else was exactly as likely as surfacing it.
    .sort((a, b) => (myElo === undefined ? 0 : Math.abs(a.elo_rating - myElo) - Math.abs(b.elo_rating - myElo)));

  const sendChallenge = async () => {
    const opponent = challengeable.find((p) => p.id === opponentId);
    if (!opponent?.user_id || !user?.id || !clubId) return;
    setSending(true);
    const basePayload = {
      club_id: clubId,
      created_by: user.id,
      player1_user_id: user.id,
      player2_user_id: opponent.user_id,
      mode,
      best_of_legs: bestOf,
    };
    const settingsPayload = {
      double_in: doubleIn,
      double_out: doubleOut,
      starter,
      ...(mode === "custom" ? { custom_start_score: customStartScore } : {}),
    };
    let { error } = await supabase.from("online_matches").insert({ ...basePayload, ...settingsPayload });
    if (error && modeCheckViolation(error)) {
      // 'custom' itself needs the not-yet-applied migration — fall back to 501 while keeping the
      // other new settings (double_in/double_out/starter), which may already exist independently.
      ({ error } = await supabase.from("online_matches").insert({ ...basePayload, mode: "501", double_in: doubleIn, double_out: doubleOut, starter }));
    }
    if (error && missingOnlineSettingsColumn(error)) {
      // None of this round's new columns exist yet on this DB — fall back to the pre-upgrade shape
      // entirely so sending a challenge still works (just without these settings, same as before).
      ({ error } = await supabase.from("online_matches").insert(mode === "custom" ? { ...basePayload, mode: "501" } : basePayload));
    }
    setSending(false);
    if (error) {
      toast({ title: t("players.challengeFailed"), description: error.message, variant: "destructive" });
      return;
    }
    const myName = players.find((p) => p.user_id === user.id)?.name ?? "Jemand";
    notifyChallengeCreated(opponent.user_id, myName, mode);
    toast({ title: t("players.challengeSent"), description: t("players.challengeSentDesc") });
    navigate("/");
  };

  return (
    <div className="container py-6 animate-slide-up max-w-lg mx-auto">
      <Button variant="ghost" onClick={onBack} className="mb-4 text-muted-foreground -ml-2">
        <ArrowLeft className="w-4 h-4 mr-1" /> {t("common.back")}
      </Button>
      <div className="text-center mb-6">
        <Wifi className="w-10 h-10 text-primary mx-auto mb-2" />
        <h2 className="text-2xl font-display uppercase">{t("players.playOnline")}</h2>
      </div>

      {challengeable.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t("players.noOnlineOpponents")}</p>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">{t("players.chooseOpponent")}</p>
            <div className="space-y-1 max-h-[40vh] overflow-y-auto -mx-1 px-1">
              {challengeable.map((p) => (
                <label key={p.id} className={`flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer border ${opponentId === p.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted/50"}`}>
                  <input type="radio" name="opponent" className="sr-only" checked={opponentId === p.id} onChange={() => setOpponentId(p.id)} />
                  <span className="text-lg shrink-0">{p.emoji}</span>
                  <span className="flex-1 min-w-0 truncate text-sm">{p.name}</span>
                  {isCloseMatch(p.elo_rating) && (
                    <span className="text-[9px] uppercase tracking-wide text-primary shrink-0">{t("players.goodMatch")}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground shrink-0">{Math.round(p.elo_rating)} Elo</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("game.gameMode")}</p>
              <Select value={mode} onValueChange={(v) => setMode(v as (typeof MODES)[number])}>
                <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {MODES.map((m) => <SelectItem key={m} value={m}>{m === "cricket" ? "Cricket" : m === "custom" ? t("game.custom") : m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("players.legsFormat")}</p>
              <Select value={String(bestOf)} onValueChange={(v) => setBestOf(Number(v))}>
                <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {BEST_OF_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{t("stats.firstTo")} {Math.ceil(n / 2)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {mode === "custom" && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("game.startValue")}</p>
              <input
                type="number"
                value={customStartScore}
                onChange={(e) => setCustomStartScore(parseInt(e.target.value) || 0)}
                className="w-full rounded-lg bg-muted border border-border px-3 py-2 text-sm text-foreground"
              />
            </div>
          )}

          {mode !== "cricket" && (
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-3">
              <p className="text-xs text-muted-foreground uppercase font-display">{t("players.matchSettings")}</p>
              <div className="flex items-center justify-between">
                <span className="text-sm">{doubleIn ? t("game.doubleIn") : t("game.straightIn")}</span>
                <Switch checked={doubleIn} onCheckedChange={setDoubleIn} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">{doubleOut ? t("game.doubleOut") : t("game.singleOut")}</span>
                <Switch checked={doubleOut} onCheckedChange={setDoubleOut} />
              </div>
            </div>
          )}

          <div>
            <p className="text-xs text-muted-foreground mb-1.5">{t("players.starterLabel")}</p>
            <div className="grid grid-cols-3 gap-2">
              {STARTER_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStarter(s)}
                  className={`rounded-lg border px-2 py-2 text-xs font-display uppercase transition-colors ${starter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}
                >
                  {s === "challenger" ? t("players.starterChallenger") : s === "opponent" ? t("players.starterOpponent") : t("players.starterRandom")}
                </button>
              ))}
            </div>
          </div>

          <Button className="w-full gap-1.5 font-display uppercase" disabled={!opponentId || sending} onClick={sendChallenge}>
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
            {t("players.sendChallenge")}
          </Button>
        </div>
      )}
    </div>
  );
};

export default OnlineChallengeSetup;
