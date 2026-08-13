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

// The default OS/browser TTS voice (e.g. Windows "Microsoft Hedda/Katja") reads flat and
// mechanical no matter what pitch/rate you throw at it. Browsers that ship a cloud/neural
// voice (Chrome's "Google Deutsch", Edge's "Online (Natural)" voices) sound dramatically
// more human — so actively prefer one of those over whatever the platform default is.
let voiceCache: SpeechSynthesisVoice[] | null = null;

function refreshVoiceCache() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) voiceCache = voices;
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  refreshVoiceCache();
  window.speechSynthesis.addEventListener?.("voiceschanged", refreshVoiceCache);
}

function pickGermanVoice(): SpeechSynthesisVoice | undefined {
  refreshVoiceCache();
  const voices = voiceCache;
  if (!voices || voices.length === 0) return undefined;
  const german = voices.filter((v) => v.lang?.toLowerCase().startsWith("de"));
  const pool = german.length > 0 ? german : voices;
  const byQuality = [...pool].sort((a, b) => {
    const score = (v: SpeechSynthesisVoice) => {
      const name = v.name.toLowerCase();
      if (name.includes("natural") || name.includes("online")) return 3;
      if (name.includes("google")) return 2;
      if (v.localService === false) return 1;
      return 0;
    };
    return score(b) - score(a);
  });
  return byQuality[0];
}

/** Nudges a value randomly within ±spread — real callers never hit the exact same pitch/rate
 *  twice, and that tiny per-call variation reads as "alive" far more than a fixed tone would. */
function jitter(base: number, spread: number) {
  return base + (Math.random() * 2 - 1) * spread;
}

export function speakText(text: string, options: SpeechOptions = {}) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (!text.trim()) return;

  const synthesis = window.speechSynthesis;
  if (options.interrupt ?? true) synthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = options.lang ?? "de-DE";
  utterance.rate = jitter(options.rate ?? 1, 0.035);
  utterance.pitch = jitter(options.pitch ?? 1, 0.045);
  utterance.volume = options.volume ?? 1;
  const voice = pickGermanVoice();
  if (voice) utterance.voice = voice;
  synthesis.speak(utterance);
}

export interface SpeechPart {
  text: string;
  options?: SpeechOptions;
}

/**
 * Speaks several utterances back-to-back, each with its own pitch/rate/volume — this is
 * what actually reads as "dynamic delivery" instead of one flat sentence at a single pitch.
 * Only the first part clears any currently-queued speech; the rest just play in order.
 */
export function speakSequence(parts: SpeechPart[], lang = "de-DE") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const synthesis = window.speechSynthesis;
  const voice = pickGermanVoice();
  parts.forEach((part, i) => {
    if (!part.text.trim()) return;
    if (i === 0) synthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(part.text);
    utterance.lang = part.options?.lang ?? lang;
    utterance.rate = jitter(part.options?.rate ?? 1, 0.035);
    utterance.pitch = jitter(part.options?.pitch ?? 1, 0.045);
    utterance.volume = part.options?.volume ?? 1;
    if (voice) utterance.voice = voice;
    synthesis.speak(utterance);
  });
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

// Two-tier delivery for big moments: a short, punchy exclamation shouted at high
// pitch/rate/volume, followed by a calmer detail sentence — real announcers vary their
// delivery within a single call, and that contrast reads as "alive" far more than
// nudging one flat sentence's pitch by a few tenths ever could.
const HYPE_180 = [
  "Einhundertachtzig!",
  "One hundred and eighty!",
  "Maximum!",
  "Was für ein Wurf!",
  "Da ist er! Der Maximum-Wurf!",
  "Unfassbar — Maximum!",
  "Wahnsinn! Einhundertachtzig!",
  "Volle Kanne — Maximum!",
] as const;

const HYPE_HIGH_TON = [
  "Riesig!",
  "Was für eine Runde!",
  "Da geht die Post ab!",
  "Fast das Maximum!",
  "Stark, richtig stark!",
] as const;

const HYPE_TON_PLUS = [
  "Starker Wurf!",
  "Klasse Runde!",
  "Sauber getroffen!",
  "Stark gepunktet!",
  "Richtig stark!",
  "Sehr ordentlich!",
  "Das sitzt!",
  "Gut gepunktet!",
] as const;

const HYPE_CHECKOUT = [
  "Und raus!",
  "Checkout!",
  "Das Leg ist durch!",
  "Perfekt ausgecheckt!",
  "Ins Schwarze getroffen!",
  "Sauber ausgecheckt!",
  "Da ist die Tür zu!",
  "Punktgenau!",
] as const;

/** Occasionally names the player directly on the checkout hype line for variety — a real caller doesn't say the same generic phrase every single leg. */
const HYPE_CHECKOUT_NAMED = (name: string) => [
  `${name} macht das Leg klar!`,
  `Da ist er, der Checkout von ${name}!`,
  `${name} schließt sauber ab!`,
] as const;

const HYPE_MATCH_WIN = [
  "gewinnt das Match!",
  "holt sich den Sieg!",
  "macht den Deckel drauf!",
  "krönt sich zum Sieger!",
  "sichert sich den Sieg!",
  "beendet die Partie!",
] as const;

const HYPE_BUST = [
  "Autsch, daneben.",
  "Das sitzt nicht — Bust.",
  "Knapp vorbei — Bust.",
  "Das war nichts — Bust.",
  "Schade, Bust.",
] as const;

/** Cricket: hit the 3rd (or more) mark on a number this visit — closes it if no one else still has it open. */
const HYPE_CRICKET_CLOSE = [
  "Zu!",
  "Geschlossen!",
  "Dicht gemacht!",
  "Da ist sie zu!",
] as const;

const HYPE_OPTIONS: SpeechOptions = { pitch: 1.55, rate: 1.22, volume: 1 };
const HIGH_TON_OPTIONS: SpeechOptions = { pitch: 1.4, rate: 1.18, volume: 1 };
const TON_OPTIONS: SpeechOptions = { pitch: 1.28, rate: 1.14, volume: 1 };
const CALM_OPTIONS: SpeechOptions = { pitch: 0.92, rate: 0.96, volume: 0.92 };
const NORMAL_OPTIONS: SpeechOptions = { pitch: 1.02, rate: 1.03, volume: 1 };

export interface RoundAnnouncementParams {
  roundTotal: number;
  activePlayerName: string;
  nextPlayerName: string;
  remaining?: number;
  isCricket: boolean;
  checkedOut: boolean;
  busted: boolean;
  matchWon: boolean;
  winnerName?: string;
  /** Cricket only: label ("20", "Bull", …) of a number this dart just closed (3rd+ mark this visit). */
  cricketClosedLabel?: string;
}

/**
 * Builds a terse, darts-caller-style announcement — just the round total (spoken the way a
 * real caller shouts a score, not a play-by-play of which segments were hit) plus whatever
 * state actually changed (checkout, bust, match win).
 */
export function buildRoundAnnouncement(p: RoundAnnouncementParams): { parts: SpeechPart[] } {
  if (p.matchWon) {
    return {
      parts: [
        { text: pickRandom(HYPE_CHECKOUT), options: HYPE_OPTIONS },
        { text: `${p.winnerName} ${pickRandom(HYPE_MATCH_WIN)} Herzlichen Glückwunsch!`, options: { ...HYPE_OPTIONS, rate: 1.1 } },
      ],
    };
  }
  if (p.checkedOut) {
    // ~1 in 3 checkouts get the player named directly in the hype line instead of the generic pool.
    const hype = Math.random() < 0.35 ? pickRandom(HYPE_CHECKOUT_NAMED(p.activePlayerName)) : pickRandom(HYPE_CHECKOUT);
    return {
      parts: [
        { text: hype, options: HYPE_OPTIONS },
        { text: `Leg an ${p.activePlayerName}! ${p.nextPlayerName} startet das nächste Leg.`, options: NORMAL_OPTIONS },
      ],
    };
  }
  if (p.busted) {
    return {
      parts: [{ text: `${pickRandom(HYPE_BUST)} ${p.nextPlayerName} ist dran.`, options: CALM_OPTIONS }],
    };
  }
  if (p.isCricket) {
    if (p.cricketClosedLabel) {
      return {
        parts: [
          { text: `${pickRandom(HYPE_CRICKET_CLOSE)} Die ${p.cricketClosedLabel}!`, options: HYPE_OPTIONS },
          { text: `${p.nextPlayerName} ist dran.`, options: NORMAL_OPTIONS },
        ],
      };
    }
    return {
      parts: [{ text: `${p.nextPlayerName} ist dran.`, options: NORMAL_OPTIONS }],
    };
  }
  if (p.roundTotal === 180) {
    return { parts: [{ text: pickRandom(HYPE_180), options: HYPE_OPTIONS }] };
  }
  if (p.roundTotal >= 140) {
    return {
      parts: [
        { text: `${p.roundTotal}!`, options: HIGH_TON_OPTIONS },
        { text: pickRandom(HYPE_HIGH_TON), options: HIGH_TON_OPTIONS },
      ],
    };
  }
  if (p.roundTotal >= 100) {
    return {
      parts: [
        { text: `${p.roundTotal}!`, options: TON_OPTIONS },
        { text: pickRandom(HYPE_TON_PLUS), options: TON_OPTIONS },
      ],
    };
  }
  return { parts: [{ text: `${p.roundTotal}.`, options: NORMAL_OPTIONS }] };
}
