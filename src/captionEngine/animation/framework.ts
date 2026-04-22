// Phase 5.1 — animation framework.
//
// Three scopes:
//   "block"     — returns CSS applied to the outer animation wrapper
//                 (the ENTIRE caption block transforms as a unit).
//                 Cheapest; compounds with Phase 3.4 VerticalFit only
//                 when the scale transforms are on different wrappers
//                 (framework wrapper is OUTSIDE VerticalFit — the
//                 composition enforces this).
//   "per-word"  — WordTrack consults the preset for each word and
//                 merges the returned CSS into that word's base style
//                 before passing to <Word>. Stagger comes from the
//                 preset using context.wordIndex.
//   "per-char"  — WordTrack asks the preset to render each word as a
//                 span of character spans, each with its own CSS
//                 from the preset. Active-word styling still
//                 cascades to the outer <Word> span so Phase 2
//                 effects keep working post-entry.
//
// Animations are one-shot. Entry progress runs [0..1] from frame 0
// through entryDurationMs and then the preset's
// `applyAfterSettled(final)` decides what remains visible (usually
// nothing — the caption holds at its final style). Exit progress runs
// [0..1] over the last exitDurationMs of the composition — note the
// reversal: "progress 0 = start of exit, progress 1 = fully exited".

import React from 'react';
import { interpolate, spring } from 'remotion';
import { useCaptionClock } from '../runtime/captionClock';

export type AnimationScope = 'block' | 'per-word' | 'per-char';

export type AnimationEasing = 'spring' | 'easeIn' | 'easeOut' | 'linear';

export interface AnimationConfig {
  preset: string;
  durationMs?: number;
  easing?: AnimationEasing;
  staggerMs?: number;
  // Preset-specific overflow, recorded as a JSON blob so we don't need
  // a new type per preset. Strongly-typed accessors live in each
  // preset module.
  [k: string]: unknown;
}

export interface AnimationContext {
  wordIndex: number;
  totalWords: number;
  charIndex?: number;  // only for per-char
  charCount?: number;  // only for per-char
  frameRate: number;
  compositionWidth: number;
  compositionHeight: number;
}

export interface AnimationPreset {
  id: string;
  scope: AnimationScope;
  /**
   * Called once per frame with the progress value (0..1) and context.
   * Returns CSS properties that the framework merges with the base.
   * Return {} to indicate "no effect at this frame" (e.g. preset is
   * settled and should hand control back to Phase 2 styling).
   */
  apply: (progress: number, context: AnimationContext) => React.CSSProperties;
  /**
   * Optional — when true, the framework will emit per-character spans
   * (per-char scope requires this). Used by the compositor to decide
   * whether to split <Word> text into character children.
   */
  wantsCharacters?: boolean;
}

// ─── registry ──────────────────────────────────────────────────────
const registry: Record<string, AnimationPreset> = {};

export function registerAnimationPreset(preset: AnimationPreset) {
  if (registry[preset.id]) {
    console.warn(`[animation] preset "${preset.id}" is being re-registered`);
  }
  registry[preset.id] = preset;
}

export function getAnimationPreset(id?: string | null): AnimationPreset | null {
  if (!id) return null;
  return registry[id] || null;
}

// A preset that does nothing — useful both as a default and as a test
// that the framework is wired correctly.
registerAnimationPreset({
  id: 'noop',
  scope: 'block',
  apply: () => ({}),
});

// ─── progress hooks ────────────────────────────────────────────────

/** Apply the configured easing to a linear 0..1 progress value. */
function applyEasing(progress: number, easing: AnimationEasing, fps: number): number {
  const p = Math.min(1, Math.max(0, progress));
  if (easing === 'linear') return p;
  if (easing === 'easeIn') return p * p;
  if (easing === 'easeOut') return 1 - (1 - p) * (1 - p);
  // spring: a deterministic overshoot curve. We normalize Remotion's
  // spring output to always end at 1 by computing its value at the
  // end of the duration and scaling.
  const durationFrames = Math.max(1, Math.round(fps * 0.6));
  const frame = p * durationFrames;
  const s = spring({
    frame,
    fps,
    from: 0,
    to: 1,
    config: { damping: 12, mass: 1, stiffness: 120, overshootClamping: false },
  });
  return s;
}

/**
 * Progress for an ENTRY animation starting at composition frame 0.
 * Returns 1 once the entry is complete (subsequent frames are past-
 * settled and presets should return the empty/hand-off CSS).
 *
 * Clock source: CaptionClockContext. Same hook in server render
 * (backed by useCurrentFrame) and editor overlay (backed by the
 * main video element's currentTime via rAF).
 */
export function useEntryProgress(durationMs: number, easing: AnimationEasing = 'spring'): number {
  const { nowMs, fps } = useCaptionClock();
  if (nowMs >= durationMs) return 1;
  if (nowMs <= 0) return 0;
  return applyEasing(nowMs / durationMs, easing, fps);
}

/**
 * Progress for an EXIT animation in the last `durationMs` of the
 * composition. Returns 0 until the window starts, then 0..1 through
 * the window. Exit needs totalDurationMs to know where the window
 * begins — the CaptionClockContext provides it on both server and
 * editor paths.
 */
export function useExitProgress(durationMs: number, easing: AnimationEasing = 'easeIn'): number {
  const { nowMs, fps, totalDurationMs } = useCaptionClock();
  if (totalDurationMs <= 0) return 0;
  const exitStartMs = totalDurationMs - durationMs;
  if (nowMs < exitStartMs) return 0;
  const raw = (nowMs - exitStartMs) / durationMs;
  return applyEasing(Math.min(1, Math.max(0, raw)), easing, fps);
}

/**
 * Compute a per-word local progress that staggers linearly from first
 * word → last word. Input `globalProgress` is 0..1 across the whole
 * duration; this narrows each word's active window.
 */
export function staggeredProgress(
  globalProgress: number,
  wordIndex: number,
  totalWords: number,
  staggerMs: number,
  totalDurationMs: number,
): number {
  if (staggerMs <= 0 || totalWords <= 1) return globalProgress;
  const maxStagger = Math.min(staggerMs * (totalWords - 1), totalDurationMs * 0.6);
  const perWordOffset = Math.min(staggerMs, maxStagger / Math.max(1, totalWords - 1));
  const localStart = (perWordOffset * wordIndex) / totalDurationMs;
  // Each word's animation consumes the remaining time after its offset
  const windowSize = 1 - localStart;
  if (windowSize <= 0) return 1;
  const local = (globalProgress - localStart) / windowSize;
  return Math.min(1, Math.max(0, local));
}

// ────────────────────────────────────────────────────────────────────
// RULE (Phase 5.6): while the entry animation is running, active-word
// effects are suppressed — the caption is still ARRIVING, so color/
// font/outline swaps on top would fight the motion. Once entry
// settles (progress === 1 past the entry window), Phase 2 takes
// over. Exit animations do NOT suppress active-word effects — the
// spoken word should keep lighting up even as the caption fades or
// shrinks away, which is the expected read.
// ────────────────────────────────────────────────────────────────────
