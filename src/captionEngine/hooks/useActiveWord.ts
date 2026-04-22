// Convert the current clock time into the index of the word whose
// [startMs, endMs) window contains it. Returns null when nothing is
// active (including the pre-first-word silence and any inter-word
// gaps). Graceful on missing `wordTimings` so callers can feed raw
// props through unchanged for legacy segments.
//
// Reads from CaptionClockContext so it works in both the Remotion
// server render path AND the editor's inline overlay path. Same
// component tree, two clock sources.
import { useCaptionClock } from '../runtime/captionClock';

export interface WordTiming {
  wordIndex: number;
  word: string;
  startMs: number;
  endMs: number;
}

export function useActiveWord(wordTimings?: WordTiming[]): number | null {
  const { nowMs } = useCaptionClock();
  if (!wordTimings || wordTimings.length === 0) return null;
  for (const w of wordTimings) {
    if (nowMs >= w.startMs && nowMs < w.endMs) return w.wordIndex;
  }
  return null;
}
