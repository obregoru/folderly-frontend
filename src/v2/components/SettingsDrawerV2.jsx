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

          <PlaceholderRow icon="📤" label="Platforms" desc="OAuth for TikTok / IG / FB / YT / GBP / Pinterest" />
          <PlaceholderRow icon="⚙️" label="Posting defaults" desc="Hashtags, watermark, SEO, humanize, AI detection" />
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
