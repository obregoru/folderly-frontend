import { useEffect, useState } from 'react'
import * as api from '../../api'

/**
 * HintsPanelV2 — the shared creative brief. Downstream tools read this
 * when generating (voiceover, overlays, captions). Phase 4 scope:
 *   - Description field (what the video is about)
 *   - Hook angles field (what to emphasize)
 *   - Persist to job.hint_text (compatible with existing generate flows)
 *
 * Deferred to later sub-phases:
 *   - Auto-extracted frames from the merge + describe-media roundtrip
 *   - AI discussion thread
 *   - Per-video metadata hints
 */
export default function HintsPanelV2({ jobSync, draftId }) {
  const [description, setDescription] = useState('')
  const [hooks, setHooks] = useState('')
  const [saved, setSaved] = useState(false)

  // Load the current job's hint_text on mount.
  useEffect(() => {
    if (!draftId) return
    api.getJob(draftId).then(job => {
      if (job?.hint_text) {
        // Parse the combined hint: split on a marker if present so edit
        // / re-save round-trips cleanly.
        const [desc, ...rest] = String(job.hint_text).split('\n---\n')
        setDescription(desc || '')
        setHooks(rest.join('\n---\n') || '')
      }
    }).catch(() => {})
  }, [draftId])

  const save = async () => {
    const combined = hooks.trim()
      ? `${description.trim()}\n---\n${hooks.trim()}`
      : description.trim()
    try {
      await api.updateJob(draftId, { hint_text: combined })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      alert('Save failed: ' + e.message)
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-medium">Hints — the brief downstream tools use</div>
      <div className="text-[10px] text-muted">
        Voiceover, overlays, captions all read from this. Describe the video + angles in plain language.
      </div>

      <div>
        <label className="text-[11px] font-medium">What's this video about?</label>
        <textarea
          value={description}
          onChange={e => { setDescription(e.target.value); setSaved(false) }}
          placeholder="teen birthday party at a perfume studio, 5 girls making their own scents…"
          rows={4}
          className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y min-h-[80px]"
        />
      </div>

      <div>
        <label className="text-[11px] font-medium">What should hooks / captions emphasize?</label>
        <textarea
          value={hooks}
          onChange={e => { setHooks(e.target.value); setSaved(false) }}
          placeholder={`- longevity — they still wear it months later\n- not a party favor, an actual signature scent\n- the group moment (5 friends, each picked their own)`}
          rows={5}
          className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y min-h-[100px] font-mono"
        />
      </div>

      <button
        onClick={save}
        className={`w-full py-2 text-[11px] font-medium border-none rounded cursor-pointer ${saved ? 'bg-[#2D9A5E] text-white' : 'bg-[#6C5CE7] text-white'}`}
      >{saved ? '✓ Saved' : 'Save hints'}</button>

      <div className="text-[9px] text-muted italic pt-1 border-t border-[#e5e5e5]">
        Auto-frame extraction + AI chat port in a later sub-phase. For those, use <a href="/?real=1" className="text-[#6C5CE7]">the real app</a>.
      </div>
    </div>
  )
}
