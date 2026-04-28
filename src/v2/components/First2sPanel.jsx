// First 2-second TikTok scroll-stop analyzer panel. Sends the merged
// video's first 2s through Claude vision, displays the structured
// analysis (overall + sub-scores + strengths/issues/suggestions),
// and lets the user toggle visualization overlays on the live preview.
//
// Frame thumbnails ride along in the response so users can see
// exactly what the AI was looking at — trust comes from showing the
// work, not just the verdict.

import { useEffect, useState } from 'react'
import * as api from '../../api'

const OVERLAY_KEYS = [
  { key: 'safeZones',     label: 'Safe zones',     hint: 'Show TikTok UI dead-zones (where likes/comments cover the frame).' },
  { key: 'scoreHUD',      label: 'Score HUD',      hint: 'Compact scorecard pinned to the corner of the preview.' },
  { key: 'detectionBoxes',label: 'Detections',     hint: 'Bounding boxes for the subjects the AI detected (group, faces, products).' },
  { key: 'clarityTimeline', label: 'Timeline',     hint: 'Scrubber along the bottom marking key events at 0–2s.' },
]

export default function First2sPanel({ draftId }) {
  const [analysis, setAnalysis] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [err, setErr] = useState(null)
  const [errRaw, setErrRaw] = useState(null)
  const [overlays, setOverlays] = useState({
    safeZones: true,
    scoreHUD: true,
    detectionBoxes: true,
    clarityTimeline: true,
  })

  // Whenever overlays toggle OR a new analysis lands, dispatch the
  // payload First2sOverlay listens for. Component never reads from
  // global state — the event is the only contract between this panel
  // and the overlay layer.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window._postyFirst2s = { analysis, overlays }
      window.dispatchEvent(new CustomEvent('posty-first2s-change', {
        detail: { analysis, overlays },
      }))
    } catch {}
  }, [analysis, overlays])

  const run = async () => {
    if (!draftId || analyzing) return
    setAnalyzing(true); setErr(null); setErrRaw(null)
    try {
      const r = await api.analyzeFirstTwoSec(draftId)
      setAnalysis(r)
    } catch (e) {
      setErr(e?.message || String(e))
      // The BE attaches the raw model response when a 422 fires
      // (parser couldn't extract JSON). Surfacing it lets us see
      // what came back instead of staring at a generic message.
      if (e?.raw) setErrRaw(String(e.raw))
    } finally {
      setAnalyzing(false)
    }
  }

  const score = analysis?.score
  const overall = Number(score?.totalScore) || 0
  const verdict = score?.verdict || ''
  const verdictColor = overall >= 85 ? '#2D9A5E'
    : overall >= 70 ? '#16a34a'
    : overall >= 50 ? '#d97706'
    : '#c0392b'

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">🎯 First 2 seconds</div>
        {analysis && (
          <button
            onClick={() => setAnalysis(null)}
            className="text-[10px] py-1 px-2 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
          >Clear</button>
        )}
      </div>

      <div className="text-[10px] text-muted">
        Audits the first 2s for TikTok scroll-stop performance. Sends 6 sampled frames + your hook text + brand to Claude vision; returns scored feedback you can act on.
      </div>

      <button
        onClick={run}
        disabled={analyzing || !draftId}
        className="w-full py-2 bg-[#6C5CE7] text-white text-[11px] font-medium border-none rounded cursor-pointer disabled:opacity-50"
      >{analyzing ? 'Analyzing first 2 seconds…' : '🔍 Analyze first 2 seconds'}</button>

      {err && (
        <div className="text-[10px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2 space-y-1">
          <div>{err}</div>
          {errRaw && (
            <details className="cursor-pointer">
              <summary className="text-[9px] text-muted">show raw model response</summary>
              <pre className="mt-1 text-[9px] font-mono whitespace-pre-wrap bg-white border border-[#e5e5e5] rounded p-1.5 max-h-48 overflow-auto text-ink">{errRaw}</pre>
            </details>
          )}
        </div>
      )}

      {analysis && (
        <>
          {/* Source note — tells the user which video the analyzer
              actually looked at. "final" = the cached download
              (overlays + captions burned in, most accurate). "merge"
              = the raw clips without any styled text. The note keeps
              users from being confused when textEffectiveness scores
              feel disconnected from what they see in the live preview. */}
          {analysis?.source?.kind === 'merge' ? (
            <div className="text-[10px] text-[#92400e] bg-[#fef3c7] border border-[#d97706]/40 rounded p-1.5">
              <span className="font-medium">Analyzing the raw merge.</span> Overlay text and captions aren't burned into these frames yet —
              the textEffectiveness score is judging your <em>typed hook</em>, not how it actually appears on screen.
              Click <strong>Download</strong> once to bake the export, then re-analyze for a pixel-accurate read.
            </div>
          ) : analysis?.source?.kind === 'final' ? (
            <div className="text-[10px] text-[#16a34a] bg-[#f0faf4] border border-[#2D9A5E]/30 rounded p-1.5">
              <span className="font-medium">Analyzing your last downloaded export</span> — overlay text + captions are visible to the analyzer.
              If you've changed overlays or VO since then, re-Download and re-analyze for a fresh read.
            </div>
          ) : null}

          {/* Overall verdict card. */}
          <div
            className="border rounded p-2 flex items-center gap-3"
            style={{ borderColor: verdictColor + '66', background: verdictColor + '10' }}
          >
            <div className="text-center">
              <div className="text-[8px] uppercase tracking-wide text-muted">Score</div>
              <div className="font-mono font-bold leading-none" style={{ color: verdictColor, fontSize: 28 }}>
                {Math.round(overall)}<span className="text-[12px]">/100</span>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[14px]" style={{ color: verdictColor }}>{verdict || '—'}</div>
              {analysis.timeToClarity && (
                <div className="text-[10px] text-muted">
                  Time to clarity: <span className="font-mono">{Number(analysis.timeToClarity.seconds || 0).toFixed(2)}s</span> · {analysis.timeToClarity.rating}
                </div>
              )}
              {analysis.timeToEngagement && (
                <div className="text-[10px] text-muted">
                  Time to engagement: <span className="font-mono">{Number(analysis.timeToEngagement.seconds || 0).toFixed(2)}s</span> · {analysis.timeToEngagement.rating}
                </div>
              )}
            </div>
          </div>

          {/* Sub-scores. Each category's max varies (25 / 25 / 15 /
              15 / 15) so we show fraction-of-max as a percentage bar
              for a fair visual comparison. */}
          {score?.categoryScores && (
            <div className="space-y-1.5">
              <CategoryBar label="Context clarity"     value={score.categoryScores.contextClarity}     max={25} />
              <CategoryBar label="Visual engagement"   value={score.categoryScores.visualEngagement}   max={25} />
              <CategoryBar label="Focal clarity"       value={score.categoryScores.focalClarity}       max={15} />
              <CategoryBar label="Text effectiveness"  value={score.categoryScores.textEffectiveness}  max={15} />
              <CategoryBar label="Curiosity gap"       value={score.categoryScores.curiosityGap}       max={15} />
              {Number(score.categoryScores.scrollRiskPenalty) < 0 && (
                <CategoryBar
                  label="Scroll risk penalty"
                  value={Number(score.categoryScores.scrollRiskPenalty)}
                  max={20}
                  isPenalty
                />
              )}
            </div>
          )}

          {/* Frame thumbnails with detection boxes. Trust-builder:
              users can see what the AI saw at each timestamp. Boxes
              are filtered to detections close to the frame's time. */}
          {Array.isArray(analysis.frames) && analysis.frames.length > 0 && (
            <div>
              <div className="text-[10px] font-medium mb-1">Sampled frames</div>
              <div className="grid grid-cols-3 gap-1">
                {analysis.frames.map(f => (
                  <FrameThumbnail
                    key={f.timeSeconds}
                    frame={f}
                    detections={Array.isArray(analysis.detections) ? analysis.detections : []}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Findings — strengths / issues / suggestions. Each comes
              from the analyzer and renders as a styled bullet list. */}
          {Array.isArray(score?.strengths) && score.strengths.length > 0 && (
            <Findings title="✅ Strengths" items={score.strengths} accent="#2D9A5E" />
          )}
          {Array.isArray(score?.issues) && score.issues.length > 0 && (
            <Findings title="⚠️ Issues" items={score.issues} accent="#c0392b" />
          )}
          {Array.isArray(score?.suggestions) && score.suggestions.length > 0 && (
            <Findings title="✏️ Suggestions" items={score.suggestions} accent="#6C5CE7" />
          )}

          {/* Overlay toggles — flip what's drawn on the live preview. */}
          <div className="border-t border-[#e5e5e5] pt-2 space-y-1.5">
            <div className="text-[10px] font-medium">Preview overlays</div>
            {OVERLAY_KEYS.map(o => (
              <label key={o.key} className="flex items-start gap-2 text-[10px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!overlays[o.key]}
                  onChange={e => setOverlays(prev => ({ ...prev, [o.key]: e.target.checked }))}
                  className="mt-0.5"
                />
                <div>
                  <span className="font-medium">{o.label}</span>
                  <span className="text-muted ml-1">— {o.hint}</span>
                </div>
              </label>
            ))}
          </div>

          {analysis.timing && (
            <div className="text-[9px] text-muted text-right">
              extract {analysis.timing.extractMs}ms · vision {analysis.timing.apiMs}ms
            </div>
          )}
        </>
      )}
    </div>
  )
}

// One row in the sub-score breakdown. Bar fills proportionally to the
// category's max (since maxes vary 15/25). Penalty rows render in red
// + flipped direction so users see "more bar = more penalty."
function CategoryBar({ label, value, max, isPenalty }) {
  const v = Number(value) || 0
  const fill = isPenalty
    ? Math.min(1, Math.abs(v) / max)
    : Math.max(0, Math.min(1, v / max))
  const color = isPenalty
    ? '#c0392b'
    : (fill >= 0.8 ? '#2D9A5E' : fill >= 0.55 ? '#d97706' : '#c0392b')
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-32 truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-[#f0f0f0] rounded overflow-hidden">
        <div
          className="h-full rounded transition-all"
          style={{ width: `${fill * 100}%`, background: color }}
        />
      </div>
      <span className="font-mono w-12 text-right" style={{ color }}>
        {isPenalty ? `${v}` : `${v}/${max}`}
      </span>
    </div>
  )
}

// One sampled frame with any detection boxes that landed within ±0.4s.
// Boxes are coordinate-normalized (x/y/w/h are 0-1 fractions), so we
// position them as percentages on top of the thumbnail.
function FrameThumbnail({ frame, detections }) {
  const t = frame.timeSeconds
  const nearby = detections.filter(d => Math.abs((d.time ?? 0) - t) <= 0.4 && d?.box)
  return (
    <div className="relative aspect-[9/16] bg-black rounded overflow-hidden">
      <img src={frame.dataUrl} alt={`Frame at ${t}s`} className="w-full h-full object-cover" />
      {nearby.map((d, i) => (
        <div
          key={i}
          className="absolute border-2 border-[#f59e0b] pointer-events-none"
          style={{
            left: `${(d.box.x || 0) * 100}%`,
            top: `${(d.box.y || 0) * 100}%`,
            width: `${(d.box.width || 0) * 100}%`,
            height: `${(d.box.height || 0) * 100}%`,
          }}
          title={`${d.type}${d.label ? `: ${d.label}` : ''} (${Math.round((d.confidence || 0) * 100)}%)`}
        />
      ))}
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] font-mono text-center py-0.5">
        t={t.toFixed(2)}s
      </div>
    </div>
  )
}

function Findings({ title, items, accent }) {
  return (
    <div>
      <div className="text-[10px] font-medium mb-0.5" style={{ color: accent }}>{title}</div>
      <ul className="text-[10px] space-y-0.5 list-disc pl-4">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  )
}
