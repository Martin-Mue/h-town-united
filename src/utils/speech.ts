import { isCheckoutPossible } from "@/utils/checkoutTable";

/** "auto" keeps the previous default behavior (biased toward a deeper/male-sounding voice,
 *  since that's what most people expect from a darts caller). "yoda" doesn't pick a different
 *  voice (no browser ships one) — it swaps in inverted-word-order phrasing and a slower,
 *  more deliberate delivery instead, which is what actually carries the character. */
export type CallerVoice = "auto" | "male" | "female" | "yoda";
const CALLER_VOICE_KEY = "dart-caller-voice";

let callerVoice: CallerVoice = "auto";
if (typeof window !== "undefined") {
  const raw = window.localStorage.getItem(CALLER_VOICE_KEY);
  if (raw === "male" || raw === "female" || raw === "yoda") callerVoice = raw;
}

export function getCallerVoice(): CallerVoice {
  return callerVoice;
}

export function setCallerVoice(next: CallerVoice) {
  callerVoice = next;
  if (typeof window !== "undefined") window.localStorage.setItem(CALLER_VOICE_KEY, next);
}

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
  // Common German male/female voice names across Windows/Chrome/Edge TTS engines — nudged
  // above quality-only sorting so the caller persona picker actually changes something
  // audible, not just the text style. "auto"/"yoda" both default to the male bias (was the
  // existing default — a deeper voice reads more like a real caller than the higher-pitched
  // female voices most engines ship as their first option).
  const MALE_NAME_HINTS = ["stefan", "conrad", "ralf", "klaus", "male", "markus", "florian"];
  const FEMALE_NAME_HINTS = ["katja", "hedda", "petra", "anna", "vicki", "marlene", "helena", "female"];
  const wantsMale = callerVoice === "male" || callerVoice === "auto" || callerVoice === "yoda";
  const wantsFemale = callerVoice === "female";
  const byQuality = [...pool].sort((a, b) => {
    const score = (v: SpeechSynthesisVoice) => {
      const name = v.name.toLowerCase();
      let s = 0;
      if (name.includes("natural") || name.includes("online")) s += 3;
      if (name.includes("google")) s += 2;
      if (v.localService === false) s += 1;
      if (wantsMale && MALE_NAME_HINTS.some((hint) => name.includes(hint))) s += 4;
      if (wantsFemale && FEMALE_NAME_HINTS.some((hint) => name.includes(hint))) s += 4;
      return s;
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
  if (dart.multiplier === 3) return `Dreifach ${germanNumberWords(dart.baseValue)}`;
  if (dart.multiplier === 2) return `Doppelt ${germanNumberWords(dart.baseValue)}`;
  return germanNumberWords(dart.baseValue);
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Spelling numbers out as German words instead of handing bare digits to the browser's TTS
// normalizer: different voices/engines are inconsistent about digit-string pronunciation in
// German (reports of e.g. "29" coming out as a garbled ordinal-like "29zigste" instead of
// "neunundzwanzig") — spelling it out ourselves removes that ambiguity entirely, regardless of
// which voice ends up selected. Covers 0-999, more than any darts score/remaining ever needs.
const GERMAN_ONES = [
  "null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn",
  "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn",
] as const;
const GERMAN_TENS = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"] as const;

export function germanNumberWords(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const num = Math.round(n);
  if (num < 0) return `minus ${germanNumberWords(-num)}`;
  if (num < 20) return GERMAN_ONES[num];
  if (num < 100) {
    const tens = Math.floor(num / 10);
    const ones = num % 10;
    if (ones === 0) return GERMAN_TENS[tens];
    return `${ones === 1 ? "ein" : GERMAN_ONES[ones]}und${GERMAN_TENS[tens]}`;
  }
  if (num < 1000) {
    const hundreds = Math.floor(num / 100);
    const rest = num % 100;
    const hundredsWord = hundreds === 1 ? "einhundert" : `${GERMAN_ONES[hundreds]}hundert`;
    return rest === 0 ? hundredsWord : `${hundredsWord}${germanNumberWords(rest)}`;
  }
  return String(num); // not expected for darts scores — safe fallback, not wrong, just unspelled
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
  // A little cross-sport commentary flavor, mixed into the regular pool — generic sport-
  // announcing idioms rather than a specific person's copyrighted catchphrase.
  "Toooor! ...äh, Checkout!",
  "Championship-Punkt — verwandelt!",
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
  "steht als Sieger K.O. in der letzten Runde fest!",
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

// ─── Yoda persona ─────────────────────────────────────────────────────
// Hand-written, not algorithmically reordered — a generic word-order-swap over arbitrary
// German text produces nonsense/wrong-sounding results far too often to trust; these mirror
// the same beats as the default pools above (own each moment: 180, ton+, checkout, bust,
// match win, cricket) but in Yoda's classic object-first inverted phrasing.
const YODA_180 = [
  "Stark getroffen, du hast! Einhundertachtzig, das ist!",
  "Das Maximum, erreicht du hast!",
  "Beeindruckend. Höher, die Punktzahl nicht geht.",
] as const;

const YODA_HIGH_TON = [
  "Gewaltig, diese Runde war!",
  "Stark im Kraft der Dreifachfelder, du bist.",
] as const;

const YODA_TON_PLUS = [
  "Gut getroffen, das war.",
  "Stark, dieser Wurf war.",
  "Sauber, das gesessen hat.",
] as const;

const YODA_CHECKOUT = [
  "Ausgecheckt, du hast!",
  "Das Leg, gewonnen du hast!",
  "Geschlossen, die Tür ist.",
  "Präzise, dieser letzte Wurf war.",
] as const;

const YODA_CHECKOUT_NAMED = (name: string) => [
  `Das Leg, ${name} sich geholt hat!`,
  `Sauber abgeschlossen, ${name} hat!`,
] as const;

const YODA_MATCH_WIN = [
  "gewonnen hat! Stolz auf dich, bin ich.",
  "den Sieg sich geholt hat! Stark, du warst.",
  "die Partie beendet hat! Gut gespielt, du hast.",
] as const;

const YODA_BUST = [
  "Daneben, das ging. Nicht verzagen, du darfst.",
  "Kein Glück, heute du hast. Am dran, nächster ist.",
  "Bust, das war. Üben, du musst.",
] as const;

const YODA_CRICKET_CLOSE = [
  "Geschlossen, die ist!",
  "Zu, diese Zahl nun ist.",
] as const;

const YODA_OPTIONS: SpeechOptions = { pitch: 0.55, rate: 0.78, volume: 1 };
const YODA_NORMAL_OPTIONS: SpeechOptions = { pitch: 0.5, rate: 0.82, volume: 1 };
const yodaNextTurn = (name: string) => `${name}, dran nun ist.`;

// Pitch baseline lowered across the board (was 0.92-1.55) — the old range read as too high/
// shrill on most default TTS voices. Relative contrast between hype/calm tiers is kept so
// big moments still stand out, just from a deeper overall register.
const HYPE_OPTIONS: SpeechOptions = { pitch: 1.25, rate: 1.22, volume: 1 };
const HIGH_TON_OPTIONS: SpeechOptions = { pitch: 1.12, rate: 1.18, volume: 1 };
const TON_OPTIONS: SpeechOptions = { pitch: 1.02, rate: 1.14, volume: 1 };
const CALM_OPTIONS: SpeechOptions = { pitch: 0.72, rate: 0.96, volume: 0.92 };
const NORMAL_OPTIONS: SpeechOptions = { pitch: 0.8, rate: 1.03, volume: 1 };

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
  const yoda = getCallerVoice() === "yoda";

  if (p.matchWon) {
    return yoda
      ? { parts: [{ text: `${p.winnerName} ${pickRandom(YODA_MATCH_WIN)}`, options: YODA_OPTIONS }] }
      : {
          parts: [
            { text: pickRandom(HYPE_CHECKOUT), options: HYPE_OPTIONS },
            { text: `${p.winnerName} ${pickRandom(HYPE_MATCH_WIN)} Herzlichen Glückwunsch!`, options: { ...HYPE_OPTIONS, rate: 1.1 } },
          ],
        };
  }
  if (p.checkedOut) {
    if (yoda) {
      const hype = Math.random() < 0.35 ? pickRandom(YODA_CHECKOUT_NAMED(p.activePlayerName)) : pickRandom(YODA_CHECKOUT);
      return {
        parts: [
          { text: hype, options: YODA_OPTIONS },
          { text: `${p.nextPlayerName}, das nächste Leg beginnt.`, options: YODA_NORMAL_OPTIONS },
        ],
      };
    }
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
    return yoda
      ? { parts: [{ text: `${pickRandom(YODA_BUST)} ${yodaNextTurn(p.nextPlayerName)}`, options: YODA_OPTIONS }] }
      : { parts: [{ text: `${pickRandom(HYPE_BUST)} ${p.nextPlayerName} ist dran.`, options: CALM_OPTIONS }] };
  }
  if (p.isCricket) {
    if (p.cricketClosedLabel) {
      return yoda
        ? {
            parts: [
              { text: `${pickRandom(YODA_CRICKET_CLOSE)} Die ${p.cricketClosedLabel}!`, options: YODA_OPTIONS },
              { text: yodaNextTurn(p.nextPlayerName), options: YODA_NORMAL_OPTIONS },
            ],
          }
        : {
            parts: [
              { text: `${pickRandom(HYPE_CRICKET_CLOSE)} Die ${p.cricketClosedLabel}!`, options: HYPE_OPTIONS },
              { text: `${p.nextPlayerName} ist dran.`, options: NORMAL_OPTIONS },
            ],
          };
    }
    return yoda
      ? { parts: [{ text: yodaNextTurn(p.nextPlayerName), options: YODA_NORMAL_OPTIONS }] }
      : { parts: [{ text: `${p.nextPlayerName} ist dran.`, options: NORMAL_OPTIONS }] };
  }
  let parts: SpeechPart[];
  if (yoda) {
    if (p.roundTotal === 180) {
      parts = [{ text: pickRandom(YODA_180), options: YODA_OPTIONS }];
    } else if (p.roundTotal >= 140) {
      parts = [{ text: `${germanNumberWords(p.roundTotal)}! ${pickRandom(YODA_HIGH_TON)}`, options: YODA_OPTIONS }];
    } else if (p.roundTotal >= 100) {
      parts = [{ text: `${germanNumberWords(p.roundTotal)}! ${pickRandom(YODA_TON_PLUS)}`, options: YODA_OPTIONS }];
    } else {
      parts = [{ text: germanNumberWords(p.roundTotal), options: YODA_NORMAL_OPTIONS }];
    }
    if (p.remaining !== undefined && isCheckoutPossible(p.remaining)) {
      parts = [...parts, { text: yodaCheckoutRemainingAnnouncement(p.remaining, p.activePlayerName), options: YODA_NORMAL_OPTIONS }];
    }
    return { parts };
  }
  if (p.roundTotal === 180) {
    parts = [{ text: pickRandom(HYPE_180), options: HYPE_OPTIONS }];
  } else if (p.roundTotal >= 140) {
    parts = [
      { text: `${germanNumberWords(p.roundTotal)}!`, options: HIGH_TON_OPTIONS },
      { text: pickRandom(HYPE_HIGH_TON), options: HIGH_TON_OPTIONS },
    ];
  } else if (p.roundTotal >= 100) {
    parts = [
      { text: `${germanNumberWords(p.roundTotal)}!`, options: TON_OPTIONS },
      { text: pickRandom(HYPE_TON_PLUS), options: TON_OPTIONS },
    ];
  } else {
    parts = [{ text: germanNumberWords(p.roundTotal), options: NORMAL_OPTIONS }];
  }
  // The player just crossed into checkout range (or is still in it) — tell them their target,
  // same as a real caller would ("Player needs 96"). Never fires on the checkout round itself
  // (that's the p.checkedOut branch above, which already returns).
  if (p.remaining !== undefined && isCheckoutPossible(p.remaining)) {
    parts = [...parts, { text: checkoutRemainingAnnouncement(p.remaining, p.activePlayerName), options: NORMAL_OPTIONS }];
  }
  return { parts };
}

/** A handful of well-known darts checkout nicknames — deliberately small (only ones that are
 *  widely and reliably recognized in the sport) rather than guessing at slang. Extend freely. */
const CHECKOUT_NICKNAMES: Record<number, string> = {
  170: "Big Fish",
};

function checkoutRemainingAnnouncement(remaining: number, playerName: string): string {
  const nickname = CHECKOUT_NICKNAMES[remaining];
  const words = germanNumberWords(remaining);
  return nickname
    ? `${playerName} braucht noch ${words} — ${nickname}!`
    : `${playerName} braucht noch ${words}`;
}

function yodaCheckoutRemainingAnnouncement(remaining: number, playerName: string): string {
  const nickname = CHECKOUT_NICKNAMES[remaining];
  const words = germanNumberWords(remaining);
  return nickname
    ? `${words}, ${playerName} noch braucht — der ${nickname}, das ist!`
    : `${words}, ${playerName} noch braucht.`;
}
