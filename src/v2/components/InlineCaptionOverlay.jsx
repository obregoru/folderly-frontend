// Renders animated captions directly over an HTMLVideoElement in the
// editor. Replaces the separate @remotion/player mount that used to
// live in CaptionedPreviewFold — same caption tree, same effects,
// same visual output as the server's download mp4, but driven by the
// existing video element's currentTime via requestAnimationFrame.
//
// Caption component tree is imported via @caption (the Vite alias
// set up by build config). Since the refactor that decoupled caption
// components from Remotion's runtime (backend commit 45dd9c9), those
// components read clock values from CaptionClockContext — populated
// here by VideoElementClockProvider instead of RemotionClockProvider.

import { useEffect, useRef, useState } from 'react'
import { VideoElementClockProvider, OffsetClockProvider, useCaptionClock } from '@caption/runtime/captionClock'
import { CaptionLayer } from '@caption/components/CaptionLayer'
// Side-effect imports so animation-preset + continuous-motion
// registries populate before the tree mounts.
import '@caption/animation/presets'
import '@caption/animation/continuous'

/**
 * @param {object} props
 * @param {HTMLVideoElement|null} props.videoEl  — the target element to overlay on.
 * @param {Array} props.cues  — same shape as server render-final cues (startMs, endMs,
 *                              text, wordTimings, captionStyle, fadeInMs, fadeOutMs).
 * @param {number} [props.width=1080]  — composition width (caption sizing uses this).
 * @param {number} [props.height=1920] — composition height.
 * @param {number} [props.fps=30]      — nominal fps for frame-math effects that still
 *                                        think in frames.
 */
export default function InlineCaptionOverlay({ videoEl, cues, width = 1080, height = 1920, fps = 30 }) {
  if (!videoEl || !Array.isArray(cues) || cues.length === 0) return null
  return (
    <VideoElementClockProvider videoEl={videoEl} width={width} height={height} fps={fps}>
      <div
        // Captions paint over the video element but must not swallow
        // clicks — the <video controls> underneath needs its own
        // pointer events. CaptionLayer's AbsoluteFill already sets
        // pointerEvents:'none'; this outer div matches that.
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        <ActiveCuesRenderer cues={cues} width={width} height={height} />
      </div>
    </VideoElementClockProvider>
  )
}

// Inside the clock provider: iterate cues, render only those whose
// window contains nowMs, and rebase each cue's clock via
// OffsetClockProvider so downstream components see cue-local time
// (word timings, fade envelopes, entry/exit animations all key off
// nowMs starting at 0 when the cue enters).
function ActiveCuesRenderer({ cues, width, height }) {
  const { nowMs } = useCaptionClock()
  return cues.map((cue, i) => {
    const fadeInMs = cue.fadeInMs || 0
    const fadeOutMs = cue.fadeOutMs || 0
    const effectiveStartMs = Math.max(0, cue.startMs - fadeInMs)
    const effectiveEndMs = cue.endMs + fadeOutMs
    if (nowMs < effectiveStartMs || nowMs >= effectiveEndMs) return null
    const effectiveDurationMs = effectiveEndMs - effectiveStartMs
    return (
      <OffsetClockProvider key={cue._segmentId || i} offsetMs={effectiveStartMs}>
        <OverlayCue cue={cue} width={width} height={height} durationMs={effectiveDurationMs} />
      </OffsetClockProvider>
    )
  })
}

// Mirror of FinalRender's FadedCaption, minus the Remotion Sequence
// wrapper. OffsetClockProvider above gives cue-local nowMs, so fade
// math and CaptionLayer's children share one clock origin.
function OverlayCue({ cue, width, height, durationMs }) {
  const { nowMs } = useCaptionClock()
  const fadeInMs = cue.fadeInMs || 0
  const fadeOutMs = cue.fadeOutMs || 0
  let opacity = 1
  if (fadeInMs > 0 && nowMs < fadeInMs) {
    opacity = Math.max(0, Math.min(1, nowMs / fadeInMs))
  } else if (fadeOutMs > 0 && nowMs > durationMs - fadeOutMs) {
    opacity = Math.max(0, Math.min(1, (durationMs - nowMs) / fadeOutMs))
  }
  return (
    <div style={{ opacity, width: '100%', height: '100%' }}>
      <CaptionLayer
        text={cue.text}
        wordTimings={cue.wordTimings}
        captionStyle={cue.captionStyle || null}
        width={width}
        height={height}
      />
    </div>
  )
}
