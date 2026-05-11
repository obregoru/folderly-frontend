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
  // Verify state — { ok, checked, mismatches: [...] } populated by
  // handleVerify after Apply. We persist the plan that was Applied
  // (snapshotted at apply time) so a later reload doesn't lose the
  // ground truth we should be comparing against.
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState(null)
  const [appliedPlan, setAppliedPlan] = useState(null)
  // Waveform viewport. zoom > 1 zooms into a slice of the trimmed
  // window; pan slides that slice [0..1]. View resets to 1x on
  // every new upload / trim change so the operator doesn't end
  // up on a stale viewport that no longer corresponds to the data.
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState(0)
  // Shared audio ref — owned by the parent so the waveform can
  // read currentTime and animate a playhead during playback. Both
  // TrackCard (which renders the <audio> element) and
  // WaveformBeatStrip (which paints the playhead) receive this.
  const audioRef = useRef(null)

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

  const handlePacingChange = async (next) => {
    if (!draftId) return
    setErr(null)
    try {
      const r = await api.setJobMusicPacing(draftId, next)
      setMusic(prev => prev ? { ...prev, pacing: r.music_pacing } : prev)
      setSnapPreview(null) // pacing change invalidates the cached preview
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
    setVerifyResult(null)
    try {
      const r = await api.applyBeatSnap(draftId)
      setAppliedAt(new Date().toISOString())
      setSnapPreview({ ...snapPreview, ...r, applied: true })
      // Snapshot the plan that was applied so the Verify button can
      // compare against the exact ground truth (not against a later
      // re-preview that might differ if music/trim changes
      // afterward).
      setAppliedPlan(Array.isArray(r.plan) ? r.plan : null)
      try { await jobSync?.loadJob?.(draftId) } catch {}
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setApplying(false)
    }
  }

  // Verify: refetch the job + compare each host clip's persisted
  // trim_start / trim_end / file_order against the applied plan,
  // AND force-reload the FE state via jobSync.loadJob so the Media
  // tab + the next merge use the fresh trim values.
  //
  // Two failure modes this catches:
  //   1. BE returned 200 on apply-snap but the row update didn't
  //      actually land (network blip mid-transaction, deploy
  //      mid-write). Surfaces as a red mismatch table; the operator
  //      should re-Apply.
  //   2. BE wrote the rows correctly but the FE state is stale —
  //      e.g. an in-flight loadJob from earlier finished AFTER the
  //      apply landed, overwriting fresh state with the older snap.
  //      Without a forced reload here, the next merge from
  //      VideoMerge would send the OLD trim values from the cached
  //      files[] state. handleVerify always re-runs loadJob so
  //      that state is guaranteed-current after a successful Verify.
  //
  // Steps surfaced to the operator:
  //   ① Fetch the latest job state from the server
  //   ② Compare each clip against the applied plan
  //   ③ Force-reload the in-memory FE cache (Media tab refresh)
  //   ④ Report success or per-clip mismatches
  const [verifyStep, setVerifyStep] = useState(null)
  const handleVerify = async () => {
    if (!draftId || !appliedPlan?.length || verifying) return
    setVerifying(true)
    setVerifyResult(null)
    setVerifyStep('Fetching the latest job state from the server…')
    try {
      const job = await api.getJob(draftId)
      setVerifyStep('Comparing each clip against the plan…')
      const files = Array.isArray(job?.files) ? job.files : []
      const fileById = new Map(files.map(f => [Number(f.id), f]))
      const mismatches = []
      const matches = []
      // Per-clip detail rows so the operator sees POSITIVE
      // confirmation, not just "no errors." Order matters here —
      // we walk appliedPlan in file_order so the rendered rows are
      // 1, 2, 3 in the order the operator expects to see in the
      // Media tab.
      const perClip = []
      // Tolerance on float compares — BE stores NUMERIC(8,3) and
      // returns strings, so a 0.001 wobble is normal and shouldn't
      // be flagged. Anything bigger is a real divergence.
      const EPS = 0.005
      const sortedPlan = [...appliedPlan].sort((a, b) => Number(a.file_order) - Number(b.file_order))
      for (const item of sortedPlan) {
        const f = fileById.get(Number(item.dbFileId))
        if (!f) {
          mismatches.push({
            clipId: item.dbFileId,
            field: 'row',
            expected: 'present',
            actual: 'missing (deleted or moved jobs)',
          })
          perClip.push({
            clipId: item.dbFileId,
            filename: '(missing)',
            ok: false,
            order: { expected: item.file_order + 1, actual: '—' },
            trim: { expected: `${Number(item.trim_start).toFixed(3)} → ${Number(item.trim_end).toFixed(3)}`, actual: '—' },
          })
          continue
        }
        const actualStart = Number(f.trim_start) || 0
        const actualEnd = Number(f.trim_end) || 0
        const actualOrder = Number(f.file_order)
        const startOk = Math.abs(actualStart - Number(item.trim_start)) <= EPS
        const endOk = Math.abs(actualEnd - Number(item.trim_end)) <= EPS
        const orderOk = Number.isFinite(actualOrder) && actualOrder === Number(item.file_order)
        if (!startOk) mismatches.push({ clipId: item.dbFileId, field: 'trim_start', expected: Number(item.trim_start).toFixed(3), actual: actualStart.toFixed(3) })
        if (!endOk) mismatches.push({ clipId: item.dbFileId, field: 'trim_end', expected: Number(item.trim_end).toFixed(3), actual: actualEnd.toFixed(3) })
        if (!orderOk) mismatches.push({ clipId: item.dbFileId, field: 'file_order', expected: String(item.file_order), actual: String(actualOrder) })
        const clipOk = startOk && endOk && orderOk
        if (clipOk) matches.push(item.dbFileId)
        perClip.push({
          clipId: item.dbFileId,
          filename: f.filename || `clip-${item.dbFileId}`,
          ok: clipOk,
          order: { expected: item.file_order + 1, actual: Number.isFinite(actualOrder) ? actualOrder + 1 : '—', ok: orderOk },
          trim: {
            expected: `${Number(item.trim_start).toFixed(2)}s → ${Number(item.trim_end).toFixed(2)}s`,
            actual: `${actualStart.toFixed(2)}s → ${actualEnd.toFixed(2)}s`,
            ok: startOk && endOk,
          },
        })
      }
      const allOk = mismatches.length === 0
      // Step 3: ALWAYS force-reload the FE state so jobSync.files
      // matches the BE. Without this the Media tab + the next
      // merge from VideoMerge would still send the old trim
      // values cached in client state. Even on partial mismatch we
      // reload so the operator at least sees current truth in the
      // UI.
      setVerifyStep('Refreshing the Media tab cache…')
      try { await jobSync?.loadJob?.(draftId) } catch (e) {
        console.warn('[music verify] loadJob refresh failed (non-fatal):', e?.message)
      }
      setVerifyStep(null)
      setVerifyResult({
        ok: allOk,
        checked: appliedPlan.length,
        matched: matches.length,
        mismatches,
        perClip,
        reloadedCache: true,
        checkedAt: new Date().toISOString(),
      })
    } catch (e) {
      setVerifyStep(null)
      setVerifyResult({
        ok: false,
        checked: 0,
        matched: 0,
        mismatches: [{ clipId: '—', field: 'fetch', expected: 'job', actual: `error: ${e?.message || e}` }],
        checkedAt: new Date().toISOString(),
      })
    } finally {
      setVerifying(false)
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
          audioRef={audioRef}
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
            audioRef={audioRef}
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
          <PacingSelector pacing={Number(music?.pacing) || 1} onChange={handlePacingChange} />
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
            {snapPreview?.applied && appliedPlan?.length > 0 && (
              <button
                type="button"
                onClick={handleVerify}
                disabled={verifying}
                className="text-[10px] py-1 px-2 border border-[#2D9A5E] text-[#2D9A5E] bg-white rounded cursor-pointer disabled:opacity-50 font-medium"
                title="Refetch the job and compare each clip's persisted trim_start / trim_end / file_order against the plan that was applied. Catches the rare case where Apply returned 200 but a row update didn't land."
              >{verifying ? 'Verifying…' : '🔎 Verify'}</button>
            )}
            {snapPreview?.applied && (
              <span className="text-[10px] text-[#2D9A5E] font-medium">✓ Applied {appliedAt && `at ${new Date(appliedAt).toLocaleTimeString()}`}. Re-merge to see the new cuts.</span>
            )}
          </div>
          {verifyStep && (
            <div className="text-[10px] text-muted italic">⏳ {verifyStep}</div>
          )}
          {verifyResult && (
            <VerifyResultPanel result={verifyResult} />
          )}
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
function TrackCard({ music, trimStart, trimEnd, onDelete, onReanalyze, reanalyzing, audioRef }) {
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
// Pacing selector — 3 buttons. Changes which beats are
// candidates for the snap algorithm:
//   1 → every beat (densest, "fast cuts")
//   2 → every other beat (moderate)
//   4 → every 4th beat (downbeat-ish, "slow cuts")
// Selecting a new pacing immediately PATCHes the job and clears
// any stale snap preview so the operator sees a fresh plan on the
// next Preview click.
function PacingSelector({ pacing, onChange }) {
  const OPTIONS = [
    { value: 1, label: 'Fast', subtitle: 'every beat' },
    { value: 2, label: 'Medium', subtitle: 'every 2 beats' },
    { value: 4, label: 'Slow', subtitle: 'every 4 beats' },
  ]
  const current = OPTIONS.some(o => o.value === pacing) ? pacing : 1
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="text-[#6C5CE7]/80">Pacing</span>
      {OPTIONS.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`py-0.5 px-2 rounded border ${
            current === o.value
              ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]'
              : 'bg-white text-[#6C5CE7] border-[#6C5CE7]/40'
          }`}
          title={o.subtitle + ' — ' + (o.value === 1 ? 'densest cuts (fastest)' : o.value === 4 ? 'spaced cuts (slowest)' : 'moderate density')}
        >
          <span className="font-medium">{o.label}</span>
          <span className="text-[8px] opacity-75 ml-1">({o.subtitle})</span>
        </button>
      ))}
    </div>
  )
}

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
//
// A playhead indicator animates across the strip while the audio
// player is playing so the operator can SEE which beat is sounding
// at any moment. The playhead reads audioRef.current.currentTime
// inside a rAF loop and redraws the canvas each frame — beats
// rarely outnumber a few hundred so the full redraw cost is well
// under the rAF budget. We also lit-flash the nearest beat marker
// when the playhead crosses it (within a small tolerance), which
// turns the waveform into a "follow along" visualization.
function WaveformBeatStrip({ beatMap, trimStart, trimEnd, zoom, pan, audioRef }) {
  const canvasRef = useRef(null)
  const duration = Math.max(0, trimEnd - trimStart)
  const visibleFraction = 1 / Math.max(1, zoom)
  const visibleSpan = duration * visibleFraction
  const viewStart = trimStart + (duration - visibleSpan) * Math.max(0, Math.min(1, pan))
  const viewEnd = viewStart + visibleSpan

  const beats = (Array.isArray(beatMap?.beats) ? beatMap.beats : [])
    .filter(b => b >= viewStart && b <= viewEnd)
  const onsets = (Array.isArray(beatMap?.onsets) ? beatMap.onsets : [])
    .filter(b => b >= viewStart && b <= viewEnd)

  // Single draw function — invoked both when viewport changes
  // (zoom/pan/trim) AND every rAF tick while audio plays. Reading
  // currentTime each frame is cheap; rendering 10-50 vertical
  // lines is similarly cheap.
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

    const drawFrame = () => {
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#fafafa'
      ctx.fillRect(0, 0, w, h)
      if (!(visibleSpan > 0)) return
      const x = (t) => ((t - viewStart) / visibleSpan) * w

      // Current playhead time (clamped to viewport). When audio
      // is not present or paused at 0, this is a no-op.
      const a = audioRef?.current
      const playT = a ? Number(a.currentTime) || 0 : 0
      // Tolerance for "currently playing this beat" — wider tol
      // when zoomed out so the beat lights up visibly, tighter
      // when zoomed in so adjacent beats don't both flash.
      const flashTol = Math.max(0.04, visibleSpan / w * 8)

      // Onsets first (lighter, taller), beats on top (full height,
      // brand color). Flash any beat near the playhead.
      ctx.strokeStyle = 'rgba(108, 92, 231, 0.22)'
      ctx.lineWidth = 1
      for (const t of onsets) {
        const px = x(t)
        ctx.beginPath()
        ctx.moveTo(px, h * 0.30)
        ctx.lineTo(px, h * 0.95)
        ctx.stroke()
      }
      for (const t of beats) {
        const px = x(t)
        const near = a && !a.paused && Math.abs(t - playT) <= flashTol
        ctx.strokeStyle = near ? '#f5a623' : '#6C5CE7'
        ctx.lineWidth = near ? 2.5 : 1.5
        ctx.beginPath()
        ctx.moveTo(px, near ? h * 0.0 : h * 0.05)
        ctx.lineTo(px, h * 0.95)
        ctx.stroke()
      }

      // Playhead — vertical accent line + small triangle pointer
      // at the top so it's visible even when no beats are nearby.
      // Only drawn when the audio has been started AT LEAST once
      // (currentTime > 0) so we don't render a phantom playhead
      // at t=0 when the operator first opens the panel.
      const showPlayhead = a && (playT > 0 || !a.paused) && playT >= viewStart && playT <= viewEnd
      if (showPlayhead) {
        const px = x(playT)
        ctx.strokeStyle = '#2D9A5E'
        ctx.lineWidth = 1.5
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(px, 0)
        ctx.lineTo(px, h)
        ctx.stroke()
        // Triangle on top
        ctx.fillStyle = '#2D9A5E'
        ctx.beginPath()
        ctx.moveTo(px - 4, 0)
        ctx.lineTo(px + 4, 0)
        ctx.lineTo(px, 6)
        ctx.closePath()
        ctx.fill()
      }

      // Tick marks last so they sit on top of the markers.
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
    }

    drawFrame()

    // rAF loop — only runs while audio is playing OR currentTime
    // is non-zero (so the playhead stays put when the operator
    // pauses, instead of disappearing). The cleanup cancels the
    // pending frame on unmount / viewport change so stale frames
    // don't draw to a torn-down canvas.
    let rafId = null
    let lastDrawnT = -1
    const tick = () => {
      const a = audioRef?.current
      if (a) {
        const t = Number(a.currentTime) || 0
        // Only redraw when the playhead has actually moved enough
        // to change a pixel — saves perf when paused.
        const pxPerSec = visibleSpan > 0 ? (canvas.clientWidth / visibleSpan) : 0
        const movedPx = Math.abs(t - lastDrawnT) * pxPerSec
        if (movedPx >= 0.5 || lastDrawnT < 0) {
          drawFrame()
          lastDrawnT = t
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => { if (rafId != null) cancelAnimationFrame(rafId) }
  }, [duration, viewStart, viewEnd, beats.length, onsets.length, audioRef])

  return (
    <div className="space-y-1">
      <div className="text-[10px] text-muted flex items-center justify-between gap-2 flex-wrap">
        <span>
          Waveform: <span className="text-[#6C5CE7] font-medium">beats</span> + <span className="text-[#6C5CE7]/60">onsets</span> + <span className="text-[#2D9A5E] font-medium">playhead</span>.
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

// Verify result — green ok-card or red mismatch table. After
// Verify runs, the FE has refreshed jobSync.files from the BE so
// the Media tab + next merge use the current trim/order values.
function VerifyResultPanel({ result }) {
  if (!result) return null
  const perClip = Array.isArray(result.perClip) ? result.perClip : []
  return (
    <div className={`text-[10px] rounded p-2 space-y-1.5 ${
      result.ok
        ? 'bg-[#f0faf4] border border-[#2D9A5E]/40 text-[#0a4d2c]'
        : 'bg-[#fdf2f1] border border-[#c0392b]/40 text-[#c0392b]'
    }`}>
      <div className="font-medium">
        {result.ok
          ? <>✓ Verified — all {result.checked} clip{result.checked === 1 ? '' : 's'} match the plan (order + trim).</>
          : <>⚠ Verification failed — {result.mismatches.length} mismatch{result.mismatches.length === 1 ? '' : 'es'} across {result.matched}/{result.checked} clip{result.checked === 1 ? '' : 's'} matched.</>}
      </div>
      {result.reloadedCache && (
        <div className="text-[9px] opacity-80">
          🔄 Media tab cache refreshed from the server — your next merge will use the current trim/order values.
        </div>
      )}
      {perClip.length > 0 && (
        <div className="bg-white border border-[#e5e5e5] rounded p-1.5">
          <table className="text-[10px] w-full text-ink">
            <thead>
              <tr className="text-muted text-left">
                <th className="font-medium">#</th>
                <th className="font-medium">Clip</th>
                <th className="font-medium">Order</th>
                <th className="font-medium">Trim (plan → actual)</th>
                <th className="font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {perClip.map((c, i) => (
                <tr key={c.clipId ?? i} className={c.ok ? '' : 'bg-[#fdf2f1]'}>
                  <td className="font-mono">{i + 1}</td>
                  <td className="font-mono truncate max-w-[140px]" title={c.filename}>{c.filename}</td>
                  <td className={`font-mono ${c.order?.ok === false ? 'text-[#c0392b]' : ''}`}>
                    {c.order?.expected}{c.order?.actual !== c.order?.expected ? ` (got ${c.order?.actual})` : ''}
                  </td>
                  <td className={`font-mono ${c.trim?.ok === false ? 'text-[#c0392b]' : ''}`}>
                    {c.trim?.expected}
                    {c.trim?.actual !== c.trim?.expected ? <span className="text-[#c0392b]"> ≠ {c.trim?.actual}</span> : null}
                  </td>
                  <td className="font-mono">{c.ok ? '✓' : '✗'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!result.ok && (
        <div className="text-[9px] opacity-80 italic">
          Click <b>Apply to clips</b> again to retry. The mismatches above show what the BE has now vs what the plan asked for.
        </div>
      )}
    </div>
  )
}

// Format seconds for the operator. Under a minute → "1.41s".
// Over a minute → "1:23.41" so longer music tracks stay readable
// without mental math. Always returns a single line so it fits
// inside the table cells.
function formatTime(sec) {
  const n = Number(sec)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 60) return `${n.toFixed(2)}s`
  const mins = Math.floor(n / 60)
  const rem = n - mins * 60
  return `${mins}:${rem.toFixed(2).padStart(5, '0')}`
}

function SnapPlanTable({ plan, cuts }) {
  const cutList = Array.isArray(cuts) ? cuts : []
  // Stringify each cut as both an index (Cut 1, Cut 2, ...) AND
  // its absolute time so the operator can read off when each cut
  // lands in the music without subtracting consecutive values.
  // Cut 0 (the music start) is implicit; we surface cuts 1..N
  // since those are the meaningful events.
  return (
    <div className="bg-white border border-[#e5e5e5] rounded p-1.5">
      <div className="text-[10px] text-muted mb-1.5">
        <div className="font-medium text-ink mb-0.5">Cut points on the music timeline:</div>
        {cutList.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {cutList.slice(1).map((c, i) => {
              const prev = Number(cutList[i]) || 0
              const cur = Number(c) || 0
              const windowLen = cur - prev
              return (
                <span
                  key={i}
                  className="font-mono bg-[#f3f0ff] border border-[#6C5CE7]/30 text-[#6C5CE7] rounded px-1.5 py-0.5"
                  title={`Cut ${i + 1}: lands at ${formatTime(cur)}, ${formatTime(windowLen)} after the previous cut`}
                >
                  Cut {i + 1} @ {formatTime(cur)}
                  <span className="text-[9px] opacity-70 ml-1">(+{windowLen.toFixed(2)}s)</span>
                </span>
              )
            })}
          </div>
        ) : '—'}
      </div>
      <table className="text-[10px] w-full">
        <thead>
          <tr className="text-muted text-left">
            <th className="font-medium">#</th>
            <th className="font-medium">clip-id</th>
            <th className="font-medium">Trim</th>
            <th className="font-medium">Length</th>
            <th className="font-medium" title="Cumulative output-video time at the end of this clip">Total</th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            // Running total walks the plan in display order
            // (file_order ascending) and sums window_length. With
            // gapless cuts the result equals `cut_at` — surfacing
            // both gives the operator two reads of the same idea:
            // "cut at <music time>" vs "<this much video has
            // played at this point>."
            let cumulative = 0
            return plan.map(p => {
              const changed = Number(p.original_trim_end ?? -1) !== Number(p.trim_end)
              cumulative += Number(p.window_length) || 0
              return (
                <tr key={p.dbFileId} className={changed ? 'bg-[#f3f0ff]' : ''}>
                  <td className="font-mono">{p.file_order + 1}</td>
                  <td className="font-mono text-muted">clip-{p.dbFileId}</td>
                  <td className="font-mono">
                    {formatTime(p.trim_start)} → {formatTime(p.trim_end)}
                  </td>
                  <td className="font-mono">{formatTime(p.window_length)}</td>
                  <td className="font-mono">{formatTime(p.cut_at)}</td>
                  <td className="font-mono font-medium text-[#6C5CE7]">{formatTime(cumulative)}</td>
                </tr>
              )
            })
          })()}
        </tbody>
      </table>
    </div>
  )
}
