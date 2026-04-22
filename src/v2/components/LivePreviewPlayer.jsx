// Browser-side live preview of the captioned video. Uses @remotion/
// player to render the exact same FinalRender composition the server
// uses for the Download path — eliminates the server round-trip for
// the preview fold.
//
// Server/browser divergence: the FinalRender composition accepts an
// optional audioTracks[] prop so both paths pass the same shape.
// Server omits it (its videoUrl has audio baked in via FFmpeg);
// browser populates it with per-segment voiceover URLs and ducks the
// source video's original audio via videoAudioVolume.

import { useMemo, useRef, useEffect } from 'react'
import { Player } from '@remotion/player'
import { FinalRender } from '@caption/compositions/FinalRender'
// Side-effect imports so the animation + continuous-motion preset
// registries are populated before Player mounts the composition.
// Same pattern the server-side composition relies on at render time.
import '@caption/animation/presets'
import '@caption/animation/continuous'

/**
 * @typedef {{src: string, startMs: number, durationMs: number, volume?: number}} AudioTrack
 * @typedef {{startMs: number, endMs: number, text: string, wordTimings?: any[], captionStyle?: any, fadeInMs?: number, fadeOutMs?: number}} Cue
 *
 * @param {object} props
 * @param {string} props.mergedVideoUrl - Supabase URL of the merged video (no voiceover mix).
 * @param {AudioTrack[]} props.segmentAudioUrls - one per voiceover segment.
 * @param {Cue[]} props.cues - same array shape the server passes to remotionCaptionPass.
 *                             captionStyle must already have the default applied (fallback-chain
 *                             resolved by the caller — the composition doesn't re-resolve).
 * @param {number} [props.width=1080] - composition width in pixels.
 * @param {number} [props.height=1920] - composition height in pixels.
 * @param {number} [props.fps=30] - composition fps.
 * @param {number} [props.videoAudioVolume=0.3] - duck factor for the source video's original
 *                                                 audio while voiceover tracks are layered on top.
 * @param {number} [props.paddingMs=500] - buffer past the last cue/audio so playback doesn't cut
 *                                          while the last word finishes animating.
 * @param {(info: {styleFp?: string, cueCount: number}) => void} [props.onReady] - fired once after
 *                                                 the Player mounts and the input props stabilize.
 *                                                 Step-4 uses this for the live-preview-view log.
 */
export default function LivePreviewPlayer({
  mergedVideoUrl,
  segmentAudioUrls = [],
  cues = [],
  width = 1080,
  height = 1920,
  fps = 30,
  videoAudioVolume = 0.3,
  paddingMs = 500,
  onReady,
}) {
  // Duration is the max of: last cue endMs, last audio endMs, video
  // length (unknowable client-side without probing). Take max of
  // cue/audio as the lower bound + a small padding. If the video is
  // longer than cues, Player will keep playing video past the last
  // caption — acceptable for a preview.
  const { durationInFrames, totalDurationMs } = useMemo(() => {
    let maxMs = 0
    for (const c of cues) if (c?.endMs > maxMs) maxMs = c.endMs
    for (const a of segmentAudioUrls) {
      const end = (a?.startMs || 0) + (a?.durationMs || 0)
      if (end > maxMs) maxMs = end
    }
    const total = Math.max(1000, maxMs + paddingMs)
    return {
      totalDurationMs: total,
      durationInFrames: Math.max(1, Math.round((total / 1000) * fps)),
    }
  }, [cues, segmentAudioUrls, fps, paddingMs])

  // Stable JSON-ified inputProps — changes only when the *content*
  // changes, which is the signal we want for onReady refires.
  const inputProps = useMemo(() => ({
    videoUrl: mergedVideoUrl,
    width,
    height,
    cues,
    audioTracks: segmentAudioUrls,
    videoAudioVolume,
  }), [mergedVideoUrl, segmentAudioUrls, cues, width, height, videoAudioVolume])

  // Fire onReady exactly once per distinct inputProps set. Used by
  // Step-4 to emit a [preview-log] line when a new style config gets
  // put in front of the user.
  const lastSeen = useRef(null)
  useEffect(() => {
    if (!onReady) return
    const key = JSON.stringify({
      v: inputProps.videoUrl,
      c: inputProps.cues,
      a: inputProps.audioTracks,
    })
    if (lastSeen.current === key) return
    lastSeen.current = key
    onReady({ cueCount: cues.length, styleFp: undefined })
  }, [inputProps, cues.length, onReady])

  if (!mergedVideoUrl) {
    return (
      <div className="flex items-center justify-center aspect-[9/16] max-h-[60vh] bg-black text-white/60 text-[11px] rounded">
        Merge a video first to see the live preview.
      </div>
    )
  }

  return (
    <Player
      component={FinalRender}
      inputProps={inputProps}
      durationInFrames={durationInFrames}
      compositionWidth={width}
      compositionHeight={height}
      fps={fps}
      controls
      autoPlay={false}
      loop={false}
      clickToPlay
      acknowledgeRemotionLicense
      style={{ width: '100%', aspectRatio: `${width}/${height}`, maxHeight: '60vh', background: 'black', borderRadius: 8, overflow: 'hidden' }}
    />
  )
}

// Re-export for convenience — consumers that need the total duration
// (e.g. UI copy) don't have to recompute it separately.
export function computePreviewDurationMs(cues, segmentAudioUrls, paddingMs = 500) {
  let maxMs = 0
  for (const c of cues || []) if (c?.endMs > maxMs) maxMs = c.endMs
  for (const a of segmentAudioUrls || []) {
    const end = (a?.startMs || 0) + (a?.durationMs || 0)
    if (end > maxMs) maxMs = end
  }
  return Math.max(1000, maxMs + paddingMs)
}
