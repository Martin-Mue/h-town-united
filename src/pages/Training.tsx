import { useState, useCallback } from "react";
import { Dumbbell, Target, RotateCw, Crosshair, Zap, Trophy, Play, ArrowLeft, RotateCcw, CheckCircle, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import DartScoreInput from "@/components/game/DartScoreInput";
import CheckoutSuggestion from "@/components/game/CheckoutSuggestion";
import CoachingPlan from "@/components/training/CoachingPlan";
import LiveCamera, { type DetectedDart } from "@/components/game/LiveCamera";

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
    description: "30 Darts auf Triple 20. Zähle deine Treffer und verbessere den Score.",
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

/** Double fields for doubles-only drill */
const DOUBLE_TARGETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 25];

/** Pressure checkout values */
const PRESSURE_CHECKOUTS = [32, 40, 16, 36, 24, 8, 20, 50, 64, 80];

/** Generates a random checkout between 2 and 170 */
function randomCheckout(): number {
  return Math.floor(Math.random() * 169) + 2;
}

/** Active drill state */
interface DrillState {
  drillId: string;
  dartsThrown: number;
  dartsThisRound: number;
  hits: number;
  currentTarget: number;
  targetList: number[];
  targetIndex: number;
  remaining: number; // for checkout drills
  finished: boolean;
  roundScores: number[]; // per-round scores for summary
}

const TrainingPage = () => {
  const [selectedDrill, setSelectedDrill] = useState<TrainingDrill | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [drillState, setDrillState] = useState<DrillState | null>(null);
  const [selectedScore, setSelectedScore] = useState(20);
  const [multiplier, setMultiplier] = useState(1);
  const [cameraEnabled, setCameraEnabled] = useState(false);

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

  /** Start an active drill session */
  const startDrill = (drill: TrainingDrill) => {
    let state: DrillState = {
      drillId: drill.id,
      dartsThrown: 0,
      dartsThisRound: 0,
      hits: 0,
      currentTarget: 0,
      targetList: [],
      targetIndex: 0,
      remaining: 0,
      finished: false,
      roundScores: [],
    };

    switch (drill.id) {
      case "around-the-clock":
        state.targetList = Array.from({ length: 20 }, (_, i) => i + 1);
        state.currentTarget = 1;
        break;
      case "doubles-only":
        state.targetList = [...DOUBLE_TARGETS];
        state.currentTarget = DOUBLE_TARGETS[0];
        break;
      case "121-challenge":
        state.remaining = 121;
        state.currentTarget = 121;
        break;
      case "pressure-training":
        state.targetList = [...PRESSURE_CHECKOUTS];
        state.currentTarget = PRESSURE_CHECKOUTS[0];
        state.remaining = PRESSURE_CHECKOUTS[0];
        break;
      case "random-finish":
        const val = randomCheckout();
        state.remaining = val;
        state.currentTarget = val;
        break;
      case "t20-grind":
        state.currentTarget = 60; // T20
        break;
    }

    setDrillState(state);
  };

  /** Process a single dart (from manual input or camera) in the active drill */
  const processDart = useCallback((scoreValue: number, mul: number) => {
    if (!selectedDrill) return;
    const points = scoreValue === 25 && mul === 3 ? 0 : scoreValue * mul;
    const baseValue = scoreValue === 50 ? 25 : scoreValue;

    setDrillState((prev) => {
      if (!prev || prev.finished) return prev;
      const newDartsThisRound = prev.dartsThisRound + 1;
      const updated = { ...prev, dartsThrown: prev.dartsThrown + 1, dartsThisRound: newDartsThisRound };

      switch (selectedDrill.id) {
        case "around-the-clock": {
          // Hit the current target number (any multiplier)
          if (baseValue === prev.currentTarget) {
            updated.hits++;
            const nextIdx = prev.targetIndex + 1;
            if (nextIdx >= prev.targetList.length) {
              updated.finished = true;
            } else {
              updated.targetIndex = nextIdx;
              updated.currentTarget = prev.targetList[nextIdx];
            }
          }
          break;
        }

        case "doubles-only": {
          // Must hit the double of the current target
          if (baseValue === prev.currentTarget && mul === 2) {
            updated.hits++;
            const nextIdx = prev.targetIndex + 1;
            if (nextIdx >= prev.targetList.length) {
              updated.finished = true;
            } else {
              updated.targetIndex = nextIdx;
              updated.currentTarget = prev.targetList[nextIdx];
            }
          }
          break;
        }

        case "121-challenge": {
          const newRemaining = prev.remaining - points;
          if (newRemaining < 0 || newRemaining === 1) {
            // Bust - reset round, move to next round of 3
            if (newDartsThisRound >= 3) {
              updated.dartsThisRound = 0;
              updated.remaining = prev.remaining; // keep same (bust resets)
            }
          } else if (newRemaining === 0) {
            updated.remaining = 0;
            updated.finished = true;
            updated.hits++;
          } else {
            updated.remaining = newRemaining;
            updated.currentTarget = newRemaining;
          }
          break;
        }

        case "pressure-training": {
          const newRemaining = prev.remaining - points;
          if (newRemaining === 0) {
            updated.hits++;
            const nextIdx = prev.targetIndex + 1;
            if (nextIdx >= prev.targetList.length) {
              updated.finished = true;
            } else {
              updated.targetIndex = nextIdx;
              updated.currentTarget = prev.targetList[nextIdx];
              updated.remaining = prev.targetList[nextIdx];
            }
            updated.dartsThisRound = 0;
          } else if (newRemaining < 0 || newRemaining === 1) {
            // Bust - reset to start of this checkout after 3 darts
            if (newDartsThisRound >= 3) {
              updated.remaining = prev.targetList[prev.targetIndex];
              updated.dartsThisRound = 0;
            }
          } else {
            updated.remaining = newRemaining;
            if (newDartsThisRound >= 3) {
              // Failed to check out in 3 darts, reset
              updated.remaining = prev.targetList[prev.targetIndex];
              updated.dartsThisRound = 0;
            }
          }
          break;
        }

        case "random-finish": {
          const newRemaining = prev.remaining - points;
          if (newRemaining === 0) {
            updated.hits++;
            // Generate next random checkout
            const next = randomCheckout();
            updated.remaining = next;
            updated.currentTarget = next;
            updated.dartsThisRound = 0;
            // After 10 successful checkouts, finish
            if (updated.hits >= 10) {
              updated.finished = true;
            }
          } else if (newRemaining < 0 || newRemaining === 1) {
            if (newDartsThisRound >= 3) {
              // Reset this checkout
              const next = randomCheckout();
              updated.remaining = next;
              updated.currentTarget = next;
              updated.dartsThisRound = 0;
            }
          } else {
            updated.remaining = newRemaining;
            if (newDartsThisRound >= 3) {
              const next = randomCheckout();
              updated.remaining = next;
              updated.currentTarget = next;
              updated.dartsThisRound = 0;
            }
          }
          break;
        }

        case "t20-grind": {
          // Count T20 hits out of 30 darts
          if (baseValue === 20 && mul === 3) {
            updated.hits++;
          }
          updated.roundScores = [...(prev.roundScores || []), points];
          if (updated.dartsThrown >= 30) {
            updated.finished = true;
          }
          break;
        }
      }

      // Auto-advance round counter after 3 darts (for drills that don't handle it themselves)
      if (newDartsThisRound >= 3 && !["pressure-training", "random-finish", "121-challenge"].includes(selectedDrill.id)) {
        updated.dartsThisRound = 0;
      }

      return updated;
    });
  }, [selectedDrill]);

  const handleDrillThrow = useCallback(() => {
    processDart(selectedScore, multiplier);
  }, [processDart, selectedScore, multiplier]);

  const handleCameraRound = useCallback((darts: DetectedDart[]) => {
    darts.forEach((d) => processDart(d.baseValue, d.multiplier));
  }, [processDart]);

  const exitDrill = () => {
    setDrillState(null);
    setSelectedDrill(null);
  };

  const restartDrill = () => {
    if (selectedDrill) startDrill(selectedDrill);
  };

  // ─── ACTIVE DRILL VIEW ────────────────────────────
  if (selectedDrill && drillState) {
    const isCheckoutDrill = ["121-challenge", "pressure-training", "random-finish"].includes(selectedDrill.id);

    return (
      <div className="container py-6 animate-slide-up max-w-lg mx-auto">
        <Button variant="ghost" onClick={exitDrill} className="mb-4 text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-1" /> Zurück
        </Button>

        <div className="text-center mb-4">
          <selectedDrill.icon className="w-10 h-10 text-primary mx-auto mb-2" />
          <h2 className="text-xl font-display uppercase">{selectedDrill.name}</h2>
        </div>

        {/* Drill finished overlay */}
        {drillState.finished && (
          <div className="bg-card border border-primary/30 rounded-2xl p-6 text-center mb-4 glow-cyan animate-scale-in">
            <CheckCircle className="w-12 h-12 text-secondary mx-auto mb-3" />
            <h3 className="text-2xl font-display uppercase mb-2">Geschafft! 🎯</h3>
            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-2xl font-display">{drillState.dartsThrown}</p>
                <p className="text-xs text-muted-foreground">Darts geworfen</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-2xl font-display">{drillState.hits}</p>
                <p className="text-xs text-muted-foreground">Treffer</p>
              </div>
              {selectedDrill.id === "t20-grind" && (
                <>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-2xl font-display">
                      {Math.round((drillState.hits / 30) * 100)}%
                    </p>
                    <p className="text-xs text-muted-foreground">T20 Quote</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-2xl font-display">
                      {Math.round(drillState.roundScores.reduce((a, b) => a + b, 0) / 10)}
                    </p>
                    <p className="text-xs text-muted-foreground">Ø 3-Dart</p>
                  </div>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={restartDrill} variant="outline" className="flex-1 gap-1">
                <RotateCcw className="w-4 h-4" /> Nochmal
              </Button>
              <Button onClick={exitDrill} className="flex-1">
                Beenden
              </Button>
            </div>
          </div>
        )}

        {!drillState.finished && (
          <>
            {/* Drill status info (sticky so it stays visible when the camera is open) */}
            <div className="sticky top-0 z-30 -mx-4 px-4 pt-2 pb-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border/40 mb-3">
            <div className="bg-card rounded-xl border border-border p-4 text-center">
              {/* Target display */}
              {selectedDrill.id === "around-the-clock" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Triff die</p>
                  <p className="text-5xl font-display text-primary">{drillState.currentTarget}</p>
                  <p className="text-xs text-muted-foreground mt-1">{drillState.targetIndex + 1} / {drillState.targetList.length}</p>
                </div>
              )}
              {selectedDrill.id === "doubles-only" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Triff Double</p>
                  <p className="text-5xl font-display text-primary">D{drillState.currentTarget}</p>
                  <p className="text-xs text-muted-foreground mt-1">{drillState.targetIndex + 1} / {drillState.targetList.length}</p>
                </div>
              )}
              {isCheckoutDrill && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Checkout</p>
                  <p className="text-5xl font-display text-primary">{drillState.remaining}</p>
                  {selectedDrill.id === "pressure-training" && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Checkout {drillState.targetIndex + 1} / {drillState.targetList.length}
                    </p>
                  )}
                  {selectedDrill.id === "random-finish" && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Geschafft: {drillState.hits} / 10
                    </p>
                  )}
                </div>
              )}
              {selectedDrill.id === "t20-grind" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Triple 20 Treffer</p>
                  <p className="text-5xl font-display text-primary">{drillState.hits}</p>
                  <p className="text-xs text-muted-foreground mt-1">{drillState.dartsThrown} / 30 Darts</p>
                </div>
              )}

              {/* Dart counter */}
              <div className="flex justify-center gap-1 mt-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className={`w-3 h-3 rounded-full transition-all ${
                      i < drillState.dartsThisRound ? "bg-primary" : "bg-muted"
                    }`}
                  />
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Dart {drillState.dartsThisRound + 1} / 3 · Gesamt: {drillState.dartsThrown}
              </p>
            </div>
            </div>

            {/* Checkout suggestion for finish drills */}
            {isCheckoutDrill && drillState.remaining <= 170 && (
              <div className="mb-3">
                <CheckoutSuggestion remaining={drillState.remaining} playerName="Training" />
              </div>
            )}

            {/* Live Camera (auto-scoring) */}
            {cameraEnabled && (
              <LiveCamera
                enabled={cameraEnabled}
                onClose={() => setCameraEnabled(false)}
                onRoundCommit={handleCameraRound}
                dartsRemaining={Math.max(1, 3 - drillState.dartsThisRound)}
                playerName="Training"
              />
            )}

            {/* Score input */}
            <DartScoreInput
              selectedValue={selectedScore}
              selectedMultiplier={multiplier}
              isDisabled={drillState.finished}
              onValueSelect={setSelectedScore}
              onMultiplierSelect={setMultiplier}
              onSubmit={handleDrillThrow}
            />

            {/* Camera toggle */}
            <div className="mt-3">
              <Button
                variant={cameraEnabled ? "default" : "outline"}
                onClick={() => setCameraEnabled((v) => !v)}
                className="w-full gap-2"
              >
                <Camera className="w-4 h-4" /> {cameraEnabled ? "Kamera aus" : "Kamera-Scoring"}
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ─── DRILL SELECTION (pre-start) ──────────────────
  if (selectedDrill && !drillState) {
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

          <Button onClick={() => startDrill(selectedDrill)} className="w-full font-display uppercase text-lg py-6">
            <Play className="w-5 h-5 mr-2" /> Training starten
          </Button>
        </div>
      </div>
    );
  }

  // ─── DRILL LIST VIEW ──────────────────────────────
  return (
    <div className="container py-6 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <Dumbbell className="w-6 h-6 text-primary" />
        <h2 className="text-2xl font-display uppercase">Training</h2>
      </div>

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

      <div className="mt-6">
        <CoachingPlan
          onStartDrill={(drillId) => {
            const drill = TRAINING_DRILLS.find((d) => d.id === drillId);
            if (drill) {
              setSelectedDrill(drill);
              startDrill(drill);
            }
          }}
        />
      </div>
    </div>
  );
};

export default TrainingPage;
