import { useState } from "react";
import { Plus, Search, Trophy, Target, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export interface Player {
  id: string;
  name: string;
  nickname?: string;
  avatar: string;
  gamesPlayed: number;
  gamesWon: number;
  highScore: number;
  avg: number;
  history: GameRecord[];
}

export interface GameRecord {
  id: string;
  date: string;
  mode: string;
  score: number;
  won: boolean;
  opponent?: string;
}

const AVATARS = ["🎯", "🏆", "⭐", "🔥", "💎", "🦅", "🐉", "🎪"];

const defaultPlayers: Player[] = [
  {
    id: "1", name: "Max Müller", nickname: "Bullseye", avatar: "🎯",
    gamesPlayed: 47, gamesWon: 31, highScore: 180, avg: 62.4,
    history: [
      { id: "h1", date: "2026-02-10", mode: "501", score: 501, won: true, opponent: "Anna" },
      { id: "h2", date: "2026-02-08", mode: "301", score: 301, won: false, opponent: "Tom" },
    ],
  },
  {
    id: "2", name: "Anna Schmidt", nickname: "Triple Queen", avatar: "🏆",
    gamesPlayed: 52, gamesWon: 38, highScore: 174, avg: 68.1,
    history: [
      { id: "h3", date: "2026-02-10", mode: "501", score: 501, won: false, opponent: "Max" },
    ],
  },
  {
    id: "3", name: "Tom Weber", nickname: "The Machine", avatar: "🔥",
    gamesPlayed: 35, gamesWon: 20, highScore: 160, avg: 55.7,
    history: [],
  },
  {
    id: "4", name: "Lisa Fischer", avatar: "💎",
    gamesPlayed: 28, gamesWon: 15, highScore: 140, avg: 48.3,
    history: [],
  },
];

const PlayersPage = () => {
  const [players, setPlayers] = useState<Player[]>(defaultPlayers);
  const [search, setSearch] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [newName, setNewName] = useState("");
  const [newNickname, setNewNickname] = useState("");
  const [newAvatar, setNewAvatar] = useState("🎯");
  const [dialogOpen, setDialogOpen] = useState(false);

  const filtered = players.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.nickname?.toLowerCase().includes(search.toLowerCase())
  );

  const addPlayer = () => {
    if (!newName.trim()) return;
    const player: Player = {
      id: Date.now().toString(),
      name: newName,
      nickname: newNickname || undefined,
      avatar: newAvatar,
      gamesPlayed: 0, gamesWon: 0, highScore: 0, avg: 0,
      history: [],
    };
    setPlayers([...players, player]);
    setNewName(""); setNewNickname(""); setNewAvatar("🎯");
    setDialogOpen(false);
  };

  if (selectedPlayer) {
    return (
      <div className="container py-6 animate-slide-up">
        <Button variant="ghost" onClick={() => setSelectedPlayer(null)} className="mb-4 text-muted-foreground">
          ← Zurück
        </Button>
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center text-3xl">
            {selectedPlayer.avatar}
          </div>
          <div>
            <h2 className="text-2xl font-display uppercase">{selectedPlayer.name}</h2>
            {selectedPlayer.nickname && (
              <p className="text-primary text-sm font-medium">"{selectedPlayer.nickname}"</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {[
            { label: "Spiele", value: selectedPlayer.gamesPlayed, icon: Target },
            { label: "Siege", value: selectedPlayer.gamesWon, icon: Trophy },
            { label: "High Score", value: selectedPlayer.highScore, icon: TrendingUp },
            { label: "Ø Score", value: selectedPlayer.avg.toFixed(1), icon: Target },
          ].map((stat) => (
            <div key={stat.label} className="bg-card rounded-xl p-4 border border-border">
              <stat.icon className="w-4 h-4 text-muted-foreground mb-1" />
              <p className="text-2xl font-display">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        <h3 className="font-display text-lg uppercase mb-3">Spielhistorie</h3>
        {selectedPlayer.history.length === 0 ? (
          <p className="text-muted-foreground text-sm">Noch keine Spiele gespielt.</p>
        ) : (
          <div className="space-y-2">
            {selectedPlayer.history.map((game) => (
              <div key={game.id} className="flex items-center justify-between bg-card rounded-lg p-3 border border-border">
                <div>
                  <span className="font-medium">{game.mode}</span>
                  {game.opponent && <span className="text-muted-foreground text-sm ml-2">vs {game.opponent}</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">{game.date}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${game.won ? "bg-secondary/20 text-secondary" : "bg-primary/20 text-primary"}`}>
                    {game.won ? "Sieg" : "Niederlage"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="container py-6 animate-slide-up">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-display uppercase">Spieler</h2>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1">
              <Plus className="w-4 h-4" /> Neu
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="font-display uppercase">Neuer Spieler</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name eingeben" className="bg-muted border-border" />
              </div>
              <div>
                <Label>Spitzname (optional)</Label>
                <Input value={newNickname} onChange={(e) => setNewNickname(e.target.value)} placeholder="Spitzname" className="bg-muted border-border" />
              </div>
              <div>
                <Label>Avatar</Label>
                <div className="flex gap-2 mt-1">
                  {AVATARS.map((a) => (
                    <button
                      key={a}
                      onClick={() => setNewAvatar(a)}
                      className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl transition-all ${
                        newAvatar === a ? "bg-primary/20 ring-2 ring-primary" : "bg-muted hover:bg-muted/80"
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              <Button onClick={addPlayer} className="w-full">Spieler hinzufügen</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Spieler suchen..."
          className="pl-9 bg-card border-border"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((player) => (
          <button
            key={player.id}
            onClick={() => setSelectedPlayer(player)}
            className="bg-card border border-border rounded-xl p-4 text-left hover:border-primary/50 transition-all group"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                {player.avatar}
              </div>
              <div>
                <p className="font-semibold">{player.name}</p>
                {player.nickname && <p className="text-xs text-primary">"{player.nickname}"</p>}
              </div>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{player.gamesPlayed} Spiele</span>
              <span className="text-secondary font-medium">
                {player.gamesPlayed > 0 ? Math.round((player.gamesWon / player.gamesPlayed) * 100) : 0}% Siege
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default PlayersPage;
