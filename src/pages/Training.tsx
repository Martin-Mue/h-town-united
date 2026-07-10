import { useState, useCallback } from "react";
import { Dumbbell, Target, RotateCw, Crosshair, Zap, Trophy, Play, ArrowLeft, RotateCcw, CheckCircle, Camera, Lock, Shuffle, Settings2 } from "lucide-react";
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
    id: "target-grind",
    name: "Target Grind",
    description: "Wähle dein Zielfeld (z. B. T20, T19, Bull). Wirf X Runden und zähle deine Treffer.",
    icon: Target,
    difficulty: "Fortgeschritten",
    durationMinutes: 20,
    category: "accuracy",
  },
  {
    id: "big-single-lock",
    name: "Big Single Lock",
    description: "Start bei S1. 3 Singles = Segment gelockt. 2 Treffer = weiter, 1 Treffer = zurück zum letzten Lock. Aufsteigend bis S20.",
    icon: Lock,
    difficulty: "Fortgeschritten",
    durationMinutes: 15,
    category: "accuracy",
  },
  {
    id: "random-score",
    name: "Random Score",
    description: "10 Runden, in jeder Runde ein zufälliges Zielsegment (S/D/T). Wirf 3 Darts pro Runde und sammle Treffer.",
    icon: Shuffle,
    difficulty: "Fortgeschritten",
    durationMinutes: 10,
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

/** Single targets for Big Single Lock (ascending 1 → 20) */
const BIG_SINGLE_TARGETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

/** Pressure checkout values */
const PRESSURE_CHECKOUTS = [32, 40, 16, 36, 24, 8, 20, 50, 64, 80];

/** Generates a random checkout between 2 and 170 */
function randomCheckout(): number {
  return Math.floor(Math.random() * 169) + 2;
}

/** Generates a random random-score target: {base, mul, label} */
function randomTarget(): { base: number; mul: number; label: string } {
  const roll = Math.random();
  if (roll < 0.15) {
    // Bull / Bullseye
    return Math.random() < 0.5
      ? { base: 25, mul: 1, label: "Bull (25)" }
      : { base: 25, mul: 2, label: "Bullseye (50)" };
  }
  const base = Math.floor(Math.random() * 20) + 1;
  const mulRoll = Math.random();
  if (mulRoll < 0.55) return { base, mul: 1, label: `S${base}` };
  if (mulRoll < 0.85) return { base, mul: 2, label: `D${base}` };
  return { base, mul: 3, label: `T${base}` };
}

/** Active drill state */
interface DrillState {
  drillId: string;
  dartsThrown: number;
  dartsThisRound: number;
  hits: number;
  hitsThisRound: number;
  currentTarget: number;
  targetList: number[];
  targetIndex: number;
  remaining: number; // for checkout drills
  finished: boolean;
  roundScores: number[]; // per-round scores for summary
  /** Big Single Lock: index of the last locked segment (or -1) */
  lockedIndex?: number;
  /** Configurable round cap for endless drills */
  maxRounds?: number;
  roundsPlayed?: number;
  /** Target Grind: chosen target multiplier & base */
  targetBase?: number;
  targetMul?: number;
  /** Random Score: current random target label + spec */
  randomBase?: number;
  randomMul?: number;
  randomLabel?: string;
}

/** Pre-start configuration for a drill */
interface DrillConfig {
  maxRounds?: number;
  targetBase?: number;
  targetMul?: number;
}

const TrainingPage = () => {
  const [selectedDrill, setSelectedDrill] = useState<TrainingDrill | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [drillState, setDrillState] = useState<DrillState | null>(null);
  const [selectedScore, setSelectedScore] = useState(20);
  const [multiplier, setMultiplier] = useState(1);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [drillConfig, setDrillConfig] = useState<DrillConfig>({});

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
  const startDrill = (drill: TrainingDrill, config: DrillConfig = drillConfig) => {
    let state: DrillState = {
      drillId: drill.id,
      dartsThrown: 0,
      dartsThisRound: 0,
      hits: 0,
      hitsThisRound: 0,
      currentTarget: 0,
      targetList: [],
      targetIndex: 0,
      remaining: 0,
      finished: false,
      roundScores: [],
      roundsPlayed: 0,
      maxRounds: config.maxRounds,
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
      case "target-grind": {
        const base = config.targetBase ?? 20;
        const mul = config.targetMul ?? 3;
        state.targetBase = base;
        state.targetMul = mul;
        state.currentTarget = base * mul;
        state.maxRounds = config.maxRounds ?? 10;
        break;
      }
      case "big-single-lock":
        state.targetList = [...BIG_SINGLE_TARGETS];
        state.currentTarget = BIG_SINGLE_TARGETS[0];
        state.lockedIndex = -1;
        break;
      case "random-score": {
        const t = randomTarget();
        state.randomBase = t.base;
        state.randomMul = t.mul;
        state.randomLabel = t.label;
        state.maxRounds = 10;
        break;
      }
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

        case "target-grind": {
          // Count hits on chosen target across configured rounds
          if (
            baseValue === (prev.targetBase ?? 20) &&
            mul === (prev.targetMul ?? 3)
          ) {
            updated.hits++;
          }
          updated.roundScores = [...(prev.roundScores || []), points];
          const totalDarts = (prev.maxRounds ?? 10) * 3;
          if (updated.dartsThrown >= totalDarts) {
            updated.finished = true;
          }
          break;
        }

        case "big-single-lock": {
          // Count single hits on the current target within the 3-dart round
          if (baseValue === prev.currentTarget && mul === 1) {
            updated.hits++;
            updated.hitsThisRound = prev.hitsThisRound + 1;
          }
          updated.roundScores = [...(prev.roundScores || []), points];
          break;
        }

        case "random-score": {
          if (
            baseValue === (prev.randomBase ?? 0) &&
            mul === (prev.randomMul ?? 0)
          ) {
            updated.hits++;
            updated.hitsThisRound = prev.hitsThisRound + 1;
          }
          updated.roundScores = [...(prev.roundScores || []), points];
          break;
        }
      }

      // End of round handling
      if (newDartsThisRound >= 3 && !["pressure-training", "random-finish", "121-challenge"].includes(selectedDrill.id)) {
        updated.dartsThisRound = 0;
        updated.roundsPlayed = (prev.roundsPlayed ?? 0) + 1;

        // Big Single Lock: evaluate hits this round
        if (selectedDrill.id === "big-single-lock") {
          const hitsRound = updated.hitsThisRound;
          const locked = prev.lockedIndex ?? -1;
          const len = prev.targetList.length;
          let nextIdx = prev.targetIndex;
          let nextLocked = locked;
          if (hitsRound >= 3) {
            // Lock current, advance
            nextLocked = prev.targetIndex;
            nextIdx = Math.min(prev.targetIndex + 1, len - 1);
            if (prev.targetIndex >= len - 1) updated.finished = true;
          } else if (hitsRound === 2) {
            // Advance without locking
            nextIdx = Math.min(prev.targetIndex + 1, len - 1);
            if (prev.targetIndex >= len - 1) updated.finished = true;
          } else if (hitsRound <= 1) {
            // Fall back to last locked segment (or stay at start)
            nextIdx = locked >= 0 ? locked + 1 <= prev.targetIndex ? locked : prev.targetIndex : 0;
            nextIdx = locked >= 0 ? locked : 0;
          }
          updated.targetIndex = nextIdx;
          updated.currentTarget = prev.targetList[nextIdx];
          updated.lockedIndex = nextLocked;
          updated.hitsThisRound = 0;
        }

        // Random Score: draw new target
        if (selectedDrill.id === "random-score") {
          const t = randomTarget();
          updated.randomBase = t.base;
          updated.randomMul = t.mul;
          updated.randomLabel = t.label;
          updated.hitsThisRound = 0;
          if ((updated.roundsPlayed ?? 0) >= (prev.maxRounds ?? 10)) {
            updated.finished = true;
          }
        }

        // Generic round cap for endless drills
        if (
          !updated.finished &&
          prev.maxRounds &&
          (updated.roundsPlayed ?? 0) >= prev.maxRounds &&
          ["around-the-clock", "doubles-only", "big-single-lock"].includes(selectedDrill.id)
        ) {
          updated.finished = true;
        }
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
              {selectedDrill.id === "target-grind" && (
                <>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-2xl font-display">
                      {drillState.dartsThrown > 0 ? Math.round((drillState.hits / drillState.dartsThrown) * 100) : 0}%
                    </p>
                    <p className="text-xs text-muted-foreground">Trefferquote</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-2xl font-display">
                      {drillState.roundScores.length > 0
                        ? Math.round((drillState.roundScores.reduce((a, b) => a + b, 0) / drillState.roundScores.length) * 3)
                        : 0}
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
                  <p className="text-xs text-muted-foreground mb-1">Legacy</p>
                </div>
              )}
              {selectedDrill.id === "target-grind" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Ziel</p>
                  <p className="text-5xl font-display text-primary">
                    {(drillState.targetMul === 3 ? "T" : drillState.targetMul === 2 ? "D" : "S") + (drillState.targetBase ?? 20)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Treffer: {drillState.hits} · Runde {(drillState.roundsPlayed ?? 0) + 1} / {drillState.maxRounds ?? 10}
                  </p>
                </div>
              )}
              {selectedDrill.id === "big-single-lock" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Triff Single · Runde: {drillState.hitsThisRound}/3 Treffer
                  </p>
                  <p className="text-5xl font-display text-primary">S{drillState.currentTarget}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Locked: {drillState.lockedIndex !== undefined && drillState.lockedIndex >= 0
                      ? `S${drillState.targetList[drillState.lockedIndex]}`
                      : "—"} · Feld {drillState.targetIndex + 1} / {drillState.targetList.length}
                    {drillState.maxRounds ? ` · Runde ${(drillState.roundsPlayed ?? 0) + 1}/${drillState.maxRounds}` : ""}
                  </p>
                </div>
              )}
              {selectedDrill.id === "random-score" && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Zufalls-Ziel</p>
                  <p className="text-5xl font-display text-primary">{drillState.randomLabel}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Runde {(drillState.roundsPlayed ?? 0) + 1} / {drillState.maxRounds ?? 10} · Treffer gesamt: {drillState.hits}
                  </p>
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
    const supportsRoundLimit = ["around-the-clock", "doubles-only", "big-single-lock", "target-grind"].includes(selectedDrill.id);
    const isTargetGrind = selectedDrill.id === "target-grind";
    return (
      <div className="container py-6 animate-slide-up max-w-lg mx-auto">
        <Button variant="ghost" onClick={() => { setSelectedDrill(null); setDrillConfig({}); }} className="mb-4 text-muted-foreground">
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

          {(supportsRoundLimit || isTargetGrind) && (
            <div className="mb-5 text-left space-y-4 bg-muted/30 rounded-lg p-4">
              <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
                <Settings2 className="w-3.5 h-3.5" /> Einstellungen
              </div>

              {isTargetGrind && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Zielfeld wählen</p>
                  <div className="flex gap-2">
                    <select
                      className="flex-1 bg-background border border-border rounded-md px-2 py-1.5 text-sm"
                      value={drillConfig.targetMul ?? 3}
                      onChange={(e) => setDrillConfig((c) => ({ ...c, targetMul: Number(e.target.value) }))}
                    >
                      <option value={1}>Single</option>
                      <option value={2}>Double</option>
                      <option value={3}>Triple</option>
                    </select>
                    <select
                      className="flex-1 bg-background border border-border rounded-md px-2 py-1.5 text-sm"
                      value={drillConfig.targetBase ?? 20}
                      onChange={(e) => setDrillConfig((c) => ({ ...c, targetBase: Number(e.target.value) }))}
                    >
                      {[20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 25].map((n) => (
                        <option key={n} value={n}>{n === 25 ? "Bull" : n}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {supportsRoundLimit && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Runden {isTargetGrind ? "" : "(optional – begrenzt endloses Training)"}
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {[5, 10, 15, 20, 30].map((n) => (
                      <button
                        key={n}
                        onClick={() => setDrillConfig((c) => ({ ...c, maxRounds: n }))}
                        className={`px-3 py-1 rounded-md text-xs border transition-colors ${
                          drillConfig.maxRounds === n
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border hover:border-primary/40"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                    {!isTargetGrind && (
                      <button
                        onClick={() => setDrillConfig((c) => ({ ...c, maxRounds: undefined }))}
                        className={`px-3 py-1 rounded-md text-xs border transition-colors ${
                          !drillConfig.maxRounds
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border hover:border-primary/40"
                        }`}
                      >
                        Endlos
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

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
