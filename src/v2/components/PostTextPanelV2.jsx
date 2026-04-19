import { useEffect, useState } from 'react'
import * as api from '../../api'

/**
 * PostTextPanelV2 — per-platform post body text (caption / description).
 * Each platform gets its own tab; edits save per-file on blur using the
 * existing captions JSONB column (so real app + v2 share the same state).
 *
 * Phase 4 scope:
 *   - Read existing captions from the first file of the current job
 *   - Per-platform edit in textareas
 *   - Save on blur via updateJobFile
 *   - "Generate with AI" links back to ?real=1 for now
 *
 * Deferred: in-panel generation, per-platform AI review, humanize,
 * per-channel overrides.
 */

const PLATFORMS = [
  { key: 'tiktok',    label: 'TikTok' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook',  label: 'Facebook' },
  { key: 'youtube',   label: 'YouTube' },
  { key: 'blog',      label: 'Blog' },
  { key: 'google',    label: 'GBP' },
]

export default function PostTextPanelV2({ jobSync, draftId, files }) {
  const [active, setActive] = useState('tiktok')
  const [captions, setCaptions] = useState({})
  const [saving, setSaving] = useState(false)
  const [firstFileDbId, setFirstFileDbId] = useState(null)

  useEffect(() => {
    if (!draftId) return
    api.getJob(draftId).then(job => {
      const f0 = job?.files?.[0]
      if (f0) {
        setFirstFileDbId(f0.id)
        const caps = f0.captions && typeof f0.captions === 'object' ? f0.captions : {}
        setCaptions(caps)
      }
    }).catch(() => {})
  }, [draftId])

  const update = (key, value) => setCaptions(prev => ({ ...prev, [key]: value }))

  const persistOnBlur = async () => {
    if (!draftId || !firstFileDbId) return
    setSaving(true)
    try {
      await api.updateJobFile(draftId, firstFileDbId, { captions })
    } catch (e) {
      console.warn('[PostTextV2] save failed:', e.message)
    }
    setSaving(false)
  }

  const current = captions[active] || ''
  const currentIsObject = active === 'youtube' || active === 'blog'
  const currentText = typeof current === 'string'
    ? current
    : (current?.text || current?.description || '')

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">Post text (per platform)</div>
        {saving && <span className="text-[9px] text-muted">Saving…</span>}
      </div>

      <div className="flex items-center gap-1 overflow-x-auto border-b border-[#e5e5e5]">
        {PLATFORMS.map(p => (
          <button
            key={p.key}
            onClick={() => setActive(p.key)}
            className={`text-[10px] py-1.5 px-2.5 border-none cursor-pointer whitespace-nowrap border-b-2 ${active === p.key ? 'border-[#6C5CE7] text-[#6C5CE7] font-medium' : 'border-transparent text-muted bg-transparent'}`}
          >{p.label}</button>
        ))}
      </div>

      <div className="space-y-2">
        {/* Title row for YouTube / Blog */}
        {currentIsObject && (
          <input
            type="text"
            value={current?.title || ''}
            onChange={e => update(active, { ...(typeof current === 'object' ? current : {}), title: e.target.value })}
            onBlur={persistOnBlur}
            placeholder={`${PLATFORMS.find(p => p.key === active)?.label} title`}
            className="w-full text-[12px] font-medium border border-[#e5e5e5] rounded p-2 bg-white"
          />
        )}

        <textarea
          value={currentText}
          onChange={e => {
            if (currentIsObject) {
              const field = active === 'youtube' ? 'description' : 'text'
              update(active, { ...(typeof current === 'object' ? current : {}), [field]: e.target.value })
            } else {
              update(active, e.target.value)
            }
          }}
          onBlur={persistOnBlur}
          placeholder={`${PLATFORMS.find(p => p.key === active)?.label} caption…`}
          rows={8}
          className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y min-h-[140px]"
        />

        <div className="text-[9px] text-muted flex items-center gap-2">
          <span>{currentText.length} characters</span>
          {active === 'tiktok' && <span className="ml-auto">TikTok cap: 2,200</span>}
          {active === 'instagram' && <span className="ml-auto">Instagram cap: 2,200</span>}
        </div>
      </div>

      <div className="border-t border-[#e5e5e5] pt-2 flex flex-col gap-1.5">
        <div className="text-[10px] text-muted italic">
          AI generation runs from the real app for now — reads the same Hints + captions so it round-trips cleanly.
        </div>
        <a
          href="/?real=1"
          className="text-[10px] py-1.5 px-3 bg-[#6C5CE7] text-white rounded text-center no-underline inline-block"
        >Generate with AI in real app →</a>
      </div>
    </div>
  )
}
