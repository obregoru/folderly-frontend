// First 2-second TikTok scroll-stop analyzer panel. Sends the merged
// video's first 2s through Claude vision, displays the structured
// analysis (overall + sub-scores + strengths/issues/suggestions),
// and lets the user toggle visualization overlays on the live preview.
//
// Frame thumbnails ride along in the response so users can see
// exactly what the AI was looking at — trust comes from showing the
// work, not just the verdict. Frames are persisted in
// ai_interactions.metadata so a panel reload restores the same
// thumbnails (no need to re-run Claude just to see what was scored).

import { useEffect, useState } from 'react'
import * as api from '../../api'

const OVERLAY_KEYS = [
  { key: 'safeZones',     label: 'Safe zones',     hint: 'Show TikTok UI dead-zones (where likes/comments cover the frame).' },
  { key: 'scoreHUD',      label: 'Score HUD',      hint: 'Compact scorecard pinned to the corner of the preview.' },
  { key: 'detectionBoxes',label: 'Detections',     hint: 'Bounding boxes for the subjects the AI detected (group, faces, products).' },
  { key: 'clarityTimeline', label: 'Timeline',     hint: 'Scrubber along the bottom marking key events at 0–2s.' },
]

export default function First2sPanel({ draftId, jobSync }) {
  const [analysis, setAnalysis] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  // 'baking' while we auto-trigger render-final to ensure the
  // analyzed frames have the latest captions / overlays burned in;
  // 'analyzing' while Claude vision runs.
  const [stage, setStage] = useState(null)
  const [err, setErr] = useState(null)
  const [errRaw, setErrRaw] = useState(null)
  // Persistence metadata. analyzedAt + sourceKind come from the most
  // recent ai_log row when we hydrate from disk; both null on a
  // fresh in-session run (the response itself carries source info
  // for fresh runs, and analyzedAt is implicitly "now").
  const [analyzedAt, setAnalyzedAt] = useState(null)
  const [hydratedFromDisk, setHydratedFromDisk] = useState(false)
  // Platform tab — 'all' shows the comparison strip; tiktok/reels/
  // youtubeShorts each show that platform's full breakdown.
  const [platformTab, setPlatformTab] = useState('all')
  const [overlays, setOverlays] = useState({
    safeZones: true,
    scoreHUD: true,
    detectionBoxes: true,
    clarityTimeline: true,
  })
  // "Apply analysis" flow — proposals from the BE that the user can
  // selectively accept (overlay text, VO primary, caption style).
  // null until the user clicks Apply. Each target has its own
  // accept/reject so partial application is fine.
  const [applyProposals, setApplyProposals] = useState(null)
  const [applying, setApplying] = useState(false)
  const [applyErr, setApplyErr] = useState(null)
  const [applyTargets, setApplyTargets] = useState({ overlay: true, voiceover: true, captionStyle: true })
  const [appliedNote, setAppliedNote] = useState(null)

  // Hydrate the most recent saved analysis on draft change. The
  // backend now persists frame thumbnails alongside the score in
  // ai_interactions.metadata, so a reloaded panel shows the same
  // sampled frames + detection boxes the original run displayed —
  // not just the verdict. Re-running is only needed when the user
  // has edited the video and wants a fresh score.
  useEffect(() => {
    if (!draftId) return
    let cancelled = false
    api.lastFirstTwoSecAnalysis(draftId).then(r => {
      if (cancelled) return
      if (r?.analysis) {
        setAnalysis(r.analysis)
        setAnalyzedAt(r.analyzedAt || null)
        setHydratedFromDisk(true)
      }
    })
    return () => { cancelled = true }
  }, [draftId])

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
      // Auto-bake the final FIRST so the analyzed frames carry the
      // current captions + overlays. render-final keys off the same
      // final_media_fingerprint the Download button uses — when the
      // user hasn't edited anything since their last bake, this is a
      // cache hit (a few hundred ms, no ffmpeg). When something HAS
      // changed (caption style, VO segment text, overlay sizing,
      // …) the fingerprint mismatches and a fresh render kicks in
      // — no more "I downloaded yesterday but my new captions
      // aren't in the analyzed frames" gotcha.
      setStage('baking')
      let primaryBase64 = null
      try {
        const primaryEl = document.querySelector('audio[data-posty-primary-voice]')
        if (primaryEl?.src) {
          const r = await fetch(primaryEl.src)
          const b = await r.blob()
          const buf = new Uint8Array(await b.arrayBuffer())
          let bin = ''
          for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
          primaryBase64 = btoa(bin)
        }
      } catch { /* persisted primary still works server-side */ }
      try {
        await api.renderFinal({ jobUuid: draftId, primaryAudioBase64: primaryBase64 })
      } catch (e) {
        // Render failure shouldn't kill analyze — fall through and
        // analyze whatever the BE has (likely the raw merge with a
        // 'merge' source banner). Surface to console so we can
        // diagnose if users report missing captions.
        console.warn('[first2s] render-final failed; analyzing existing source:', e?.message || e)
      }
      setStage('analyzing')
      const r = await api.analyzeFirstTwoSec(draftId)
      setAnalysis(r)
      setAnalyzedAt(new Date().toISOString())
      setHydratedFromDisk(false)
    } catch (e) {
      setErr(e?.message || String(e))
      if (e?.raw) setErrRaw(String(e.raw))
    } finally {
      setAnalyzing(false)
      setStage(null)
    }
  }

  const requestApply = async () => {
    if (!draftId || applying) return
    const targets = Object.keys(applyTargets).filter(k => applyTargets[k])
    if (targets.length === 0) {
      setApplyErr('Pick at least one target (overlay / voiceover / captionStyle).')
      return
    }
    setApplyErr(null); setApplying(true); setApplyProposals(null); setAppliedNote(null)
    try {
      const r = await api.producerApplyAnalysis(draftId, { targets })
      setApplyProposals(r)
    } catch (e) {
      setApplyErr(e?.message || String(e))
    } finally {
      setApplying(false)
    }
  }

  // Persist proposals via the existing FE save paths so we don't
  // duplicate write code. Each target uses the SAME save method the
  // panel that owns it does, so per-debounce / fingerprint logic
  // continues to fire normally.
  const acceptProposal = async (which) => {
    const p = applyProposals?.proposed?.[which]
    if (!p) return
    try {
      if (which === 'overlay' && p.openingText) {
        const existingOverlays = (typeof window !== 'undefined' && window._postyOverlays) || {}
        const next = {
          ...existingOverlays,
          openingText: p.openingText,
          openingDuration: p.openingDuration || existingOverlays.openingDuration || 2.5,
          // Drop runs[] on apply — the new text replaces any per-run styling
          // the user had on the previous opening copy.
          openingRuns: null,
        }
        jobSync?.saveOverlaySettings?.(next)
        try {
          window._postyOverlays = next
          window.dispatchEvent(new CustomEvent('posty-overlay-change', { detail: next }))
        } catch {}
      } else if (which === 'voiceover' && p.primary) {
        // Persist as the synthetic __primary__ segment via the same
        // shape VoiceoverPanelV2 uses, by mutating voiceover_settings
        // through jobSync's existing helper.
        const r = await api.getJob(draftId).catch(() => null)
        const vo = r?.voiceover_settings || {}
        const segs = Array.isArray(vo.segments) ? [...vo.segments] : []
        const idx = segs.findIndex(s => s?.id === '__primary__')
        const nextPrimary = {
          id: '__primary__', startTime: 0, text: p.primary,
          audioKey: null, duration: null, speed: 1.0,
        }
        if (idx >= 0) segs[idx] = { ...segs[idx], text: p.primary, duration: null }
        else segs.unshift(nextPrimary)
        const nextVo = { ...vo, segments: segs }
        jobSync?.saveVoiceoverSettings?.(nextVo)
        try { window.dispatchEvent(new CustomEvent('posty-voiceover-change', { detail: nextVo })) } catch {}
      } else if (which === 'captionStyle') {
        const fields = {}
        if (p.baseFontSize != null) fields.base_font_size = p.baseFontSize
        if (p.baseFontColor) fields.base_font_color = p.baseFontColor
        if (p.verticalPosition != null) {
          fields.layout_config = { ...(fields.layout_config || {}), verticalPosition: p.verticalPosition }
        }
        if (Object.keys(fields).length > 0) {
          if (typeof api.updateJobDefaultCaptionStyle === 'function') {
            await api.updateJobDefaultCaptionStyle(draftId, fields)
          } else {
            await api.updateJob(draftId, { default_caption_style: fields })
          }
        }
      }
      setAppliedNote(prev => ({ ...(prev || {}), [which]: true }))
    } catch (e) {
      setApplyErr(`Apply ${which} failed: ${e?.message || String(e)}`)
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
      >{analyzing
        ? (stage === 'baking'
            ? '⏳ Baking captions + overlays into final…'
            : '🔍 Analyzing first 2 seconds…')
        : (analysis ? '🔄 Re-analyze first 2 seconds' : '🔍 Analyze first 2 seconds')}</button>

      {hydratedFromDisk && analyzedAt && (
        <div className="text-[10px] text-muted bg-[#fafafa] border border-[#e5e5e5] rounded px-2 py-1">
          Showing your last analysis from <span className="font-mono">{new Date(analyzedAt).toLocaleString()}</span>.
          Re-analyze if you've edited the video and want a fresh score.
        </div>
      )}

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
          {analysis?.source?.kind === 'raw' ? (
            <div className="text-[10px] text-[#92400e] bg-[#fef3c7] border border-[#d97706]/40 rounded p-1.5">
              <span className="font-medium">Analyzing your raw upload.</span> No merge or final has been baked yet — overlay text + captions
              aren't visible to the analyzer in these frames. Add overlays / VO and re-run for a pixel-accurate read.
              Trim is respected so the sampled frames start at your trim_start.
            </div>
          ) : analysis?.source?.kind === 'merge' ? (
            <div className="text-[10px] text-[#92400e] bg-[#fef3c7] border border-[#d97706]/40 rounded p-1.5">
              <span className="font-medium">Analyzing the raw merge.</span> The auto-bake step couldn't produce a final export
              (likely missing voiceover audio or a server hiccup) so the frames don't show overlay text or captions yet —
              textEffectiveness is judging the typed hook, not the rendered pixels.
            </div>
          ) : analysis?.source?.kind === 'final' && analysis?.source?.staleFinal ? (
            <div className="text-[10px] text-[#92400e] bg-[#fef3c7] border border-[#d97706]/40 rounded p-1.5">
              <span className="font-medium">⚠ Analyzing a STALE final export.</span> The cached bake's fingerprint no longer matches your current
              caption / overlay / VO settings, but the auto-bake step appears to have been bypassed or hit a server error. Click
              <strong> Re-analyze</strong> to force a fresh bake, or check console logs for a render-final failure.
            </div>
          ) : analysis?.source?.kind === 'final' ? (
            <div className="text-[10px] text-[#16a34a] bg-[#f0faf4] border border-[#2D9A5E]/30 rounded p-1.5">
              <span className="font-medium">Analyzing the freshly-baked final export</span> — overlay text + captions are visible to the analyzer.
              The bake auto-runs every time you click Analyze; cache hits when nothing changed, re-renders when you've edited overlays or VO.
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

          {/* Apply analysis — refines overlay / VO / captionStyle
              against the analysis's issues + suggestions. Shows a
              preview before persisting; each target accepted
              independently so partial application is fine. */}
          <div className="border border-[#6C5CE7]/30 bg-[#f3f0ff] rounded p-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="text-[11px] font-medium flex-1">✨ Apply this analysis</div>
              {!applyProposals && (
                <button
                  onClick={requestApply}
                  disabled={applying}
                  className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
                >{applying ? 'Producing fixes…' : 'Apply suggestions'}</button>
              )}
            </div>
            {!applyProposals && (
              <div className="text-[9px] text-muted">
                Sends the analysis above to Claude with the rubric and your current draft. Returns refined versions of the targets you check below — preview first, accept per target.
              </div>
            )}
            {!applyProposals && (
              <div className="flex items-center gap-3 text-[10px]">
                {['overlay','voiceover','captionStyle'].map(t => (
                  <label key={t} className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!applyTargets[t]}
                      onChange={e => setApplyTargets(prev => ({ ...prev, [t]: e.target.checked }))}
                    />
                    {t === 'captionStyle' ? 'caption style' : t}
                  </label>
                ))}
              </div>
            )}
            {applyErr && <div className="text-[10px] text-[#c0392b]">{applyErr}</div>}
            {applyProposals && (
              <ApplyProposalsPreview
                proposals={applyProposals}
                applied={appliedNote || {}}
                onAccept={acceptProposal}
                onClose={() => { setApplyProposals(null); setAppliedNote(null) }}
              />
            )}
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

          {/* Hook channel breakdown — separates the on-screen hook
              (read time, 5 wps) from the spoken VO hook (speak time,
              2.5 wps). Each channel has its own timing budget so a
              hook can pass for one and fail for the other. */}
          {analysis.hookChannels && (analysis.hookChannels.onScreen || analysis.hookChannels.spoken) && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium">Hook timing</div>
              {analysis.hookChannels.onScreen && (
                <HookChannelRow
                  label="On-screen"
                  data={analysis.hookChannels.onScreen}
                  unitLabel="read"
                  unitField="readTimeSec"
                />
              )}
              {analysis.hookChannels.spoken && (
                <HookChannelRow
                  label="Spoken VO"
                  data={analysis.hookChannels.spoken}
                  unitLabel="speak"
                  unitField="speakTimeSec"
                />
              )}
              {analysis.hookChannels.redundant && (
                <div className="text-[9px] text-[#d97706]">
                  ⚠ Overlay text and VO say the same thing — wasted real estate. Use overlay for the hook, VO for the story.
                </div>
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

          {/* Platform adaptation layer. Click a tab to see that
              platform's adjusted score + platform-specific
              suggestions; "All" shows a 3-card comparison strip. */}
          {analysis.platformScores && (
            <PlatformBreakdown
              base={analysis.score}
              platforms={analysis.platformScores}
              activeTab={platformTab}
              setActiveTab={setPlatformTab}
            />
          )}

          {/* Generic findings — strengths / issues / suggestions from
              the BASE analysis (before platform adjustments). Hidden
              when a specific platform tab is selected since that
              platform's tab shows its own findings. */}
          {(!analysis.platformScores || platformTab === 'all') && (
            <>
              {Array.isArray(score?.strengths) && score.strengths.length > 0 && (
                <Findings title="✅ Strengths (base)" items={score.strengths} accent="#2D9A5E" />
              )}
              {Array.isArray(score?.issues) && score.issues.length > 0 && (
                <Findings title="⚠️ Issues (base)" items={score.issues} accent="#c0392b" />
              )}
              {Array.isArray(score?.suggestions) && score.suggestions.length > 0 && (
                <Findings title="✏️ Suggestions (base)" items={score.suggestions} accent="#6C5CE7" />
              )}
            </>
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

// Platform adaptation layer UI. Tabs across the top (All / TikTok /
// Reels / Shorts). "All" renders three side-by-side mini-cards so the
// user can see which platform suits the video best at a glance; each
// platform tab shows that platform's full breakdown plus the
// platform-specific sub-metric (saveability for Reels; topicClarity +
// loopQuality for Shorts).
const PLATFORMS = [
  { key: 'tiktok',         label: 'TikTok',  short: 'TikTok' },
  { key: 'reels',          label: 'Reels (IG/FB)', short: 'Reels' },
  { key: 'youtubeShorts',  label: 'YT Shorts', short: 'Shorts' },
]

// Renders the BE's apply-analysis proposals as a side-by-side
// before/after card per target with an Accept button. Designed for
// partial accept — the user can take the overlay rewrite but skip
// caption-style changes, etc. The summary up top frames "what
// changed and why" so users understand the diff before clicking.
function ApplyProposalsPreview({ proposals, applied, onAccept, onClose }) {
  const p = proposals?.proposed || {}
  const cur = proposals?.current || {}
  const summary = p?.summary || null
  const targets = []
  if (p.overlay && p.overlay.openingText) targets.push({
    key: 'overlay', label: 'Overlay opening',
    current: cur.overlay?.openingText || '(empty)',
    next: p.overlay.openingText,
    extra: p.overlay.openingDuration ? `Duration: ${p.overlay.openingDuration}s` : null,
  })
  if (p.voiceover && p.voiceover.primary) targets.push({
    key: 'voiceover', label: 'Voiceover primary',
    current: cur.voiceover?.primary || '(empty)',
    next: p.voiceover.primary,
    extra: p.voiceover.rationale || null,
  })
  if (p.captionStyle && (p.captionStyle.baseFontSize != null || p.captionStyle.baseFontColor || p.captionStyle.verticalPosition != null)) {
    const parts = []
    if (p.captionStyle.baseFontSize != null) parts.push(`size ${cur.captionStyle?.baseFontSize ?? '?'} → ${p.captionStyle.baseFontSize}`)
    if (p.captionStyle.baseFontColor) parts.push(`color ${cur.captionStyle?.baseFontColor ?? '?'} → ${p.captionStyle.baseFontColor}`)
    if (p.captionStyle.verticalPosition != null) parts.push(`Y ${cur.captionStyle?.verticalPosition ?? '?'}% → ${p.captionStyle.verticalPosition}%`)
    targets.push({
      key: 'captionStyle', label: 'Caption style',
      current: 'see right →',
      next: parts.join(' · '),
      extra: null,
    })
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="text-[10px] font-medium flex-1">Proposed changes</div>
        <button
          onClick={onClose}
          className="text-[10px] text-muted py-0.5 px-1.5 border border-[#e5e5e5] bg-white rounded cursor-pointer"
          title="Discard proposals — nothing has been applied yet"
        >Discard</button>
      </div>
      {summary && (
        <div className="text-[10px] text-ink bg-white border border-[#e5e5e5] rounded p-1.5 italic">
          {summary}
        </div>
      )}
      {targets.length === 0 && (
        <div className="text-[10px] text-muted italic">Producer didn't suggest any concrete changes for the targets you picked.</div>
      )}
      {targets.map(t => (
        <div key={t.key} className="bg-white border border-[#e5e5e5] rounded p-1.5 space-y-1">
          <div className="text-[9px] uppercase tracking-wide text-muted">{t.label}</div>
          <div className="text-[10px]">
            <div className="text-muted line-through truncate" title={t.current}>{t.current}</div>
            <div className="text-ink font-medium">{t.next}</div>
            {t.extra && <div className="text-[9px] text-muted italic">{t.extra}</div>}
          </div>
          <div className="flex items-center gap-2">
            {applied[t.key] ? (
              <span className="text-[10px] text-[#2D9A5E]">✓ Applied — open the {t.key === 'overlay' ? 'Overlays' : t.key === 'voiceover' ? 'Voiceover' : 'Captions'} tab to fine-tune.</span>
            ) : (
              <button
                onClick={() => onAccept(t.key)}
                className="ml-auto text-[10px] py-0.5 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer"
              >Accept this change</button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function PlatformBreakdown({ base, platforms, activeTab, setActiveTab }) {
  const baseScore = Number(base?.totalScore) || 0
  return (
    <div className="border border-[#e5e5e5] rounded p-2 space-y-2 bg-white">
      <div className="text-[10px] font-medium">Per-platform breakdown</div>
      {/* Tab strip. */}
      <div className="flex gap-1 bg-[#f8f7f3] rounded-md p-0.5">
        {[{ key: 'all', label: 'All' }, ...PLATFORMS.map(p => ({ key: p.key, label: p.short }))].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 text-[10px] py-1 rounded border-none cursor-pointer ${
              activeTab === t.key ? 'bg-white text-ink shadow-sm font-medium' : 'bg-transparent text-muted'
            }`}
          >{t.label}</button>
        ))}
      </div>

      {activeTab === 'all' ? (
        <div className="grid grid-cols-3 gap-1.5">
          {PLATFORMS.map(p => {
            const ps = platforms[p.key]
            if (!ps) {
              return (
                <div key={p.key} className="border border-dashed border-[#e5e5e5] rounded p-1.5 text-[10px] text-muted text-center">
                  {p.short}<br/>—
                </div>
              )
            }
            return <PlatformMiniCard key={p.key} platform={p} ps={ps} baseScore={baseScore} onClick={() => setActiveTab(p.key)} />
          })}
        </div>
      ) : (
        <PlatformDetail platform={PLATFORMS.find(p => p.key === activeTab)} ps={platforms[activeTab]} baseScore={baseScore} />
      )}
    </div>
  )
}

function PlatformMiniCard({ platform, ps, baseScore, onClick }) {
  const adjusted = Number(ps.adjustedScore) || 0
  const delta = Number(ps.scoreAdjustment) || (adjusted - baseScore)
  const color = adjusted >= 85 ? '#2D9A5E' : adjusted >= 70 ? '#16a34a' : adjusted >= 50 ? '#d97706' : '#c0392b'
  const deltaColor = delta > 0 ? '#16a34a' : delta < 0 ? '#c0392b' : '#6b7280'
  return (
    <button
      onClick={onClick}
      className="border rounded p-1.5 text-center cursor-pointer bg-white hover:bg-[#fafafa]"
      style={{ borderColor: color + '66' }}
    >
      <div className="text-[8px] uppercase tracking-wide text-muted">{platform.short}</div>
      <div className="font-mono font-bold leading-none mt-0.5" style={{ color, fontSize: 18 }}>
        {Math.round(adjusted)}
      </div>
      <div className="text-[9px] mt-0.5" style={{ color }}>{ps.verdict}</div>
      {Number.isFinite(delta) && delta !== 0 && (
        <div className="text-[9px] font-mono mt-0.5" style={{ color: deltaColor }}>
          {delta > 0 ? '+' : ''}{delta} vs base
        </div>
      )}
    </button>
  )
}

function PlatformDetail({ platform, ps, baseScore }) {
  if (!ps) return <div className="text-[10px] text-muted italic">No score for {platform?.label}.</div>
  const adjusted = Number(ps.adjustedScore) || 0
  const delta = Number(ps.scoreAdjustment) || (adjusted - baseScore)
  const color = adjusted >= 85 ? '#2D9A5E' : adjusted >= 70 ? '#16a34a' : adjusted >= 50 ? '#d97706' : '#c0392b'
  const deltaColor = delta > 0 ? '#16a34a' : delta < 0 ? '#c0392b' : '#6b7280'
  return (
    <div className="space-y-2">
      <div
        className="border rounded p-2 flex items-center gap-3"
        style={{ borderColor: color + '66', background: color + '10' }}
      >
        <div className="text-center">
          <div className="text-[8px] uppercase tracking-wide text-muted">{platform.label}</div>
          <div className="font-mono font-bold leading-none" style={{ color, fontSize: 24 }}>
            {Math.round(adjusted)}<span className="text-[11px]">/100</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[13px]" style={{ color }}>{ps.verdict || '—'}</div>
          {Number.isFinite(delta) && delta !== 0 && (
            <div className="text-[10px] font-mono" style={{ color: deltaColor }}>
              {delta > 0 ? '+' : ''}{delta} vs base ({baseScore})
            </div>
          )}
          {/* Reels-only sub-metric. */}
          {ps.saveability != null && (
            <div className="text-[10px] text-muted">Saveability: <span className="font-mono">{Math.round(ps.saveability)}/100</span></div>
          )}
          {/* Shorts-only sub-metrics. */}
          {ps.topicClarity != null && (
            <div className="text-[10px] text-muted">Topic clarity: <span className="font-mono">{Math.round(ps.topicClarity)}/100</span></div>
          )}
          {ps.loopQuality != null && (
            <div className="text-[10px] text-muted">Loop quality: <span className="font-mono">{Math.round(ps.loopQuality)}/100</span></div>
          )}
        </div>
      </div>
      {Array.isArray(ps.strengths) && ps.strengths.length > 0 && (
        <Findings title={`✅ ${platform.short} strengths`} items={ps.strengths} accent="#2D9A5E" />
      )}
      {Array.isArray(ps.issues) && ps.issues.length > 0 && (
        <Findings title={`⚠️ ${platform.short} issues`} items={ps.issues} accent="#c0392b" />
      )}
      {Array.isArray(ps.suggestions) && ps.suggestions.length > 0 && (
        <Findings title={`✏️ ${platform.short} suggestions`} items={ps.suggestions} accent="#6C5CE7" />
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

// Single hook-channel row — shows word count, the channel's timing
// metric (read or speak), the display window, and pass/fail.
function HookChannelRow({ label, data, unitLabel, unitField }) {
  const wc = Number(data?.wordCount) || 0
  const time = Number(data?.[unitField]) || 0
  const window = Number(data?.displayDurationSec) || 0
  const fits = data?.fitsWindow !== false
  const tooLong = data?.tooLongForWindow === true
  const overlap = data?.overlapsSafeZone === true
  const text = data?.text || ''
  return (
    <div className={`text-[10px] border rounded px-2 py-1 ${fits && !tooLong ? 'bg-[#f0faf4] border-[#2D9A5E]/30' : 'bg-[#fdf2f1] border-[#c0392b]/30'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium" style={{ color: fits && !tooLong ? '#16a34a' : '#c0392b' }}>{label}</span>
        {text && <span className="text-muted italic truncate max-w-[180px]" title={text}>"{text}"</span>}
        <span className="font-mono ml-auto">
          {wc}w · {unitLabel} {time.toFixed(2)}s {window > 0 && <span className="text-muted">/ {window.toFixed(1)}s</span>}
        </span>
      </div>
      {(tooLong || overlap) && (
        <div className="text-[9px] mt-0.5 text-[#c0392b]">
          {tooLong && <div>⚠ Too long for the display window — shorten or extend the duration.</div>}
          {overlap && <div>⚠ Overlaps the platform UI safe zone — move higher.</div>}
        </div>
      )}
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
