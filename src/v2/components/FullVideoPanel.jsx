// End-to-end TikTok analyzer panel. Sister of First2sPanel but
// scores the WHOLE video (8s up to 30+s) on twelve dimensions
// including curiosity_gap, audio_visual_synergy, rewatch_value,
// overlay_color_contrast, brand_clarity. Auto-runs render-final
// before analysis when the cached final is stale, so the analyzed
// frames carry the latest captions/overlays burned in.

import { useState } from 'react'
import * as api from '../../api'

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

export default function FullVideoPanel({ draftId, jobSync }) {
  const [analyzing, setAnalyzing] = useState(false)
  const [stage, setStage] = useState('') // 'baking' | 'analyzing' | 'parsing'
  const [analysis, setAnalysis] = useState(null)
  const [meta, setMeta] = useState(null) // { duration_sec, frames_used, source_kind }
  const [thumbs, setThumbs] = useState([])
  const [err, setErr] = useState(null)

  const run = async () => {
    if (!draftId || analyzing) return
    setAnalyzing(true); setErr(null); setStage('baking')
    try {
      // Auto-bake the final so overlays + captions are in the pixels.
      // If render-final is unavailable or fails, fall through to
      // analyze on the merged source (the BE handles that fallback).
      try {
        if (typeof api.renderFinal === 'function') {
          await api.renderFinal({ jobUuid: draftId })
        }
      } catch (e) {
        console.warn('[full-video] auto-bake failed, analyzing merge instead:', e?.message)
      }
      setStage('analyzing')
      const r = await api.analyzeFullVideo(draftId)
      if (!r?.analysis) throw new Error('No analysis returned')
      setAnalysis(r.analysis)
      setMeta({
        duration_sec: r.duration_sec,
        frames_used: r.frames_used,
        source_kind: r.source_kind,
      })
      setThumbs(Array.isArray(r.frame_thumbs) ? r.frame_thumbs : [])
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setAnalyzing(false); setStage('')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="text-[12px] font-medium">🎞️ Full video review</div>
          <div className="text-[10px] text-muted">
            End-to-end vision pass over the whole video — hook through ending. Twelve dimensions including curiosity gap, A/V synergy, rewatch value. Pulls the latest final render so captions + overlays are in the analyzed frames.
          </div>
        </div>
        <button
          onClick={run}
          disabled={analyzing || !draftId}
          className="text-[11px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
        >
          {analyzing
            ? (stage === 'baking' ? 'Rendering final…' : stage === 'analyzing' ? 'Analyzing…' : 'Working…')
            : (analysis ? 'Re-analyze' : 'Analyze full video')}
        </button>
      </div>

      {err && (
        <div className="text-[11px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2">
          {err}
        </div>
      )}

      {analysis && (
        <>
          <div className="border border-[#e5e5e5] rounded p-2 bg-[#fafafa] space-y-2">
            <div className="flex items-baseline gap-3 flex-wrap">
              <div className="text-[24px] font-bold text-[#6C5CE7] leading-none">{analysis.overall_score}/10</div>
              <div className="text-[11px] text-muted flex-1">
                {meta?.duration_sec != null && (
                  <>{meta.duration_sec.toFixed(1)}s · {meta.frames_used} frames sampled · source: {meta.source_kind}</>
                )}
              </div>
            </div>
            {analysis.verdict && (
              <div className="text-[12px] font-medium text-ink">{analysis.verdict}</div>
            )}
          </div>

          {/* Per-platform scores. Shows TikTok / Reels / Shorts side-by-side
              with a colored chip, the adjustment delta vs base, and a 1-line
              reason. Without this the user couldn't tell whether a 7/10
              video would do better on TikTok vs Reels. */}
          {analysis.platforms && (
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { key: 'tiktok', label: 'TikTok', emoji: '🎵' },
                { key: 'reels',  label: 'Reels',  emoji: '📸' },
                { key: 'shorts', label: 'Shorts', emoji: '▶️' },
              ].map(p => {
                const px = analysis.platforms?.[p.key]
                if (!px) return null
                const v = Number(px.overall_score)
                const adj = Number(px.adjustment)
                const color = v >= 7 ? '#2D9A5E' : v >= 5 ? '#d97706' : '#c0392b'
                return (
                  <div key={p.key} className="border border-[#e5e5e5] rounded p-2 bg-white space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[14px]">{p.emoji}</span>
                      <span className="text-[11px] font-medium flex-1">{p.label}</span>
                      {Number.isFinite(adj) && (
                        <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                          adj > 0 ? 'bg-[#2D9A5E]/10 text-[#2D9A5E]' : adj < 0 ? 'bg-[#c0392b]/10 text-[#c0392b]' : 'bg-[#e5e5e5] text-muted'
                        }`}>{adj > 0 ? '+' : ''}{adj}</span>
                      )}
                    </div>
                    <div className="text-[20px] font-bold leading-none" style={{ color }}>{v}/10</div>
                    {px.reason && (
                      <div className="text-[9px] text-muted italic break-words">{px.reason}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="grid grid-cols-2 gap-1">
            {DIMENSIONS.map(d => {
              const v = Number(analysis[d.key])
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

          {Array.isArray(analysis.suggestions) && analysis.suggestions.length > 0 && (
            <div className="border border-[#6C5CE7]/30 rounded p-2 bg-[#f3f0ff] space-y-1">
              <div className="text-[10px] font-medium text-[#6C5CE7] uppercase tracking-wide">Suggestions</div>
              {analysis.suggestions.map((s, i) => (
                <div key={i} className="text-[11px] flex items-start gap-1.5">
                  <span className="text-[#6C5CE7] shrink-0 font-bold">{i + 1}.</span>
                  <span className="text-ink break-words">{s}</span>
                </div>
              ))}
            </div>
          )}

          {Array.isArray(analysis.timeline_notes) && analysis.timeline_notes.length > 0 && (
            <div className="border border-[#e5e5e5] rounded p-2 space-y-1">
              <div className="text-[10px] font-medium text-muted uppercase tracking-wide">Timeline</div>
              {analysis.timeline_notes.map((tn, i) => (
                <div key={i} className="text-[10px] flex items-start gap-1.5">
                  <span className="font-mono text-muted shrink-0 w-10">{Number(tn.t).toFixed(1)}s</span>
                  <span className="text-ink break-words">{tn.note}</span>
                </div>
              ))}
            </div>
          )}

          {thumbs.length > 0 && (
            <details className="border border-[#e5e5e5] rounded p-2">
              <summary className="text-[10px] font-medium cursor-pointer text-muted uppercase tracking-wide">
                Sampled frames ({thumbs.length})
              </summary>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {thumbs.map((t, i) => (
                  <div key={i} className="relative">
                    <img
                      src={`data:${t.mediaType};base64,${t.base64}`}
                      alt={`frame at ${t.t}s`}
                      className="w-full rounded border border-[#e5e5e5]"
                    />
                    <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] font-mono text-center py-0.5">
                      {Number(t.t).toFixed(1)}s
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  )
}
