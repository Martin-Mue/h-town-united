/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Injected by vite.config.ts's `define` — the git short SHA and ISO timestamp of the build,
// so the running app can show which commit it's actually running.
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

// lib.dom.d.ts ships the peripheral Web Speech types (SpeechRecognitionResult etc.) but not the
// SpeechRecognition class itself or either global constructor — every browser that implements it
// still only exposes the vendor-prefixed `webkitSpeechRecognition` (Chrome/Edge/Safari), so both
// names need declaring here. Kept intentionally minimal — just the members useVoiceScoring.ts
// actually uses, not the full spec.
interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}
interface Window {
  SpeechRecognition?: { new (): SpeechRecognition };
  webkitSpeechRecognition?: { new (): SpeechRecognition };
}
