import { useEffect, useState } from 'react'
import * as api from '../../api'
import { toBase64 } from '../../lib/crop'

/**
 * PostTextPanelV2 — per-platform post body text (caption / description).
 * Each platform tab edits the first file's captions JSONB (shared with the
 * real app), saves on blur, and generates on demand via /generate/stream
 * (same endpoint the real app uses, so rules, hook_mode, and cached
 * visual_descriptions apply identically).
 */

const PLATFORMS = [
  { key: 'tiktok',    label: 'TikTok' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook',  label: 'Facebook' },
  { key: 'youtube',   label: 'YouTube' },
  { key: 'blog',      label: 'Blog' },
  { key: 'google',    label: 'GBP' },
]

function fmtTs(secs) {
  const s = Math.max(0, Math.round(Number(secs) || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

export default function PostTextPanelV2({ jobSync, draftId, files, settings }) {
  const [active, setActive] = useState('tiktok')
  const [captions, setCaptions] = useState({})
  const [saving, setSaving] = useState(false)
  const [firstFileDbId, setFirstFileDbId] = useState(null)
  const [firstFile, setFirstFile] = useState(null)
  const [job, setJob] = useState(null)
  const [generating, setGenerating] = useState(null) // 'current' | 'all' | null
  const [genErr, setGenErr] = useState(null)
  const [hint, setHint] = useState('')

  useEffect(() => {
    if (!draftId) return
    api.getJob(draftId).then(j => {
      setJob(j || null)
      const f0 = j?.files?.[0]
      if (f0) {
        setFirstFileDbId(f0.id)
        setFirstFile(f0)
        const caps = f0.captions && typeof f0.captions === 'object' ? f0.captions : {}
        setCaptions(caps)
      }
      if (j?.hint_text) setHint(j.hint_text)
    }).catch(() => {})
  }, [draftId])

  const update = (key, value) => setCaptions(prev => ({ ...prev, [key]: value }))

  const persist = async (next = captions) => {
    if (!draftId || !firstFileDbId) return
    setSaving(true)
    try {
      await api.updateJobFile(draftId, firstFileDbId, { captions: next })
    } catch (e) {
      console.warn('[PostTextV2] save failed:', e.message)
    }
    setSaving(false)
  }
  const persistOnBlur = () => persist()

  const generate = async (scope /* 'current' | 'all' | 'critique' */) => {
    setGenErr(null)
    const f0Live = files?.[0]
    if (!f0Live && !firstFile) { setGenErr('Upload a file first.'); return }
    setGenerating(scope)
    try {
      const platforms = scope === 'current' ? [active] : PLATFORMS.map(p => p.key)
      const useCritique = scope === 'critique'
      // Always pull fresh job state right before a critique run so the
      // critique text the user just saved in Hints is guaranteed to be
      // included. Cheap fetch; avoids "I saved it but regen didn't see it."
      let fresh = job
      if (useCritique) {
        try {
          fresh = await api.getJob(draftId)
          setJob(fresh)
        } catch (e) { console.warn('[PostTextV2] refresh before critique failed:', e.message) }
      }
      const isImg = (f0Live?.file?.type || f0Live?._mediaType || firstFile?.media_type || '').startsWith('image/')
      const uploadUuid = f0Live?.uploadResult?.uuid || f0Live?.uploadResult?.id || firstFile?.upload_uuid || null

      // Pull voiceover + caption script text out of the job so the AI has
      // them as context. Only included when the user has actually written
      // something — otherwise the model falls back to visuals + hint + names.
      const segs = Array.isArray(job?.voiceover_settings?.segments) ? job.voiceover_settings.segments : []
      const primaryVo = job?.voiceover_settings?.primary_text || '' // future-proof if we start storing it
      const voLines = [
        primaryVo ? `[0:00]${primaryVo}` : null,
        ...segs
          .filter(s => s?.text?.trim())
          .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0))
          .map(s => `[${fmtTs(Number(s.startTime) || 0)}]${s.text.trim()}`),
      ].filter(Boolean)
      const capTimeline = Array.isArray(job?.overlay_settings?.caption_timeline) ? job.overlay_settings.caption_timeline : []
      const capLines = capTimeline
        .filter(c => c?.text?.trim())
        .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0))
        .map(c => `[${fmtTs(Number(c.startTime) || 0)}]${c.text.trim()}`)

      // Per-job voice overrides beat tenant defaults when set. Use `fresh`
      // (just-refreshed for critique runs) so the latest tuning applies.
      const ctxJob = fresh || job
      const jobVoice = ctxJob?.generation_rules?.voice || {}
      const jobOffTopic = !!ctxJob?.generation_rules?.off_topic
      // Selected scroll-stopping hook from Hints panel. When present we
      // send it so captions can reference / complement it instead of
      // duplicating the hook beat.
      const selectedHook = ctxJob?.generation_rules?.hooks?.selected?.text
        || ctxJob?.overlay_settings?.openingText
        || null
      // Critique from the Second opinion box — now always flows in when
      // the draft has one, not only on the dedicated critique button.
      // The dedicated critique path remains for reruns when the critique
      // is stale but still saved.
      const stickyCritique = (ctxJob?.second_opinion || '').trim() || null

      const body = {
        filename: f0Live?.file?.name || f0Live?._filename || firstFile?.filename || 'file',
        folder_name: '',
        occasion: '',
        tone: jobVoice.tone || settings?.default_tone || 'warm',
        pov: jobVoice.pov || undefined,
        marketing_intensity: jobVoice.marketing_intensity || undefined,
        availability: '',
        platforms,
        upload_id: uploadUuid,
        job_uuid: draftId || null,
        rule_name: true, rule_cta: true, rule_brand: true, rule_seo: true, rule_hashtags: true,
        off_topic: jobOffTopic || undefined,
        overrides: ctxJob?.generation_rules?.overrides || undefined,
        user_hint: hint || '',
        voiceover_script: voLines.length ? voLines.join('\n') : undefined,
        captions_script:  capLines.length ? capLines.join('\n') : undefined,
        // Critique flows through on every generate when present; the
        // dedicated critique scope still flags it as the primary focus.
        second_opinion: stickyCritique || undefined,
        selected_hook: selectedHook || undefined,
      }
      if (useCritique && !body.second_opinion) {
        setGenErr('No critique saved on this draft — paste one in Hints → Second opinion first.')
        setGenerating(null); return
      }
      if (isImg && f0Live?.file) {
        body.base64 = await toBase64(f0Live.file)
        body.media_type = f0Live.file.type || f0Live._mediaType || 'image/jpeg'
      }
      // Don't hard-error if upload_id isn't on the client — when job_uuid is
      // present the backend will resolve the first job file's upload via
      // file_hash. Only block when we have literally no handle at all.
      if (!body.upload_id && !body.base64 && !body.job_uuid) {
        setGenErr('No media available yet — upload a file first.')
        setGenerating(null); return
      }

      const caps = {}
      await api.generateStream(body, (partial) => { Object.assign(caps, partial) })

      // Merge into existing captions — keep other platforms' text
      const next = { ...captions }
      for (const pk of platforms) {
        if (caps[pk] != null) next[pk] = caps[pk]
      }
      setCaptions(next)
      await persist(next)
    } catch (e) {
      setGenErr(e.message || String(e))
    } finally {
      setGenerating(null)
    }
  }

  const current = captions[active] || ''
  const currentIsObject = active === 'youtube' || active === 'blog'
  const currentText = typeof current === 'string'
    ? current
    : (current?.text || current?.description || '')

  const isGenCurrent = generating === 'current'
  const isGenAll = generating === 'all'
  const anyGen = !!generating

  const hasAnyCaption = Object.values(captions).some(v =>
    typeof v === 'string' ? v.trim() : (v?.text || v?.description || v?.title)
  )
  const primaryLabel = hasAnyCaption
    ? (isGenAll ? 'Regenerating everything…' : 'Regenerate everything (all 6)')
    : (isGenAll ? 'Generating everything…' : 'Generate everything (all 6 platforms)')

  return (
    <div className="space-y-3">
      {/* --- Primary action: generate. At the top because this is what the
          user reaches for first on a new draft. Only filenames + visuals +
          hints are required; voiceover and captions are optional context
          layered in later. --- */}
      <div className="bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-[12px] font-medium flex-1">Generate content</div>
          {hint && <span className="text-[9px] text-muted">using Hints</span>}
          {saving && <span className="text-[9px] text-muted">Saving…</span>}
        </div>
        <input
          type="text"
          value={hint}
          onChange={e => setHint(e.target.value)}
          onBlur={async () => {
            if (!draftId) return
            try { await api.updateJob(draftId, { hint_text: hint }) } catch (e) { console.warn('[PostTextV2] hint save failed:', e.message) }
          }}
          placeholder="Extra context for this generation (optional) — product, occasion, angle…"
          className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white"
        />
        <button
          onClick={() => generate('all')}
          disabled={anyGen}
          className="w-full text-[12px] py-2.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
        >
          {primaryLabel}
        </button>
        <button
          onClick={() => generate('current')}
          disabled={anyGen}
          className="w-full text-[10px] py-1.5 px-2 bg-transparent border border-[#6C5CE7]/40 text-[#6C5CE7] rounded cursor-pointer disabled:opacity-50"
        >
          {isGenCurrent ? 'Generating…' : `Just ${PLATFORMS.find(p => p.key === active)?.label}`}
        </button>
        {job?.second_opinion && (
          <button
            onClick={() => generate('critique')}
            disabled={anyGen}
            className="w-full text-[11px] py-2 px-2 bg-[#fef3c7] border border-[#d97706]/40 text-[#92400e] rounded cursor-pointer disabled:opacity-50 font-medium"
            title={job.second_opinion.slice(0, 500)}
          >
            {generating === 'critique' ? 'Regenerating with critique…' : '🎯 Regenerate with critique from Hints'}
          </button>
        )}
        <div className="text-[9px] text-muted italic">
          AI sees: filename, cached visuals from your video/photos, the hint above, plus any voiceover / captions you've timed in. Voiceover and captions are optional — add them after a first pass if you want to tune the voice further.
        </div>
        {genErr && <div className="text-[10px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-1.5">{genErr}</div>}
      </div>

      {/* --- Per-platform editor below. --- */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-[#e5e5e5]">
        {PLATFORMS.map(p => {
          const has = captions[p.key]
          const dot = has && (typeof has === 'string' ? has.trim() : (has?.text || has?.description))
          return (
            <button
              key={p.key}
              onClick={() => setActive(p.key)}
              className={`text-[10px] py-1.5 px-2.5 border-none cursor-pointer whitespace-nowrap border-b-2 flex items-center gap-1 ${active === p.key ? 'border-[#6C5CE7] text-[#6C5CE7] font-medium' : 'border-transparent text-muted bg-transparent'}`}
            >
              {p.label}
              {dot && <span className="w-1 h-1 rounded-full bg-[#2D9A5E]" />}
            </button>
          )
        })}
      </div>

      <div className="space-y-2">
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
          placeholder={`${PLATFORMS.find(p => p.key === active)?.label} caption — type here or use Generate above`}
          rows={8}
          className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y min-h-[140px]"
        />

        <div className="text-[9px] text-muted flex items-center gap-2">
          <span>{currentText.length} characters</span>
          {active === 'tiktok' && <span className="ml-auto">TikTok cap: 2,200</span>}
          {active === 'instagram' && <span className="ml-auto">Instagram cap: 2,200</span>}
        </div>

        {/* YouTube-only: tags field. The generator already returns
            { title, description, tags: [...] }. Before this, tags were
            dropped because the UI didn't surface them. */}
        {active === 'youtube' && (
          <YoutubeTagsEditor
            current={current}
            onChange={next => update('youtube', next)}
            onBlur={persistOnBlur}
          />
        )}
      </div>
    </div>
  )
}

function YoutubeTagsEditor({ current, onChange, onBlur }) {
  const obj = typeof current === 'object' && current ? current : {}
  const tagsArr = Array.isArray(obj.tags) ? obj.tags : []
  const [draft, setDraft] = useState(tagsArr.join(', '))
  // Re-sync when the underlying tags change (e.g. Generate response).
  useEffect(() => {
    const joined = (Array.isArray(obj.tags) ? obj.tags : []).join(', ')
    if (joined !== draft) setDraft(joined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(obj.tags)])

  const parseTags = (s) => String(s || '')
    .split(/[,\n]+/)
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 20) // YouTube enforces ~500-char total; 20 is a safe cap

  const commit = () => {
    const next = parseTags(draft)
    onChange({ ...obj, tags: next })
    onBlur?.()
  }

  return (
    <div className="border-t border-[#e5e5e5] pt-2 mt-1 space-y-1">
      <div className="flex items-center gap-2 text-[10px]">
        <label className="text-muted font-medium">Tags</label>
        <span className="text-muted">({tagsArr.length} / 20)</span>
        <span className="text-[9px] text-muted ml-auto">Comma-separated. Used for YouTube search.</span>
      </div>
      {/* Pill preview so the user sees the parsed tags, not just the raw string */}
      {tagsArr.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap pb-1">
          {tagsArr.map((t, i) => (
            <span key={i} className="text-[9px] bg-[#6C5CE7]/10 text-[#6C5CE7] border border-[#6C5CE7]/30 rounded-full px-2 py-0.5">#{t}</span>
          ))}
        </div>
      )}
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        placeholder="shorts, candle making, diy, gift idea, perfume bar…"
        rows={2}
        className="w-full text-[10px] border border-[#e5e5e5] rounded p-1.5 bg-white resize-y font-mono"
      />
    </div>
  )
}
