type SpeechOptions = {
  interrupt?: boolean;
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
};

export interface DartSpeechLike {
  baseValue: number;
  multiplier: 1 | 2 | 3;
  points: number;
}

export function speakText(text: string, options: SpeechOptions = {}) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (!text.trim()) return;

  const synthesis = window.speechSynthesis;
  if (options.interrupt ?? true) synthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = options.lang ?? "de-DE";
  utterance.rate = options.rate ?? 1;
  utterance.pitch = options.pitch ?? 1;
  utterance.volume = options.volume ?? 1;
  synthesis.speak(utterance);
}

export function describeDartForSpeech(dart: DartSpeechLike) {
  if (dart.baseValue === 0) return "Miss";
  if (dart.baseValue === 25) return dart.multiplier === 2 ? "Bullseye" : "Bull 25";
  if (dart.multiplier === 3) return `Dreifach ${dart.baseValue}`;
  if (dart.multiplier === 2) return `Doppelt ${dart.baseValue}`;
  return `${dart.baseValue}`;
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Darts-caller style hype phrases, picked at random so repeat 180s/checkouts don't sound canned. */
const HYPE_180 = [
  "Einhundertachtzig!",
  "One hundred and eighty!",
  "Maximum! Einhundertachtzig!",
  "Was für ein Wurf – Einhundertachtzig!",
  "Da ist er, der Maximum-Wurf! Einhundertachtzig!",
] as const;

const HYPE_TON_PLUS = [
  "Starker Wurf",
  "Klasse Runde",
  "Sauber getroffen",
  "Stark gepunktet",
  "Richtig stark",
] as const;

const HYPE_CHECKOUT = [
  "Und raus! Starker Checkout",
  "Checkout! Sensationell",
  "Das Leg ist durch",
  "Perfekt ausgecheckt",
  "Ins Schwarze getroffen, Leg gewonnen",
] as const;

const HYPE_MATCH_WIN = [
  "gewinnt das Match! Glückwunsch",
  "holt sich den Sieg! Was für eine Leistung",
  "macht den Deckel drauf und gewinnt das Match",
  "krönt sich zum Sieger dieses Matches",
] as const;

const HYPE_BUST = [
  "Autsch, daneben",
  "Das sitzt nicht, Bust",
  "Knapp vorbei, Bust",
] as const;

export interface RoundAnnouncementParams {
  dartText: string;
  roundTotal: number;
  activePlayerName: string;
  nextPlayerName: string;
  remaining?: number;
  isCricket: boolean;
  checkedOut: boolean;
  busted: boolean;
  matchWon: boolean;
  winnerName?: string;
}

/** Builds an enthusiastic, darts-caller-style announcement plus the speech intensity to say it with. */
export function buildRoundAnnouncement(p: RoundAnnouncementParams): { text: string; options: SpeechOptions } {
  if (p.matchWon) {
    return {
      text: `${p.dartText}! ${p.winnerName} ${pickRandom(HYPE_MATCH_WIN)}!`,
      options: { pitch: 1.3, rate: 1.12, volume: 1 },
    };
  }
  if (p.checkedOut) {
    return {
      text: `${p.dartText}. ${pickRandom(HYPE_CHECKOUT)}, ${p.activePlayerName}! ${p.nextPlayerName} startet das nächste Leg.`,
      options: { pitch: 1.22, rate: 1.1, volume: 1 },
    };
  }
  if (p.busted) {
    return {
      text: `${p.dartText}. ${pickRandom(HYPE_BUST)}. ${p.nextPlayerName} ist dran.`,
      options: { pitch: 0.95, rate: 0.98, volume: 0.95 },
    };
  }
  if (p.isCricket) {
    return {
      text: `${p.dartText}. Runde übernommen. ${p.nextPlayerName} ist dran.`,
      options: { pitch: 1, rate: 1, volume: 1 },
    };
  }
  if (p.roundTotal === 180) {
    return {
      text: `${p.dartText}! ${pickRandom(HYPE_180)} ${p.activePlayerName}! Noch ${p.remaining} übrig. ${p.nextPlayerName} ist dran.`,
      options: { pitch: 1.35, rate: 1.15, volume: 1 },
    };
  }
  if (p.roundTotal >= 100) {
    return {
      text: `${p.dartText}. ${pickRandom(HYPE_TON_PLUS)}, ${p.activePlayerName} mit ${p.roundTotal}! Noch ${p.remaining} übrig. ${p.nextPlayerName} ist dran.`,
      options: { pitch: 1.15, rate: 1.08, volume: 1 },
    };
  }
  return {
    text: `${p.dartText}. ${p.activePlayerName} wirft ${p.roundTotal} Punkte. Noch ${p.remaining} übrig. ${p.nextPlayerName} ist dran.`,
    options: { pitch: 1, rate: 1, volume: 1 },
  };
}
