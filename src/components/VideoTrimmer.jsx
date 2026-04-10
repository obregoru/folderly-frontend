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

  // Probe source video duration.
  useEffect(() => {
    if (videoDuration > 0) return
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    v.src = src
    const onMeta = () => { if (v.duration && isFinite(v.duration)) setVideoDuration(v.duration) }
    v.addEventListener('loadedmetadata', onMeta)
    return () => { v.removeEventListener('loadedmetadata', onMeta); v.src = '' }
  }, [src])

  // Capture 10 filmstrip thumbnails via canvas seek-and-draw.
  useEffect(() => {
    if (videoDuration <= 0) return
    let cancelled = false
    setTrimThumbs([])
    const N = 10
    const v = document.createElement('video')
    v.preload = 'auto'
    v.muted = true
    v.playsInline = true
    v.src = src
    const canvas = document.createElement('canvas')
    const capture = async () => {
      const aspect = (v.videoWidth && v.videoHeight) ? v.videoWidth / v.videoHeight : 9 / 16
      canvas.width = 96
      canvas.height = Math.max(1, Math.round(96 / aspect))
      const ctx = canvas.getContext('2d')
      const thumbs = []
      for (let i = 0; i < N; i++) {
        if (cancelled) return
        const t = Math.min(videoDuration * (i / (N - 1)), Math.max(0, videoDuration - 0.05))
        await new Promise((resolve) => {
          const onSeeked = () => { v.removeEventListener('seeked', onSeeked); resolve() }
          v.addEventListener('seeked', onSeeked)
          try { v.currentTime = t } catch { resolve() }
        })
        if (cancelled) return
        try {
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
          thumbs.push(canvas.toDataURL('image/jpeg', 0.55))
          setTrimThumbs([...thumbs])
        } catch (err) {
          console.warn('[trim] thumbnail capture failed:', err.message)
          return
        }
      }
    }
    v.addEventListener('loadeddata', capture, { once: true })
    return () => { cancelled = true; v.src = '' }
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

  if (videoDuration <= 0) return null

  return (
    <div className="bg-white border border-border rounded-sm p-2">
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
            <div className="flex-1 flex items-center justify-center text-[9px] text-white/40">
              Loading frames…
            </div>
          )}
        </div>
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
