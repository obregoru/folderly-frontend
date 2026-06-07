import { useState, useEffect, useRef } from 'react'
import * as api from '../api'
import { DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core'
import { sortableKeyboardCoordinates, SortableContext, arrayMove, useSortable, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// Centered 9:16 outline overlay. Shows the export frame on top of any
// video preview so the operator can see exactly what region will be in
// the final 1080×1920 portrait export. The outline:
//   - is sized to fill the parent's height with a 9:16 aspect ratio
//   - max-width 100% so portrait sources cap at the parent's width
//   - is purely cosmetic (pointer-events: none)
// Position the parent as `relative` and ensure it has a known height
// for the overlay to fit against (most video preview wrappers already do).
function ExportFrameOverlay({ withBadge = true }) {
  return (
    <>
      <div
        className="pointer-events-none absolute top-1/2 left-1/2 border-2 border-dashed border-white/70 rounded"
        style={{
          aspectRatio: '9 / 16',
          height: '100%',
          maxWidth: '100%',
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.25)', // dim everything outside the export frame
        }}
      />
      {withBadge && (
        <span className="pointer-events-none absolute top-1 left-1 text-[8px] font-medium bg-black/60 text-white rounded px-1.5 py-0.5">
          9:16 export
        </span>
      )}
    </>
  )
}

function MediaLightbox({ item, onClose }) {
  const file = item.file
  const isImg = item.isImg || item._mediaType?.startsWith('image/')
  const videoRef = useRef(null)
  // Mirror the zoom + anchor live preview from VideoThumb / RestoredMedia
  // so the lightbox shows the same framing the merge will produce. Listens
  // to posty-video-zoom-change so changing the selector elsewhere updates
  // the lightbox in real time.
  const [zoom, setZoom] = useState(() => Number(item._videoZoom) > 0 ? Number(item._videoZoom) : 1.0)
  const [offX, setOffX] = useState(() => Number.isFinite(Number(item._videoOffsetX)) ? Number(item._videoOffsetX) : 0)
  const [offY, setOffY] = useState(() => Number.isFinite(Number(item._videoOffsetY)) ? Number(item._videoOffsetY) : 0)
  const [motion, setMotion] = useState(() => typeof item._videoMotion === 'string' && item._videoMotion ? item._videoMotion : 'static')
  // Operator's per-file force-rotate override. Mirrored into local
  // state via the posty-force-rotate-change event so toggling on a
  // tile updates the lightbox in real time.
  const [forceRotate, setForceRotate] = useState(() => Number(item._forceRotate) || 0)
  useEffect(() => {
    if (isImg) return
    const onChange = (e) => {
      if (e.detail?.itemId !== item.id) return
      setZoom(Number(item._videoZoom) > 0 ? Number(item._videoZoom) : 1.0)
      setOffX(Number.isFinite(Number(item._videoOffsetX)) ? Number(item._videoOffsetX) : 0)
      setOffY(Number.isFinite(Number(item._videoOffsetY)) ? Number(item._videoOffsetY) : 0)
      setMotion(typeof item._videoMotion === 'string' && item._videoMotion ? item._videoMotion : 'static')
    }
    const onRotateChange = (e) => {
      if (e.detail?.itemId !== item.id) return
      setForceRotate(Number(item._forceRotate) || 0)
    }
    window.addEventListener('posty-video-zoom-change', onChange)
    window.addEventListener('posty-force-rotate-change', onRotateChange)
    return () => {
      window.removeEventListener('posty-video-zoom-change', onChange)
      window.removeEventListener('posty-force-rotate-change', onRotateChange)
    }
  }, [item, isImg])
  // Static-mode origin only. Animated motion (zoom-in / zoom-out /
  // pan-lr / pan-rl / combined) drives transform-origin per-frame in
  // the rAF loop below; staticOriginX/Y is the fallback for the
  // non-animated case.
  const staticOriginX = 50 + offX / 2
  const staticOriginY = 50 + offY / 2

  // Ken Burns preview. The merge BE animates the ffmpeg crop window
  // per-frame; the lightbox is the operator's "is this the look I
  // want?" preview, so it needs to animate too. Without this the
  // lightbox shows a static scale even when motion is set, and the
  // operator can't validate the effect without running a merge.
  //
  // We drive the animation off video.currentTime (NOT wall clock) so
  // the effect tracks scrubs / pauses / loops naturally — pausing the
  // video freezes the Ken Burns where it is, scrubbing the playhead
  // moves the crop window with it.
  useEffect(() => {
    if (isImg) return
    const v = videoRef.current
    if (!v) return
    // Helper to build a combined transform string for either the
    // static reset OR the animated tick. Rotation is prepended so
    // it acts on the source orientation; scale then zooms the
    // rotated frame.
    const rotateStr = forceRotate ? `rotate(${forceRotate}deg) ` : ''
    if (motion === 'static') {
      // Reset to the static framing — clean up any animation residue
      // from a prior non-static motion when the user flips back.
      const z = zoom
      const oX = staticOriginX
      const oY = staticOriginY
      if (z !== 1 || forceRotate) {
        v.style.transform = `${rotateStr}${z !== 1 ? `scale(${z})` : ''}`.trim()
        v.style.transformOrigin = `${oX}% ${oY}%`
      } else {
        v.style.transform = ''
        v.style.transformOrigin = ''
      }
      return
    }
    let rafId = null
    const KB_DELTA = 0.15
    const hasZoomIn = motion.includes('zoom-in')
    const hasZoomOut = motion.includes('zoom-out')
    const hasPanLR = motion.includes('pan-lr')
    const hasPanRL = motion.includes('pan-rl')
    // Pan motions need spare canvas; the BE bumps baseZoom to 1.25
    // when pan + zoom=1. Mirror that here so the lightbox preview
    // matches what the merge will produce even if the operator
    // hasn't bumped zoom themselves.
    const effectiveBase = (hasPanLR || hasPanRL) && zoom < 1.25 ? 1.25 : zoom
    const tick = () => {
      const start = Number(item._trimStart) || 0
      const end = item._trimEnd != null ? Number(item._trimEnd) : (v.duration || start + 1)
      const dur = Math.max(0.01, end - start)
      // Progress through the trim range, clamped to [0,1].
      const t = Math.max(0, Math.min(1, ((v.currentTime || 0) - start) / dur))

      // Zoom factor matches lib/video.js merge math: baseZoom is the
      // floor, KB_DELTA = 15% delta animated on top.
      let zoomT = effectiveBase
      if (hasZoomIn) zoomT = effectiveBase * (1 + KB_DELTA * t)
      else if (hasZoomOut) zoomT = effectiveBase * (1 + KB_DELTA - KB_DELTA * t)

      // transform-origin x sweeps for pan motions. transform-origin
      // 0% means the LEFT edge of the source is the scale anchor (so
      // the right side is what you see scaled-up) — that visually
      // matches "pan starts from the left edge of the source." The
      // BE merge crop has the opposite mapping (x=0 means crop FROM
      // the left edge, which shows the LEFT half), so we flip the
      // direction here. pan-lr in the merge moves the crop window
      // L→R, which means the VISIBLE region moves L→R, which in CSS
      // is transform-origin going from 100% → 0% as t goes 0→1.
      let originX = 50 + offX / 2 // static + nudge fallback
      if (hasPanLR) {
        originX = 100 - 100 * t + offX / 2
      } else if (hasPanRL) {
        originX = 100 * t + offX / 2
      }
      const originY = 50 + offY / 2

      v.style.transform = `${rotateStr}scale(${zoomT})`.trim()
      v.style.transformOrigin = `${originX}% ${originY}%`

      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => { if (rafId != null) cancelAnimationFrame(rafId) }
  }, [isImg, motion, zoom, offX, offY, staticOriginX, staticOriginY, item, forceRotate])
  const [src] = useState(() => {
    if (file instanceof Blob || file instanceof File) return URL.createObjectURL(file)
    // Restored file — prefer Supabase public URL (no auth, no memory pressure)
    if (item._publicUrl) return item._publicUrl
    if (item._uploadKey && item._tenantSlug) {
      return `${import.meta.env.VITE_API_URL || ''}/api/t/${item._tenantSlug}/upload/serve?key=${encodeURIComponent(item._uploadKey)}`
    }
    return null
  })

  // Read the current trim bounds from the item. We read at mount AND on
  // every render so the user can re-trim while the lightbox is open and
  // the next play cycle picks up the new bounds.
  const trimStart = item._trimStart || 0
  const trimEnd = item._trimEnd ?? null

  // Mirror the per-clip speed (the same value the merge applies). The
  // lightbox is the operator's "what does this clip look like in the
  // final video" preview, so playing at the rendered rate matches
  // expectations — otherwise a clip configured for 2× plays at 1× in
  // the lightbox and the operator can't validate pacing without
  // running a full merge.
  useEffect(() => {
    if (isImg) return
    const v = videoRef.current
    if (!v) return
    const applyRate = () => {
      const sp = Number(item._speed)
      v.playbackRate = sp > 0 ? sp : 1.0
    }
    // Apply once now (handles re-renders mid-playback) AND on
    // loadedmetadata (some browsers reset playbackRate when src
    // metadata lands).
    applyRate()
    v.addEventListener('loadedmetadata', applyRate)
    // Subscribe to posty-speed-change for this item — VideoMerge
    // mutates item._speed in place and fires the event; without
    // listening here the lightbox would keep the old rate until
    // reopened.
    const onSpeedChange = (e) => {
      if (e.detail?.itemId && e.detail.itemId !== item.id) return
      applyRate()
    }
    window.addEventListener('posty-speed-change', onSpeedChange)
    return () => {
      v.removeEventListener('loadedmetadata', applyRate)
      window.removeEventListener('posty-speed-change', onSpeedChange)
    }
  }, [isImg, item])

  // Enforce trim on the lightbox video: seek to trimStart on play, pause
  // (and reset) when currentTime reaches trimEnd. Uses refs via closure
  // so the latest trim values apply on every tick.
  useEffect(() => {
    if (isImg) return
    const v = videoRef.current
    if (!v) return
    // Clamp initial play position to the trim start.
    const onLoaded = () => {
      try { v.currentTime = trimStart } catch {}
    }
    const onTimeUpdate = () => {
      const end = item._trimEnd ?? (v.duration || Infinity)
      const start = item._trimStart || 0
      if (v.currentTime >= end - 0.03) {
        // Loop back to trim start — feels more like a preview than a hard stop.
        try { v.currentTime = start } catch {}
        if (!v.paused) v.play().catch(() => {})
      } else if (v.currentTime < start - 0.03) {
        try { v.currentTime = start } catch {}
      }
    }
    const onPlay = () => {
      const start = item._trimStart || 0
      if (v.currentTime < start || v.currentTime >= (item._trimEnd ?? Infinity) - 0.03) {
        try { v.currentTime = start } catch {}
      }
    }
    v.addEventListener('loadedmetadata', onLoaded)
    v.addEventListener('timeupdate', onTimeUpdate)
    v.addEventListener('play', onPlay)
    return () => {
      v.removeEventListener('loadedmetadata', onLoaded)
      v.removeEventListener('timeupdate', onTimeUpdate)
      v.removeEventListener('play', onPlay)
    }
  }, [isImg])

  const hasTrim = trimStart > 0 || trimEnd != null

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative max-w-[90vw] max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-ink text-lg flex items-center justify-center shadow cursor-pointer border-none z-10">&times;</button>
        {!src ? (
          <div className="text-white text-[13px] p-8">No preview available — file needs to be re-uploaded</div>
        ) : isImg ? (
          <img src={src} className="max-w-full max-h-[80vh] rounded object-contain" />
        ) : (
          // Wrap the video in a relative inline-block so the wrapper
          // hugs the video's rendered size and the 9:16 export-frame
          // overlay can size to it. Without the wrapper the overlay
          // would size to the outer modal padding box, which doesn't
          // match the video. Use overflow-hidden so the zoomed video
          // is clipped to the wrapper bounds (the visible area
          // outside the 9:16 outline is still part of the source —
          // just not the export region).
          <div className="relative inline-block overflow-hidden rounded">
            <video
              ref={videoRef}
              src={src}
              controls
              playsInline
              crossOrigin={src && !src.startsWith('blob:') ? 'anonymous' : undefined}
              className="max-w-full max-h-[80vh] rounded block"
              // Static-mode transform; animated motion overwrites
              // .style.transform per-frame in the Ken Burns rAF loop
              // above. Including the static value here lets the
              // initial render show the correct framing before the
              // loop kicks in. Rotation gets chained in BEFORE the
              // scale so it acts on the source orientation; scale
              // then zooms the rotated frame.
              style={(() => {
                const parts = []
                if (forceRotate) parts.push(`rotate(${forceRotate}deg)`)
                if (zoom !== 1 && motion === 'static') parts.push(`scale(${zoom})`)
                if (parts.length === 0) return undefined
                return {
                  transform: parts.join(' '),
                  transformOrigin: zoom !== 1 && motion === 'static' ? `${staticOriginX}% ${staticOriginY}%` : 'center center',
                }
              })()}
            />
            <ExportFrameOverlay />
            {(hasTrim || (Number(item._speed) > 0 && Number(item._speed) !== 1) || motion !== 'static') && (
              <div className="absolute bottom-12 left-1/2 -translate-x-1/2 text-[10px] text-white bg-black/70 rounded-full px-2.5 py-1 pointer-events-none">
                {hasTrim && <>Trimmed preview: {trimStart.toFixed(1)}s → {trimEnd != null ? `${trimEnd.toFixed(1)}s` : 'end'}</>}
                {hasTrim && Number(item._speed) > 0 && Number(item._speed) !== 1 && <> · </>}
                {Number(item._speed) > 0 && Number(item._speed) !== 1 && <>Playing at {Number(item._speed)}×</>}
                {(hasTrim || (Number(item._speed) > 0 && Number(item._speed) !== 1)) && motion !== 'static' && <> · </>}
                {motion !== 'static' && <>Motion: {motion.replace(/-/g, ' ')}</>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function VideoThumb({ file, onClick, className, itemId, item }) {
  const videoRef = useRef(null)
  const [poster, setPoster] = useState(null)
  const [aspect, setAspect] = useState(null)
  const [src] = useState(() => file instanceof Blob || file instanceof File ? URL.createObjectURL(file) : null)
  // Live zoom + crop-anchor preview. Re-reads zoom/offsets on every
  // posty-video-zoom-change so any selector (VideoZoomBar under the
  // tile, VideoMerge panel) updates this preview instantly without a
  // parent re-render. transform-origin maps offset [-100..+100] →
  // CSS [0%..100%] so the same anchor logic the BE crop uses applies
  // visually.
  const [zoom, setZoom] = useState(() => Number(item?._videoZoom) > 0 ? Number(item._videoZoom) : 1.0)
  const [offX, setOffX] = useState(() => Number.isFinite(Number(item?._videoOffsetX)) ? Number(item._videoOffsetX) : 0)
  const [offY, setOffY] = useState(() => Number.isFinite(Number(item?._videoOffsetY)) ? Number(item._videoOffsetY) : 0)
  const [forceRotate, setForceRotate] = useState(() => Number(item?._forceRotate) || 0)
  useEffect(() => {
    const onChange = (e) => {
      if (e.detail?.itemId !== itemId) return
      setZoom(Number(item?._videoZoom) > 0 ? Number(item._videoZoom) : 1.0)
      setOffX(Number.isFinite(Number(item?._videoOffsetX)) ? Number(item._videoOffsetX) : 0)
      setOffY(Number.isFinite(Number(item?._videoOffsetY)) ? Number(item._videoOffsetY) : 0)
    }
    const onRotateChange = (e) => {
      if (e.detail?.itemId !== itemId) return
      setForceRotate(Number(item?._forceRotate) || 0)
    }
    window.addEventListener('posty-video-zoom-change', onChange)
    window.addEventListener('posty-force-rotate-change', onRotateChange)
    return () => {
      window.removeEventListener('posty-video-zoom-change', onChange)
      window.removeEventListener('posty-force-rotate-change', onRotateChange)
    }
  }, [itemId, item])
  // transform-origin formula matches the BE crop anchor:
  //   offset = -100 → 0%   (anchor at left/top edge)
  //   offset =    0 → 50%  (center)
  //   offset = +100 → 100% (anchor at right/bottom edge)
  const originX = 50 + offX / 2
  const originY = 50 + offY / 2

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    let cancelled = false
    let captured = false

    // Read rotation-corrected dimensions so the container sizes correctly
    // even if we never manage to paint a poster frame (iOS can be stubborn).
    const readAspect = () => {
      const w = v.videoWidth, h = v.videoHeight
      if (w && h && !aspect) setAspect(w / h)
    }

    // Attempt to draw the current video frame to canvas. iOS Safari silently
    // returns all-black frames until the video has started decoding (play()
    // triggers that), so we sample a 10×10 region and retry on black.
    const tryCapture = () => {
      if (cancelled || captured) return
      const w = v.videoWidth, h = v.videoHeight
      if (!w || !h) return
      try {
        const c = document.createElement('canvas')
        c.width = Math.min(w, 300)
        c.height = Math.round(c.width * h / w)
        const ctx = c.getContext('2d')
        ctx.drawImage(v, 0, 0, c.width, c.height)
        const sw = Math.min(c.width, 10), sh = Math.min(c.height, 10)
        const pixels = ctx.getImageData(0, 0, sw, sh).data
        let sum = 0
        for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2]
        if (sum < 50) return // black frame — wait for the next event
        captured = true
        setPoster(c.toDataURL('image/jpeg', 0.7))
      } catch {}
    }

    // On metadata load, kick the video briefly so iOS decodes a real frame.
    // muted + playsInline (already set below) satisfy autoplay policy.
    const onMeta = async () => {
      readAspect()
      try {
        v.muted = true
        const p = v.play()
        if (p && typeof p.then === 'function') await p
        setTimeout(() => { try { v.pause() } catch {} }, 80)
      } catch {
        // Autoplay blocked — desktop browsers typically still paint anyway,
        // so we fall through and rely on the seeked/canplay listeners.
      }
      try { v.currentTime = Math.min(0.5, (v.duration || 1) / 2) } catch {}
    }

    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('loadeddata', tryCapture)
    v.addEventListener('seeked', tryCapture)
    v.addEventListener('canplay', tryCapture)
    v.addEventListener('playing', tryCapture)

    return () => {
      cancelled = true
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('loadeddata', tryCapture)
      v.removeEventListener('seeked', tryCapture)
      v.removeEventListener('canplay', tryCapture)
      v.removeEventListener('playing', tryCapture)
    }
  }, [])

  // Store thumb + aspect on the file object so ResultCard can reuse it
  useEffect(() => {
    if (poster) file._videoThumb = poster
    if (aspect) file._videoAspect = aspect
  }, [poster, aspect])

  // Effective aspect after the force-rotate override. CSS transform:
  // rotate() doesn't change the layout box, so we have to swap the
  // displayed aspect manually when rotation is 90° or 270°.
  const effectiveAspect = (forceRotate === 90 || forceRotate === 270) && aspect
    ? 1 / aspect
    : aspect
  const isPortrait = effectiveAspect && effectiveAspect < 1
  const height = isPortrait ? 260 : 120

  // Build combined transform: rotation first (acts on source pixels),
  // then scale (zooms the rotated frame). When neither applies, omit
  // the style so the browser default kicks in.
  const tileTransformParts = []
  if (forceRotate) tileTransformParts.push(`rotate(${forceRotate}deg)`)
  if (zoom !== 1) tileTransformParts.push(`scale(${zoom})`)
  const tileTransform = tileTransformParts.length ? tileTransformParts.join(' ') : undefined
  // For 90°/270° rotations, the rotated frame is taller than it is
  // wide (or vice versa). Sizing the <video> as w-full h-full and
  // applying object-cover would chop off most of the rotated frame
  // because the underlying box stays at the parent's W×H. Instead,
  // when rotated, we size the video as height-by-aspect — height
  // matches the parent's height, width is the post-rotation aspect.
  const rotatedVideoStyle = (forceRotate === 90 || forceRotate === 270)
    ? { width: 'auto', height: '100%', display: 'block', margin: '0 auto', objectFit: 'contain' }
    : null
  return (
    <div onClick={onClick} className={`relative cursor-pointer hover:opacity-80 overflow-hidden flex items-center justify-center ${className || ''}`} style={{ height }}>
      <video
        ref={videoRef}
        data-posty-item-id={itemId}
        src={src}
        poster={poster || undefined}
        className={rotatedVideoStyle ? '' : 'w-full h-full object-cover'}
        muted playsInline preload="auto"
        // Live zoom + anchor preview matching the BE crop math.
        // transform-origin moves the scaling pivot to the chosen anchor.
        style={{
          ...(rotatedVideoStyle || {}),
          ...(tileTransform ? { transform: tileTransform, transformOrigin: `${originX}% ${originY}%` } : {}),
        }}
      />
      <ExportFrameOverlay />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-white text-[18px] bg-black/50 rounded-full w-8 h-8 flex items-center justify-center">▶</span>
      </div>
      {zoom !== 1 && (
        <div className="absolute bottom-1 right-1 text-[9px] font-medium bg-[#6C5CE7] text-white rounded px-1.5 py-0.5 pointer-events-none">
          {zoom}× zoom
        </div>
      )}
    </div>
  )
}

// Restored file thumbnail — measures aspect ratio on load so vertical
// videos get the tall layout (260px) like fresh portrait uploads.
// Renders the red "Source file missing" placeholder + an optional
// "📁 Replace source" button that opens a file picker and calls
// onReplace(item, file) when one is chosen. Used in two spots:
// the RestoredMedia fallback (FE-detected load failure) and the
// main tile (BE-flagged storage_missing). Same button, same UX.
function MissingSourcePlaceholder({ item, onClick, onReplace }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const handlePick = async (e) => {
    const file = e.target?.files?.[0]
    e.target.value = ''
    if (!file || !onReplace) return
    setBusy(true); setErr(null)
    try {
      await onReplace(item, file)
    } catch (e2) {
      setErr(e2?.message || String(e2))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      onClick={onClick}
      className="w-full h-[120px] bg-[#fdf2f1] border-b border-[#c0392b]/30 flex flex-col items-center justify-center text-[#c0392b] text-center px-2 gap-0.5 cursor-pointer"
    >
      <span className="text-[20px]">⚠</span>
      <span className="text-[9px] font-medium leading-tight">Source file missing</span>
      {onReplace && item?._dbFileId != null ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/*"
            onChange={handlePick}
            style={{ display: 'none' }}
          />
          <button
            onClick={(e) => { e.stopPropagation(); inputRef.current?.click() }}
            disabled={busy}
            className="text-[9px] py-0.5 px-1.5 bg-white border border-[#c0392b] rounded cursor-pointer mt-1 disabled:opacity-50"
            title="Pick a new file to replace the missing source. The clip keeps its trim, speed, order, and effects."
          >{busy ? 'Uploading…' : '📁 Replace source'}</button>
          {err && <span className="text-[8px] text-[#c0392b]/90 leading-tight">{err.slice(0, 60)}</span>}
        </>
      ) : (
        <span className="text-[8px] text-[#c0392b]/80 leading-tight">Skip ⊘ or remove ✕</span>
      )}
    </div>
  )
}

function RestoredMedia({ item, isVideo, onClick, onStorageMissing, onReplaceSource }) {
  const [aspect, setAspect] = useState(() => item._videoDuration && item._videoAspect ? item._videoAspect : null)
  useEffect(() => { if (aspect != null) item._videoAspect = aspect }, [aspect, item])
  // Live zoom + anchor preview for restored video clips. Mirrors VideoThumb.
  const [zoom, setZoom] = useState(() => Number(item._videoZoom) > 0 ? Number(item._videoZoom) : 1.0)
  const [offX, setOffX] = useState(() => Number.isFinite(Number(item._videoOffsetX)) ? Number(item._videoOffsetX) : 0)
  const [offY, setOffY] = useState(() => Number.isFinite(Number(item._videoOffsetY)) ? Number(item._videoOffsetY) : 0)
  const [forceRotate, setForceRotate] = useState(() => Number(item._forceRotate) || 0)
  useEffect(() => {
    const onChange = (e) => {
      if (e.detail?.itemId !== item.id) return
      setZoom(Number(item._videoZoom) > 0 ? Number(item._videoZoom) : 1.0)
      setOffX(Number.isFinite(Number(item._videoOffsetX)) ? Number(item._videoOffsetX) : 0)
      setOffY(Number.isFinite(Number(item._videoOffsetY)) ? Number(item._videoOffsetY) : 0)
    }
    const onRotateChange = (e) => {
      if (e.detail?.itemId !== item.id) return
      setForceRotate(Number(item._forceRotate) || 0)
    }
    window.addEventListener('posty-video-zoom-change', onChange)
    window.addEventListener('posty-force-rotate-change', onRotateChange)
    return () => {
      window.removeEventListener('posty-video-zoom-change', onChange)
      window.removeEventListener('posty-force-rotate-change', onRotateChange)
    }
  }, [item])
  const originX = 50 + offX / 2
  const originY = 50 + offY / 2
  // Local fallback for the case where the BE didn't yet flag the row
  // as storage_missing (e.g. an old deploy still serving). When the
  // video / img errors out trying to load the source, flip this flag
  // and render the same warning placeholder the BE-flagged rows show.
  // Also call onStorageMissing so the parent can lift the flag into
  // the files state — that's what unmounts VideoTrimmer + suppresses
  // re-fetches on subsequent renders.
  const [loadFailed, setLoadFailed] = useState(!!item._storageMissing)
  const markMissing = () => {
    if (loadFailed) return
    item._storageMissing = true
    setLoadFailed(true)
    if (typeof onStorageMissing === 'function') {
      try { onStorageMissing(item.id) } catch {}
    }
  }
  if (loadFailed) {
    return <MissingSourcePlaceholder item={item} onClick={onClick} onReplace={onReplaceSource} />
  }
  // Effective aspect after force-rotate. CSS transform: rotate()
  // doesn't change the layout box, so we have to swap displayed
  // aspect manually when rotation is 90° or 270° to keep the
  // container tall enough for the rotated frame.
  const effectiveAspect = (forceRotate === 90 || forceRotate === 270) && aspect != null
    ? 1 / aspect
    : aspect
  const isPortrait = effectiveAspect != null && effectiveAspect < 1
  const isPhoto = !isVideo
  // Photo tiles render in a 16:9 outer container (matches video
  // tile feel) with a 9:16 outline marking the actual export
  // frame INSIDE — see ImageThumb for the same treatment. Videos
  // keep their height-by-aspect treatment because they're trim/
  // duration controlled, not crop framed.
  // Photo tile aspect matches the export (9:16). Constrained max-width
  // so portrait tiles don't blow up too tall in the grid.
  const tileStyle = isPhoto
    ? { aspectRatio: '9 / 16', maxWidth: '180px', marginInline: 'auto' }
    : { height: isPortrait ? 260 : 120 }
  // When rotated 90°/270°, the <video> element's layout box stays the
  // pre-rotation size (CSS transform happens AFTER layout). Sizing
  // with width=auto + height=100% lets the rotated frame use the
  // container's full height without being clipped to the pre-rotate
  // box.
  const restoredRotatedStyle = (forceRotate === 90 || forceRotate === 270)
    ? { width: 'auto', height: '100%', display: 'block', margin: '0 auto', objectFit: 'contain' }
    : null
  const src = item._publicUrl || `${import.meta.env.VITE_API_URL || ''}/api/t/${item._tenantSlug || ''}/upload/serve?key=${encodeURIComponent(item._uploadKey)}`
  return (
    <div onClick={onClick} className="w-full bg-black flex items-center justify-center cursor-pointer hover:opacity-80 relative overflow-hidden" style={tileStyle}>
      {isVideo ? (
        <>
          <video
            data-posty-item-id={item.id}
            src={src}
            className={restoredRotatedStyle ? '' : 'w-full h-full object-contain'}
            muted playsInline preload="metadata"
            // Use the first captured trim thumbnail as the poster. iOS Safari
            // won't paint the first frame of a <video> until playback starts,
            // so without a poster the tile stays black on mobile. The
            // trim_thumbs array is persisted with the job and arrives as data
            // URLs — perfect for a poster.
            poster={Array.isArray(item._trimThumbs) && item._trimThumbs[0] ? item._trimThumbs[0] : undefined}
            onLoadedMetadata={e => {
              const v = e.target
              if (aspect == null && v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight)
            }}
            onLoadedData={e => { try { e.target.currentTime = item._trimStart || 0.5 } catch {} }}
            onError={markMissing}
            // Live zoom + anchor + rotation preview matching the merge-time
            // semantic. Rotation prepends so it operates on the source
            // pixels; zoom then magnifies the rotated frame.
            style={(() => {
              const parts = []
              if (forceRotate) parts.push(`rotate(${forceRotate}deg)`)
              if (zoom !== 1) parts.push(`scale(${zoom})`)
              const transformStyle = parts.length ? { transform: parts.join(' '), transformOrigin: `${originX}% ${originY}%` } : null
              if (restoredRotatedStyle || transformStyle) {
                return { ...(restoredRotatedStyle || {}), ...(transformStyle || {}) }
              }
              return undefined
            })()}
          />
          <ExportFrameOverlay />
          {zoom !== 1 && (
            <div className="absolute bottom-1 right-1 text-[9px] font-medium bg-[#6C5CE7] text-white rounded px-1.5 py-0.5 pointer-events-none">
              {zoom}× zoom
            </div>
          )}
        </>
      ) : (
        // Photo thumb on a restored draft. Same 16:9 outer + 9:16
        // outline inside as ImageThumb. Image fills the outer 16:9
        // tile so cropped regions are visible outside the outline.
        (() => {
          const z = Number(item._photoZoom) > 0 ? Number(item._photoZoom) : 1.0
          const r = Number.isFinite(Number(item._photoRotate)) ? Number(item._photoRotate) : 0
          const ox = Number.isFinite(Number(item._photoOffsetX)) ? Number(item._photoOffsetX) / 4 : 0
          const oy = Number.isFinite(Number(item._photoOffsetY)) ? Number(item._photoOffsetY) / 4 : 0
          return (
            <>
              <img
                src={src}
                className="w-full h-full"
                style={{
                  // Tile is 9:16 (the export aspect) so cover fills
                  // edge-to-edge; matches the BE photoToVideo crop
                  // for landscape/square sources. Contain when zoom<1
                  // so the user can see the letterboxed preview.
                  objectFit: z < 1 ? 'contain' : 'cover',
                  transform: `rotate(${r}deg) scale(${z}) translate(${-ox}%, ${-oy}%)`,
                  transformOrigin: 'center center',
                  imageOrientation: 'from-image',
                }}
                onLoad={e => { if (aspect == null && e.target.naturalWidth && e.target.naturalHeight) setAspect(e.target.naturalWidth / e.target.naturalHeight) }}
                onError={markMissing}
              />
              <span className="absolute top-1 left-1 text-[8px] bg-black/55 text-white rounded px-1 py-0.5 pointer-events-none">9:16</span>
            </>
          )
        })()
      )}
      {isVideo && <span className="absolute text-white text-[18px] bg-black/50 rounded-full w-8 h-8 flex items-center justify-center">▶</span>}
    </div>
  )
}

function ImageThumb({ file, zoom, rotate, offsetX, offsetY, onClick }) {
  const [src] = useState(() => file instanceof Blob || file instanceof File ? URL.createObjectURL(file) : null)
  const [aspect, setAspect] = useState(() => file._imgAspect || null)
  useEffect(() => { if (aspect != null) file._imgAspect = aspect }, [aspect])
  // Photo tile aspect = the export aspect (9:16). What you see in the
  // tile is what gets exported. Cover crops to the 9:16 frame for
  // landscape/square sources (matching the BE photoToVideo middle
  // crop) and fills edge-to-edge for 9:16 sources. zoom > 1 magnifies
  // past the frame edges (visible as cropped); zoom < 1 letterboxes.
  const z = Number(zoom) > 0 ? Number(zoom) : 1.0
  const r = Number.isFinite(Number(rotate)) ? Number(rotate) : 0
  // Pan offsets are -100..+100 percent (BE clamp range). For the
  // thumbnail we apply translate(X%, Y%) where the percentages are
  // relative to the IMG's own dimensions. ÷4 keeps thumbnail nudge
  // proportional — a +100 pan in the BE is "shift to canvas edge"
  // which on the thumbnail looks like ~25% of element width (because
  // the canvas is ~2× target). Empirically this matches.
  const ox = Number.isFinite(Number(offsetX)) ? Number(offsetX) / 4 : 0
  const oy = Number.isFinite(Number(offsetY)) ? Number(offsetY) / 4 : 0
  return (
    <div
      onClick={onClick}
      className="w-full block bg-black overflow-hidden cursor-pointer hover:opacity-80 relative mx-auto"
      style={{ aspectRatio: '9 / 16', maxWidth: '180px' }}
    >
      <img
        src={src}
        onLoad={e => { if (aspect == null && e.target.naturalWidth && e.target.naturalHeight) setAspect(e.target.naturalWidth / e.target.naturalHeight) }}
        className="w-full h-full"
        style={{
          imageOrientation: 'from-image',
          objectFit: z < 1 ? 'contain' : 'cover',
          transform: `rotate(${r}deg) scale(${z}) translate(${-ox}%, ${-oy}%)`,
          transformOrigin: 'center center',
        }}
      />
      <span className="absolute top-1 left-1 text-[8px] bg-black/55 text-white rounded px-1 py-0.5 pointer-events-none">9:16</span>
    </div>
  )
}

// Each grid tile is a Sortable so user can drag-reorder photos. Order
// matters for photo-carousel posts and photo-sourced Reels/Shorts where
// the sequence becomes the video timeline. Videos don't need reorder
// here — VideoMerge has its own sortable list for that — but the photo
// case was missing entirely.
//
// IMPORTANT: useSortable must only be called inside a DndContext subtree,
// otherwise iOS Safari (and some other browsers) throw / blank the page.
// We only mount this component when reorder is actually enabled so the
// hook is always reachable from a matching DndContext.
function SortableTile({ item, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 0,
    opacity: isDragging ? 0.7 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children({ dragHandle: listeners })}
    </div>
  )
}

export default function FileGrid({ files, onRemove, onReorder, onDuplicate, onSplit, onReplaceSource, onToggleSkip, onStorageMissing, VideoTrimmer, PhotoDurationBar }) {
  const [previewItem, setPreviewItem] = useState(null)

  // Speed updates from VideoMerge mutate item._speed in place and
  // fire posty-speed-change rather than going through React state.
  // Bump a counter on the event so the per-tile speed badge re-reads
  // _speed and re-renders. Without this the badge would only update
  // when something ELSE triggered a FileGrid re-render.
  const [, setSpeedTick] = useState(0)
  useEffect(() => {
    const onSpeedChange = () => setSpeedTick(t => t + 1)
    window.addEventListener('posty-speed-change', onSpeedChange)
    return () => window.removeEventListener('posty-speed-change', onSpeedChange)
  }, [])

  // Only put the sensors together when we actually have more than one
  // orderable item; avoids pointer-sensor overhead for single-file drafts.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (!files.length) return null

  const hasVideos = files.some(f => f.file?.type?.startsWith('video/') || f._mediaType?.startsWith('video/'))
  // Reorder enabled whenever there are 2+ files. Originally gated on
  // !hasVideos because we worried about trim-bar touches competing
  // with drag listeners — but SortableTile only attaches listeners to
  // the dedicated ⋮⋮ drag handle (top-left of each tile), so the trim
  // bar (bottom of tile) is untouched. Operators specifically asked
  // for video reorder on the preview grid so they can tell apart
  // intentional duplicate uploads.
  const reorderEnabled = !!onReorder && files.length > 1

  const handleDragEnd = (e) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = files.findIndex(f => f.id === active.id)
    const to   = files.findIndex(f => f.id === over.id)
    if (from < 0 || to < 0) return
    onReorder(from, to)
  }

  const sortableIds = files.map(f => f.id)

  const grid = (
    <div className={hasVideos ? "flex flex-col gap-2" : "grid gap-2"} style={hasVideos ? undefined : { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
      {files.map((item, i) => {
        const isVideo = item.file?.type?.startsWith('video/') || item._mediaType?.startsWith('video/')
        const isImg = item.isImg || item._mediaType?.startsWith('image/')
        const fileName = item.file?.name || item._filename || 'Untitled'
        const isSkipped = !!item._skipInMerge
        const tile = ({ dragHandle } = {}) => (
          <>
            <div className={`border border-border rounded-sm overflow-hidden bg-white relative ${isSkipped ? 'opacity-50' : ''}`}>
              {/* Diagonal-stripe overlay for skipped clips — visible at
                  a glance without hiding the thumbnail. pointer-events
                  none so it doesn't eat clicks on the tile / buttons. */}
              {isSkipped && (
                <div
                  className="absolute inset-0 z-[4] pointer-events-none"
                  style={{
                    background: 'repeating-linear-gradient(45deg, rgba(192,57,43,0.18) 0 8px, transparent 8px 16px)',
                  }}
                />
              )}
              {isSkipped && (
                <span className="absolute bottom-1 right-1 z-[5] text-white bg-[#c0392b] text-[9px] font-bold rounded px-1.5 py-0.5 leading-none pointer-events-none">SKIPPED</span>
              )}
              {reorderEnabled && (
                <span
                  {...(dragHandle || {})}
                  className="absolute top-1 left-1 z-[5] text-white bg-black/55 rounded text-[10px] leading-none px-1.5 py-1 cursor-grab active:cursor-grabbing select-none"
                  style={{ touchAction: 'none' }}
                  title="Drag to reorder"
                >⋮⋮</span>
              )}
              {/* Sequence badge — always shown when there's more than one
                  tile so operators can disambiguate intentional duplicate
                  uploads. Index matches the merge-panel "1.", "2." pos
                  labels because both render from the same files[] order. */}
              {files.length > 1 && (
                <span className="absolute bottom-6 left-1 z-[5] text-white bg-[#6C5CE7]/90 rounded-full text-[9px] font-bold w-[18px] h-[18px] flex items-center justify-center leading-none pointer-events-none">{i + 1}</span>
              )}
              {/* Speed badge — only shown when speed deviates from 1× so
                  default-speed clips stay visually clean. Reads off the
                  same item._speed value the merge panel writes; the
                  posty-speed-change listener above forces a re-render
                  when the operator flips speed in the merge panel. */}
              {(() => {
                const sp = Number(item._speed)
                if (!(sp > 0) || sp === 1) return null
                return (
                  <span
                    className="absolute bottom-6 left-[24px] z-[5] text-white bg-[#f5a623] text-[9px] font-bold rounded px-1 py-0.5 leading-none pointer-events-none"
                    title={`Plays at ${sp}× during merge`}
                  >{sp}×</span>
                )
              })()}
              {item._storageMissing ? (
                /* BE GET /jobs/:id flagged this row's storage object as
                   missing. Render the shared placeholder + Replace
                   source button instead of RestoredMedia / VideoThumb
                   — those would fire a <video> request against the
                   dead URL and log a 400. */
                <MissingSourcePlaceholder item={item} onReplace={onReplaceSource} />
              ) : isImg && item.file ? (
                <ImageThumb
                  file={item.file}
                  zoom={item._photoZoom}
                  rotate={item._photoRotate}
                  offsetX={item._photoOffsetX}
                  offsetY={item._photoOffsetY}
                  onClick={() => setPreviewItem(item)}
                />
              ) : isVideo && item.file ? (
                <VideoThumb file={item.file} itemId={item.id} item={item} onClick={() => setPreviewItem(item)} className="w-full bg-black" />
              ) : item._restored && (item._publicUrl || item._uploadKey) ? (
                <RestoredMedia item={item} isVideo={isVideo} onClick={() => setPreviewItem(item)} onStorageMissing={onStorageMissing} onReplaceSource={onReplaceSource} />
              ) : (
                <div
                  onClick={() => setPreviewItem(item)}
                  className="w-full h-[120px] bg-ink flex items-center justify-center text-white text-[22px] cursor-pointer hover:bg-[#333]"
                >▶</div>
              )}
              <div className="text-[9px] text-muted py-1 px-1.5 whitespace-nowrap overflow-hidden text-ellipsis" title={item._dbFileId != null ? `${fileName} · clip-${item._dbFileId}` : fileName}>
                {fileName}
                {item._dbFileId != null && (
                  <span className="text-[#6C5CE7]/80 font-mono ml-1">· clip-{item._dbFileId}</span>
                )}
              </div>
              <button
                onClick={() => onRemove(item.id)}
                className="absolute top-1 right-1 w-[18px] h-[18px] rounded-full bg-black/55 text-white text-xs flex items-center justify-center cursor-pointer border-none z-[5]"
                title="Remove from this draft"
              >&times;</button>
              {/* Duplicate — server-side copy of the source storage
                  object + a new job_files row with all the same per-clip
                  settings (trim, photo motion/zoom/rotate/offsets, speed,
                  captions, post_destinations). Lets the user keep an
                  edited variant alongside the original without re-
                  uploading from disk. Only visible once the file is
                  persisted (_dbFileId set). */}
              {item._dbFileId != null && onDuplicate && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDuplicate(item) }}
                  disabled={item._duplicating}
                  className="absolute top-1 right-6 w-[18px] h-[18px] rounded-full bg-[#6C5CE7]/85 hover:bg-[#6C5CE7] text-white text-[10px] flex items-center justify-center cursor-pointer border-none z-[5] disabled:opacity-50"
                  title="Duplicate this clip with all its settings"
                >{item._duplicating ? '…' : '⎘'}</button>
              )}
              {/* Skip toggle — when on, VideoMerge filters this clip
                  from the merge payload. Lets users preview / produce
                  without a particular clip without removing it. Only
                  exposed once the file is persisted (_dbFileId set);
                  the helper expects the BE row to exist. */}
              {item._dbFileId != null && onToggleSkip && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleSkip(item) }}
                  className={`absolute top-1 right-11 w-[18px] h-[18px] rounded-full text-white text-[10px] flex items-center justify-center cursor-pointer border-none z-[5] ${
                    isSkipped
                      ? 'bg-[#2D9A5E]/85 hover:bg-[#2D9A5E]'
                      : 'bg-[#c0392b]/70 hover:bg-[#c0392b]'
                  }`}
                  title={isSkipped ? 'Include this clip in the merge' : 'Skip this clip from the merge (keeps it in the draft)'}
                >{isSkipped ? '↻' : '⊘'}</button>
              )}
              {/* Split — pop out the subclip extractor so the operator
                  can carve N moments out of one long take without
                  re-uploading. Server-side endpoint creates N rows that
                  share this source's upload_key with their own trim
                  windows. Video-only and gated on _dbFileId because the
                  endpoint needs a persisted source row. */}
              {item._dbFileId != null && isVideo && onSplit && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSplit(item) }}
                  className="absolute top-1 right-[64px] w-[18px] h-[18px] rounded-full bg-[#f5a623]/85 hover:bg-[#f5a623] text-white text-[10px] flex items-center justify-center cursor-pointer border-none z-[5]"
                  title="Split this clip into multiple subclips"
                >✂</button>
              )}
              {/* Force-rotate cycle button. Cameras that record vertical
                  footage without setting a rotation tag (Sony A6500,
                  GoPro, DJI, certain XAVC encoders) appear here as
                  landscape — one click cycles 0° → 90° → 180° → 270°.
                  The thumbnail + lightbox preview rotates live; the BE
                  applies a matching transpose filter at merge time. */}
              {isVideo && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    const cur = Number(item._forceRotate) || 0
                    const next = cur === 0 ? 90 : cur === 90 ? 180 : cur === 180 ? 270 : 0
                    item._forceRotate = next
                    try { window.dispatchEvent(new CustomEvent('posty-force-rotate-change', { detail: { itemId: item.id } })) } catch {}
                  }}
                  className={`absolute top-1 right-[86px] h-[18px] px-1.5 rounded-full text-white text-[9px] flex items-center justify-center cursor-pointer border-none z-[5] font-medium ${
                    Number(item._forceRotate) > 0
                      ? 'bg-[#d97706]/95 hover:bg-[#d97706]'
                      : 'bg-[#6C5CE7]/60 hover:bg-[#6C5CE7]'
                  }`}
                  title={
                    Number(item._forceRotate) > 0
                      ? `Force-rotated ${item._forceRotate}° (click to cycle). Preview + merge apply this rotation.`
                      : 'Force-rotate this clip (use for Sony A6500 / GoPro / DJI vertical files that show as landscape). Cycles 0° → 90° → 180° → 270°.'
                  }
                >{Number(item._forceRotate) > 0 ? `⟳${item._forceRotate}` : '⟳'}</button>
              )}
              {/* Compress button — re-encodes an existing uploaded
                  video via the BE (1080p H.264, medium=CRF 23). Auto-
                  compress at upload kicks in above 48MB, but Sony A6500
                  XAVC / GoPro / DJI files in the 20-47MB range slip
                  through and bloat storage. One click shrinks them in
                  place; the upload_key stays valid. */}
              {isVideo && item._dbFileId != null && (() => {
                const dbFileId = item._dbFileId
                const isCompressing = !!item._compressing
                const ratio = item._lastCompressRatio
                return (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation()
                      if (item._compressing) return
                      if (!confirm('Compress this video? Re-encodes to 1080p H.264 (medium quality). Best for Sony A6500 / GoPro / DJI source files that came out > 20MB.')) return
                      item._compressing = true
                      try { window.dispatchEvent(new CustomEvent('posty-file-meta-change', { detail: { itemId: item.id } })) } catch {}
                      try {
                        // jobUuid lives on the parent jobs row; pulled
                        // from the global hooked up by useJobSync.
                        const jobId = window._postyActiveJobId || null
                        if (!jobId) { alert('Job not yet saved — save first, then compress.'); item._compressing = false; return }
                        const r = await api.compressJobFile(jobId, dbFileId, 'medium')
                        if (r?.no_op) {
                          alert('Already optimized — compression would have made it larger. Skipped.')
                        } else if (r?.savings_pct >= 0) {
                          const before = (r.before_bytes / 1024 / 1024).toFixed(1)
                          const after  = (r.after_bytes  / 1024 / 1024).toFixed(1)
                          alert(`✓ Compressed ${before}MB → ${after}MB (${r.savings_pct}% smaller). Reload to see the updated file in the preview.`)
                          item._lastCompressRatio = r.savings_pct
                          // The upload_key may have changed (extension swap).
                          if (r.upload_key) item._uploadKey = r.upload_key
                          if (r.mime_type) item._mediaType = r.mime_type
                        }
                      } catch (err) {
                        alert(`Compression failed: ${err?.message || err}`)
                      } finally {
                        item._compressing = false
                        try { window.dispatchEvent(new CustomEvent('posty-file-meta-change', { detail: { itemId: item.id } })) } catch {}
                      }
                    }}
                    disabled={isCompressing}
                    className={`absolute top-1 right-[112px] h-[18px] px-1.5 rounded-full text-white text-[9px] flex items-center justify-center cursor-pointer border-none z-[5] font-medium ${
                      isCompressing
                        ? 'bg-[#94a3b8]'
                        : ratio
                          ? 'bg-[#2D9A5E]/85 hover:bg-[#2D9A5E]'
                          : 'bg-[#94a3b8]/85 hover:bg-[#64748b]'
                    }`}
                    title={isCompressing
                      ? 'Compressing… stay on this tab'
                      : ratio
                        ? `Compressed (${ratio}% smaller). Click to compress again.`
                        : 'Compress this video (re-encode to 1080p H.264 medium). Use for Sony A6500 / GoPro / DJI source files that bloat storage.'}
                  >{isCompressing ? '⌛' : ratio ? `🗜 ${ratio}%` : '🗜'}</button>
                )
              })()}
              {item.status === 'loading' && <div className="absolute bottom-5 left-0 right-0 text-center text-[9px] font-medium py-0.5 bg-sage/90 text-white">Loading...</div>}
              {item.status === 'done' && <div className="absolute bottom-5 left-0 right-0 text-center text-[9px] font-medium py-0.5 bg-tk/90 text-white">Done</div>}
              {item.status === 'error' && <div className="absolute bottom-5 left-0 right-0 text-center text-[9px] font-medium py-0.5 bg-terra/90 text-white">Error</div>}
            </div>
            {/* Trim bar right under its video — hidden when the source
                file is missing (no point trying to seek into a dead URL). */}
            {isVideo && VideoTrimmer && !item._storageMissing && <VideoTrimmer item={item} />}
            {isImg && PhotoDurationBar && !item._storageMissing && <PhotoDurationBar item={item} />}
          </>
        )
        // Only wrap with SortableTile when reorder is enabled — otherwise
        // useSortable runs without a DndContext parent and crashes iOS.
        if (reorderEnabled) {
          return (
            <SortableTile key={item.id} item={item}>
              {tile}
            </SortableTile>
          )
        }
        return <div key={item.id}>{tile()}</div>
      })}
    </div>
  )

  return (
    <>
      {previewItem && (
        <MediaLightbox item={previewItem} onClose={() => setPreviewItem(null)} />
      )}
      {reorderEnabled && (
        <div className="text-[10px] text-muted mb-1 flex items-center gap-1.5">
          <span className="font-mono">⋮⋮</span>
          <span>Drag the ⋮⋮ handle to reorder — sequence applies to carousels, photo-to-video reels, AND the video merge order. Mobile note: long-press the handle to drag; trim bar still works as-is.</span>
        </div>
      )}
      {reorderEnabled ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
            {grid}
          </SortableContext>
        </DndContext>
      ) : grid}
    </>
  )
}
