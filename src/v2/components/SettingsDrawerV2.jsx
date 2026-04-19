import { useEffect, useState } from 'react'
import * as api from '../../api'

/**
 * SettingsDrawerV2 — real forms for the high-leverage settings. Writes
 * via the existing PUT /settings endpoint, which also backs the real
 * app's sidebar, so changes round-trip cleanly.
 *
 * This session ports:
 *   - Brand (name, type, location, URL, rules, tone, POV, marketing intensity)
 *   - Guidance (key insights, audience notes, vocabulary)
 *   - API keys (ElevenLabs key + default voice)
 *   - Account (profile + sign out)
 *
 * Left as "Open real settings" links in this phase:
 *   - Platform OAuth connections (FB / IG / TikTok / YT / GBP / Pinterest)
 *   - Watermark upload
 *   - Notification / email setup
 *   - Per-platform hashtags & hook categories
 */
export default function SettingsDrawerV2({ open, onClose, settings: settingsProp }) {
  const [settings, setSettings] = useState(settingsProp || {})
  const [me, setMe] = useState(null)
  const [expanded, setExpanded] = useState('brand')

  useEffect(() => { if (settingsProp) setSettings(settingsProp) }, [settingsProp])
  useEffect(() => {
    if (!open) return
    api.getMe().then(u => setMe(u || null)).catch(() => {})
    api.getSettings().then(s => { if (s && !s.error) setSettings(s) }).catch(() => {})
  }, [open])

  if (!open) return null

  const refresh = async () => {
    try {
      const s = await api.getSettings()
      if (s && !s.error) setSettings(s)
    } catch {}
  }

  const toggle = (key) => setExpanded(prev => prev === key ? '' : key)

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-white">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e5e5e5]">
        <div className="text-[12px] font-medium flex-1">Settings</div>
        <button
          onClick={onClose}
          className="text-[14px] text-muted bg-transparent border-none cursor-pointer px-1"
        >✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        <div>
          <div className="flex items-center gap-2 px-1 pb-1 pt-2">
            <div className="text-[10px] uppercase tracking-wide text-muted font-medium">This business</div>
            <div className="text-[11px] font-medium text-ink">{settings?.name || 'Your tenant'}</div>
          </div>

          <SectionCard
            icon="🏷️" label="Brand"
            open={expanded === 'brand'}
            onToggle={() => toggle('brand')}
          >
            <BrandForm settings={settings} onSaved={refresh} />
          </SectionCard>

          <SectionCard
            icon="💡" label="Guidance"
            open={expanded === 'guidance'}
            onToggle={() => toggle('guidance')}
            desc="Key insights + audience notes injected into every generation"
          >
            <GuidanceForm settings={settings} onSaved={refresh} />
          </SectionCard>

          <SectionCard
            icon="🔑" label="API keys"
            open={expanded === 'keys'}
            onToggle={() => toggle('keys')}
          >
            <KeysForm settings={settings} onSaved={refresh} />
          </SectionCard>

          <SectionCard
            icon="📤" label="Platforms"
            open={expanded === 'platforms'}
            onToggle={() => toggle('platforms')}
            desc="Which platforms this tenant publishes to (affects which channels the editor shows)"
          >
            <PlatformsForm settings={settings} onSaved={refresh} />
          </SectionCard>

          <SectionCard
            icon="#️⃣" label="Hashtags"
            open={expanded === 'hashtags'}
            onToggle={() => toggle('hashtags')}
            desc="Default hashtags appended per platform"
          >
            <HashtagsForm settings={settings} onSaved={refresh} />
          </SectionCard>

          <SectionCard
            icon="🎣" label="Hook categories"
            open={expanded === 'hooks'}
            onToggle={() => toggle('hooks')}
            desc="Categories used to seed AI hook / overlay generation"
          >
            <HookCategoriesForm settings={settings} onSaved={refresh} />
          </SectionCard>

          <SectionCard
            icon="⚙️" label="Posting defaults"
            open={expanded === 'defaults'}
            onToggle={() => toggle('defaults')}
            desc="Caption length, availability, SEO, anonymize"
          >
            <PostingDefaultsForm settings={settings} onSaved={refresh} />
          </SectionCard>

          <SectionCard
            icon="🔗" label="Platform connections"
            open={expanded === 'connections'}
            onToggle={() => toggle('connections')}
            desc="OAuth + credentials for FB/IG, TikTok, YouTube, GBP, Pinterest, X, WordPress"
          >
            <ConnectionsForm settings={settings} onRefresh={refresh} />
          </SectionCard>

          <PlaceholderRow icon="🖼️" label="Watermark" desc="Upload + toggle watermark burned into finals" />
          <PlaceholderRow icon="📅" label="Notifications" desc="Email for scheduled-post reminders" />
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted font-medium px-1 pb-1 pt-2">Your account</div>

          {me ? (
            <div className="bg-white border border-[#e5e5e5] rounded-lg p-3 space-y-1">
              <div className="text-[12px] font-medium">{me.email || 'You'}</div>
              <div className="text-[10px] text-muted">role: {me.role || 'user'}{me.tenant_slug ? ` · tenant: ${me.tenant_slug}` : ''}</div>
            </div>
          ) : (
            <div className="text-[10px] text-muted italic px-1">Loading…</div>
          )}
        </div>

        <div className="pt-2 px-1">
          <button
            onClick={async () => {
              if (!confirm('Sign out?')) return
              try { await api.logout() } catch {}
              try { if (typeof window !== 'undefined') window.location.reload() } catch {}
            }}
            className="w-full text-[11px] py-2 text-[#c0392b] bg-white border border-[#c0392b] rounded cursor-pointer"
          >Sign out</button>
        </div>
      </div>
    </div>
  )
}

function SectionCard({ icon, label, open, onToggle, desc, children }) {
  return (
    <div className="bg-white border border-[#e5e5e5] rounded-lg overflow-hidden mb-1">
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 p-3 bg-transparent border-none cursor-pointer text-left"
      >
        <div className="w-10 h-10 rounded bg-[#6C5CE7]/10 flex items-center justify-center text-[20px] flex-shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium">{label}</div>
          {desc && <div className="text-[10px] text-muted mt-0.5">{desc}</div>}
        </div>
        <div className="text-[12px] text-muted">{open ? '▾' : '▸'}</div>
      </button>
      {open && <div className="px-3 pb-3 border-t border-[#e5e5e5] pt-3">{children}</div>}
    </div>
  )
}

function PlaceholderRow({ icon, label, desc }) {
  return (
    <a
      href="/?real=1"
      className="flex items-start gap-3 bg-white border border-[#e5e5e5] rounded-lg p-3 no-underline opacity-70 mb-1"
    >
      <div className="w-10 h-10 rounded bg-[#6C5CE7]/10 flex items-center justify-center text-[20px] flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-ink">{label}</div>
        <div className="text-[10px] text-muted mt-0.5">{desc}</div>
      </div>
      <div className="text-[9px] text-[#6C5CE7] whitespace-nowrap self-center">Open in real app →</div>
    </a>
  )
}

// --- Brand ---------------------------------------------------------------

const TONES = ['warm', 'playful', 'professional', 'edgy', 'inspirational', 'minimalist']
const POVS  = ['first_person', 'second_person', 'third_person', 'brand_voice']
const INTENSITY = ['subtle', 'balanced', 'high']

function BrandForm({ settings, onSaved }) {
  const [form, setForm] = useState(() => ({
    name: settings.name || '',
    business_type: settings.business_type || '',
    location: settings.location || '',
    target_url: settings.target_url || '',
    default_tone: settings.default_tone || 'warm',
    default_pov: settings.default_pov || 'first_person',
    marketing_intensity: settings.marketing_intensity || 'balanced',
    brand_rules: settings.brand_rules || '',
  }))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  const save = async () => {
    setSaving(true); setMsg(null); setErr(null)
    try {
      const r = await api.saveSettings(form)
      if (r && !r.ok) {
        const j = await r.json().catch(() => ({}))
        if (j?.error) throw new Error(j.error)
      }
      setMsg('Saved.')
      onSaved?.()
    } catch (e) { setErr(e.message || String(e)) }
    finally { setSaving(false) }
  }
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <div className="space-y-2">
      <Field label="Business name">
        <input type="text" value={form.name} onChange={e => set('name', e.target.value)} className={inp} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Type">
          <input type="text" placeholder="e.g. candle bar" value={form.business_type} onChange={e => set('business_type', e.target.value)} className={inp} />
        </Field>
        <Field label="Location">
          <input type="text" placeholder="e.g. Menomonee Falls, WI" value={form.location} onChange={e => set('location', e.target.value)} className={inp} />
        </Field>
      </div>
      <Field label="Website / URL">
        <input type="url" value={form.target_url} onChange={e => set('target_url', e.target.value)} className={inp} />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Tone">
          <select value={form.default_tone} onChange={e => set('default_tone', e.target.value)} className={inp}>
            {TONES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="POV">
          <select value={form.default_pov} onChange={e => set('default_pov', e.target.value)} className={inp}>
            {POVS.map(p => <option key={p} value={p}>{p.replace('_', ' ')}</option>)}
          </select>
        </Field>
        <Field label="Marketing">
          <select value={form.marketing_intensity} onChange={e => set('marketing_intensity', e.target.value)} className={inp}>
            {INTENSITY.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Brand rules" hint="Hard rules AI must follow — word bans, style, always/never">
        <textarea value={form.brand_rules} onChange={e => set('brand_rules', e.target.value)} rows={4} className={`${inp} resize-y min-h-[80px]`} />
      </Field>
      <SaveRow saving={saving} msg={msg} err={err} onSave={save} />
    </div>
  )
}

// --- Guidance ------------------------------------------------------------

function GuidanceForm({ settings, onSaved }) {
  const [form, setForm] = useState(() => ({
    key_insights: settings.key_insights || '',
    audience_notes: settings.audience_notes || '',
  }))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)
  const save = async () => {
    setSaving(true); setMsg(null); setErr(null)
    try {
      const r = await api.saveSettings(form)
      if (r && !r.ok) { const j = await r.json().catch(() => ({})); if (j?.error) throw new Error(j.error) }
      setMsg('Saved.')
      onSaved?.()
    } catch (e) { setErr(e.message || String(e)) }
    finally { setSaving(false) }
  }
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  return (
    <div className="space-y-2">
      <Field label="Key insights" hint="High-signal facts about your product or brand that should show up in posts">
        <textarea value={form.key_insights} onChange={e => set('key_insights', e.target.value)} rows={4} className={`${inp} resize-y min-h-[80px]`} />
      </Field>
      <Field label="Audience notes" hint="Who are your customers? What tone works with them? Any taboos?">
        <textarea value={form.audience_notes} onChange={e => set('audience_notes', e.target.value)} rows={4} className={`${inp} resize-y min-h-[80px]`} />
      </Field>
      <SaveRow saving={saving} msg={msg} err={err} onSave={save} />
    </div>
  )
}

// --- API keys ------------------------------------------------------------

function KeysForm({ settings, onSaved }) {
  const masked = settings.elevenlabs_api_key // "••••abcd" from backend
  const [newKey, setNewKey] = useState('')
  const [voiceId, setVoiceId] = useState(settings.elevenlabs_voice_id || '')
  const [voices, setVoices] = useState([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!settings.elevenlabs_configured) return
    api.getVoices?.().then(r => setVoices(Array.isArray(r?.voices) ? r.voices : [])).catch(() => {})
  }, [settings.elevenlabs_configured])

  const save = async () => {
    setSaving(true); setMsg(null); setErr(null)
    try {
      const payload = { elevenlabs_voice_id: voiceId || null }
      if (newKey.trim()) payload.elevenlabs_api_key = newKey.trim()
      const r = await api.saveSettings(payload)
      if (r && !r.ok) { const j = await r.json().catch(() => ({})); if (j?.error) throw new Error(j.error) }
      setMsg('Saved. Reload to see voice list if you just added a key.')
      setNewKey('')
      onSaved?.()
    } catch (e) { setErr(e.message || String(e)) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-2">
      <Field label="ElevenLabs API key" hint={masked ? `on file: ${masked} — paste a new key to replace` : 'Needed for AI voiceovers'}>
        <input
          type="password"
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          placeholder={masked ? 'Leave blank to keep current' : 'sk_… or xi_…'}
          className={inp}
        />
      </Field>
      <Field label="Default voice" hint="Used as the initial voice for every new voiceover">
        <select value={voiceId} onChange={e => setVoiceId(e.target.value)} className={inp}>
          <option value="">{voices.length ? 'Pick a voice' : 'Add key + reload to list voices'}</option>
          {voices.map(v => <option key={v.voice_id} value={v.voice_id}>{v.name}{v.category ? ` (${v.category})` : ''}</option>)}
        </select>
      </Field>
      <SaveRow saving={saving} msg={msg} err={err} onSave={save} />
    </div>
  )
}

// --- helpers -------------------------------------------------------------

const inp = 'w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white'

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-[10px] text-muted">{label}</label>
      {children}
      {hint && <div className="text-[9px] text-muted mt-0.5 italic">{hint}</div>}
    </div>
  )
}

function SaveRow({ saving, msg, err, onSave }) {
  return (
    <div className="pt-1">
      <button
        onClick={onSave}
        disabled={saving}
        className="w-full text-[11px] py-1.5 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
      >{saving ? 'Saving…' : 'Save'}</button>
      {msg && <div className="text-[10px] text-[#2D9A5E] mt-1">{msg}</div>}
      {err && <div className="text-[10px] text-[#c0392b] mt-1">{err}</div>}
    </div>
  )
}

async function putSettings(payload) {
  const r = await api.saveSettings(payload)
  if (r && !r.ok) {
    const j = await r.json().catch(() => ({}))
    if (j?.error) throw new Error(j.error)
  }
}

// --- Platforms -----------------------------------------------------------

const PLATFORM_TOGGLES = [
  { key: 'platform_instagram', label: 'Instagram' },
  { key: 'platform_facebook',  label: 'Facebook' },
  { key: 'platform_tiktok',    label: 'TikTok' },
  { key: 'platform_youtube',   label: 'YouTube' },
  { key: 'platform_google',    label: 'Google Business' },
  { key: 'platform_blog',      label: 'Blog / WordPress' },
  { key: 'platform_twitter',   label: 'X / Twitter' },
  { key: 'platform_pinterest', label: 'Pinterest' },
]

function PlatformsForm({ settings, onSaved }) {
  const [form, setForm] = useState(() => {
    const out = {}
    for (const { key } of PLATFORM_TOGGLES) out[key] = !!settings[key]
    return out
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)
  const save = async () => {
    setSaving(true); setMsg(null); setErr(null)
    try { await putSettings(form); setMsg('Saved.'); onSaved?.() }
    catch (e) { setErr(e.message || String(e)) }
    finally { setSaving(false) }
  }
  const toggle = (k) => setForm(p => ({ ...p, [k]: !p[k] }))

  return (
    <div className="space-y-1.5">
      {PLATFORM_TOGGLES.map(p => (
        <label key={p.key} className="flex items-center gap-2 bg-white border border-[#e5e5e5] rounded p-2 cursor-pointer">
          <input type="checkbox" checked={!!form[p.key]} onChange={() => toggle(p.key)} />
          <span className="text-[11px] flex-1">{p.label}</span>
        </label>
      ))}
      <SaveRow saving={saving} msg={msg} err={err} onSave={save} />
    </div>
  )
}

// --- Hashtags ------------------------------------------------------------

const HASHTAG_FIELDS = [
  { key: 'default_hashtags_all',       label: 'All platforms (fallback)' },
  { key: 'default_hashtags_instagram', label: 'Instagram' },
  { key: 'default_hashtags_facebook',  label: 'Facebook' },
  { key: 'default_hashtags_twitter',   label: 'X / Twitter' },
  { key: 'default_hashtags_youtube',   label: 'YouTube' },
  { key: 'tiktok_default_hashtags',    label: 'TikTok' },
]

function HashtagsForm({ settings, onSaved }) {
  const [form, setForm] = useState(() => {
    const out = {}
    for (const { key } of HASHTAG_FIELDS) out[key] = settings[key] || ''
    return out
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const save = async () => {
    setSaving(true); setMsg(null); setErr(null)
    try { await putSettings(form); setMsg('Saved.'); onSaved?.() }
    catch (e) { setErr(e.message || String(e)) }
    finally { setSaving(false) }
  }
  return (
    <div className="space-y-2">
      {HASHTAG_FIELDS.map(f => (
        <Field key={f.key} label={f.label}>
          <textarea
            value={form[f.key]}
            onChange={e => set(f.key, e.target.value)}
            placeholder="#hashtag1 #hashtag2 #hashtag3"
            rows={2}
            className={`${inp} resize-y`}
          />
        </Field>
      ))}
      <SaveRow saving={saving} msg={msg} err={err} onSave={save} />
    </div>
  )
}

// --- Hook categories -----------------------------------------------------

function HookCategoriesForm({ settings, onSaved }) {
  const [list, setList] = useState(() => {
    const raw = Array.isArray(settings.hook_categories) ? settings.hook_categories : []
    return raw.map(c => ({ name: c?.name || '', prompt_context: c?.prompt_context || '' }))
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  const update = (i, patch) => setList(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c))
  const remove = (i) => setList(prev => prev.filter((_, idx) => idx !== i))
  const add = () => setList(prev => [...prev, { name: '', prompt_context: '' }])

  const save = async () => {
    setSaving(true); setMsg(null); setErr(null)
    try {
      const clean = list.map(c => ({ name: (c.name || '').trim(), prompt_context: (c.prompt_context || '').trim() }))
        .filter(c => c.name)
      await putSettings({ hook_categories: clean })
      setMsg(`Saved ${clean.length} categor${clean.length === 1 ? 'y' : 'ies'}.`)
      onSaved?.()
    } catch (e) { setErr(e.message || String(e)) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-muted italic">
        Each category is a framing the AI can reach for when generating hooks / overlays. Keep the name short and the prompt context specific.
      </div>
      {list.map((c, i) => (
        <div key={i} className="border border-[#e5e5e5] rounded p-2 space-y-1.5 bg-[#fafafa]">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={c.name}
              onChange={e => update(i, { name: e.target.value })}
              placeholder="Category name"
              className={`${inp} flex-1`}
            />
            <button
              onClick={() => remove(i)}
              className="text-[10px] py-0.5 px-2 border border-[#c0392b]/30 text-[#c0392b] bg-white rounded cursor-pointer"
              title="Remove category"
            >✕</button>
          </div>
          <textarea
            value={c.prompt_context}
            onChange={e => update(i, { prompt_context: e.target.value })}
            placeholder="What framing / tone should the AI use for this category?"
            rows={2}
            className={`${inp} resize-y`}
          />
        </div>
      ))}
      <button
        onClick={add}
        className="w-full text-[10px] py-1.5 border border-[#6C5CE7] text-[#6C5CE7] bg-white rounded cursor-pointer"
      >+ Add category</button>
      <SaveRow saving={saving} msg={msg} err={err} onSave={save} />
    </div>
  )
}

// --- Posting defaults ----------------------------------------------------

const CAPTION_LENGTHS = ['short', 'medium', 'long']

function PostingDefaultsForm({ settings, onSaved }) {
  const [form, setForm] = useState(() => ({
    caption_length:   settings.caption_length || 'medium',
    availability_on:  !!settings.availability_on,
    availability_text: settings.availability_text || '',
    occasion_override: settings.occasion_override || '',
    keep_anonymous:   !!settings.keep_anonymous,
    seo_prepend_brand: !!settings.seo_prepend_brand,
    seo_keywords:     settings.seo_keywords || '',
    engagement_hooks: !!settings.engagement_hooks,
  }))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const save = async () => {
    setSaving(true); setMsg(null); setErr(null)
    try { await putSettings(form); setMsg('Saved.'); onSaved?.() }
    catch (e) { setErr(e.message || String(e)) }
    finally { setSaving(false) }
  }
  return (
    <div className="space-y-2">
      <Field label="Caption length">
        <select value={form.caption_length} onChange={e => set('caption_length', e.target.value)} className={inp}>
          {CAPTION_LENGTHS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </Field>

      <label className="flex items-center gap-2 bg-white border border-[#e5e5e5] rounded p-2 cursor-pointer">
        <input type="checkbox" checked={form.availability_on} onChange={e => set('availability_on', e.target.checked)} />
        <span className="text-[11px] flex-1">Include availability line</span>
      </label>
      {form.availability_on && (
        <Field label="Availability text" hint="Short line appended to posts, e.g. 'Book at poppythyme.com'">
          <input type="text" value={form.availability_text} onChange={e => set('availability_text', e.target.value)} className={inp} />
        </Field>
      )}

      <Field label="Occasion override" hint="If set, every generation treats media as this occasion (e.g. 'birthday', 'date night')">
        <input type="text" value={form.occasion_override} onChange={e => set('occasion_override', e.target.value)} className={inp} />
      </Field>

      <label className="flex items-center gap-2 bg-white border border-[#e5e5e5] rounded p-2 cursor-pointer">
        <input type="checkbox" checked={form.engagement_hooks} onChange={e => set('engagement_hooks', e.target.checked)} />
        <span className="text-[11px] flex-1">Enable engagement hooks (CTA questions in captions)</span>
      </label>
      <label className="flex items-center gap-2 bg-white border border-[#e5e5e5] rounded p-2 cursor-pointer">
        <input type="checkbox" checked={form.keep_anonymous} onChange={e => set('keep_anonymous', e.target.checked)} />
        <span className="text-[11px] flex-1">Keep filenames / folder names anonymous to AI</span>
      </label>
      <label className="flex items-center gap-2 bg-white border border-[#e5e5e5] rounded p-2 cursor-pointer">
        <input type="checkbox" checked={form.seo_prepend_brand} onChange={e => set('seo_prepend_brand', e.target.checked)} />
        <span className="text-[11px] flex-1">Prepend brand name to SEO keywords</span>
      </label>

      <Field label="Default SEO keywords" hint="Comma-separated, used on YouTube + Blog posts">
        <textarea value={form.seo_keywords} onChange={e => set('seo_keywords', e.target.value)} rows={2} className={`${inp} resize-y`} />
      </Field>

      <SaveRow saving={saving} msg={msg} err={err} onSave={save} />
    </div>
  )
}

// --- Platform connections ------------------------------------------------

function ConnectionsForm({ settings, onRefresh }) {
  return (
    <div className="space-y-2">
      <FacebookConnectRow settings={settings} onRefresh={onRefresh} />
      <GoogleConnectRow settings={settings} onRefresh={onRefresh} />
      <YouTubeConnectRow settings={settings} onRefresh={onRefresh} />
      <PinterestConnectRow settings={settings} onRefresh={onRefresh} />
      <TikTokConnectRow settings={settings} onRefresh={onRefresh} />
      <TwitterConnectRow settings={settings} onRefresh={onRefresh} />
      <WordPressConnectRow settings={settings} onRefresh={onRefresh} />
    </div>
  )
}

function ConnectCard({ icon, label, connected, connectedAs, connectedAt, appMissing, appMissingNote, children, onConnect, onDisconnect, busy }) {
  return (
    <div className={`border rounded p-2 space-y-1.5 ${connected ? 'border-[#2D9A5E]/30 bg-[#f0faf4]' : 'border-[#e5e5e5] bg-white'}`}>
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded bg-[#6C5CE7]/10 flex items-center justify-center text-[12px] font-bold text-[#6C5CE7] flex-shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium truncate">{label}</div>
          <div className="text-[9px] text-muted truncate">
            {connected
              ? (connectedAs || 'connected') + (connectedAt ? ` · ${new Date(connectedAt).toLocaleDateString()}` : '')
              : (appMissing ? (appMissingNote || 'Admin must set up app credentials first.') : 'not connected')}
          </div>
        </div>
        {connected ? (
          <button
            onClick={onDisconnect}
            disabled={busy}
            className="text-[9px] py-0.5 px-2 border border-[#c0392b]/40 text-[#c0392b] bg-white rounded cursor-pointer disabled:opacity-50"
          >{busy ? '…' : 'Disconnect'}</button>
        ) : onConnect ? (
          <button
            onClick={onConnect}
            disabled={busy || appMissing}
            className="text-[9px] py-0.5 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
          >{busy ? '…' : 'Connect'}</button>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function useConnectHandlers({ start, disconnect, onRefresh }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const handleConnect = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await start()
      if (r?.error) throw new Error(r.error)
      if (r?.url) { window.location.href = r.url; return }
      throw new Error('No redirect URL returned.')
    } catch (e) { setErr(e.message || String(e)); setBusy(false) }
  }
  const handleDisconnect = async () => {
    if (!confirm('Disconnect this account?')) return
    setBusy(true); setErr(null)
    try {
      await disconnect()
      onRefresh?.()
    } catch (e) { setErr(e.message || String(e)) }
    finally { setBusy(false) }
  }
  return { busy, err, handleConnect, handleDisconnect }
}

function FacebookConnectRow({ settings, onRefresh }) {
  const { busy, err, handleConnect, handleDisconnect } = useConnectHandlers({
    start: api.startFbConnect, disconnect: api.disconnectFb, onRefresh,
  })
  const fbLabel = [settings.fb_page_name, settings.ig_username && `+ IG @${settings.ig_username}`].filter(Boolean).join(' ')
  return (
    <>
      <ConnectCard
        icon="FB" label="Facebook + Instagram"
        connected={!!settings.fb_connected}
        connectedAs={fbLabel}
        connectedAt={settings.fb_connected_at}
        appMissing={!settings.fb_app_configured}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        busy={busy}
      />
      {err && <div className="text-[10px] text-[#c0392b] px-1">{err}</div>}
    </>
  )
}

function GoogleConnectRow({ settings, onRefresh }) {
  const { busy, err, handleConnect, handleDisconnect } = useConnectHandlers({
    start: api.startGoogleConnect, disconnect: api.disconnectGoogle, onRefresh,
  })
  return (
    <>
      <ConnectCard
        icon="GBP" label="Google Business Profile"
        connected={!!settings.google_connected}
        connectedAs={settings.google_location_name}
        connectedAt={settings.google_connected_at}
        appMissing={!settings.google_app_configured}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        busy={busy}
      />
      {err && <div className="text-[10px] text-[#c0392b] px-1">{err}</div>}
    </>
  )
}

function YouTubeConnectRow({ settings, onRefresh }) {
  const { busy, err, handleConnect, handleDisconnect } = useConnectHandlers({
    start: api.startYoutubeConnect, disconnect: api.disconnectYoutube, onRefresh,
  })
  return (
    <>
      <ConnectCard
        icon="YT" label="YouTube"
        connected={!!settings.youtube_connected}
        connectedAs={settings.youtube_channel_name}
        connectedAt={settings.youtube_connected_at}
        appMissing={!settings.youtube_app_configured}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        busy={busy}
      />
      {err && <div className="text-[10px] text-[#c0392b] px-1">{err}</div>}
    </>
  )
}

function PinterestConnectRow({ settings, onRefresh }) {
  const { busy, err, handleConnect, handleDisconnect } = useConnectHandlers({
    start: api.startPinterestConnect, disconnect: api.disconnectPinterest, onRefresh,
  })
  return (
    <>
      <ConnectCard
        icon="Pin" label="Pinterest"
        connected={!!settings.pinterest_connected}
        connectedAs={settings.pinterest_username ? `@${settings.pinterest_username}` : settings.pinterest_board_name}
        connectedAt={settings.pinterest_connected_at}
        appMissing={!settings.pinterest_app_configured}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        busy={busy}
      />
      {err && <div className="text-[10px] text-[#c0392b] px-1">{err}</div>}
    </>
  )
}

function TikTokConnectRow({ settings, onRefresh }) {
  const { busy, err, handleConnect, handleDisconnect } = useConnectHandlers({
    start: api.startTiktokConnect, disconnect: api.disconnectTiktok, onRefresh,
  })
  const [showCreds, setShowCreds] = useState(false)
  return (
    <>
      <ConnectCard
        icon="TT" label="TikTok"
        connected={!!settings.tiktok_connected}
        connectedAs={settings.tiktok_username ? `@${settings.tiktok_username}` : null}
        connectedAt={settings.tiktok_connected_at}
        appMissing={!settings.tiktok_app_configured}
        appMissingNote="Add TikTok app credentials below, then Connect."
        onConnect={settings.tiktok_app_configured ? handleConnect : null}
        onDisconnect={handleDisconnect}
        busy={busy}
      >
        {!settings.tiktok_connected && (
          <button
            onClick={() => setShowCreds(v => !v)}
            className="text-[9px] text-[#6C5CE7] bg-transparent border-none cursor-pointer px-0"
          >{showCreds ? 'Hide' : (settings.tiktok_app_configured ? 'Update app credentials' : '+ Add app credentials')}</button>
        )}
        {showCreds && <TikTokCredsForm onSaved={() => { setShowCreds(false); onRefresh?.() }} />}
      </ConnectCard>
      {err && <div className="text-[10px] text-[#c0392b] px-1">{err}</div>}
    </>
  )
}

function TikTokCredsForm({ onSaved }) {
  const [clientKey, setClientKey] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const save = async () => {
    if (!clientKey.trim() || !clientSecret.trim()) return
    setSaving(true); setErr(null)
    try {
      const r = await api.saveTiktokCredentials(clientKey.trim(), clientSecret.trim())
      if (r?.error) throw new Error(r.error)
      onSaved?.()
    } catch (e) { setErr(e.message || String(e)) }
    finally { setSaving(false) }
  }
  return (
    <div className="space-y-1.5 pt-1.5 mt-1.5 border-t border-[#e5e5e5]">
      <input type="text" value={clientKey} onChange={e => setClientKey(e.target.value)} placeholder="TikTok client key" className={inp} />
      <input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="TikTok client secret" className={inp} />
      <button onClick={save} disabled={saving} className="w-full text-[10px] py-1 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50">
        {saving ? 'Saving…' : 'Save credentials'}
      </button>
      {err && <div className="text-[10px] text-[#c0392b]">{err}</div>}
    </div>
  )
}

function TwitterConnectRow({ settings, onRefresh }) {
  const { busy, err, handleConnect, handleDisconnect } = useConnectHandlers({
    start: api.startTwitterConnect, disconnect: api.disconnectTwitter, onRefresh,
  })
  const [showCreds, setShowCreds] = useState(false)
  return (
    <>
      <ConnectCard
        icon="X" label="X / Twitter"
        connected={!!settings.twitter_connected}
        connectedAs={settings.twitter_username ? `@${settings.twitter_username}` : null}
        connectedAt={settings.twitter_connected_at}
        appMissing={!settings.twitter_app_configured}
        appMissingNote="Add Twitter API credentials below, then Connect."
        onConnect={settings.twitter_app_configured ? handleConnect : null}
        onDisconnect={handleDisconnect}
        busy={busy}
      >
        {!settings.twitter_connected && (
          <button
            onClick={() => setShowCreds(v => !v)}
            className="text-[9px] text-[#6C5CE7] bg-transparent border-none cursor-pointer px-0"
          >{showCreds ? 'Hide' : (settings.twitter_app_configured ? 'Update app credentials' : '+ Add app credentials')}</button>
        )}
        {showCreds && <TwitterCredsForm onSaved={() => { setShowCreds(false); onRefresh?.() }} />}
      </ConnectCard>
      {err && <div className="text-[10px] text-[#c0392b] px-1">{err}</div>}
    </>
  )
}

function TwitterCredsForm({ onSaved }) {
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const save = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) return
    setSaving(true); setErr(null)
    try {
      const r = await api.saveTwitterCredentials(apiKey.trim(), apiSecret.trim())
      if (r?.error) throw new Error(r.error)
      onSaved?.()
    } catch (e) { setErr(e.message || String(e)) }
    finally { setSaving(false) }
  }
  return (
    <div className="space-y-1.5 pt-1.5 mt-1.5 border-t border-[#e5e5e5]">
      <input type="text" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Twitter API key" className={inp} />
      <input type="password" value={apiSecret} onChange={e => setApiSecret(e.target.value)} placeholder="Twitter API secret" className={inp} />
      <button onClick={save} disabled={saving} className="w-full text-[10px] py-1 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50">
        {saving ? 'Saving…' : 'Save credentials'}
      </button>
      {err && <div className="text-[10px] text-[#c0392b]">{err}</div>}
    </div>
  )
}

function WordPressConnectRow({ settings, onRefresh }) {
  const [siteUrl, setSiteUrl] = useState('')
  const [username, setUsername] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const connect = async () => {
    if (!siteUrl.trim() || !username.trim() || !appPassword.trim()) return
    setSaving(true); setErr(null)
    try {
      const r = await api.saveWpCredentials(siteUrl.trim(), username.trim(), appPassword.trim())
      if (r?.error) throw new Error(r.error)
      setSiteUrl(''); setUsername(''); setAppPassword('')
      onRefresh?.()
    } catch (e) { setErr(e.message || String(e)) }
    finally { setSaving(false) }
  }
  const disconnect = async () => {
    if (!confirm('Disconnect WordPress?')) return
    setBusy(true)
    try { await api.disconnectWp(); onRefresh?.() }
    finally { setBusy(false) }
  }
  return (
    <div className={`border rounded p-2 space-y-1.5 ${settings.wp_connected ? 'border-[#2D9A5E]/30 bg-[#f0faf4]' : 'border-[#e5e5e5] bg-white'}`}>
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded bg-[#6C5CE7]/10 flex items-center justify-center text-[10px] font-bold text-[#6C5CE7] flex-shrink-0">WP</div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium truncate">WordPress</div>
          <div className="text-[9px] text-muted truncate">
            {settings.wp_connected
              ? `${settings.wp_username || 'connected'} · ${settings.wp_site_url || ''}`
              : 'Uses site URL + username + Application Password (not regular password)'}
          </div>
        </div>
        {settings.wp_connected && (
          <button
            onClick={disconnect}
            disabled={busy}
            className="text-[9px] py-0.5 px-2 border border-[#c0392b]/40 text-[#c0392b] bg-white rounded cursor-pointer disabled:opacity-50"
          >{busy ? '…' : 'Disconnect'}</button>
        )}
      </div>
      {!settings.wp_connected && (
        <div className="space-y-1.5 pt-1 border-t border-[#e5e5e5]">
          <input type="url" value={siteUrl} onChange={e => setSiteUrl(e.target.value)} placeholder="https://yoursite.com" className={inp} />
          <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="WordPress username" className={inp} />
          <input type="password" value={appPassword} onChange={e => setAppPassword(e.target.value)} placeholder="Application Password (not your login password)" className={inp} />
          <button
            onClick={connect}
            disabled={saving || !siteUrl.trim() || !username.trim() || !appPassword.trim()}
            className="w-full text-[10px] py-1 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
          >{saving ? 'Saving…' : 'Connect'}</button>
          {err && <div className="text-[10px] text-[#c0392b]">{err}</div>}
        </div>
      )}
    </div>
  )
}
