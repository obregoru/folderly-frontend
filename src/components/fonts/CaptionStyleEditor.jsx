import { useEffect, useState } from 'react'
import * as api from '../../api'
import FontPicker from './FontPicker'

/**
 * Minimal caption-style authoring UI (Phase 4.5). Wired to a single
 * voiceover segment via its (jobUuid, segmentId) pair. The point is
 * to unblock end-to-end testing of the Phase 1–3 pipeline with the
 * new visual font picker — not to be a final authoring experience.
 *
 * Shape matches the caption_styles row / PUT body: we send
 * camelCase → snake_case at the boundary since the backend's
 * whitelist expects column names.
 */
export default function CaptionStyleEditor({ jobUuid, segmentId, onClose }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const [baseFont, setBaseFont] = useState('Inter')
  const [baseColor, setBaseColor] = useState('#ffffff')
  const [activeColor, setActiveColor] = useState('#f59e0b')
  const [activeEnabled, setActiveEnabled] = useState(false)
  const [activeFont, setActiveFont] = useState('')
  const [activeFontEnabled, setActiveFontEnabled] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(null) // 'base' | 'active' | null

  useEffect(() => {
    if (!jobUuid || !segmentId) return
    setLoading(true)
    api.getCaptionStyle(jobUuid, segmentId).then(r => {
      const cs = r?.caption_style
      if (cs) {
        if (cs.base_font_family) setBaseFont(cs.base_font_family)
        if (cs.base_font_color) setBaseColor(cs.base_font_color)
        if (cs.active_word_color) { setActiveColor(cs.active_word_color); setActiveEnabled(true) }
        if (cs.active_word_font_family) { setActiveFont(cs.active_word_font_family); setActiveFontEnabled(true) }
      }
    }).finally(() => setLoading(false))
  }, [jobUuid, segmentId])

  const save = async () => {
    setSaving(true); setErr(null)
    try {
      await api.saveCaptionStyle(jobUuid, segmentId, {
        base_font_family: baseFont,
        base_font_color: baseColor,
        active_word_color: activeEnabled ? activeColor : null,
        active_word_font_family: activeFontEnabled && activeFont ? activeFont : null,
      })
      onClose?.()
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-[11px] text-muted italic text-center py-4">Loading caption style…</div>

  return (
    <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-lg p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">Caption style</div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-[10px] text-muted bg-transparent border-none cursor-pointer"
          >✕ close</button>
        )}
      </div>

      {/* Base font */}
      <div className="space-y-1">
        <label className="text-[10px] font-medium">Base font</label>
        <button
          type="button"
          onClick={() => setPickerOpen(pickerOpen === 'base' ? null : 'base')}
          className="w-full flex items-center gap-2 bg-white border border-[#e5e5e5] rounded py-1.5 px-2 cursor-pointer hover:border-[#6C5CE7]/50"
        >
          <span
            className="flex-1 text-left text-[14px] truncate"
            style={{ fontFamily: `'${baseFont}', system-ui, sans-serif` }}
          >The quick brown fox</span>
          <span className="text-[9px] text-muted">{baseFont}</span>
          <span className="text-[10px] text-muted">{pickerOpen === 'base' ? '▾' : '▸'}</span>
        </button>
        {pickerOpen === 'base' && (
          <FontPicker
            value={baseFont}
            purpose="base"
            onChange={f => { setBaseFont(f); setPickerOpen(null) }}
          />
        )}
      </div>

      {/* Base color */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] font-medium flex-1">Base color</label>
        <input
          type="color"
          value={baseColor}
          onChange={e => setBaseColor(e.target.value)}
          className="w-8 h-6 border border-[#e5e5e5] rounded cursor-pointer p-0"
          aria-label="Base caption color"
        />
        <span className="font-mono text-[10px] text-muted">{baseColor}</span>
      </div>

      {/* Active color */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[10px] flex-1 cursor-pointer">
          <input
            type="checkbox"
            checked={activeEnabled}
            onChange={e => setActiveEnabled(e.target.checked)}
          />
          <span className="font-medium">Active-word color</span>
        </label>
        <input
          type="color"
          value={activeColor}
          onChange={e => setActiveColor(e.target.value)}
          disabled={!activeEnabled}
          className="w-8 h-6 border border-[#e5e5e5] rounded cursor-pointer p-0 disabled:opacity-40"
          aria-label="Active-word color"
        />
        <span className="font-mono text-[10px] text-muted">{activeEnabled ? activeColor : '—'}</span>
      </div>

      {/* Active font */}
      <div className="space-y-1">
        <label className="flex items-center gap-1.5 text-[10px] font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={activeFontEnabled}
            onChange={e => setActiveFontEnabled(e.target.checked)}
          />
          <span>Active-word font</span>
        </label>
        {activeFontEnabled && (
          <>
            <button
              type="button"
              onClick={() => setPickerOpen(pickerOpen === 'active' ? null : 'active')}
              className="w-full flex items-center gap-2 bg-white border border-[#e5e5e5] rounded py-1.5 px-2 cursor-pointer hover:border-[#6C5CE7]/50"
            >
              <span
                className="flex-1 text-left text-[14px] truncate"
                style={{ fontFamily: activeFont ? `'${activeFont}', system-ui, sans-serif` : undefined }}
              >{activeFont || '— pick a font —'}</span>
              <span className="text-[9px] text-muted">{activeFont}</span>
              <span className="text-[10px] text-muted">{pickerOpen === 'active' ? '▾' : '▸'}</span>
            </button>
            {pickerOpen === 'active' && (
              <FontPicker
                value={activeFont}
                purpose="active"
                onChange={f => { setActiveFont(f); setPickerOpen(null) }}
              />
            )}
          </>
        )}
      </div>

      {err && <div className="text-[10px] text-[#c0392b]">{err}</div>}

      <div className="flex gap-1.5 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex-1 text-[11px] py-1.5 bg-[#2D9A5E] text-white border-none rounded cursor-pointer font-medium disabled:opacity-50"
        >{saving ? 'Saving…' : 'Save caption style'}</button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-[11px] py-1.5 px-3 bg-white border border-[#e5e5e5] rounded cursor-pointer text-muted"
          >Cancel</button>
        )}
      </div>
    </div>
  )
}
