import { forwardRef, lazy, Suspense, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as api from '../../api'
import { useLivePreviewAssets } from '../lib/useLivePreviewAssets'
import { FontSizePreview } from '../../components/fonts/CaptionStyleEditor'
import First2sOverlay from './First2sOverlay'
import { buildDownloadName } from '../../lib/filename'
// Lazy-load the overlay so the caption-engine chunk (Remotion-era
// effect framework + preset registries) only loads for users who
// actually open a draft with voiceover — not on first paint. Plus
// the styleFp helper, loaded on-demand by useLivePreviewTelemetry.
const InlineCaptionOverlay = lazy(() => import('./InlineCaptionOverlay'))

/**
 * Final output preview — the single video/photo surface every v2 tool
 * attaches to. Exposes the internal `<video>` element via an imperative
 * handle so voiceover / overlay / etc panels can drive it without
 * owning their own player.
 *
 * Overlay preview: reads window._postyOverlays (seeded by OverlaysPanelV2)
 * and/or files[0]._overlaySettings (from restored job), and renders the
 * active overlay text (opening / middle / closing) on top of the video in
 * sync with currentTime. Not frame-perfect — timeupdate fires ~4–6×/sec,
 * same as the real-app behavior; the final burned-in ffmpeg render is
 * exact.
 *
 * Source priority:
 *   1. Merged video (window._postyMergedVideo.url)
 *   2. Single uploaded video's preview URL
 *   3. Photo carousel (all photos, onlyPhotos == true)
 *   4. Empty state
 */
const FinalPreviewV2 = forwardRef(function FinalPreviewV2({ files, restoredMergeUrl, draftId, jobSync }, ref) {
  const videoRef = useRef(null)
  const [mergedUrl, setMergedUrl] = useState(
    restoredMergeUrl || (typeof window !== 'undefined' ? window._postyMergedVideo?.url : null) || null
  )
  const [overlays, setOverlays] = useState(() => {
    if (typeof window !== 'undefined' && window._postyOverlays) return window._postyOverlays
    return null
  })
  const [teleprompter, setTeleprompter] = useState(() => {
    if (typeof window !== 'undefined' && window._postyTeleprompter) return window._postyTeleprompter
    return null
  })
  const [captions, setCaptions] = useState(() => {
    if (typeof window !== 'undefined' && Array.isArray(window._postyCaptions)) return window._postyCaptions
    return []
  })
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  // Live vertical-position override from the slider on the right edge
  // of the video. null = use whatever each cue's own caption_style
  // specifies (the saved state). A number = dragging the slider is
  // overriding every cue's verticalPosition visually. The slider
  // persists the value to the job default on release (debounced in
  // VerticalPositionSlider). Segments with their own row keep their
  // row's verticalPosition once the override clears on next fetch.
  const [vpOverride, setVpOverride] = useState(null)

  // Caption font-size override (px) — same pattern as vpOverride but
  // for default_caption_style.base_font_size. null before the slider
  // seeds itself from the saved default, a number once dragging. The
  // override gets injected into every cue's captionStyle.baseFontSize
  // by InlineCaptionOverlayWrapper so drag updates the overlay live
  // without waiting for a refetch.
  const [captionFontSizeOverride, setCaptionFontSizeOverride] = useState(null)

  // Sequential-playback preview mode. Array of { url, trimStart, trimEnd,
  // speed } — when set (and no real merged url exists), the video element
  // walks the list clip-by-clip, respecting trims + speed. Instant, no
  // server round-trip; hard cuts (no crossfades), no voiceover mix, no
  // overlay burn-in. The real Merge button still produces the final
  // file that actually gets posted.
  const [previewPlaylist, setPreviewPlaylist] = useState(() => {
    if (typeof window !== 'undefined' && Array.isArray(window._postyPreviewPlaylist)) return window._postyPreviewPlaylist
    return null
  })
  const playlistIdxRef = useRef(0)

  useImperativeHandle(ref, () => ({ getVideo: () => videoRef.current }), [])

  // Merge-change subscription
  useEffect(() => {
    const sync = () => setMergedUrl(window._postyMergedVideo?.url || null)
    window.addEventListener('posty-merge-change', sync)
    return () => window.removeEventListener('posty-merge-change', sync)
  }, [])

  // Preview-playlist subscription
  useEffect(() => {
    const sync = (e) => {
      const list = e?.detail ?? window._postyPreviewPlaylist ?? null
      setPreviewPlaylist(Array.isArray(list) && list.length > 0 ? list : null)
      playlistIdxRef.current = 0
    }
    window.addEventListener('posty-preview-playlist-change', sync)
    return () => window.removeEventListener('posty-preview-playlist-change', sync)
  }, [])

  // Overlay-change subscription
  useEffect(() => {
    const sync = (e) => setOverlays(e?.detail || window._postyOverlays || null)
    window.addEventListener('posty-overlay-change', sync)
    return () => window.removeEventListener('posty-overlay-change', sync)
  }, [])

  // Teleprompter-change subscription (active only while user is recording
  // with the teleprompter — not persisted to the burned-in video).
  useEffect(() => {
    const sync = (e) => setTeleprompter(e?.detail ?? window._postyTeleprompter ?? null)
    window.addEventListener('posty-teleprompter-change', sync)
    return () => window.removeEventListener('posty-teleprompter-change', sync)
  }, [])

  // Captions (closed-caption timeline) — separate from overlay blocks and
  // from teleprompter. Written by the Script tab's "Apply as closed
  // captions" action, rendered as subtitle-style text at the bottom.
  useEffect(() => {
    const sync = (e) => {
      const list = e?.detail ?? window._postyCaptions ?? null
      setCaptions(Array.isArray(list) ? list : [])
    }
    window.addEventListener('posty-captions-change', sync)
    return () => window.removeEventListener('posty-captions-change', sync)
  }, [])

  // Seed captions from the restored job's overlay_settings.caption_timeline
  // (same JSONB that overlays live in, different key).
  useEffect(() => {
    if (captions.length > 0) return
    const restored = files?.[0]?._overlaySettings?.caption_timeline
    if (Array.isArray(restored) && restored.length > 0) {
      setCaptions(restored)
      try { if (typeof window !== 'undefined') window._postyCaptions = restored } catch {}
    }
  }, [files, captions.length])

  // Seed overlays from the restored file's _overlaySettings when we don't
  // already have a window-level value (i.e. user hasn't opened Overlays yet
  // in this session, but the draft was loaded from the server).
  useEffect(() => {
    if (overlays) return
    const restored = files?.[0]?._overlaySettings
    if (restored && Object.keys(restored).length > 0) {
      setOverlays(restored)
      try { if (typeof window !== 'undefined') window._postyOverlays = restored } catch {}
    }
  }, [files, overlays])

  // Track video time / duration for overlay timing
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => setCurrentTime(v.currentTime || 0)
    const onDur  = () => setDuration(v.duration || 0)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('loadedmetadata', onDur)
    v.addEventListener('durationchange', onDur)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('loadedmetadata', onDur)
      v.removeEventListener('durationchange', onDur)
    }
  }, [mergedUrl]) // re-attach when source changes

  const videoFiles = (files || []).filter(f => f.file?.type?.startsWith('video/') || f._mediaType?.startsWith('video/'))
  const photoFiles = (files || []).filter(f => f.file?.type?.startsWith('image/') || f._mediaType?.startsWith('image/'))
  const onlyPhotos = files.length > 0 && videoFiles.length === 0 && photoFiles.length > 0

  let source = null
  if (mergedUrl) source = { type: 'video', url: mergedUrl }
  else if (previewPlaylist && previewPlaylist[0]?.url) source = { type: 'playlist', url: previewPlaylist[0].url }
  else if (videoFiles.length === 1 && videoFiles[0]._previewUrl) source = { type: 'video', url: videoFiles[0]._previewUrl }
  else if (onlyPhotos) source = { type: 'photo', urls: photoFiles.map(f => f._previewUrl).filter(Boolean) }

  // Sequential playback driver for the preview playlist. Respects each
  // clip's trim_start / trim_end / speed, advances on end-of-segment,
  // stops cleanly at the last clip.
  useEffect(() => {
    if (!previewPlaylist || !previewPlaylist.length) return
    const v = videoRef.current
    if (!v) return

    const playClip = (i) => {
      const clip = previewPlaylist[i]
      if (!clip) return
      playlistIdxRef.current = i
      if (v.src !== clip.url) {
        try { v.src = clip.url } catch {}
        try { v.load() } catch {}
      }
      const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1.0
      try { v.playbackRate = speed } catch {}
      const startAt = Number(clip.trimStart) || 0
      const onReady = () => {
        try { v.currentTime = startAt } catch {}
        try { const p = v.play(); if (p && p.catch) p.catch(() => {}) } catch {}
        v.removeEventListener('loadedmetadata', onReady)
        v.removeEventListener('canplay', onReady)
      }
      if (v.readyState >= 1 && v.src === clip.url) onReady()
      else {
        v.addEventListener('loadedmetadata', onReady, { once: true })
        v.addEventListener('canplay', onReady, { once: true })
      }
    }

    const advance = () => {
      const next = playlistIdxRef.current + 1
      if (next >= previewPlaylist.length) { try { v.pause() } catch {}; return }
      playClip(next)
    }

    const onTimeUpdate = () => {
      const clip = previewPlaylist[playlistIdxRef.current]
      if (!clip) return
      const end = (clip.trimEnd != null && clip.trimEnd > 0)
        ? Number(clip.trimEnd)
        : (Number.isFinite(v.duration) ? v.duration : Infinity)
      if (v.currentTime >= end - 0.05) advance()
    }
    const onEnded = () => advance()

    v.addEventListener('timeupdate', onTimeUpdate)
    v.addEventListener('ended', onEnded)

    // Kick off from the first clip when the playlist is first applied
    if (playlistIdxRef.current === 0 && (!v.src || v.src !== previewPlaylist[0].url)) {
      playClip(0)
    }

    return () => {
      v.removeEventListener('timeupdate', onTimeUpdate)
      v.removeEventListener('ended', onEnded)
    }
  }, [previewPlaylist])

  // Returns the active slot's plain text AND its rich runs (when set)
  // so OverlayText can render either form. Runs win when present;
  // text is the legacy / flattened fallback.
  const activeOverlay = useMemo(() => {
    if (!overlays) return null
    const t = currentTime
    const openDur   = Number(overlays.openingDuration)   || 0
    const midStart  = Number(overlays.middleStartTime)   || 0
    const midDur    = Number(overlays.middleDuration)    || 0
    const closeDur  = Number(overlays.closingDuration)   || 0
    // slot is the identifier the slider/OverlayText use to pick
    // up the slot-specific yPct (openingYPct / middleYPct /
    // closingYPct) — with fallback to overlayYPct when the slot
    // doesn't have its own override.
    if ((overlays.openingText || overlays.openingRuns?.length) && t < openDur) {
      return { text: overlays.openingText, runs: overlays.openingRuns || null, slot: 'opening' }
    }
    if ((overlays.middleText || overlays.middleRuns?.length) && t >= midStart && t < midStart + midDur) {
      return { text: overlays.middleText, runs: overlays.middleRuns || null, slot: 'middle' }
    }
    if ((overlays.closingText || overlays.closingRuns?.length) && duration > 0 && t >= duration - closeDur) {
      return { text: overlays.closingText, runs: overlays.closingRuns || null, slot: 'closing' }
    }
    return null
  }, [overlays, currentTime, duration])

  // Captions: active cue is the one whose [startTime, endTime) contains
  // currentTime. Uses the explicit endTime so a script line disappears
  // before the next begins (standard subtitle behavior).
  const activeCaptionText = useMemo(() => {
    if (!captions || captions.length === 0) return null
    const t = currentTime
    const cue = captions.find(c => (Number(c.startTime) || 0) <= t && t < (Number(c.endTime) || 0))
    return cue?.text || null
  }, [captions, currentTime])

  // Teleprompter: pick the active script line based on currentTime vs
  // segment startTimes. Primary shows from 0 until the first segment.
  const activeTeleprompterText = useMemo(() => {
    if (!teleprompter) return null
    const t = currentTime
    const segs = Array.isArray(teleprompter.segments) ? teleprompter.segments : []
    const sorted = [...segs].sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
    const firstSegStart = sorted[0]?.startTime ?? Infinity
    if (t < firstSegStart && teleprompter.primary) return teleprompter.primary
    let active = null
    for (const s of sorted) {
      if ((s.startTime || 0) <= t) active = s
      else break
    }
    return active?.text || teleprompter.primary || null
  }, [teleprompter, currentTime])

  // Sliders live OUTSIDE the video container now — they were
  // overlapping the <video controls> click surface and swallowing
  // play/pause/seek. Flex row with items-stretch makes both sliders
  // match the video's height without absolute positioning on top
  // of the video element. Visibility guards mirror where the
  // sliders' data paths apply (captions need a merged video + cues;
  // overlay slider needs some overlay text configured).
  const isVideoSource = source?.type === 'video' || source?.type === 'playlist'
  const showCaptionSlider = isVideoSource && draftId && mergedUrl
  const showOverlaySlider = isVideoSource && draftId && jobSync && (
    overlays?.openingText || overlays?.middleText || overlays?.closingText
  )

  return (
    <div className="w-[80%] mx-auto">
    <div className="flex items-stretch gap-2">
      {showOverlaySlider && (
        <OverlayPositionSlider
          overlays={overlays}
          activeSlot={activeOverlay?.slot || null}
          onChange={next => setOverlays(next)}
          jobSync={jobSync}
        />
      )}
    <div className="bg-black rounded-lg overflow-hidden relative aspect-[9/16] max-h-[56vh] flex-1 min-w-0">
      {!source ? (
        <div className="w-full h-full flex flex-col items-center justify-center text-white/70 p-6 text-center">
          <div className="text-[36px] mb-2">{onlyPhotos ? '📸' : '🎬'}</div>
          <div className="text-[13px] font-medium text-white">
            {files.length > 0 ? 'Merge your clips to see the preview' : 'No media uploaded yet'}
          </div>
          <div className="text-[11px] mt-1">
            {files.length > 0
              ? (videoFiles.length >= 2 ? 'Use the Clips tab to merge your videos.' : 'Upload more clips or photos in the Clips tab.')
              : 'Upload photos or videos in the Clips tab below.'}
          </div>
        </div>
      ) : source.type === 'video' || source.type === 'playlist' ? (
        <>
          <video
            ref={videoRef}
            src={source.type === 'playlist' ? undefined : source.url}
            controls
            playsInline
            className="w-full h-full object-contain bg-black"
            // Tagged so the Quill rich-text editor in OverlaysPanelV2
            // can find this element and measure its rendered width.
            // The editor uses width / 1080 to scale font sizes so
            // what's typed at "60px" displays at the same physical
            // pixel size on screen as a 60px overlay would in the
            // exported 1080-wide video. Without this anchor the
            // editor falls back to its own width which is usually
            // wider than the video, making editor text look bigger
            // than its rendered counterpart.
            data-posty-video-preview="true"
          />
          {mergedUrl && (
            <div className="absolute top-2 left-2 flex items-center gap-1.5 flex-wrap">
              <div className="text-[10px] text-white bg-[#2D9A5E]/80 rounded-full px-2 py-0.5 pointer-events-none">
                Merged
              </div>
              <DownloadButton url={mergedUrl} label="⬇ Raw merge" />
            </div>
          )}
          {source.type === 'playlist' && !mergedUrl && (
            <div className="absolute top-2 left-2 text-[10px] text-white bg-[#d97706]/85 rounded-full px-2 py-0.5 pointer-events-none">
              Preview · {(playlistIdxRef.current + 1)}/{previewPlaylist.length}
            </div>
          )}
          {activeOverlay && (
            <OverlayText text={activeOverlay.text} runs={activeOverlay.runs} slot={activeOverlay.slot} style={overlays} videoRef={videoRef} />
          )}
          {activeCaptionText && !teleprompter && (
            <CaptionText text={activeCaptionText} />
          )}
          {activeTeleprompterText && (
            <TeleprompterText text={activeTeleprompterText} />
          )}
          {/* Animated captions rendered directly over the merged video —
              no separate Player mount. Only activates when we have a
              merged video + a draftId + cues. Gracefully null-renders
              during the async fetch and when the job has no voiceover
              segments yet. */}
          {draftId && mergedUrl && (
            <>
              {/* Platform-safe caption zone. Captions inside this dashed
                  rectangle are visible on TikTok / Reels / Shorts
                  across their platform UIs. The slider can still travel
                  beyond these bounds if a tenant knows their platform
                  doesn't reserve that space. */}
              <div
                style={{
                  position: 'absolute',
                  top: '15%',
                  bottom: '28%',
                  left: '8%',
                  right: '8%',
                  border: '1.5px dashed rgba(255, 255, 255, 0.55)',
                  borderRadius: 4,
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
                aria-hidden="true"
              >
                <div
                  style={{
                    position: 'absolute',
                    top: -6,
                    left: 8,
                    padding: '0 6px',
                    fontSize: 9,
                    letterSpacing: 0.5,
                    color: 'rgba(255, 255, 255, 0.75)',
                    background: 'rgba(0, 0, 0, 0.55)',
                    borderRadius: 3,
                    fontFamily: 'system-ui, sans-serif',
                    lineHeight: '12px',
                  }}
                >SAFE AREA</div>
              </div>
              <Suspense fallback={null}>
                <InlineCaptionOverlayWrapper
                  draftId={draftId}
                  videoRef={videoRef}
                  verticalPositionOverride={vpOverride}
                  baseFontSizeOverride={captionFontSizeOverride}
                />
              </Suspense>
              {/* First-2-second analyzer overlays. Renders nothing
                  until the user runs the analyzer in the 🎯 First 2s
                  tab; toggles inside the panel control which sub-
                  layers (safe zones / score HUD / detection boxes /
                  clarity timeline) actually paint. */}
              <First2sOverlay videoEl={videoRef.current} />
            </>
          )}
        </>
      ) : (
        <PhotoCarousel urls={source.urls} overlays={overlays} />
      )}
    </div>
      {showCaptionSlider && (
        <VerticalPositionSlider
          draftId={draftId}
          value={vpOverride}
          onChange={setVpOverride}
        />
      )}
    </div>
    {/* Font-size controls row. Horizontal sliders distinct from the
        vertical position sliders above — changing font affects the
        JOB DEFAULT (captions) / job overlay settings, so every
        un-customized segment picks it up. */}
    {(showOverlaySlider || showCaptionSlider) && (
      <div className="flex gap-3 mt-2 items-center flex-wrap">
        {showOverlaySlider && (
          <OverlayFontSizeSlider
            overlays={overlays}
            onChange={next => setOverlays(next)}
            jobSync={jobSync}
          />
        )}
        {showCaptionSlider && (
          <CaptionFontSizeSlider
            draftId={draftId}
            value={captionFontSizeOverride}
            onChange={setCaptionFontSizeOverride}
          />
        )}
        {showCaptionSlider && (
          <ApplyCaptionToAllButton
            draftId={draftId}
            fontSize={captionFontSizeOverride}
            verticalPosition={vpOverride}
          />
        )}
      </div>
    )}
    </div>
  )
})

// Cascade the caption font + vertical-position slider values into
// every segment's caption_styles row. Without this, segments that
// had a preset applied earlier kept their row's baseFontSize /
// verticalPosition, so the slider looked like a no-op in the
// downloaded video even though the live preview showed the override.
// One POST handles both the default save and the cascade atomically.
function ApplyCaptionToAllButton({ draftId, fontSize, verticalPosition }) {
  const [state, setState] = useState('idle') // idle | working | done | error
  const [msg, setMsg] = useState('')
  const handle = async () => {
    if (state === 'working' || !draftId) return
    setState('working'); setMsg('')
    try {
      const body = {}
      if (typeof fontSize === 'number') body.base_font_size = fontSize
      if (typeof verticalPosition === 'number') body.vertical_position = verticalPosition
      const r = await api.cascadeJobDefaultCaptionStyle(draftId, body)
      const n = Number(r?.updated) || 0
      setMsg(n === 0
        ? 'No per-segment rows to update — default already applies to all'
        : `Applied to ${n} segment${n === 1 ? '' : 's'}`)
      setState('done')
      setTimeout(() => { setState('idle'); setMsg('') }, 2500)
    } catch (e) {
      setMsg(e?.message || 'Failed')
      setState('error')
      setTimeout(() => { setState('idle'); setMsg('') }, 3500)
    }
  }
  const label = state === 'working' ? 'Applying…'
    : state === 'done' ? `✓ ${msg}`
    : state === 'error' ? `Error: ${msg.slice(0, 60)}`
    : 'Apply to all segments'
  return (
    <button
      onClick={handle}
      disabled={state === 'working'}
      className="text-[10px] bg-[#f59e0b]/15 border border-[#f59e0b]/40 text-[#b45309] rounded px-2.5 py-1.5 cursor-pointer disabled:opacity-60 hover:bg-[#f59e0b]/25"
      title="Apply the caption font + vertical position sliders to every voiceover segment, including those with a preset row that would otherwise shadow the default."
    >{label}</button>
  )
}

// Closed-caption text — YouTube-style subtitle band at the very bottom.
// Distinct from OverlayText (three-block story text in the middle) and
// from TeleprompterText (high-contrast recording aid).
function CaptionText({ text }) {
  return (
    <div className="absolute inset-x-0 bottom-3 flex items-end justify-center pointer-events-none px-4">
      <div
        style={{
          background: 'rgba(0, 0, 0, 0.72)',
          color: '#ffffff',
          padding: '4px 10px',
          borderRadius: 4,
          fontSize: 16,
          lineHeight: 1.2,
          fontWeight: 500,
          maxWidth: '92%',
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          textShadow: '0 1px 2px rgba(0,0,0,0.6)',
        }}
      >
        {text}
      </div>
    </div>
  )
}

// Teleprompter text — amber-on-black panel centered for read-aloud
// comfort. Visually distinct from the YouTube-style closed captions
// (white-on-black, bottom) and from the story-overlay text (middle of
// screen, user-configured color) so there's no ambiguity about what you're
// looking at while recording. Includes a pulsing red "RECORDING · READ"
// tag so it reads as a recording aid, not a final output.
function TeleprompterText({ text }) {
  return (
    <div className="absolute inset-x-0 top-1/3 flex items-center justify-center pointer-events-none px-4">
      <div
        className="rounded-lg px-5 py-4 text-center"
        style={{
          background: 'rgba(20, 14, 0, 0.88)',
          border: '2px solid #ffc93c',
          fontSize: '28px',
          color: '#ffd86b',
          fontWeight: 700,
          lineHeight: 1.25,
          maxWidth: '96%',
          whiteSpace: 'pre-wrap',
          textShadow: '0 1px 2px rgba(0,0,0,0.9)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
        }}
      >
        {text}
      </div>
      <div
        className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded"
        style={{
          background: '#c0392b',
          color: '#fff',
          boxShadow: '0 0 0 2px rgba(255,255,255,0.15)',
          animation: 'pulse 1.6s ease-in-out infinite',
        }}
      >● Recording · Read</div>
    </div>
  )
}

function OverlayText({ text, runs, style, videoRef, slot }) {
  // Scale font/outline by the video's ACTUAL displayed rectangle (after
  // object-contain letterboxing) so the preview text size matches what
  // ffmpeg will burn into the 1080-wide output frame. Measuring the
  // container width is only correct when the video fills the container
  // exactly; for letterboxed sources (e.g. a 16:9 clip inside the 9:16
  // container before merge), we'd otherwise overshoot by the letterbox
  // margin.
  const wrapRef = useRef(null)
  const [scale, setScale] = useState(null)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const video = videoRef?.current
    if (!wrap) return

    const update = () => {
      // Container bounds (OverlayText's absolute wrapper spans the full
      // container width).
      const containerW = wrap.clientWidth || wrap.getBoundingClientRect().width
      if (!containerW) return

      // Intrinsic video dims — falls back to container size if the video
      // hasn't loaded metadata yet.
      const vw = Number(video?.videoWidth) || 0
      const vh = Number(video?.videoHeight) || 0
      const containerH = wrap.parentElement?.clientHeight || containerW * (16 / 9)

      let displayedW = containerW
      if (vw > 0 && vh > 0) {
        // object-contain: fit the video inside the container preserving
        // aspect. displayedW is the smaller of (containerW, containerH * aspect).
        const aspect = vw / vh
        const widthIfHeightBound = containerH * aspect
        displayedW = Math.min(containerW, widthIfHeightBound)
      }
      setScale(displayedW / 1080)
    }

    update()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    if (ro) {
      ro.observe(wrap)
      if (wrap.parentElement) ro.observe(wrap.parentElement)
    }
    window.addEventListener('resize', update)
    if (video) {
      video.addEventListener('loadedmetadata', update)
      video.addEventListener('resize', update)
    }
    return () => {
      if (ro) ro.disconnect()
      window.removeEventListener('resize', update)
      if (video) {
        video.removeEventListener('loadedmetadata', update)
        video.removeEventListener('resize', update)
      }
    }
  }, [videoRef])

  const rawFont = Number(style?.storyFontSize) || 48
  // Before first measurement, use a conservative fallback so text doesn't
  // flash at a wrong size on mount.
  const effectiveScale = scale != null ? scale : 0.3
  const fontSize = Math.max(8, rawFont * effectiveScale)
  // Per-slot color override — falls back to the global storyFontColor
  // when the slot doesn't carry its own. Same null = inherit pattern
  // as the per-slot Y. Legacy jobs (no `${slot}FontColor` keys)
  // render at the single global color exactly as before.
  const slotColorKey = slot ? `${slot}FontColor` : null
  const slotColorRaw = slotColorKey != null ? style?.[slotColorKey] : null
  const color = slotColorRaw || style?.storyFontColor || '#ffffff'
  // Default to Inter so the preview uses the same font the BE
  // export is now bundled with. With "sans-serif" the FE rendered
  // with macOS Helvetica (narrow) while the BE rendered with
  // ffmpeg's DejaVu Sans (wider) — same fontSize, very different
  // total width. Picking Inter on both ends keeps glyph widths in
  // sync so the preview's text width matches what the export will
  // burn in.
  const rawFamily = style?.storyFontFamily
  const family = (!rawFamily || rawFamily === 'sans-serif')
    ? 'Inter, system-ui, sans-serif'
    : rawFamily
  const rawOutline = style?.storyFontOutline === false ? 0 : Math.max(0, Number(style?.storyFontOutlineWidth) || 3)
  // Clamp scaled outline to >= 1px so the multi-direction text-shadow
  // produces pixel-crisp edges at preview scale instead of subpixel
  // blur. Without this, an outline of 3 × 0.3 = 0.9px landed on
  // sub-pixel offsets that browsers render as a soft glow — making
  // the preview look "fluffy" while the BE drew a crisp 3px border.
  const outlineWidth = rawOutline > 0 ? Math.max(1, rawOutline * effectiveScale) : 0
  const lineHeight = Number(style?.lineHeight) > 0 ? Number(style.lineHeight) : 1.1
  // Letter-spacing saved as a 0..5 step in the burn-in path; CSS uses em.
  // 0.05em per step matches the legacy ResultCard preview (see v1).
  const letterSpacingEm = (Number(style?.letterSpacing) || 0) * 0.05
  // Halo (soft drop-shadow + glow) — same intent as the captionEngine
  // CaptionLayer halo, applied to overlay text when the user enables
  // the "Halo behind text" toggle and the slot doesn't carry a box
  // background. Per-slot halo override beats the panel default; box
  // backgrounds suppress halo regardless (the box already provides
  // the contrast).
  const slotHaloKey = slot ? `${slot}Halo` : null
  const slotHaloRaw = slotHaloKey != null ? style?.[slotHaloKey] : null
  const haloEffective = typeof slotHaloRaw === 'boolean'
    ? slotHaloRaw
    : (style?.storyHalo !== false) // default on when undefined
  // Suppress halo when this slot has a box background.
  const slotBoxKeyForHalo = slot ? `${slot}Box` : null
  const slotBoxRawForHalo = slotBoxKeyForHalo ? style?.[slotBoxKeyForHalo] : null
  const slotHasBox = !!(slotBoxRawForHalo?.color || style?.storyBox?.color)
  const haloApplies = haloEffective && !slotHasBox
  // Build the halo shadow stack at the same intensity as the
  // CaptionLayer halo so caption + overlay halos look consistent.
  const haloFontSize = Math.max(8, rawFont)
  const haloShadow = haloApplies
    ? `0 ${Math.max(2, Math.round(haloFontSize * 0.06)) * effectiveScale}px ${Math.max(4, Math.round(haloFontSize * 0.12)) * effectiveScale}px rgba(0,0,0,0.9), 0 0 ${Math.max(8, Math.round(haloFontSize * 0.22)) * effectiveScale}px rgba(0,0,0,0.7), 0 0 ${Math.max(14, Math.round(haloFontSize * 0.34)) * effectiveScale}px rgba(0,0,0,0.45)`
    : null
  // Compose outline + halo. Outline takes precedence visually; halo
  // adds onto it. When neither is active, no shadow.
  const outlineShadow = outlineWidth > 0
    ? Array.from({ length: 8 }).map((_, i) => {
        const ang = (i / 8) * Math.PI * 2
        return `${Math.cos(ang) * outlineWidth}px ${Math.sin(ang) * outlineWidth}px 0 #000`
      }).join(', ')
    : null
  const shadow = (outlineShadow && haloShadow)
    ? `${outlineShadow}, ${haloShadow}`
    : (outlineShadow || haloShadow || 'none')

  // Match the burn-in pipeline's positioning math (lib/video.js
  // processStoryVideo). No platform-safe clamping — slider spans the
  // full frame so users can place overlays wherever they want. Only
  // the textBlock (fontSize×2.5) is subtracted at the bottom so long
  // captions don't fall off. yPos is the TOP of the text — render
  // uses drawtext's y= param which anchors top-of-glyph.
  // Per-slot Y override — slot can be 'opening' / 'middle' /
  // 'closing'. Each maps to {slot}YPct in overlay_settings; null/
  // undefined falls back to the global overlayYPct so legacy jobs
  // (no per-slot keys) render unchanged.
  const slotYKey = slot ? `${slot}YPct` : null
  const slotYRaw = slotYKey != null ? style?.[slotYKey] : null
  const pctSource = slotYRaw != null ? slotYRaw : style?.overlayYPct
  const pct = Math.max(0, Math.min(100, Number(pctSource ?? 50)))
  // Text-block height as % of container height. The container's
  // clientHeight is the live video element box; textBlock in PX =
  // fontSize × 2.5 (fontSize here is already scaled to the preview),
  // so the ratio matches what render computes against 1080.
  const containerHPx = wrapRef.current?.parentElement?.clientHeight || 0
  const textBlockPct = containerHPx > 0
    ? Math.min(50, (fontSize * 2.5 / containerHPx) * 100)
    : 10
  const maxY = Math.max(0, 100 - textBlockPct)
  const topPct = maxY * (pct / 100)

  // Render rich runs when supplied — each run becomes a styled span,
  // newlineAfter inserts a hard <br />. Run-level fields override the
  // overlay-level defaults; unset fields inherit. The outer block
  // owns the text-shadow / outline so the outline reads consistently
  // across runs of mixed colors. effectiveScale is shared so
  // per-run sizes scale the same way the overlay-level size does.
  const renderRichRuns = (runs) => {
    const elems = []
    runs.forEach((r, idx) => {
      const runColor = r.color ?? color
      const runFamily = r.fontFamily ?? family
      const runSize = (Number(r.fontSize) > 0 ? Number(r.fontSize) : rawFont) * effectiveScale
      elems.push(
        <span
          key={`r${idx}`}
          style={{
            color: runColor,
            fontFamily: runFamily,
            fontSize: `${Math.max(8, runSize)}px`,
            fontWeight: r.bold ? 800 : 700,
            fontStyle: r.italic ? 'italic' : 'normal',
            // Inline-block so per-run size doesn't collapse the line
            // height of the surrounding flow.
            display: 'inline-block',
            verticalAlign: 'baseline',
          }}
        >{r.text}</span>
      )
      if (r.newlineAfter && idx < runs.length - 1) {
        elems.push(<br key={`br${idx}`} />)
      } else if (idx < runs.length - 1) {
        // Visible inter-run space — same trick the captions engine uses
        // because adjacent inline-block spans collapse whitespace text
        // nodes in headless Chrome.
        elems.push(
          <span
            key={`sp${idx}`}
            aria-hidden="true"
            style={{ display: 'inline-block', width: '0.4em' }}
          >&nbsp;</span>
        )
      }
    })
    return elems
  }

  // Background box ("pill") behind the text — sourced from the slot's
  // override box if set, else the default storyBox. Falls back to no
  // box (empty rendering) when neither is set. Padding/cornerRadius
  // are scaled by the same effectiveScale as the font so the pill
  // looks proportional in the preview at any container size.
  const slotBoxKey = slot ? `${slot}Box` : null
  const slotBoxRaw = slotBoxKey ? style?.[slotBoxKey] : null
  const box = slotBoxRaw || style?.storyBox || null
  const boxBg = box?.color
    ? hexWithOpacity(box.color, typeof box.opacity === 'number' ? box.opacity : 1)
    : null
  const boxPaddingX = box?.paddingX != null ? Math.max(0, Number(box.paddingX)) * effectiveScale : 0
  const boxPaddingY = box?.paddingY != null ? Math.max(0, Number(box.paddingY)) * effectiveScale : 0
  const boxRadius = box?.cornerRadius != null ? Math.max(0, Number(box.cornerRadius)) * effectiveScale : 0

  // CSS layout note: the OverlayText used to use a flex parent
  // (`flex items-start justify-center`) to center its child. That
  // works for plain text, but it breaks the inline-block box pattern
  // we rely on for pill backgrounds — per CSS spec, flex children
  // have their `display` blockified, so `display: inline-block` is
  // treated as `display: block` and the background stretches the
  // full flex-item width (a banner, not a pill).
  //
  // Mirroring the captionEngine CaptionLayer wrapper pattern fixes
  // it: a plain block-level wrapper with `text-align: center` lets
  // an inline-block child shrink to its content and center itself
  // naturally via the inherited text-align rule.
  return (
    <div
      ref={wrapRef}
      className="absolute inset-x-0 pointer-events-none px-4 text-center"
      style={{ top: `${topPct}%` }}
    >
      <div
        style={{
          // Block-style intrinsic sizing — text-align: center on this
          // wrapper centers the inline-block child below.
          textAlign: 'center',
          maxWidth: '95%',
          marginLeft: 'auto',
          marginRight: 'auto',
        }}
      >
        <span
          style={{
            // inline-block on the text+pill so the background hugs
            // text + padding and the wrapper's text-align centers it.
            display: 'inline-block',
            fontSize: `${fontSize}px`,
            color,
            fontFamily: family,
            textShadow: shadow,
            fontWeight: 700,
            lineHeight,
            letterSpacing: letterSpacingEm ? `${letterSpacingEm}em` : 'normal',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
            // Box / pill background — only rendered when a box config
            // is set (default storyBox or per-slot {slot}Box).
            ...(boxBg
              ? {
                  background: boxBg,
                  padding: `${boxPaddingY}px ${boxPaddingX}px`,
                  borderRadius: `${boxRadius}px`,
                  // Drop the text-shadow when on a pill background —
                  // it muddies the contrast against the bright box.
                  textShadow: 'none',
                }
              : null),
          }}
        >
          {Array.isArray(runs) && runs.length > 0 ? renderRichRuns(runs) : text}
        </span>
      </div>
    </div>
  )
}

// Convert a #rrggbb-or-named CSS color to rgba(...) with the given
// alpha. Falls back to the original string when the input isn't a
// recognized hex; browsers will best-effort parse it.
function hexWithOpacity(hex, alpha) {
  const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1))
  if (typeof hex !== 'string') return hex
  const s = hex.trim()
  if (s.startsWith('#') && (s.length === 7 || s.length === 4)) {
    const norm = s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s
    const r = parseInt(norm.slice(1, 3), 16)
    const g = parseInt(norm.slice(3, 5), 16)
    const b = parseInt(norm.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${a})`
  }
  return s
}

// Live preview of lib/image.renderImageFinal — must stay in sync with
// the backend formula so what the user sees here is what the
// downloaded JPG looks like. Positions the text with the same full-
// frame range + top-of-text anchor, scales fontSize by
// containerWidth/1080, and uses an SVG stroke for outline
// (paint-order=stroke) matching the backend's stroke-width = 2×
// outlineWidth rule.
function PhotoOverlayPreview({ overlays }) {
  const wrapRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = wrapRef.current?.parentElement
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const openingText = overlays?.openingText ?? overlays?.opening_text ?? null
  if (!openingText || !String(openingText).trim()) {
    return <div ref={wrapRef} style={{ display: 'none' }} />
  }
  if (size.w === 0) return <div ref={wrapRef} style={{ display: 'none' }} />

  const widthScale = size.w / 1080
  const rawFont = Number(overlays?.storyFontSize ?? overlays?.font_size) || 48
  const scaledFontSize = Math.max(10, rawFont * widthScale)
  const color = overlays?.storyFontColor ?? overlays?.font_color ?? '#ffffff'
  const family = overlays?.storyFontFamily ?? overlays?.font_family ?? 'sans-serif'
  const hasOutline = overlays?.storyFontOutline !== false && overlays?.font_outline !== false
  const rawOutlineWidth = Number(overlays?.storyFontOutlineWidth ?? overlays?.font_outline_width) || 3
  const outlineWidth = hasOutline ? Math.max(1, rawOutlineWidth * widthScale) : 0
  const lineHeightMultiplier = Number(overlays?.lineHeight ?? overlays?.line_height) > 0
    ? Number(overlays?.lineHeight ?? overlays?.line_height)
    : 1.3
  const letterSpacingEm = (Number(overlays?.letterSpacing ?? overlays?.letter_spacing) || 0) * 0.05

  // Match backend line-wrap heuristic (lib/image.renderImageFinal).
  const approxCharWidth = scaledFontSize * 0.55
  const usableWidth = size.w * 0.9
  const maxLineChars = Math.max(14, Math.floor(usableWidth / approxCharWidth))
  const words = String(openingText).trim().split(/\s+/)
  const lines = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxLineChars && cur) { lines.push(cur); cur = w }
    else cur = (cur + ' ' + w).trim()
  }
  if (cur) lines.push(cur)

  const lineHeightPx = scaledFontSize * lineHeightMultiplier
  const textBlockH = lines.length * lineHeightPx
  const pct = Math.max(0, Math.min(100, Number(overlays?.overlayYPct ?? overlays?.overlay_y_pct) || 70))
  const maxTop = Math.max(0, size.h - textBlockH)
  const yTop = maxTop * (pct / 100)

  // SVG stroke for outline so the look matches the downloaded JPG.
  // Shadow from 8-way text-shadow is the fallback when outline is off.
  const shadow = outlineWidth === 0
    ? Array.from({ length: 8 }).map((_, i) => {
        const ang = (i / 8) * Math.PI * 2
        return `${Math.cos(ang) * 2}px ${Math.sin(ang) * 2}px 0 rgba(0,0,0,0.55)`
      }).join(', ')
    : 'none'

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
    >
      <div
        style={{
          position: 'absolute',
          top: `${yTop}px`,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontFamily: family,
          fontWeight: 700,
          lineHeight: lineHeightMultiplier,
        }}
      >
        {lines.map((line, i) => (
          <div key={i} style={{ position: 'relative', height: `${lineHeightPx}px`, lineHeight: `${lineHeightPx}px` }}>
            {outlineWidth > 0 && (
              <svg
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible' }}
              >
                <text
                  x="50%"
                  y={scaledFontSize}
                  textAnchor="middle"
                  fontFamily={family}
                  fontWeight="700"
                  fontSize={scaledFontSize}
                  fill={color}
                  stroke="#000"
                  strokeWidth={outlineWidth * 2}
                  paintOrder="stroke"
                  strokeLinejoin="round"
                  letterSpacing={letterSpacingEm ? `${letterSpacingEm}em` : undefined}
                >{line}</text>
              </svg>
            )}
            {outlineWidth === 0 && (
              <span style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                fontSize: `${scaledFontSize}px`, color, textShadow: shadow,
                letterSpacing: letterSpacingEm ? `${letterSpacingEm}em` : 'normal',
              }}>{line}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function PhotoCarousel({ urls, overlays }) {
  const [idx, setIdx] = useState(0)
  if (urls.length === 0) return null
  return (
    <>
      <img src={urls[idx]} alt="" className="w-full h-full object-cover" />
      {/* Preview the same openingText burn-in that renderImageFinal
          produces on download — per-photo, matches the backend
          formula exactly (full-frame Y range, fontSize at 1080 ref
          width, SVG stroke outline). Only renders when there's
          opening text; middle/closing are time-based and don't apply
          to static photos. */}
      <PhotoOverlayPreview overlays={overlays} />
      {urls.length > 1 && (
        <>
          <button
            onClick={() => setIdx(i => Math.max(0, i - 1))}
            disabled={idx === 0}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 text-white border-none cursor-pointer disabled:opacity-30"
          >‹</button>
          <button
            onClick={() => setIdx(i => Math.min(urls.length - 1, i + 1))}
            disabled={idx === urls.length - 1}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 text-white border-none cursor-pointer disabled:opacity-30"
          >›</button>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1">
            {urls.map((_, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === idx ? 'bg-white' : 'bg-white/40'}`} />
            ))}
          </div>
          <div className="absolute top-2 left-2 text-[10px] text-white bg-[#2D9A5E]/80 rounded-full px-2 py-0.5 pointer-events-none">
            Carousel · {idx + 1} / {urls.length}
          </div>
        </>
      )}
    </>
  )
}

// Download the merged video. On mobile (with Web Share API + file support,
// e.g. iOS Safari, Android Chrome) we open the native share sheet so the
// user can pick "Save Video" / "Save to Photos". On desktop we trigger a
// normal save dialog via an <a download>. If CORS blocks the blob fetch we
// fall back to opening the URL in a new tab so the user can long-press /
// right-click → Save As.
export function DownloadButton({ url, label: idleLabel = '⬇ Download' }) {
  const [state, setState] = useState('idle') // idle | working | done | error
  const handle = async () => {
    if (state === 'working') return
    setState('working')
    try {
      const res = await fetch(url, { credentials: 'omit' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const type = blob.type || 'video/mp4'
      const ext = type.includes('webm') ? 'webm' : type.includes('quicktime') ? 'mov' : 'mp4'
      const filename = `posty-${Date.now()}.${ext}`
      const file = new File([blob], filename, { type })

      // Prefer Web Share API with files (iOS / Android). navigator.share
      // alone isn't enough — it must support sharing files specifically,
      // which canShare({ files }) gates.
      const canShareFiles = typeof navigator !== 'undefined'
        && typeof navigator.canShare === 'function'
        && navigator.canShare({ files: [file] })
      if (canShareFiles) {
        try {
          await navigator.share({ files: [file], title: 'Posty video' })
          setState('done')
          setTimeout(() => setState('idle'), 1500)
          return
        } catch (shareErr) {
          // User cancelled, or share failed — fall through to anchor save.
          if (shareErr?.name === 'AbortError') { setState('idle'); return }
        }
      }

      // Desktop (and mobile fallback): anchor-click save dialog.
      const objUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      setTimeout(() => { try { URL.revokeObjectURL(objUrl); a.remove() } catch {} }, 1500)
      setState('done')
      setTimeout(() => setState('idle'), 1500)
    } catch (e) {
      // CORS or network — open in a new tab as a last resort so the user
      // can save manually.
      try { window.open(url, '_blank', 'noopener') } catch {}
      setState('error')
      setTimeout(() => setState('idle'), 2500)
    }
  }
  const label = state === 'working' ? 'Preparing…'
    : state === 'done' ? 'Ready'
    : state === 'error' ? 'Opened — save manually'
    : idleLabel
  return (
    <button
      onClick={handle}
      disabled={state === 'working'}
      className="text-[10px] text-white bg-[#6C5CE7]/90 hover:bg-[#6C5CE7] rounded-full px-2.5 py-0.5 border-none cursor-pointer disabled:opacity-60"
      title="Save the merged video to your device. On phones, uses the share sheet so you can Save to Photos."
    >{label}</button>
  )
}

// Download the "final" composition — merged video with overlays, closed
// captions, and voiceover all burned in.
//
// Two-tap flow so the mobile share sheet gets a live user gesture:
//   Tap 1 (idle → rendering → ready): call /post/render-final, fetch the
//          resulting mp4 into a Blob, stash it in state.
//   Tap 2 (ready → saving → done):   call navigator.share (mobile) or
//          trigger an <a download> (desktop) *synchronously* inside the
//          click handler. iOS Safari otherwise rejects the share because
//          the 4–6s render would expire the original user activation.
export function DownloadFinalButton({ draftId, jobSync, files }) {
  const [state, setState] = useState('idle') // idle | rendering | ready | saving | done | error
  const [msg, setMsg] = useState('')
  // Stores EACH final as a {blob, filename} pair so multi-photo
  // carousels (N JPGs) can save/share all items, not just the first.
  // Single-video / single-photo jobs end up with a 1-element array.
  const filesRef = useRef([])

  // Pick share vs save by DEVICE (touch-primary = mobile → share sheet;
  // everything else → save dialog). Desktop Chrome's canShare({files})
  // returns true on macOS/Win10+ because the OS has a share sheet, so a
  // capability check incorrectly routes desktop users into share mode.
  // The UX we want: "save a file on computer, share sheet on phone."
  const isMobileDevice = typeof navigator !== 'undefined' && (
    // Chrome's UA-CH — cleanest signal when available
    navigator.userAgentData?.mobile === true
    // Touch-primary + small screen: covers iOS Safari + Android non-Chromium
    || (typeof window !== 'undefined'
        && window.matchMedia('(pointer: coarse)').matches
        && Math.min(window.innerWidth, window.innerHeight) < 900)
    // UA substring fallback for older WebKit reporting
    || /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent || '')
  );
  // Share path still needs the API to exist on mobile. If the OS/browser
  // doesn't support file-share (ancient Android), fall through to save.
  const canMobileShare = isMobileDevice
    && typeof navigator !== 'undefined'
    && typeof navigator.canShare === 'function'
    && (() => {
      try { return navigator.canShare({ files: [new File([new Blob()], 'x.mp4', { type: 'video/mp4' })] }) }
      catch { return false }
    })()

  const renderAndStage = async () => {
    setState('rendering'); setMsg('')
    try {
      // Flush the 800ms debounced overlay/voiceover/hint saves BEFORE
      // the render reads the job from the DB. Without this, a user who
      // dragged the overlay font/position sliders and clicked Download
      // within 800 ms would render against stale overlay_settings and
      // the download would show the old values despite the preview
      // showing the new ones.
      try { await jobSync?.flushPendingSave?.() } catch { /* render anyway */ }

      // Grab in-memory primary voice if the user generated it this session.
      let primaryBase64 = null
      try {
        const primaryEl = document.querySelector('audio[data-posty-primary-voice]')
        if (primaryEl?.src) {
          const r = await fetch(primaryEl.src)
          const b = await r.blob()
          const buf = new Uint8Array(await b.arrayBuffer())
          let bin = ''
          for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
          primaryBase64 = btoa(bin)
        }
      } catch { /* server-side primary still works */ }

      const r = await api.renderFinal({ jobUuid: draftId, primaryAudioBase64: primaryBase64 })
      // Tell any audio-mix-log listeners about the response so they
      // can render the BE's actual mix_log (every audio source the
      // server pushed into voSegInputs, in order). This is the
      // ground truth — what the FE THINKS will mix can diverge from
      // what the server ACTUALLY mixes.
      try {
        window.dispatchEvent(new CustomEvent('posty-render-final-result', {
          detail: {
            draftId,
            mixLog: r?.mix_log || [],
            tookMs: r?.took_ms || null,
            applied: r?.applied || null,
            // Final mp4/jpg URLs the BE just rendered. ChannelsPanelV2
            // listens so the TikTok / GBP rows can show "Copy file URL"
            // for manual upload to platforms that don't have a posting
            // API (or where ours has been flaky). Stays in this event
            // because nothing else needs it cross-cutting.
            urls: Array.isArray(r?.final_urls) && r.final_urls.length
              ? r.final_urls
              : (r?.final_url ? [r.final_url] : []),
          },
        }))
      } catch {}
      const urls = Array.isArray(r?.final_urls) && r.final_urls.length
        ? r.final_urls
        : (r?.final_url ? [r.final_url] : [])
      if (urls.length === 0) throw new Error('Server returned no final URL')

      // Fetch each render sequentially so a slow first item doesn't
      // stall the whole thing if it fails mid-way — each success is
      // appended, errors abort the rest.
      // Pick the source for the download base name: the first file
      // with a job_name set, else the first file overall. buildDownloadName
      // sanitizes for Windows/macOS-illegal characters and falls back
      // to "posty-video" if no usable name is found.
      const fileForName = (Array.isArray(files) && files.length)
        ? (files.find(f => f && (f.job_name || f.captions?.job_name)) || files[0])
        : null
      // Pull the job description (hint_text "brief" portion) so the
      // saved filename combines the job name and a short description
      // slug — the user wanted both, not just the name. Failures here
      // gracefully degrade to name-only, so a slow /jobs lookup never
      // blocks the download.
      let descriptionForName = ''
      try {
        const jobNow = await api.getJob(draftId)
        descriptionForName = jobNow?.hint_text || ''
      } catch { /* fall through with empty desc */ }
      const collected = []
      for (let i = 0; i < urls.length; i++) {
        const u = urls[i]
        const vres = await fetch(u, { credentials: 'omit' })
        if (!vres.ok) throw new Error(`Download failed (${vres.status}) for item ${i + 1}/${urls.length}`)
        const blob = await vres.blob()
        const t = (blob.type || '').toLowerCase()
        const ext = t.includes('jpeg') || t.includes('jpg') ? 'jpg'
          : t.includes('png') ? 'png'
          : t.includes('webm') ? 'webm'
          : t.includes('quicktime') ? 'mov'
          : 'mp4'
        // Zero-pad the index when multi-item so a file manager sorts
        // them in order (job-name-final-01-of-03.jpg before -02-of-03.jpg).
        const suffix = urls.length > 1
          ? `final-${String(i + 1).padStart(2, '0')}-of-${String(urls.length).padStart(2, '0')}`
          : 'final'
        collected.push({ blob, filename: buildDownloadName(fileForName, suffix, ext, descriptionForName) })
      }
      filesRef.current = collected
      setState('ready')
    } catch (e) {
      setMsg(e.message || String(e))
      setState('error')
      setTimeout(() => { setState('idle'); setMsg('') }, 4000)
    }
  }

  // Runs synchronously inside the click handler so the user gesture
  // survives. Multi-photo carousels fan out either to a single
  // multi-file share sheet (iOS/Android both support files: [..N])
  // or to sequential anchor-click saves on desktop.
  const shareOrSave = () => {
    const list = filesRef.current
    if (!list || list.length === 0) { setState('idle'); return }
    const fileObjects = list.map(({ blob, filename }) => new File([blob], filename, { type: blob.type || 'application/octet-stream' }))

    if (canMobileShare) {
      setState('saving')
      // iOS 15+ and recent Chrome/Android accept multi-file share.
      // canShare gates compatibility; fall back to the first file if
      // the OS rejects the whole array.
      const canMultiShare = typeof navigator.canShare === 'function' && (() => {
        try { return navigator.canShare({ files: fileObjects }) } catch { return false }
      })()
      const payload = canMultiShare ? fileObjects : [fileObjects[0]]
      navigator.share({ files: payload, title: 'Posty' })
        .then(() => { setState('done'); setTimeout(() => setState('idle'), 1500) })
        .catch(err => {
          if (err?.name === 'AbortError') {
            setState('ready')
          } else {
            setMsg(err?.message || 'Share failed'); setState('error')
            setTimeout(() => { setState('ready'); setMsg('') }, 3000)
          }
        })
      return
    }

    // Desktop: anchor-click each file inside the live gesture. Browsers
    // sometimes bundle rapid same-origin downloads into a single prompt;
    // stagger by a few ms so each gets its own save dialog entry.
    try {
      list.forEach(({ blob, filename }, i) => {
        const objUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = objUrl
        a.download = filename
        document.body.appendChild(a)
        // Stagger per-item downloads so the browser doesn't throttle
        // or coalesce them.
        setTimeout(() => {
          try { a.click() } catch {}
          setTimeout(() => { try { URL.revokeObjectURL(objUrl); a.remove() } catch {} }, 1500)
        }, i * 250)
      })
      setState('done')
      setTimeout(() => setState('idle'), 1500 + list.length * 250)
    } catch (e) {
      setMsg(e.message || 'Save failed'); setState('error')
      setTimeout(() => { setState('ready'); setMsg('') }, 3000)
    }
  }

  const handleClick = () => {
    if (state === 'rendering' || state === 'saving') return
    if (state === 'ready') { shareOrSave(); return }
    // idle, error, done — kick off a fresh render
    filesRef.current = []
    renderAndStage()
  }

  const count = filesRef.current?.length || 0
  const countLabel = count > 1 ? ` (${count})` : ''
  const label = state === 'rendering' ? 'Rendering final…'
    : state === 'saving' ? (canMobileShare ? 'Opening share sheet…' : 'Saving…')
    : state === 'ready' ? (canMobileShare ? `📤 Tap again to share${countLabel}` : `⬇ Tap again to save${countLabel}`)
    : state === 'done' ? '✓ Saved'
    : state === 'error' ? (msg ? `Error: ${msg.slice(0, 80)} — tap to retry` : 'Error — tap to retry')
    : '⬇ Download final'
  const disabled = state === 'rendering' || state === 'saving'
  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className="w-full py-2.5 bg-[#2D9A5E] text-white text-[12px] font-medium border-none rounded cursor-pointer disabled:opacity-60"
      title="Renders overlays + captions + voiceover into the merged video. Takes 4–30s. Tap once to render, again to save or share."
    >{label}</button>
  )
}

// Thin shell: pulls caption assets for the current draft, then mounts
// InlineCaptionOverlay over the main <video> (via videoRef.current).
// Split out so the assets fetch only runs when this sub-tree mounts,
// and so the Suspense boundary at the caller only covers the lazy
// InlineCaptionOverlay chunk (assets fetch uses regular React state).
function InlineCaptionOverlayWrapper({ draftId, videoRef, verticalPositionOverride, baseFontSizeOverride }) {
  const { assets } = useLivePreviewAssets(draftId, { enabled: true })
  const videoEl = videoRef.current
  // Step-4 telemetry — fires [preview-log] with preview:"live" each
  // time the assembled config fingerprint changes. Replaces the log
  // that used to fire from LivePreviewPlayer's onReady in
  // CaptionedPreviewFold (retired in this commit).
  useLivePreviewTelemetry(draftId, assets)
  // No cues → nothing to paint. Don't even mount the overlay, so the
  // caption-engine chunk stays idle (still lazy-loaded at module
  // level — it's reached the network but no clock runs yet).
  if (!assets?.cues?.length || !videoEl) return null

  // Inject live overrides from the in-video sliders into every cue's
  // captionStyle so dragging updates the overlay immediately. Purely
  // visual — the saved per-segment styles are untouched until the
  // slider's debounced save runs against the job default.
  const hasOverrides = verticalPositionOverride != null || baseFontSizeOverride != null
  const cues = hasOverrides
    ? assets.cues.map(cue => {
        const nextLayout = verticalPositionOverride != null
          ? {
              ...(cue.captionStyle?.layoutConfig || {}),
              verticalPosition: verticalPositionOverride,
            }
          : cue.captionStyle?.layoutConfig
        return {
          ...cue,
          captionStyle: {
            ...(cue.captionStyle || {}),
            ...(baseFontSizeOverride != null ? { baseFontSize: baseFontSizeOverride } : {}),
            layoutConfig: nextLayout,
          },
        }
      })
    : assets.cues

  return <InlineCaptionOverlay videoEl={videoEl} cues={cues} />
}

// Vertical slider mounted on the right edge of the video container.
// Drag up = caption moves toward top (low verticalPosition value);
// drag down = caption moves toward bottom (high value). Keeps the
// mapping direct, which is the whole point of putting the control
// next to the preview instead of buried in the CaptionStyleEditor.
//
// Fetches the current job default verticalPosition on mount to seed
// the slider. Writes back to the job default (debounced) via
// saveJobDefaultCaptionStyle; in-flight value is held in the parent's
// state so the overlay re-renders live during the drag.
function VerticalPositionSlider({ draftId, value, onChange }) {
  const [defaultLoaded, setDefaultLoaded] = useState(false)
  const [baseConfig, setBaseConfig] = useState(null)  // the other job-default fields we need to preserve when saving
  const saveTimerRef = useRef(null)

  // Initial load: pull the job default so we know both the starting
  // verticalPosition AND the rest of the config we need to preserve
  // when the slider writes back.
  useEffect(() => {
    if (!draftId) return
    let cancelled = false
    api.getJobDefaultCaptionStyle(draftId).then(r => {
      if (cancelled) return
      const cs = r?.caption_style || null
      setBaseConfig(cs)
      const vp = cs?.layout_config?.verticalPosition
      // Slider starts at either the saved value or the aspect-ratio
      // default (72% on 9:16). Local value is null until the user
      // drags, so InlineCaptionOverlayWrapper lets the per-cue
      // captionStyle values show through unchanged.
      setDefaultLoaded(true)
      // Seed the parent state only if the job has a saved vp — don't
      // stomp local drag state that may already exist.
      if (typeof vp === 'number') {
        onChange(vp)
      }
    }).catch(() => setDefaultLoaded(true))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId])

  // Cleanup timer on unmount so we don't fire a stale save.
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
  }, [])

  // The rotated slider uses its parent's HEIGHT as its effective
  // "length" after the CSS transform rotates it 90°. Because the
  // input element keeps its own pre-rotation dimensions (width=the
  // long edge, height=the thumb thickness), we set its width to
  // equal the available vertical space — a ResizeObserver on the
  // flex cell tells us how much that is. Without this, the slider
  // renders at its default ~100px length no matter how tall the
  // video is.
  //
  // Hooks must run unconditionally on every render (rules of hooks),
  // so this block sits ABOVE the `if (!defaultLoaded) return null`
  // early-return below. Ordering by hook call order — not by when
  // the effect is visually used — is what React requires.
  const sliderHostRef = useRef(null)
  const [sliderLengthPx, setSliderLengthPx] = useState(0)
  useEffect(() => {
    const el = sliderHostRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.height > 0) setSliderLengthPx(r.height)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [defaultLoaded])

  const scheduleSave = (nextValue) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      // Merge the slider value into the existing default's
      // layout_config so other fields (textEffect, highlighter,
      // backgroundType, etc.) survive. When there's no base config
      // yet (no job default set), create a minimal one.
      const existingLayout = baseConfig?.layout_config || {}
      const nextLayout = { ...existingLayout, verticalPosition: nextValue }
      const body = {
        // Preserve every other whitelisted field from the current
        // default, so the save doesn't reset font / color / effects
        // back to nothing.
        base_font_family: baseConfig?.base_font_family,
        base_font_color: baseConfig?.base_font_color,
        base_font_size: baseConfig?.base_font_size,
        active_word_color: baseConfig?.active_word_color,
        active_word_font_family: baseConfig?.active_word_font_family,
        active_word_outline_config: baseConfig?.active_word_outline_config,
        active_word_scale_pulse: baseConfig?.active_word_scale_pulse,
        entry_animation: baseConfig?.entry_animation,
        exit_animation: baseConfig?.exit_animation,
        reveal_config: baseConfig?.reveal_config,
        continuous_motion: baseConfig?.continuous_motion,
        layout_config: nextLayout,
      }
      api.saveJobDefaultCaptionStyle(draftId, body)
        .then(() => setBaseConfig({ ...(baseConfig || {}), layout_config: nextLayout }))
        .catch(() => { /* silent — local state still reflects user intent */ })
      // Cascade the new verticalPosition into every per-segment
      // caption_styles row too. Without this, segments that already
      // have a row would shadow the default and the export would
      // render at the aspect-ratio fallback (72%) — the live preview
      // showed it at the slider value but the downloaded mp4 didn't.
      api.cascadeJobDefaultCaptionStyle(draftId, { vertical_position: nextValue })
        .catch(() => { /* silent */ })
    }, 300)
  }

  if (!defaultLoaded) return null

  const current = value != null ? value : 72

  return (
    <div
      // Flex sibling of the video (caller wraps everything in an
      // items-stretch flex row). alignSelf:stretch makes the slider
      // match the video's height; flexShrink:0 keeps its 30px width
      // stable. No position:absolute — this used to overlay the
      // video and block the native <video controls> click surface.
      style={{
        width: 30,
        alignSelf: 'stretch',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 0',
        background: 'rgba(0,0,0,0.32)',
        borderRadius: 15,
        userSelect: 'none',
      }}
      title={`Caption vertical position — ${Math.round(current)}%`}
    >
      {/* Top marker: drag the thumb here to move captions toward the
          top of the frame. */}
      <div style={{
        color: 'rgba(255,255,255,0.9)',
        fontSize: 10,
        lineHeight: 1,
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12 }}>▲</span>
        <span style={{ fontSize: 7, letterSpacing: 0.5 }}>TOP</span>
      </div>

      {/* Rotated slider fills all remaining vertical space. We measure
          its host's pixel height and set the input's width to that so
          the rotated element actually spans top-to-bottom. */}
      <div
        ref={sliderHostRef}
        style={{
          flex: 1,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {sliderLengthPx > 0 && (
          <input
            type="range"
            min={5}
            max={95}
            step={1}
            value={current}
            onChange={e => {
              const v = Number(e.target.value)
              onChange(v)
              scheduleSave(v)
            }}
            // rotate 90deg renders the natural left→right slider as
            // top→bottom. Min (5) ends up at the top, max (95) at
            // the bottom — matching "drag up = caption up" intent.
            style={{
              transform: 'rotate(90deg)',
              transformOrigin: 'center center',
              width: sliderLengthPx,
              height: 8,
              cursor: 'ns-resize',
              accentColor: '#f59e0b',
            }}
            aria-label="Caption vertical position"
          />
        )}
      </div>

      {/* Bottom marker — drag thumb here = captions at the bottom. */}
      <div style={{
        color: 'rgba(255,255,255,0.9)',
        fontSize: 10,
        lineHeight: 1,
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 7, letterSpacing: 0.5 }}>BOT</span>
        <span style={{ fontSize: 12 }}>▼</span>
      </div>
    </div>
  )
}

// Posts [preview-log] with preview:"live" via /log/preview-view when
// the assembled style config fingerprint changes. Lives here (not in
// useLivePreviewAssets) so assets can be consumed by components that
// don't need telemetry and so test-page mounts don't ping the log.
function useLivePreviewTelemetry(draftId, assets) {
  const lastFpRef = useRef(null)
  useEffect(() => {
    if (!draftId || !assets?.cues?.length) return
    let cancelled = false
    ;(async () => {
      try {
        const { hashStyleSet } = await import('../lib/styleFp')
        const styleFp = await hashStyleSet(
          assets.rawSegmentStyles || [],
          assets.defaultCs || null,
          { segmentTransition: assets.transition || null },
        )
        if (cancelled) return
        if (lastFpRef.current === styleFp) return  // same config, already logged
        lastFpRef.current = styleFp
        api.logPreviewView({
          jobUuid: draftId,
          styleFp,
          cueCount: assets.cues.length,
          latencyMs: 0,
        })
      } catch { /* telemetry never breaks preview */ }
    })()
    return () => { cancelled = true }
  }, [draftId, assets])
}

// Same UX as VerticalPositionSlider (right edge, for captions) but
// wired to overlay_settings.overlayYPct and mounted on the LEFT
// edge so the two controls are visually distinct. Persists via
// jobSync.saveOverlaySettings (which debounces internally) and
// updates FinalPreviewV2's overlays state optimistically so the
// OverlayText component re-renders with the new Y during drag.
function OverlayPositionSlider({ overlays, activeSlot, onChange, jobSync }) {
  // Measure vertical space available for the rotated slider so it
  // actually spans top-to-bottom. Same ResizeObserver pattern as the
  // caption slider. Hooks must run unconditionally — put them ABOVE
  // any early return.
  const sliderHostRef = useRef(null)
  const [sliderLengthPx, setSliderLengthPx] = useState(0)
  useEffect(() => {
    const el = sliderHostRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.height > 0) setSliderLengthPx(r.height)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The slider edits the ACTIVE slot's Y when one is showing —
  // 'opening' / 'middle' / 'closing' map to openingYPct /
  // middleYPct / closingYPct. With no active slot (or a slot that
  // hasn't been overridden yet), the slider falls back to / writes
  // the global overlayYPct so the existing single-Y workflow stays
  // intact for users who don't care about per-slot positioning.
  const slotKey = activeSlot ? `${activeSlot}YPct` : null
  const slotVal = slotKey != null ? overlays?.[slotKey] : null
  const globalVal = Number(overlays?.overlayYPct ?? 70)
  const current = slotVal != null ? Number(slotVal) : globalVal
  const editingSlot = slotKey != null
  const handleChange = (nextPct) => {
    // Update FinalPreviewV2's local overlays state so OverlayText re-
    // renders immediately at the new Y. Also mirror to the global
    // broadcast so any other listener stays consistent.
    // Writes ONLY the active slot's key when editing a slot; falls
    // back to overlayYPct when no slot is active. Other slots'
    // overrides (and the global) stay untouched on this drag.
    const writeKey = editingSlot ? slotKey : 'overlayYPct'
    const nextOverlays = { ...(overlays || {}), [writeKey]: nextPct }
    onChange(nextOverlays)
    try {
      if (typeof window !== 'undefined') {
        window._postyOverlays = nextOverlays
        window.dispatchEvent(new CustomEvent('posty-overlay-change', { detail: nextOverlays }))
      }
    } catch { /* fine */ }
    // Persist via jobSync (already debounced internally).
    jobSync?.saveOverlaySettings?.(nextOverlays)
  }

  return (
    <div
      // Left-edge flex sibling of the video. Same layout as the
      // caption slider — match the video's height via alignSelf,
      // fixed 30px width, no absolute positioning.
      style={{
        width: 30,
        alignSelf: 'stretch',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 0',
        background: 'rgba(0,0,0,0.32)',
        borderRadius: 15,
        userSelect: 'none',
      }}
      title={`Overlay text vertical position — ${editingSlot
        ? `editing ${activeSlot} slot${slotVal == null ? ' (currently inheriting global, drag to set)' : ''}`
        : 'global default (no slot active right now)'} · ${Math.round(current)}%`}
    >
      <div style={{
        color: 'rgba(255,255,255,0.9)',
        fontSize: 10,
        lineHeight: 1,
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12 }}>▲</span>
        <span style={{ fontSize: 7, letterSpacing: 0.5 }}>TOP</span>
      </div>

      <div
        ref={sliderHostRef}
        style={{
          flex: 1,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {sliderLengthPx > 0 && (
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={current}
            onChange={e => handleChange(Number(e.target.value))}
            style={{
              transform: 'rotate(90deg)',
              transformOrigin: 'center center',
              width: sliderLengthPx,
              height: 8,
              cursor: 'ns-resize',
              // Violet to distinguish from the caption slider's amber.
              accentColor: '#6C5CE7',
            }}
            aria-label="Overlay text vertical position"
          />
        )}
      </div>

      <div style={{
        color: 'rgba(255,255,255,0.9)',
        fontSize: 10,
        lineHeight: 1,
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 7, letterSpacing: 0.5 }}>BOT</span>
        <span style={{ fontSize: 12 }}>▼</span>
      </div>
    </div>
  )
}

// Horizontal slider that sets overlay (opening / middle / closing)
// font size by writing storyFontSize into overlay_settings. Mirrors
// the OverlayPositionSlider's save path so both controls flow
// through jobSync.saveOverlaySettings.
function OverlayFontSizeSlider({ overlays, onChange, jobSync }) {
  // Default 48 matches the internal default in OverlaysPanelV2. The
  // OverlayText renderer clamps to Math.max(24, ...) at render time,
  // so our 24 floor is enforced end-to-end.
  const current = Number(overlays?.storyFontSize) || 48
  const family = overlays?.storyFontFamily || overlays?.font_family || 'Inter'
  const color = overlays?.storyColor || overlays?.font_color || '#ffffff'
  const handle = (nextPx) => {
    const nextOverlays = { ...(overlays || {}), storyFontSize: nextPx }
    onChange(nextOverlays)
    try {
      if (typeof window !== 'undefined') {
        window._postyOverlays = nextOverlays
        window.dispatchEvent(new CustomEvent('posty-overlay-change', { detail: nextOverlays }))
      }
    } catch { /* fine */ }
    jobSync?.saveOverlaySettings?.(nextOverlays)
  }
  return (
    <div
      className="flex items-center gap-2 text-[10px] bg-[#6C5CE7]/10 border border-[#6C5CE7]/30 rounded px-2 py-1.5 flex-1 min-w-[180px] flex-wrap"
      title="Default overlay (opening/middle/closing) font size in px"
    >
      <span className="font-medium text-[#6C5CE7] w-[60px]">Overlay font</span>
      <input
        type="range"
        min={24} max={120} step={1}
        value={current}
        onChange={e => handle(Number(e.target.value))}
        style={{ accentColor: '#6C5CE7' }}
        className="flex-1 cursor-pointer"
      />
      <span className="font-mono text-[10px] text-muted w-10 text-right">{current}px</span>
      <FontSizePreview family={family} color={color} sizePx={current} />
    </div>
  )
}

// Horizontal slider for the job-level default caption base font
// size. Controlled component: the parent (FinalPreviewV2) owns the
// override value so the overlay can re-render live during drag.
// Writes to default_caption_style.base_font_size, so every segment
// that doesn't have its own caption_styles row picks up the new
// size. Segments with their own row keep their own explicit size
// (or null → aspect-ratio default).
function CaptionFontSizeSlider({ draftId, value, onChange }) {
  // Fetch the current default on mount so the slider seeds with
  // whatever was previously saved. baseConfig holds the full default
  // object so the save call preserves every other field (font
  // family, color, effects, vertical position, etc.).
  const [baseConfig, setBaseConfig] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const saveTimerRef = useRef(null)

  useEffect(() => {
    if (!draftId) return
    let cancelled = false
    api.getJobDefaultCaptionStyle(draftId).then(r => {
      if (cancelled) return
      const cs = r?.caption_style || null
      setBaseConfig(cs)
      const px = cs?.base_font_size
      // Seed the parent override only if the job has a saved value
      // AND the parent hasn't been touched yet. Matches the pattern
      // in VerticalPositionSlider.
      if (typeof px === 'number' && value == null) {
        onChange(px)
      }
      setLoaded(true)
    }).catch(() => setLoaded(true))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId])

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
  }, [])

  if (!loaded) return null

  // Default visual: 60px (close to the 1080×0.055 derivation most
  // tenants see) when no value is saved. Slider always shows a
  // number so users can grab it and drag, even from the null state.
  const displayValue = value != null ? value : 60

  const scheduleSave = (nextPx) => {
    // Immediate parent update so the overlay re-renders this frame.
    onChange(nextPx)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      const body = {
        base_font_family: baseConfig?.base_font_family,
        base_font_color: baseConfig?.base_font_color,
        base_font_size: nextPx,
        active_word_color: baseConfig?.active_word_color,
        active_word_font_family: baseConfig?.active_word_font_family,
        active_word_outline_config: baseConfig?.active_word_outline_config,
        active_word_scale_pulse: baseConfig?.active_word_scale_pulse,
        entry_animation: baseConfig?.entry_animation,
        exit_animation: baseConfig?.exit_animation,
        reveal_config: baseConfig?.reveal_config,
        continuous_motion: baseConfig?.continuous_motion,
        layout_config: baseConfig?.layout_config,
      }
      api.saveJobDefaultCaptionStyle(draftId, body)
        .then(() => setBaseConfig({ ...(baseConfig || {}), base_font_size: nextPx }))
        .catch(() => { /* silent — local state reflects intent */ })
      // Cascade so segments with their own caption_styles row pick
      // up the new font size — same shadow-default issue the
      // VerticalPositionSlider has.
      api.cascadeJobDefaultCaptionStyle(draftId, { base_font_size: nextPx })
        .catch(() => { /* silent */ })
    }, 300)
  }

  return (
    <div
      className="flex items-center gap-2 text-[10px] bg-[#f59e0b]/10 border border-[#f59e0b]/30 rounded px-2 py-1.5 flex-1 min-w-[180px] flex-wrap"
      title="Default caption base font size in px (applies to all segments without their own font size)"
    >
      <span className="font-medium text-[#d97706] w-[60px]">Caption font</span>
      <input
        type="range"
        min={28} max={120} step={1}
        value={displayValue}
        onChange={e => scheduleSave(Number(e.target.value))}
        style={{ accentColor: '#f59e0b' }}
        className="flex-1 cursor-pointer"
      />
      <span className="font-mono text-[10px] text-muted w-10 text-right">{displayValue}px</span>
      <FontSizePreview
        family={baseConfig?.base_font_family || 'Inter'}
        color={baseConfig?.base_font_color || '#ffffff'}
        sizePx={displayValue}
      />
    </div>
  )
}

export default FinalPreviewV2
