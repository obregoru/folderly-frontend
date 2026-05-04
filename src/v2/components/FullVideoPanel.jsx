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

  const run = async (platform) => {
    if (!draftId) return
    const cur = slots[platform]
    if (cur.analyzing) return
    setSlot(platform, { analyzing: true, err: null, stage: 'baking', hydratedFromDisk: false })
    try {
      try {
        if (typeof api.renderFinal === 'function') {
          await api.renderFinal({ jobUuid: draftId })
        }
      } catch (e) {
        console.warn('[full-video] auto-bake failed, analyzing merge instead:', e?.message)
      }
      setSlot(platform, { stage: 'analyzing' })
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

  const slot = slots[active]
  const platformDef = PLATFORMS.find(p => p.key === active)

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[12px] font-medium">🎞️ Full video review</div>
        <div className="text-[10px] text-muted">
          Per-platform end-to-end vision analysis. Each platform has its own scoring criteria — TikTok rewards motion + curiosity, Reels rewards aesthetic + brand cohesion, Shorts rewards CTA + clarity. Reads the first-2s analysis (if you've run it) to ground the hook scoring.
        </div>
      </div>

      {/* Platform tabs */}
      <div className="grid grid-cols-3 gap-1">
        {PLATFORMS.map(p => {
          const has = !!slots[p.key].analysis
          const isActive = active === p.key
          const score = slots[p.key].analysis?.overall_score
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
              {has && Number.isFinite(Number(score)) && (
                <span className={`text-[10px] font-mono px-1 py-0 rounded ${
                  isActive ? 'bg-white/20' : 'bg-[#f3f0ff] text-[#6C5CE7]'
                }`}>{score}/10</span>
              )}
              {!has && <span className="text-[9px] opacity-60">—</span>}
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
            ? (slot.stage === 'baking' ? 'Rendering final…' : slot.stage === 'analyzing' ? `Analyzing for ${platformDef.label}…` : 'Working…')
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
              {slot.analysis.timeline_notes.map((tn, i) => (
                <div key={i} className="text-[10px] flex items-start gap-1.5">
                  <span className="font-mono text-muted shrink-0 w-10">{Number(tn.t).toFixed(1)}s</span>
                  <span className="text-ink break-words">{tn.note}</span>
                </div>
              ))}
            </div>
          )}

          {slot.thumbs.length > 0 && (
            <details className="border border-[#e5e5e5] rounded p-2">
              <summary className="text-[10px] font-medium cursor-pointer text-muted uppercase tracking-wide">
                Sampled frames ({slot.thumbs.length})
              </summary>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {slot.thumbs.map((t, i) => {
                  const src = t.dataUrl || (t.base64 && t.mediaType ? `data:${t.mediaType};base64,${t.base64}` : null)
                  if (!src) return null
                  return (
                    <div key={i} className="relative">
                      <img src={src} alt={`frame at ${t.t}s`} className="w-full rounded border border-[#e5e5e5]" />
                      <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] font-mono text-center py-0.5">
                        {Number(t.t).toFixed(1)}s
                      </span>
                    </div>
                  )
                })}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  )
}
