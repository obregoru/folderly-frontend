// All built-in animation presets. Registered at module load — the
// composition only needs to `import './animation/presets'` once to get
// the whole set into the framework registry.

import React from 'react';
import { interpolate } from 'remotion';
import {
  registerAnimationPreset,
  staggeredProgress,
  type AnimationPreset,
  type AnimationContext,
} from './framework';

// ─── Phase 5.2 — zoomIn / zoomOut ──────────────────────────────────
// Block-scoped transforms on the OUTER animation wrapper so they
// compound predictably with Phase 3.4 VerticalFit (inner wrapper).
// Opacity softens the scale change so small-to-1.0 doesn't feel
// aggressive at large font sizes.

const zoomIn: AnimationPreset = {
  id: 'zoomIn',
  scope: 'block',
  apply: (progress: number): React.CSSProperties => {
    if (progress >= 1) return {};
    const scale = interpolate(progress, [0, 1], [0.3, 1.0]);
    const opacity = interpolate(progress, [0, 0.5], [0, 1], {
      extrapolateRight: 'clamp',
    });
    return {
      transform: `scale(${scale})`,
      transformOrigin: 'center center',
      opacity,
    };
  },
};

const zoomOut: AnimationPreset = {
  id: 'zoomOut',
  scope: 'block',
  apply: (progress: number): React.CSSProperties => {
    if (progress >= 1) return {};
    const scale = interpolate(progress, [0, 1], [2.5, 1.0]);
    const opacity = interpolate(progress, [0, 0.5], [0, 1], {
      extrapolateRight: 'clamp',
    });
    return {
      transform: `scale(${scale})`,
      transformOrigin: 'center center',
      opacity,
    };
  },
};

// ─── Phase 5.3 — letterSpacingCollapse ─────────────────────────────
// Per-char scope. Characters start spread wide and converge. The
// framework's per-char renderer in WordTrack passes a wordLocalProgress
// plus charIndex/charCount so each character can compute its "fly in"
// distance from its laid-out position.

const letterSpacingCollapse: AnimationPreset = {
  id: 'letterSpacingCollapse',
  scope: 'per-char',
  wantsCharacters: true,
  apply: (progress: number, ctx: AnimationContext): React.CSSProperties => {
    if (progress >= 1) return {};
    // translateX carries each character from an offscreen position to
    // its natural layout spot. The max offset scales with composition
    // width so the effect reads the same on 1080p vs 720p frames.
    const charIdx = ctx.charIndex ?? 0;
    const charCount = ctx.charCount ?? 1;
    // Center-relative position: -1 (leftmost) to +1 (rightmost)
    const relPos = charCount > 1 ? (charIdx - (charCount - 1) / 2) / ((charCount - 1) / 2) : 0;
    const maxOffset = ctx.compositionWidth * 0.55;
    const currentOffset = (1 - progress) * relPos * maxOffset;
    const opacity = interpolate(progress, [0, 0.15, 1], [0, 0.6, 1], {
      extrapolateRight: 'clamp',
    });
    return {
      display: 'inline-block',
      transform: `translateX(${currentOffset}px)`,
      opacity,
    };
  },
};

// ─── Phase 5.4 — foldOut + fallBounce ──────────────────────────────
// Both per-word with staggered entry. foldOut rotates each word into
// place; fallBounce drops each word from above with a springy settle.
// staggerMs default 50ms lives on each preset's config via ctx, with
// sensible in-preset fallbacks.

function pickStaggered(progress: number, ctx: AnimationContext, staggerMs: number, totalMs: number): number {
  return staggeredProgress(progress, ctx.wordIndex, ctx.totalWords, staggerMs, totalMs);
}

const foldOut: AnimationPreset = {
  id: 'foldOut',
  scope: 'per-word',
  apply: (progress: number, ctx: AnimationContext): React.CSSProperties => {
    if (progress >= 1) return {};
    const staggerMs = (ctx as unknown as { staggerMs?: number }).staggerMs ?? 50;
    const totalMs = (ctx as unknown as { totalMs?: number }).totalMs ?? 800;
    const local = pickStaggered(progress, ctx, staggerMs, totalMs);
    if (local >= 1) return {};
    // rotateX -90deg → 0deg; transformOrigin top so words hinge down.
    const rotate = interpolate(local, [0, 1], [-90, 0]);
    const opacity = interpolate(local, [0, 0.3], [0, 1], { extrapolateRight: 'clamp' });
    return {
      display: 'inline-block',
      transform: `perspective(600px) rotateX(${rotate}deg)`,
      transformOrigin: 'top center',
      opacity,
    };
  },
};

const fallBounce: AnimationPreset = {
  id: 'fallBounce',
  scope: 'per-word',
  apply: (progress: number, ctx: AnimationContext): React.CSSProperties => {
    if (progress >= 1) return {};
    const staggerMs = (ctx as unknown as { staggerMs?: number }).staggerMs ?? 80;
    const totalMs = (ctx as unknown as { totalMs?: number }).totalMs ?? 900;
    const local = pickStaggered(progress, ctx, staggerMs, totalMs);
    if (local >= 1) return {};
    // Overshoot curve: drop from -200px to +12px, then settle to 0.
    // easingOut-bounce-ish via a hand-rolled interpolate spec.
    const y = interpolate(
      local,
      [0, 0.75, 0.88, 1],
      [-200, 12, -4, 0],
    );
    const opacity = interpolate(local, [0, 0.25], [0, 1], { extrapolateRight: 'clamp' });
    return {
      display: 'inline-block',
      transform: `translateY(${y}px)`,
      opacity,
    };
  },
};

// ─── Phase 5.5 — neonFadeIn ────────────────────────────────────────
// Block-scoped. Opacity ramps up while a bright glow overshoots past
// the settled value, then relaxes. Interacts cleanly with a static
// neon outline from Phase 2.5 (active_word_outline_config) because
// the glow is applied at the BLOCK level here; per-word active
// outlines are applied on the <Word> level downstream.

const neonFadeIn: AnimationPreset = {
  id: 'neonFadeIn',
  scope: 'block',
  apply: (progress: number): React.CSSProperties => {
    if (progress >= 1) return {};
    const opacity = interpolate(progress, [0, 0.6], [0, 1], { extrapolateRight: 'clamp' });
    // Overshoot: glow radius peaks ~70% of the way in, then settles.
    const glowPx = interpolate(
      progress,
      [0, 0.7, 1],
      [0, 36, 14],
      { extrapolateRight: 'clamp' }
    );
    const glowOpacity = interpolate(progress, [0, 0.3, 1], [0, 0.9, 0.6], {
      extrapolateRight: 'clamp',
    });
    // Color pulse: start slightly cool (cyan-white) and settle to pure white
    // so the final rest state doesn't look tinted.
    const r = Math.round(interpolate(progress, [0, 1], [220, 255]));
    const g = Math.round(interpolate(progress, [0, 1], [240, 255]));
    return {
      opacity,
      color: `rgb(${r}, ${g}, 255)`,
      textShadow:
        `0 0 ${Math.round(glowPx * 0.4)}px rgba(255, 240, 200, ${glowOpacity.toFixed(2)}), ` +
        `0 0 ${Math.round(glowPx)}px rgba(255, 200, 100, ${glowOpacity.toFixed(2)}), ` +
        `0 0 ${Math.round(glowPx * 1.8)}px rgba(255, 150, 50, ${(glowOpacity * 0.7).toFixed(2)})`,
    };
  },
};

// ─── Phase 5.6 — slideIn{Left,Right,Top,Bottom} ───────────────────
// All four share the same shape: translate from an offscreen/near-
// offscreen start to (0,0), with a softening opacity fade. Block-
// scoped so the whole caption slides as a unit — cheapest approach
// that matches the spec and composes cleanly with Phase 3 layout.
//
// Offset is -110% / 110% rather than -100% so the caption clears the
// frame edge instead of ending flush with it at progress=0.

function slideFactory(id: string, axis: 'X' | 'Y', from: 1 | -1): AnimationPreset {
  return {
    id,
    scope: 'block',
    apply: (progress: number): React.CSSProperties => {
      if (progress >= 1) return {};
      const pct = interpolate(progress, [0, 1], [110 * from, 0]);
      const opacity = interpolate(progress, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' });
      return {
        transform: axis === 'X' ? `translateX(${pct}%)` : `translateY(${pct}%)`,
        opacity,
      };
    },
  };
}

const slideInLeft = slideFactory('slideInLeft', 'X', -1);
const slideInRight = slideFactory('slideInRight', 'X', 1);
const slideInTop = slideFactory('slideInTop', 'Y', -1);
const slideInBottom = slideFactory('slideInBottom', 'Y', 1);

// ─── Phase 5.7 — elasticIn / blurIn / rotateIn ────────────────────
// Three small block-scope presets bundled together. Each reads its
// own knob from the ctx-merged config (blur amount, rotate angle,
// damping ratio for elastic) with sane defaults.

// Elastic scale with a hand-rolled damped-oscillation function. We
// don't use Remotion's spring here directly because it's already
// consumed by `applyEasing(spring)` in framework.ts — we want the
// oscillation VISIBLE over the full progress window, not absorbed
// into the easing normalizer. Formula: decaying cosine converging
// to 1 as progress → 1.
const elasticIn: AnimationPreset = {
  id: 'elasticIn',
  scope: 'block',
  apply: (progress: number, ctx: AnimationContext): React.CSSProperties => {
    if (progress >= 1) return {};
    const dampingRatio = clampPositive((ctx as unknown as { dampingRatio?: number }).dampingRatio, 0.35);
    // Starts at 0 scale, wobbles past 1, settles.
    const p = Math.min(1, Math.max(0, progress));
    const envelope = Math.exp(-p * (1 / Math.max(0.08, dampingRatio)) * 4);
    const oscillation = Math.cos(p * Math.PI * 3);
    const scale = 1 - envelope * oscillation;
    const opacity = interpolate(p, [0, 0.3], [0, 1], { extrapolateRight: 'clamp' });
    return {
      transform: `scale(${Math.max(0, scale).toFixed(4)})`,
      transformOrigin: 'center center',
      opacity,
    };
  },
};

const blurIn: AnimationPreset = {
  id: 'blurIn',
  scope: 'block',
  apply: (progress: number, ctx: AnimationContext): React.CSSProperties => {
    if (progress >= 1) return {};
    const maxBlur = clampPositive((ctx as unknown as { blurPx?: number }).blurPx, 20);
    const blurPx = interpolate(progress, [0, 1], [maxBlur, 0]);
    const opacity = interpolate(progress, [0, 0.6], [0, 1], { extrapolateRight: 'clamp' });
    return {
      filter: `blur(${blurPx.toFixed(1)}px)`,
      opacity,
    };
  },
};

const rotateIn: AnimationPreset = {
  id: 'rotateIn',
  scope: 'block',
  apply: (progress: number, ctx: AnimationContext): React.CSSProperties => {
    if (progress >= 1) return {};
    const startAngle = (ctx as unknown as { startAngleDeg?: number }).startAngleDeg ?? -15;
    const deg = interpolate(progress, [0, 1], [startAngle, 0]);
    const opacity = interpolate(progress, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' });
    return {
      transform: `rotate(${deg.toFixed(2)}deg)`,
      transformOrigin: 'center center',
      opacity,
    };
  },
};

function clampPositive(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

// ─── register ──────────────────────────────────────────────────────

for (const p of [
  zoomIn, zoomOut, letterSpacingCollapse, foldOut, fallBounce, neonFadeIn,
  slideInLeft, slideInRight, slideInTop, slideInBottom,
  elasticIn, blurIn, rotateIn,
]) {
  registerAnimationPreset(p);
}
