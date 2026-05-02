// Tenant-level overlay/caption defaults editor. Lets a tenant admin
// pin the brand's font family, colors, per-slot sizes, and Y placement
// in one place. New jobs inherit these. The producer's "Apply &
// generate" flow also pulls them when setting font sizes after a
// final package lands.

import { useState } from 'react'
import * as api from '../../api'

const DEFAULT_VALUES = {
  fontFamily: '',
  fontColor: '',
  fontOutline: '',
  outlineWidth: '',
  openingFontSize: '',
  middleFontSize: '',
  closingFontSize: '',
  captionFontSize: '',
  openingYPct: '',
  middleYPct: '',
  closingYPct: '',
  captionYPct: '',
}

const FONT_OPTIONS = [
  { v: '', label: 'Inter (default)' },
  { v: 'Inter', label: 'Inter' },
  { v: 'Bebas Neue', label: 'Bebas Neue' },
  { v: 'Anton', label: 'Anton' },
  { v: 'Oswald', label: 'Oswald' },
  { v: 'Montserrat', label: 'Montserrat' },
  { v: 'Roboto', label: 'Roboto' },
  { v: 'Poppins', label: 'Poppins' },
  { v: 'Impact', label: 'Impact' },
  { v: 'Comic Neue', label: 'Comic Neue' },
]

export default function OverlayDefaultsForm({ settings, onSaved }) {
  const initial = { ...DEFAULT_VALUES, ...(settings.default_overlay_style || {}) }
  const [values, setValues] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  const set = (k, v) => setValues(prev => ({ ...prev, [k]: v }))

  // Build the payload — strip empty strings so the BE reads them as
  // "not set" and the safe-area fallback kicks in. Numbers get coerced.
  const buildPayload = () => {
    const out = {}
    for (const [k, v] of Object.entries(values)) {
      if (v === '' || v == null) continue
      if (k.endsWith('FontSize') || k.endsWith('YPct') || k === 'outlineWidth') {
        const n = Number(v)
        if (Number.isFinite(n)) out[k] = n
      } else {
        out[k] = String(v)
      }
    }
    return out
  }

  const save = async () => {
    setSaving(true); setMsg(null); setErr(null)
    try {
      const payload = { default_overlay_style: buildPayload() }
      await api.saveSettings(payload)
      setMsg('Saved. New jobs will inherit these defaults.')
      onSaved?.()
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setValues({ ...DEFAULT_VALUES })
  }

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-muted">
        Leave any field blank to fall back to the safe-area default (Inter, white on black outline,
        ~80px sizes, Y at 70-75%). New drafts auto-inherit these. The producer's "Apply &amp; generate"
        flow also reads them when setting font sizes after a package applies.
      </div>

      <Group title="Font + colors">
        <Field label="Font family">
          <select value={values.fontFamily} onChange={e => set('fontFamily', e.target.value)} className={inp}>
            {FONT_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Font color">
          <ColorWithHex value={values.fontColor} onChange={v => set('fontColor', v)} placeholder="#FFFFFF" />
        </Field>
        <Field label="Outline color">
          <ColorWithHex value={values.fontOutline} onChange={v => set('fontOutline', v)} placeholder="#000000" />
        </Field>
        <Field label="Outline width" hint="px (3-6 typical)">
          <input type="number" min={0} max={20} step={1} value={values.outlineWidth}
            onChange={e => set('outlineWidth', e.target.value)} className={inp} placeholder="4" />
        </Field>
      </Group>

      <Group title="Overlay font sizes (px on 1080×1920)">
        <Row>
          <NumField label="Opening" value={values.openingFontSize} onChange={v => set('openingFontSize', v)} placeholder="90" />
          <NumField label="Middle"  value={values.middleFontSize}  onChange={v => set('middleFontSize',  v)} placeholder="80" />
          <NumField label="Closing" value={values.closingFontSize} onChange={v => set('closingFontSize', v)} placeholder="90" />
        </Row>
        <Field label="VO synced caption size" hint="px — applies to word-timing captions">
          <input type="number" min={20} max={200} step={1} value={values.captionFontSize}
            onChange={e => set('captionFontSize', e.target.value)} className={inp} placeholder="80" />
        </Field>
      </Group>

      <Group title="Y placement (% of frame, 0=top, 100=bottom)">
        <Row>
          <NumField label="Opening" value={values.openingYPct} onChange={v => set('openingYPct', v)} placeholder="70" min={0} max={100} />
          <NumField label="Middle"  value={values.middleYPct}  onChange={v => set('middleYPct',  v)} placeholder="70" min={0} max={100} />
          <NumField label="Closing" value={values.closingYPct} onChange={v => set('closingYPct', v)} placeholder="70" min={0} max={100} />
        </Row>
        <Field label="VO captions Y" hint="0-100, ~75 sits above platform UI chrome">
          <input type="number" min={0} max={100} step={1} value={values.captionYPct}
            onChange={e => set('captionYPct', e.target.value)} className={inp} placeholder="75" />
        </Field>
      </Group>

      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="text-[11px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
        >{saving ? 'Saving…' : 'Save defaults'}</button>
        <button
          type="button"
          onClick={reset}
          disabled={saving}
          className="text-[11px] py-1.5 px-3 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
        >Clear all</button>
        {msg && <span className="text-[10px] text-[#2D9A5E]">{msg}</span>}
        {err && <span className="text-[10px] text-[#c0392b]">{err}</span>}
      </div>
    </div>
  )
}

const inp = 'w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white'

function Group({ title, children }) {
  return (
    <div className="border border-[#e5e5e5] rounded p-2 space-y-1.5">
      <div className="text-[11px] font-medium text-ink">{title}</div>
      {children}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="text-[10px] text-muted mb-0.5">
        {label}{hint && <span className="ml-1 italic text-[#999]">— {hint}</span>}
      </div>
      {children}
    </label>
  )
}

function Row({ children }) {
  return <div className="grid grid-cols-3 gap-1.5">{children}</div>
}

function NumField({ label, value, onChange, placeholder, min = 20, max = 200 }) {
  return (
    <label className="block">
      <div className="text-[10px] text-muted mb-0.5">{label}</div>
      <input type="number" min={min} max={max} step={1} value={value}
        onChange={e => onChange(e.target.value)} className={inp} placeholder={placeholder} />
    </label>
  )
}

// Color picker + hex text input that stay in sync. Empty = "no override."
function ColorWithHex({ value, onChange, placeholder }) {
  const swatch = value || '#000000'
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
        onChange={e => onChange(e.target.value)}
        className="w-8 h-8 border border-[#e5e5e5] rounded cursor-pointer"
        style={{ background: swatch }}
      />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white font-mono"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="text-[10px] text-muted underline"
          title="Clear (use safe-area default)"
        >clear</button>
      )}
    </div>
  )
}
