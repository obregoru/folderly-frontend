// Decouples caption components from the Remotion runtime. Every
// caption component that used to call `useCurrentFrame()` and
// `useVideoConfig()` now calls `useCaptionClock()` — which reads
// from a React context. Two providers populate the context:
//
//   RemotionClockProvider       — wraps server-side compositions,
//                                 reads Remotion's own hooks.
//   VideoElementClockProvider   — wraps editor-side overlays,
//                                 subscribes to an HTMLVideoElement's
//                                 currentTime via requestAnimationFrame.
//
// Result: the SAME caption component tree renders identically in both
// contexts. Server preview (download mp4) and in-editor overlay share
// one source of truth. No more @remotion/player in the browser — the
// editor's own <video> element drives the clock.

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

export interface CaptionClock {
  /** Current playback time in milliseconds. Drives every time-dependent effect. */
  nowMs: number;
  /** Composition fps — used by effects that still think in frames (pure-math `spring()`). */
  fps: number;
  /** Total composition / video duration in ms. Consulted by useExitProgress to know
   *  when the exit window starts. For editor overlays, pass the videoEl's duration. */
  totalDurationMs: number;
  /** Render canvas width in px — component-level animations (e.g., letterSpacingCollapse)
   *  scale translate offsets to this. */
  width: number;
  /** Render canvas height in px. */
  height: number;
}

const DEFAULT_CLOCK: CaptionClock = {
  nowMs: 0, fps: 30, totalDurationMs: 0, width: 1080, height: 1920,
};

export const CaptionClockContext = createContext<CaptionClock>(DEFAULT_CLOCK);

/** The one hook every caption component should call. Replaces both
 *  `useCurrentFrame()` and `useVideoConfig()` for caption-engine use. */
export function useCaptionClock(): CaptionClock {
  return useContext(CaptionClockContext);
}

/** Server-side provider. Reads Remotion's built-in hooks and pipes
 *  their values into the context. Mount at the top of any Remotion
 *  composition that uses caption components. */
export const RemotionClockProvider: React.FC<{
  width?: number;
  height?: number;
  children: React.ReactNode;
}> = ({ width, height, children }) => {
  const frame = useCurrentFrame();
  const config = useVideoConfig();
  const value = useMemo<CaptionClock>(() => ({
    nowMs: (frame / config.fps) * 1000,
    fps: config.fps,
    totalDurationMs: (config.durationInFrames / config.fps) * 1000,
    width: width ?? config.width,
    height: height ?? config.height,
  }), [frame, config.fps, config.durationInFrames, config.width, config.height, width, height]);
  return <CaptionClockContext.Provider value={value}>{children}</CaptionClockContext.Provider>;
};

/** Editor-side provider. Subscribes to an HTMLVideoElement's
 *  currentTime via requestAnimationFrame so effects tick at the
 *  browser's native refresh rate (60Hz+ on modern displays), not the
 *  server's 30fps Remotion grid. No Remotion runtime required. */
export const VideoElementClockProvider: React.FC<{
  videoEl: HTMLVideoElement | null;
  width: number;
  height: number;
  /** Nominal fps for any effect that still thinks in frames (via
   *  `frame = round(nowMs / 1000 * fps)`). Doesn't control how often
   *  the context updates — that's rAF-paced. Default 30 to match
   *  server compositions. */
  fps?: number;
  children: React.ReactNode;
}> = ({ videoEl, width, height, fps = 30, children }) => {
  // Track the video element's currentTime. rAF runs every paint, so
  // animations update at the monitor's refresh rate (no 30fps cap).
  const [nowMs, setNowMs] = useState(0);
  const [totalDurationMs, setTotalDurationMs] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!videoEl) return;

    const readDuration = () => {
      const d = Number(videoEl.duration);
      if (Number.isFinite(d) && d > 0) setTotalDurationMs(d * 1000);
    };
    readDuration();
    videoEl.addEventListener('loadedmetadata', readDuration);
    videoEl.addEventListener('durationchange', readDuration);

    const tick = () => {
      // Avoid dispatching setNowMs when the value hasn't actually
      // changed (paused state) to keep React re-renders minimal.
      const t = (videoEl.currentTime || 0) * 1000;
      setNowMs(prev => (Math.abs(prev - t) < 0.5 ? prev : t));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      videoEl.removeEventListener('loadedmetadata', readDuration);
      videoEl.removeEventListener('durationchange', readDuration);
    };
  }, [videoEl]);

  const value = useMemo<CaptionClock>(() => ({
    nowMs, fps, totalDurationMs, width, height,
  }), [nowMs, fps, totalDurationMs, width, height]);

  return <CaptionClockContext.Provider value={value}>{children}</CaptionClockContext.Provider>;
};
