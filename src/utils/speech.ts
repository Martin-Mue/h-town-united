import { isCheckoutPossible } from "@/utils/checkoutTable";

/** "auto" keeps the previous default behavior (biased toward a deeper/male-sounding voice,
 *  since that's what most people expect from a darts caller). The character personas don't
 *  pick a different voice (no browser ships a "pirate" or "robot" voice) — each swaps in its
 *  own distinctive phrasing + delivery instead, which is what actually carries the character. */
export type CallerVoice = "auto" | "male" | "female" | "yoda" | "pirate" | "herald" | "robot" | "kernasi" | "reporter" | "genz";
const CALLER_VOICE_KEY = "dart-caller-voice";

let callerVoice: CallerVoice = "auto";
const VALID_CALLER_VOICES: readonly CallerVoice[] = ["male", "female", "yoda", "pirate", "herald", "robot", "kernasi", "reporter", "genz"];
if (typeof window !== "undefined") {
  const raw = window.localStorage.getItem(CALLER_VOICE_KEY);
  if ((VALID_CALLER_VOICES as readonly string[]).includes(raw ?? "")) callerVoice = raw as CallerVoice;
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

// Remembers the last line spoken per announcement "slot" (180, checkout, bust, plain round,
// …) so the very next pick for that same slot never repeats it verbatim — the actual fix for
// "I keep hearing the same line back to back". Keyed by a short category name shared across
// every persona (a Yoda line and a Pirate line never collide as strings, so this stays correct
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
// pirate captain, a medieval herald, a monotone robot) — recognizable by their manner of
// speech, not modeled on any specific real person.
interface PersonaPack {
  options: SpeechOptions;
  hypeOptions: SpeechOptions;
  hype180: readonly string[];
  hypeHighTon: readonly string[];
  hypeTonPlus: readonly string[];
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
  hype180: [
    "Stark getroffen, du hast! Einhundertachtzig, das ist!",
    "Das Maximum, erreicht du hast!",
    "Beeindruckend. Höher, die Punktzahl nicht geht.",
    "Mmmh. Die Kraft der Dreifachfelder, stark in dir ist.",
    "Perfekt, dieser Wurf war. Viel zu lernen, du hast nicht mehr.",
    "Versuchen? Nein. Getroffen, du hast!",
  ],
  hypeHighTon: [
    "Gewaltig, diese Runde war!",
    "Stark im Kraft der Dreifachfelder, du bist.",
    "Groß ist die Kraft deines Wurfarms, spüre ich.",
  ],
  hypeTonPlus: [
    "Gut getroffen, das war.",
    "Stark, dieser Wurf war.",
    "Sauber, das gesessen hat.",
    "Mmmh. Fortschritte, du machst.",
  ],
  hypeCheckout: [
    "Ausgecheckt, du hast!",
    "Das Leg, gewonnen du hast!",
    "Geschlossen, die Tür ist.",
    "Präzise, dieser letzte Wurf war.",
    "Der dunklen Seite des Bustens, widerstanden du hast!",
    "Fürchte den Rest nicht, du musstest — gemeistert, du ihn hast.",
  ],
  hypeCheckoutNamed: (name) => [
    `Das Leg, ${name} sich geholt hat!`,
    `Sauber abgeschlossen, ${name} hat!`,
    `Stolz auf ${name}, in diesem Moment ich bin!`,
  ],
  hypeMatchWin: (name) => [
    `${name} gewonnen hat! Stolz auf dich, bin ich.`,
    `${name} den Sieg sich geholt hat! Stark, du warst.`,
    `${name} die Partie beendet hat! Gut gespielt, du hast.`,
    `Ein Meister der Darts, ${name} nun ist!`,
  ],
  hypeBust: [
    "Daneben, das ging. Nicht verzagen, du darfst.",
    "Kein Glück, heute du hast. Am dran, nächster ist.",
    "Bust, das war. Üben, du musst.",
    "Fehler, das war — doch daraus lernen, du wirst.",
  ],
  hypeCricketClose: [
    "Geschlossen, die ist!",
    "Zu, diese Zahl nun ist.",
    "Verschlossen, wie ein Jedi-Tempel, sie ist.",
  ],
  nextTurn: (name) => pickRandomNoRepeat([
    `${name}, dran nun ist.`,
    `Am Zug, ${name} jetzt ist.`,
    `Bereit machen, ${name} muss.`,
    `Die Macht, ${name} nun einsetzen muss.`,
  ], "nextTurn"),
  plainRound: (total) => pickRandomNoRepeat([
    germanNumberWords(total),
    `${germanNumberWords(total)}. Genügend, das ist.`,
    `${germanNumberWords(total)}, geworfen wurde.`,
    `Hmmm. ${germanNumberWords(total)}.`,
  ], "plainRound"),
  checkoutRemaining: (remaining, name, nickname) => {
    const words = germanNumberWords(remaining);
    return nickname
      ? `${words}, ${name} noch braucht — der ${nickname}, das ist!`
      : pickRandomNoRepeat([`${words}, ${name} noch braucht.`, `Übrig, ${words} für ${name} sind.`], "checkoutRemaining");
  },
  legWonNextLeg: (winner, next) => `Das Leg, ${winner} gewonnen hat! ${next}, das nächste beginnt.`,
};

const PIRATE_PACK: PersonaPack = {
  options: { pitch: 0.62, rate: 0.98, volume: 1 },
  hypeOptions: { pitch: 0.68, rate: 1.08, volume: 1 },
  hype180: [
    "Arrr, volle Breitseite! Einhundertachtzig!",
    "Ahoy! Das Maximum, geentert!",
    "Klar Schiff! Einhundertachtzig Punkte, Landratte!",
    "Ein Volltreffer wie aus der Kanone, arrr!",
  ],
  hypeHighTon: [
    "Arrr, das sitzt wie ein Kanonenschuss!",
    "Ahoy, ordentlich Fahrt aufgenommen!",
    "Volle Segel voraus, dieser Wurf!",
  ],
  hypeTonPlus: [
    "Arrr, sauber getroffen!",
    "Das nenn ich Seemannskunst!",
    "Klare Kante, Landratte!",
    "Feste Hand am Ruder, arrr!",
  ],
  hypeCheckout: [
    "Klar Schiff — das Leg geentert!",
    "Arrr, ins Ziel gesegelt!",
    "Volltreffer, versenkt!",
    "Die Schatzkiste, geknackt!",
    "Sicher im Hafen, dieses Leg!",
  ],
  hypeCheckoutNamed: (name) => [
    `${name} entert das Leg!`,
    `Käpt'n ${name} bringt das Schiff sicher in den Hafen!`,
    `Arrr, ${name} hisst die Leg-Flagge!`,
  ],
  hypeMatchWin: (name) => [
    `${name} hisst die Siegesflagge! Arrr!`,
    `${name} holt sich den ganzen Schatz!`,
    `Ahoy, ${name} gewinnt die Schlacht!`,
    `Käpt'n ${name}, Herrscher der sieben Dartsmeere!`,
  ],
  hypeBust: [
    "Arrr, Klippen voraus — daneben!",
    "Das war Landgang, keine Meisterleistung.",
    "Schiffbruch, diese Runde.",
    "Kentert, dieser Wurf ist.",
  ],
  hypeCricketClose: [
    "Arrr, dicht wie ein Schiffsrumpf!",
    "Klar zu — die Luke ist zu!",
  ],
  nextTurn: (name) => pickRandomNoRepeat([
    `Ahoy, ${name} übernimmt das Ruder.`,
    `${name} ist am Ruder, Landratte.`,
    `Klar zum Wurf, ${name}!`,
    `${name}, entere die Planke!`,
  ], "nextTurn"),
  plainRound: (total) => pickRandomNoRepeat([
    `${germanNumberWords(total)}, Landratte.`,
    `${germanNumberWords(total)} Punkte im Frachtraum.`,
    `Arrr, ${germanNumberWords(total)}.`,
    `${germanNumberWords(total)}, verstaut im Laderaum.`,
  ], "plainRound"),
  checkoutRemaining: (remaining, name, nickname) => {
    const words = germanNumberWords(remaining);
    return nickname
      ? `${name} braucht noch ${words} — der ${nickname}, Ahoy!`
      : pickRandomNoRepeat([`${name} braucht noch ${words}, um den Hafen zu erreichen.`, `Noch ${words} bis zur Landung, ${name}.`], "checkoutRemaining");
  },
  legWonNextLeg: (winner, next) => `Leg geentert von ${winner}! ${next} sticht als Nächstes in See.`,
};

const HERALD_PACK: PersonaPack = {
  options: { pitch: 0.85, rate: 0.85, volume: 1 },
  hypeOptions: { pitch: 0.92, rate: 0.9, volume: 1 },
  hype180: [
    "Höret, höret! Das Maximum ist vollbracht!",
    "Fürwahr, ein Wurf für die Geschichtsbücher!",
    "Einhundertachtzig! Ruhm und Ehre diesem Recken!",
    "Man höre und staune — die Höchstzahl ist gefallen!",
  ],
  hypeHighTon: [
    "Wohlan, eine gewaltige Runde!",
    "Fürwahr stark getroffen!",
    "Eine Runde von großer Wucht, in der Tat!",
  ],
  hypeTonPlus: [
    "Wacker getroffen, edler Recke!",
    "Ein Treffer von großer Güte!",
    "Fürwahr, das sitzt!",
    "Wohlgezielt, dieser Wurf!",
  ],
  hypeCheckout: [
    "Das Leg ist vollbracht!",
    "Höret, höret — der Sieg dieser Runde!",
    "Fürwahr, ein Treffer von großer Präzision!",
    "Das Tor zum Sieg, weit geöffnet!",
  ],
  hypeCheckoutNamed: (name) => [
    `${name} vollbringt das Leg mit Bravour!`,
    `Preiset ${name}, den Meister dieser Runde!`,
  ],
  hypeMatchWin: (name) => [
    `Höret, höret! ${name} trägt den Sieg davon!`,
    `${name}, wackerer Champion dieser Partie!`,
    `Ruhm und Ehre gebühren ${name}!`,
  ],
  hypeBust: [
    "Ein Fehltritt, fürwahr.",
    "Das Glück, es war dem Recken heut nicht hold.",
    "Verfehlt, doch die nächste Runde winkt.",
  ],
  hypeCricketClose: [
    "Verschlossen, wie ein Burgtor!",
    "Fürwahr, geschlossen!",
  ],
  nextTurn: (name) => pickRandomNoRepeat([
    `Wohlan, ${name} ist nun am Zuge.`,
    `Man höre: ${name} ist an der Reihe.`,
    `${name}, tritt vor und wirf!`,
    `Nun trete vor, ${name}!`,
  ], "nextTurn"),
  plainRound: (total) => pickRandomNoRepeat([
    `${germanNumberWords(total)} Punkte, wohlan.`,
    `Fürwahr, ${germanNumberWords(total)} Punkte.`,
    `${germanNumberWords(total)}, so steht es geschrieben.`,
    `Vermerkt: ${germanNumberWords(total)} Punkte.`,
  ], "plainRound"),
  checkoutRemaining: (remaining, name, nickname) => {
    const words = germanNumberWords(remaining);
    return nickname
      ? `${name} bedarf noch ${words} — dem ${nickname}!`
      : pickRandomNoRepeat([`${name} bedarf noch ${words} zum Siege.`, `Noch ${words} trennen ${name} vom Ruhme.`], "checkoutRemaining");
  },
  legWonNextLeg: (winner, next) => `Das Leg, an ${winner} vergeben! ${next} eröffnet die nächste Runde.`,
};

const ROBOT_PACK: PersonaPack = {
  options: { pitch: 0.75, rate: 0.92, volume: 1 },
  hypeOptions: { pitch: 0.8, rate: 1, volume: 1 },
  hype180: [
    "Analyse abgeschlossen. Maximalwert erreicht. Einhundertachtzig.",
    "Systemmeldung: Perfekter Wurf registriert.",
    "Höchstwert bestätigt. Effizienz: einhundert Prozent.",
  ],
  hypeHighTon: [
    "Hohe Punktzahl registriert.",
    "Effizienz: optimal.",
    "Datensatz aktualisiert. Wurfqualität: sehr hoch.",
  ],
  hypeTonPlus: [
    "Treffer bestätigt.",
    "Wurfqualität: hoch.",
    "Daten gespeichert. Guter Wurf.",
  ],
  hypeCheckout: [
    "Checkout bestätigt.",
    "Leg abgeschlossen. Berechnung erfolgreich.",
    "Zielerreichung: einhundert Prozent.",
    "Prozess abgeschlossen. Leg gewonnen.",
  ],
  hypeCheckoutNamed: (name) => [
    `Sieger dieser Runde: ${name}.`,
    `${name}. Checkout erfolgreich verarbeitet.`,
  ],
  hypeMatchWin: (name) => [
    `Endergebnis berechnet. Sieger: ${name}.`,
    `Match beendet. Gewinner: ${name}.`,
    `Analyse final. ${name} als Sieger identifiziert.`,
  ],
  hypeBust: [
    "Fehler erkannt. Wurf ungültig.",
    "Berechnung fehlgeschlagen. Bust registriert.",
    "Warnung. Zielwert unterschritten.",
  ],
  hypeCricketClose: [
    "Zahl geschlossen. Bestätigt.",
    "Feld deaktiviert.",
  ],
  nextTurn: (name) => pickRandomNoRepeat([
    `Nächster Spieler: ${name}.`,
    `Aktiver Spieler: ${name}.`,
    `Warte auf Eingabe von ${name}.`,
    `Zug übergeben an: ${name}.`,
  ], "nextTurn"),
  plainRound: (total) => pickRandomNoRepeat([
    `Punktzahl: ${germanNumberWords(total)}.`,
    `Wurf verarbeitet. Wert: ${germanNumberWords(total)}.`,
    `${germanNumberWords(total)} Punkte registriert.`,
    `Berechnung abgeschlossen: ${germanNumberWords(total)}.`,
  ], "plainRound"),
  checkoutRemaining: (remaining, name, nickname) => {
    const words = germanNumberWords(remaining);
    return nickname
      ? `${name}. Restwert: ${words}. Bekannt als: ${nickname}.`
      : pickRandomNoRepeat([`${name}. Restwert: ${words}.`, `Verbleibend für ${name}: ${words}.`], "checkoutRemaining");
  },
  legWonNextLeg: (winner, next) => `Leg-Gewinner: ${winner}. Nächste Runde: ${next}.`,
};

// Fully original — a loud, cocky, street-slang-heavy hype-man who trash-talks and teases hard,
// but you can't help but like him (ribbing, not actually mean, no real profanity/insults).
const KERNASI_PACK: PersonaPack = {
  options: { pitch: 0.9, rate: 1.15, volume: 1 },
  hypeOptions: { pitch: 1, rate: 1.32, volume: 1 },
  hype180: [
    "ALTER, EINHUNDERTACHTZIG! Ischwöre, das gibt's doch nicht!",
    "Bratan, das war der Wahnsinn, komplett krank!",
    "Ne ne ne, das darf nicht wahr sein — Maximum, Alter!",
    "Digga ich flipp grad komplett aus, EINHUNDERTACHTZIG!",
    "Junge Junge Junge, das war der Hammer schlechthin!",
    "Alter, mach die Bude zu, mehr geht heut nicht mehr!",
    "Ischwöre auf alles, das war Weltklasse pur!",
  ],
  hypeHighTon: [
    "Ischwöre, das war fett!",
    "Alter, geht ab wie Schmidts Katze!",
    "Krass, Alter, richtig stark!",
    "Digga, da guckst du, oder?",
    "Bratan, das war mal ne Ansage!",
  ],
  hypeTonPlus: [
    "Ischwöre, passt!",
    "Alter, nicht schlecht!",
    "Joa, geht klar!",
    "Bisschen Sahne obendrauf, nice!",
    "Solide, Digga, solide!",
  ],
  hypeCheckout: [
    "PENG, Alter, weg is er!",
    "Ischwöre, der Gegner konnte nur zugucken!",
    "Sauber weggeputzt, wie meine Bude samstags!",
    "Da war NIX zu holen, Alter, gar nix!",
    "Bratan, das war chirurgische Präzision!",
    "Aufgeräumt wie beim Frühjahrsputz, Alter!",
    "Digga, Tür zu, Licht aus, fertig!",
  ],
  hypeCheckoutNamed: (name) => [
    `${name}, du Vollprofi, Alter!`,
    `Ischwöre, ${name} ist einfach nur Boss!`,
    `${name} macht hier einfach kurzen Prozess, Bratan!`,
  ],
  hypeMatchWin: (name) => [
    `${name} räumt hier komplett ab, Alter, Wahnsinn!`,
    `Ischwöre, ${name} ist heute einfach die Nummer eins!`,
    `${name} hat hier keinem eine Chance gelassen, Bratan!`,
    `Absoluter Ehrenmensch — ${name} gewinnt, Digga!`,
    `Alter, ${name} hat die ganze Bude abgeräumt!`,
  ],
  hypeBust: [
    "Ohhh nein, Alter, das war nix!",
    "Ischwöre, das tat mir grad selbst weh!",
    "Digga, komplett vorbei, was war das denn?!",
    "Alter, geh nochmal üben, ne im Ernst!",
    "Das war mehr peinlich als daneben, Bratan!",
    "Puh, Alter, da war wohl grad keiner zu Hause.",
    "Digga, das hat sogar der Nachbar gesehen — autsch.",
  ],
  hypeCricketClose: [
    "Zu, Alter, fix und fertig!",
    "Dicht wie meine Bude nach zwölf!",
    "Digga, Deckel drauf, nächste!",
  ],
  nextTurn: (name) => pickRandomNoRepeat([
    `Los, ${name}, zeig, was du drauf hast, Alter!`,
    `${name}, jetzt du, mach kein Terror!`,
    `Auf geht's, ${name}, zeig's ihnen, Bratan!`,
    `${name} ist dran — Digga, keinen Druck, nur Ehre.`,
    `${name}, ran an die Kiste!`,
  ], "nextTurn"),
  plainRound: (total) => pickRandomNoRepeat([
    `${germanNumberWords(total)}, Alter, geht klar.`,
    `${germanNumberWords(total)}, ischwöre, passt scho.`,
    `${germanNumberWords(total)}, nicht der Bringer, aber okay, Digga.`,
    `${germanNumberWords(total)}, Bratan, weiter im Text.`,
    `${germanNumberWords(total)}, Alter.`,
    `Solala, ${germanNumberWords(total)}, Digga.`,
  ], "plainRound"),
  checkoutRemaining: (remaining, name, nickname) => {
    const words = germanNumberWords(remaining);
    return nickname
      ? `${name} braucht noch ${words} — na los, der ${nickname} wartet, Alter!`
      : pickRandomNoRepeat([`${name} braucht noch ${words}, pack's an, Digga!`, `Noch ${words} für ${name}, Bratan, das schaffst du!`], "checkoutRemaining");
  },
  legWonNextLeg: (winner, next) => `Leg geht an ${winner}, Alter! ${next}, zeig, was du kannst!`,
};

// Classic breathless radio-commentary energy (escalating exclamations, "meine Damen und
// Herren") — generic to the genre, not modeled on any specific real commentator's signature
// lines (see chat: declined to reproduce e.g. Herbert Zimmermann's or Trapattoni's actual
// famous quotes, which are tied to real, identifiable people).
const REPORTER_PACK: PersonaPack = {
  options: { pitch: 1, rate: 1.05, volume: 1 },
  hypeOptions: { pitch: 1.2, rate: 1.35, volume: 1 },
  hype180: [
    "Und das ist... EINHUNDERTACHTZIG! Was für ein Wurf, meine Damen und Herren!",
    "Da ist er, der Maximum-Treffer! Unfassbar, was hier gerade passiert!",
    "Ganz Heiligenhaus wird das sehen wollen — einhundertachtzig!",
  ],
  hypeHighTon: [
    "Und das sitzt! Was für eine Runde!",
    "Die Halle tobt — starke Punktzahl!",
  ],
  hypeTonPlus: [
    "Sauber, sauber, sauber!",
    "Da ist Klasse zu sehen!",
  ],
  hypeCheckout: [
    "Uuuund AUS! Das Leg ist durch!",
    "Er macht den Deckel drauf — herausragend!",
    "Da ist die Tür zu, meine Damen und Herren!",
    "Was für ein Nervenspiel — und gewonnen!",
  ],
  hypeCheckoutNamed: (name) => [
    `${name} mit der ganz großen Nervenstärke!`,
    `${name} macht das Leg klar — Wahnsinn!`,
  ],
  hypeMatchWin: (name) => [
    `${name} ist Sieger dieser großartigen Partie!`,
    `Und ${name} jubelt — verdienter Sieg!`,
    `${name} krönt eine starke Leistung mit dem Matchgewinn!`,
  ],
  hypeBust: [
    "Oh, das sitzt nicht — bitter für ihn.",
    "Da war der Druck wohl zu groß.",
    "Schade, so nah dran und doch daneben.",
  ],
  hypeCricketClose: [
    "Geschlossen — und wie!",
    "Da ist sie zu, sauber gemacht!",
  ],
  nextTurn: (name) => pickRandomNoRepeat([
    `Und jetzt ist ${name} am Zug.`,
    `Der Blick geht zu ${name}.`,
    `${name} übernimmt.`,
    `Alle Augen auf ${name}.`,
  ], "nextTurn"),
  plainRound: (total) => pickRandomNoRepeat([
    `${germanNumberWords(total)} Punkte.`,
    `Und weiter geht's mit ${germanNumberWords(total)}.`,
    `${germanNumberWords(total)}, notiert.`,
    `Solide ${germanNumberWords(total)}.`,
  ], "plainRound"),
  checkoutRemaining: (remaining, name, nickname) => {
    const words = germanNumberWords(remaining);
    return nickname
      ? `${name} braucht noch ${words} — der große ${nickname}!`
      : pickRandomNoRepeat([`${name} braucht noch ${words} zum Sieg.`, `Noch ${words} trennen ${name} vom Triumph.`], "checkoutRemaining");
  },
  legWonNextLeg: (winner, next) => `Das Leg geht an ${winner}! Gleich geht's weiter mit ${next}.`,
};

// Intentionally over-the-top/cringe — an adult announcer badly overusing current youth slang
// (real terms, deliberately mashed together too densely) is the whole joke, not a genuine
// attempt to sound authentically "cool".
const GENZ_PACK: PersonaPack = {
  options: { pitch: 1.05, rate: 1.18, volume: 1 },
  hypeOptions: { pitch: 1.18, rate: 1.35, volume: 1 },
  hype180: [
    "Digga EINHUNDERTACHTZIG, das ist mega based, no cap!",
    "Bro this is literally cinema, einhundertachtzig!",
    "Lowkey highkey war das der Clip des Jahrhunderts!",
    "Sheesh — ne Digga, sorry, aber 180 ist einfach nur ein Move!",
    "Das war main character energy, ganz ehrlich!",
    "180?! Bro hat grad alle zu NPCs gemacht, fr fr!",
    "Kein Cap, das war so ein riesen dubs-Moment!",
  ],
  hypeHighTon: [
    "Das ist lowkey schon final boss energy!",
    "Digga das ist giving Profi-Vibes!",
    "Mega Aura, du bist grad am cooken!",
    "Bro, das war nicht mid, das war goated!",
  ],
  hypeTonPlus: [
    "Passt, ist safe kein L!",
    "Solide, nicht mid!",
    "Bisschen slay, ehrlich gesagt!",
    "Fr fr nicht schlecht, digga!",
  ],
  hypeCheckout: [
    "GECHECKT! Das ist ein core memory, digga!",
    "Bro hat grad gecookt, würd ich sagen!",
    "No cap das war clean, wie ein Skibidi-Ending!",
    "Ehre! Main-Character-Moment, digga!",
    "Das ist so ein W, bro — delulu is not the solulu, aber DAS hier ist real!",
    "Sheesh, einfach eingetütet, ist safe!",
  ],
  hypeCheckoutNamed: (name) => [
    `${name} ist grad main character, digga!`,
    `${name} cookt einfach nur, bro!`,
    `${name} mit dem fetten W, no cap!`,
  ],
  hypeMatchWin: (name) => [
    `${name} ist der Final Boss, digga, no cap!`,
    `${name} hat hier einfach nur GG gesagt, bro!`,
    `${name} ist grad literally goated, kein Cap!`,
    `${name} zieht den ganzen Match-W ein, fr fr!`,
  ],
  hypeBust: [
    "Bro das ist ein riesen L, ehrlich.",
    "Digga du bist grad von dir selbst gecooked worden.",
    "Das war mega mid, sorry, aber safe.",
    "NPC-Verhalten, Digga, echt jetzt.",
    "Aura minus zehntausend, das.",
    "Bro, das war lowkey embarrassing, no cap.",
  ],
  hypeCricketClose: [
    "Zu, digga, easy W.",
    "Dicht, ist safe.",
    "Ehre, das Feld ist Geschichte.",
  ],
  nextTurn: (name) => pickRandomNoRepeat([
    `${name}, du bist dran, zeig main character energy, digga!`,
    `${name}, deine Zeit zu cooken, bro!`,
    `Los ${name}, keine NPC-Vibes bitte!`,
    `${name} ist on the clock, digga, kein Druck.`,
    `${name}, dein Moment, lock in!`,
  ], "nextTurn"),
  plainRound: (total) => pickRandomNoRepeat([
    `${germanNumberWords(total)}, ist mid, aber okay, digga.`,
    `${germanNumberWords(total)}, safe kein W aber auch kein L.`,
    `${germanNumberWords(total)}, passt scho, digga.`,
    `${germanNumberWords(total)}, fr fr.`,
    `${germanNumberWords(total)}, lowkey solide.`,
  ], "plainRound"),
  checkoutRemaining: (remaining, name, nickname) => {
    const words = germanNumberWords(remaining);
    return nickname
      ? `${name} braucht noch ${words} — der ${nickname}, digga, das wird mega!`
      : pickRandomNoRepeat([`${name} braucht noch ${words}, geh drauf, digga!`, `Noch ${words} für ${name}, bro, du schaffst das, no cap!`], "checkoutRemaining");
  },
  legWonNextLeg: (winner, next) => `Leg-W für ${winner}, digga! ${next}, du bist dran!`,
};

const PERSONA_PACKS: Partial<Record<CallerVoice, PersonaPack>> = {
  yoda: YODA_PACK,
  pirate: PIRATE_PACK,
  herald: HERALD_PACK,
  robot: ROBOT_PACK,
  kernasi: KERNASI_PACK,
  reporter: REPORTER_PACK,
  genz: GENZ_PACK,
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

