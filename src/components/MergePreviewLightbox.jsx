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
  const insertVideoRef = useRef(null)
  // Currently-active insert index (within the host's inserts[] array)
  // or null when none is active. Gates the overlay <video>'s src + z.
  const [activeInsertIdx, setActiveInsertIdx] = useState(null)
  const photoTimerRef = useRef(null)
  // Guards a double-advance when timeupdate fires rapidly right at the
  // trim boundary. Without this, two sibling clips that share the same
  // URL (iPhone IMG_9376 collisions) were skipping an index on advance.
  const advancingRef = useRef(false)

  // Sanity guard: if playlist becomes empty, close.
  useEffect(() => { if (!playlist || playlist.length === 0) onClose?.() }, [playlist, onClose])

  // Positional advance — uses the closure-captured idx so multiple
  // in-flight onTime events can't all bump idx. Only the first one
  // whose fromIdx matches the current state wins; the rest are no-ops.
  const advanceFrom = (fromIdx) => {
    if (photoTimerRef.current) { clearTimeout(photoTimerRef.current); photoTimerRef.current = null }
    setIdx(i => {
      if (i !== fromIdx) return i
      return i + 1 < (playlist?.length || 0) ? i + 1 : i
    })
  }
  const restart = () => {
    if (photoTimerRef.current) { clearTimeout(photoTimerRef.current); photoTimerRef.current = null }
    advancingRef.current = false
    setIdx(0)
  }

  const current = playlist?.[idx]
  const isLast = idx >= (playlist?.length || 0) - 1

  // Drive video playback — seek to trimStart on load, watch timeupdate
  // for trimEnd, advance on end-of-segment or natural end.
  useEffect(() => {
    advancingRef.current = false // new clip, re-arm the guard
    setActiveInsertIdx(null)     // a new host = no insert active yet
    if (!current || current.type !== 'video') return
    const v = videoRef.current
    if (!v) return
    const fromIdx = idx
    const speed = Number(current.speed) > 0 ? Number(current.speed) : 1.0
    try { v.playbackRate = speed } catch {}
    const start = Number(current.trimStart) || 0
    const end = current.trimEnd != null && current.trimEnd > 0 ? Number(current.trimEnd) : null
    console.log(`[preview] ↻ clip ${fromIdx + 1}/${playlist.length} "${current.filename || ''}" start=${start}s end=${end != null ? end.toFixed(2) + 's' : 'natural'} speed=${speed}x url=${current.url?.slice(-40)}`)

    let seekApplied = false
    const applySeekAndPlay = () => {
      if (seekApplied) return
      seekApplied = true
      // Seek to this clip's trimStart explicitly on EVERY effect run,
      // not just on first-ever load. React's <video key={url}> reuses
      // the element between siblings that share a URL (iPhone
      // IMG_#### recycling), so the second sibling inherits the
      // first's currentTime without an explicit seek.
      const before = v.currentTime
      try { v.currentTime = start } catch (e) { console.warn('[preview] seek failed:', e.message) }
      console.log(`[preview] seek ${before.toFixed(2)}s → ${start}s`)
      try { const p = v.play(); if (p && p.catch) p.catch(err => console.warn('[preview] play rejected:', err.message)) } catch {}
    }

    const onReady = () => {
      applySeekAndPlay()
      v.removeEventListener('loadedmetadata', onReady)
      v.removeEventListener('canplay', onReady)
      v.removeEventListener('loadeddata', onReady)
    }
    const onTime = () => {
      if (advancingRef.current) return
      const max = end != null ? end : (Number.isFinite(v.duration) ? v.duration : Infinity)

      // B-roll insert activation. atSec is in OUTPUT timeline (post-
      // speed). Host's currentTime is in SOURCE timeline starting at
      // trimStart. So outputElapsed = (currentTime - trimStart) / speed.
      // When outputElapsed lands inside an insert's [atSec, atSec+outDur]
      // window, swap the overlay <video>'s src to the insert + bring it
      // forward via z-index. When the window ends, hide the overlay so
      // the host's video shows again. Audio always stays on the host.
      const inserts = Array.isArray(current.inserts) ? current.inserts : []
      if (inserts.length > 0) {
        const outputElapsed = (v.currentTime - start) / speed
        let nextActive = null
        for (let k = 0; k < inserts.length; k++) {
          const ins = inserts[k]
          const insStart = Number(ins.atSec) || 0
          const insOutDur = Number(ins.outDur) > 0 ? Number(ins.outDur) : 0
          // No outDur means "play insert to its natural end" — match
          // the BE's eof_action=pass: just check we're past the start.
          const insEnd = insOutDur > 0 ? insStart + insOutDur : Infinity
          if (outputElapsed >= insStart - 0.02 && outputElapsed < insEnd) {
            nextActive = k
            break
          }
        }
        if (nextActive !== activeInsertIdx) {
          setActiveInsertIdx(nextActive)
        }
      }

      if (v.currentTime >= max - 0.05) {
        console.log(`[preview] ✂ clip ${fromIdx + 1} hit end at ${v.currentTime.toFixed(2)}s (max=${max.toFixed(2)}s) → ${isLast ? 'stop' : 'advance'}`)
        advancingRef.current = true
        if (!isLast) advanceFrom(fromIdx); else try { v.pause() } catch {}
      }
    }
    const onEnded = () => {
      if (advancingRef.current) return
      console.log(`[preview] natural end on clip ${fromIdx + 1}`)
      advancingRef.current = true
      if (!isLast) advanceFrom(fromIdx)
    }

    // Seek + play whenever ready — even if the element reports ready
    // immediately (reused element, same URL), because the seekable
    // range for a freshly-loaded video might not include our
    // trimStart until after loadedmetadata.
    v.addEventListener('loadedmetadata', onReady)
    v.addEventListener('loadeddata', onReady)
    v.addEventListener('canplay', onReady)
    if (v.readyState >= 2) applySeekAndPlay()
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('ended', onEnded)
    return () => {
      // All five listeners — including the readiness ones — must go
      // on cleanup. Otherwise a stale onReady from a previous clip
      // could fire later and apply THAT clip's trimStart + play
      // directives to the reused <video> element.
      v.removeEventListener('loadedmetadata', onReady)
      v.removeEventListener('loadeddata', onReady)
      v.removeEventListener('canplay', onReady)
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('ended', onEnded)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, current?.type, current?.url])

  // Drive the B-roll insert overlay player. When activeInsertIdx
  // flips to a number, seek the overlay <video> to that insert's
  // trimStart and play it muted (audio always stays on the host).
  // When it flips back to null, pause + hide the overlay.
  useEffect(() => {
    const v = insertVideoRef.current
    if (!v) return
    const inserts = Array.isArray(current?.inserts) ? current.inserts : []
    if (activeInsertIdx == null || !inserts[activeInsertIdx]) {
      try { v.pause() } catch {}
      return
    }
    const ins = inserts[activeInsertIdx]
    const insSpeed = Number(ins.speed) > 0 ? Number(ins.speed) : 1.0
    const insStart = Number(ins.trimStart) || 0
    const apply = () => {
      try { v.muted = true } catch {}
      try { v.playbackRate = insSpeed } catch {}
      try { v.currentTime = insStart } catch {}
      try { const p = v.play(); if (p && p.catch) p.catch(() => {}) } catch {}
    }
    // If the src changed (different insert), wait for metadata; else
    // apply immediately.
    if (v.readyState >= 2) {
      apply()
    } else {
      const onReady = () => {
        apply()
        v.removeEventListener('loadedmetadata', onReady)
        v.removeEventListener('canplay', onReady)
      }
      v.addEventListener('loadedmetadata', onReady)
      v.addEventListener('canplay', onReady)
      return () => {
        v.removeEventListener('loadedmetadata', onReady)
        v.removeEventListener('canplay', onReady)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInsertIdx, current?.id])

  // Drive photo "playback" — show for N seconds then advance.
  useEffect(() => {
    if (!current || current.type !== 'photo') return
    const fromIdx = idx
    const ms = Math.max(500, (Number(current.trimEnd) || 5) * 1000)
    photoTimerRef.current = setTimeout(() => {
      if (!isLast) advanceFrom(fromIdx)
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

      {/* Stage — host + insert stacked.
          The flex parent itself is the relative positioning context.
          Host video sits in flow with max-w-full / max-h-full
          (works because the flex parent has explicit dimensions from
          flex-1 + min-h-0). The overlay <video> is positioned absolute
          inset-4 (matching the parent's p-4) and uses object-contain
          so for matched-aspect sources it lands on the same letterboxed
          area as the host. Hidden via opacity-0 / pointer-events-none
          when no insert is active. Audio always stays on the host. */}
      <div className="flex-1 flex items-center justify-center p-4 min-h-0 relative">
        {current.type === 'video' ? (
          <>
            <video
              key={current.url}
              ref={videoRef}
              src={current.url}
              controls
              playsInline
              crossOrigin={current.url && !current.url.startsWith('blob:') ? 'anonymous' : undefined}
              className="max-w-full max-h-full object-contain bg-black"
              style={{ position: 'relative', zIndex: 10 }}
            />
            {Array.isArray(current.inserts) && current.inserts.length > 0 && (
              <video
                ref={insertVideoRef}
                src={activeInsertIdx != null && current.inserts[activeInsertIdx]
                  ? current.inserts[activeInsertIdx].url
                  : undefined}
                muted
                playsInline
                crossOrigin={
                  activeInsertIdx != null
                    && current.inserts[activeInsertIdx]?.url
                    && !current.inserts[activeInsertIdx].url.startsWith('blob:')
                    ? 'anonymous' : undefined
                }
                className={`absolute object-contain bg-black pointer-events-none transition-opacity duration-100 ${
                  activeInsertIdx != null ? 'opacity-100' : 'opacity-0'
                }`}
                style={{
                  inset: '16px',                   // match parent's p-4
                  zIndex: activeInsertIdx != null ? 20 : -1,
                }}
              />
            )}
            {activeInsertIdx != null && (
              <div className="absolute top-4 left-4 z-30 bg-[#6C5CE7]/90 text-white text-[10px] rounded-full px-2 py-0.5 pointer-events-none">
                ↳ Insert: {current.inserts[activeInsertIdx]?.filename || `#${activeInsertIdx + 1}`}
              </div>
            )}
          </>
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
            onClick={() => { advancingRef.current = false; setIdx(i) }}
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
