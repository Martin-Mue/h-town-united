import { useState } from "react";
import { Dumbbell, Target, RotateCw, Crosshair, Zap, Trophy, Play, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Training drill definition */
interface TrainingDrill {
  id: string;
  name: string;
  description: string;
  icon: typeof Target;
  difficulty: "Anfänger" | "Fortgeschritten" | "Profi";
  durationMinutes: number;
  category: "doubles" | "finishing" | "accuracy" | "pressure";
}

/** Available training drills */
const TRAINING_DRILLS: TrainingDrill[] = [
  {
    id: "doubles-only",
    name: "Doubles Only",
    description: "Triff jedes Doppelfeld einmal. Trainiere deine Checkout-Sicherheit.",
    icon: Target,
    difficulty: "Anfänger",
    durationMinutes: 15,
    category: "doubles",
  },
  {
    id: "around-the-clock",
    name: "Around the Clock",
    description: "Triff 1 bis 20 der Reihe nach. Perfekt für Genauigkeit und Routine.",
    icon: RotateCw,
    difficulty: "Anfänger",
    durationMinutes: 10,
    category: "accuracy",
  },
  {
    id: "121-challenge",
    name: "121 Challenge",
    description: "Starte bei 121 und checke aus. Wie viele Darts brauchst du?",
    icon: Crosshair,
    difficulty: "Fortgeschritten",
    durationMinutes: 10,
    category: "finishing",
  },
  {
    id: "pressure-training",
    name: "Pressure Training",
    description: "Simuliere Match-Situationen: 32, 40, 16 rest – checke unter Druck.",
    icon: Zap,
    difficulty: "Profi",
    durationMinutes: 20,
    category: "pressure",
  },
  {
    id: "random-finish",
    name: "Random Finish Drill",
    description: "Zufällige Checkout-Werte zwischen 2 und 170. Teste dein Wissen.",
    icon: Trophy,
    difficulty: "Fortgeschritten",
    durationMinutes: 15,
    category: "finishing",
  },
  {
    id: "t20-grind",
    name: "T20 Grind",
    description: "100 Darts auf Triple 20. Zähle deine Treffer und verbessere den Score.",
    icon: Target,
    difficulty: "Fortgeschritten",
    durationMinutes: 20,
    category: "accuracy",
  },
];

const DIFFICULTY_COLORS: Record<string, string> = {
  "Anfänger": "bg-secondary/20 text-secondary",
  "Fortgeschritten": "bg-primary/20 text-primary",
  "Profi": "bg-accent/20 text-accent",
};

/**
 * Training page with drill selection and coaching features.
 * Offers various practice modes for skill improvement.
 */
const TrainingPage = () => {
  const [selectedDrill, setSelectedDrill] = useState<TrainingDrill | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");

  const categories = [
    { key: "all", label: "Alle" },
    { key: "doubles", label: "Doppel" },
    { key: "finishing", label: "Finish" },
    { key: "accuracy", label: "Genauigkeit" },
    { key: "pressure", label: "Druck" },
  ];

  const filteredDrills = filterCategory === "all"
    ? TRAINING_DRILLS
    : TRAINING_DRILLS.filter((d) => d.category === filterCategory);

  if (selectedDrill) {
    return (
      <div className="container py-6 animate-slide-up max-w-lg mx-auto">
        <Button variant="ghost" onClick={() => setSelectedDrill(null)} className="mb-4 text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-1" /> Zurück
        </Button>

        <div className="bg-card rounded-xl border border-border p-6 text-center">
          <selectedDrill.icon className="w-12 h-12 text-primary mx-auto mb-3" />
          <h2 className="text-2xl font-display uppercase mb-2">{selectedDrill.name}</h2>
          <p className="text-muted-foreground text-sm mb-4">{selectedDrill.description}</p>

          <div className="flex justify-center gap-3 mb-6">
            <span className={`text-xs px-2 py-1 rounded-full ${DIFFICULTY_COLORS[selectedDrill.difficulty]}`}>
              {selectedDrill.difficulty}
            </span>
            <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
              ~{selectedDrill.durationMinutes} Min
            </span>
          </div>

          <Button className="w-full font-display uppercase text-lg py-6">
            <Play className="w-5 h-5 mr-2" /> Training starten
          </Button>

          <p className="text-xs text-muted-foreground mt-4">
            🚧 Interaktive Trainings-Logik wird in einem zukünftigen Update verfügbar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-6 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <Dumbbell className="w-6 h-6 text-primary" />
        <h2 className="text-2xl font-display uppercase">Training</h2>
      </div>

      {/* Category filter */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setFilterCategory(cat.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              filterCategory === cat.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Drill cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {filteredDrills.map((drill) => (
          <button
            key={drill.id}
            onClick={() => setSelectedDrill(drill)}
            className="bg-card border border-border rounded-xl p-4 text-left hover:border-primary/40 transition-all group"
          >
            <div className="flex items-start gap-3">
              <drill.icon className="w-8 h-8 text-primary shrink-0 group-hover:scale-110 transition-transform" />
              <div className="min-w-0">
                <p className="font-semibold text-sm mb-1">{drill.name}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{drill.description}</p>
                <div className="flex gap-2 mt-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${DIFFICULTY_COLORS[drill.difficulty]}`}>
                    {drill.difficulty}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {drill.durationMinutes} Min
                  </span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Coaching teaser */}
      <div className="mt-6 bg-card border border-primary/20 rounded-xl p-4">
        <h3 className="font-display uppercase text-sm mb-2 text-primary">🎯 Coaching</h3>
        <p className="text-sm text-muted-foreground">
          Personalisierte Trainingspläne basierend auf deinen Schwächen kommen bald.
          Das System analysiert deine Doppel-Quote, Checkout-Effizienz und gibt dir gezielte Übungen.
        </p>
      </div>
    </div>
  );
};

export default TrainingPage;
