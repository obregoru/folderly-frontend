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
const TONE_OPTIONS = [
  { v: '',             label: '— use tenant default —' },
  { v: 'warm',         label: 'Warm' },
  { v: 'playful',      label: 'Playful' },
  { v: 'professional', label: 'Professional' },
  { v: 'edgy',         label: 'Edgy' },
  { v: 'inspirational', label: 'Inspirational' },
  { v: 'minimalist',   label: 'Minimalist' },
]
const POV_OPTIONS = [
  { v: '',                label: '— use tenant default —' },
  { v: 'first_person',    label: 'First person (I / we)' },
  { v: 'second_person',   label: 'Second person (you)' },
  { v: 'third_person',    label: 'Third person (they)' },
  { v: 'brand_voice',     label: 'Brand voice' },
]
const MARKETING_OPTIONS = [
  { v: '',          label: '— use tenant default —' },
  { v: 'subtle',    label: 'Subtle' },
  { v: 'balanced',  label: 'Balanced' },
  { v: 'high',      label: 'High-pressure' },
]

export default function HintsPanelV2({ jobSync, draftId, settings }) {
  const [description, setDescription] = useState('')
  const [angles, setAngles] = useState('')
  const [saved, setSaved] = useState(false)
  const [secondOpinion, setSecondOpinion] = useState('')
  const [soSaving, setSoSaving] = useState(false)
  const [soSaved, setSoSaved] = useState(false)
  // Per-job voice overrides (stored under job.generation_rules JSONB)
  const [jobTone, setJobTone] = useState('')
  const [jobPov, setJobPov] = useState('')
  const [jobMarketing, setJobMarketing] = useState('')
  const [jobOffTopic, setJobOffTopic] = useState(false)
  const [voiceSaving, setVoiceSaving] = useState(false)
  const [voiceSaved, setVoiceSaved] = useState(false)

  // Override tenant defaults (this draft only). All optional — blank
  // means inherit. Stored under job.generation_rules.overrides.
  const [ovOpen, setOvOpen] = useState(false)
  const [ovKeyInsights, setOvKeyInsights] = useState('')
  const [ovAudienceNotes, setOvAudienceNotes] = useState('')
  const [ovPostingStyle, setOvPostingStyle] = useState('')
  const [ovSeoKeywords, setOvSeoKeywords] = useState('')
  const [ovHashtagsAll, setOvHashtagsAll] = useState('')
  const [ovSaving, setOvSaving] = useState(false)
  const [ovSaved, setOvSaved] = useState(false)

  // Hook generator state
  const [hookOn, setHookOn] = useState(false)
  const [hookCategories, setHookCategories] = useState([])
  const [hookCategory, setHookCategory] = useState('')
  const [hookCount, setHookCount] = useState(4)
  // "Raw" mode skips brand voice / tone / key insights / vocabulary
  // and asks the model for the most TikTok-native scroll-stopping
  // hooks possible. Useful when the brand's polite tone is washing
  // out the hook strength. Off by default so existing flows behave
  // identically.
  const [hookRawMode, setHookRawMode] = useState(false)
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
      if (typeof job?.second_opinion === 'string') setSecondOpinion(job.second_opinion)
      const voice = job?.generation_rules?.voice || {}
      setJobTone(voice.tone || '')
      setJobPov(voice.pov || '')
      setJobMarketing(voice.marketing_intensity || '')
      setJobOffTopic(!!job?.generation_rules?.off_topic)
      const ov = job?.generation_rules?.overrides || {}
      setOvKeyInsights(ov.key_insights || '')
      setOvAudienceNotes(ov.audience_notes || '')
      setOvPostingStyle(ov.posting_style || '')
      setOvSeoKeywords(ov.seo_keywords || '')
      setOvHashtagsAll(ov.default_hashtags_all || '')
      // Hydrate saved hook-section state (toggle, picker values, generated
      // options, which one was applied) so everything comes back on reload.
      const hk = job?.generation_rules?.hooks || {}
      setHookOn(!!hk.enabled)
      if (hk.category) setHookCategory(hk.category)
      if (hk.count) setHookCount(Number(hk.count) || 4)
      if (typeof hk.hint === 'string') setHookHint(hk.hint)
      if (Array.isArray(hk.options) && hk.options.length > 0) setHookOptions(hk.options)
      if (hk.selected && (hk.selected.text || typeof hk.selected === 'string')) {
        setHookAppliedTo({ text: hk.selected.text || hk.selected, from: 'saved' })
      } else if (job?.overlay_settings?.openingText) {
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

  const saveSecondOpinion = async () => {
    setSoSaving(true)
    try {
      await api.updateJob(draftId, { second_opinion: secondOpinion })
      setSoSaved(true)
      setTimeout(() => setSoSaved(false), 2000)
    } catch (e) {
      alert('Save failed: ' + e.message)
    } finally {
      setSoSaving(false)
    }
  }
  const clearSecondOpinion = async () => {
    setSecondOpinion('')
    try { await api.updateJob(draftId, { second_opinion: '' }) } catch {}
  }

  // Merge-preserving save of the whole generation_rules blob so voice,
  // off_topic, overrides, and hooks don't clobber each other.
  const saveGenerationRules = async (patch) => {
    if (!draftId) return
    const existingJob = await api.getJob(draftId)
    const existing = existingJob?.generation_rules || {}
    const next = { ...existing, ...patch }
    await api.updateJob(draftId, { generation_rules: next })
  }

  // Save just the hooks sub-object, preserving other keys on it.
  const saveHooks = async (partial) => {
    if (!draftId) return
    try {
      const existingJob = await api.getJob(draftId)
      const existing = existingJob?.generation_rules || {}
      const currentHooks = existing.hooks || {}
      const nextHooks = { ...currentHooks, ...partial }
      await api.updateJob(draftId, { generation_rules: { ...existing, hooks: nextHooks } })
    } catch (e) {
      console.warn('[HintsPanelV2] saveHooks failed:', e.message)
    }
  }

  const saveVoice = async () => {
    setVoiceSaving(true)
    try {
      const voice = {}
      if (jobTone)      voice.tone = jobTone
      if (jobPov)       voice.pov = jobPov
      if (jobMarketing) voice.marketing_intensity = jobMarketing
      await saveGenerationRules({ voice, off_topic: !!jobOffTopic })
      setVoiceSaved(true)
      setTimeout(() => setVoiceSaved(false), 2000)
    } catch (e) {
      alert('Save failed: ' + e.message)
    } finally {
      setVoiceSaving(false)
    }
  }

  const saveOverrides = async () => {
    setOvSaving(true)
    try {
      const overrides = {}
      if (ovKeyInsights.trim())   overrides.key_insights = ovKeyInsights
      if (ovAudienceNotes.trim()) overrides.audience_notes = ovAudienceNotes
      if (ovPostingStyle.trim())  overrides.posting_style = ovPostingStyle
      if (ovSeoKeywords.trim())   overrides.seo_keywords = ovSeoKeywords
      if (ovHashtagsAll.trim())   overrides.default_hashtags_all = ovHashtagsAll
      await saveGenerationRules({ overrides })
      setOvSaved(true)
      setTimeout(() => setOvSaved(false), 2000)
    } catch (e) {
      alert('Save failed: ' + e.message)
    } finally {
      setOvSaving(false)
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
        rawMode: hookRawMode,
      })
      if (r?.error) throw new Error(r.error)
      // Endpoint shape varies; normalize to [{text, family?, reason?}]
      const opts = Array.isArray(r?.options) ? r.options : Array.isArray(r) ? r : []
      const normalized = opts.map(o => typeof o === 'string' ? { text: o } : o)
      setHookOptions(normalized)
      // Persist the generated options so a reload brings them back.
      saveHooks({
        enabled: true,
        category: hookCategory || null,
        count: Number(hookCount) || 4,
        hint: hookHint || '',
        options: normalized,
      })
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
      // Persist which option was selected so reload shows "applied as opening".
      saveHooks({ selected: typeof opt === 'string' ? { text: opt } : opt })
    } catch (e) {
      alert('Apply failed: ' + e.message)
    }
  }

  // Persist the toggle + picker state whenever it changes. No debounce —
  // these are single taps / selects, and updateJob is a cheap PUT.
  const toggleHookOn = (on) => {
    setHookOn(on)
    saveHooks({ enabled: on })
  }
  const changeHookCategory = (cat) => {
    setHookCategory(cat)
    saveHooks({ category: cat || null })
  }
  const changeHookCount = (n) => {
    setHookCount(n)
    saveHooks({ count: n })
  }
  const commitHookHint = () => {
    // Called on blur — avoid per-keystroke saves for a text field.
    saveHooks({ hint: hookHint || '' })
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

      {/* --- Voice & tone (this draft only) --- */}
      <div className="border-t border-[#e5e5e5] pt-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-[12px] font-medium flex-1">Voice & tone for this draft</div>
          {(jobTone || jobPov || jobMarketing || jobOffTopic) && (
            <span className="text-[9px] bg-[#6C5CE7]/10 text-[#6C5CE7] border border-[#6C5CE7]/30 rounded-full px-2 py-0.5">override on</span>
          )}
        </div>
        <div className="text-[10px] text-muted">
          Overrides the tenant defaults (<span className="font-mono">{settings?.default_tone || 'warm'}</span> · <span className="font-mono">{settings?.default_pov || 'first_person'}</span> · <span className="font-mono">{settings?.marketing_intensity || 'balanced'}</span>) for this draft only. Leave a field on "tenant default" to inherit.
        </div>

        <label className={`flex items-start gap-2 border rounded p-2 cursor-pointer ${jobOffTopic ? 'border-[#d97706]/40 bg-[#fef3c7]' : 'border-[#e5e5e5] bg-white'}`}>
          <input type="checkbox" checked={jobOffTopic} onChange={e => setJobOffTopic(e.target.checked)} className="mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-medium">This draft is off-topic (unrelated to my business)</div>
            <div className="text-[9px] text-muted mt-0.5">
              Lifts brand rules, CTAs, SEO, and hashtag requirements. Use when reviewing another business, sharing something from the neighborhood, or posting anything that shouldn't loop back to <span className="font-mono">{settings?.name || 'your tenant'}</span>.
            </div>
          </div>
        </label>

        <div className="grid grid-cols-1 gap-2">
          <VoiceField label="Tone" value={jobTone} onChange={setJobTone} options={TONE_OPTIONS} />
          <VoiceField label="Point of view" value={jobPov} onChange={setJobPov} options={POV_OPTIONS} />
          <VoiceField label="Marketing intensity" value={jobMarketing} onChange={setJobMarketing} options={MARKETING_OPTIONS} />
        </div>
        <button
          onClick={saveVoice}
          disabled={voiceSaving}
          className={`w-full py-1.5 text-[11px] font-medium border-none rounded cursor-pointer disabled:opacity-50 ${voiceSaved ? 'bg-[#2D9A5E] text-white' : 'bg-[#6C5CE7] text-white'}`}
        >{voiceSaving ? 'Saving…' : (voiceSaved ? '✓ Saved' : 'Save voice for this draft')}</button>
      </div>

      {/* --- Override tenant defaults for this draft --- */}
      <div className="border-t border-[#e5e5e5] pt-3">
        <button
          onClick={() => setOvOpen(v => !v)}
          className="w-full flex items-center gap-2 bg-transparent border-none cursor-pointer p-0 text-left"
        >
          <div className="text-[12px] font-medium flex-1">Override defaults (this draft)</div>
          {(ovKeyInsights || ovAudienceNotes || ovPostingStyle || ovSeoKeywords || ovHashtagsAll) && (
            <span className="text-[9px] bg-[#6C5CE7]/10 text-[#6C5CE7] border border-[#6C5CE7]/30 rounded-full px-2 py-0.5">override on</span>
          )}
          <span className="text-[12px] text-muted">{ovOpen ? '▾' : '▸'}</span>
        </button>
        <div className="text-[10px] text-muted mt-1">
          Tune tenant-level fields just for this draft. Blank = inherit from tenant settings.
        </div>

        {ovOpen && (
          <div className="space-y-2 mt-2">
            <OverrideField
              label="Key insights"
              value={ovKeyInsights}
              onChange={setOvKeyInsights}
              tenantValue={settings?.key_insights}
              placeholder="What's the most important thing the AI should know about this specific draft?"
              rows={3}
            />
            <OverrideField
              label="Audience notes"
              value={ovAudienceNotes}
              onChange={setOvAudienceNotes}
              tenantValue={settings?.audience_notes}
              placeholder="Who specifically is this draft for?"
              rows={3}
            />
            <OverrideField
              label="Posting style"
              value={ovPostingStyle}
              onChange={setOvPostingStyle}
              tenantValue={settings?.posting_style}
              placeholder="Style guide — sentence length, punctuation, emoji usage, etc."
              rows={3}
            />
            <OverrideField
              label="SEO keywords"
              value={ovSeoKeywords}
              onChange={setOvSeoKeywords}
              tenantValue={settings?.seo_keywords}
              placeholder="Comma-separated keywords for this draft"
              rows={2}
            />
            <OverrideField
              label="Default hashtags (all platforms)"
              value={ovHashtagsAll}
              onChange={setOvHashtagsAll}
              tenantValue={settings?.default_hashtags_all}
              placeholder="#hashtag1 #hashtag2 #hashtag3"
              rows={2}
            />
            <button
              onClick={saveOverrides}
              disabled={ovSaving}
              className={`w-full py-1.5 text-[11px] font-medium border-none rounded cursor-pointer disabled:opacity-50 ${ovSaved ? 'bg-[#2D9A5E] text-white' : 'bg-[#6C5CE7] text-white'}`}
            >{ovSaving ? 'Saving…' : (ovSaved ? '✓ Saved' : 'Save overrides for this draft')}</button>
            <div className="text-[9px] text-muted italic">
              Hashtag sets, SEO keyword sets, and hook categories are picker-style (tenant-level) — per-job picker ports in a follow-up.
            </div>
          </div>
        )}
      </div>

      {/* --- Second opinion (pasted critique from another AI) --- */}
      <div className="border-t border-[#e5e5e5] pt-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-[12px] font-medium flex-1">Second opinion</div>
          {secondOpinion.trim().length > 0 && (
            <span className="text-[9px] bg-[#fef3c7] text-[#92400e] border border-[#d97706]/40 rounded-full px-2 py-0.5">on file</span>
          )}
        </div>
        <div className="text-[10px] text-muted">
          Pasted critique from another AI (ChatGPT, Gemini, etc). Save it here, then hit <b>Regenerate with critique</b> in the Captions or Channels tab to apply it explicitly — regular generates stay untouched so you control when the critique tunes the output.
        </div>
        <textarea
          value={secondOpinion}
          onChange={e => { setSecondOpinion(e.target.value); setSoSaved(false) }}
          placeholder={`Paste here:\n\n"The caption is too generic. Consider leading with the specific moment..."\n"Remove the hashtag cluster — breaks the voice."\n"The hook assumes knowledge the viewer doesn't have."`}
          rows={6}
          className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y min-h-[120px]"
        />
        <div className="flex gap-1.5">
          <button
            onClick={saveSecondOpinion}
            disabled={soSaving}
            className={`flex-1 py-1.5 text-[11px] font-medium border-none rounded cursor-pointer disabled:opacity-50 ${soSaved ? 'bg-[#2D9A5E] text-white' : 'bg-[#6C5CE7] text-white'}`}
          >{soSaving ? 'Saving…' : (soSaved ? '✓ Saved' : 'Save critique')}</button>
          {secondOpinion && (
            <button
              onClick={clearSecondOpinion}
              className="py-1.5 px-3 text-[10px] border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
            >Clear</button>
          )}
        </div>
        <div className="text-[9px] text-muted italic">
          Flow: generate → copy the interaction from <span className="font-mono">🤖</span> log → paste into ChatGPT/Gemini for a critique → paste their reply here → go to Captions/Channels and click <b>Regenerate with critique</b>. The critique stays attached to this draft until you clear it.
        </div>
      </div>

      {/* --- Hook generator ------------------------------------------------ */}
      <div className="border-t border-[#e5e5e5] pt-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={hookOn} onChange={e => toggleHookOn(e.target.checked)} />
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
                onChange={e => changeHookCategory(e.target.value)}
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
                onChange={e => changeHookCount(Number(e.target.value))}
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
              onBlur={commitHookHint}
              placeholder="e.g. curiosity gap, POV-style, contrarian claim…"
              className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white"
            />
          </div>

          <label
            className={`flex items-start gap-2 border rounded p-2 cursor-pointer ${hookRawMode ? 'border-[#6C5CE7]/40 bg-[#f3f0ff]' : 'border-[#e5e5e5] bg-white'}`}
            title="When ON: ignore brand tone / rules / insights / vocabulary and write the most TikTok-native, scroll-stopping hooks based on the visual content alone."
          >
            <input
              type="checkbox"
              checked={hookRawMode}
              onChange={e => setHookRawMode(e.target.checked)}
              className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium">Raw TikTok mode</div>
              <div className="text-[9px] text-muted mt-0.5">
                Skip brand tone / rules / insights / vocabulary. Generate hooks based on proven TikTok hook patterns + the video content only — when the polished brand voice is washing out the hook strength.
              </div>
            </div>
          </label>

          <button
            onClick={generateHooks}
            disabled={hookGenerating}
            className="w-full py-1.5 text-[11px] bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
          >{hookGenerating ? 'Writing hooks…' : `Generate ${hookCount} hooks${hookRawMode ? ' (raw)' : ''}`}</button>

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
  const reason = opt?.rationale || opt?.reason || opt?.why || null
  const body = opt?.body || opt?.follow_up || null
  const overall = typeof opt?.overall === 'number' ? opt.overall : null
  const scores = opt?.scores || null
  const bestUse = opt?.bestUse || null
  // Color the strength badge against the same 0-3 / 4-6 / 7-10 anchors
  // the rubric uses, so users instantly know if a hook would actually
  // pass the analyzer.
  const strengthColor = overall == null ? '#7A756F'
    : overall >= 8 ? '#2D9A5E'
    : overall >= 6 ? '#d97706'
    : '#c0392b'
  const strengthLabel = overall == null ? null
    : overall >= 8 ? 'Strong'
    : overall >= 6 ? 'Decent'
    : 'Weak'
  return (
    <div className="border border-[#e5e5e5] bg-white rounded p-2 space-y-1">
      <div className="flex items-start gap-2">
        <div className="text-[11px] font-medium flex-1">{text}</div>
        {overall != null && (
          <div
            className="font-mono font-bold text-[11px] rounded-full px-2 py-0.5 whitespace-nowrap"
            style={{ background: strengthColor + '15', color: strengthColor, border: `1px solid ${strengthColor}40` }}
            title={`Strength: ${overall}/10 — ${strengthLabel}`}
          >
            {overall}/10
          </div>
        )}
      </div>
      {body && <div className="text-[10px] text-muted italic">{body}</div>}
      {scores && (
        <div className="grid grid-cols-3 gap-x-2 gap-y-0.5 text-[9px] text-muted font-mono pt-0.5">
          <span title="Pattern Interruption">PI {scores.patternInterruption}</span>
          <span title="Clarity">CL {scores.clarity}</span>
          <span title="Curiosity / Tension">CU {scores.curiosity}</span>
          <span title="Specificity">SP {scores.specificity}</span>
          <span title="Visual Match">VM {scores.visualMatch}</span>
          <span title="Read-Time Fit">RT {scores.readTimeFit}</span>
        </div>
      )}
      {reason && <div className="text-[10px] text-muted italic">{reason}</div>}
      <div className="flex items-center gap-1.5 text-[9px] text-muted flex-wrap pt-1">
        {family && <span className="bg-[#6C5CE7]/10 text-[#6C5CE7] rounded-full px-1.5 py-0.5">{family.replace(/_/g, ' ')}</span>}
        {bestUse && <span className="bg-[#f8f7f3] rounded-full px-1.5 py-0.5">best as: {bestUse}</span>}
        {strengthLabel && <span className="rounded-full px-1.5 py-0.5" style={{ background: strengthColor + '15', color: strengthColor }}>{strengthLabel}</span>}
        <button
          onClick={onApply}
          className="ml-auto text-[9px] py-0.5 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer"
        >Use as opening</button>
      </div>
    </div>
  )
}

function OverrideField({ label, value, onChange, tenantValue, placeholder, rows = 3 }) {
  const overriding = value.trim().length > 0
  const tenantPreview = (tenantValue || '').trim()
  return (
    <div>
      <div className="flex items-center gap-2 text-[10px] text-muted">
        <label className="font-medium">{label}</label>
        {overriding
          ? <span className="text-[9px] bg-[#6C5CE7]/10 text-[#6C5CE7] rounded-full px-1.5 py-0">overriding</span>
          : <span className="text-[9px] text-muted italic">inheriting tenant default</span>}
      </div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={tenantPreview ? `tenant default: ${tenantPreview.slice(0, 200)}${tenantPreview.length > 200 ? '…' : ''}` : placeholder}
        rows={rows}
        className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white resize-y mt-1"
      />
    </div>
  )
}

function VoiceField({ label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] text-muted w-[90px] flex-shrink-0">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="flex-1 text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white"
      >
        {options.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </div>
  )
}
