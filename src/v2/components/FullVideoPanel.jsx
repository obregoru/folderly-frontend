// End-to-end platform-specific analyzer panel. Three independent
// analyses (TikTok, Reels, YouTube Shorts) — each runs a separate
// vision pass with platform-tuned scoring and saves to its own row.
// Tabs let the user switch between results without re-running.
//
// First-2s analysis is auto-loaded by the BE as additional context
// for the hook_strength / curiosity_gap dimensions when present.

import { useEffect, useState } from 'react'
import * as api from '../../api'
import PacingIntentSelector from './PacingIntentSelector'

const PLATFORMS = [
  // 'footage' is the pre-polish footage review — same analyzer
  // endpoint, but the BE swaps to a footage-only prompt + schema so
  // the operator can review raw clip flow before adding voiceover,
  // overlays, captions, or music. Listed first so it's the natural
  // starting point of the review workflow.
  { key: 'footage', label: 'Footage flow', emoji: '🎬', isFootage: true },
  { key: 'tiktok',  label: 'TikTok',       emoji: '🎵' },
  { key: 'reels',   label: 'Reels',        emoji: '📸' },
  { key: 'shorts',  label: 'Shorts',       emoji: '▶️' },
]

// Dimension lists are per-mode. The footage flow review scores
// different aspects (dead-space density, shot variety, framing)
// because polish dimensions like overlay_placement / caption_legibility
// don't apply to a pre-polish review.
const DIMENSIONS_PLATFORM = [
  { key: 'hook_strength',          label: 'Hook strength' },
  { key: 'curiosity_gap',          label: 'Curiosity gap' },
  { key: 'mid_pacing',             label: 'Mid pacing' },
  { key: 'closing_impact',         label: 'Closing impact' },
  { key: 'ending_completion',      label: 'Ending completion' },
  { key: 'vo_visual_sync',         label: 'VO/visual sync' },
  { key: 'caption_legibility',     label: 'Caption legibility' },
  { key: 'overlay_placement',      label: 'Overlay placement' },
  { key: 'overlay_color_contrast', label: 'Overlay contrast' },
  { key: 'audio_visual_synergy',   label: 'A/V synergy' },
  { key: 'rewatch_value',          label: 'Rewatch value' },
  { key: 'brand_clarity',          label: 'Brand clarity' },
]

const DIMENSIONS_FOOTAGE = [
  { key: 'hook_potential',         label: 'Hook potential' },
  { key: 'mid_pacing',             label: 'Mid pacing' },
  { key: 'closing_strength',       label: 'Closing strength' },
  { key: 'shot_variety',           label: 'Shot variety' },
  { key: 'dead_space_density',     label: 'Dead-space density' },
  { key: 'framing_quality',        label: 'Framing quality' },
  { key: 'motion_quality',         label: 'Motion quality' },
  { key: 'raw_material_strength',  label: 'Raw material strength' },
]

// Per-platform state slot. results[platform] holds the analysis
// (null when never run / hydrated empty), thumbs, meta, and a
// per-platform analyzing flag so each can be in flight independently.
const emptySlot = () => ({
  analysis: null,
  meta: null,
  thumbs: [],
  analyzing: false,
  stage: '',
  err: null,
  hydratedFromDisk: false,
  // Set to true when the user re-renders the final after this slot
  // was last analyzed — surfaces a "re-analyze" banner so the user
  // doesn't keep looking at frames captured against an older mp4.
  finalIsNewer: false,
})

export default function FullVideoPanel({ draftId, jobSync, previewRef }) {
  const [active, setActive] = useState('footage')
  const [slots, setSlots] = useState({
    footage: emptySlot(),
    tiktok: emptySlot(),
    reels: emptySlot(),
    shorts: emptySlot(),
  })
  // Click-to-zoom lightbox for individual frame review. The user
  // wants to inspect what the AI saw at each timestamp side-by-side
  // with the dimension scores + suggestions — small thumbnails
  // weren't enough to read overlay legibility / contrast issues.
  const [zoomedFrame, setZoomedFrame] = useState(null)
  // Source-mp4 preview lightbox. Lets the user see the actual file
  // the analyzer would download next, plus its identifying key/uuid
  // so mismatches (analyzer using merge instead of final, or stale
  // final, etc.) are flag-able by storage path. Cleared by the modal
  // close button or backdrop click.
  const [sourcePreview, setSourcePreview] = useState(null)
  const [loadingSource, setLoadingSource] = useState(false)
  const openSourcePreview = async () => {
    if (!draftId || loadingSource) return
    setLoadingSource(true)
    try {
      const r = await api.fullVideoAnalysisSource(draftId)
      setSourcePreview(r)
    } catch (e) {
      setSourcePreview({ error: e?.message || String(e) })
    } finally {
      setLoadingSource(false)
    }
  }

  // Seek the FinalPreview <video> to a given timestamp. Used by
  // timeline note clicks AND frame-thumbnail clicks so the user can
  // jump to whatever moment the analyzer is talking about and see
  // it in motion / context. Pauses on seek so the user can scrub
  // around without the video running away from them.
  const seekPreview = (sec) => {
    const v = previewRef?.current?.getVideo?.()
    if (!v) return
    const t = Math.max(0, Number(sec) || 0)
    try {
      if (!v.paused) v.pause()
      // currentTime sometimes throws on iOS Safari before metadata
      // loads — wrap so a transient failure doesn't blow up the click.
      v.currentTime = t
      // Scroll the preview into view so the user actually sees the
      // result — clicking a timeline note while scrolled to the
      // bottom of the panel did nothing visible without this.
      try { v.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) } catch {}
    } catch (e) {
      console.warn('[FullVideoPanel] seek failed:', e?.message)
    }
  }

  // Hydrate every platform's saved analysis on mount in parallel —
  // tabs feel populated instantly even though three calls fired.
  useEffect(() => {
    if (!draftId) return
    let cancelled = false
    PLATFORMS.forEach(p => {
      api.fullVideoAnalysisLast(draftId, p.key).then(r => {
        if (cancelled) return
        if (r?.analysis) {
          setSlots(prev => ({
            ...prev,
            [p.key]: {
              ...prev[p.key],
              analysis: r.analysis,
              meta: {
                duration_sec: r.duration_sec,
                frames_used: r.frames_used,
                source_kind: r.source_kind,
                analyzedAt: r.analyzedAt,
                finalRenderedAt: r.final_rendered_at || null,
              },
              thumbs: Array.isArray(r.frame_thumbs) ? r.frame_thumbs : [],
              hydratedFromDisk: true,
              finalIsNewer: !!r.final_is_newer_than_analysis,
            },
          }))
        }
      }).catch(() => { /* no prior analysis is fine */ })
    })
    return () => { cancelled = true }
  }, [draftId])

  // Listen for fresh final-render events. When the user kicks off a
  // Download Final / Regenerate elsewhere in the editor and it
  // succeeds, mark every platform's stored analysis as out-of-date
  // so the user gets a clear nudge to re-analyze instead of silently
  // looking at frames captured against the previous mp4.
  useEffect(() => {
    const onRendered = () => {
      setSlots(prev => {
        const next = { ...prev }
        for (const k of Object.keys(next)) {
          if (next[k]?.analysis) next[k] = { ...next[k], finalIsNewer: true }
        }
        return next
      })
    }
    window.addEventListener('posty-render-final-result', onRendered)
    return () => window.removeEventListener('posty-render-final-result', onRendered)
  }, [])

  const setSlot = (platform, patch) => {
    setSlots(prev => ({ ...prev, [platform]: { ...prev[platform], ...patch } }))
  }

  // The analyzer reads whatever video is currently in storage — final
  // mp4 if one's been rendered (overlays + captions in the pixels),
  // merged source otherwise (text-only context for those layers).
  // We deliberately do NOT trigger renderFinal here. Auto-baking
  // surfaced rotation bugs in the merge pipeline that re-baking the
  // final could trigger; making the bake an explicit user action via
  // the Download Final button removes that surface entirely.
  const run = async (platform) => {
    if (!draftId) return
    const cur = slots[platform]
    if (cur.analyzing) return
    setSlot(platform, { analyzing: true, err: null, stage: 'analyzing', hydratedFromDisk: false })
    try {
      const r = await api.analyzeFullVideo(draftId, platform)
      if (!r?.analysis) throw new Error('No analysis returned')
      setSlot(platform, {
        analysis: r.analysis,
        meta: {
          duration_sec: r.duration_sec,
          frames_used: r.frames_used,
          source_kind: r.source_kind,
          analyzedAt: new Date().toISOString(),
        },
        thumbs: Array.isArray(r.frame_thumbs) ? r.frame_thumbs : [],
        analyzing: false,
        stage: '',
        err: null,
        finalIsNewer: false,
      })
    } catch (e) {
      setSlot(platform, { err: e?.message || String(e), analyzing: false, stage: '' })
    }
  }

  // One-click "render the final, then re-analyze" — bypasses the user
  // having to switch panels, hit Download Final, wait, come back, and
  // hit Re-analyze. The render step is what bakes overlays + voiceover
  // captions into the mp4 pixels, so without it the analyzer sees
  // bare merged clips and grades caption / overlay dimensions blind.
  const [refreshing, setRefreshing] = useState(false)
  const renderAndReanalyze = async (platform) => {
    if (!draftId || refreshing) return
    setRefreshing(true)
    setSlot(platform, { analyzing: true, err: null, stage: 'rendering final…', hydratedFromDisk: false })
    try {
      const renderResult = await api.renderFinal({ jobUuid: draftId })
      // Notify the rest of the editor (Channels, AudioMixLog, etc.)
      // that a fresh final landed — same shape FinalPreviewV2 dispatches
      // so listeners stay in sync.
      try {
        window.dispatchEvent(new CustomEvent('posty-render-final-result', { detail: renderResult }))
      } catch {}
      setSlot(platform, { stage: 'analyzing…' })
      const r = await api.analyzeFullVideo(draftId, platform)
      if (!r?.analysis) throw new Error('No analysis returned')
      setSlot(platform, {
        analysis: r.analysis,
        meta: {
          duration_sec: r.duration_sec,
          frames_used: r.frames_used,
          source_kind: r.source_kind,
          analyzedAt: new Date().toISOString(),
        },
        thumbs: Array.isArray(r.frame_thumbs) ? r.frame_thumbs : [],
        analyzing: false,
        stage: '',
        err: null,
        finalIsNewer: false,
      })
    } catch (e) {
      setSlot(platform, { err: e?.message || String(e), analyzing: false, stage: '' })
    } finally {
      setRefreshing(false)
    }
  }

  const slot = slots[active]
  const platformDef = PLATFORMS.find(p => p.key === active)

  // Kick off all three POLISH-STAGE platforms in parallel against
  // whatever final / merge is currently in storage. No bake step —
  // user controls when the final is regenerated via Download Final.
  // Footage flow is excluded because it's a different review mode
  // (different prompt, different schema, runs before polish — bundling
  // it with the platform-tuned reviews would mix workflow stages).
  const POLISH_PLATFORMS = PLATFORMS.filter(p => !p.isFootage)
  const runAll = () => {
    if (!draftId) return
    POLISH_PLATFORMS.forEach(p => {
      if (slots[p.key].analyzing) return
      run(p.key)
    })
  }
  const anyAnalyzing = POLISH_PLATFORMS.some(p => slots[p.key].analyzing)
  const allHave = POLISH_PLATFORMS.every(p => slots[p.key].analysis)

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="text-[12px] font-medium">🎞️ Full video review</div>
          <div className="text-[10px] text-muted">
            {platformDef?.isFootage
              ? 'Pre-polish footage review. Reviews FLOW, pacing, dead-space, shot variety, framing — and explicitly ignores the absence of voiceover, overlays, captions, or music. Use this BEFORE adding polish to decide if the raw footage is worth working with.'
              : 'Per-platform end-to-end vision analysis. Each platform has its own scoring criteria — TikTok rewards motion + curiosity, Reels rewards aesthetic + brand cohesion, Shorts rewards CTA + clarity. Reads the first-2s analysis (if you’ve run it) to ground the hook scoring.'}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 self-start">
          <button
            type="button"
            onClick={runAll}
            disabled={!draftId || anyAnalyzing}
            className="text-[11px] py-1.5 px-3 bg-gradient-to-r from-[#6C5CE7] to-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium whitespace-nowrap"
            title="Run all three platform analyses in parallel against whatever final / merge is currently in storage. Render the final via Download Final BEFORE running this if you want overlays + captions in the analyzed pixels."
          >
            {anyAnalyzing
              ? `Analyzing… ${POLISH_PLATFORMS.filter(p => slots[p.key].analysis).length}/3`
              : (allHave ? '⚡ Re-analyze all 3 platforms' : '⚡ Analyze all 3 platforms')}
          </button>
          <button
            type="button"
            onClick={openSourcePreview}
            disabled={!draftId || loadingSource}
            className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer disabled:opacity-50 font-medium whitespace-nowrap"
            title="Preview the exact mp4 the analyzer would use right now, plus its storage key for mismatch reports."
          >
            {loadingSource ? 'Loading…' : '🎥 Preview source mp4'}
          </button>
        </div>
      </div>

      <PacingIntentSelector draftId={draftId} />

      {/* Source-of-truth nudge — analyzer reads what's in storage,
          doesn't render anything itself. User controls the bake via
          Download Final at the top of the editor. Without this, users
          re-ran analyses expecting them to reflect the latest overlay
          edits, but the analyzer was reading a stale final and
          scoring against it. */}
      <div className="text-[10px] text-muted bg-[#fafafa] border border-[#e5e5e5] rounded p-2">
        <span className="font-medium text-ink">⚠ Reads the most recently rendered final.</span> Hit <span className="font-medium">Download Final</span> in the preview before analyzing if you've changed overlays, voiceover, or media. The analyzer never re-renders — keeps it from re-running the merge pipeline against your clips.
      </div>

      {/* Platform tabs. Each tab shows a small spinner glyph while
          that platform is mid-analysis so the user can see which is
          still in flight when "Analyze all 3 platforms" is running.
          Four tabs total: Footage flow (pre-polish), then TikTok /
          Reels / Shorts (post-polish). */}
      <div className="grid grid-cols-4 gap-1">
        {PLATFORMS.map(p => {
          const has = !!slots[p.key].analysis
          const isActive = active === p.key
          const score = slots[p.key].analysis?.overall_score
          const isAnalyzing = slots[p.key].analyzing
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setActive(p.key)}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 border rounded text-[11px] font-medium ${
                isActive ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]' : 'bg-white text-ink border-[#e5e5e5]'
              }`}
            >
              <span>{p.emoji}</span>
              <span>{p.label}</span>
              {isAnalyzing && (
                <span className={`text-[10px] ${isActive ? 'text-white/90' : 'text-[#6C5CE7]'}`}>⏳</span>
              )}
              {!isAnalyzing && has && Number.isFinite(Number(score)) && (
                <span className={`text-[10px] font-mono px-1 py-0 rounded ${
                  isActive ? 'bg-white/20' : 'bg-[#f3f0ff] text-[#6C5CE7]'
                }`}>{score}/10</span>
              )}
              {!isAnalyzing && !has && <span className="text-[9px] opacity-60">—</span>}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => run(active)}
          disabled={slot.analyzing || !draftId}
          className="text-[11px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
        >
          {slot.analyzing
            ? `Analyzing for ${platformDef.label}…`
            : (slot.analysis ? `Re-analyze for ${platformDef.label}` : `Analyze for ${platformDef.label}`)}
        </button>
        {slot.meta?.analyzedAt && slot.hydratedFromDisk && (
          <span className="text-[9px] text-muted italic">last run {new Date(slot.meta.analyzedAt).toLocaleString()}</span>
        )}
      </div>

      {slot.err && (
        <div className="text-[11px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2">
          {slot.err}
        </div>
      )}

      {slot.finalIsNewer && (
        <div className="text-[12px] rounded p-2.5 flex items-start gap-2 bg-[#fdf2f1] border-2 border-[#c0392b] text-[#8a1f15]">
          <div className="flex-1">
            <div className="font-bold mb-0.5">⛔ Your final mp4 is newer than this analysis</div>
            <div className="text-[11px] leading-snug">
              You've rendered the final since these frames were captured. The frames + scores below reflect the OLDER mp4. Click below to re-run the analysis against your current final.
            </div>
          </div>
          <button
            type="button"
            onClick={() => run(active)}
            disabled={slot.analyzing}
            className="text-[10px] font-bold py-1.5 px-2.5 bg-[#c0392b] text-white rounded border-none cursor-pointer disabled:opacity-50 whitespace-nowrap self-start"
            title="Reads the current final mp4 and replaces these frames + scores."
          >🔄 Re-analyze now</button>
        </div>
      )}

      {slot.meta && slot.meta.source_kind !== 'final' && !platformDef?.isFootage && (
        <div className={`text-[12px] rounded p-2.5 flex items-start gap-2 ${
          slot.meta.source_kind === 'merge'
            ? 'bg-[#fdf2f1] border-2 border-[#c0392b] text-[#8a1f15]'
            : 'bg-[#fff7e6] border border-[#f5a623] text-[#8a4b00]'
        }`}>
          <div className="flex-1">
            <div className="font-bold mb-0.5">
              {slot.meta.source_kind === 'merge' && '⛔ Captions / overlays NOT in these frames'}
              {slot.meta.source_kind === 'final-stale' && '⚠ Frames may be out of date'}
              {slot.meta.source_kind === 'raw' && '⛔ Single-clip preview, no overlays / voiceover'}
            </div>
            <div className="text-[11px] leading-snug">
              {slot.meta.source_kind === 'merge' && (
                <>
                  These frames came from the unrendered merge — voiceover captions and opening/middle/closing overlays haven't been baked in. The AI scores caption / overlay dimensions from <em>metadata only</em>. Click below to render the final mp4 with everything baked in and re-analyze.
                </>
              )}
              {slot.meta.source_kind === 'final-stale' && (
                <>
                  Frames came from your last rendered final, but you've edited the draft since. Captions / overlays you see may not match your current settings. Click below to re-render with current settings + re-analyze.
                </>
              )}
              {slot.meta.source_kind === 'raw' && (
                <>
                  No merge yet — these frames are from a single raw clip. Configure your timeline, render the final, then re-analyze.
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => renderAndReanalyze(active)}
            disabled={refreshing || slot.analyzing}
            className="text-[10px] font-bold py-1.5 px-2.5 bg-[#6C5CE7] text-white rounded border-none cursor-pointer disabled:opacity-50 whitespace-nowrap self-start"
            title="Renders the final mp4 (overlays + captions baked in), then re-runs the analysis against the freshly rendered video."
          >
            {refreshing ? 'Rendering…' : '🎬 Render + Re-analyze'}
          </button>
        </div>
      )}

      {slot.analysis && (
        <>
          {/* When the final mp4 has been re-rendered since this
              analysis was captured, dim + label every piece of data
              below so the operator can't mistake the OLD scores /
              duration / frames for the current video. The actionable
              red "Re-analyze now" banner sits above (line ~383). */}
          <div className={`border border-[#e5e5e5] rounded p-2 bg-[#fafafa] space-y-2 ${slot.finalIsNewer ? 'opacity-60 grayscale relative' : ''}`}>
            {slot.finalIsNewer && (
              <div className="absolute top-1 right-1 text-[9px] font-bold text-[#c0392b] bg-white border border-[#c0392b] rounded px-1.5 py-0.5 uppercase tracking-wide">
                Outdated
              </div>
            )}
            <div className="flex items-baseline gap-3 flex-wrap">
              <div className="text-[24px] font-bold text-[#6C5CE7] leading-none">{slot.analysis.overall_score}/10</div>
              <div className="text-[11px] text-muted flex-1">
                {slot.meta?.duration_sec != null && (
                  <>
                    {slot.finalIsNewer
                      ? <><span className="line-through">{slot.meta.duration_sec.toFixed(1)}s</span> <span className="text-[#c0392b] font-medium">(stale — current final differs)</span></>
                      : <>{slot.meta.duration_sec.toFixed(1)}s · {slot.meta.frames_used} frames · {slot.meta.source_kind}</>
                    }
                  </>
                )}
              </div>
            </div>
            {slot.analysis.verdict && (
              <div className="text-[12px] font-medium text-ink">{slot.analysis.verdict}</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1">
            {(platformDef?.isFootage ? DIMENSIONS_FOOTAGE : DIMENSIONS_PLATFORM).map(d => {
              const v = Number(slot.analysis[d.key])
              if (!Number.isFinite(v)) return null
              const color = v >= 7 ? '#2D9A5E' : v >= 5 ? '#d97706' : '#c0392b'
              return (
                <div key={d.key} className="flex items-center justify-between bg-white border border-[#e5e5e5] rounded px-2 py-1">
                  <span className="text-[10px] text-muted truncate">{d.label}</span>
                  <span className="text-[11px] font-bold" style={{ color }}>{v}/10</span>
                </div>
              )
            })}
          </div>

          {Array.isArray(slot.analysis.suggestions) && slot.analysis.suggestions.length > 0 && (
            <div className="border border-[#6C5CE7]/30 rounded p-2 bg-[#f3f0ff] space-y-1">
              <div className="text-[10px] font-medium text-[#6C5CE7] uppercase tracking-wide">{platformDef.emoji} {platformDef.label} suggestions</div>
              {slot.analysis.suggestions.map((s, i) => (
                <div key={i} className="text-[11px] flex items-start gap-1.5">
                  <span className="text-[#6C5CE7] shrink-0 font-bold">{i + 1}.</span>
                  <span className="text-ink break-words">{s}</span>
                </div>
              ))}
            </div>
          )}

          {Array.isArray(slot.analysis.timeline_notes) && slot.analysis.timeline_notes.length > 0 && (
            <div className="border border-[#e5e5e5] rounded p-2 space-y-1">
              <div className="text-[10px] font-medium text-muted uppercase tracking-wide flex items-center gap-2">
                <span>Timeline</span>
                <span className="text-[8px] normal-case tracking-normal italic text-[#6C5CE7]">click any row to jump the preview to that timestamp</span>
              </div>
              {slot.analysis.timeline_notes.map((tn, i) => {
                const flag = String(tn.flag || '').toLowerCase()
                const isRed = flag === 'red'
                const isGreen = flag === 'green'
                const t = Number(tn.t) || 0
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => seekPreview(t)}
                    title={`Jump preview to ${t.toFixed(1)}s`}
                    className={`w-full text-left text-[10px] flex items-start gap-1.5 rounded px-1 py-0.5 border-none cursor-pointer hover:bg-[#f3f0ff] hover:ring-1 hover:ring-[#6C5CE7]/40 ${
                      isRed ? 'bg-[#fdf2f1] border border-[#c0392b]/30'
                      : isGreen ? 'bg-[#f0faf4] border border-[#2D9A5E]/30'
                      : 'bg-transparent'
                    }`}
                  >
                    <span className="font-mono text-[#6C5CE7] shrink-0 w-10 underline">{t.toFixed(1)}s</span>
                    {isRed && (
                      <span className="shrink-0" title="Problem flagged at this frame">🚩</span>
                    )}
                    {isGreen && (
                      <span className="shrink-0" title="Strong moment — keep this">✅</span>
                    )}
                    <span
                      className={`break-words ${
                        isRed ? 'text-[#c0392b]' : isGreen ? 'text-[#0a4d2c]' : 'text-ink'
                      }`}
                    >
                      {tn.note}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {slot.thumbs.length > 0 && (
            <details className={`border border-[#e5e5e5] rounded p-2 ${slot.finalIsNewer ? 'opacity-60 grayscale' : ''}`} open>
              <summary className="text-[10px] font-medium cursor-pointer text-muted uppercase tracking-wide flex items-center gap-2">
                <span>Frames the AI reviewed ({slot.thumbs.length})</span>
                {slot.finalIsNewer
                  ? <span className="text-[8px] text-[#c0392b] font-bold normal-case tracking-normal">OUTDATED — from a previous final</span>
                  : <span className="text-[8px] text-[#2D9A5E] font-bold normal-case tracking-normal">SAVED</span>}
                <span className="text-[9px] text-muted normal-case tracking-normal italic">shift+click a frame to seek preview, click to enlarge</span>
              </summary>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {slot.thumbs.map((t, i) => {
                  const src = t.dataUrl || (t.base64 && t.mediaType ? `data:${t.mediaType};base64,${t.base64}` : null)
                  if (!src) return null
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={(ev) => {
                        // shift+click → seek preview to this timestamp (no zoom)
                        // plain click → enlarge (existing behavior)
                        if (ev.shiftKey) {
                          seekPreview(Number(t.t) || 0)
                          return
                        }
                        setZoomedFrame({ src, t: Number(t.t) || 0, idx: i, total: slot.thumbs.length, platform: active })
                      }}
                      className="relative p-0 border-none bg-transparent cursor-zoom-in"
                      title={`Frame at ${Number(t.t).toFixed(2)}s — click to enlarge, shift+click to seek preview`}
                    >
                      <img src={src} alt={`frame at ${t.t}s`} className="w-full rounded border border-[#e5e5e5] hover:border-[#6C5CE7]" />
                      <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] font-mono text-center py-0.5 pointer-events-none rounded-b">
                        {Number(t.t).toFixed(1)}s
                      </span>
                    </button>
                  )
                })}
              </div>
            </details>
          )}
        </>
      )}

      {/* Source-mp4 preview lightbox. Plays the exact file the
          analyzer would download next, with its storage key + job
          uuid + render timestamps shown below so mismatches are
          flag-able. */}
      {sourcePreview && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setSourcePreview(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-2" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setSourcePreview(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-ink text-lg flex items-center justify-center shadow cursor-pointer border-none z-10"
            >&times;</button>
            {sourcePreview.error ? (
              <div className="bg-white rounded p-4 text-[12px] text-[#c0392b]">
                Failed to load source preview: {sourcePreview.error}
              </div>
            ) : !sourcePreview.source_kind ? (
              <div className="bg-white rounded p-4 text-[12px] text-muted">
                {sourcePreview.message || 'No source video available yet.'}
              </div>
            ) : (
              <>
                {sourcePreview.public_url ? (
                  <video
                    src={sourcePreview.public_url}
                    controls
                    autoPlay
                    playsInline
                    className="max-w-full max-h-[70vh] rounded shadow-2xl bg-black"
                  />
                ) : (
                  <div className="bg-white rounded p-4 text-[12px] text-muted">No public URL available — file may have been removed from storage.</div>
                )}
                <div className="bg-white rounded px-3 py-2 text-[11px] font-mono space-y-0.5 max-w-[90vw]">
                  <div>
                    <span className={`font-bold ${
                      sourcePreview.source_kind === 'final' ? 'text-[#2D9A5E]'
                      : sourcePreview.source_kind === 'final-stale' ? 'text-[#f5a623]'
                      : 'text-[#c0392b]'
                    }`}>
                      {sourcePreview.source_kind === 'final' && '✓ FINAL (current)'}
                      {sourcePreview.source_kind === 'final-stale' && '⚠ FINAL (stale)'}
                      {sourcePreview.source_kind === 'merge' && '⛔ MERGE (no captions/overlays baked)'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted">job:</span>{' '}
                    <span className="select-all">{sourcePreview.job_uuid}</span>
                  </div>
                  <div className="break-all">
                    <span className="text-muted">file:</span>{' '}
                    <span className="select-all">{sourcePreview.source_filename}</span>
                  </div>
                  <details>
                    <summary className="text-muted cursor-pointer text-[10px]">full storage key</summary>
                    <div className="text-[10px] break-all select-all bg-[#f7f7f7] rounded p-1 mt-1">
                      {sourcePreview.source_key}
                    </div>
                  </details>
                  {sourcePreview.final_rendered_at && (
                    <div>
                      <span className="text-muted">final rendered:</span>{' '}
                      {new Date(sourcePreview.final_rendered_at).toLocaleString()}
                    </div>
                  )}
                  {sourcePreview.updated_at && (
                    <div>
                      <span className="text-muted">job updated:</span>{' '}
                      {new Date(sourcePreview.updated_at).toLocaleString()}
                    </div>
                  )}
                  <div className="text-[9px] italic text-muted pt-1 font-sans">
                    Copy any field above when reporting a mismatch.
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Full-size frame lightbox. Tap or click to dismiss. The frame
          image is rendered at the AI's exact extracted resolution so
          the user sees precisely what was analyzed. */}
      {zoomedFrame && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setZoomedFrame(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-2" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setZoomedFrame(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-ink text-lg flex items-center justify-center shadow cursor-pointer border-none z-10"
            >&times;</button>
            <img src={zoomedFrame.src} alt={`frame at ${zoomedFrame.t}s`} className="max-w-full max-h-[80vh] rounded shadow-2xl" />
            <div className="bg-white rounded px-3 py-1.5 text-[11px] font-mono flex items-center gap-3">
              <span className="text-[#6C5CE7] font-bold">{zoomedFrame.platform}</span>
              <span className="text-muted">•</span>
              <span>frame {zoomedFrame.idx + 1} of {zoomedFrame.total}</span>
              <span className="text-muted">•</span>
              <span>t = {zoomedFrame.t.toFixed(2)}s</span>
              <button
                type="button"
                onClick={() => { seekPreview(zoomedFrame.t); setZoomedFrame(null) }}
                className="ml-2 text-[10px] py-1 px-2 bg-[#6C5CE7] text-white rounded border-none cursor-pointer font-sans"
                title="Close lightbox + seek the preview to this moment"
              >🎯 Jump preview here</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
