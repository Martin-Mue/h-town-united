import { useCallback, useEffect, useRef, useState } from "react";

interface UseVoiceScoringResult {
  /** False when the browser has no SpeechRecognition at all (e.g. Firefox) — callers should
   *  hide the mic control entirely rather than show one that can never work. */
  supported: boolean;
  listening: boolean;
  /** Last recognized number, awaiting explicit confirmation — never auto-submitted, see below. */
  candidate: number | null;
  /** Recognition finished but no usable number was found in any alternative. */
  error: boolean;
  start: () => void;
  clear: () => void;
}

/** Hands-free visit-total capture via the browser's built-in, free/local SpeechRecognition — no
 *  cloud API, no key. Deliberately narrow and deliberately never commits anything on its own:
 *  every other ambiguous auto-input path already in this app (camera dart detection's checkout-
 *  order prompt, the bust/finish resolver) asks for human confirmation before it counts rather
 *  than trusting the detector outright, and a misheard number is no different — the caller must
 *  still explicitly submit `candidate` itself. Only digit-regex extraction is attempted (no
 *  word-to-number parsing for "one hundred eighty" etc.): Chrome/Edge's recognizer already
 *  normalizes common spoken numbers to digits in the transcript, and since nothing here ever
 *  auto-submits, a wrong extraction just gets discarded by the user instead of silently
 *  mis-scoring a real leg. */
export function useVoiceScoring(lang: string): UseVoiceScoringResult {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [candidate, setCandidate] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  }, []);

  const clear = useCallback(() => { setCandidate(null); setError(false); }, []);

  const start = useCallback(() => {
    const Ctor = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : undefined;
    if (!Ctor) return;
    setError(false);
    setCandidate(null);
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;
    recognition.onresult = (event) => {
      const alternatives = event.results[0];
      for (let i = 0; i < alternatives.length; i++) {
        const match = alternatives.item(i).transcript.match(/\d+/);
        if (match) {
          const n = parseInt(match[0], 10);
          if (n >= 0 && n <= 180) { setCandidate(n); return; }
        }
      }
      setError(true);
    };
    recognition.onerror = () => setError(true);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [lang]);

  // Abort a still-listening recognizer on unmount (e.g. navigating away mid-listen) — nothing
  // relies on onend firing after that, so no extra cleanup needed there.
  useEffect(() => () => { recognitionRef.current?.abort(); }, []);

  return { supported, listening, candidate, error, start, clear };
}
