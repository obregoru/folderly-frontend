import { useEffect, useMemo, useRef, useState } from 'react'

// Pop-out subclip splitter. Operator scrubs the source video, marks
// IN / OUT pairs (keyboard I / O or buttons), reviews the resulting
// ranges, then commits — the parent calls /jobs/:id/files/:fileId/split
// which creates N job_files rows sharing one upload_key with distinct
// trim windows.
//
// Props:
//   source: the file item (must have a playable URL via _publicUrl or
//           file). Used only for preview + duration.
//   onCancel(): close without committing.
//   onSubmit(ranges): commit. ranges is [{ trim_start, trim_end }, ...]
//           sorted by start time.

function fmtTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00'
  const s = Math.max(0, seconds)
  const m = Math.floor(s / 60)
  const sec = (s - m * 60).toFixed(2)
  return `${m}:${sec.padStart(5, '0')}`
}

export default function SubclipSplitterModal({ source, onCancel, onSubmit }) {
  const videoRef = useRef(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [pendingIn, setPendingIn] = useState(null)
  const [ranges, setRanges] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  // Resolve a playable URL. Server-known files have _publicUrl; freshly
  // uploaded files in the same session have a File object we can wrap.
  const videoUrl = useMemo(() => {
    if (source?._publicUrl) return source._publicUrl
    if (source?.file && source.file instanceof File) return URL.createObjectURL(source.file)
    return null
  }, [source])
  useEffect(() => {
    return () => { if (videoUrl && source?.file) try { URL.revokeObjectURL(videoUrl) } catch {} }
  }, [videoUrl, source])

  // ── Keyboard hotkeys ──
  useEffect(() => {
    const onKey = (e) => {
      // Ignore when typing in an input/textarea
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); markIn() }
      else if (e.key === 'o' || e.key === 'O') { e.preventDefault(); markOut() }
      else if (e.key === ' ') { e.preventDefault(); togglePlay() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-1 / 30) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(1 / 30) }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel?.() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // markIn / markOut / nudge close over state by reading videoRef + state — ok to re-bind on each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingIn, ranges, currentTime, duration])

  const togglePlay = () => {
    const v = videoRef.current; if (!v) return
    if (v.paused) v.play(); else v.pause()
  }
  const nudge = (delta) => {
    const v = videoRef.current; if (!v) return
    v.pause()
    v.currentTime = Math.max(0, Math.min(duration || v.duration || 0, v.currentTime + delta))
  }

  const markIn = () => {
    const t = videoRef.current?.currentTime ?? 0
    setPendingIn(Number(t.toFixed(3)))
  }
  const markOut = () => {
    if (pendingIn == null) {
      // No pending IN — fall back to setting OUT immediately if there
      // are no ranges yet (interpreted as "from 0 to here"). Cheap
      // ergonomic win for the common "I just want the first 4 seconds"
      // case.
      const t = videoRef.current?.currentTime ?? 0
      if (t > 0.1) {
        setRanges(rs => [...rs, { trim_start: 0, trim_end: Number(t.toFixed(3)) }])
      }
      return
    }
    const tEnd = Number((videoRef.current?.currentTime ?? 0).toFixed(3))
    const tStart = pendingIn
    if (tEnd <= tStart + 0.1) {
      // Too short — drop without committing so the user can re-mark
      setPendingIn(null)
      return
    }
    setRanges(rs => [...rs, { trim_start: tStart, trim_end: tEnd }])
    setPendingIn(null)
  }
  const removeRange = (idx) => setRanges(rs => rs.filter((_, i) => i !== idx))
  const seekTo = (t) => {
    const v = videoRef.current; if (!v) return
    v.pause()
    v.currentTime = Math.max(0, Math.min(duration || v.duration || 0, Number(t) || 0))
  }
  const clearPending = () => setPendingIn(null)

  const handleSubmit = async () => {
    if (ranges.length === 0) return
    setSubmitting(true); setSubmitError(null)
    try {
      const sorted = [...ranges].sort((a, b) => a.trim_start - b.trim_start)
      await onSubmit(sorted)
    } catch (e) {
      setSubmitError(e?.message || String(e))
    } finally {
      setSubmitting(false)
    }
  }

  // Visual timeline: render each range as a coloured bar over a base track
  const dur = duration || 0
  const pct = (t) => dur > 0 ? `${(t / dur) * 100}%` : '0%'

  return (
    <div
      className="fixed inset-0 bg-black/70 z-[1000] flex items-center justify-center p-3"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel?.() }}
    >
      <div className="bg-white rounded-lg w-full max-w-3xl max-h-[92vh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-3 py-2">
          <div>
            <div className="text-[12px] font-semibold">Split into clips</div>
            <div className="text-[10px] text-muted">Mark IN / OUT pairs to extract any number of moments from this video.</div>
          </div>
          <button
            onClick={onCancel}
            className="text-[12px] bg-transparent border-none cursor-pointer text-muted hover:text-ink"
            title="Close"
          >✕</button>
        </div>

        {/* Video */}
        <div className="bg-black flex items-center justify-center">
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              preload="metadata"
              className="max-h-[55vh] w-full"
              onLoadedMetadata={() => {
                const v = videoRef.current; if (!v) return
                setDuration(v.duration || 0)
              }}
              onTimeUpdate={() => {
                const v = videoRef.current; if (!v) return
                setCurrentTime(v.currentTime || 0)
              }}
            />
          ) : (
            <div className="text-white text-[11px] py-12">No source available to preview.</div>
          )}
        </div>

        {/* Scrub track with marked ranges */}
        <div className="px-3 pt-2">
          <div className="relative h-6 bg-[#f3f3f3] border border-[#e5e5e5] rounded overflow-hidden">
            {/* Existing ranges */}
            {ranges.map((r, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 bg-[#6C5CE7]/40 border-l border-r border-[#6C5CE7]/80 cursor-pointer"
                style={{ left: pct(r.trim_start), width: pct(Math.max(0, r.trim_end - r.trim_start)) }}
                title={`${fmtTime(r.trim_start)} → ${fmtTime(r.trim_end)} — click to seek`}
                onClick={() => seekTo(r.trim_start)}
              >
                <span className="absolute top-0 left-0.5 text-[8px] text-[#6C5CE7] font-bold leading-none">{i + 1}</span>
              </div>
            ))}
            {/* Pending IN marker */}
            {pendingIn != null && (
              <div
                className="absolute top-0 bottom-0 bg-[#f5a623]/30 border-l-2 border-[#f5a623]"
                style={{ left: pct(pendingIn), width: pct(Math.max(0, (currentTime || 0) - pendingIn)) }}
                title={`Pending IN at ${fmtTime(pendingIn)}`}
              />
            )}
            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-[2px] bg-[#c0392b]"
              style={{ left: pct(currentTime), transform: 'translateX(-1px)' }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted mt-1">
            <span>0:00</span>
            <span className="font-mono">{fmtTime(currentTime)}{pendingIn != null ? ` · IN at ${fmtTime(pendingIn)}` : ''}</span>
            <span>{fmtTime(dur)}</span>
          </div>
        </div>

        {/* Action row */}
        <div className="px-3 pt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={markIn}
            disabled={!duration}
            className="text-[10px] py-1 px-2 bg-[#f5a623] text-white border-none rounded cursor-pointer disabled:opacity-50"
            title="Mark IN at current time (hotkey: I)"
          >Mark IN (I)</button>
          <button
            onClick={markOut}
            disabled={!duration}
            className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
            title="Mark OUT at current time (hotkey: O)"
          >Mark OUT (O)</button>
          {pendingIn != null && (
            <button
              onClick={clearPending}
              className="text-[10px] py-1 px-2 bg-white border border-[#e5e5e5] rounded cursor-pointer"
              title="Discard the pending IN marker"
            >Clear IN</button>
          )}
          <span className="text-[9px] text-muted ml-auto">Space = play/pause · ← / → = step frame · Esc = close</span>
        </div>

        {/* Range list */}
        <div className="px-3 py-2 flex-1 min-h-0">
          {ranges.length === 0 ? (
            <div className="text-[10px] text-muted italic py-2">No ranges yet — play the video and press <b>I</b> at the start of a moment, then <b>O</b> at the end.</div>
          ) : (
            <div className="space-y-1">
              {ranges.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded px-2 py-1">
                  <span className="font-mono text-[#6C5CE7] font-bold w-5">{i + 1}.</span>
                  <span className="font-mono">{fmtTime(r.trim_start)} → {fmtTime(r.trim_end)}</span>
                  <span className="text-muted">· {(r.trim_end - r.trim_start).toFixed(2)}s</span>
                  <button
                    onClick={() => seekTo(r.trim_start)}
                    className="ml-auto text-[9px] py-0.5 px-1.5 bg-white border border-[#e5e5e5] rounded cursor-pointer"
                    title="Seek to this range"
                  >Seek</button>
                  <button
                    onClick={() => removeRange(i)}
                    className="text-[9px] py-0.5 px-1.5 bg-white border border-[#c0392b] text-[#c0392b] rounded cursor-pointer"
                    title="Remove this range"
                  >Remove</button>
                </div>
              ))}
            </div>
          )}
          {submitError && (
            <div className="text-[10px] text-[#c0392b] mt-2">Error: {submitError}</div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#e5e5e5] px-3 py-2 flex items-center gap-2">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="text-[10px] py-1 px-2 bg-white border border-[#e5e5e5] rounded cursor-pointer disabled:opacity-50"
          >Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={ranges.length === 0 || submitting}
            className="text-[10px] py-1 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer ml-auto disabled:opacity-50"
          >{submitting ? 'Adding…' : `Add ${ranges.length || ''} clip${ranges.length === 1 ? '' : 's'} to timeline`}</button>
        </div>
      </div>
    </div>
  )
}
