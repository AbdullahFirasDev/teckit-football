"use client";

/**
 * Scanner audio feedback with zero assets: short synthesized tones via the
 * WebAudio API. The AudioContext is created lazily on first play — by then the
 * operator has interacted with the page (starting the camera), so autoplay
 * policies are satisfied.
 */

let ctx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(audio: AudioContext, freq: number, startAt: number, duration: number, type: OscillatorType, volume: number) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(audio.destination);

  const t0 = audio.currentTime + startAt;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/** Bright ascending chime for a valid check-in; low buzz for rejects. */
export function playChime(kind: "success" | "error") {
  const audio = getAudioContext();
  if (!audio) return;
  try {
    if (kind === "success") {
      tone(audio, 880, 0, 0.12, "sine", 0.18);
      tone(audio, 1318.51, 0.11, 0.22, "sine", 0.18);
    } else {
      tone(audio, 196, 0, 0.18, "square", 0.12);
      tone(audio, 155.56, 0.18, 0.25, "square", 0.12);
    }
  } catch {
    // Audio feedback is cosmetic — never break the check-in flow over it.
  }
}
