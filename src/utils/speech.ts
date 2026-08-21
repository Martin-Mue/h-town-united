import { isCheckoutPossible } from "@/utils/checkoutTable";

/** "off" mutes the caller entirely — replaces the old separate speech-on/off Switch, which is
 *  now just this one picker's 4th option instead of a second control next to it. The character
 *  personas (just "yoda" now) don't pick a different browser voice (no browser ships a "yoda"
 *  voice) — they swap in distinctive phrasing + delivery instead, which is what actually
 *  carries the character. */
export type CallerVoice = "off" | "male" | "female" | "yoda";
const CALLER_VOICE_KEY = "dart-caller-voice";
/** The old, now-removed separate on/off Switch's localStorage key — read once below purely to
 *  migrate a device that had explicitly muted speech into the new unified picker's "off". */
const LEGACY_SPEECH_ENABLED_KEY = "dart-speech-enabled";

let callerVoice: CallerVoice = "male";
// "auto"/"pirate"/"robot"/"herald"/"kernasi"/"reporter"/"genz" removed (Aug 2026) — kept out of
// this list on purpose so a device that still has one saved in localStorage falls through to
// the default below instead of crashing.
const VALID_CALLER_VOICES: readonly CallerVoice[] = ["off", "male", "female", "yoda"];
if (typeof window !== "undefined") {
  const raw = window.localStorage.getItem(CALLER_VOICE_KEY);
  if ((VALID_CALLER_VOICES as readonly string[]).includes(raw ?? "")) {
    callerVoice = raw as CallerVoice;
  } else if (window.localStorage.getItem(LEGACY_SPEECH_ENABLED_KEY) === "false") {
    callerVoice = "off";
  }
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
  // audible, not just the text style. "yoda" also defaults to the male bias (a deeper voice
  // reads more like a real caller than the higher-pitched female voices most engines ship as
  // their first option) — only an explicit "female" pick asks for the female-leaning voice.
  const MALE_NAME_HINTS = ["stefan", "conrad", "ralf", "klaus", "male", "markus", "florian"];
  const FEMALE_NAME_HINTS = ["katja", "hedda", "petra", "anna", "vicki", "marlene", "helena", "female"];
  const wantsFemale = callerVoice === "female";
  const wantsMale = !wantsFemale;
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
// How many whole announcements are allowed to sit queued up behind whatever's currently
// speaking. The Web Speech API queues by default (speak() while something is already speaking
// just appends, it doesn't interrupt) — speakSequence used to defeat that on every single call
// by cancel()-ing unconditionally, which is what cut announcements off mid-sentence the moment a
// second one fired shortly after (reported 2026-08-18: bot turns following right behind a human
// round). Letting the natural queue do its job fixes that; this cap only exists so a fast burst
// of rounds (several bot turns in a row) can't leave the caller narrating further and further
// behind live play — once too much has piled up, jump the queue instead of drifting later and
// later out of sync.
const MAX_QUEUED_SEQUENCES = 1;
let pendingSequenceCount = 0;

export function speakSequence(parts: SpeechPart[], lang = "de-DE") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const synthesis = window.speechSynthesis;
  const nonEmptyParts = parts.filter((part) => part.text.trim());
  if (nonEmptyParts.length === 0) return;

  if (pendingSequenceCount > MAX_QUEUED_SEQUENCES) {
    synthesis.cancel();
    pendingSequenceCount = 0;
  }

  const voice = pickGermanVoice();
  pendingSequenceCount += 1;
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    pendingSequenceCount = Math.max(0, pendingSequenceCount - 1);
  };
  nonEmptyParts.forEach((part, i) => {
    const utterance = new SpeechSynthesisUtterance(part.text);
    utterance.lang = part.options?.lang ?? lang;
    utterance.rate = jitter(part.options?.rate ?? 1, 0.035);
    utterance.pitch = jitter(part.options?.pitch ?? 1, 0.045);
    utterance.volume = part.options?.volume ?? 1;
    if (voice) utterance.voice = voice;
    // Only the LAST utterance's end/error settles the count — an earlier part ending just means
    // the sequence moved on to its next line, not that the whole announcement is done.
    if (i === nonEmptyParts.length - 1) {
      utterance.onend = settle;
      utterance.onerror = settle;
    }
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

// Remembers the last line spoken per announcement "slot" (180, checkout, bust, plain round,
// …) so the very next pick for that same slot never repeats it verbatim — the actual fix for
// "I keep hearing the same line back to back". Keyed by a short category name shared across
// every persona (a Yoda line and a Herald line never collide as strings, so this stays correct
// even though the category key doesn't encode which persona is currently selected).
const lastPicks = new Map<string, string>();
function pickRandomNoRepeat<T extends string>(arr: readonly T[], category: string): T {
  if (arr.length <= 1) return arr[0];
  const last = lastPicks.get(category);
  const pool = last === undefined ? arr : arr.filter((v) => v !== last);
  const choice = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : arr[Math.floor(Math.random() * arr.length)];
  lastPicks.set(category, choice);
  return choice;
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

// A weak (but not bust) round previously got zero commentary — just the bare number, unlike
// every other outcome. The "kritische Sätze" requested for the common case of a merely-mediocre
// round, not just full busts.
const HYPE_LOW_SCORE = [
  "Das ging auch schon besser.",
  "Heute nicht der beste Wurfarm.",
  "Da war noch Luft nach oben.",
  "Schwacher Start in die Runde.",
  "Das war eher bescheiden.",
  "Na, das war wohl nicht der Plan.",
] as const;

/** Cricket: hit the 3rd (or more) mark on a number this visit — closes it if no one else still has it open. */
const HYPE_CRICKET_CLOSE = [
  "Zu!",
  "Geschlossen!",
  "Dicht gemacht!",
  "Da ist sie zu!",
] as const;

// ─── Character personas ──────────────────────────────────────────────
// Hand-written per persona, not algorithmically transformed — a generic rule (reorder words,
// substitute vocabulary) over arbitrary German text produces nonsense/wrong-sounding results
// far too often to trust. Each pack owns every beat the default pool does (180, high-ton,
// ton-plus, checkout, checkout-named, match win, bust, cricket-close, next-turn, plain round,
// checkout-remaining) so buildRoundAnnouncement can dispatch through one shared path below
// instead of a bespoke branch per character. Fictional archetypes only (a wizened mentor, a
// medieval herald, a cocky hype-man, a breathless radio reporter, an over-the-top Gen-Z
// announcer) — recognizable by their manner of speech, not modeled on any specific real person.
interface PersonaPack {
  options: SpeechOptions;
  hypeOptions: SpeechOptions;
  hype180: readonly string[];
  hypeHighTon: readonly string[];
  hypeTonPlus: readonly string[];
  /** A weak (but not bust) round — the "kritische Sätze" the caller was missing for the common
   *  case of a merely-mediocre round, which previously got zero commentary (just the bare
   *  number), unlike every other outcome (180/high/ton/checkout/bust all already had color). */
  hypeLowScore: readonly string[];
  hypeCheckout: readonly string[];
  hypeCheckoutNamed: (name: string) => readonly string[];
  hypeMatchWin: (winnerName: string) => readonly string[];
  hypeBust: readonly string[];
  hypeCricketClose: readonly string[];
  nextTurn: (name: string) => string;
  plainRound: (total: number) => string;
  checkoutRemaining: (remaining: number, name: string, nickname?: string) => string;
  legWonNextLeg: (winner: string, next: string) => string;
}

const YODA_PACK: PersonaPack = {
  options: { pitch: 0.5, rate: 0.82, volume: 1 },
  hypeOptions: { pitch: 0.55, rate: 0.78, volume: 1 },
  // No "Mmmh"/"Hmmm" interjections — not real German words, so some TTS voices spell them out
  // letter by letter instead of reading them as a sound. Real words only, however short.
  hype180: [
    "Stark getroffen, du hast! Einhundertachtzig, das ist!",
    "Das Maximum, erreicht du hast!",
    "Beeindruckend. Höher, die Punktzahl nicht geht.",
    "Die Kraft der Dreifachfelder, stark in dir ist.",
    "Perfekt, dieser Wurf war. Viel zu lernen, du hast nicht mehr.",
    "Versuchen? Nein. Getroffen, du hast!",
    "Meister dieses Wurfes, du bist.",
    "Die Macht, stark mit dir heute ist.",
    "Größer als dieser Wurf, nichts ist.",
  ],
  hypeHighTon: [
    "Gewaltig, diese Runde war!",
    "Stark im Kraft der Dreifachfelder, du bist.",
    "Groß ist die Kraft deines Wurfarms, spüre ich.",
    "Beeindruckt, ich bin.",
    "Große Fortschritte, du machst.",
  ],
  hypeTonPlus: [
    "Gut getroffen, das war.",
    "Stark, dieser Wurf war.",
    "Sauber, das gesessen hat.",
    "Fortschritte, du machst.",
    "Solide, dieser Wurf war.",
    "Zufrieden, ich bin.",
  ],
  hypeLowScore: [
    "Schwach, dieser Wurf war.",
    "Enttäuscht, ich bin — ein wenig.",
    "Mehr Übung, du brauchst.",
    "Nicht der Weg des Meisters, das war.",
    "Verloren, deine Konzentration war.",
  ],
  hypeCheckout: [
    "Ausgecheckt, du hast!",
    "Das Leg, gewonnen du hast!",
    "Geschlossen, die Tür ist.",
    "Präzise, dieser letzte Wurf war.",
    "Der dunklen Seite des Bustens, widerstanden du hast!",
    "Fürchte den Rest nicht, du musstest — gemeistert, du ihn hast.",
    "Der Weg zum Sieg, gefunden du hast!",
    "Wie ein Meister, ausgecheckt du hast!",
  ],
  hypeCheckoutNamed: (name) => [
    `Das Leg, ${name} sich geholt hat!`,
    `Sauber abgeschlossen, ${name} hat!`,
    `Stolz auf ${name}, in diesem Moment ich bin!`,
    `Die Weisheit des Meisters, ${name} gezeigt hat!`,
  ],
  hypeMatchWin: (name) => [
    `${name} gewonnen hat! Stolz auf dich, bin ich.`,
    `${name} den Sieg sich geholt hat! Stark, du warst.`,
    `${name} die Partie beendet hat! Gut gespielt, du hast.`,
    `Ein Meister der Darts, ${name} nun ist!`,
    `Belohnt, deine Geduld nun wird, ${name}!`,
  ],
  hypeBust: [
    "Daneben, das ging. Nicht verzagen, du darfst.",
    "Kein Glück, heute du hast. Am dran, nächster ist.",
    "Bust, das war. Üben, du musst.",
    "Fehler, das war — doch daraus lernen, du wirst.",
    "Ungeduldig, du warst. Ruhe finden, du musst.",
    "Zu weit gezielt, du hast.",
  ],
  hypeCricketClose: [
    "Geschlossen, die ist!",
    "Zu, diese Zahl nun ist.",
    "Verschlossen, wie ein Tempel, sie ist.",
    "Ein Feld weniger, zu erobern es gibt.",
  ],
  nextTurn: (name) => pickRandomNoRepeat([
    `${name}, dran nun ist.`,
    `Am Zug, ${name} jetzt ist.`,
    `Bereit machen, ${name} muss.`,
    `Die Macht, ${name} nun einsetzen muss.`,
    `Bereit für dich, das Spielfeld ist, ${name}.`,
  ], "nextTurn"),
  plainRound: (total) => pickRandomNoRepeat([
    germanNumberWords(total),
    `${germanNumberWords(total)}. Genügend, das ist.`,
    `${germanNumberWords(total)}, geworfen du hast.`,
    `Nicht schlecht, ${germanNumberWords(total)}.`,
    `${germanNumberWords(total)}. Weitermachen, du musst.`,
  ], "plainRound"),
  checkoutRemaining: (remaining, name, nickname) => {
    const words = germanNumberWords(remaining);
    return nickname
      ? `${words}, ${name} noch braucht — der ${nickname}, das ist!`
      : pickRandomNoRepeat([`${words}, ${name} noch braucht.`, `Übrig, ${words} für ${name} sind.`, `${words} zum Sieg, ${name} noch braucht.`], "checkoutRemaining");
  },
  legWonNextLeg: (winner, next) => pickRandomNoRepeat([
    `Das Leg, ${winner} gewonnen hat! ${next}, das nächste beginnt.`,
    `Gewonnen, das Leg von ${winner} ist! Bereit, ${next} nun sein muss.`,
  ], "legWonNextLeg"),
};

const PERSONA_PACKS: Partial<Record<CallerVoice, PersonaPack>> = {
  yoda: YODA_PACK,
};

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
  const pack = PERSONA_PACKS[getCallerVoice()];
  const nickname = p.remaining !== undefined ? CHECKOUT_NICKNAMES[p.remaining] : undefined;

  if (pack) {
    if (p.matchWon) {
      return { parts: [{ text: pickRandomNoRepeat(pack.hypeMatchWin(p.winnerName ?? ""), "matchWin"), options: pack.hypeOptions }] };
    }
    if (p.checkedOut) {
      const hype = Math.random() < 0.35
        ? pickRandomNoRepeat(pack.hypeCheckoutNamed(p.activePlayerName), "checkoutNamed")
        : pickRandomNoRepeat(pack.hypeCheckout, "checkout");
      return {
        parts: [
          { text: hype, options: pack.hypeOptions },
          { text: pack.legWonNextLeg(p.activePlayerName, p.nextPlayerName), options: pack.options },
        ],
      };
    }
    if (p.busted) {
      return { parts: [{ text: `${pickRandomNoRepeat(pack.hypeBust, "bust")} ${pack.nextTurn(p.nextPlayerName)}`, options: pack.options }] };
    }
    if (p.isCricket) {
      if (p.cricketClosedLabel) {
        return {
          parts: [
            { text: `${pickRandomNoRepeat(pack.hypeCricketClose, "cricketClose")} Die ${p.cricketClosedLabel}!`, options: pack.hypeOptions },
            { text: pack.nextTurn(p.nextPlayerName), options: pack.options },
          ],
        };
      }
      return { parts: [{ text: pack.nextTurn(p.nextPlayerName), options: pack.options }] };
    }
    let parts: SpeechPart[];
    if (p.roundTotal === 180) {
      parts = [{ text: pickRandomNoRepeat(pack.hype180, "180"), options: pack.hypeOptions }];
    } else if (p.roundTotal >= 140) {
      parts = [{ text: `${germanNumberWords(p.roundTotal)}! ${pickRandomNoRepeat(pack.hypeHighTon, "highTon")}`, options: pack.hypeOptions }];
    } else if (p.roundTotal >= 100) {
      parts = [{ text: `${germanNumberWords(p.roundTotal)}! ${pickRandomNoRepeat(pack.hypeTonPlus, "tonPlus")}`, options: pack.hypeOptions }];
    } else if (p.roundTotal < 26) {
      parts = [{ text: `${germanNumberWords(p.roundTotal)}. ${pickRandomNoRepeat(pack.hypeLowScore, "lowScore")}`, options: pack.options }];
    } else {
      parts = [{ text: pack.plainRound(p.roundTotal), options: pack.options }];
    }
    if (p.remaining !== undefined && isCheckoutPossible(p.remaining)) {
      parts = [...parts, { text: pack.checkoutRemaining(p.remaining, p.activePlayerName, nickname), options: pack.options }];
    }
    return { parts };
  }

  // Default (auto/male/female) — same phrasing, only the underlying voice selection differs.
  if (p.matchWon) {
    return {
      parts: [
        { text: pickRandomNoRepeat(HYPE_CHECKOUT, "checkout"), options: HYPE_OPTIONS },
        { text: `${p.winnerName} ${pickRandomNoRepeat(HYPE_MATCH_WIN, "matchWin")} Herzlichen Glückwunsch!`, options: { ...HYPE_OPTIONS, rate: 1.1 } },
      ],
    };
  }
  if (p.checkedOut) {
    // ~1 in 3 checkouts get the player named directly in the hype line instead of the generic pool.
    const hype = Math.random() < 0.35
      ? pickRandomNoRepeat(HYPE_CHECKOUT_NAMED(p.activePlayerName), "checkoutNamed")
      : pickRandomNoRepeat(HYPE_CHECKOUT, "checkout");
    return {
      parts: [
        { text: hype, options: HYPE_OPTIONS },
        { text: `Leg an ${p.activePlayerName}! ${p.nextPlayerName} startet das nächste Leg.`, options: NORMAL_OPTIONS },
      ],
    };
  }
  if (p.busted) {
    return { parts: [{ text: `${pickRandomNoRepeat(HYPE_BUST, "bust")} ${p.nextPlayerName} ist dran.`, options: CALM_OPTIONS }] };
  }
  if (p.isCricket) {
    if (p.cricketClosedLabel) {
      return {
        parts: [
          { text: `${pickRandomNoRepeat(HYPE_CRICKET_CLOSE, "cricketClose")} Die ${p.cricketClosedLabel}!`, options: HYPE_OPTIONS },
          { text: `${p.nextPlayerName} ist dran.`, options: NORMAL_OPTIONS },
        ],
      };
    }
    return { parts: [{ text: `${p.nextPlayerName} ist dran.`, options: NORMAL_OPTIONS }] };
  }
  let parts: SpeechPart[];
  if (p.roundTotal === 180) {
    parts = [{ text: pickRandomNoRepeat(HYPE_180, "180"), options: HYPE_OPTIONS }];
  } else if (p.roundTotal >= 140) {
    parts = [
      { text: `${germanNumberWords(p.roundTotal)}!`, options: HIGH_TON_OPTIONS },
      { text: pickRandomNoRepeat(HYPE_HIGH_TON, "highTon"), options: HIGH_TON_OPTIONS },
    ];
  } else if (p.roundTotal >= 100) {
    parts = [
      { text: `${germanNumberWords(p.roundTotal)}!`, options: TON_OPTIONS },
      { text: pickRandomNoRepeat(HYPE_TON_PLUS, "tonPlus"), options: TON_OPTIONS },
    ];
  } else if (p.roundTotal < 26) {
    parts = [{ text: `${germanNumberWords(p.roundTotal)}. ${pickRandomNoRepeat(HYPE_LOW_SCORE, "lowScore")}`, options: NORMAL_OPTIONS }];
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
