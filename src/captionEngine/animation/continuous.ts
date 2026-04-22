// Phase 5.8 — continuous (looping) motion presets.
//
// Distinct from the entry/exit animation framework because:
//   - No progress [0..1] window — runs every frame of the caption's
//     visible lifetime.
//   - Per-word scope (operates on each word's wrapper span) so the
//     transform composes additively with entry/exit transforms on
//     surrounding wrappers. Block-scope would fight VerticalFit and
//     make the whole caption drift on the frame.
//
// WordTrack wires this in as one more wrapper span around each word,
// after entry/exit transforms. Browser transform stacking handles
// the additivity — a child translateY(6px) inside a parent with its
// own translateY compounds cleanly.

import React from 'react';
import type { ContinuousMotionConfig } from '../components/styleTypes';

export interface ContinuousMotionContext {
  wordIndex: number;
  totalWords: number;
  nowMs: number;  // composition-time clock; wraps around per periodMs
}

export interface ContinuousMotionPreset {
  id: string;
  apply: (params: Record<string, unknown>, ctx: ContinuousMotionContext) => React.CSSProperties;
}

const registry: Record<string, ContinuousMotionPreset> = {};

export function registerContinuousMotionPreset(p: ContinuousMotionPreset) {
  if (registry[p.id]) {
    // eslint-disable-next-line no-console
    console.warn(`[continuous-motion] preset "${p.id}" is being re-registered`);
  }
  registry[p.id] = p;
}

export function getContinuousMotionPreset(id?: string | null): ContinuousMotionPreset | null {
  if (!id) return null;
  return registry[id] || null;
}

// Compute the CSS for a given config at the current frame. Returns
// null when the config is missing or points at an unknown preset so
// the caller can short-circuit without a wrapper span.
export function continuousMotionStyle(
  config: ContinuousMotionConfig | null | undefined,
  ctx: ContinuousMotionContext,
): React.CSSProperties | null {
  if (!config) return null;
  const preset = getContinuousMotionPreset(config.preset);
  if (!preset) return null;
  return preset.apply(config.params || {}, ctx);
}

// ─── waveSine ───────────────────────────────────────────────────────
// Vertical bob. Each word's offset is:
//   amplitudePx * sin((2π * (nowMs - phaseOffset * wordIndex)) / periodMs)
// With perWordPhaseOffset=true the wave travels across the caption.
// With false, every word bobs in unison.
registerContinuousMotionPreset({
  id: 'waveSine',
  apply: (params, ctx) => {
    const amplitude = typeof params.amplitudePx === 'number' ? params.amplitudePx : 6;
    const period = typeof params.periodMs === 'number' && params.periodMs > 0 ? params.periodMs : 1200;
    const perWordOffset = params.perWordPhaseOffset === true;
    // 100ms per-word offset is a legible traveling wave at the common
    // 1200ms period; shorter periods feel jittery, longer ones read as
    // a lazy drift. Spec leaves the exact offset as "~100ms".
    const phaseShiftMs = perWordOffset ? 100 * ctx.wordIndex : 0;
    const angle = (2 * Math.PI * (ctx.nowMs - phaseShiftMs)) / period;
    const offset = amplitude * Math.sin(angle);
    return {
      display: 'inline-block',
      transform: `translateY(${offset.toFixed(2)}px)`,
    };
  },
});
