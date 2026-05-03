import { useState, useEffect, useRef } from 'react'
import * as api from '../api'

/**
 * iOS-style filmstrip video trimmer. Lives at the file level (one per
 * uploaded video) and writes trim state to the shared `item` object so
 * downstream post/preview flows read the same values.
 *
 * On commit, any cached previews on the item are revoked and _trimVersion
 * is bumped — CaptionEditor watches that counter to drop stale local state.
 */
export default function VideoTrimmer({ item }) {
  const file = item.file
  const [src] = useState(() => {
    if (file instanceof Blob || file instanceof File) return URL.createObjectURL(file)
    if (item._publicUrl) return item._publicUrl
    if (item._uploadKey && item._tenantSlug) {
      return `${import.meta.env.VITE_API_URL || ''}/api/t/${item._tenantSlug}/upload/serve?key=${encodeURIComponent(item._uploadKey)}`
    }
    return null
  })
  if (!src) return null
  const [videoDuration, setVideoDuration] = useState(0)
  const [trimStart, setTrimStart] = useState(() => item._trimStart ?? 0)
  const [trimEnd, setTrimEnd] = useState(() => item._trimEnd ?? null)
  const [trimThumbs, setTrimThumbs] = useState(() => Array.isArray(item._trimThumbs) ? item._trimThumbs : [])
  const stripRef = useRef(null)
  // Pointer-up closures need fresh values.
  const trimStartRef = useRef(trimStart)
  const trimEndRef = useRef(trimEnd)
  useEffect(() => { trimStartRef.current = trimStart }, [trimStart])
  useEffect(() => { trimEndRef.current = trimEnd }, [trimEnd])

  // Detect mobile — iOS/Android video seek-and-decode is much slower than
  // desktop, so we capture fewer frames and give the decoder more time.
  const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '')
  // More frames = finer visual resolution. With 5 frames on a 10s video
  // each thumbnail covers 2.5s, so being off by one keyframe (~1s) is
  // very noticeable. 8 on mobile / 12 on desktop keeps it tight.
  const FRAME_COUNT = isMobile ? 8 : 12
  const SEEK_TIMEOUT_MS = isMobile ? 2500 : 1500

  // Probe source video duration + capture filmstrip thumbnails. iOS Safari
  // has two hard requirements for this to work:
  //   1. The <video> must be attached to the DOM (detached elements never
  //      paint to canvas), and
  //   2. The element must have non-trivial pixel dimensions (1×1 sometimes
  //      returns garbage), so the hidden video is 80×80 offscreen.
  // We also nudge decoding by calling play() briefly on metadata load.
  const hiddenVideoRef = useRef(null)
  useEffect(() => {
    const v = hiddenVideoRef.current
    if (!v) return
    let cancelled = false

    const onMeta = async () => {
      if (cancelled) return
      if (v.duration && isFinite(v.duration)) {
        setVideoDuration(v.duration)
        item._videoDuration = v.duration
        try { window.dispatchEvent(new CustomEvent('posty-video-duration', { detail: { itemId: item.id, duration: v.duration } })) } catch {}
      }
      try {
        v.muted = true
        const p = v.play()
        if (p && typeof p.then === 'function') await p
        // Let iOS actually render a couple of frames before we pause.
        await new Promise(r => setTimeout(r, 120))
        try { v.pause() } catch {}
      } catch {
        // Autoplay may be blocked — desktop Chrome/Firefox still paint
        // without it, so we fall through and try to capture regardless.
      }
    }
    v.addEventListener('loadedmetadata', onMeta)
    return () => {
      cancelled = true
      v.removeEventListener('loadedmetadata', onMeta)
    }
  }, [src])

  const [thumbProgress, setThumbProgress] = useState({ done: 0, total: 0 })

  useEffect(() => {
    if (videoDuration <= 0) return
    // Skip regeneration if we already have saved thumbs from the job
    if (Array.isArray(item._trimThumbs) && item._trimThumbs.length > 0) {
      setTrimThumbs(item._trimThumbs)
      setThumbProgress({ done: item._trimThumbs.length, total: item._trimThumbs.length })
      return
    }
    const v = hiddenVideoRef.current
    if (!v) return
    let cancelled = false
    setTrimThumbs([])
    setThumbProgress({ done: 0, total: FRAME_COUNT })
    const canvas = document.createElement('canvas')

    const seekTo = (t) => new Promise((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        v.removeEventListener('seeked', done)
        clearTimeout(timer)
        resolve()
      }
      // Hard timeout — if iOS hangs on the seek, skip it and move on.
      const timer = setTimeout(done, SEEK_TIMEOUT_MS)
      v.addEventListener('seeked', done)
      try { v.currentTime = t } catch { done() }
    })

    const capture = async () => {
      const aspect = (v.videoWidth && v.videoHeight) ? v.videoWidth / v.videoHeight : 9 / 16
      canvas.width = 96
      canvas.height = Math.max(1, Math.round(96 / aspect))
      const ctx = canvas.getContext('2d')
      const thumbs = []
      // Sample at the exact proportional times so thumbnails visually align
      // with the trim handles (which map 0–100% to 0–duration linearly).
      // Black frames at t=0 are handled by the two-pass retry below.
      for (let i = 0; i < FRAME_COUNT; i++) {
        if (cancelled) return
        const frac = FRAME_COUNT === 1 ? 0 : i / (FRAME_COUNT - 1)
        const t = Math.min(frac * videoDuration, Math.max(0, videoDuration - 0.02))
        await seekTo(t)
        if (cancelled) return
        // Two rAFs so iOS has a full compositor cycle to paint the new frame
        await new Promise(r => requestAnimationFrame(r))
        await new Promise(r => requestAnimationFrame(r))
        try {
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
          // Sanity-check: if the canvas came back mostly black, the seek
          // didn't actually paint — reuse the previous thumb (or a
          // placeholder) so the strip doesn't go blank.
          const px = ctx.getImageData(0, 0, Math.min(10, canvas.width), Math.min(10, canvas.height)).data
          let sum = 0
          for (let p = 0; p < px.length; p += 4) sum += px[p] + px[p + 1] + px[p + 2]
          if (sum < 50) {
            // Black frame — placeholder for now, we'll backfill after the
            // loop once iOS has warmed up. Store null so we can detect it.
            thumbs.push(null)
          } else {
            thumbs.push(canvas.toDataURL('image/jpeg', 0.55))
          }
          // For display, substitute a neighbor for any null slots so the
          // strip never shows a hole mid-render.
          const displayThumbs = thumbs.map((t, idx) => {
            if (t) return t
            for (let j = idx + 1; j < thumbs.length; j++) if (thumbs[j]) return thumbs[j]
            for (let j = idx - 1; j >= 0; j--) if (thumbs[j]) return thumbs[j]
            return null
          })
          setTrimThumbs(displayThumbs)
          setThumbProgress({ done: thumbs.length, total: FRAME_COUNT })
        } catch (err) {
          console.warn('[trim] thumbnail capture failed:', err.message)
          return
        }
        // Let iOS breathe between seeks — without this the decoder can
        // back up and later seeks take longer and longer.
        if (isMobile) await new Promise(r => setTimeout(r, 40))
      }
      // Second pass: retry any slots that came back black. By this point
      // iOS's decoder is fully warmed up, so the retry usually works.
      for (let i = 0; i < FRAME_COUNT; i++) {
        if (cancelled) return
        if (thumbs[i] != null) continue
        const frac = FRAME_COUNT === 1 ? 0 : i / (FRAME_COUNT - 1)
        // Nudge the seek target forward by 0.25s to land on a keyframe
        // neighborhood that's more likely to have a decodable frame.
        const t = Math.min(videoDuration - 0.02, frac * videoDuration + 0.25)
        await seekTo(t)
        if (cancelled) return
        await new Promise(r => requestAnimationFrame(r))
        await new Promise(r => requestAnimationFrame(r))
        try {
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
          const px2 = ctx.getImageData(0, 0, Math.min(10, canvas.width), Math.min(10, canvas.height)).data
          let sum2 = 0
          for (let p = 0; p < px2.length; p += 4) sum2 += px2[p] + px2[p + 1] + px2[p + 2]
          if (sum2 >= 50) {
            thumbs[i] = canvas.toDataURL('image/jpeg', 0.55)
            const displayThumbs = thumbs.map((tt, idx) => {
              if (tt) return tt
              for (let j = idx + 1; j < thumbs.length; j++) if (thumbs[j]) return thumbs[j]
              for (let j = idx - 1; j >= 0; j--) if (thumbs[j]) return thumbs[j]
              return null
            })
            setTrimThumbs(displayThumbs)
          }
        } catch {}
        if (isMobile) await new Promise(r => setTimeout(r, 40))
      }
      // After both passes complete, save thumbs to the job so resume is instant
      if (!cancelled) {
        const finalThumbs = thumbs.map((tt, idx) => {
          if (tt) return tt
          for (let j = idx + 1; j < thumbs.length; j++) if (thumbs[j]) return thumbs[j]
          for (let j = idx - 1; j >= 0; j--) if (thumbs[j]) return thumbs[j]
          return null
        }).filter(Boolean)
        item._trimThumbs = finalThumbs
        try {
          window.dispatchEvent(new CustomEvent('posty-trim-thumbs', {
            detail: { itemId: item.id, thumbs: finalThumbs },
          }))
        } catch {}
      }
    }
    capture()
    return () => { cancelled = true }
  }, [src, videoDuration])

  // Write-through to item + invalidate cached previews. Also snaps values
  // to the nearest keyframe the browser can actually seek to, so the trim
  // the user sees in playback matches the handle position.
  const commitTrim = async (nextStart, nextEnd) => {
    // Snap to keyframes using the hidden video element. The browser's
    // .currentTime after a seek reflects where it actually landed.
    const v = hiddenVideoRef.current
    if (v && v.duration) {
      try {
        if (nextStart > 0) {
          v.currentTime = nextStart
          await new Promise(r => { const h = () => { v.removeEventListener('seeked', h); r() }; v.addEventListener('seeked', h); setTimeout(r, 300) })
          nextStart = v.currentTime
        }
        if (nextEnd != null) {
          v.currentTime = nextEnd
          await new Promise(r => { const h = () => { v.removeEventListener('seeked', h); r() }; v.addEventListener('seeked', h); setTimeout(r, 300) })
          nextEnd = v.currentTime >= v.duration - 0.05 ? null : v.currentTime
        }
      } catch {}
      // Update local state to the snapped values
      setTrimStart(nextStart)
      if (nextEnd !== trimEnd) setTrimEnd(nextEnd)
    }
    item._trimStart = nextStart
    item._trimEnd = nextEnd
    item._trimVersion = (item._trimVersion || 0) + 1
    if (item._sharedPreviewUrl) {
      try { URL.revokeObjectURL(item._sharedPreviewUrl) } catch {}
      delete item._sharedPreviewUrl
    }
    if (item._tabPreviewUrls) {
      for (const k of Object.keys(item._tabPreviewUrls)) {
        try { URL.revokeObjectURL(item._tabPreviewUrls[k]) } catch {}
      }
      item._tabPreviewUrls = {}
    }
    if (item._overlayPreviewUrl) {
      try { URL.revokeObjectURL(item._overlayPreviewUrl) } catch {}
      delete item._overlayPreviewUrl
    }
    // Notify any consumer (like CaptionEditor) that our trim changed so
    // it can re-sync its own video elements. We identify the file by
    // item.id since consumers receive the same `item` reference.
    try {
      window.dispatchEvent(new CustomEvent('posty-trim-change', {
        detail: { itemId: item.id, trimStart: nextStart, trimEnd: nextEnd },
      }))
    } catch {}
  }

  // Hidden video element — MUST be in the DOM for iOS Safari to decode
  // frames into canvas. It's 80×80 offscreen (1×1 is too small on iOS,
  // the decoder sometimes returns garbage) and invisible.
  // crossOrigin="anonymous" is needed for Supabase CDN URLs so the canvas
  // isn't tainted when we drawImage + toDataURL for filmstrip thumbnails.
  const isCrossOrigin = src && !src.startsWith('blob:')
  const hiddenVideoEl = (
    <video
      ref={hiddenVideoRef}
      src={src}
      muted
      playsInline
      preload="auto"
      crossOrigin={isCrossOrigin ? 'anonymous' : undefined}
      style={{ position: 'absolute', width: 80, height: 80, opacity: 0, pointerEvents: 'none', left: -9999, top: -9999 }}
    />
  )

  if (videoDuration <= 0) {
    return (
      <div className="bg-white border border-border rounded-sm p-2 text-[10px] text-muted">
        {hiddenVideoEl}
        Loading video…
      </div>
    )
  }

  return (
    <div className="bg-white border border-border rounded-sm p-2">
      {hiddenVideoEl}
      <div className="flex items-center gap-2 text-[10px] mb-1">
        <span className="font-medium text-ink truncate max-w-[40%]" title={file?.name || item._filename || 'Video'}>Trim: {file?.name || item._filename || 'Video'}</span>
        <span className="text-muted text-[9px] whitespace-nowrap">
          {trimStart.toFixed(1)}s → {(trimEnd ?? videoDuration).toFixed(1)}s
          <span className="text-[#d97706] font-medium ml-1">· {((trimEnd ?? videoDuration) - trimStart).toFixed(1)}s kept</span>
        </span>
        {(trimStart > 0 || trimEnd != null) && (
          <button
            onClick={() => { setTrimStart(0); setTrimEnd(null); commitTrim(0, null) }}
            className="text-[9px] text-[#6C5CE7] hover:underline ml-auto bg-transparent border-none cursor-pointer"
          >
            Reset
          </button>
        )}
      </div>
      {/* Outer container: handles sit at the edges, filmstrip fills the middle.
          Layout: [left-handle 12px] [filmstrip flex-1] [right-handle 12px]
          This way the handle edges align exactly with the filmstrip edges,
          and pointer math maps cleanly into the filmstrip's coordinate space. */}
      <div
        ref={stripRef}
        className="relative h-[52px] rounded overflow-hidden bg-black select-none flex"
        style={{ touchAction: 'none' }}
      >
        {/* Left handle — right edge aligns with trimStart in the filmstrip.
            The filmstrip starts at 12px from the container left, so the handle's
            left = 12px * (1 - pct) + filmstripWidth * pct - 0  →  simplified:
            we use calc(12px + (100% - 24px) * pct - 12px) = calc((100% - 24px) * pct)
            which puts the handle's LEFT edge at the right place, then the 12px
            handle body extends to the right of the cut point. To make the handle's
            RIGHT edge mark the cut: left = calc(12px + (100% - 24px) * pct - 12px). */}
        <div
          className="absolute top-0 bottom-0 w-3 bg-[#f7c948] rounded-l flex items-center justify-center shadow-md z-10"
          style={{ left: `calc((100% - 24px) * ${trimStart / videoDuration})`, cursor: 'ew-resize' }}
        >
          <div className="w-[2px] h-4 bg-white/90 rounded pointer-events-none" />
        </div>
        {/* Right handle — left edge aligns with trimEnd in the filmstrip.
            right = calc((100% - 24px) * (1 - pct)) */}
        <div
          className="absolute top-0 bottom-0 w-3 bg-[#f7c948] rounded-r flex items-center justify-center shadow-md z-10"
          style={{ right: `calc((100% - 24px) * ${1 - (trimEnd ?? videoDuration) / videoDuration})`, cursor: 'ew-resize' }}
        >
          <div className="w-[2px] h-4 bg-white/90 rounded pointer-events-none" />
        </div>
        {/* Filmstrip area between the handles. The thumbnails occupy the full
            width of this element so each thumbnail's visual position maps
            linearly to its sample time. */}
        <div className="absolute top-0 bottom-0 left-3 right-3">
          <div className="absolute inset-0 flex">
            {trimThumbs.length > 0 ? (
              trimThumbs.map((s, i) => (
                <img key={i} src={s} alt="" className="flex-1 h-full object-cover min-w-0" draggable={false} />
              ))
            ) : (
              <div className="flex-1 flex items-center justify-center text-[9px] text-white/60">
                Loading frames {thumbProgress.total > 0 ? `${thumbProgress.done}/${thumbProgress.total}` : '…'}
              </div>
            )}
          </div>
          {/* Progress indicator */}
          {trimThumbs.length > 0 && trimThumbs.length < thumbProgress.total && (
            <div className="absolute top-1 right-1 text-[8px] text-white/80 bg-black/50 rounded px-1 py-0.5 pointer-events-none">
              {thumbProgress.done}/{thumbProgress.total}
            </div>
          )}
          {/* Dimmed "trimmed away" regions — positioned within filmstrip */}
          <div
            className="absolute top-0 bottom-0 left-0 bg-black/65 pointer-events-none"
            style={{ width: `${(trimStart / videoDuration) * 100}%` }}
          />
          <div
            className="absolute top-0 bottom-0 right-0 bg-black/65 pointer-events-none"
            style={{ width: `${(1 - (trimEnd ?? videoDuration) / videoDuration) * 100}%` }}
          />
          {/* Yellow top+bottom selection frame */}
          <div
            className="absolute top-0 bottom-0 border-y-[3px] border-[#f7c948] pointer-events-none"
            style={{
              left: `${(trimStart / videoDuration) * 100}%`,
              width: `${(((trimEnd ?? videoDuration) - trimStart) / videoDuration) * 100}%`,
            }}
          />
        </div>
        {/* Invisible drag surface covering the entire strip — maps pointer
            position into the filmstrip's inner coordinate space (excluding
            the 12px handles on each side) so the trim time aligns with
            what the user visually sees in the thumbnails. */}
        <div
          className="absolute inset-0 z-20"
          onPointerDown={e => {
            e.preventDefault()
            const rect = stripRef.current?.getBoundingClientRect()
            if (!rect) return
            const HANDLE_W = 12
            const inner = rect.width - HANDLE_W * 2
            if (inner <= 0) return
            const toTime = (clientX) => {
              const x = clientX - rect.left - HANDLE_W
              return Math.max(0, Math.min(videoDuration, (x / inner) * videoDuration))
            }
            const clickTime = toTime(e.clientX)
            // Decide which handle the user is grabbing: whichever is closer
            const distToStart = Math.abs(clickTime - trimStart)
            const distToEnd = Math.abs(clickTime - (trimEnd ?? videoDuration))
            const dragging = distToStart <= distToEnd ? 'start' : 'end'
            let lastSeek = 0
            const seekAllVideos = (t) => {
              // Seek every <video> element associated with this item so the
              // user sees the frame wherever they're looking.
              const videos = document.querySelectorAll(`video[data-posty-item-id="${item.id}"]`)
              videos.forEach(v => { try { v.currentTime = t } catch {} })
              // Also notify ResultCard preview (tracked by ref, no data attribute)
              try { window.dispatchEvent(new CustomEvent('posty-trim-scrub', { detail: { itemId: item.id, time: t } })) } catch {}
            }
            const onMove = (ev) => {
              const t = toTime(ev.clientX)
              let target
              if (dragging === 'start') {
                target = Math.min(t, (trimEndRef.current ?? videoDuration) - 0.5)
                setTrimStart(target)
              } else {
                const v = Math.max(t, trimStartRef.current + 0.5)
                setTrimEnd(v >= videoDuration - 0.05 ? null : v)
                target = v >= videoDuration - 0.05 ? videoDuration - 0.1 : v
              }
              const now = Date.now()
              if (now - lastSeek > 100) { // ~10 seeks/sec for smoother scrub
                lastSeek = now
                seekAllVideos(target)
              }
            }
            // Apply initial move so the handle snaps to the tap position
            onMove(e)
            const onUp = () => {
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)
              commitTrim(trimStartRef.current, trimEndRef.current)
            }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
          }}
        />
      </div>
      <FirstHalfSecondInspector src={src} trimStart={trimStart} videoDuration={videoDuration} item={item} />
    </div>
  )
}

// Inspector for the first 0.5 seconds of a video clip. TikTok and
// IG Reels prioritize motion in the first ~0.5s for retention; this
// surfaces what's actually playing in that window so the user can
// decide whether the opening clip needs a recut. Two modes:
//   • Loop play — auto-loops 0.0→0.5s repeatedly, stops on Pause
//   • Frame-step — six tap targets (0.0/0.1/0.2/0.3/0.4/0.5) that
//     pause + seek to that timestamp so the user can compare frames
//
// Mounts its own visible <video> element rather than reusing the
// trim strip's offscreen one so the user actually SEES the frame.
function FirstHalfSecondInspector({ src, trimStart = 0, videoDuration = 0, item = null }) {
  const videoRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [activeFrame, setActiveFrame] = useState(null) // 0.0 | 0.1 ... 0.5 | null
  const [looping, setLooping] = useState(false)
  const loopRafRef = useRef(null)
  // TikTok-tuned vision analysis state. Held inside the inspector so
  // the user can run it on demand and the result stays visible while
  // they iterate on the clip.
  const [reviewing, setReviewing] = useState(false)
  const [review, setReview] = useState(null) // { overall_score, ..., suggestions[] }
  const [reviewErr, setReviewErr] = useState(null)
  // The job/file ids are needed to invoke the BE. _dbFileId lives on
  // every persisted clip; without one (fresh upload still in flight)
  // we hide the TikTok review button rather than fail mid-call. The
  // draftId comes from sessionStorage (set when the user opens a job)
  // since VideoTrimmer doesn't take draftId as a prop.
  const dbFileId = item?._dbFileId || null
  const draftId = typeof window !== 'undefined' ? sessionStorage.getItem('posty_active_job') : null
  const canReview = !!(dbFileId && draftId)
  const runReview = async () => {
    if (!canReview || reviewing) return
    setReviewing(true); setReviewErr(null)
    try {
      const r = await api.tiktokFirstHalfReview(draftId, dbFileId)
      if (!r?.analysis) throw new Error('No analysis returned')
      setReview(r.analysis)
    } catch (e) {
      setReviewErr(e?.message || String(e))
    } finally {
      setReviewing(false)
    }
  }
  // Frame offsets are relative to the TRIM START, not the file's
  // origin. The user trimmed the first N seconds off; "first 0.5s of
  // the clip" means the half-second after that cut.
  const start = Math.max(0, Number(trimStart) || 0)
  const cap = videoDuration > 0 ? Math.max(0, videoDuration - start) : Infinity
  const LOOP_LEN = Math.min(0.5, cap || 0.5)
  const LOOP_END = start + LOOP_LEN
  const FRAMES = [0, 0.1, 0.2, 0.3, 0.4, 0.5]
    .filter(t => t <= LOOP_LEN + 1e-6)
    .map(t => start + t)

  // Stop loop + cleanup when collapsed or unmounted.
  useEffect(() => {
    if (!open && looping) setLooping(false)
    if (!open) {
      const v = videoRef.current
      if (v) try { v.pause() } catch {}
    }
    return () => {
      if (loopRafRef.current) cancelAnimationFrame(loopRafRef.current)
    }
  }, [open, looping])

  // Loop driver. Watches currentTime via rAF; when it crosses LOOP_END,
  // seek back to the trim start. Browsers' built-in <video loop>
  // attribute can't restrict the loop range, hence this manual driver.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !looping) return
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      if (v.currentTime >= LOOP_END - 0.01 || v.currentTime < start - 0.01) {
        try { v.currentTime = start } catch {}
      }
      loopRafRef.current = requestAnimationFrame(tick)
    }
    try {
      v.muted = true
      v.currentTime = start
      const p = v.play()
      if (p && typeof p.then === 'function') p.catch(() => { /* autoplay block */ })
    } catch {}
    loopRafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      if (loopRafRef.current) cancelAnimationFrame(loopRafRef.current)
      try { v.pause() } catch {}
    }
  }, [looping, start, LOOP_END])

  const seekTo = (t) => {
    setLooping(false)
    setActiveFrame(t)
    const v = videoRef.current
    if (!v) return
    try {
      v.pause()
      v.currentTime = Math.max(0, Number(t))
    } catch {}
  }

  if (!src) return null

  return (
    <div className="mt-1 border-t border-[#e5e5e5] pt-1.5">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="text-[10px] text-[#6C5CE7] bg-transparent border-none cursor-pointer flex items-center gap-1"
        title="Inspect the first 0.5 seconds of this clip — TikTok / Reels weighs motion here heavily for retention."
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>🔬 First 0.5s inspector</span>
      </button>
      {open && (
        <div className="mt-1 space-y-1.5">
          <div className="flex items-start gap-2">
            <video
              ref={videoRef}
              src={src}
              muted
              playsInline
              preload="auto"
              crossOrigin={src.startsWith('blob:') ? undefined : 'anonymous'}
              className="w-[120px] h-[180px] bg-black rounded object-contain flex-shrink-0"
              onLoadedMetadata={() => {
                const v = videoRef.current
                if (v) try { v.currentTime = start } catch {}
              }}
            />
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setLooping(v => !v)}
                  className={`text-[10px] py-1 px-2 rounded cursor-pointer font-medium border ${
                    looping
                      ? 'bg-[#c0392b] text-white border-[#c0392b]'
                      : 'bg-[#6C5CE7] text-white border-[#6C5CE7]'
                  }`}
                  title={looping ? 'Stop the 0-0.5s loop' : `Loop the first ${LOOP_LEN.toFixed(1)}s after the trim cut on repeat`}
                >{looping ? '⏸ Stop loop' : `▶ Loop 0–${LOOP_LEN.toFixed(1)}s`}</button>
                <span className="text-[9px] text-muted">
                  {looping ? 'looping…' : (activeFrame != null ? `paused @ ${(activeFrame - start).toFixed(1)}s into clip` : 'idle')}
                </span>
                {start > 0 && (
                  <span className="text-[9px] text-muted italic ml-auto">
                    from trim @ {start.toFixed(1)}s
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {FRAMES.map((t) => {
                  const label = (t - start).toFixed(1)
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => seekTo(t)}
                      className={`text-[10px] py-1 px-2 rounded cursor-pointer font-mono border ${
                        Math.abs((activeFrame ?? -999) - t) < 0.001
                          ? 'border-[#6C5CE7] bg-[#6C5CE7]/10 text-[#6C5CE7] font-bold'
                          : 'border-[#e5e5e5] bg-white text-ink hover:border-[#6C5CE7]/50'
                      }`}
                      title={`Jump to ${label}s into the clip (${t.toFixed(1)}s in the source video)`}
                    >{label}s</button>
                  )
                })}
              </div>
              <div className="text-[9px] text-muted italic">
                TikTok and Reels weight motion in the first ~0.5s heavily for retention. If clip 1 is static here, recut.
              </div>
              {canReview && (
                <div className="pt-1.5 border-t border-[#e5e5e5] flex items-center gap-2">
                  <button
                    type="button"
                    onClick={runReview}
                    disabled={reviewing}
                    className="text-[10px] py-1 px-2 border border-[#000] bg-black text-white rounded cursor-pointer disabled:opacity-50 font-medium"
                    title="Run an AI vision analysis on these 6 frames with TikTok-specific scoring (motion, subject clarity, contrast, pattern interrupt, face/eye contact)"
                  >{reviewing ? '🔍 Analyzing…' : '🎵 TikTok 0.5s review'}</button>
                  {review && (
                    <span className="text-[10px] text-muted">
                      Overall: <span className="font-bold text-ink">{review.overall_score}/10</span>
                    </span>
                  )}
                </div>
              )}
              {reviewErr && (
                <div className="text-[10px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-1.5 mt-1">
                  {reviewErr}
                </div>
              )}
            </div>
          </div>
          {review && (
            <div className="mt-2 border border-[#e5e5e5] rounded p-2 space-y-1.5 bg-[#fafafa]">
              <div className="text-[10px] font-medium text-ink">{review.verdict || 'Analysis complete'}</div>
              <div className="grid grid-cols-2 gap-1 text-[10px]">
                <ScoreRow label="Motion velocity" value={review.motion_velocity} />
                <ScoreRow label="Subject clarity" value={review.subject_clarity} />
                <ScoreRow label="Contrast / pop" value={review.contrast_pop} />
                <ScoreRow label="Pattern interrupt" value={review.pattern_interrupt} />
                <ScoreRow label="Face / eye contact" value={review.face_eye_contact} />
                <ScoreRow label="Overall" value={review.overall_score} bold />
              </div>
              {Array.isArray(review.frame_notes) && review.frame_notes.length > 0 && (
                <div className="border-t border-[#e5e5e5] pt-1.5">
                  <div className="text-[9px] uppercase tracking-wide text-muted mb-0.5">Frame-by-frame</div>
                  {review.frame_notes.map((fn, i) => (
                    <div key={i} className="text-[10px] flex items-start gap-1.5">
                      <span className="font-mono text-muted shrink-0">{Number(fn.t).toFixed(1)}s</span>
                      <span className={`font-bold shrink-0 ${fn.score >= 7 ? 'text-[#2D9A5E]' : fn.score >= 5 ? 'text-[#d97706]' : 'text-[#c0392b]'}`}>{fn.score}/10</span>
                      <span className="text-ink break-words">{fn.note}</span>
                    </div>
                  ))}
                </div>
              )}
              {Array.isArray(review.suggestions) && review.suggestions.length > 0 && (
                <div className="border-t border-[#e5e5e5] pt-1.5">
                  <div className="text-[9px] uppercase tracking-wide text-muted mb-0.5">Suggestions</div>
                  {review.suggestions.map((s, i) => (
                    <div key={i} className="text-[10px] flex items-start gap-1.5">
                      <span className="text-[#6C5CE7] shrink-0">▸</span>
                      <span className="text-ink break-words">{s}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ScoreRow({ label, value, bold = false }) {
  const v = Number(value)
  if (!Number.isFinite(v)) return null
  const color = v >= 7 ? '#2D9A5E' : v >= 5 ? '#d97706' : '#c0392b'
  return (
    <div className={`flex items-center justify-between bg-white border border-[#e5e5e5] rounded px-1.5 py-0.5 ${bold ? 'font-bold' : ''}`}>
      <span className="text-muted">{label}</span>
      <span style={{ color }}>{v}/10</span>
    </div>
  )
}
