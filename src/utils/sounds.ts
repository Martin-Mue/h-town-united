/**
 * Sound & haptic feedback utilities for dart scoring events.
 * Uses Web Audio API for zero-latency sounds.
 */

const audioCtx = typeof window !== "undefined" ? new (window.AudioContext || (window as any).webkitAudioContext)() : null;

function playTone(frequency: number, duration: number, type: OscillatorType = "sine", volume = 0.15) {
  if (!audioCtx) return;
  // Resume context if suspended (autoplay policy)
  if (audioCtx.state === "suspended") audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function vibrate(pattern: number | number[]) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

/** Standard dart throw sound */
export function playThrowSound() {
  playTone(800, 0.08, "triangle", 0.08);
}

/** Bust / invalid throw */
export function playBustSound() {
  playTone(200, 0.15, "sawtooth", 0.12);
  setTimeout(() => playTone(150, 0.2, "sawtooth", 0.1), 100);
  vibrate([100, 50, 100]);
}

/** 180! Maximum score */
export function play180Sound() {
  const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
  notes.forEach((freq, i) => {
    setTimeout(() => playTone(freq, 0.3, "sine", 0.15), i * 120);
  });
  vibrate([100, 50, 100, 50, 200]);
}

/** Checkout / leg won */
export function playCheckoutSound() {
  playTone(880, 0.15, "sine", 0.12);
  setTimeout(() => playTone(1100, 0.15, "sine", 0.12), 100);
  setTimeout(() => playTone(1320, 0.25, "sine", 0.15), 200);
  vibrate([50, 30, 50, 30, 150]);
}

/** Match won - victory fanfare */
export function playVictorySound() {
  const notes = [523, 659, 784, 1047, 1047];
  notes.forEach((freq, i) => {
    setTimeout(() => playTone(freq, i === 4 ? 0.5 : 0.2, "sine", 0.15), i * 150);
  });
  vibrate([100, 50, 100, 50, 100, 50, 300]);
}

/** Ton+ (100+ score) */
export function playTonPlusSound() {
  playTone(660, 0.12, "sine", 0.1);
  setTimeout(() => playTone(880, 0.15, "sine", 0.12), 80);
  vibrate(80);
}

/** Turn switch */
export function playTurnSwitchSound() {
  playTone(440, 0.06, "triangle", 0.05);
}
