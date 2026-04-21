import { useEffect, useState } from 'react'
import * as api from '../../api'
import FontPicker from './FontPicker'
import CaptionPresetPicker from './CaptionPresetPicker'

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
  const [presetsOpen, setPresetsOpen] = useState(false)

  // Apply a preset: overwrite every local state field with the preset's
  // config. Skips the PUT — the user still has to click "Save caption
  // style" so they can tweak first. This mirrors the "customize from
  // preset" flow in the Phase 6.4 spec.
  const applyPreset = (preset) => {
    const c = preset.config
    if (c.base_font_family) setBaseFont(c.base_font_family)
    if (c.base_font_color) setBaseColor(c.base_font_color)
    if (c.active_word_color) {
      setActiveColor(c.active_word_color); setActiveEnabled(true)
    } else {
      setActiveEnabled(false)
    }
    if (c.active_word_font_family) {
      setActiveFont(c.active_word_font_family); setActiveFontEnabled(true)
    } else {
      setActiveFontEnabled(false)
    }
    // Keep the preset's full config in memory so Save sends animation /
    // reveal / outline / layout too (this UI doesn't yet surface those
    // fields for direct editing; they ride along from the preset).
    setPendingConfig(c)
    setPresetsOpen(false)
  }
  const [pendingConfig, setPendingConfig] = useState(null)

  // Preview state — small Remotion-rendered clip we fetch after save.
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewErr, setPreviewErr] = useState(null)

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
      // If the user clicked a preset, ride its full config through
      // (outline, layout, animation, reveal) so the backend gets
      // everything the preset intends. The individual font/color
      // fields the user tweaked after applying the preset still win.
      const body = {
        ...(pendingConfig || {}),
        base_font_family: baseFont,
        base_font_color: baseColor,
        active_word_color: activeEnabled ? activeColor : null,
        active_word_font_family: activeFontEnabled && activeFont ? activeFont : null,
      }
      await api.saveCaptionStyle(jobUuid, segmentId, body)
      // Fire a preview render in the background — don't block the close.
      triggerPreview()
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  // Trigger a short Remotion preview of this segment via /video/render
  // with preview=true. Runs after save (or on demand via the Preview
  // button) so the user can check that their configured style actually
  // looks right before rendering the full 30s clip.
  const triggerPreview = async () => {
    setPreviewLoading(true); setPreviewErr(null)
    try {
      // Look up this segment's video + audio URLs so we can feed them
      // into the preview endpoint. Uses the getJob we already load
      // caption styles from, so this extra fetch stays cheap.
      const job = await api.getJob(jobUuid)
      const seg = (job?.voiceover_settings?.segments || []).find(s => s?.id === segmentId)
      if (!job?.merged_video_url || !seg?.audioUrl) {
        throw new Error('preview needs a merged video + segment audio')
      }
      const r = await api.renderSegmentPreview({
        jobUuid,
        segmentId,
        videoUrl: job.merged_video_url,
        audioUrl: seg.audioUrl,
        text: seg.text || 'preview',
        platform: 'vertical',
      })
      if (r?.video_url) setPreviewUrl(r.video_url)
    } catch (e) {
      setPreviewErr(e.message || String(e))
    } finally {
      setPreviewLoading(false)
    }
  }

  if (loading) return <div className="text-[11px] text-muted italic text-center py-4">Loading caption style…</div>

  return (
    <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-lg p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">Caption style</div>
        <button
          onClick={() => setPresetsOpen(v => !v)}
          className="text-[10px] py-1 px-2 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer"
          title="Start from a preset — you can still customize below"
        >{presetsOpen ? '✕' : '🎭'} presets</button>
        {onClose && (
          <button
            onClick={onClose}
            className="text-[10px] text-muted bg-transparent border-none cursor-pointer"
          >✕ close</button>
        )}
      </div>

      {presetsOpen && (
        <CaptionPresetPicker onApply={applyPreset} />
      )}

      {/* Preview — 4-second Remotion render at half-res. Shows up after
          the first Save, so the user sees their style as it will ship
          (active-word effects, animations, reveals, fonts). Re-renders
          on every subsequent Save. */}
      <div className="bg-black rounded overflow-hidden relative aspect-[9/16] max-h-[40vh] mx-auto">
        {previewLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-white/80 text-[11px] bg-black/60">
            <div className="text-center">
              <div className="text-[10px] animate-pulse">Rendering preview…</div>
              <div className="text-[9px] text-white/50 mt-1">~5–8 seconds</div>
            </div>
          </div>
        )}
        {previewUrl ? (
          <video
            key={previewUrl}
            src={previewUrl}
            controls
            playsInline
            autoPlay
            muted={false}
            className="w-full h-full object-contain bg-black"
          />
        ) : !previewLoading ? (
          <div className="flex items-center justify-center h-full text-white/50 text-[11px] px-4 text-center">
            Save caption style to render a 4-second preview here.
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={triggerPreview}
          disabled={previewLoading}
          className="text-[10px] py-1 px-2 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-50"
        >{previewLoading ? 'Rendering…' : '▶ Preview now'}</button>
        {previewErr && <span className="text-[9px] text-[#c0392b]">{previewErr}</span>}
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
