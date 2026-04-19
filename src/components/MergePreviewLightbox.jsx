import { useEffect, useRef, useState } from 'react'

/**
 * MergePreviewLightbox — full-screen sequential-playback preview for a
 * merge. Plays each clip in order, respecting trimStart/trimEnd (videos)
 * or display duration (photos). Hard cuts, no crossfades; no overlay /
 * voiceover burn-in. Use to sanity-check order + timing before firing
 * the real server merge.
 *
 * Playlist entry shape:
 *   { id, type: 'video' | 'photo', url, filename?, trimStart?, trimEnd?, speed? }
 *   - video: trimStart / trimEnd in seconds, speed multiplier
 *   - photo: trimEnd = display duration in seconds (default 5)
 */
export default function MergePreviewLightbox({ playlist, onClose }) {
  const [idx, setIdx] = useState(0)
  const videoRef = useRef(null)
  const photoTimerRef = useRef(null)

  // Sanity guard: if playlist becomes empty, close.
  useEffect(() => { if (!playlist || playlist.length === 0) onClose?.() }, [playlist, onClose])

  const advance = () => {
    if (photoTimerRef.current) { clearTimeout(photoTimerRef.current); photoTimerRef.current = null }
    setIdx(i => (i + 1 < (playlist?.length || 0) ? i + 1 : i))
  }
  const restart = () => {
    if (photoTimerRef.current) { clearTimeout(photoTimerRef.current); photoTimerRef.current = null }
    setIdx(0)
  }

  const current = playlist?.[idx]
  const isLast = idx >= (playlist?.length || 0) - 1

  // Drive video playback — seek to trimStart on load, watch timeupdate
  // for trimEnd, advance on end-of-segment or natural end.
  useEffect(() => {
    if (!current || current.type !== 'video') return
    const v = videoRef.current
    if (!v) return
    const speed = Number(current.speed) > 0 ? Number(current.speed) : 1.0
    try { v.playbackRate = speed } catch {}
    const start = Number(current.trimStart) || 0
    const end = current.trimEnd != null && current.trimEnd > 0 ? Number(current.trimEnd) : null

    const onReady = () => {
      try { v.currentTime = start } catch {}
      try { const p = v.play(); if (p && p.catch) p.catch(() => {}) } catch {}
      v.removeEventListener('loadedmetadata', onReady)
      v.removeEventListener('canplay', onReady)
    }
    const onTime = () => {
      const max = end != null ? end : (Number.isFinite(v.duration) ? v.duration : Infinity)
      if (v.currentTime >= max - 0.05) { if (!isLast) advance(); else try { v.pause() } catch {} }
    }
    const onEnded = () => { if (!isLast) advance() }

    if (v.readyState >= 1) onReady()
    else {
      v.addEventListener('loadedmetadata', onReady, { once: true })
      v.addEventListener('canplay', onReady, { once: true })
    }
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('ended', onEnded)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('ended', onEnded)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, current?.type, current?.url])

  // Drive photo "playback" — show for N seconds then advance.
  useEffect(() => {
    if (!current || current.type !== 'photo') return
    const ms = Math.max(500, (Number(current.trimEnd) || 5) * 1000)
    photoTimerRef.current = setTimeout(() => {
      if (!isLast) advance()
    }, ms)
    return () => { if (photoTimerRef.current) clearTimeout(photoTimerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, current?.type, current?.url])

  if (!current) return null

  // Total / elapsed estimate for the progress label
  const totalDuration = (playlist || []).reduce((acc, c) => {
    if (c.type === 'photo') return acc + (Number(c.trimEnd) || 5)
    const start = Number(c.trimStart) || 0
    const end = c.trimEnd != null ? Number(c.trimEnd) : null
    const len = end != null ? Math.max(0, end - start) : 0
    const speed = Number(c.speed) > 0 ? Number(c.speed) : 1.0
    return acc + (speed > 0 ? len / speed : len)
  }, 0)

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col" role="dialog" aria-modal="true">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-black/50 text-white">
        <div className="text-[11px] font-medium flex items-center gap-2">
          <span className="bg-[#d97706] rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wide">Preview</span>
          <span className="opacity-80">{idx + 1} / {playlist.length}</span>
          {current.filename && <span className="opacity-60 truncate max-w-[200px]">{current.filename}</span>}
          <span className="opacity-60">· total ≈ {totalDuration.toFixed(1)}s</span>
        </div>
        <div className="flex-1" />
        <button onClick={restart} className="text-[10px] bg-white/10 hover:bg-white/20 border-none text-white rounded py-1 px-2 cursor-pointer">↻ Restart</button>
        <button onClick={onClose} className="w-8 h-8 rounded-full bg-white text-black text-lg flex items-center justify-center border-none cursor-pointer" aria-label="Close">&times;</button>
      </div>

      {/* Stage */}
      <div className="flex-1 flex items-center justify-center p-4 min-h-0">
        {current.type === 'video' ? (
          <video
            key={current.url}
            ref={videoRef}
            src={current.url}
            controls
            playsInline
            crossOrigin={current.url && !current.url.startsWith('blob:') ? 'anonymous' : undefined}
            className="max-w-full max-h-full object-contain bg-black"
          />
        ) : (
          <img
            key={current.url}
            src={current.url}
            alt=""
            className="max-w-full max-h-full object-contain bg-black"
          />
        )}
      </div>

      {/* Clip strip */}
      <div className="flex items-center gap-1 px-3 py-2 bg-black/50 overflow-x-auto">
        {playlist.map((c, i) => (
          <button
            key={c.id || i}
            onClick={() => setIdx(i)}
            className={`flex-shrink-0 border rounded py-1 px-2 text-[9px] cursor-pointer whitespace-nowrap ${i === idx ? 'bg-white text-black border-white' : 'bg-transparent text-white/80 border-white/30'}`}
            title={c.filename || `clip ${i + 1}`}
          >
            {i + 1}. {c.type === 'photo' ? '📸' : '🎬'}
            {c.trimEnd != null && (
              <span className="opacity-70 ml-1">
                {c.type === 'photo'
                  ? `${(Number(c.trimEnd) || 5).toFixed(1)}s`
                  : `${((Number(c.trimEnd) || 0) - (Number(c.trimStart) || 0)).toFixed(1)}s`}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
