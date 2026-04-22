// Phase 3.7 — per-line colored highlighter behind text. Unlike the
// rounded pill from Phase 3.2 (CaptionBox) this renders as a band
// through the middle of each line, following the baseline and
// breaking cleanly across wrapped lines.
//
// Implementation: a linear-gradient background on the inline text,
// combined with `box-decoration-break: clone` so a wrapped line gets
// a separate background per visual line. The gradient stops define
// the vertical band covering heightFraction of each line, offset by
// verticalOffsetFraction from the top.
//
// Sweep-in: when sweepIn is true, animate background-size horizontally
// from 0% → 100% over sweepDurationMs anchored to frame 0. Uses
// explicit frame math (sweep fires at caption entry, once).

import React from 'react';
import { useCaptionClock } from '../runtime/captionClock';
import type { HighlighterConfig } from './styleTypes';

export interface CaptionHighlighterProps {
  config: HighlighterConfig;
  children: React.ReactNode;
}

export const CaptionHighlighter: React.FC<CaptionHighlighterProps> = ({ config, children }) => {
  const { nowMs } = useCaptionClock();

  const heightFraction = clamp01(config.heightFraction ?? 0.55);
  const offsetFraction = clamp01(config.verticalOffsetFraction ?? 0.15);
  const opacity = clamp01(config.opacity ?? 0.7);
  const sweepMs = Math.max(1, config.sweepDurationMs ?? 400);

  const bandStartPct = offsetFraction * 100;
  const bandEndPct = Math.min(100, (offsetFraction + heightFraction) * 100);
  const bgColor = colorWithAlpha(config.color, opacity);

  // Gradient vertically — transparent above + below the band, color in
  // the middle. Horizontal fill handled by background-size for sweep.
  const gradient = [
    `linear-gradient(to bottom,`,
    `  transparent 0%,`,
    `  transparent ${bandStartPct.toFixed(1)}%,`,
    `  ${bgColor} ${bandStartPct.toFixed(1)}%,`,
    `  ${bgColor} ${bandEndPct.toFixed(1)}%,`,
    `  transparent ${bandEndPct.toFixed(1)}%,`,
    `  transparent 100%)`,
  ].join(' ');

  // Sweep progresses 0 → 100% over sweepDurationMs. When sweepIn is
  // false, pin to 100% (fully painted from frame 0).
  const sweepProgress = config.sweepIn
    ? Math.min(1, Math.max(0, nowMs / sweepMs))
    : 1;

  const style: React.CSSProperties = {
    backgroundImage: gradient,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'left center',
    backgroundSize: `${(sweepProgress * 100).toFixed(2)}% 100%`,
    // box-decoration-break gives us per-line backgrounds on wrap.
    WebkitBoxDecorationBreak: 'clone',
    boxDecorationBreak: 'clone',
    // Small horizontal padding so the band doesn't clip the first and
    // last letter of each line.
    padding: '0 0.1em',
    borderRadius: 2,
  };

  return <span style={style}>{children}</span>;
};

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

// Apply alpha to a #rrggbb color; leave rgb()/rgba()/named colors as-is.
function colorWithAlpha(color: string, alpha: number): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}
