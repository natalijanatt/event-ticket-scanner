// Audible + haptic confirmation for noisy, crowded entrances. Both are
// best-effort: iOS Safari has no vibration API and audio needs a prior tap.

let audio: AudioContext | null = null;

/** Call from a user gesture (e.g. "Uključi kameru") so later beeps are allowed. */
export function unlockAudio(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audio ??= new Ctor();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

function tone(frequency: number, startAt: number, duration: number): void {
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'square';
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.25, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

export function signalSuccess(): void {
  try {
    navigator.vibrate?.(120);
    if (audio) {
      tone(880, audio.currentTime, 0.12);
      tone(1320, audio.currentTime + 0.11, 0.16);
    }
  } catch {
    /* feedback is optional */
  }
}

export function signalRejected(): void {
  try {
    navigator.vibrate?.([220, 90, 220]);
    if (audio) {
      tone(220, audio.currentTime, 0.22);
      tone(165, audio.currentTime + 0.26, 0.3);
    }
  } catch {
    /* feedback is optional */
  }
}
