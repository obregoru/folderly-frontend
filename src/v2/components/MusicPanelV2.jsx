// Music panel — the editor surface for the beat-sync jump-cut
// feature. Operator uploads a music file; BE runs aubio to extract
// BPM + beat times. Then they click "Snap clips to beats" → BE
// computes a clip plan (overwrites trim_start/trim_end + file_order
// so cuts land on beats) → operator hits Apply → next merge bakes
// in the new cuts and swaps the audio to the music track.
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
  const [music, setMusic] = useState(null) // { track_url, filename, beat_map, ... } from BE
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState(null)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [snapPreview, setSnapPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [appliedAt, setAppliedAt] = useState(null)

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

  const handleUpload = async (file) => {
    if (!draftId || !file) return
    setErr(null)
    setSnapPreview(null) // any prior preview becomes stale on new upload
    setUploading(true)
    try {
      const b64 = await fileToBase64(file)
      const r = await api.uploadJobMusic(draftId, {
        audio_base64: b64,
        filename: file.name,
        media_type: file.type || 'audio/mpeg',
      })
      // Refetch via the canonical GET so we get the resolved
      // public_url + the persisted shape — the upload response
      // includes the same fields but reading once-through-GET
      // matches what the BE will return on reload.
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
      // Force the job state to refresh so the clips panel + merge
      // reflect the new trim values immediately.
      try { await jobSync?.loadJob?.(draftId) } catch {}
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setApplying(false)
    }
  }

  const beatMap = music?.beat_map || null

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
          onDelete={handleDelete}
          onReanalyze={handleReanalyze}
          reanalyzing={reanalyzing}
        />
      )}

      {music && beatMap && (
        <WaveformBeatStrip beatMap={beatMap} trackUrl={music.track_url} />
      )}

      {music && !beatMap && (
        <div className="text-[11px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2">
          The analyzer couldn't extract a beat map from this file (BPM was indeterminate). Try a different track or click <b>Re-analyze</b>.
        </div>
      )}

      {music && beatMap && (
        <div className="border border-[#6C5CE7]/30 bg-[#f3f0ff] rounded p-2 space-y-1.5">
          <div className="text-[11px] font-medium text-[#6C5CE7]">Snap clips to beats</div>
          <div className="text-[9px] text-[#6C5CE7]/80">
            Computes new trim_start / trim_end / file_order on every video clip so cuts align to beats. Preview first to see the plan.
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

// Drop-zone for the initial upload. Mirrors the voiceover-upload
// UX so operators don't have to learn a new affordance.
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

// Persisted track summary + native HTML5 audio player.
function TrackCard({ music, onDelete, onReanalyze, reanalyzing }) {
  const bm = music?.beat_map || null
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
            {bm?.duration != null && <><span>·</span><span className="font-mono">{Number(bm.duration).toFixed(1)}s</span></>}
            {Array.isArray(bm?.beats) && <><span>·</span><span className="font-mono">{bm.beats.length} beats</span></>}
            {Array.isArray(bm?.onsets) && <><span>·</span><span className="font-mono">{bm.onsets.length} onsets</span></>}
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

// Canvas waveform-ish strip showing the beat map. We don't render
// the actual audio amplitude (would require Web Audio API decode +
// re-render) — instead the strip shows beat markers + onset
// markers at their relative time positions. This is enough for
// operators to spot the beat density visually and sanity-check
// the analysis before snapping.
function WaveformBeatStrip({ beatMap, trackUrl }) {
  const canvasRef = useRef(null)
  const duration = Number(beatMap?.duration) || 0
  const beats = Array.isArray(beatMap?.beats) ? beatMap.beats : []
  const onsets = Array.isArray(beatMap?.onsets) ? beatMap.onsets : []

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

    // Background lane
    ctx.fillStyle = '#fafafa'
    ctx.fillRect(0, 0, w, h)

    // Onsets first (lighter, taller) then beats on top (darker, full height)
    ctx.strokeStyle = 'rgba(108, 92, 231, 0.25)'
    ctx.lineWidth = 1
    for (const t of onsets) {
      const x = (t / duration) * w
      ctx.beginPath()
      ctx.moveTo(x, h * 0.25)
      ctx.lineTo(x, h * 0.95)
      ctx.stroke()
    }
    ctx.strokeStyle = '#6C5CE7'
    ctx.lineWidth = 1.5
    for (const t of beats) {
      const x = (t / duration) * w
      ctx.beginPath()
      ctx.moveTo(x, h * 0.05)
      ctx.lineTo(x, h * 0.95)
      ctx.stroke()
    }
    // Tick marks at 1s intervals
    ctx.fillStyle = '#999'
    ctx.font = '8px monospace'
    for (let s = 0; s <= Math.floor(duration); s++) {
      const x = (s / duration) * w
      ctx.fillRect(x, h - 4, 1, 4)
      if (s % 1 === 0 && s > 0) ctx.fillText(`${s}s`, x + 2, h - 6)
    }
  }, [duration, beats.length, onsets.length])

  return (
    <div className="space-y-1">
      <div className="text-[10px] text-muted">
        Waveform: <span className="text-[#6C5CE7] font-medium">beats</span> (dark vertical lines) and <span className="text-[#6C5CE7]/60">onsets</span> (lighter, taller).
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 56 }}
        className="border border-[#e5e5e5] rounded"
      />
    </div>
  )
}

// Plan diff table — shows what trim values each clip will land on
// after Apply. Helps operators sanity-check the algorithm before
// committing.
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
