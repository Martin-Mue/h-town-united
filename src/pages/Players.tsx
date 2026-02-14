import { useState, useEffect, useCallback } from "react";
import { Plus, Search, Trophy, Target, TrendingUp, BarChart3, Camera, Sparkles, Loader2, ArrowLeft, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

/** Player profile mapped from database */
interface PlayerProfile {
  id: string;
  name: string;
  nickname: string | null;
  emoji: string;
  avatar_url: string | null;
  ai_portrait_url: string | null;
  games_played: number;
  games_won: number;
  high_score: number;
  average: number;
  double_rate: number;
}

const EMOJI_AVATARS = ["🎯", "🏆", "⭐", "🔥", "💎", "🦅", "🐉", "🎪"];

/**
 * Club member management page with persistent player profiles.
 * Supports photo upload and AI-generated dart jersey portraits.
 */
const PlayersPage = () => {
  const [players, setPlayers] = useState<PlayerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerProfile | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // New player form state
  const [newName, setNewName] = useState("");
  const [newNickname, setNewNickname] = useState("");
  const [newEmoji, setNewEmoji] = useState("🎯");
  const [uploadedPhoto, setUploadedPhoto] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [generatingPortrait, setGeneratingPortrait] = useState(false);
  const [generatedPortrait, setGeneratedPortrait] = useState<string | null>(null);

  const { toast } = useToast();
  const { session } = useAuth();

  /** Generates signed URLs for player avatar/portrait storage paths */
  const resolveSignedUrls = async (players: PlayerProfile[]): Promise<PlayerProfile[]> => {
    const resolved = await Promise.all(
      players.map(async (p) => {
        const copy = { ...p };
        for (const field of ["avatar_url", "ai_portrait_url"] as const) {
          const val = p[field];
          if (val && !val.startsWith("data:")) {
            // Extract storage path from full URL or use as-is if already a path
            let path = val;
            const publicPrefix = "/object/public/player-avatars/";
            const idx = val.indexOf(publicPrefix);
            if (idx !== -1) path = val.substring(idx + publicPrefix.length);
            const signedPrefix = "/object/sign/player-avatars/";
            const idx2 = val.indexOf(signedPrefix);
            if (idx2 !== -1) path = val.substring(idx2 + signedPrefix.length).split("?")[0];

            const { data } = await supabase.storage
              .from("player-avatars")
              .createSignedUrl(path, 3600);
            if (data?.signedUrl) copy[field] = data.signedUrl;
          }
          return copy;
        }
        return copy;
      })
    );
    return resolved;
  };

  /** Fetches all players from the database */
  const fetchPlayers = useCallback(async () => {
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to fetch players:", error);
      toast({ title: "Fehler", description: "Spieler konnten nicht geladen werden.", variant: "destructive" });
    } else {
      const withSignedUrls = await resolveSignedUrls(data || []);
      setPlayers(withSignedUrls);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchPlayers();
  }, [fetchPlayers]);

  /** Handles photo file selection and creates preview */
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setUploadedPhoto(ev.target?.result as string);
    reader.readAsDataURL(file);
    setGeneratedPortrait(null);
  };

  /** Calls AI edge function to generate dart jersey portrait */
  const generateAiPortrait = async () => {
    setGeneratingPortrait(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-player-portrait`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            playerName: newName || "Player",
            sourceImageBase64: uploadedPhoto || undefined,
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "AI generation failed");
      }

      const data = await response.json();
      if (data.imageBase64) {
        setGeneratedPortrait(data.imageBase64);
        toast({ title: "Portrait generiert! 🎯", description: "Dein KI-Spielerportrait ist fertig." });
      }
    } catch (err: any) {
      console.error("AI portrait error:", err);
      toast({ title: "KI-Fehler", description: err.message || "Portrait konnte nicht generiert werden.", variant: "destructive" });
    } finally {
      setGeneratingPortrait(false);
    }
  };

  /** Uploads an image to storage and returns a signed URL */
  const uploadImageToStorage = async (dataUrl: string, playerId: string, suffix: string): Promise<string | null> => {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const ext = blob.type.includes("png") ? "png" : "jpg";
      const path = `${playerId}/${suffix}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("player-avatars")
        .upload(path, blob, { upsert: true, contentType: blob.type });

      if (uploadError) throw uploadError;

      const { data: urlData, error: signError } = await supabase.storage
        .from("player-avatars")
        .createSignedUrl(path, 3600);

      if (signError) throw signError;
      return urlData?.signedUrl ?? null;
    } catch (err) {
      console.error("Upload failed:", err);
      return null;
    }
  };

  /** Creates a new player with optional photos */
  const addPlayer = async () => {
    if (!newName.trim()) return;

    // Insert player first to get ID
    const { data: inserted, error } = await supabase
      .from("players")
      .insert({ name: newName.trim(), nickname: newNickname.trim() || null, emoji: newEmoji, user_id: session?.user?.id })
      .select()
      .single();

    if (error || !inserted) {
      toast({ title: "Fehler", description: "Spieler konnte nicht erstellt werden.", variant: "destructive" });
      return;
    }

    // Upload photos if available
    let avatarUrl: string | null = null;
    let aiPortraitUrl: string | null = null;

    if (uploadedPhoto) {
      avatarUrl = await uploadImageToStorage(uploadedPhoto, inserted.id, "avatar");
    }
    if (generatedPortrait) {
      aiPortraitUrl = await uploadImageToStorage(generatedPortrait, inserted.id, "ai-portrait");
    }

    // Update player with image URLs
    if (avatarUrl || aiPortraitUrl) {
      await supabase.from("players").update({
        avatar_url: avatarUrl,
        ai_portrait_url: aiPortraitUrl,
      }).eq("id", inserted.id);
    }

    // Reset form
    setNewName("");
    setNewNickname("");
    setNewEmoji("🎯");
    setUploadedPhoto(null);
    setUploadedFile(null);
    setGeneratedPortrait(null);
    setDialogOpen(false);
    fetchPlayers();
    toast({ title: "Mitglied hinzugefügt! 🎯", description: `${newName} ist jetzt im Verein.` });
  };

  const filteredPlayers = players.filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.nickname?.toLowerCase().includes(search.toLowerCase())
  );

  /** Renders the player's display image (AI portrait > avatar > emoji) */
  const PlayerAvatar = ({ player, size = "md" }: { player: PlayerProfile; size?: "sm" | "md" | "lg" }) => {
    const sizeClasses = { sm: "w-10 h-10", md: "w-14 h-14", lg: "w-20 h-20" };
    const textSize = { sm: "text-lg", md: "text-2xl", lg: "text-4xl" };
    const imgUrl = player.ai_portrait_url || player.avatar_url;

    if (imgUrl) {
      return (
        <img
          src={imgUrl}
          alt={`${player.name} portrait`}
          className={`${sizeClasses[size]} rounded-xl object-cover border border-border`}
        />
      );
    }
    return (
      <div className={`${sizeClasses[size]} rounded-xl bg-muted flex items-center justify-center ${textSize[size]}`}>
        {player.emoji}
      </div>
    );
  };

  // ─── PLAYER DETAIL VIEW ────────────────────────────
  if (selectedPlayer) {
    const winRate = selectedPlayer.games_played > 0
      ? Math.round((selectedPlayer.games_won / selectedPlayer.games_played) * 100) : 0;

    const skillRadarData = [
      { skill: "Average", value: Math.min(Number(selectedPlayer.average), 100) },
      { skill: "Highscore", value: (selectedPlayer.high_score / 180) * 100 },
      { skill: "Siegquote", value: winRate },
      { skill: "Erfahrung", value: Math.min(selectedPlayer.games_played * 2, 100) },
      { skill: "Doppelquote", value: Number(selectedPlayer.double_rate) },
    ];

    const winLossData = [
      { label: "Siege", value: selectedPlayer.games_won, fill: "hsl(155 65% 42%)" },
      { label: "Niederlagen", value: selectedPlayer.games_played - selectedPlayer.games_won, fill: "hsl(0 72% 51%)" },
    ];

    return (
      <div className="container py-6 animate-slide-up">
        <Button variant="ghost" onClick={() => setSelectedPlayer(null)} className="mb-4 text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-1" /> Zurück
        </Button>

        {/* Player header with portrait */}
        <div className="flex items-center gap-4 mb-6">
          <PlayerAvatar player={selectedPlayer} size="lg" />
          <div>
            <h2 className="text-2xl font-display uppercase">{selectedPlayer.name}</h2>
            {selectedPlayer.nickname && <p className="text-primary text-sm font-medium">"{selectedPlayer.nickname}"</p>}
          </div>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Spiele", value: selectedPlayer.games_played, icon: Target },
            { label: "Siege", value: `${selectedPlayer.games_won} (${winRate}%)`, icon: Trophy },
            { label: "Highscore", value: selectedPlayer.high_score, icon: TrendingUp },
            { label: "Ø Score", value: Number(selectedPlayer.average).toFixed(1), icon: BarChart3 },
          ].map((stat) => (
            <div key={stat.label} className="bg-card rounded-xl p-4 border border-border">
              <stat.icon className="w-4 h-4 text-primary mb-1" />
              <p className="text-2xl font-display">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-card rounded-xl border border-border p-4">
            <h3 className="font-display text-sm uppercase mb-3 text-muted-foreground">Skill Profil</h3>
            <ResponsiveContainer width="100%" height={180}>
              <RadarChart data={skillRadarData}>
                <PolarGrid stroke="hsl(222 18% 14%)" />
                <PolarAngleAxis dataKey="skill" tick={{ fontSize: 10, fill: "hsl(222 12% 50%)" }} />
                <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 100]} />
                <Radar dataKey="value" stroke="hsl(185 85% 48%)" fill="hsl(185 85% 48%)" fillOpacity={0.15} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-card rounded-xl border border-border p-4">
            <h3 className="font-display text-sm uppercase mb-3 text-muted-foreground">Siege / Niederlagen</h3>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={winLossData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(222 12% 50%)" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: "hsl(222 12% 50%)" }} axisLine={false} tickLine={false} width={80} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    );
  }

  // ─── PLAYER LIST VIEW ──────────────────────────────
  return (
    <div className="container py-6 animate-slide-up">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-display uppercase">Verein</h2>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setUploadedPhoto(null);
            setUploadedFile(null);
            setGeneratedPortrait(null);
          }
        }}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1"><Plus className="w-4 h-4" /> Mitglied</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-display uppercase">Neues Mitglied</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name *</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Vor- und Nachname" className="bg-muted border-border" />
              </div>
              <div>
                <Label>Spitzname</Label>
                <Input value={newNickname} onChange={(e) => setNewNickname(e.target.value)} placeholder="Optional" className="bg-muted border-border" />
              </div>

              {/* Emoji avatar picker */}
              <div>
                <Label>Emoji Avatar</Label>
                <div className="flex gap-2 mt-1 flex-wrap">
                  {EMOJI_AVATARS.map((a) => (
                    <button key={a} onClick={() => setNewEmoji(a)}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl transition-all ${newEmoji === a ? "bg-primary/20 ring-2 ring-primary" : "bg-muted hover:bg-muted/80"}`}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>

              {/* Photo upload */}
              <div>
                <Label className="flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5" /> Foto hochladen
                </Label>
                <p className="text-xs text-muted-foreground mb-2">Lade ein Foto hoch, um ein KI-Spielerportrait im Darttrikot zu generieren.</p>
                <label className="flex items-center justify-center gap-2 w-full h-24 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary/50 transition-colors bg-muted/30">
                  <input type="file" accept="image/*" onChange={handlePhotoSelect} className="hidden" />
                  {uploadedPhoto ? (
                    <img src={uploadedPhoto} alt="Preview" className="h-20 w-20 object-cover rounded-lg" />
                  ) : (
                    <div className="text-center">
                      <Upload className="w-6 h-6 text-muted-foreground mx-auto mb-1" />
                      <span className="text-xs text-muted-foreground">Foto auswählen</span>
                    </div>
                  )}
                </label>
              </div>

              {/* AI Portrait Generation */}
              {(uploadedPhoto || newName.trim()) && (
                <div>
                  <Button
                    variant="outline"
                    onClick={generateAiPortrait}
                    disabled={generatingPortrait}
                    className="w-full gap-2 border-primary/30 hover:border-primary/60"
                  >
                    {generatingPortrait ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> KI generiert Portrait...</>
                    ) : (
                      <><Sparkles className="w-4 h-4 text-accent" /> KI-Portrait im Darttrikot generieren</>
                    )}
                  </Button>

                  {generatedPortrait && (
                    <div className="mt-3 text-center">
                      <p className="text-xs text-muted-foreground mb-2">KI-generiertes Spielerportrait:</p>
                      <img
                        src={generatedPortrait}
                        alt="AI Generated Portrait"
                        className="w-32 h-32 rounded-xl object-cover mx-auto border-2 border-primary/30 glow-cyan"
                      />
                    </div>
                  )}
                </div>
              )}

              <Button onClick={addPlayer} className="w-full" disabled={!newName.trim()}>
                Mitglied hinzufügen
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Mitglied suchen..." className="pl-9 bg-card border-border" />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : filteredPlayers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Target className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Noch keine Mitglieder. Füge dein erstes Vereinsmitglied hinzu!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredPlayers.map((player) => (
            <button key={player.id} onClick={() => setSelectedPlayer(player)}
              className="bg-card border border-border rounded-xl p-4 text-left hover:border-primary/50 transition-all group">
              <div className="flex items-center gap-3 mb-3">
                <div className="group-hover:scale-110 transition-transform">
                  <PlayerAvatar player={player} size="md" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{player.name}</p>
                  {player.nickname && <p className="text-xs text-primary truncate">"{player.nickname}"</p>}
                </div>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{player.games_played} Spiele</span>
                <span className="text-secondary font-medium">
                  {player.games_played > 0 ? Math.round((player.games_won / player.games_played) * 100) : 0}% Siege
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default PlayersPage;
