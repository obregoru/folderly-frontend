// End-to-end platform-specific analyzer panel. Three independent
// analyses (TikTok, Reels, YouTube Shorts) — each runs a separate
// vision pass with platform-tuned scoring and saves to its own row.
// Tabs let the user switch between results without re-running.
//
// First-2s analysis is auto-loaded by the BE as additional context
// for the hook_strength / curiosity_gap dimensions when present.

import { useEffect, useState } from 'react'
import * as api from '../../api'

const PLATFORMS = [
  { key: 'tiktok', label: 'TikTok',  emoji: '🎵' },
  { key: 'reels',  label: 'Reels',   emoji: '📸' },
  { key: 'shorts', label: 'Shorts',  emoji: '▶️' },
]

const DIMENSIONS = [
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
})

export default function FullVideoPanel({ draftId, jobSync }) {
  const [active, setActive] = useState('tiktok')
  const [slots, setSlots] = useState({
    tiktok: emptySlot(),
    reels: emptySlot(),
    shorts: emptySlot(),
  })
  // Click-to-zoom lightbox for individual frame review. The user
  // wants to inspect what the AI saw at each timestamp side-by-side
  // with the dimension scores + suggestions — small thumbnails
  // weren't enough to read overlay legibility / contrast issues.
  const [zoomedFrame, setZoomedFrame] = useState(null)

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
              },
              thumbs: Array.isArray(r.frame_thumbs) ? r.frame_thumbs : [],
              hydratedFromDisk: true,
            },
          }))
        }
      }).catch(() => { /* no prior analysis is fine */ })
    })
    return () => { cancelled = true }
  }, [draftId])

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
      await api.renderFinal({ jobUuid: draftId })
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
      })
    } catch (e) {
      setSlot(platform, { err: e?.message || String(e), analyzing: false, stage: '' })
    } finally {
      setRefreshing(false)
    }
  }

  const slot = slots[active]
  const platformDef = PLATFORMS.find(p => p.key === active)

  // Kick off all three platforms in parallel against whatever final
  // / merge is currently in storage. No bake step — user controls
  // when the final is regenerated via Download Final.
  const runAll = () => {
    if (!draftId) return
    PLATFORMS.forEach(p => {
      if (slots[p.key].analyzing) return
      run(p.key)
    })
  }
  const anyAnalyzing = PLATFORMS.some(p => slots[p.key].analyzing)
  const allHave = PLATFORMS.every(p => slots[p.key].analysis)

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="text-[12px] font-medium">🎞️ Full video review</div>
          <div className="text-[10px] text-muted">
            Per-platform end-to-end vision analysis. Each platform has its own scoring criteria — TikTok rewards motion + curiosity, Reels rewards aesthetic + brand cohesion, Shorts rewards CTA + clarity. Reads the first-2s analysis (if you've run it) to ground the hook scoring.
          </div>
        </div>
        <button
          type="button"
          onClick={runAll}
          disabled={!draftId || anyAnalyzing}
          className="text-[11px] py-1.5 px-3 bg-gradient-to-r from-[#6C5CE7] to-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium whitespace-nowrap self-start"
          title="Run all three platform analyses in parallel against whatever final / merge is currently in storage. Render the final via Download Final BEFORE running this if you want overlays + captions in the analyzed pixels."
        >
          {anyAnalyzing
            ? `Analyzing… ${PLATFORMS.filter(p => slots[p.key].analysis).length}/3`
            : (allHave ? '⚡ Re-analyze all 3' : '⚡ Analyze all 3')}
        </button>
      </div>

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
          that platform is mid-analysis so the user can see which of
          the three is still in flight when "Analyze all 3" is running. */}
      <div className="grid grid-cols-3 gap-1">
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

      {slot.meta && slot.meta.source_kind !== 'final' && (
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
          <div className="border border-[#e5e5e5] rounded p-2 bg-[#fafafa] space-y-2">
            <div className="flex items-baseline gap-3 flex-wrap">
              <div className="text-[24px] font-bold text-[#6C5CE7] leading-none">{slot.analysis.overall_score}/10</div>
              <div className="text-[11px] text-muted flex-1">
                {slot.meta?.duration_sec != null && (
                  <>{slot.meta.duration_sec.toFixed(1)}s · {slot.meta.frames_used} frames · {slot.meta.source_kind}</>
                )}
              </div>
            </div>
            {slot.analysis.verdict && (
              <div className="text-[12px] font-medium text-ink">{slot.analysis.verdict}</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1">
            {DIMENSIONS.map(d => {
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
              <div className="text-[10px] font-medium text-muted uppercase tracking-wide">Timeline</div>
              {slot.analysis.timeline_notes.map((tn, i) => {
                const flag = String(tn.flag || '').toLowerCase()
                const isRed = flag === 'red'
                const isGreen = flag === 'green'
                return (
                  <div
                    key={i}
                    className={`text-[10px] flex items-start gap-1.5 rounded px-1 py-0.5 ${
                      isRed ? 'bg-[#fdf2f1] border border-[#c0392b]/30'
                      : isGreen ? 'bg-[#f0faf4] border border-[#2D9A5E]/30'
                      : ''
                    }`}
                  >
                    <span className="font-mono text-muted shrink-0 w-10">{Number(tn.t).toFixed(1)}s</span>
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
                  </div>
                )
              })}
            </div>
          )}

          {slot.thumbs.length > 0 && (
            <details className="border border-[#e5e5e5] rounded p-2" open>
              <summary className="text-[10px] font-medium cursor-pointer text-muted uppercase tracking-wide flex items-center gap-2">
                <span>Frames the AI reviewed ({slot.thumbs.length})</span>
                <span className="text-[8px] text-[#2D9A5E] font-bold normal-case tracking-normal">SAVED</span>
                <span className="text-[9px] text-muted normal-case tracking-normal italic">click any frame to enlarge</span>
              </summary>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {slot.thumbs.map((t, i) => {
                  const src = t.dataUrl || (t.base64 && t.mediaType ? `data:${t.mediaType};base64,${t.base64}` : null)
                  if (!src) return null
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setZoomedFrame({ src, t: Number(t.t) || 0, idx: i, total: slot.thumbs.length, platform: active })}
                      className="relative p-0 border-none bg-transparent cursor-zoom-in"
                      title={`Frame at ${Number(t.t).toFixed(2)}s — click to enlarge`}
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
            <div className="bg-white rounded px-3 py-1.5 text-[11px] font-mono">
              <span className="text-[#6C5CE7] font-bold">{zoomedFrame.platform}</span>
              <span className="mx-2 text-muted">•</span>
              <span>frame {zoomedFrame.idx + 1} of {zoomedFrame.total}</span>
              <span className="mx-2 text-muted">•</span>
              <span>t = {zoomedFrame.t.toFixed(2)}s</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
