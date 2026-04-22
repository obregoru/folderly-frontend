// Rounded-pill background around the caption block. Sizes itself to
// content via display:inline-block so multi-line captions get a single
// continuous pill (not one per line) — that's the Phase-3.2 spec.
//
// The scale factor is the same one CaptionedVideo uses for fonts
// (composition width / 1080). Padding + corner radius scale with it so
// a pill authored at 1080p looks proportional on 720p or 1440p frames.
import React from 'react';
import type { BoxConfig } from './styleTypes';

export interface CaptionBoxProps {
  box?: BoxConfig | null;
  scale: number;  // composition width / 1080
  children: React.ReactNode;
}

export const CaptionBox: React.FC<CaptionBoxProps> = ({ box, scale, children }) => {
  // No box config → pass children through untouched so the caption
  // renders exactly as Phase 2.
  if (!box) return <>{children}</>;

  const paddingX = Math.round((box.paddingX ?? 24) * scale);
  const paddingY = Math.round((box.paddingY ?? 12) * scale);
  const cornerRadius = Math.round((box.cornerRadius ?? 16) * scale);
  const opacity = box.opacity ?? 1;

  return (
    <span
      style={{
        display: 'inline-block',
        background: box.color,
        opacity,
        padding: `${paddingY}px ${paddingX}px`,
        borderRadius: cornerRadius,
        // Preserve line-box behavior so the caption still wraps nicely
        // inside the pill when Phase 3.3 auto-line-breaks kicks in.
        lineHeight: 1.2,
      }}
    >
      {children}
    </span>
  );
};
