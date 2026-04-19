import { useEffect, useState } from 'react'
import * as api from '../../api'

/**
 * HintsPanelV2 — the shared creative brief downstream tools read when
 * generating (voiceover, overlays, captions). Also the home of the
 * Hook Generator: optional, collapsible, "not every video needs one."
 *
 * Hook flow:
 *   - User toggles "This video needs a scroll-stopping hook"
 *   - Picks category + count + tone + optional extra hint
 *   - Clicks Generate → /generate/voiceover-hook returns N candidates
 *   - Picks one → applies as opening overlay text (persists to the same
 *     overlay_settings.openingText that the ffmpeg render reads). The
 *     Overlays tab can still edit it after.
 *
 * The chosen hook becomes part of the compounding context the rest of
 * the job uses on regen (opening overlay text is read by the render,
 * and the hint itself tunes caption generation).
 */
export default function HintsPanelV2({ jobSync, draftId }) {
  const [description, setDescription] = useState('')
  const [angles, setAngles] = useState('')
  const [saved, setSaved] = useState(false)

  // Hook generator state
  const [hookOn, setHookOn] = useState(false)
  const [hookCategories, setHookCategories] = useState([])
  const [hookCategory, setHookCategory] = useState('')
  const [hookCount, setHookCount] = useState(4)
  const [hookHint, setHookHint] = useState('')
  const [hookGenerating, setHookGenerating] = useState(false)
  const [hookOptions, setHookOptions] = useState([])
  const [hookErr, setHookErr] = useState(null)
  const [hookAppliedTo, setHookAppliedTo] = useState(null)

  // Load hints + seed hook context from the job on mount.
  useEffect(() => {
    if (!draftId) return
    api.getJob(draftId).then(job => {
      if (job?.hint_text) {
        const [desc, ...rest] = String(job.hint_text).split('\n---\n')
        setDescription(desc || '')
        setAngles(rest.join('\n---\n') || '')
      }
      // If an opening hook is already on the overlay, show it as "applied"
      if (job?.overlay_settings?.openingText) {
        setHookAppliedTo({ text: job.overlay_settings.openingText, from: 'existing' })
      }
    }).catch(() => {})
    api.getSettings().then(s => {
      if (Array.isArray(s?.hook_categories)) setHookCategories(s.hook_categories)
    }).catch(() => {})
  }, [draftId])

  const saveHints = async () => {
    const combined = angles.trim()
      ? `${description.trim()}\n---\n${angles.trim()}`
      : description.trim()
    try {
      await api.updateJob(draftId, { hint_text: combined })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      alert('Save failed: ' + e.message)
    }
  }

  const generateHooks = async () => {
    setHookErr(null); setHookGenerating(true); setHookOptions([])
    try {
      const fullHint = [description.trim(), angles.trim(), hookHint.trim()].filter(Boolean).join('\n\n')
      const r = await api.generateVoiceoverHook({
        hint: fullHint || 'scroll-stopping hook for this video',
        category: hookCategory || null,
        count: Number(hookCount) || 4,
        jobUuid: draftId || null,
      })
      if (r?.error) throw new Error(r.error)
      // Endpoint shape varies; normalize to [{text, family?, reason?}]
      const opts = Array.isArray(r?.options) ? r.options : Array.isArray(r) ? r : []
      setHookOptions(opts.map(o => typeof o === 'string' ? { text: o } : o))
    } catch (e) {
      setHookErr(e.message || String(e))
    } finally {
      setHookGenerating(false)
    }
  }

  // Apply a hook as the opening overlay text (0-2s). Merges with existing
  // overlay_settings so per-block durations / style / Y position survive.
  const applyAsOpening = async (opt) => {
    const text = typeof opt === 'string' ? opt : opt?.text
    if (!text) return
    try {
      const existingJob = await api.getJob(draftId)
      const existing = existingJob?.overlay_settings || {}
      const next = {
        ...existing,
        openingText: text,
        // Only set duration when not already present so we don't clobber
        // a user-chosen value.
        openingDuration: existing.openingDuration || 2.5,
      }
      jobSync?.saveOverlaySettings?.(next)
      try {
        if (typeof window !== 'undefined') {
          window._postyOverlays = next
          window.dispatchEvent(new CustomEvent('posty-overlay-change', { detail: next }))
        }
      } catch {}
      setHookAppliedTo({ text, from: 'just-applied' })
    } catch (e) {
      alert('Apply failed: ' + e.message)
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-medium">Hints — the brief downstream tools use</div>
      <div className="text-[10px] text-muted">
        Voiceover, overlays, captions all read from this. Describe the video + angles in plain language. The more you fill in, the better the AI tunes itself to this draft.
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
        <label className="text-[11px] font-medium">Angles / emphasis</label>
        <textarea
          value={angles}
          onChange={e => { setAngles(e.target.value); setSaved(false) }}
          placeholder={`- longevity — they still wear it months later\n- not a party favor, an actual signature scent\n- the group moment (5 friends, each picked their own)`}
          rows={4}
          className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y min-h-[100px] font-mono"
        />
      </div>

      <button
        onClick={saveHints}
        className={`w-full py-2 text-[11px] font-medium border-none rounded cursor-pointer ${saved ? 'bg-[#2D9A5E] text-white' : 'bg-[#6C5CE7] text-white'}`}
      >{saved ? '✓ Saved' : 'Save hints'}</button>

      {/* --- Hook generator ------------------------------------------------ */}
      <div className="border-t border-[#e5e5e5] pt-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={hookOn} onChange={e => setHookOn(e.target.checked)} />
          <span className="text-[12px] font-medium">This video needs a scroll-stopping hook</span>
        </label>
        <div className="text-[10px] text-muted mt-1 ml-6">
          Skip this when the video already opens strong or doesn't need attention engineering. When enabled, AI writes a few candidate opening lines based on everything you've entered — pick one and it lands as the opening overlay.
        </div>
      </div>

      {hookOn && (
        <div className="border border-[#e5e5e5] rounded p-3 bg-[#fafafa] space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted">Category</label>
              <select
                value={hookCategory}
                onChange={e => setHookCategory(e.target.value)}
                className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white"
              >
                <option value="">— auto (let AI decide) —</option>
                {hookCategories.map(c => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted">Options</label>
              <select
                value={hookCount}
                onChange={e => setHookCount(Number(e.target.value))}
                className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white"
              >
                <option value={3}>3 options</option>
                <option value={4}>4 options</option>
                <option value={5}>5 options</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] text-muted">Extra direction (optional)</label>
            <input
              type="text"
              value={hookHint}
              onChange={e => setHookHint(e.target.value)}
              placeholder="e.g. curiosity gap, POV-style, contrarian claim…"
              className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white"
            />
          </div>

          <button
            onClick={generateHooks}
            disabled={hookGenerating}
            className="w-full py-1.5 text-[11px] bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
          >{hookGenerating ? 'Writing hooks…' : `Generate ${hookCount} hooks`}</button>

          {hookErr && <div className="text-[10px] text-[#c0392b]">{hookErr}</div>}

          {hookOptions.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="text-[10px] text-muted">Pick one to apply as the opening overlay (0–2s of the video):</div>
              {hookOptions.map((o, i) => (
                <HookOptionRow key={i} opt={o} onApply={() => applyAsOpening(o)} />
              ))}
            </div>
          )}

          {hookAppliedTo && (
            <div className="text-[10px] text-[#2D9A5E] bg-[#f0faf4] border border-[#2D9A5E]/30 rounded p-2">
              {hookAppliedTo.from === 'existing' ? 'Current opening overlay' : '✓ Applied as opening overlay'}: <b>{hookAppliedTo.text}</b>
              <div className="text-[9px] text-muted mt-0.5 italic">Edit in the Overlays tab to tweak duration, font, color, or Y position.</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function HookOptionRow({ opt, onApply }) {
  const text = typeof opt === 'string' ? opt : opt?.text || ''
  const family = opt?.family || opt?.type || null
  const reason = opt?.reason || opt?.why || null
  const body = opt?.body || opt?.follow_up || null
  return (
    <div className="border border-[#e5e5e5] bg-white rounded p-2 space-y-1">
      <div className="text-[11px] font-medium">{text}</div>
      {body && <div className="text-[10px] text-muted italic">{body}</div>}
      <div className="flex items-center gap-1.5 text-[9px] text-muted flex-wrap">
        {family && <span className="bg-[#6C5CE7]/10 text-[#6C5CE7] rounded-full px-1.5 py-0.5">{family}</span>}
        {reason && <span className="italic">{reason}</span>}
        <button
          onClick={onApply}
          className="ml-auto text-[9px] py-0.5 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer"
        >Use as opening</button>
      </div>
    </div>
  )
}
