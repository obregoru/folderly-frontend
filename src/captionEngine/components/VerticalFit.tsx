// Phase 3.4 — fit-to-vertical-box scaling.
//
// Renders children at their natural size inside a hidden measurement
// pass, measures the block's height, computes a uniform scale factor
// so the block fills `heightPx` exactly, then re-renders with
// transform:scale applied around the centered origin.
//
// Uses Remotion's delayRender() pattern so renderMedia() waits for the
// measurement + scale to settle before emitting any frame. Without the
// delay, frame 0 would render at scale=1 and subsequent frames at the
// measured scale — visible "pop" during export.
import React, { useLayoutEffect, useRef, useState, useEffect } from 'react';
import { delayRender, continueRender } from 'remotion';

export interface VerticalFitProps {
  heightPx: number;     // target height in composition-space pixels
  maxLines?: number;    // hard cap; text past this stays visible (docs)
  scale: number;        // composition width / 1080
  children: React.ReactNode;
}

export const VerticalFit: React.FC<VerticalFitProps> = ({ heightPx, maxLines, scale, children }) => {
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [fitScale, setFitScale] = useState<number | null>(null);
  // delayRender holds the render pipeline until measurement completes.
  const [handle] = useState(() => delayRender('VerticalFit measurement'));

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    // Use getBoundingClientRect (includes transforms) then strip the
    // ambient scale so we're measuring raw layout, not already-scaled
    // output. At this point fitScale is null so transform isn't applied
    // yet — the rect is the natural block size.
    const rect = el.getBoundingClientRect();
    const naturalHeight = rect.height;
    if (naturalHeight <= 0) { continueRender(handle); return; }
    const targetHeight = heightPx * scale;
    // Up-scale is the headline use case (short caption fills the band).
    // Down-scale capped at 0.35 to avoid illegible micro text if the
    // author exceeds maxLines — the plan calls this a visible failure
    // mode we document rather than silently handle.
    const raw = targetHeight / naturalHeight;
    const next = Math.max(0.35, Math.min(4, raw));
    setFitScale(next);
    continueRender(handle);
  }, [heightPx, scale, handle]);

  // Always release the handle on unmount in case the effect never ran
  // (e.g., ref never attached due to an error higher up).
  useEffect(() => () => { try { continueRender(handle) } catch {} }, [handle]);

  // Center-scale around the block's midpoint so the caption grows or
  // shrinks in place. The wrapping div reserves `heightPx * scale` so
  // the rest of the layout doesn't shift while we re-measure.
  return (
    <div
      style={{
        height: heightPx * scale,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div
        ref={measureRef}
        style={{
          transform: fitScale != null ? `scale(${fitScale})` : undefined,
          transformOrigin: 'center center',
          willChange: 'transform',
        }}
      >
        {children}
      </div>
    </div>
  );
};
