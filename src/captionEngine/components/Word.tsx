// A single word span with the base style merged with the active-word
// overrides when `isActive` is true. Deliberately a thin primitive —
// effect precedence + font loading live one level up in <WordTrack> so
// <Word> stays trivially testable.

import React from 'react';
import { useCaptionClock } from '../runtime/captionClock';
import type { WordStyle, ActiveWordStyle, ActiveWordScalePulse, TextFillConfig } from './styleTypes';
import { composeShadows } from './textEffects';

export interface WordProps {
  word: string;
  wordIndex: number;
  startMs: number;
  endMs: number;
  isActive: boolean;
  baseStyle: WordStyle;
  activeStyle?: ActiveWordStyle;
  // Phase 2.6 — one-shot scale pulse on activation. Null/absent = no
  // pulse. Transform is computed per-frame from (nowMs - startMs) so
  // the pulse triggers exactly when the word becomes active.
  scalePulse?: ActiveWordScalePulse | null;
  // Phase 3.8 — image/video-filled text. When set (and not suppressed
  // by an active-word color swap), the text renders as a window into
  // the fill asset via background-clip: text. Suppression rule: an
  // active word that has an active color overrides the fill so the
  // active styling reads cleanly.
  textFill?: TextFillConfig | null;
  // Phase 5.3 — when a per-char preset wants animated characters, the
  // WordTrack passes pre-styled char spans as children instead of a
  // flat word string. The merged style still cascades down, so Phase
  // 2 active-word effects apply uniformly to every char.
  children?: React.ReactNode;
}

export const Word: React.FC<WordProps> = ({ word, startMs, isActive, baseStyle, activeStyle, scalePulse, textFill, children }) => {
  // Hooks must run unconditionally, so always read the clock here
  // even when there's no scalePulse to drive. The clock comes from
  // CaptionClockContext — either Remotion's (server render) or the
  // editor video's currentTime (live overlay), both present nowMs
  // in the same units.
  const { nowMs } = useCaptionClock();

  // Precedence (Phase 2.6 contract):
  //   1. base          — color / fontFamily / fontSize / drop shadow
  //   2. activeColor   — overrides base color while isActive
  //   3. activeFont    — overrides base fontFamily while isActive
  //   4. activeOutline — replaces base drop shadow while isActive, so
  //                      outline/glow/neon reads cleanly (the active
  //                      effect IS the readability treatment; no need
  //                      for a drop shadow underneath).
  //   5. scalePulse    — transform applied on top of everything else.
  //                      Doesn't touch the style merge, only the outer
  //                      <span>'s transform, so disabling any of 1–4
  //                      leaves the pulse untouched and vice versa.
  // Each later step overrides the earlier one's touched properties
  // only — unset active fields leave base untouched. This means any
  // effect can be disabled by nulling its field without breaking the
  // others (verified in the Phase 2.6 combined-effect render).
  const merged: React.CSSProperties = { ...baseStyleToCSS(baseStyle) };
  // Phase 3.6 — track the active-word outline separately so we can
  // compose it on top of the base text-shadow (from textEffect) rather
  // than replace it. Replacement was the Phase 2 behavior; composition
  // preserves the configured static effect during active spans.
  let activeOutlineShadow: string | undefined;
  const activeColorApplied = isActive && !!activeStyle?.color;
  if (isActive && activeStyle) {
    if (activeStyle.color) merged.color = activeStyle.color;
    if (activeStyle.fontFamily) merged.fontFamily = activeStyle.fontFamily;
    if (activeStyle.outline) {
      const { type, color, width = 2, blur = 0 } = activeStyle.outline;
      if (type === 'outline') {
        // Crisp stroked outline via 4-direction text-shadow. Works in
        // headless Chrome where -webkit-text-stroke can interact poorly
        // with WebKit's text layout.
        activeOutlineShadow = fourWayOutline(color, width);
      } else if (type === 'glow') {
        activeOutlineShadow = glowShadow(color, width, blur);
      } else if (type === 'neon') {
        activeOutlineShadow = [fourWayOutline(color, Math.max(1, Math.round(width * 0.5))), glowShadow(color, width, blur || width * 2)].join(', ');
      }
    }
  }
  merged.textShadow = composeShadows(baseStyle.textShadow, activeOutlineShadow);

  // A smooth 100ms color transition keeps per-frame color swaps from
  // looking jarring. Remotion + headless Chrome DO interpolate CSS
  // transitions across frames (confirmed by the Phase 2.3 test render).
  merged.transition = 'color 100ms linear';

  // Phase 3.8 — image-filled text. Uses `background-clip: text` so the
  // glyph shapes become a window into the fill image. Suppression
  // rule: when the word is actively colored (activeStyle.color while
  // isActive), the active color wins and the fill is skipped — active
  // styling is the readability treatment and must override decoration.
  // Video fills fall through to background-image too (the v1 shipped
  // path); spec flagged SVG-mask compositing as follow-up.
  const fillActive = textFill && textFill.url && !activeColorApplied;
  if (fillActive) {
    const size = textFill!.fit === 'contain' ? 'contain' : 'cover';
    merged.backgroundImage = `url(${JSON.stringify(textFill!.url)})`;
    merged.backgroundSize = size;
    merged.backgroundPosition = 'center';
    merged.backgroundRepeat = 'no-repeat';
    // Blend opacity by fading to base color via rgba — pure
    // background-clip:text doesn't offer a built-in opacity on the
    // "see-through" channel.
    merged.WebkitBackgroundClip = 'text';
    merged.backgroundClip = 'text';
    merged.color = 'transparent';
    // When opacity < 1, a color overlay underneath softens the fill so
    // some of the base color still shows through. Cheapest approach:
    // layer a base-color text behind via filter, but that needs a
    // wrapper. For v1 we honor opacity by reducing alpha on the fill
    // directly (css `background-blend-mode` doesn't cover all cases).
    if (typeof textFill!.opacity === 'number' && textFill!.opacity < 1) {
      merged.opacity = textFill!.opacity;
    }
  }

  // Phase 2.6 — per-frame scale via explicit math. Anchored to startMs
  // (not to isActive) because isActive can flicker at frame boundaries
  // and we don't want the pulse to restart each time. Pure function of
  // nowMs, so no hooks inside — rules-of-hooks safe.
  const pulseScale = scalePulse ? computePulseScale(scalePulse, startMs, nowMs) : 1;
  if (pulseScale !== 1) {
    merged.transform = `scale(${pulseScale})`;
    // Center transform-origin so neighbors don't shift — words sit in
    // an inline row and scale around their own center.
    merged.transformOrigin = 'center center';
    merged.display = 'inline-block';
  }

  return <span style={merged}>{children ?? word}</span>;
};

// Frame-math scale computation. Returns 1 before startMs, ramps to
// peakScale over attackMs, back to 1 over releaseMs, then holds at 1.
// Pure function — clock is read by the caller so hooks stay at the
// component top level.
function computePulseScale(pulse: ActiveWordScalePulse, startMs: number, nowMs: number): number {
  const t = nowMs - startMs;
  if (t < 0) return 1;
  const attack = Math.max(1, pulse.attackMs);
  const release = Math.max(1, pulse.releaseMs);
  const peak = Math.max(1, pulse.peakScale);
  if (t < attack) return 1 + (peak - 1) * (t / attack);
  if (t < attack + release) return peak - (peak - 1) * ((t - attack) / release);
  return 1;
}

function baseStyleToCSS(b: WordStyle): React.CSSProperties {
  const css: React.CSSProperties = {
    color: b.color,
    fontFamily: b.fontFamily,
    fontSize: b.fontSize,
    fontWeight: b.fontWeight ?? 700,
    textShadow: b.textShadow,
  };
  return css;
}

function fourWayOutline(color: string, width: number): string {
  const w = Math.max(1, Math.round(width));
  const parts: string[] = [];
  // 8-way offsets for better coverage at corners.
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      if (x === 0 && y === 0) continue;
      parts.push(`${x * w}px ${y * w}px 0 ${color}`);
    }
  }
  return parts.join(', ');
}

function glowShadow(color: string, width: number, blur: number): string {
  const b = Math.max(1, Math.round(blur || width * 2));
  // Three layered shadows = smoother falloff than a single big blur.
  return [
    `0 0 ${Math.round(b * 0.5)}px ${color}`,
    `0 0 ${b}px ${color}`,
    `0 0 ${Math.round(b * 1.8)}px ${color}`,
  ].join(', ');
}
