import { useState, useEffect, useRef } from 'react'

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
  const [src] = useState(() => URL.createObjectURL(file))
  const [videoDuration, setVideoDuration] = useState(0)
  const [trimStart, setTrimStart] = useState(() => item._trimStart ?? 0)
  const [trimEnd, setTrimEnd] = useState(() => item._trimEnd ?? null)
  const [trimThumbs, setTrimThumbs] = useState([])
  const stripRef = useRef(null)
  // Pointer-up closures need fresh values.
  const trimStartRef = useRef(trimStart)
  const trimEndRef = useRef(trimEnd)
  useEffect(() => { trimStartRef.current = trimStart }, [trimStart])
  useEffect(() => { trimEndRef.current = trimEnd }, [trimEnd])

  // Detect mobile — iOS/Android video seek-and-decode is much slower than
  // desktop, so we capture fewer frames and give the decoder more time.
  const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '')
  const FRAME_COUNT = isMobile ? 5 : 10
  // iOS in particular: seeks can silently hang, so we time them out rather
  // than wait forever.
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
      if (v.duration && isFinite(v.duration)) setVideoDuration(v.duration)
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
      // iOS returns a black canvas when seeking to exactly 0 — the decoder
      // isn't primed yet. Start a little past 0 and end a little before the
      // duration so both edges are decodable.
      const edgePad = isMobile ? 0.15 : 0.02
      const rangeStart = Math.min(edgePad, videoDuration * 0.02)
      const rangeEnd = Math.max(rangeStart, videoDuration - edgePad)
      for (let i = 0; i < FRAME_COUNT; i++) {
        if (cancelled) return
        const frac = FRAME_COUNT === 1 ? 0 : i / (FRAME_COUNT - 1)
        const t = rangeStart + (rangeEnd - rangeStart) * frac
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
        const t = Math.min(rangeEnd, rangeStart + (rangeEnd - rangeStart) * frac + 0.25)
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
    }
    capture()
    return () => { cancelled = true }
  }, [src, videoDuration])

  // Write-through to item + invalidate cached previews so any later post
  // or preview rebuild uses the new trim bounds.
  const commitTrim = (nextStart, nextEnd) => {
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
  }

  // Hidden video element — MUST be in the DOM for iOS Safari to decode
  // frames into canvas. It's 80×80 offscreen (1×1 is too small on iOS,
  // the decoder sometimes returns garbage) and invisible.
  const hiddenVideoEl = (
    <video
      ref={hiddenVideoRef}
      src={src}
      muted
      playsInline
      preload="auto"
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
        <span className="font-medium text-ink truncate max-w-[40%]" title={file.name}>Trim: {file.name}</span>
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
      <div
        ref={stripRef}
        className="relative h-[52px] rounded overflow-hidden bg-black select-none"
        style={{ touchAction: 'none' }}
      >
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
        {/* Progress indicator over partial filmstrip */}
        {trimThumbs.length > 0 && trimThumbs.length < thumbProgress.total && (
          <div className="absolute top-1 right-1 text-[8px] text-white/80 bg-black/50 rounded px-1 py-0.5 pointer-events-none">
            {thumbProgress.done}/{thumbProgress.total}
          </div>
        )}
        <div
          className="absolute top-0 bottom-0 left-0 bg-black/65 pointer-events-none"
          style={{ width: `${(trimStart / videoDuration) * 100}%` }}
        />
        <div
          className="absolute top-0 bottom-0 right-0 bg-black/65 pointer-events-none"
          style={{ width: `${(1 - (trimEnd ?? videoDuration) / videoDuration) * 100}%` }}
        />
        <div
          className="absolute top-0 bottom-0 border-y-[3px] border-[#f7c948] pointer-events-none"
          style={{
            left: `${(trimStart / videoDuration) * 100}%`,
            width: `${(((trimEnd ?? videoDuration) - trimStart) / videoDuration) * 100}%`,
          }}
        />
        {/* Left handle */}
        <div
          className="absolute top-0 bottom-0 w-3 bg-[#f7c948] rounded-l flex items-center justify-center shadow-md"
          style={{ left: `${(trimStart / videoDuration) * 100}%`, cursor: 'ew-resize' }}
          onPointerDown={e => {
            e.preventDefault()
            e.currentTarget.setPointerCapture?.(e.pointerId)
            const rect = stripRef.current?.getBoundingClientRect()
            if (!rect) return
            const maxT = Math.max(0, ((trimEnd ?? videoDuration) - 0.5))
            const onMove = (ev) => {
              const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
              const t = Math.max(0, Math.min(maxT, pct * videoDuration))
              setTrimStart(t)
            }
            const onUp = () => {
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)
              commitTrim(trimStartRef.current, trimEndRef.current)
            }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
          }}
        >
          <div className="w-[2px] h-4 bg-white/90 rounded pointer-events-none" />
        </div>
        {/* Right handle */}
        <div
          className="absolute top-0 bottom-0 w-3 bg-[#f7c948] rounded-r flex items-center justify-center shadow-md"
          style={{
            left: `${((trimEnd ?? videoDuration) / videoDuration) * 100}%`,
            transform: 'translateX(-100%)',
            cursor: 'ew-resize',
          }}
          onPointerDown={e => {
            e.preventDefault()
            e.currentTarget.setPointerCapture?.(e.pointerId)
            const rect = stripRef.current?.getBoundingClientRect()
            if (!rect) return
            const minT = Math.min(videoDuration, trimStart + 0.5)
            const onMove = (ev) => {
              const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
              const t = Math.max(minT, Math.min(videoDuration, pct * videoDuration))
              setTrimEnd(t >= videoDuration - 0.05 ? null : t)
            }
            const onUp = () => {
              window.removeEventListener('pointermove', onMove)
              window.removeEventListener('pointerup', onUp)
              commitTrim(trimStartRef.current, trimEndRef.current)
            }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
          }}
        >
          <div className="w-[2px] h-4 bg-white/90 rounded pointer-events-none" />
        </div>
      </div>
    </div>
  )
}
