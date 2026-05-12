// Watermark overlay controls. The IMAGE itself is tenant-level
// (uploaded under Settings → Watermark, stored on
// tenants.watermark_path); this section just sets WHERE / WHEN /
// HOW BIG the logo appears on the current draft via the
// watermark_settings JSONB on the job row.
//
// Live preview: broadcasts settings + tenant logo URL via
// window._postyWatermark + 'posty-watermark-change' event so
// FinalPreviewV2 can render a draggable + resizable preview on
// top of the merged video. Drag/resize fires
// 'posty-watermark-update' with a partial patch (x_pct, y_pct,
// size_pct) which this component picks up and persists.

import { useEffect, useRef, useState } from 'react'
import * as api from '../../api'

const DEFAULTS = {
  enabled: false,
  start_time: 0,
  end_time: null,
  x_pct: 95,
  y_pct: 95,
  size_pct: 15,
  opacity: 1.0,
}

export default function WatermarkSection({ draftId }) {
  const [tenantWatermark, setTenantWatermark] = useState(null) // { enabled, path, url }
  const [settings, setSettings] = useState(DEFAULTS)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  // Hydrate from the job on mount. The job GET surfaces both
  // watermark_settings (per-job) and tenant_watermark (enabled +
  // path + signed URL for preview) so a single fetch fills both.
  useEffect(() => {
    if (!draftId) return
    let cancelled = false
    setLoading(true)
    api.getJob(draftId).then(job => {
      if (cancelled) return
      setTenantWatermark(job?.tenant_watermark || { enabled: false, path: null, url: null })
      const ws = job?.watermark_settings || null
      setSettings(ws ? { ...DEFAULTS, ...ws } : DEFAULTS)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setErr(e?.message || String(e))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [draftId])

  // Broadcast settings + tenant logo so FinalPreviewV2's draggable
  // watermark layer stays in sync. Whole payload, not a diff — the
  // preview component just consumes the latest.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const payload = {
      ...settings,
      url: tenantWatermark?.url || null,
      hasLogo: !!tenantWatermark?.path,
    }
    window._postyWatermark = payload
    window.dispatchEvent(new CustomEvent('posty-watermark-change', { detail: payload }))
  }, [settings, tenantWatermark])

  // Save on every field change, debounced. Numeric coercion +
  // clamp matches what the BE will do anyway, so optimistic
  // updates render cleanly.
  const saveTimer = useRef(null)
  const persist = (nextSettings) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      saveTimer.current = null
      setSaving(true)
      setErr(null)
      try {
        await api.setJobWatermark(draftId, nextSettings)
      } catch (e) {
        setErr(e?.message || String(e))
      } finally {
        setSaving(false)
      }
    }, 500)
  }
  const updateField = (patch) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      persist(next)
      return next
    })
  }

  // Listen for drag/resize updates from the preview overlay. Each
  // event carries a partial patch ({ x_pct?, y_pct?, size_pct? })
  // which we apply on top of current settings + persist.
  useEffect(() => {
    const onUpdate = (e) => {
      const patch = e?.detail || {}
      if (!patch || typeof patch !== 'object') return
      updateField(patch)
    }
    window.addEventListener('posty-watermark-update', onUpdate)
    return () => window.removeEventListener('posty-watermark-update', onUpdate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId])

  if (loading) {
    return <div className="text-[11px] text-muted italic py-2 text-center">Loading watermark…</div>
  }

  const hasLogo = !!tenantWatermark?.path

  return (
    <div className="border-t border-[#e5e5e5] pt-3 mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">🏷️ Watermark</div>
        {saving && <span className="text-[9px] text-muted italic">saving…</span>}
        {err && <span className="text-[9px] text-[#c0392b]">{err}</span>}
      </div>

      {!hasLogo && (
        <div className="text-[10px] text-[#8a4b00] bg-[#fff7e6] border border-[#f5a623]/40 rounded p-2">
          No tenant watermark uploaded yet. Add one under <b>Settings → Watermark</b>; then come back to position it on this draft.
        </div>
      )}

      {hasLogo && (
        <>
          <div className="flex items-start gap-3">
            {tenantWatermark.url && (
              <div className="w-[60px] h-[60px] bg-[#f0f0f0] border border-[#e5e5e5] rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                <img
                  src={tenantWatermark.url}
                  alt="tenant watermark"
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            )}
            <label className="flex items-start gap-1.5 text-[11px] cursor-pointer">
              <input
                type="checkbox"
                checked={!!settings.enabled}
                onChange={e => updateField({ enabled: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                <b>Apply watermark on this draft.</b>
                <span className="text-[10px] text-muted block">
                  Off by default. Drag the watermark on the video above to position; corner handle resizes.
                </span>
              </span>
            </label>
          </div>

          {settings.enabled && (
            <div className="bg-[#fafafa] border border-[#e5e5e5] rounded p-2 space-y-1.5 text-[10px]">
              <div className="text-[10px] text-[#6C5CE7] italic pb-1 border-b border-[#e5e5e5]">
                ✋ Drag the logo on the video preview to position it. Corner handle resizes.
              </div>
              <NumberRow
                label="Start time"
                hint="seconds into the video"
                value={settings.start_time}
                min={0} max={3600} step={0.1}
                onChange={v => updateField({ start_time: v })}
                suffix="s"
              />
              <NumberRow
                label="End time"
                hint="leave blank for persistent until end of video"
                value={settings.end_time}
                min={0.05} max={3600} step={0.1}
                onChange={v => updateField({ end_time: v })}
                suffix="s"
                nullable
                clearLabel="persistent"
              />
              <NumberRow
                label="X position"
                hint="0 = left edge, 100 = right edge"
                value={settings.x_pct}
                min={0} max={100} step={1}
                onChange={v => updateField({ x_pct: v })}
                suffix="%"
              />
              <NumberRow
                label="Y position"
                hint="0 = top, 100 = bottom"
                value={settings.y_pct}
                min={0} max={100} step={1}
                onChange={v => updateField({ y_pct: v })}
                suffix="%"
              />
              <NumberRow
                label="Size"
                hint="% of frame width"
                value={settings.size_pct}
                min={5} max={100} step={1}
                onChange={v => updateField({ size_pct: v })}
                suffix="%"
              />
              <NumberRow
                label="Opacity"
                hint="0.05 = nearly invisible, 1 = solid"
                value={settings.opacity}
                min={0.05} max={1} step={0.05}
                onChange={v => updateField({ opacity: v })}
                suffix=""
              />
              <CornerPresets onPick={(x, y) => updateField({ x_pct: x, y_pct: y })} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function NumberRow({ label, hint, value, min, max, step, onChange, suffix, nullable, clearLabel }) {
  const displayValue = value === null || value === undefined ? '' : value
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-muted w-20 shrink-0">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={displayValue}
        onChange={e => {
          const raw = e.target.value
          if (raw === '' && nullable) {
            onChange(null)
            return
          }
          const n = Number(raw)
          if (Number.isFinite(n)) onChange(n)
        }}
        className="w-16 border border-[#e5e5e5] rounded px-1 py-0.5 text-[10px] font-mono"
      />
      {suffix && <span className="text-muted">{suffix}</span>}
      <span className="text-[9px] text-muted italic">{hint}</span>
      {nullable && value !== null && value !== undefined && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-auto text-[9px] py-0.5 px-1.5 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
          title={clearLabel || 'Clear'}
        >{clearLabel || 'Clear'}</button>
      )}
    </div>
  )
}

// Quick-pick corner buttons that set x_pct / y_pct together to a
// standard corner position. Faster than nudging both sliders.
function CornerPresets({ onPick }) {
  const PRESETS = [
    { label: 'TL', x: 5, y: 5 },
    { label: 'TR', x: 95, y: 5 },
    { label: 'BL', x: 5, y: 95 },
    { label: 'BR', x: 95, y: 95 },
    { label: 'Center', x: 50, y: 50 },
  ]
  return (
    <div className="flex items-center gap-1.5 pt-1 border-t border-[#e5e5e5] mt-1">
      <span className="text-muted">Corner</span>
      {PRESETS.map(p => (
        <button
          key={p.label}
          type="button"
          onClick={() => onPick(p.x, p.y)}
          className="text-[9px] py-0.5 px-1.5 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer"
          title={`x=${p.x}% y=${p.y}%`}
        >{p.label}</button>
      ))}
    </div>
  )
}
