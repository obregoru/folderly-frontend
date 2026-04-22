// Renders animated captions directly over an HTMLVideoElement in the
// editor. Replaces the separate @remotion/player mount that used to
// live in CaptionedPreviewFold — same caption tree, same effects,
// same visual output as the server's download mp4, but driven by the
// existing video element's currentTime via requestAnimationFrame.
//
// Sizing model: pass the video's DOM-displayed dimensions as the
// composition width/height. CaptionLayer derives font size from
// min(width, height) × 0.055, so a 400px-wide preview shows ~22px
// fonts — proportionally the same as a 1080×1920 download showing
// 59px fonts (both ~5.5% of width). Absolute-px effects like waveSine
// amplitude don't scale perfectly, but font size is the dominant
// visual and this keeps the overlay simple enough to not break.

import { useEffect, useState } from 'react'
import { VideoElementClockProvider, OffsetClockProvider, useCaptionClock } from '@caption/runtime/captionClock'
import { CaptionLayer } from '@caption/components/CaptionLayer'
// Side-effect imports so animation-preset + continuous-motion
// registries populate before the tree mounts.
import '@caption/animation/presets'
import '@caption/animation/continuous'

export default function InlineCaptionOverlay({ videoEl, cues, fps = 30 }) {
  // Track the video's DOM-displayed size. Caption components receive
  // these as the composition dimensions, so fontSize calculations
  // match the preview box rather than the 1080×1920 source.
  const [rect, setRect] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!videoEl) return
    const measure = () => {
      const r = videoEl.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) setRect({ width: r.width, height: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(videoEl)
    return () => ro.disconnect()
  }, [videoEl])

  if (!videoEl || !Array.isArray(cues) || cues.length === 0) return null
  if (rect.width === 0) return null

  return (
    <VideoElementClockProvider videoEl={videoEl} width={rect.width} height={rect.height} fps={fps}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        <ActiveCuesRenderer cues={cues} width={rect.width} height={rect.height} />
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
