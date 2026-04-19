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

  const generate = async (scope /* 'current' | 'all' */) => {
    setGenErr(null)
    const f0Live = files?.[0]
    if (!f0Live && !firstFile) { setGenErr('Upload a file first.'); return }
    setGenerating(scope)
    try {
      const platforms = scope === 'current' ? [active] : PLATFORMS.map(p => p.key)
      const isImg = (f0Live?.file?.type || f0Live?._mediaType || firstFile?.media_type || '').startsWith('image/')
      const uploadUuid = f0Live?.uploadResult?.uuid || f0Live?.uploadResult?.id || firstFile?.upload_uuid || null

      const body = {
        filename: f0Live?.file?.name || f0Live?._filename || firstFile?.filename || 'file',
        folder_name: '',
        occasion: '',
        tone: settings?.default_tone || 'warm',
        availability: '',
        platforms,
        upload_id: uploadUuid,
        job_uuid: draftId || null,
        rule_name: true, rule_cta: true, rule_brand: true, rule_seo: true, rule_hashtags: true,
        user_hint: hint || '',
      }
      if (isImg && f0Live?.file) {
        body.base64 = await toBase64(f0Live.file)
        body.media_type = f0Live.file.type || f0Live._mediaType || 'image/jpeg'
      }
      if (!body.upload_id && !body.base64) {
        setGenErr('Need either an upload_id or image base64 — the file may still be uploading.')
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

      <div className="border-t border-[#e5e5e5] pt-2 space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-[11px] font-medium flex-1">Generate with AI</div>
          {hint && <span className="text-[9px] text-muted">using Hints</span>}
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
          className="w-full text-[10px] border border-[#e5e5e5] rounded p-1.5 bg-white"
        />
        <div className="flex gap-1.5">
          <button
            onClick={() => generate('current')}
            disabled={anyGen}
            className="flex-1 text-[10px] py-1.5 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
          >
            {isGenCurrent ? 'Generating…' : `Generate ${PLATFORMS.find(p => p.key === active)?.label}`}
          </button>
          <button
            onClick={() => generate('all')}
            disabled={anyGen}
            className="flex-1 text-[10px] py-1.5 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer disabled:opacity-50"
          >
            {isGenAll ? 'Generating all…' : 'Generate all 6'}
          </button>
        </div>
        {genErr && <div className="text-[10px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-1.5">{genErr}</div>}
      </div>
    </div>
  )
}
