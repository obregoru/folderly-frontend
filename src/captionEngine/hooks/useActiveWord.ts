// Convert the current Remotion frame into the index of the word whose
// [startMs, endMs) window contains it. Returns null when nothing is
// active (including the pre-first-word silence and any inter-word
// gaps). Graceful on missing `wordTimings` so callers can feed raw
// props through unchanged for legacy segments.
import { useCurrentFrame, useVideoConfig } from 'remotion';

export interface WordTiming {
  wordIndex: number;
  word: string;
  startMs: number;
  endMs: number;
}

export function useActiveWord(wordTimings?: WordTiming[]): number | null {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!wordTimings || wordTimings.length === 0) return null;
  const nowMs = (frame / fps) * 1000;
  for (const w of wordTimings) {
    if (nowMs >= w.startMs && nowMs < w.endMs) return w.wordIndex;
  }
  return null;
}
