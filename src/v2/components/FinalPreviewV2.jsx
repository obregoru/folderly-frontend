import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as api from '../../api'

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
const FinalPreviewV2 = forwardRef(function FinalPreviewV2({ files, restoredMergeUrl, draftId }, ref) {
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

  const activeOverlayText = useMemo(() => {
    if (!overlays) return null
    const t = currentTime
    const openDur   = Number(overlays.openingDuration)   || 0
    const midStart  = Number(overlays.middleStartTime)   || 0
    const midDur    = Number(overlays.middleDuration)    || 0
    const closeDur  = Number(overlays.closingDuration)   || 0
    if (overlays.openingText && t < openDur) return overlays.openingText
    if (overlays.middleText && t >= midStart && t < midStart + midDur) return overlays.middleText
    if (overlays.closingText && duration > 0 && t >= duration - closeDur) return overlays.closingText
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

  return (
    <div className="bg-black rounded-lg overflow-hidden relative aspect-[9/16] max-h-[56vh] w-[80%] mx-auto">
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
          {activeOverlayText && (
            <OverlayText text={activeOverlayText} style={overlays} videoRef={videoRef} />
          )}
          {activeCaptionText && !teleprompter && (
            <CaptionText text={activeCaptionText} />
          )}
          {activeTeleprompterText && (
            <TeleprompterText text={activeTeleprompterText} />
          )}
        </>
      ) : (
        <PhotoCarousel urls={source.urls} />
      )}
    </div>
  )
})

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

function OverlayText({ text, style, videoRef }) {
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
  const color = style?.storyFontColor || '#ffffff'
  const family = style?.storyFontFamily || 'sans-serif'
  const rawOutline = style?.storyFontOutline === false ? 0 : Math.max(0, Number(style?.storyFontOutlineWidth) || 3)
  const outlineWidth = rawOutline * effectiveScale
  const lineHeight = Number(style?.lineHeight) > 0 ? Number(style.lineHeight) : 1.1
  // Letter-spacing saved as a 0..5 step in the burn-in path; CSS uses em.
  // 0.05em per step matches the legacy ResultCard preview (see v1).
  const letterSpacingEm = (Number(style?.letterSpacing) || 0) * 0.05
  const shadow = outlineWidth > 0
    ? Array.from({ length: 8 }).map((_, i) => {
        const ang = (i / 8) * Math.PI * 2
        return `${Math.cos(ang) * outlineWidth}px ${Math.sin(ang) * outlineWidth}px 0 #000`
      }).join(', ')
    : 'none'

  // Map the 0–100 overlayYPct into the platform-safe band. Mirrors what the
  // burn-in pipeline does: skip the top status/UI area (~12%) and the
  // bottom caption/UI area (~22%); the remaining middle is where overlay
  // text is guaranteed not to collide with IG / TikTok chrome.
  const SAFE_TOP = 12   // %
  const SAFE_BOT = 22   // %
  const pct = Math.max(0, Math.min(100, Number(style?.overlayYPct ?? 50)))
  const topPct = SAFE_TOP + (100 - SAFE_TOP - SAFE_BOT) * (pct / 100)

  return (
    <div
      ref={wrapRef}
      className="absolute inset-x-0 flex items-center justify-center pointer-events-none px-4 text-center"
      style={{ top: `${topPct}%`, transform: 'translateY(-50%)' }}
    >
      <div
        style={{
          fontSize: `${fontSize}px`,
          color,
          fontFamily: family,
          textShadow: shadow,
          fontWeight: 700,
          lineHeight,
          letterSpacing: letterSpacingEm ? `${letterSpacingEm}em` : 'normal',
          maxWidth: '95%',
          whiteSpace: 'pre-wrap',
        }}
      >
        {text}
      </div>
    </div>
  )
}

function PhotoCarousel({ urls }) {
  const [idx, setIdx] = useState(0)
  if (urls.length === 0) return null
  return (
    <>
      <img src={urls[idx]} alt="" className="w-full h-full object-cover" />
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
export function DownloadFinalButton({ draftId }) {
  const [state, setState] = useState('idle') // idle | rendering | ready | saving | done | error
  const [msg, setMsg] = useState('')
  const blobRef = useRef(null)
  const filenameRef = useRef(null)

  const supportsShare = typeof navigator !== 'undefined'
    && typeof navigator.canShare === 'function'
    && (() => {
      try { return navigator.canShare({ files: [new File([new Blob()], 'x.mp4', { type: 'video/mp4' })] }) }
      catch { return false }
    })()

  const renderAndStage = async () => {
    setState('rendering'); setMsg('')
    try {
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
      if (!r?.final_url) throw new Error('Server returned no final URL')

      const vres = await fetch(r.final_url, { credentials: 'omit' })
      if (!vres.ok) throw new Error(`Download failed (${vres.status})`)
      const blob = await vres.blob()
      blobRef.current = blob
      filenameRef.current = `posty-final-${Date.now()}.mp4`
      setState('ready')
    } catch (e) {
      setMsg(e.message || String(e))
      setState('error')
      setTimeout(() => { setState('idle'); setMsg('') }, 4000)
    }
  }

  // Runs synchronously inside the click handler so the user gesture
  // survives. navigator.share is called directly; anchor downloads fire
  // via the same click path.
  const shareOrSave = () => {
    const blob = blobRef.current
    const filename = filenameRef.current
    if (!blob || !filename) { setState('idle'); return }
    const type = blob.type || 'video/mp4'
    const file = new File([blob], filename, { type })

    if (supportsShare) {
      setState('saving')
      navigator.share({ files: [file], title: 'Posty video' })
        .then(() => { setState('done'); setTimeout(() => setState('idle'), 1500) })
        .catch(err => {
          if (err?.name === 'AbortError') {
            // User cancelled the share sheet — keep the blob so they can
            // re-tap without re-rendering.
            setState('ready')
          } else {
            setMsg(err?.message || 'Share failed'); setState('error')
            setTimeout(() => { setState('ready'); setMsg('') }, 3000)
          }
        })
      return
    }

    // Desktop: anchor-click save dialog, inside the live gesture.
    try {
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
      setMsg(e.message || 'Save failed'); setState('error')
      setTimeout(() => { setState('ready'); setMsg('') }, 3000)
    }
  }

  const handleClick = () => {
    if (state === 'rendering' || state === 'saving') return
    if (state === 'ready') { shareOrSave(); return }
    // idle, error, done — kick off a fresh render
    blobRef.current = null
    filenameRef.current = null
    renderAndStage()
  }

  const label = state === 'rendering' ? 'Rendering final video…'
    : state === 'saving' ? (supportsShare ? 'Opening share sheet…' : 'Saving…')
    : state === 'ready' ? (supportsShare ? '📤 Tap again to share / save' : '⬇ Tap again to save')
    : state === 'done' ? '✓ Saved'
    : state === 'error' ? (msg ? `Error: ${msg.slice(0, 80)} — tap to retry` : 'Error — tap to retry')
    : '⬇ Download final video'
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

export default FinalPreviewV2
