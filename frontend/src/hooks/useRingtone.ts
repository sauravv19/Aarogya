"use client";

import { useEffect, useRef } from "react";

/**
 * Generate a phone-ring tone via Web Audio API and loop it.
 * More reliable than a long WAV file with HTMLAudioElement.
 */
export function useRingtone(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const nextRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      cleanup(ctxRef.current, nextRef.current);
      return;
    }

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const baseFreq = 425; // standard ring frequency
    const ringLen = 1.2;
    const gapLen = 3.5;
    const cycle = ringLen + gapLen;
    const gainVal = 0.25;

    const stopAt = ctx.currentTime + cycle * 40; // ~3 min max

    for (let i = 0; i < 40; i++) {
      const start = ctx.currentTime + i * cycle;
      if (start > stopAt) break;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.value = baseFreq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(gainVal, start + 0.05);
      gain.gain.setValueAtTime(gainVal, start + ringLen - 0.05);
      gain.gain.linearRampToValueAtTime(0, start + ringLen);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + ringLen + 0.1);
    }

    return () => {
      cleanup(ctxRef.current, nextRef.current);
    };
  }, [enabled]);
}

function cleanup(ctx: AudioContext | null, next: number | null) {
  if (next) cancelAnimationFrame(next);
  if (ctx && ctx.state !== "closed") ctx.close();
}
