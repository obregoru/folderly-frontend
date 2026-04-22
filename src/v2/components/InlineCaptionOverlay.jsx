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

import { useEffect, useState } from 'react'
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
 * @param {number} [props.width=1080]  — composition width. Caption components size
 *                                        fonts / translate offsets / wave amplitudes
 *                                        in THESE composition-space pixels.
 * @param {number} [props.height=1920] — composition height.
 * @param {number} [props.fps=30]      — nominal fps for frame-math effects.
 *
 * Rendering model: identical to Remotion Player. The caption tree
 * lays out at the composition's native resolution (e.g. 1080×1920),
 * then a CSS transform scales the entire block to match the video
 * element's DOM-displayed size. Keeps every absolute-px effect
 * (waveSine amplitude, scalePulse translate, outline widths) visually
 * proportional to the video content, matching what Download renders
 * frame-for-frame.
 */
export default function InlineCaptionOverlay({ videoEl, cues, width = 1080, height = 1920, fps = 30 }) {
  // Track the video's DOM-displayed size so we can scale the
  // composition-space overlay to match it. ResizeObserver updates on
  // layout changes (panel resize, window resize, video metadata load
  // changing its aspect ratio).
  const [displayRect, setDisplayRect] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!videoEl) return
    const measure = () => {
      const r = videoEl.getBoundingClientRect()
      // Avoid churn on 0×0 (happens briefly during unmount). React
      // will re-measure on the next resize event once a real size
      // lands.
      if (r.width > 0 && r.height > 0) {
        setDisplayRect({ width: r.width, height: r.height })
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(videoEl)
    return () => ro.disconnect()
  }, [videoEl])

  if (!videoEl || !Array.isArray(cues) || cues.length === 0) return null
  if (displayRect.width === 0) return null  // wait for first measurement

  // Scale the composition-resolution overlay down to the displayed
  // video size. Uses the width ratio only — assumes display and video
  // share an aspect ratio, which is true for our 9:16 merges sitting
  // in their own 9:16 container. If aspect ratios diverge, fonts stay
  // proportional to width; vertical position adjusts via percentage
  // in CaptionLayer.
  const scale = displayRect.width / width

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
        <div
          // Composition-space stage. Fixed at the source resolution
          // so caption math (pixel-sized effects, font sizes computed
          // from width/height) operates in the dimensions Download
          // renders at. transform:scale fits it visually to the DOM.
          style={{
            width,
            height,
            transformOrigin: '0 0',
            transform: `scale(${scale})`,
          }}
        >
          <ActiveCuesRenderer cues={cues} width={width} height={height} />
        </div>
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
