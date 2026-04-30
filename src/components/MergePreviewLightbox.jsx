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
  const insertImageRef = useRef(null)
  const photoImageRef = useRef(null)
  const stageRef = useRef(null)
  // Currently-active insert index (within the host's inserts[] array)
  // or null when none is active. Gates the overlay <video>'s src + z.
  const [activeInsertIdx, setActiveInsertIdx] = useState(null)
  // Rendered video bounds of the host element's actual pixels
  // (after object-contain letterboxing). Used to position the
  // overlay so it covers EXACTLY the host's video, not the
  // element's full padded box.
  const [hostBox, setHostBox] = useState(null)
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
      // The active insert's onEnded handler also flips activeInsertIdx
      // to null, so the overlay disappears even if outDur was unknown.
      const inserts = Array.isArray(current.inserts) ? current.inserts : []
      if (inserts.length > 0) {
        const outputElapsed = (v.currentTime - start) / speed
        // Best-known insert duration: explicit outDur from playlist >
        // loaded videoElement.duration / speed > unknown (don't auto-
        // deactivate based on time, rely on onEnded). Caches per
        // insert via window-attached map keyed by insert id so we
        // don't keep recomputing the fallback every tick.
        const knownDurOf = (ins) => {
          if (Number(ins.outDur) > 0) return Number(ins.outDur)
          // Insert media element duration (only available when the
          // overlay has been activated at least once for this insert).
          const insV = insertVideoRef.current
          if (insV && Number(insV.duration) > 0
              && activeInsertIdx != null
              && inserts[activeInsertIdx]?.id === ins.id) {
            return Number(insV.duration) / (Number(ins.speed) || 1.0)
          }
          return null
        }
        let nextActive = null
        for (let k = 0; k < inserts.length; k++) {
          const ins = inserts[k]
          const insStart = Number(ins.atSec) || 0
          const insDur = knownDurOf(ins)
          // When duration is unknown, only activate if we're at the
          // start (don't extend forward indefinitely on every frame).
          const insEnd = insDur != null ? insStart + insDur : insStart + 30
          if (outputElapsed >= insStart - 0.02 && outputElapsed < insEnd) {
            nextActive = k
            break
          }
        }
        // Always call setState — React's Object.is short-circuit
        // bails out for identical values without re-rendering. The
        // previous `nextActive !== activeInsertIdx` guard read a
        // stale closure value (this onTime handler is bound in a
        // useEffect with deps that don't include activeInsertIdx),
        // so when the window exited and both were null in the
        // closure's view the setState never fired — leaving image
        // inserts stuck on screen because they have no onEnded
        // event to bail us out the way video inserts do.
        setActiveInsertIdx(nextActive)
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

  // Measure the HOST video's actual rendered video bounds (after
  // object-contain letterboxing) so the overlay can be positioned
  // exactly on top of it. Re-measures on metadata load + element
  // resize. Without this, the overlay used the host element's full
  // box (or its parent's inset:16) which usually covered a larger
  // area than the host's letterboxed video pixels — making the
  // insert appear MUCH bigger than the host underneath.
  useEffect(() => {
    const v = videoRef.current
    const stage = stageRef.current
    if (!v || !stage) return
    const measure = () => {
      const vw = Number(v.videoWidth) || 0
      const vh = Number(v.videoHeight) || 0
      if (!vw || !vh) return
      const vRect = v.getBoundingClientRect()
      const stageRect = stage.getBoundingClientRect()
      if (!vRect.width || !vRect.height) return
      const vAspect = vw / vh
      const cAspect = vRect.width / vRect.height
      let renderW, renderH
      if (cAspect > vAspect) {
        // Element wider than video — pillarbox left/right
        renderH = vRect.height
        renderW = renderH * vAspect
      } else {
        // Element taller than video — letterbox top/bottom
        renderW = vRect.width
        renderH = renderW / vAspect
      }
      const left = (vRect.left - stageRect.left) + (vRect.width - renderW) / 2
      const top = (vRect.top - stageRect.top) + (vRect.height - renderH) / 2
      setHostBox({ left, top, width: renderW, height: renderH })
    }
    measure()
    v.addEventListener('loadedmetadata', measure)
    v.addEventListener('resize', measure)
    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure)
      ro.observe(v)
      ro.observe(stage)
    }
    window.addEventListener('resize', measure)
    return () => {
      v.removeEventListener('loadedmetadata', measure)
      v.removeEventListener('resize', measure)
      if (ro) ro.disconnect()
      window.removeEventListener('resize', measure)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.url])

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

  // Drive the Ken Burns motion on photo inserts via the Web Animations
  // API. Mirrors the BE photoToVideo motions so the preview shows
  // approximately what the export will burn in. When the active
  // insert is a photo with a motion, kick off el.animate(); cancel
  // when activeInsertIdx flips away.
  useEffect(() => {
    const el = insertImageRef.current
    if (!el) return
    const inserts = Array.isArray(current?.inserts) ? current.inserts : []
    const ins = activeInsertIdx != null ? inserts[activeInsertIdx] : null
    if (!ins || ins.type !== 'image') return
    const baseZoom = Number(ins.zoom) > 0 ? Number(ins.zoom) : 1.0
    const rotate = Number.isFinite(Number(ins.rotate)) ? Number(ins.rotate) : 0
    // No motion + zoom 1.0 + no rotate = nothing to animate. Skip
    // to avoid an empty Web Animations call.
    if ((!ins.motion || ins.motion === 'static') && Math.abs(baseZoom - 1) < 0.001 && rotate === 0) return
    const durMs = Math.max(100, Math.round((Number(ins.outDur) || 5) * 1000))
    const keyframes = motionKeyframes(ins.motion || 'static', baseZoom, rotate)
    if (!keyframes) return
    let anim
    try {
      anim = el.animate(keyframes, {
        duration: durMs,
        fill: 'both',
        easing: 'linear',
      })
    } catch (e) {
      // older browsers without Web Animations API support — skip
      // motion silently. Still beats no preview at all.
      return
    }
    return () => {
      try { anim.cancel() } catch {}
    }
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

  // Drive Ken Burns motion + base zoom on the main photo display
  // (when current.type === 'photo'). Same animation engine as the
  // image-insert path — Web Animations API on the <img> ref. Without
  // this, sequential photos in the merge preview rendered as static
  // stills with no motion / zoom even though the export burns it in.
  useEffect(() => {
    const el = photoImageRef.current
    if (!el || !current || current.type !== 'photo') return
    const baseZoom = Number(current.zoom) > 0 ? Number(current.zoom) : 1.0
    const rotate = Number.isFinite(Number(current.rotate)) ? Number(current.rotate) : 0
    const motion = current.motion || 'zoom-in'
    if ((!motion || motion === 'static') && Math.abs(baseZoom - 1) < 0.001 && rotate === 0) return
    const durMs = Math.max(500, (Number(current.trimEnd) || 5) * 1000)
    const keyframes = motionKeyframes(motion, baseZoom, rotate)
    if (!keyframes) return
    let anim
    try {
      anim = el.animate(keyframes, { duration: durMs, fill: 'both', easing: 'linear' })
    } catch { return }
    return () => { try { anim.cancel() } catch {} }
  }, [idx, current?.type, current?.url, current?.motion, current?.zoom, current?.rotate, current?.trimEnd])

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
      <div ref={stageRef} className="flex-1 flex items-center justify-center p-4 min-h-0 relative">
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
            {Array.isArray(current.inserts) && current.inserts.length > 0 && hostBox && (() => {
              // Pick the active insert (if any) so we can branch on
              // its type. Image inserts render <img>, video inserts
              // render <video>. Both layer on top of the host at
              // the same hostBox bounds so they cover the host's
              // letterboxed area exactly.
              const activeInsert = activeInsertIdx != null && current.inserts[activeInsertIdx]
                ? current.inserts[activeInsertIdx]
                : null
              const isImageInsert = activeInsert?.type === 'image'
              const overlayStyle = {
                left: hostBox.left,
                top: hostBox.top,
                width: hostBox.width,
                height: hostBox.height,
                zIndex: activeInsertIdx != null ? 20 : -1,
              }
              return isImageInsert ? (
                <img
                  key={activeInsert.url}
                  ref={insertImageRef}
                  src={activeInsert.url}
                  alt={activeInsert.filename || ''}
                  className={`absolute object-contain bg-black pointer-events-none transition-opacity duration-100 ${
                    activeInsertIdx != null ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={overlayStyle}
                />
              ) : (
                <video
                  ref={insertVideoRef}
                  src={activeInsert?.url || undefined}
                  muted
                  playsInline
                  onEnded={() => setActiveInsertIdx(null)}
                  crossOrigin={
                    activeInsert?.url && !activeInsert.url.startsWith('blob:')
                      ? 'anonymous' : undefined
                  }
                  className={`absolute object-contain bg-black pointer-events-none transition-opacity duration-100 ${
                    activeInsertIdx != null ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={overlayStyle}
                />
              )
            })()}
            {activeInsertIdx != null && hostBox && (
              <div
                className="absolute z-30 bg-[#6C5CE7]/90 text-white text-[10px] rounded-full px-2 py-0.5 pointer-events-none"
                style={{ left: hostBox.left + 8, top: hostBox.top + 8 }}
              >
                ↳ Insert: {current.inserts[activeInsertIdx]?.filename || `#${activeInsertIdx + 1}`}
              </div>
            )}
          </>
        ) : (
          <img
            key={current.url}
            ref={photoImageRef}
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

// Maps a Ken Burns motion name + base zoom into Web Animations API
// keyframes. The base zoom (1.0–5.0) is the user's per-photo
// magnification slider; motion ramps relative to that base. So a
// 1.5× zoom-in starts at scale(1.5) and ends at scale(1.5 * 1.18).
// Pan amounts are deliberately small (3%) so even a tightly-cropped
// photo doesn't reveal letterbox edges as it moves.
//
// Static motion + non-1.0 zoom returns a 1-frame "keep at scale"
// animation so the photo still fills the frame at the user's
// chosen base size.
function motionKeyframes(motion, baseZoom = 1.0, rotate = 0) {
  const z = Number(baseZoom) > 0 ? Number(baseZoom) : 1.0
  const r = Number.isFinite(Number(rotate)) ? Number(rotate) : 0
  const ZOOM_AMP = 1.18; // zoom-in ramp factor
  const PAN_BASE = 1.08; // small zoom on pure pans so edges don't flash through
  // Compose rotate(...) ahead of every scale/translate so the rotated
  // bounding box is what we then scale/pan. Order matters in CSS
  // transforms — rotate first means the photo's rotated frame is
  // what gets cropped/zoomed. This matches what users expect from a
  // "rotate then zoom in" mental model.
  const rot = r !== 0 ? `rotate(${r}deg) ` : ''
  switch (motion) {
    case 'zoom-in':
      return [{ transform: `${rot}scale(${z * 1.0})` }, { transform: `${rot}scale(${z * ZOOM_AMP})` }]
    case 'zoom-out':
      return [{ transform: `${rot}scale(${z * ZOOM_AMP})` }, { transform: `${rot}scale(${z * 1.0})` }]
    case 'pan-lr':
      return [{ transform: `${rot}scale(${z * PAN_BASE}) translateX(-3%)` }, { transform: `${rot}scale(${z * PAN_BASE}) translateX(3%)` }]
    case 'pan-rl':
      return [{ transform: `${rot}scale(${z * PAN_BASE}) translateX(3%)` }, { transform: `${rot}scale(${z * PAN_BASE}) translateX(-3%)` }]
    case 'pan-lr-zoom-in':
      return [{ transform: `${rot}scale(${z * 1.0}) translateX(-3%)` }, { transform: `${rot}scale(${z * ZOOM_AMP}) translateX(3%)` }]
    case 'pan-lr-zoom-out':
      return [{ transform: `${rot}scale(${z * ZOOM_AMP}) translateX(-3%)` }, { transform: `${rot}scale(${z * 1.0}) translateX(3%)` }]
    case 'pan-rl-zoom-in':
      return [{ transform: `${rot}scale(${z * 1.0}) translateX(3%)` }, { transform: `${rot}scale(${z * ZOOM_AMP}) translateX(-3%)` }]
    case 'pan-rl-zoom-out':
      return [{ transform: `${rot}scale(${z * ZOOM_AMP}) translateX(3%)` }, { transform: `${rot}scale(${z * 1.0}) translateX(-3%)` }]
    case 'static':
    default:
      // Hold at the chosen zoom + rotation for the entire duration.
      return [{ transform: `${rot}scale(${z})` }, { transform: `${rot}scale(${z})` }]
  }
}
