// Assembles the cue + audio-track shape LivePreviewPlayer /
// InlineCaptionOverlay expects. Mirrors the server-side cue-build
// logic in routes/social-post.js so the browser sees what Download
// will render.
//
// Loaded lazily by the editor overlay, so the fetch cascade (job
// shell + default style + segment-transition, then per-segment
// caption_style + word_timings fanned out) only happens when a
// preview is being shown.

import { useEffect, useState } from 'react'
import * as api from '../../api'

export function useLivePreviewAssets(draftId, { enabled = true } = {}) {
  const [assets, setAssets] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // Bumped by `posty-voiceover-change` so editor toggles (segment
  // hideCaption, job-level hideCaptions, add/remove segments, etc.)
  // force a refetch without having to reach into this hook's caller.
  const [refetchKey, setRefetchKey] = useState(0)

  // Listen for voiceover edits dispatched by VoiceoverPanelV2. The
  // hook otherwise only refetches on draftId change — a toggle would
  // save to the DB but the preview would keep rendering the stale
  // cues snapshot taken at first mount.
  //
  // The 1000ms delay is load-bearing: saveVoiceoverSettings goes
  // through jobSync.debouncedSaveJob (800ms), so refetching any
  // sooner would read the DB BEFORE the save lands and pull the
  // stale rows back in. 1000ms gives the debounce + network
  // round-trip enough slack. Rapid successive events collapse via
  // the timeout clear so only the last toggle triggers a refetch.
  useEffect(() => {
    let timeoutId = null
    const onChange = () => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => setRefetchKey(k => k + 1), 1000)
    }
    window.addEventListener('posty-voiceover-change', onChange)
    return () => {
      window.removeEventListener('posty-voiceover-change', onChange)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [])

  useEffect(() => {
    if (!enabled || !draftId) {
      setAssets(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true); setError(null)
    ;(async () => {
      try {
        const [job, defRes, transRes] = await Promise.all([
          api.getJob(draftId),
          api.getJobDefaultCaptionStyle(draftId).catch(() => ({ caption_style: null })),
          api.getSegmentTransition(draftId).catch(() => ({ transition: null })),
        ])
        if (cancelled) return
        const mergedVideoUrl = job?.merged_video_url || null
        // Overlay only needs segments that have audio + a style/word
        // timings. Absent merged video → no overlay to render (caller
        // handles this via null assets).
        const defaultCs = defRes?.caption_style || null
        const transition = transRes?.transition || null
        const crossfadeMs = (transition?.type === 'crossfade' && Number(transition.crossfadeMs) > 0)
          ? Math.min(2000, Math.max(50, Math.round(Number(transition.crossfadeMs))))
          : 0

        // Job-level master switch for spoken-word captions. When
        // true, the preview renders no caption cues at all — matches
        // the /post/render-final short-circuit so what you see is
        // what downloads.
        const jobHideCaptions = !!job?.voiceover_settings?.hideCaptions
        const segs = Array.isArray(job?.voiceover_settings?.segments) ? job.voiceover_settings.segments : []
        const ordered = [...segs]
          .filter(s => s && s.id && s.audioUrl)
          .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0))

        const perSegment = await Promise.all(ordered.map(async (seg) => {
          const [csRes, wtRes] = await Promise.all([
            api.getCaptionStyle(draftId, seg.id).catch(() => ({ caption_style: null })),
            api.getSegmentWordTimings(draftId, seg.id).catch(() => ({ word_timings: [] })),
          ])
          return { seg, cs: csRes?.caption_style || null, wt: wtRes?.word_timings || [] }
        }))
        if (cancelled) return

        const segmentAudioUrls = perSegment.map(({ seg }) => {
          const startMs = Math.max(0, Math.round((Number(seg.startTime) || 0) * 1000))
          const durMs = Number(seg.duration) > 0
            ? Math.round(Number(seg.duration) * 1000)
            : 3000
          return { src: seg.audioUrl, startMs, durationMs: durMs, volume: 1 }
        })

        const lastIdx = perSegment.length - 1
        const cues = perSegment.map(({ seg, cs, wt }, idx) => {
          const startMs = Math.max(0, Math.round((Number(seg.startTime) || 0) * 1000))
          const lastWordEnd = wt.length ? wt[wt.length - 1].endMs : 0
          const durMs = Number(seg.duration) > 0
            ? Math.round(Number(seg.duration) * 1000)
            : (lastWordEnd > 0 ? lastWordEnd + 300 : 3000)
          const resolvedStyle = cs ? snakeToCamelCaptionStyle(cs)
            : (defaultCs ? snakeToCamelCaptionStyle(defaultCs) : null)
          const isFirst = idx === 0
          const isLast = idx === lastIdx
          return {
            _segmentId: seg.id,
            startMs,
            endMs: startMs + durMs,
            text: seg.text || '',
            wordTimings: wt,
            captionStyle: resolvedStyle,
            fadeInMs: crossfadeMs && !isFirst ? crossfadeMs : 0,
            fadeOutMs: crossfadeMs && !isLast ? crossfadeMs : 0,
          }
        }).filter(c => {
          // Job-level master switch wins — no cues regardless of
          // per-segment state.
          if (jobHideCaptions) return false
          if (!(c.text || c.wordTimings?.length)) return false
          // Per-segment hideCaption suppresses just that cue.
          const owner = perSegment.find(p => p.seg.id === c._segmentId)
          return !owner?.seg?.hideCaption
        })

        setAssets({
          mergedVideoUrl,
          segmentAudioUrls,
          cues,
          defaultCs,
          rawSegmentStyles: perSegment.map(({ cs }) => cs),  // for styleFp
          transition,
        })
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(e.message || String(e))
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [draftId, enabled, refetchKey])

  return { assets, loading, error }
}

// Matches the same helper inline in VoiceoverPanelV2 — caption_styles
// rows are snake_case on the wire, the composition expects camelCase.
function snakeToCamelCaptionStyle(cs) {
  if (!cs || typeof cs !== 'object') return null
  return {
    baseFontFamily: cs.base_font_family,
    baseFontColor: cs.base_font_color,
    baseFontSize: cs.base_font_size,
    activeWordColor: cs.active_word_color,
    activeWordFontFamily: cs.active_word_font_family,
    activeWordOutlineConfig: cs.active_word_outline_config,
    activeWordScalePulse: cs.active_word_scale_pulse || null,
    layoutConfig: cs.layout_config || null,
    entryAnimation: cs.entry_animation || null,
    exitAnimation: cs.exit_animation || null,
    revealConfig: cs.reveal_config || null,
    continuousMotion: cs.continuous_motion || null,
  }
}
