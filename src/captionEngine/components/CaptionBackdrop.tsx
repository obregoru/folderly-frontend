// Phase 3.7 — frosted-glass backdrop behind text. Uses
// `backdrop-filter: blur(...)` on a rounded rect sized to content. Lot
// more forgiving on busy video backgrounds than a solid pill (Phase
// 3.2 CaptionBox) because it blurs whatever is behind without hiding
// it entirely. Optional tint layers a color over the blur.

import React from 'react';
import type { BlurredBackdropConfig } from './styleTypes';

export interface CaptionBackdropProps {
  config: BlurredBackdropConfig;
  scale: number;  // composition width / 1080
  children: React.ReactNode;
}

export const CaptionBackdrop: React.FC<CaptionBackdropProps> = ({ config, scale, children }) => {
  const paddingX = Math.round((config.paddingX ?? 24) * scale);
  const paddingY = Math.round((config.paddingY ?? 12) * scale);
  const cornerRadius = Math.round((config.cornerRadius ?? 12) * scale);
  const blurPx = Math.max(0, config.blurPx ?? 20);
  const tintColor = config.tintColor ?? '#000000';
  const tintOpacity = Math.min(1, Math.max(0, config.tintOpacity ?? 0.25));

  return (
    <span
      style={{
        display: 'inline-block',
        padding: `${paddingY}px ${paddingX}px`,
        borderRadius: cornerRadius,
        backgroundColor: colorWithAlpha(tintColor, tintOpacity),
        backdropFilter: `blur(${blurPx}px)`,
        WebkitBackdropFilter: `blur(${blurPx}px)`,
        lineHeight: 1.2,
      }}
    >
      {children}
    </span>
  );
};

function colorWithAlpha(color: string, alpha: number): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}
