// FinalPackageReview — modal that shows the parsed final-package, the
// per-section diffs against the current job, and applies the user's
// selection. Phase 4 wires the simple sections (voice, overrides,
// hooks, voiceover, overlays, channels). Media is shown as a count-only
// placeholder until Phase 5 implements applyMedia.

import { useEffect, useMemo, useState } from 'react'
import * as api from '../../api'
import {
  applyVoice, applyOverrides, applyHooks,
  applyVoiceover, applyOverlays, applyChannels,
  applyMedia, computeDiffs,
  verifyApply, applyRecommendedFontSizes, recommendFontSizes,
  generateMissingVoiceovers,
} from '../lib/finalPackageApply'

const SECTION_ORDER = [
  { key: 'voice',     label: 'Voice',     applier: applyVoice },
  { key: 'overrides', label: 'Overrides', applier: applyOverrides },
  { key: 'hooks',     label: 'Hooks',     applier: applyHooks },
  { key: 'voiceover', label: 'Voiceover', applier: applyVoiceover },
  { key: 'overlays',  label: 'Overlays',  applier: applyOverlays },
  { key: 'channels',  label: 'Channels',  applier: 'channels' }, // signature differs; handled below
  { key: 'media',     label: 'Media',     applier: 'media' },    // signature differs (needs removed[]); handled below
]

export default function FinalPackageReview({ pkg, removed, files, draftId, jobSync, onClose, onApplied }) {
  const [currentJob, setCurrentJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)
  const [enabled, setEnabled] = useState({ voice: true, overrides: true, hooks: true, voiceover: true, overlays: true, channels: true, media: true })
  const [expanded, setExpanded] = useState({})
  const [applying, setApplying] = useState(false)
  const [applyResults, setApplyResults] = useState(null)
  const [applyErrors, setApplyErrors] = useState([])
  const [progressMsg, setProgressMsg] = useState('')
  const [verifyResult, setVerifyResult] = useState(null) // { ok, mismatches[] }
  const [generationStats, setGenerationStats] = useState(null) // { generated, failed, ... }
  const [tenantSettings, setTenantSettings] = useState(null)
  // Two-step confirm when the apply will delete clips. The user
  // explicitly asked for an "are you sure" gate on destructive ops —
  // a single click takes the safe path; a clip-delete requires a
  // visible second click on a red button.
  const [confirmingDestructive, setConfirmingDestructive] = useState(false)
  // Tracks which button is mid-flight so the other one disables.
  const [mode, setMode] = useState(null) // 'apply' | 'apply-and-generate' | null

  useEffect(() => {
    api.getSettings().then(s => setTenantSettings(s || null)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!draftId) return
    let cancelled = false
    setLoading(true); setLoadErr(null)
    api.getJob(draftId).then(j => {
      if (cancelled) return
      setCurrentJob(j || null)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setLoadErr(e?.message || String(e))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [draftId])

  const diffs = useMemo(() => {
    if (!currentJob) return {}
    return computeDiffs(pkg, currentJob)
  }, [pkg, currentJob])

  const presentSections = SECTION_ORDER.filter(s => {
    if (s.key === 'media') return Array.isArray(pkg.media) && pkg.media.length > 0
    return pkg[s.key] !== undefined
  })

  const totalChanges = Object.values(diffs).reduce((acc, list) => acc + (Array.isArray(list) ? list.length : 0), 0)

  // Destructive = at least one clip will be deleted AND the user
  // didn't opt out of the media section. Opting out skips deletes
  // entirely (applyMedia returns 'skip').
  const willDeleteClips = enabled.media && Array.isArray(removed) && removed.length > 0

  // Run the per-section appliers. Shared by both buttons.
  const runApply = async () => {
    try { await jobSync?.flushPendingSave?.() } catch { /* keep going */ }
    const results = {}
    const errors = []
    const firstFileDbId = currentJob.files?.[0]?.id || null
    for (const s of presentSections) {
      if (!enabled[s.key]) { results[s.key] = 'skip'; continue }
      try {
        if (s.key === 'media') {
          results[s.key] = await applyMedia(pkg, draftId, currentJob, removed)
        } else if (s.key === 'channels') {
          results[s.key] = await applyChannels(pkg, draftId, firstFileDbId, currentJob)
        } else {
          results[s.key] = await s.applier(pkg, draftId, currentJob)
        }
      } catch (e) {
        results[s.key] = 'error'
        errors.push(`${s.label}: ${e?.message || String(e)}`)
      }
    }
    return { results, errors }
  }

  const handleApply = async () => {
    if (!currentJob) return
    setMode('apply'); setApplying(true)
    setApplyErrors([]); setApplyResults(null); setVerifyResult(null); setGenerationStats(null); setProgressMsg('')
    const { results, errors } = await runApply()
    setApplyResults(results); setApplyErrors(errors)

    // Verify everything actually persisted. The user asked us to
    // confirm, not just trust the per-section 200 response.
    setProgressMsg('Verifying changes…')
    const v = await verifyApply(pkg, draftId, removed).catch(e => ({
      ok: false,
      mismatches: [{ section: 'verify', label: 'verify call', expected: 'ok', actual: `error: ${e?.message || e}` }],
    }))
    setVerifyResult(v)
    setProgressMsg('')
    setApplying(false); setMode(null)

    // Refresh local state in all tabs.
    try { await jobSync?.loadJob?.(draftId) } catch { /* non-fatal */ }

    if (!v.ok) {
      const lines = v.mismatches.slice(0, 8).map(m => `• ${m.section}.${m.label}: expected "${m.expected}", got "${m.actual}"`)
      const more = v.mismatches.length > 8 ? `\n…and ${v.mismatches.length - 8} more` : ''
      alert(`Apply verification FAILED for ${v.mismatches.length} field${v.mismatches.length === 1 ? '' : 's'}:\n\n${lines.join('\n')}${more}\n\nReview the modal for which sections didn't land.`)
    }

    const summary = buildApplySummary(results, diffs, removed) + (v.ok ? '' : ` · ⚠ ${v.mismatches.length} verify mismatch(es)`)
    try {
      window.dispatchEvent(new CustomEvent('posty-final-package-applied', {
        detail: { draftId, results, summary, verified: v.ok },
      }))
    } catch {}
    if (typeof onApplied === 'function') onApplied(results, summary)
  }

  // Apply + verify + recommend & set font sizes + generate any missing
  // voiceover audio. Runs sequentially so the popup error path can
  // bail at the first concrete failure (apply → verify → fonts → tts).
  // Skips merge regeneration for now — flagged as a TODO.
  const handleApplyAndGenerate = async () => {
    if (!currentJob) return
    setMode('apply-and-generate'); setApplying(true)
    setApplyErrors([]); setApplyResults(null); setVerifyResult(null); setGenerationStats(null); setProgressMsg('Applying sections…')

    const { results, errors } = await runApply()
    setApplyResults(results); setApplyErrors(errors)

    setProgressMsg('Verifying changes…')
    const v = await verifyApply(pkg, draftId, removed).catch(e => ({
      ok: false,
      mismatches: [{ section: 'verify', label: 'verify call', expected: 'ok', actual: `error: ${e?.message || e}` }],
    }))
    setVerifyResult(v)
    if (!v.ok) {
      setProgressMsg(''); setApplying(false); setMode(null)
      try { await jobSync?.loadJob?.(draftId) } catch {}
      const lines = v.mismatches.slice(0, 8).map(m => `• ${m.section}.${m.label}: expected "${m.expected}", got "${m.actual}"`)
      alert(`Apply verification FAILED — skipping voice generation.\n\n${lines.join('\n')}\n\nFix the failing sections in the modal and try again.`)
      return
    }

    // Re-fetch the job AFTER apply+verify so font/TTS steps see the
    // freshest state (segments have new ids, captions have new text).
    setProgressMsg('Refreshing job state…')
    let freshJob = currentJob
    try { freshJob = await api.getJob(draftId) || currentJob } catch {}

    setProgressMsg('Setting recommended font sizes…')
    let fontRec = null
    try {
      fontRec = await applyRecommendedFontSizes(pkg, draftId, freshJob)
    } catch (e) {
      console.warn('[apply+gen] font sizes failed:', e?.message)
    }

    setProgressMsg('Generating voiceover audio…')
    let genStats = { generated: 0, failed: 0, skipped: 0 }
    try {
      // Re-fetch so applyRecommendedFontSizes hasn't stale-poisoned us.
      let freshJob2 = freshJob
      try { freshJob2 = await api.getJob(draftId) || freshJob } catch {}
      genStats = await generateMissingVoiceovers(
        draftId, freshJob2, tenantSettings,
        (msg) => setProgressMsg(msg),
      )
    } catch (e) {
      console.error('[apply+gen] tts failed:', e?.message)
      genStats = { generated: 0, failed: -1, skipped: 0, error: e?.message }
    }
    setGenerationStats(genStats)

    setProgressMsg('')
    setApplying(false); setMode(null)

    try { await jobSync?.loadJob?.(draftId) } catch {}

    const mediaChangedFlag = Array.isArray(pkg.media) && pkg.media.length > 0
    const summary = buildApplySummary(results, diffs, removed)
      + (fontRec?.captionBase ? ` · captions ${fontRec.captionBase}px` : '')
      + (Object.keys(fontRec?.overlays || {}).length > 0 ? ` · overlay sizes set` : '')
      + (genStats.generated > 0 ? ` · ${genStats.generated} voice${genStats.generated === 1 ? '' : 's'} generated` : '')
      + (genStats.failed > 0 ? ` · ⚠ ${genStats.failed} TTS failed` : '')
      + (genStats.error ? ` · ⚠ ${genStats.error}` : '')
      + (mediaChangedFlag ? ' · ⚠ media changed — re-merge in Merge tab' : '')

    try {
      window.dispatchEvent(new CustomEvent('posty-final-package-applied', {
        detail: { draftId, results, summary, verified: true, generated: genStats },
      }))
    } catch {}
    if (typeof onApplied === 'function') onApplied(results, summary)

    // If TTS had errors, surface a popup so the user knows
    if (genStats.error) {
      alert(`Voiceover generation issue: ${genStats.error}`)
    } else if (genStats.failed > 0) {
      alert(`${genStats.failed} voiceover segment(s) failed to generate. Check the Voiceover tab to retry individually.`)
    }
    if (mediaChangedFlag) {
      alert('Media was changed by the package. Re-merge in the Merge tab so the voiceover bakes against the new clip order.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-2xl w-full max-w-[700px] max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#e5e5e5]">
          <span className="text-[16px]">📦</span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium">Review final package</div>
            <div className="text-[10px] text-muted">
              {loading ? 'Loading current draft…' : `${totalChanges} field${totalChanges === 1 ? '' : 's'} will change across ${presentSections.length} section${presentSections.length === 1 ? '' : 's'}`}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] py-1 px-2 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
          >✕ Close</button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && <div className="text-[12px] text-muted italic text-center py-12">Loading current draft state…</div>}
          {loadErr && <div className="text-[11px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2">{loadErr}</div>}

          {!loading && presentSections.map(s => {
            const sectionDiffs = diffs[s.key] || []
            const isMedia = s.key === 'media'
            const removedCount = isMedia ? (removed?.length || 0) : 0
            const totalForSection = sectionDiffs.length + (isMedia ? removedCount : 0)
            const isExpanded = !!expanded[s.key] || isMedia // media is always expanded — destructive ops need full visibility
            return (
              <div key={s.key} className={`border rounded p-2 ${isMedia && removedCount > 0 ? 'border-[#c0392b]/50 bg-[#fdf2f1]' : 'border-[#e5e5e5]'}`}>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={!!enabled[s.key]}
                      onChange={e => setEnabled(prev => ({ ...prev, [s.key]: e.target.checked }))}
                      className="cursor-pointer"
                    />
                    <span className="text-[12px] font-medium">{s.label}</span>
                    <span className="text-[10px] text-muted">{totalForSection} change{totalForSection === 1 ? '' : 's'}</span>
                    {isMedia && removedCount > 0 && (
                      <span className="text-[10px] text-[#c0392b] bg-white border border-[#c0392b]/40 px-1.5 py-0.5 rounded font-medium">
                        ⚠ {removedCount} clip{removedCount === 1 ? '' : 's'} will be DELETED
                      </span>
                    )}
                  </label>
                  {!isMedia && sectionDiffs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpanded(prev => ({ ...prev, [s.key]: !prev[s.key] }))}
                      className="text-[10px] text-[#6C5CE7] bg-white border border-[#6C5CE7]/40 rounded py-0.5 px-1.5 cursor-pointer"
                    >{isExpanded ? 'Hide' : 'Show'}</button>
                  )}
                  {applyResults && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      applyResults[s.key] === 'ok' ? 'bg-[#2D9A5E] text-white'
                      : applyResults[s.key] === 'error' ? 'bg-[#c0392b] text-white'
                      : 'bg-[#e5e5e5] text-muted'
                    }`}>{applyResults[s.key] || ''}</span>
                  )}
                </div>
                {isExpanded && (sectionDiffs.length > 0 || (isMedia && removedCount > 0)) && (
                  <div className="mt-2 pt-2 border-t border-[#e5e5e5]/70 space-y-1">
                    {sectionDiffs.map((d, i) => (
                      <div key={i} className="text-[10px] flex items-start gap-1.5 flex-wrap">
                        <span className="font-mono text-muted shrink-0">{d.label}</span>
                        <span className="text-[#c0392b] line-through break-all">{String(d.before)}</span>
                        <span className="text-muted">→</span>
                        <span className="text-[#2D9A5E] break-all">{String(d.after)}</span>
                      </div>
                    ))}
                    {isMedia && removedCount > 0 && (
                      <div className="mt-1 pt-1 border-t border-[#c0392b]/30">
                        <div className="text-[10px] text-[#c0392b] font-medium mb-0.5">Will be deleted:</div>
                        {removed.map((f, i) => (
                          <div key={i} className="text-[10px] text-[#c0392b]">
                            • clip-{f._dbFileId} {f.file?.name || f._filename || '(no name)'}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {applyErrors.length > 0 && (
            <div className="text-[10px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2 space-y-1">
              {applyErrors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[#e5e5e5] flex items-center justify-between">
          <span className="text-[10px] text-muted italic">
            {applyResults ? 'Applied. Tabs reload automatically.' : 'You can opt out of any section above before applying.'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] py-1.5 px-3 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
            >{applyResults ? 'Done' : 'Cancel'}</button>
            {!applyResults && !willDeleteClips && (
              <>
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={applying || loading || totalChanges === 0}
                  className="text-[11px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
                  title="Apply the package and verify each section persisted. Doesn't generate audio or set font sizes."
                >{mode === 'apply' ? (progressMsg || 'Applying…') : `Apply ${totalChanges} change${totalChanges === 1 ? '' : 's'}`}</button>
                <button
                  type="button"
                  onClick={handleApplyAndGenerate}
                  disabled={applying || loading || totalChanges === 0}
                  className="text-[11px] py-1.5 px-3 bg-gradient-to-r from-[#6C5CE7] to-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
                  title="Apply + verify, set recommended font sizes for overlays and captions, then generate TTS audio for any voiceover segment that doesn't have audio yet."
                >{mode === 'apply-and-generate' ? (progressMsg || 'Working…') : `⚡ Apply & generate`}</button>
              </>
            )}
            {!applyResults && willDeleteClips && !confirmingDestructive && (
              <button
                type="button"
                onClick={() => setConfirmingDestructive(true)}
                disabled={applying || loading || totalChanges === 0}
                className="text-[11px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
              >{`Apply ${totalChanges} change${totalChanges === 1 ? '' : 's'} (deletes clips)`}</button>
            )}
            {!applyResults && willDeleteClips && confirmingDestructive && (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmingDestructive(false)}
                  className="text-[11px] py-1.5 px-3 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
                >Back</button>
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={applying}
                  className="text-[11px] py-1.5 px-3 bg-[#c0392b] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
                  title={`Will delete ${removed.length} clip${removed.length === 1 ? '' : 's'} that aren't in the package`}
                >{mode === 'apply' ? (progressMsg || 'Applying…') : `⚠ Confirm: delete ${removed.length} clip${removed.length === 1 ? '' : 's'} & apply`}</button>
                <button
                  type="button"
                  onClick={handleApplyAndGenerate}
                  disabled={applying}
                  className="text-[11px] py-1.5 px-3 bg-gradient-to-r from-[#c0392b] to-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
                  title="Confirm delete + apply + generate audio + set font sizes"
                >{mode === 'apply-and-generate' ? (progressMsg || 'Working…') : `⚠ Confirm & generate`}</button>
              </>
            )}
          </div>
        </div>

        {/* Verify mismatches — surface in the modal too, not just the popup,
            so the user can keep them visible while reviewing. */}
        {verifyResult && !verifyResult.ok && (
          <div className="px-4 py-3 border-t border-[#c0392b]/30 bg-[#fdf2f1] space-y-1">
            <div className="text-[11px] font-semibold text-[#c0392b]">⚠ Verification failed for {verifyResult.mismatches.length} field(s):</div>
            {verifyResult.mismatches.slice(0, 8).map((m, i) => (
              <div key={i} className="text-[10px] text-[#c0392b]">
                <span className="font-mono">{m.section}.{m.label}</span> — expected <b>"{String(m.expected).slice(0, 60)}"</b>, got <b>"{String(m.actual).slice(0, 60)}"</b>
              </div>
            ))}
            {verifyResult.mismatches.length > 8 && (
              <div className="text-[10px] text-[#c0392b] italic">…and {verifyResult.mismatches.length - 8} more</div>
            )}
          </div>
        )}
        {generationStats && (
          <div className="px-4 py-2 border-t border-[#e5e5e5] bg-[#f0faf4] text-[10px] text-[#0a4d2c]">
            ⚡ Generated {generationStats.generated} voice{generationStats.generated === 1 ? '' : 's'}
            {generationStats.failed > 0 ? ` · ${generationStats.failed} failed` : ''}
            {generationStats.error ? ` · ${generationStats.error}` : ''}
          </div>
        )}
      </div>
    </div>
  )
}

// Compose a one-line "✓ Applied: 3 VO segments, 2 overlays, 4 clips
// reordered, 1 removed" the chat panel echoes after a successful
// apply. Skipped + errored sections appear with their own markers.
function buildApplySummary(results, diffs, removed) {
  const parts = []
  for (const [key, status] of Object.entries(results || {})) {
    if (status !== 'ok') continue
    if (key === 'voiceover' && Array.isArray(diffs.voiceover) && diffs.voiceover.length > 0) {
      parts.push('voiceover')
    } else if (key === 'overlays' && Array.isArray(diffs.overlays) && diffs.overlays.length > 0) {
      parts.push(`${diffs.overlays.length} overlay change${diffs.overlays.length === 1 ? '' : 's'}`)
    } else if (key === 'media' && Array.isArray(diffs.media)) {
      const reorderCount = diffs.media.filter(d => d.label === 'order').length
      const otherCount = diffs.media.length - reorderCount
      const removedCount = removed?.length || 0
      const bits = []
      if (reorderCount > 0) bits.push('reordered clips')
      if (otherCount > 0) bits.push(`${otherCount} clip edit${otherCount === 1 ? '' : 's'}`)
      if (removedCount > 0) bits.push(`${removedCount} removed`)
      if (bits.length > 0) parts.push(bits.join(', '))
    } else if (key === 'channels' && Array.isArray(diffs.channels) && diffs.channels.length > 0) {
      parts.push(`${diffs.channels.length} channel field${diffs.channels.length === 1 ? '' : 's'}`)
    } else if (key === 'voice' || key === 'overrides' || key === 'hooks') {
      const list = diffs[key]
      if (Array.isArray(list) && list.length > 0) parts.push(key)
    }
  }
  const errored = Object.entries(results || {}).filter(([, s]) => s === 'error').map(([k]) => k)
  let summary = parts.length > 0 ? `✓ Applied: ${parts.join(', ')}` : '✓ No changes applied (all sections opted out)'
  if (errored.length > 0) summary += ` · ⚠ Errors: ${errored.join(', ')}`
  return summary
}
