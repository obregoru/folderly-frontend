// Music panel — the editor surface for the beat-sync jump-cut
// feature. Operator uploads a music file; BE runs aubio to extract
// BPM + beat times. They can trim the music to a window (e.g. skip
// intro, focus on a chorus), then click "Snap clips to beats" → BE
// computes a clip plan against the TRIMMED beat list → operator
// hits Apply → next merge bakes in the new cuts and swaps audio to
// the trimmed music.
//
// In v1 music REPLACES voiceover at merge time (fork 3a). The
// panel surfaces that so the operator isn't surprised.

import { useEffect, useRef, useState } from 'react'
import * as api from '../../api'

// File → base64 (no fetch round-trip, no FormData). Same shape
// the voiceover save endpoint uses so we stay consistent on the
// audio upload pattern.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const result = String(r.result || '')
      const idx = result.indexOf(',')
      resolve(idx >= 0 ? result.slice(idx + 1) : result)
    }
    r.onerror = () => reject(new Error('FileReader failed'))
    r.readAsDataURL(file)
  })
}

export default function MusicPanelV2({ draftId, jobSync }) {
  const [music, setMusic] = useState(null) // { track_url, filename, beat_map, trim_start, trim_end ... }
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState(null)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [snapPreview, setSnapPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [appliedAt, setAppliedAt] = useState(null)
  // Waveform viewport. zoom > 1 zooms into a slice of the trimmed
  // window; pan slides that slice [0..1]. View resets to 1x on
  // every new upload / trim change so the operator doesn't end
  // up on a stale viewport that no longer corresponds to the data.
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState(0)

  // Hydrate the saved music on mount + on draft change.
  useEffect(() => {
    if (!draftId) return
    let cancelled = false
    setLoading(true)
    api.getJobMusic(draftId).then(r => {
      if (cancelled) return
      setMusic(r?.music || null)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setErr(e?.message || String(e))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [draftId])

  // Reset viewport whenever the source music or its trim changes —
  // the existing zoom/pan would point at irrelevant offsets in the
  // new beat array.
  useEffect(() => {
    setZoom(1)
    setPan(0)
  }, [music?.track_key, music?.trim_start, music?.trim_end])

  const handleUpload = async (file) => {
    if (!draftId || !file) return
    setErr(null)
    setSnapPreview(null) // any prior preview becomes stale on new upload
    setUploading(true)
    try {
      const b64 = await fileToBase64(file)
      await api.uploadJobMusic(draftId, {
        audio_base64: b64,
        filename: file.name,
        media_type: file.type || 'audio/mpeg',
      })
      const fresh = await api.getJobMusic(draftId)
      setMusic(fresh?.music || null)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async () => {
    if (!draftId) return
    if (!confirm('Remove this music track? Existing clip trims stay as-is — the next merge will use the clip audios again.')) return
    try {
      await api.deleteJobMusic(draftId)
      setMusic(null)
      setSnapPreview(null)
    } catch (e) {
      alert('Delete failed: ' + e.message)
    }
  }

  const handleReanalyze = async () => {
    if (!draftId || reanalyzing) return
    setReanalyzing(true)
    setErr(null)
    try {
      const r = await api.reanalyzeJobMusic(draftId)
      setMusic(prev => prev ? { ...prev, beat_map: r.music_beat_map, analyzed_at: new Date().toISOString() } : prev)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setReanalyzing(false)
    }
  }

  const handleTrimChange = async ({ trim_start, trim_end }) => {
    if (!draftId) return
    setErr(null)
    try {
      const r = await api.setJobMusicTrim(draftId, { trim_start, trim_end })
      setMusic(prev => prev ? { ...prev, trim_start: r.music_trim_start, trim_end: r.music_trim_end } : prev)
      setSnapPreview(null) // any prior preview was against a different range
    } catch (e) {
      setErr(e?.message || String(e))
    }
  }

  const handlePreviewSnap = async () => {
    if (!draftId || previewing) return
    setPreviewing(true)
    setErr(null)
    try {
      const r = await api.previewBeatSnap(draftId)
      setSnapPreview(r)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setPreviewing(false)
    }
  }

  const handleApplySnap = async () => {
    if (!draftId || applying) return
    if (!confirm('Apply beat-snapped cuts? This overwrites trim_start/trim_end on every video clip so cuts land on beats.')) return
    setApplying(true)
    setErr(null)
    try {
      const r = await api.applyBeatSnap(draftId)
      setAppliedAt(new Date().toISOString())
      setSnapPreview({ ...snapPreview, ...r, applied: true })
      try { await jobSync?.loadJob?.(draftId) } catch {}
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setApplying(false)
    }
  }

  const beatMap = music?.beat_map || null
  // Effective trim window — null on either field means "use full
  // track" so we fill in 0 / duration as the runtime values that
  // children consume.
  const fullDuration = Number(beatMap?.duration) || 0
  const effectiveTrimStart = Number.isFinite(Number(music?.trim_start)) && Number(music.trim_start) > 0
    ? Number(music.trim_start) : 0
  const effectiveTrimEnd = Number.isFinite(Number(music?.trim_end)) && Number(music.trim_end) > 0
    ? Number(music.trim_end) : fullDuration
  const effectiveDuration = Math.max(0, effectiveTrimEnd - effectiveTrimStart)
  const hasTrim = effectiveTrimStart > 0 || (effectiveTrimEnd > 0 && effectiveTrimEnd < fullDuration)

  if (loading) {
    return <div className="text-[11px] text-muted italic py-4 text-center">Loading music track…</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="text-[12px] font-medium">🎵 Music + beat-sync jump cuts</div>
          <div className="text-[10px] text-muted">
            Upload a music file (mp3 / wav / m4a). BE analyzes BPM + beat positions, then a Snap-to-beats action overwrites every clip's trim so cuts land on beats. Final merge uses this music as the audio track.
          </div>
          <div className="text-[10px] text-[#8a4b00] bg-[#fff7e6] border border-[#f5a623]/40 rounded px-2 py-1 mt-1">
            v1: music <b>replaces</b> voiceover at merge time. If you have a recorded VO, the merged mp4 will use the music instead.
          </div>
        </div>
      </div>

      {!music && (
        <UploadDropzone uploading={uploading} onUpload={handleUpload} />
      )}

      {music && (
        <TrackCard
          music={music}
          trimStart={effectiveTrimStart}
          trimEnd={effectiveTrimEnd}
          onDelete={handleDelete}
          onReanalyze={handleReanalyze}
          reanalyzing={reanalyzing}
        />
      )}

      {music && beatMap && fullDuration > 0 && (
        <TrimControls
          fullDuration={fullDuration}
          trimStart={effectiveTrimStart}
          trimEnd={effectiveTrimEnd}
          hasTrim={hasTrim}
          onChange={handleTrimChange}
        />
      )}

      {music && beatMap && effectiveDuration > 0 && (
        <>
          <ZoomBar zoom={zoom} pan={pan} setZoom={setZoom} setPan={setPan} />
          <WaveformBeatStrip
            beatMap={beatMap}
            trimStart={effectiveTrimStart}
            trimEnd={effectiveTrimEnd}
            zoom={zoom}
            pan={pan}
          />
        </>
      )}

      {music && !beatMap && (
        <div className="text-[11px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2">
          The analyzer couldn't extract a beat map from this file (BPM was indeterminate). Try a different track or click <b>Re-analyze</b>.
        </div>
      )}

      {music && beatMap && effectiveDuration > 0 && (
        <div className="border border-[#6C5CE7]/30 bg-[#f3f0ff] rounded p-2 space-y-1.5">
          <div className="text-[11px] font-medium text-[#6C5CE7]">Snap clips to beats</div>
          <div className="text-[9px] text-[#6C5CE7]/80">
            Computes new trim_start / trim_end / file_order on every video clip so cuts align to beats {hasTrim && <>within the trim window <b>{effectiveTrimStart.toFixed(2)}s–{effectiveTrimEnd.toFixed(2)}s</b></>}. Preview first to see the plan.
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={handlePreviewSnap}
              disabled={previewing || applying}
              className="text-[10px] py-1 px-2 border border-[#6C5CE7] text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-50"
            >{previewing ? 'Computing…' : '🔍 Preview plan'}</button>
            {snapPreview?.plan?.length > 0 && !snapPreview.applied && (
              <button
                type="button"
                onClick={handleApplySnap}
                disabled={applying}
                className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
              >{applying ? 'Applying…' : '✓ Apply to clips'}</button>
            )}
            {snapPreview?.applied && (
              <span className="text-[10px] text-[#2D9A5E] font-medium">✓ Applied {appliedAt && `at ${new Date(appliedAt).toLocaleTimeString()}`}. Re-merge to see the new cuts.</span>
            )}
          </div>
          {snapPreview?.plan?.length > 0 && (
            <SnapPlanTable plan={snapPreview.plan} cuts={snapPreview.cuts} />
          )}
        </div>
      )}

      {err && (
        <div className="text-[11px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2">
          {err}
        </div>
      )}
    </div>
  )
}

function UploadDropzone({ uploading, onUpload }) {
  const inputRef = useRef(null)
  return (
    <div className="border-2 border-dashed border-[#e5e5e5] rounded-lg p-4 text-center">
      <input
        ref={inputRef}
        type="file"
        accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/m4a,audio/x-m4a,audio/aac,audio/ogg"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) onUpload(f)
          e.target.value = ''
        }}
      />
      <div className="text-[24px]">🎵</div>
      <div className="text-[11px] text-ink font-medium mt-1">Upload music for the beat-sync jump cuts</div>
      <div className="text-[10px] text-muted mt-0.5">MP3 / WAV / M4A. Up to 50 MB.</div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="mt-2 text-[11px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
      >{uploading ? 'Uploading + analyzing…' : 'Choose audio file'}</button>
    </div>
  )
}

// Persisted track summary + native HTML5 audio player constrained
// to the trim window. The player's loadedmetadata handler seeks to
// trimStart and the timeupdate handler pauses + resets when the
// playhead reaches trimEnd, so the operator only ever auditions
// the slice they're actually going to render.
function TrackCard({ music, trimStart, trimEnd, onDelete, onReanalyze, reanalyzing }) {
  const audioRef = useRef(null)
  const bm = music?.beat_map || null
  const fullDuration = Number(bm?.duration) || 0
  const hasTrim = trimStart > 0 || (trimEnd > 0 && trimEnd < fullDuration)

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const start = Number(trimStart) || 0
    const end = Number(trimEnd) > 0 ? Number(trimEnd) : (a.duration || Infinity)
    const onLoaded = () => {
      if (start > 0) {
        try { a.currentTime = start } catch {}
      }
    }
    const onTimeUpdate = () => {
      if (a.currentTime >= end - 0.03) {
        try { a.pause() } catch {}
        try { a.currentTime = start } catch {}
      } else if (a.currentTime < start - 0.03) {
        try { a.currentTime = start } catch {}
      }
    }
    const onPlay = () => {
      if (a.currentTime < start || a.currentTime >= end - 0.03) {
        try { a.currentTime = start } catch {}
      }
    }
    a.addEventListener('loadedmetadata', onLoaded)
    a.addEventListener('timeupdate', onTimeUpdate)
    a.addEventListener('play', onPlay)
    return () => {
      a.removeEventListener('loadedmetadata', onLoaded)
      a.removeEventListener('timeupdate', onTimeUpdate)
      a.removeEventListener('play', onPlay)
    }
  }, [trimStart, trimEnd])

  return (
    <div className="border border-[#e5e5e5] rounded-lg p-2 space-y-1.5 bg-white">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium truncate" title={music.filename}>{music.filename || 'Untitled music track'}</div>
          <div className="text-[10px] text-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
            {bm?.bpm != null && (
              <span className="font-mono">
                {Math.round(bm.bpm)} BPM
                {bm.bpmCertain === false && <span className="text-[#d97706] ml-1" title="aubio flagged this BPM as uncertain — the track may have an irregular beat.">(uncertain)</span>}
              </span>
            )}
            {fullDuration > 0 && <><span>·</span><span className="font-mono">{fullDuration.toFixed(1)}s total</span></>}
            {hasTrim && <><span>·</span><span className="font-mono text-[#6C5CE7]">trim {trimStart.toFixed(1)}s–{trimEnd.toFixed(1)}s</span></>}
            {Array.isArray(bm?.beats) && <><span>·</span><span className="font-mono">{bm.beats.length} beats</span></>}
          </div>
        </div>
        <button
          type="button"
          onClick={onReanalyze}
          disabled={reanalyzing}
          className="text-[10px] py-0.5 px-2 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer disabled:opacity-50"
          title="Re-run aubio analysis on the stored track. Useful if the first analysis failed or was inaccurate."
        >{reanalyzing ? '…' : 'Re-analyze'}</button>
        <button
          type="button"
          onClick={onDelete}
          className="text-[10px] py-0.5 px-2 border border-[#c0392b] text-[#c0392b] bg-white rounded cursor-pointer"
        >Remove</button>
      </div>
      {music.track_url && (
        <audio
          ref={audioRef}
          src={music.track_url}
          controls
          preload="metadata"
          className="w-full"
          style={{ height: 32 }}
        />
      )}
    </div>
  )
}

// Numeric trim controls. Two inputs with arrow steppers + "Use
// full track" reset. Saves on blur (or Enter) — debouncing per
// keystroke would race the BE PATCH and risk an out-of-order
// write where a half-typed "2" lands after the final "20.5". Blur
// is the more predictable trigger here.
function TrimControls({ fullDuration, trimStart, trimEnd, hasTrim, onChange }) {
  const [startInput, setStartInput] = useState(trimStart.toFixed(2))
  const [endInput, setEndInput] = useState(trimEnd.toFixed(2))

  useEffect(() => { setStartInput(trimStart.toFixed(2)) }, [trimStart])
  useEffect(() => { setEndInput(trimEnd.toFixed(2)) }, [trimEnd])

  const commit = (nextStartStr, nextEndStr) => {
    const sNum = Number(nextStartStr)
    const eNum = Number(nextEndStr)
    if (!Number.isFinite(sNum) || !Number.isFinite(eNum)) return
    const s = Math.max(0, Math.min(fullDuration, sNum))
    const e = Math.max(s + 0.05, Math.min(fullDuration, eNum))
    // null when the operator is back to the full track (saves the
    // BE storing redundant 0/duration values).
    const trim_start = s > 0.001 ? Number(s.toFixed(3)) : null
    const trim_end = e < fullDuration - 0.001 ? Number(e.toFixed(3)) : null
    onChange({ trim_start, trim_end })
  }

  const reset = () => {
    setStartInput('0.00')
    setEndInput(fullDuration.toFixed(2))
    onChange({ trim_start: null, trim_end: null })
  }

  return (
    <div className="border border-[#e5e5e5] rounded p-2 bg-[#fafafa] space-y-1.5">
      <div className="text-[10px] font-medium text-ink">Trim music to a window</div>
      <div className="flex items-center gap-2 flex-wrap text-[10px]">
        <label className="flex items-center gap-1">
          <span className="text-muted">Start</span>
          <input
            type="number" min={0} max={fullDuration} step={0.05}
            value={startInput}
            onChange={e => setStartInput(e.target.value)}
            onBlur={() => commit(startInput, endInput)}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className="w-16 border border-[#e5e5e5] rounded px-1 py-0.5 text-[10px] font-mono"
          />
          <span className="text-muted">s</span>
        </label>
        <span className="text-muted">→</span>
        <label className="flex items-center gap-1">
          <span className="text-muted">End</span>
          <input
            type="number" min={0.05} max={fullDuration} step={0.05}
            value={endInput}
            onChange={e => setEndInput(e.target.value)}
            onBlur={() => commit(startInput, endInput)}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className="w-16 border border-[#e5e5e5] rounded px-1 py-0.5 text-[10px] font-mono"
          />
          <span className="text-muted">s</span>
        </label>
        <span className="font-mono text-muted">
          ({(Number(endInput) - Number(startInput)).toFixed(2)}s window)
        </span>
        {hasTrim && (
          <button
            type="button"
            onClick={reset}
            className="ml-auto text-[10px] py-0.5 px-2 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
            title="Clear the trim window and use the full track."
          >Use full track</button>
        )}
      </div>
      <div className="text-[9px] text-muted italic">
        Trim is non-destructive — the full music file stays uploaded; we just slice when computing beats + when swapping audio at merge.
      </div>
    </div>
  )
}

// Zoom + pan controls. The viewport spans 1/zoom of the trimmed
// window and slides by `pan` (0..1). At zoom=1 the full trimmed
// window is visible and pan is moot.
function ZoomBar({ zoom, pan, setZoom, setPan }) {
  const LEVELS = [1, 2, 4, 8]
  const visibleFraction = 1 / zoom
  // Cap pan so the viewport stays inside [0, 1].
  const clampedPan = Math.max(0, Math.min(1 - visibleFraction, pan))
  useEffect(() => {
    if (clampedPan !== pan) setPan(clampedPan)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="text-muted">Zoom</span>
      {LEVELS.map(level => (
        <button
          key={level}
          type="button"
          onClick={() => setZoom(level)}
          className={`py-0.5 px-2 rounded border ${
            zoom === level
              ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]'
              : 'bg-white text-muted border-[#e5e5e5]'
          }`}
        >{level}×</button>
      ))}
      {zoom > 1 && (
        <>
          <span className="text-muted ml-1">Pan</span>
          <input
            type="range"
            min={0}
            max={1 - visibleFraction}
            step={0.01}
            value={clampedPan}
            onChange={e => setPan(Number(e.target.value))}
            className="flex-1"
          />
          <span className="font-mono text-muted w-10 text-right">{Math.round(clampedPan * 100)}%</span>
        </>
      )}
    </div>
  )
}

// Canvas-based beat-marker waveform. Renders ONLY the trimmed
// window (or a zoom slice of it). x positions are normalized
// against the viewport's start/end in track-absolute time, so
// changing zoom/pan just rescales without re-fetching anything.
function WaveformBeatStrip({ beatMap, trimStart, trimEnd, zoom, pan }) {
  const canvasRef = useRef(null)
  const duration = Math.max(0, trimEnd - trimStart)
  const visibleFraction = 1 / Math.max(1, zoom)
  const visibleSpan = duration * visibleFraction
  // Viewport in track-absolute seconds. pan is normalized so we
  // scale by the spare (duration - visibleSpan), giving an exact
  // start position that respects zoom.
  const viewStart = trimStart + (duration - visibleSpan) * Math.max(0, Math.min(1, pan))
  const viewEnd = viewStart + visibleSpan

  const beats = (Array.isArray(beatMap?.beats) ? beatMap.beats : [])
    .filter(b => b >= viewStart && b <= viewEnd)
  const onsets = (Array.isArray(beatMap?.onsets) ? beatMap.onsets : [])
    .filter(b => b >= viewStart && b <= viewEnd)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !(duration > 0)) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    // Background lane
    ctx.fillStyle = '#fafafa'
    ctx.fillRect(0, 0, w, h)

    if (!(visibleSpan > 0)) return
    const x = (t) => ((t - viewStart) / visibleSpan) * w

    // Onsets first (lighter, taller), beats on top (full height,
    // brand color). The visual separation lets the operator
    // distinguish percussive transients from the analyzer's
    // confidence-weighted beat picks.
    ctx.strokeStyle = 'rgba(108, 92, 231, 0.22)'
    ctx.lineWidth = 1
    for (const t of onsets) {
      const px = x(t)
      ctx.beginPath()
      ctx.moveTo(px, h * 0.30)
      ctx.lineTo(px, h * 0.95)
      ctx.stroke()
    }
    ctx.strokeStyle = '#6C5CE7'
    ctx.lineWidth = 1.5
    for (const t of beats) {
      const px = x(t)
      ctx.beginPath()
      ctx.moveTo(px, h * 0.05)
      ctx.lineTo(px, h * 0.95)
      ctx.stroke()
    }

    // Tick marks. Step size adjusts to zoom so the labels stay
    // readable: when the viewport is < 4s we mark every 0.5s; up
    // to 20s every 1s; otherwise every 2s.
    let step
    if (visibleSpan < 4) step = 0.5
    else if (visibleSpan < 20) step = 1
    else step = 2
    ctx.fillStyle = '#999'
    ctx.font = '8px monospace'
    const firstTick = Math.ceil(viewStart / step) * step
    for (let t = firstTick; t <= viewEnd + 1e-6; t += step) {
      const px = x(t)
      ctx.fillRect(px, h - 4, 1, 4)
      const label = step >= 1 ? `${Math.round(t)}s` : `${t.toFixed(1)}s`
      ctx.fillText(label, px + 2, h - 6)
    }
  }, [duration, viewStart, viewEnd, beats.length, onsets.length])

  return (
    <div className="space-y-1">
      <div className="text-[10px] text-muted flex items-center justify-between gap-2 flex-wrap">
        <span>
          Waveform: <span className="text-[#6C5CE7] font-medium">beats</span> + <span className="text-[#6C5CE7]/60">onsets</span> in the trimmed window.
        </span>
        <span className="font-mono">view {viewStart.toFixed(2)}s → {viewEnd.toFixed(2)}s ({beats.length} beats)</span>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 56 }}
        className="border border-[#e5e5e5] rounded"
      />
    </div>
  )
}

function SnapPlanTable({ plan, cuts }) {
  return (
    <div className="bg-white border border-[#e5e5e5] rounded p-1.5">
      <div className="text-[10px] text-muted mb-1">
        Cut points (s): {Array.isArray(cuts) ? cuts.map(c => Number(c).toFixed(2)).join(' · ') : '—'}
      </div>
      <table className="text-[10px] w-full">
        <thead>
          <tr className="text-muted text-left">
            <th className="font-medium">#</th>
            <th className="font-medium">clip-id</th>
            <th className="font-medium">Trim (s)</th>
            <th className="font-medium">Window (s)</th>
            <th className="font-medium">Ends @</th>
          </tr>
        </thead>
        <tbody>
          {plan.map(p => {
            const changed = Number(p.original_trim_end ?? -1) !== Number(p.trim_end)
            return (
              <tr key={p.dbFileId} className={changed ? 'bg-[#f3f0ff]' : ''}>
                <td className="font-mono">{p.file_order + 1}</td>
                <td className="font-mono text-muted">clip-{p.dbFileId}</td>
                <td className="font-mono">
                  {Number(p.trim_start).toFixed(2)} → {Number(p.trim_end).toFixed(2)}
                </td>
                <td className="font-mono">{Number(p.window_length).toFixed(2)}</td>
                <td className="font-mono">{Number(p.cut_at).toFixed(2)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
