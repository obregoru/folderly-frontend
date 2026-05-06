// V3 Content Studio — tenant Content Config form.
//
// Phase 0: a single working form covering all the tenant primitives.
// Wizard polish (multi-step, examples, preview-the-prompt) lands in
// later phases. For now: get the data shape round-tripping cleanly.
//
// Sections:
//   - Enabled templates (multi-select)
//   - Audience locks (one textarea per enabled template)
//   - Promoted business (anchor brand + region + owned categories)
//   - Research URLs (list)
//   - Indexer behavior (size + eviction strategy)
//   - Blog schedule (cadence)
//   - ZeroGPT threshold
//
// Each "Save" PUTs only the fields that section owns — the BE upsert
// preserves anything not sent. So the user can save sections
// independently as they fill them out.

import { useEffect, useState } from 'react'
import * as api from '../api'

const ALL_TEMPLATES = [
  { key: 'experience_feature',  label: 'Experience feature',  hint: 'Single-business deep-dive profile' },
  { key: 'regional_roundup',    label: 'Regional roundup',    hint: 'Best-of-N businesses in a city/region' },
  { key: 'trend_piece',         label: 'Trend piece',         hint: 'Category-level editorial — "rise of X"' },
  { key: 'seasonal_roundup',    label: 'Seasonal roundup',    hint: 'Holiday / event-tied content' },
  { key: 'shop_owner_ideas',    label: 'Ideas for shop owners', hint: 'B2B — what businesses can offer (saturation-aware)' },
]

const DEFAULT_AUDIENCE_HINTS = {
  experience_feature: 'A consumer planning an outing — looking for a single great place to spend an afternoon or evening. Implied reader is shopping for the experience itself, not a tutorial.',
  regional_roundup:   'A local or visiting traveler researching things to do in [city/region]. Wants a curated list, not exhaustive coverage.',
  trend_piece:        'An inspiration browser — interested in what\'s rising in this category, why it\'s a moment, where to encounter it.',
  seasonal_roundup:   'An event/holiday shopper looking for timely things to do. Probably booking 1-2 weeks out.',
  shop_owner_ideas:   'A small business owner offering guided experiences. Wants ideas that drive foot traffic, group bookings, and corporate events.',
}

export default function ContentConfig() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingSection, setSavingSection] = useState(null) // 'templates' | 'audience' | etc.
  const [savedFlash, setSavedFlash] = useState(null)

  // Per-section edit state — diverges from `config` until saved, then
  // re-syncs from the server response.
  const [enabledTemplates, setEnabledTemplates] = useState([])
  const [audienceLocks, setAudienceLocks] = useState({})
  const [promotedBusiness, setPromotedBusiness] = useState(null)
  const [researchUrls, setResearchUrls] = useState([])
  const [blogIndexSize, setBlogIndexSize] = useState(25)
  const [evictStrategy, setEvictStrategy] = useState('sliding')
  const [blogSchedule, setBlogSchedule] = useState(null)
  const [zerogptThreshold, setZerogptThreshold] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.getContentConfig()
      .then(c => {
        if (cancelled) return
        setConfig(c)
        setEnabledTemplates(Array.isArray(c.enabled_templates) ? c.enabled_templates : [])
        setAudienceLocks(c.audience_locks || {})
        setPromotedBusiness(c.promoted_business || null)
        setResearchUrls(Array.isArray(c.research_urls) ? c.research_urls : [])
        setBlogIndexSize(Number(c.blog_index_size) || 25)
        setEvictStrategy(c.blog_index_evict_strategy || 'sliding')
        setBlogSchedule(c.blog_schedule || null)
        setZerogptThreshold(c.zerogpt_threshold_percent ?? null)
      })
      .catch(e => { if (!cancelled) setError(e?.message || String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const flashSaved = (section) => {
    setSavedFlash(section)
    setTimeout(() => setSavedFlash(null), 1500)
  }

  const save = async (section, patch) => {
    setSavingSection(section)
    setError(null)
    try {
      const result = await api.updateContentConfig(patch)
      setConfig(result)
      flashSaved(section)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setSavingSection(null)
    }
  }

  if (loading) return <div className="text-[12px] text-muted">Loading config…</div>

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2 text-[11px] text-[#c0392b]">
          {error}
        </div>
      )}

      {/* ── Enabled templates ─────────────────────────────────── */}
      <Section
        title="Enabled templates"
        hint="Pick the content types this tenant produces. Hidden templates don't appear in the topic-ideation UI."
        onSave={() => save('templates', { enabled_templates: enabledTemplates })}
        saving={savingSection === 'templates'}
        saved={savedFlash === 'templates'}
      >
        <div className="space-y-1">
          {ALL_TEMPLATES.map(t => {
            const checked = enabledTemplates.includes(t.key)
            return (
              <label key={t.key} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={e => {
                    setEnabledTemplates(prev => e.target.checked
                      ? [...new Set([...prev, t.key])]
                      : prev.filter(k => k !== t.key)
                    )
                  }}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-[11px] font-medium">{t.label}</div>
                  <div className="text-[10px] text-muted">{t.hint}</div>
                </div>
              </label>
            )
          })}
        </div>
      </Section>

      {/* ── Audience locks per enabled template ──────────────── */}
      <Section
        title="Audience locks"
        hint="Who is the implied reader for each content type? Strong locks produce sharply targeted writing — be specific. Vague locks produce generic content."
        onSave={() => save('audience', { audience_locks: audienceLocks })}
        saving={savingSection === 'audience'}
        saved={savedFlash === 'audience'}
        disabled={enabledTemplates.length === 0}
        disabledHint="Enable a template above first."
      >
        <div className="space-y-2">
          {enabledTemplates.length === 0 ? (
            <div className="text-[10px] text-muted italic">Enable a template above to configure its audience.</div>
          ) : enabledTemplates.map(key => {
            const t = ALL_TEMPLATES.find(x => x.key === key)
            const value = audienceLocks[key] || ''
            return (
              <div key={key}>
                <label className="text-[10px] font-medium text-ink">{t?.label || key}</label>
                <textarea
                  value={value}
                  onChange={e => setAudienceLocks(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={DEFAULT_AUDIENCE_HINTS[key] || 'Describe the implied reader in 1-3 sentences.'}
                  rows={3}
                  className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 resize-y"
                />
              </div>
            )
          })}
        </div>
      </Section>

      {/* ── Promoted business ─────────────────────────────────── */}
      <PromotedBusinessSection
        value={promotedBusiness}
        onChange={setPromotedBusiness}
        onSave={(fresh) => save('promoted', { promoted_business: fresh })}
        saving={savingSection === 'promoted'}
        saved={savedFlash === 'promoted'}
      />

      {/* ── Research URLs ─────────────────────────────────────── */}
      <ResearchUrlsSection
        value={researchUrls}
        onChange={setResearchUrls}
        onSave={() => save('research', { research_urls: researchUrls })}
        saving={savingSection === 'research'}
        saved={savedFlash === 'research'}
      />

      {/* ── Indexer behavior ──────────────────────────────────── */}
      <Section
        title="Indexer behavior"
        hint="How many of your existing CMS posts to keep indexed for internal-link suggestions. Daily cron refreshes."
        onSave={() => save('indexer', {
          blog_index_size: Number(blogIndexSize),
          blog_index_evict_strategy: evictStrategy,
        })}
        saving={savingSection === 'indexer'}
        saved={savedFlash === 'indexer'}
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-medium block mb-0.5">Index size</label>
            <input
              type="number" min="1" max="500"
              value={blogIndexSize}
              onChange={e => setBlogIndexSize(e.target.value)}
              className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
            />
            <div className="text-[9px] text-muted mt-0.5">1–500. Default 25.</div>
          </div>
          <div>
            <label className="text-[10px] font-medium block mb-0.5">Eviction strategy</label>
            <select
              value={evictStrategy}
              onChange={e => setEvictStrategy(e.target.value)}
              className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
            >
              <option value="sliding">Sliding window (most recent only)</option>
              <option value="cumulative">Cumulative (keep older evergreen content)</option>
            </select>
            <div className="text-[9px] text-muted mt-0.5">Sliding evicts when size cap is hit. Cumulative keeps everything until cap.</div>
          </div>
        </div>
      </Section>

      {/* ── Blog schedule ─────────────────────────────────────── */}
      <BlogScheduleSection
        value={blogSchedule}
        onChange={setBlogSchedule}
        onSave={() => save('schedule', { blog_schedule: blogSchedule })}
        saving={savingSection === 'schedule'}
        saved={savedFlash === 'schedule'}
      />

      {/* ── ZeroGPT threshold ─────────────────────────────────── */}
      <Section
        title="ZeroGPT threshold (optional)"
        hint="Drafts scoring above this % AI-detected get flagged for manual review and won't auto-schedule. Leave blank to disable the gate (score is still saved)."
        onSave={() => save('zerogpt', {
          zerogpt_threshold_percent: zerogptThreshold === '' || zerogptThreshold == null ? null : Number(zerogptThreshold),
        })}
        saving={savingSection === 'zerogpt'}
        saved={savedFlash === 'zerogpt'}
      >
        <div className="flex items-center gap-2">
          <input
            type="number" min="0" max="100"
            value={zerogptThreshold ?? ''}
            placeholder="(disabled)"
            onChange={e => setZerogptThreshold(e.target.value)}
            className="text-[11px] border border-[#e5e5e5] rounded p-1.5 w-24"
          />
          <span className="text-[10px] text-muted">% (e.g. 30 means flag at 30% AI)</span>
        </div>
      </Section>
    </div>
  )
}

// ── Reusable section shell ───────────────────────────────────────
function Section({ title, hint, onSave, saving, saved, disabled, disabledHint, children }) {
  return (
    <div className="bg-white border border-[#e5e5e5] rounded p-3">
      <div className="flex items-start gap-2 mb-2">
        <div className="flex-1">
          <h3 className="text-[12px] font-medium">{title}</h3>
          {hint && <p className="text-[10px] text-muted leading-snug">{hint}</p>}
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={disabled || saving}
          className="text-[11px] py-1 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-medium whitespace-nowrap"
          title={disabled ? disabledHint : 'Save this section'}
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
        </button>
      </div>
      {children}
    </div>
  )
}

// ── Promoted business form ───────────────────────────────────────
function PromotedBusinessSection({ value, onChange, onSave, saving, saved }) {
  const v = value || {}
  const patch = (k, val) => onChange({ ...v, [k]: val })

  // owned_categories is a string in the input but an array in the
  // saved config. Tracking a local string state lets the user type
  // spaces, commas, and trailing whitespace without each keystroke
  // round-tripping through split/trim/filter (which ate spaces and
  // trailing commas while typing). Sync to the array on blur and on
  // initial load.
  const [categoriesText, setCategoriesText] = useState(
    Array.isArray(v.owned_categories) ? v.owned_categories.join(', ') : ''
  )
  // Re-sync if the upstream array changes (e.g. after a save round-
  // trips and we receive the canonical array back from the BE).
  useEffect(() => {
    const incoming = Array.isArray(v.owned_categories) ? v.owned_categories.join(', ') : ''
    // Only adopt the upstream value when the local string would
    // round-trip to the same array — prevents stomping mid-typing
    // when the parent re-renders for an unrelated reason.
    const localAsArray = categoriesText.split(',').map(s => s.trim()).filter(Boolean)
    const upstreamArr = Array.isArray(v.owned_categories) ? v.owned_categories : []
    const sameArray = localAsArray.length === upstreamArr.length
      && localAsArray.every((s, i) => s === upstreamArr[i])
    if (!sameArray) setCategoriesText(incoming)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.owned_categories])

  const commitCategories = () => {
    const parsed = categoriesText.split(',').map(s => s.trim()).filter(Boolean)
    patch('owned_categories', parsed)
  }

  // Build the canonical value at save-time. categoriesText is the
  // source of truth for owned_categories (the upstream array gets
  // re-synced via the effect above on round-trip). Avoids the async
  // race where blur → patch → setState lags behind the Save click.
  const handleSave = () => {
    const parsed = categoriesText.split(',').map(s => s.trim()).filter(Boolean)
    const fresh = { ...(v || {}), owned_categories: parsed }
    onChange(fresh)        // sync parent state for next render
    onSave(fresh)          // pass fresh value directly — no closure staleness
  }

  return (
    <Section
      title="Promoted business"
      hint='The anchor brand (if any) — feature within its service radius for owned categories. Leave blank for editorial-only sites.'
      onSave={handleSave}
      saving={saving}
      saved={saved}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-[10px] font-medium block mb-0.5">Business name</label>
          <input
            type="text"
            value={v.name || ''}
            onChange={e => patch('name', e.target.value)}
            placeholder="Poppy & Thyme"
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
          />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] font-medium block mb-0.5">Address (origin)</label>
          <input
            type="text"
            value={v.origin_address || ''}
            onChange={e => patch('origin_address', e.target.value)}
            placeholder="123 Main St, Milwaukee, WI"
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium block mb-0.5">Latitude</label>
          <input
            type="number" step="0.0001"
            value={v.origin_lat ?? ''}
            onChange={e => patch('origin_lat', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="43.0389"
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium block mb-0.5">Longitude</label>
          <input
            type="number" step="0.0001"
            value={v.origin_lng ?? ''}
            onChange={e => patch('origin_lng', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="-87.9065"
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
          />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] font-medium block mb-0.5">Service radius (miles)</label>
          <input
            type="number" min="1" max="5000"
            value={v.service_radius_miles ?? ''}
            onChange={e => patch('service_radius_miles', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="75"
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
          />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] font-medium block mb-0.5">Owned categories (comma-separated)</label>
          <input
            type="text"
            value={categoriesText}
            onChange={e => setCategoriesText(e.target.value)}
            onBlur={commitCategories}
            placeholder="candle bar, perfume bar, soap bar"
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
          />
          <div className="text-[9px] text-muted mt-0.5">
            In-region content on these categories: feature this brand, suppress competitors.
            Out-of-region content: no special handling.
          </div>
        </div>
      </div>
    </Section>
  )
}

// ── Research URLs editor ─────────────────────────────────────────
function ResearchUrlsSection({ value, onChange, onSave, saving, saved }) {
  const [draft, setDraft] = useState('')
  const list = Array.isArray(value) ? value : []
  return (
    <Section
      title="Research URLs"
      hint='Competitor / inspiration sites the topic-ideation tool can reference for ideas. Add full URLs (https://...).'
      onSave={onSave}
      saving={saving}
      saved={saved}
    >
      <div className="space-y-2">
        <div className="flex gap-1">
          <input
            type="url"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="https://example.com"
            className="flex-1 text-[11px] border border-[#e5e5e5] rounded p-1.5"
          />
          <button
            type="button"
            onClick={() => {
              if (!draft.trim()) return
              try { new URL(draft) } catch { return }
              onChange([...new Set([...list, draft.trim()])])
              setDraft('')
            }}
            className="text-[11px] py-1 px-3 bg-white border border-[#e5e5e5] text-ink rounded cursor-pointer"
          >Add</button>
        </div>
        <ul className="space-y-1">
          {list.length === 0 && <li className="text-[10px] text-muted italic">No research URLs yet.</li>}
          {list.map((u, i) => (
            <li key={u} className="flex items-center gap-2 text-[10px]">
              <span className="flex-1 truncate" title={u}>{u}</span>
              <button
                type="button"
                onClick={() => onChange(list.filter((_, j) => j !== i))}
                className="text-[#c0392b] bg-transparent border-none cursor-pointer hover:underline"
              >remove</button>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  )
}

// ── Blog schedule editor ─────────────────────────────────────────
const DAY_OPTIONS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

function BlogScheduleSection({ value, onChange, onSave, saving, saved }) {
  const v = value || {}
  const patch = (k, val) => onChange({ ...v, [k]: val })
  const days = Array.isArray(v.days) ? v.days : []
  return (
    <Section
      title="Blog schedule (optional)"
      hint="Auto-slot accepted drafts into recurring publish times. Leave blank to require manual scheduling per post."
      onSave={onSave}
      saving={saving}
      saved={saved}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-medium block mb-0.5">Posts per week</label>
          <input
            type="number" min="1" max="14"
            value={v.posts_per_week ?? ''}
            onChange={e => patch('posts_per_week', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="2"
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium block mb-0.5">Time (24h, local)</label>
          <input
            type="time"
            value={v.time_local || ''}
            onChange={e => patch('time_local', e.target.value || null)}
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
          />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] font-medium block mb-0.5">Days</label>
          <div className="flex flex-wrap gap-1">
            {DAY_OPTIONS.map(d => {
              const on = days.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => patch('days', on ? days.filter(x => x !== d) : [...days, d])}
                  className={`text-[10px] py-1 px-2 rounded border cursor-pointer ${
                    on
                      ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]'
                      : 'bg-white text-ink border-[#e5e5e5]'
                  }`}
                >{d.slice(0, 3)}</button>
              )
            })}
          </div>
        </div>
        <div>
          <label className="text-[10px] font-medium block mb-0.5">Timezone</label>
          <input
            type="text"
            value={v.timezone || ''}
            onChange={e => patch('timezone', e.target.value || null)}
            placeholder="America/Chicago"
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium block mb-0.5">Edit window (hours)</label>
          <input
            type="number" min="0" max="168" step="0.5"
            value={v.edit_window_hours ?? 2}
            onChange={e => patch('edit_window_hours', Number(e.target.value))}
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
          />
          <div className="text-[9px] text-muted mt-0.5">Cooling-off before auto-publish.</div>
        </div>
      </div>
    </Section>
  )
}
