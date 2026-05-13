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

  // URL import — yt-dlp on the BE pulls audio from a TikTok /
  // YouTube / IG URL. Requires the operator to check the rights
  // confirmation. We surface errors verbatim from the BE so the
  // operator sees yt-dlp's actual failure reason (unsupported
  // host, geo-blocked, etc) instead of a generic "failed."
  const handleUrlImport = async (url, ownsRights) => {
    if (!draftId || !url) return
    setErr(null)
    setSnapPreview(null)
    setUploading(true)
    try {
      await api.uploadJobMusicFromUrl(draftId, {
        url,
        owns_rights_confirmed: !!ownsRights,
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

  const handleLoopToBeatsChange = async (next) => {
    if (!draftId) return
    setErr(null)
    try {
      const r = await api.setJobMusicLoopToBeats(draftId, next)
      setMusic(prev => prev ? { ...prev, loop_to_beats: r.music_loop_to_beats } : prev)
      setSnapPreview(null)
    } catch (e) {
      setErr(e?.message || String(e))
    }
  }

  const handleFreezeLoopsChange = async (next) => {
    if (!draftId) return
    setErr(null)
    try {
      const r = await api.setJobMusicFreezeLoops(draftId, next)
      setMusic(prev => prev ? { ...prev, freeze_loops: r.music_freeze_loops } : prev)
      setSnapPreview(null)
    } catch (e) {
      setErr(e?.message || String(e))
    }
  }

  const handleReverseLoopsChange = async (next) => {
    if (!draftId) return
    setErr(null)
    try {
      const r = await api.setJobMusicReverseLoops(draftId, next)
      setMusic(prev => prev ? { ...prev, reverse_loops: r.music_reverse_loops } : prev)
      setSnapPreview(null)
    } catch (e) {
      setErr(e?.message || String(e))
    }
  }

  const handleMirrorLoopsChange = async (next) => {
    if (!draftId) return
    setErr(null)
    try {
      const r = await api.setJobMusicMirrorLoops(draftId, next)
      setMusic(prev => prev ? { ...prev, mirror_loops: r.music_mirror_loops } : prev)
      setSnapPreview(null)
    } catch (e) {
      setErr(e?.message || String(e))
    }
  }

  const handleLoopColorChange = async (next) => {
    if (!draftId) return
    setErr(null)
    try {
      const r = await api.setJobMusicLoopColorEffect(draftId, next || null)
      setMusic(prev => prev ? { ...prev, loop_color_effect: r.music_loop_color_effect } : prev)
      setSnapPreview(null)
    } catch (e) {
      setErr(e?.message || String(e))
    }
  }

  const handleBeatSourceChange = async (next) => {
    if (!draftId) return
    setErr(null)
    try {
      const r = await api.setJobMusicBeatSource(draftId, next)
      setMusic(prev => prev ? { ...prev, beat_source: r.music_beat_source } : prev)
      setSnapPreview(null)
    } catch (e) {
      setErr(e?.message || String(e))
    }
  }

  // Toggle the music ↔ voiceover mix mode. Persists on
  // voiceover_settings.mix_mode (the existing engine field) but
  // surfaced from the music panel because the operator's mental
  // model is "music dipping under voice." Three modes:
  //   mix     → music constant at orig_volume (default 30%), VO on top
  //   duck    → music auto-ducks during VO via sidechain compression
  //   replace → VO replaces audio entirely (rare for music videos)
  // We fetch fresh voiceover_settings on each toggle to avoid
  // clobbering segment audio keys / voiceId that the VO panel may
  // have edited in parallel.
  const handleVoMixModeChange = async (nextMode) => {
    if (!draftId) return
    setErr(null)
    try {
      const job = await api.getJob(draftId)
      const cur = (job?.voiceover_settings && typeof job.voiceover_settings === 'object') ? job.voiceover_settings : {}
      const next = { ...cur, mix_mode: nextMode }
      await api.updateJob(draftId, { voiceover_settings: next })
      setMusic(prev => prev ? { ...prev, vo_mix_mode: nextMode } : prev)
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
      // Match by file_order rather than dbFileId because
      // loop-duplicate plan entries don't have a stable dbFileId
      // (those rows are CREATED on Apply, so the plan's dbFileId
      // is null for those windows). file_order is the deterministic
      // key the BE assigns 0..M-1 across both source and loop
      // duplicate rows.
      const hostFiles = files.filter(f => f && f.insert_into_file_id == null)
      const fileByOrder = new Map(hostFiles.map(f => [Number(f.file_order), f]))
      const mismatches = []
      const matches = []
      const perClip = []
      const EPS = 0.005
      const sortedPlan = [...appliedPlan].sort((a, b) => Number(a.file_order) - Number(b.file_order))
      for (const item of sortedPlan) {
        const f = fileByOrder.get(Number(item.file_order))
        // For loop duplicates the planned dbFileId is null;
        // identify by source_clip_id + ↻ marker so the mismatch
        // table still reads sensibly.
        const planClipLabel = item.is_loop_duplicate
          ? `↻ clip-${item.source_clip_id}`
          : `clip-${item.dbFileId || item.source_clip_id}`
        if (!f) {
          mismatches.push({
            clipId: planClipLabel,
            field: 'row',
            expected: 'present',
            actual: 'missing (delete or apply failed)',
          })
          perClip.push({
            clipId: planClipLabel,
            filename: '(missing)',
            ok: false,
            order: { expected: item.file_order + 1, actual: '—' },
            trim: { expected: `${Number(item.trim_start).toFixed(3)} → ${Number(item.trim_end).toFixed(3)}`, actual: '—' },
          })
          continue
        }
        // Now we have the row at this file_order. Use its real id
        // for the clipId label (loop dups get a fresh id from the
        // INSERT) but show the ↻ marker so the operator sees
        // which rows were generated.
        const actualLabel = item.is_loop_duplicate
          ? `↻ clip-${f.id} (from clip-${item.source_clip_id})`
          : `clip-${f.id}`
        const actualStart = Number(f.trim_start) || 0
        const actualEnd = Number(f.trim_end) || 0
        const actualOrder = Number(f.file_order)
        const startOk = Math.abs(actualStart - Number(item.trim_start)) <= EPS
        const endOk = Math.abs(actualEnd - Number(item.trim_end)) <= EPS
        const orderOk = Number.isFinite(actualOrder) && actualOrder === Number(item.file_order)
        if (!startOk) mismatches.push({ clipId: actualLabel, field: 'trim_start', expected: Number(item.trim_start).toFixed(3), actual: actualStart.toFixed(3) })
        if (!endOk) mismatches.push({ clipId: actualLabel, field: 'trim_end', expected: Number(item.trim_end).toFixed(3), actual: actualEnd.toFixed(3) })
        if (!orderOk) mismatches.push({ clipId: actualLabel, field: 'file_order', expected: String(item.file_order), actual: String(actualOrder) })
        const clipOk = startOk && endOk && orderOk
        if (clipOk) matches.push(f.id)
        perClip.push({
          clipId: actualLabel,
          filename: f.filename || `clip-${f.id}`,
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
          <div className="text-[10px] text-muted italic mt-1">
            Music replaces clip audio at the merge step. When voiceover segments are present, the "VO interaction" mode below decides how music and VO coexist.
          </div>
        </div>
      </div>

      {!music && (
        <>
          <UploadDropzone uploading={uploading} onUpload={handleUpload} />
          <UrlImportRow uploading={uploading} onImport={handleUrlImport} />
        </>
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
            beatSource={music?.beat_source || 'all'}
            trimStart={effectiveTrimStart}
            trimEnd={effectiveTrimEnd}
            zoom={zoom}
            pan={pan}
            audioRef={audioRef}
            draftId={draftId}
            cutPoints={Array.isArray(snapPreview?.cuts) ? snapPreview.cuts : null}
            manualCuts={Array.isArray(beatMap?.manual_cuts) ? beatMap.manual_cuts : null}
            onManualCutsChange={(nextCuts) => {
              setMusic(prev => prev
                ? { ...prev, beat_map: { ...prev.beat_map, manual_cuts: nextCuts } }
                : prev)
              setSnapPreview(null)
            }}
            onBeatsChange={(nextBeats) => {
              // Optimistic update on the in-memory beat_map so the
              // canvas + cut count + snap-preview-on-next-run all
              // reflect the edit instantly. The PATCH lands in the
              // background via debounce inside WaveformBeatStrip.
              setMusic(prev => prev
                ? { ...prev, beat_map: { ...prev.beat_map, beats: nextBeats, beats_manually_edited: true } }
                : prev)
              // Edit invalidates any cached snap preview.
              setSnapPreview(null)
            }}
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
          <BeatSourceSelector
            source={music?.beat_source || 'all'}
            beatMap={beatMap}
            onChange={handleBeatSourceChange}
          />
          <PacingSelector pacing={Number(music?.pacing) || 1} onChange={handlePacingChange} />
          <LoopToBeatsToggle
            loopToBeats={!!music?.loop_to_beats}
            pacing={Number(music?.pacing) || 1}
            manualCutCount={Array.isArray(beatMap?.manual_cuts) ? beatMap.manual_cuts.length : 0}
            onChange={handleLoopToBeatsChange}
          />
          {!!music?.loop_to_beats && (
            <FreezeLoopsToggle
              freezeLoops={!!music?.freeze_loops}
              onChange={handleFreezeLoopsChange}
            />
          )}
          {!!music?.loop_to_beats && (
            <LoopEffectToggle
              label="⏪ Reverse the loop duplicates"
              hint="Every duplicate plays backwards. Buffers all decoded frames — short clips only."
              checked={!!music?.reverse_loops}
              onChange={handleReverseLoopsChange}
              tone="pink"
            />
          )}
          {!!music?.loop_to_beats && (
            <LoopEffectToggle
              label="⇄ Mirror the loop duplicates"
              hint="Horizontally flip every duplicate."
              checked={!!music?.mirror_loops}
              onChange={handleMirrorLoopsChange}
              tone="green"
            />
          )}
          {!!music?.loop_to_beats && (
            <LoopColorSelector
              value={music?.loop_color_effect || ''}
              onChange={handleLoopColorChange}
            />
          )}
          <VoMixModeSelector
            mode={music?.vo_mix_mode || 'mix'}
            hasVoiceover={!!music?.has_voiceover}
            onChange={handleVoMixModeChange}
          />
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
          {snapPreview?.loop_mode && snapPreview?.duplicates_needed > 0 && (
            <div className="text-[10px] text-[#8a4b00] bg-[#fff7e6] border border-[#f5a623]/40 rounded px-2 py-1">
              <b>🔁 Loop mode</b> (
              {snapPreview.used_manual_cuts
                ? <>from <b>manual cuts</b></>
                : <>from <b>beat-driven loop</b> ({snapPreview.pacing === 1 ? 'every beat' : snapPreview.pacing === 2 ? 'every 2 beats' : snapPreview.pacing === 4 ? 'every 4 beats' : `every ${snapPreview.pacing} beats`})</>}
              ): {snapPreview.window_count} cut window{snapPreview.window_count === 1 ? '' : 's'} across {snapPreview.clip_count} source clip{snapPreview.clip_count === 1 ? '' : 's'} —
              {' '}<b>{snapPreview.duplicates_needed} duplicate row{snapPreview.duplicates_needed === 1 ? '' : 's'}</b> will be created on Apply (sharing each source's upload; marked is_loop_duplicate so a re-Apply rebuilds cleanly).
            </div>
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

// URL import row. The operator pastes a TikTok / Instagram /
// YouTube link, ticks the rights checkbox, hits Import. BE runs
// yt-dlp to extract audio, then the same analyze+persist flow
// the direct upload uses.
//
// The rights checkbox is REQUIRED — both the button is disabled
// without it AND the BE rejects un-confirmed requests with 400.
// Belt-and-suspenders so a runaway script can't accidentally
// pull copyrighted audio at scale.
function UrlImportRow({ uploading, onImport }) {
  const [url, setUrl] = useState('')
  const [ownsRights, setOwnsRights] = useState(false)
  const trimmedUrl = url.trim()
  const canImport = !uploading && trimmedUrl.length > 0 && ownsRights
  return (
    <div className="border border-[#e5e5e5] rounded-lg p-2 space-y-1.5 bg-white">
      <div className="text-[11px] font-medium text-ink">Or paste a URL</div>
      <div className="text-[10px] text-muted">
        Pulls audio from TikTok, Instagram, or YouTube. Spotify excluded (license required).
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && canImport) onImport(trimmedUrl, ownsRights) }}
          disabled={uploading}
          placeholder="https://www.tiktok.com/@... / youtube.com/watch?v=... / instagram.com/reel/..."
          className="flex-1 text-[11px] border border-[#e5e5e5] rounded px-2 py-1 bg-white disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => onImport(trimmedUrl, ownsRights)}
          disabled={!canImport}
          className="text-[10px] py-1 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium whitespace-nowrap"
        >{uploading ? 'Importing…' : 'Import'}</button>
      </div>
      <label className="flex items-start gap-1.5 text-[10px] cursor-pointer">
        <input
          type="checkbox"
          checked={ownsRights}
          onChange={e => setOwnsRights(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-ink">
          I confirm I own the rights to this audio (or have permission to use it).
          <span className="text-muted block text-[9px] italic">
            Required. The BE rejects un-checked imports. You're responsible for ensuring your videos comply with the source platform's terms.
          </span>
        </span>
      </label>
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
          {/* Source URL pill — present only when the track was pulled
              via POST /music/url (TikTok / YouTube / Instagram). Direct
              uploads have no source URL so the row collapses to just
              the filename + stats above. */}
          {music.source_url && (
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              <span className="text-[9px] text-muted">Source:</span>
              <a
                href={music.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[9px] text-[#6C5CE7] underline truncate max-w-[280px]"
                title={music.source_url}
              >{prettySourceUrl(music.source_url)}</a>
              <button
                type="button"
                onClick={() => { try { navigator.clipboard.writeText(music.source_url) } catch {} }}
                className="text-[9px] py-0 px-1 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
                title="Copy source URL to clipboard"
              >copy</button>
            </div>
          )}
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

// Beat source — which detected beat array drives the snap cut
// positions. Operator can choose to cut only on kick drum, only
// on hi-hats, or a union of both. Falls back to the broadband
// beat list ('all') for sources that aren't populated yet (older
// music tracks uploaded before the band analyzer landed — fixed
// by a single Re-analyze click).
function BeatSourceSelector({ source, beatMap, onChange }) {
  const bassCount = Array.isArray(beatMap?.bass_beats) ? beatMap.bass_beats.length : 0
  const hihatCount = Array.isArray(beatMap?.hihat_beats) ? beatMap.hihat_beats.length : 0
  const totalCount = Array.isArray(beatMap?.beats) ? beatMap.beats.length : 0
  const OPTIONS = [
    { value: 'all',         label: 'All beats',   count: totalCount, sub: 'broadband (default)' },
    { value: 'bass',        label: 'Bass / kick', count: bassCount,  sub: '40–200 Hz only' },
    { value: 'hihat',       label: 'Hi-hat',      count: hihatCount, sub: '>5 kHz only' },
    { value: 'bass+hihat',  label: 'Bass + Hi-hat', count: bassCount + hihatCount, sub: 'union of both' },
  ]
  const current = OPTIONS.some(o => o.value === source) ? source : 'all'
  // If the band arrays don't exist yet (old track + new analyzer),
  // bass/hihat show count=0 and the picker hints at re-analyze.
  const needsReanalyze = bassCount === 0 && hihatCount === 0 && totalCount > 0
  return (
    <div className="flex flex-col gap-1 text-[10px]">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[#6C5CE7]/80">Beat source</span>
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
            title={o.sub}
          >
            <span className="font-medium">{o.label}</span>
            <span className="text-[8px] opacity-75 ml-1">({o.count})</span>
          </button>
        ))}
      </div>
      {needsReanalyze && (
        <span className="text-[9px] text-[#8a4b00] italic">
          ⚠ Bass + hi-hat counts are 0 — this track was uploaded before the band analyzer. Click <b>Re-analyze</b> to populate them.
        </span>
      )}
    </div>
  )
}

// Beat-driven loop toggle. When ON, the snap algorithm uses every
// pacing-strided beat as a cut and the operator's clips cycle
// through to fill all the windows. Combined with the pacing
// selector this gives "fast cuts on every beat" without the
// operator having to drop manual markers.
//
// Precedence: manual cuts (shift+click) always take priority over
// this toggle. Both modes share the same loop-duplicate machinery;
// the difference is just WHERE the cuts come from. When manual
// cuts exist, this toggle is shown but flagged as overridden so
// the operator isn't confused.
// Companion to LoopToBeatsToggle. When enabled, apply-snap marks
// every algorithm-generated loop-duplicate as freeze_frame so
// the rapid-cut montage stutters on stills instead of moving
// video. Only rendered when loop-to-beats is on — freeze has no
// meaning without loop duplicates to apply it to.
function FreezeLoopsToggle({ freezeLoops, onChange }) {
  return (
    <label className="flex items-start gap-1.5 text-[10px] cursor-pointer pl-5">
      <input
        type="checkbox"
        checked={!!freezeLoops}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span className="text-[#0369a1]">
        ❄ <b>Freeze the loop duplicates</b> — every duplicate clip becomes a still frame held on its beat.
        <span className="text-[9px] opacity-75 block">
          Creates a stutter-punch feel — your source clips play normally; only the algorithm-added duplicates freeze. Apply re-creates duplicates each time, so you can toggle freely.
        </span>
      </span>
    </label>
  )
}

// Generic bulk-effect toggle for the music panel. Same shape as
// FreezeLoopsToggle but parameterized so we don't repeat the
// markup for reverse / mirror. Tone controls the accent color.
function LoopEffectToggle({ label, hint, checked, onChange, tone }) {
  const colorClass = tone === 'pink'  ? 'text-[#be185d]'
                  :  tone === 'green' ? 'text-[#15803d]'
                  : 'text-[#6C5CE7]'
  return (
    <label className="flex items-start gap-1.5 text-[10px] cursor-pointer pl-5">
      <input
        type="checkbox"
        checked={!!checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span className={colorClass}>
        <b>{label}</b>
        <span className="text-[9px] opacity-75 block">{hint}</span>
      </span>
    </label>
  )
}

// Color preset dropdown — non-boolean so it gets its own
// component rather than fitting LoopEffectToggle. '' = off.
function LoopColorSelector({ value, onChange }) {
  return (
    <label className="flex items-start gap-1.5 text-[10px] cursor-pointer pl-5">
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value || null)}
        className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white mt-0.5"
      >
        <option value="">off</option>
        <option value="bw">b&w</option>
        <option value="inverted">inverted</option>
        <option value="saturated">saturated</option>
      </select>
      <span className="text-[#92400e]">
        <b>🎨 Color preset on loop duplicates</b>
        <span className="text-[9px] opacity-75 block">Applied to every duplicate. Off = no color filter.</span>
      </span>
    </label>
  )
}

function LoopToBeatsToggle({ loopToBeats, pacing, manualCutCount, onChange }) {
  const label = pacing === 1 ? 'every beat'
              : pacing === 2 ? 'every 2 beats'
              : pacing === 4 ? 'every 4 beats'
              : `every ${pacing} beats`
  const overridden = manualCutCount > 0
  return (
    <label className={`flex items-start gap-1.5 text-[10px] cursor-pointer ${overridden ? 'opacity-60' : ''}`}>
      <input
        type="checkbox"
        checked={!!loopToBeats}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span className="text-[#6C5CE7]">
        🔁 <b>Loop clips on every beat</b> — auto-snap cuts at <b>{label}</b>, clips cycle to fill all windows.
        {overridden && (
          <span className="text-[9px] text-[#8a4b00] block">
            ⚠ Currently overridden by {manualCutCount} manual cut{manualCutCount === 1 ? '' : 's'}. Clear manual cuts to re-enable this mode.
          </span>
        )}
        {!overridden && (
          <span className="text-[9px] opacity-75 block">
            With this off, the algorithm produces one cut per clip (default snap). With it on, more cuts than clips → clips duplicate on Apply. Manual cuts via shift+click always override this.
          </span>
        )}
      </span>
    </label>
  )
}

// Music ↔ voiceover mix mode. Persisted on
// voiceover_settings.mix_mode (the existing audio-engine field
// the merge step consults) but surfaced here because the operator
// thinks of it as "what does the music do when VO plays."
//   mix     → music constant at ~30%, VO on top (default)
//   duck    → music auto-ducks during VO (sidechain compression)
//   replace → VO replaces audio entirely
function VoMixModeSelector({ mode, hasVoiceover, onChange }) {
  const OPTIONS = [
    { value: 'mix',     label: 'Mix',  subtitle: 'music at 30% under VO' },
    { value: 'duck',    label: 'Duck', subtitle: 'music dips when VO speaks' },
    { value: 'replace', label: 'Mute', subtitle: 'VO replaces audio' },
  ]
  const current = OPTIONS.some(o => o.value === mode) ? mode : 'mix'
  return (
    <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
      <span className="text-[#6C5CE7]/80">VO interaction</span>
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
          title={o.subtitle}
        >
          <span className="font-medium">{o.label}</span>
          <span className="text-[8px] opacity-75 ml-1">({o.subtitle})</span>
        </button>
      ))}
      {!hasVoiceover && (
        <span className="text-[9px] text-muted italic" title="No voiceover recorded yet — mix mode only matters once VO segments exist.">
          (no VO yet)
        </span>
      )}
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
function WaveformBeatStrip({ beatMap, beatSource, trimStart, trimEnd, zoom, pan, audioRef, draftId, onBeatsChange, cutPoints, manualCuts, onManualCutsChange }) {
  const canvasRef = useRef(null)
  const duration = Math.max(0, trimEnd - trimStart)
  const visibleFraction = 1 / Math.max(1, zoom)
  const visibleSpan = duration * visibleFraction
  const viewStart = trimStart + (duration - visibleSpan) * Math.max(0, Math.min(1, pan))
  const viewEnd = viewStart + visibleSpan

  // Pick the beat array to render based on the current source so
  // the operator SEES exactly which beats the snap will cut on.
  // Falls back to broadband beats when a band array is missing.
  const resolvedBeats = (() => {
    if (beatSource === 'bass' && Array.isArray(beatMap?.bass_beats)) return beatMap.bass_beats
    if (beatSource === 'hihat' && Array.isArray(beatMap?.hihat_beats)) return beatMap.hihat_beats
    if (beatSource === 'bass+hihat') {
      const a = Array.isArray(beatMap?.bass_beats) ? beatMap.bass_beats : []
      const b = Array.isArray(beatMap?.hihat_beats) ? beatMap.hihat_beats : []
      return [...a, ...b].sort((x, y) => x - y)
    }
    return Array.isArray(beatMap?.beats) ? beatMap.beats : []
  })()
  const allBeats = resolvedBeats
  const beats = allBeats.filter(b => b >= viewStart && b <= viewEnd)
  const onsets = (Array.isArray(beatMap?.onsets) ? beatMap.onsets : [])
    .filter(b => b >= viewStart && b <= viewEnd)

  // Debounced save — operator may click rapid-fire to add/remove
  // multiple beats OR cuts. Each click updates the parent
  // immediately (optimistic) but the PATCH only fires 600ms after
  // the last click so we don't spam the API. Beats + manual cuts
  // each maintain their own pending state so a beat edit doesn't
  // accidentally clear a not-yet-saved cut edit.
  const beatTimerRef = useRef(null)
  const pendingBeatsRef = useRef(null)
  const cutTimerRef = useRef(null)
  const pendingCutsRef = useRef(null)
  const flushBeatsSave = async () => {
    const beats = pendingBeatsRef.current
    pendingBeatsRef.current = null
    if (!Array.isArray(beats) || !draftId) return
    try { await api.setJobMusicBeats(draftId, beats) }
    catch (e) { console.warn('[music] save beats failed:', e?.message) }
  }
  const flushCutsSave = async () => {
    const cuts = pendingCutsRef.current
    pendingCutsRef.current = null
    if (!Array.isArray(cuts) || !draftId) return
    try { await api.setJobMusicManualCuts(draftId, cuts) }
    catch (e) { console.warn('[music] save manual cuts failed:', e?.message) }
  }
  const scheduleBeatsSave = (nextBeats) => {
    pendingBeatsRef.current = nextBeats
    if (beatTimerRef.current) clearTimeout(beatTimerRef.current)
    beatTimerRef.current = setTimeout(() => {
      flushBeatsSave()
      beatTimerRef.current = null
    }, 600)
  }
  const scheduleCutsSave = (nextCuts) => {
    pendingCutsRef.current = nextCuts
    if (cutTimerRef.current) clearTimeout(cutTimerRef.current)
    cutTimerRef.current = setTimeout(() => {
      flushCutsSave()
      cutTimerRef.current = null
    }, 600)
  }
  // Flush pending saves on unmount so an in-flight edit isn't lost
  // when the operator switches tabs.
  useEffect(() => () => {
    if (beatTimerRef.current) { clearTimeout(beatTimerRef.current); flushBeatsSave() }
    if (cutTimerRef.current) { clearTimeout(cutTimerRef.current); flushCutsSave() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Click handler — translate canvas x to a track-absolute
  // timestamp, then dispatch:
  //   plain click  → toggle a BEAT marker (purple, full-height)
  //   shift+click  → toggle a MANUAL CUT marker (amber, full-height)
  // Tolerance scales with viewport so a zoomed-out click can hit
  // any nearby marker, but a zoomed-in click is more precise.
  const allManualCuts = Array.isArray(manualCuts) ? manualCuts : []
  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const w = rect.width
    if (!(visibleSpan > 0) || w <= 0) return
    const clickT = viewStart + (x / w) * visibleSpan
    const remTol = Math.max(0.05, visibleSpan / w * 6)
    const t = Math.max(0, Number(clickT.toFixed(3)))

    // Shift + click → manual cut edit. Only when the parent
    // supplied an onManualCutsChange handler (it does on the
    // music panel).
    if (e.shiftKey && onManualCutsChange) {
      let nearestIdx = -1
      let nearestDist = Infinity
      for (let i = 0; i < allManualCuts.length; i++) {
        const d = Math.abs(allManualCuts[i] - clickT)
        if (d < nearestDist) { nearestDist = d; nearestIdx = i }
      }
      let nextCuts
      if (nearestIdx >= 0 && nearestDist <= remTol) {
        nextCuts = allManualCuts.slice(0, nearestIdx).concat(allManualCuts.slice(nearestIdx + 1))
      } else {
        const insertAt = allManualCuts.findIndex(c => c > t)
        nextCuts = insertAt < 0
          ? allManualCuts.concat(t)
          : allManualCuts.slice(0, insertAt).concat(t, allManualCuts.slice(insertAt))
      }
      onManualCutsChange(nextCuts)
      scheduleCutsSave(nextCuts)
      return
    }

    // Plain click → beat edit, but only when the operator is
    // viewing the broadband 'all' beats. The bass / hi-hat arrays
    // are derived from band-filtered audio — letting clicks
    // mutate them would create a mismatch between what the
    // operator sees and what the BE re-analyzes from. They can
    // still drop shift+click manual cuts in any band view.
    if (!onBeatsChange) return
    if (beatSource && beatSource !== 'all') return
    let nearestIdx = -1
    let nearestDist = Infinity
    for (let i = 0; i < allBeats.length; i++) {
      const d = Math.abs(allBeats[i] - clickT)
      if (d < nearestDist) { nearestDist = d; nearestIdx = i }
    }
    let nextBeats
    if (nearestIdx >= 0 && nearestDist <= remTol) {
      nextBeats = allBeats.slice(0, nearestIdx).concat(allBeats.slice(nearestIdx + 1))
    } else {
      const insertAt = allBeats.findIndex(b => b > t)
      nextBeats = insertAt < 0
        ? allBeats.concat(t)
        : allBeats.slice(0, insertAt).concat(t, allBeats.slice(insertAt))
    }
    onBeatsChange(nextBeats)
    scheduleBeatsSave(nextBeats)
  }

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

      // Algorithm cut points — green half-height lines showing
      // where the snap algorithm will place video cuts. Skipped
      // when manual cuts are set (the manual amber markers serve
      // the same role and would visually overlap).
      const hasManual = Array.isArray(manualCuts) && manualCuts.length > 0
      if (Array.isArray(cutPoints) && cutPoints.length > 0 && !hasManual) {
        ctx.strokeStyle = '#2D9A5E'
        ctx.lineWidth = 2
        ctx.setLineDash([])
        for (let i = 0; i < cutPoints.length; i++) {
          const cutAbs = trimStart + Number(cutPoints[i])
          if (cutAbs <= trimStart + 0.01) continue
          if (cutAbs >= trimEnd - 0.01) continue
          if (cutAbs < viewStart || cutAbs > viewEnd) continue
          const px = x(cutAbs)
          ctx.beginPath()
          ctx.moveTo(px, h * 0.5)
          ctx.lineTo(px, h * 0.95)
          ctx.stroke()
        }
      }

      // Manual cut markers — amber full-height lines + a tiny
      // amber circle at the top so they're unmistakably operator-
      // placed (and visually distinct from purple beats and green
      // algorithm cuts). When manual cuts exist they OVERRIDE the
      // algorithm's auto-snap, so the algorithm cuts are hidden
      // above and these are the only cut markers on screen.
      if (hasManual) {
        for (const tAbs of manualCuts) {
          const t = Number(tAbs)
          if (!Number.isFinite(t)) continue
          if (t < viewStart || t > viewEnd) continue
          const px = x(t)
          // Full-height amber line, slightly thicker
          ctx.strokeStyle = '#f5a623'
          ctx.lineWidth = 2.25
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.moveTo(px, 0)
          ctx.lineTo(px, h)
          ctx.stroke()
          // Cap dot at top for unmistakable "this is operator-set"
          ctx.fillStyle = '#f5a623'
          ctx.beginPath()
          ctx.arc(px, 4, 3, 0, Math.PI * 2)
          ctx.fill()
        }
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
  }, [duration, viewStart, viewEnd, beats.length, onsets.length, audioRef, cutPoints?.length, manualCuts?.length])

  const edited = !!beatMap?.beats_manually_edited
  const manualCount = Array.isArray(manualCuts) ? manualCuts.length : 0
  const clearAllManual = () => {
    if (!onManualCutsChange) return
    onManualCutsChange([])
    scheduleCutsSave([])
  }
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-muted flex items-center justify-between gap-2 flex-wrap">
        <span>
          <span className="text-[#6C5CE7] font-medium">{beatSource === 'bass' ? 'Bass / kick beats' : beatSource === 'hihat' ? 'Hi-hat beats' : beatSource === 'bass+hihat' ? 'Bass + hi-hat beats' : 'Beats'}</span> · <span className="text-[#6C5CE7]/60">onsets</span>{Array.isArray(cutPoints) && cutPoints.length > 0 && manualCount === 0 && <> · <span className="text-[#2D9A5E] font-medium">algorithm cuts</span></>}{manualCount > 0 && <> · <span className="text-[#f5a623] font-medium">manual cuts</span></>} · <span className="text-[#2D9A5E] font-medium">playhead</span>.
          {' '}<b>Click</b> = toggle beat. <b>Shift+click</b> = toggle manual cut (overrides auto-snap).
        </span>
        <span className="font-mono">
          view {viewStart.toFixed(2)}s → {viewEnd.toFixed(2)}s ({beats.length} beats{manualCount > 0 && `, ${manualCount} cut${manualCount === 1 ? '' : 's'}`})
          {edited && <span className="text-[#f5a623] font-medium ml-1.5">· edited</span>}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        style={{ width: '100%', height: 56, cursor: onBeatsChange ? 'crosshair' : 'default' }}
        className="border border-[#e5e5e5] rounded"
        title="Click to toggle a beat. Shift+click to drop a manual cut marker."
      />
      {manualCount > 0 && (
        <div className="text-[9px] text-[#8a4b00] bg-[#fff7e6] border border-[#f5a623]/40 rounded px-2 py-0.5 flex items-center gap-2">
          <span>{manualCount} manual cut{manualCount === 1 ? '' : 's'} active — algorithm auto-snap is overridden.</span>
          <button
            type="button"
            onClick={clearAllManual}
            className="ml-auto text-[9px] py-0.5 px-1.5 border border-[#f5a623] text-[#8a4b00] bg-white rounded cursor-pointer"
            title="Remove all manual cuts and fall back to the algorithm's auto-snap."
          >Clear all</button>
        </div>
      )}
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
// Render a music source URL as a short readable label like
// "youtube.com · /watch?v=…" so the panel pill fits in one line.
// Full URL stays in the anchor's href + title.
function prettySourceUrl(raw) {
  try {
    const u = new URL(raw)
    const host = u.host.replace(/^www\./, '')
    const path = u.pathname + (u.search || '')
    const trimmed = path.length > 36 ? path.slice(0, 33) + '…' : path
    return `${host}${trimmed}`
  } catch {
    return raw.slice(0, 60)
  }
}

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
                <tr key={p.window_index ?? p.dbFileId ?? `w${p.file_order}`} className={changed ? 'bg-[#f3f0ff]' : ''}>
                  <td className="font-mono">{p.file_order + 1}</td>
                  <td className="font-mono text-muted">
                    {p.dbFileId
                      ? `clip-${p.dbFileId}`
                      : <span title={`Will be duplicated from clip-${p.source_clip_id} on Apply`}>↻ clip-{p.source_clip_id}</span>}
                  </td>
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
