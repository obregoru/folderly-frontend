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

  const handleApply = async () => {
    if (!currentJob) return
    setApplying(true); setApplyErrors([]); setApplyResults(null)
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

    setApplyResults(results)
    setApplyErrors(errors)
    setApplying(false)

    // Refresh job state so other tabs show new values immediately.
    try { await jobSync?.loadJob?.(draftId) } catch { /* non-fatal */ }
    if (typeof onApplied === 'function') onApplied(results)
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
            {!applyResults && (
              <button
                type="button"
                onClick={handleApply}
                disabled={applying || loading || totalChanges === 0}
                className="text-[11px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
              >{applying ? 'Applying…' : `Apply ${totalChanges} change${totalChanges === 1 ? '' : 's'}`}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
