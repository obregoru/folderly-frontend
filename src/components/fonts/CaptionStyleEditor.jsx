import { useEffect, useRef, useState } from 'react'
import * as api from '../../api'
import FontPicker from './FontPicker'
import CaptionPresetPicker from './CaptionPresetPicker'
import { CAPTION_PRESETS } from '../../lib/captionPresets/catalog'

/**
 * Caption-style authoring UI. Two modes:
 *
 *   mode='segment'  — (default) edits ONE segment's caption_styles row.
 *                     Shows inheritance banner + "Use job default"
 *                     button + "Set as default" on preset picker.
 *
 *   mode='default'  — edits the JOB-LEVEL default_caption_style that
 *                     applies to every segment without its own row.
 *                     No inheritance banner, and the Save button
 *                     writes to PUT /jobs/:id/default-caption-style.
 *
 * Preview: this editor used to mount a small Remotion-rendered clip
 * after Save so users could check the style. That preview got retired
 * once InlineCaptionOverlay started painting live captions directly
 * on the main editor video — the video at the top of the form IS the
 * preview now, so saving the style immediately reflects there.
 *
 * Shape matches the caption_styles row / PUT body: we send camelCase
 * → snake_case at the boundary since the backend's whitelist expects
 * column names.
 */
export default function CaptionStyleEditor({ jobUuid, segmentId, onClose, mode = 'segment' }) {
  const isDefault = mode === 'default'
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const [baseFont, setBaseFont] = useState('Inter')
  const [baseColor, setBaseColor] = useState('#ffffff')
  // baseFontSize is "1080-reference px" — CaptionLayer scales by
  // width/1080 so 60 here = ~5.5% of frame width on every render
  // resolution. null lets the aspect-ratio default win (~5.5% via
  // the minDim * 0.055 fallback).
  const [baseFontSize, setBaseFontSize] = useState(null)
  const [activeColor, setActiveColor] = useState('#f59e0b')
  const [activeEnabled, setActiveEnabled] = useState(false)
  const [activeFont, setActiveFont] = useState('')
  const [activeFontEnabled, setActiveFontEnabled] = useState(false)
  // Outline / glow on the active word. Shape: { type: 'outline' | 'neon',
  // color: '#hex', width: number, blur?: number }. null = no outline.
  // Stored on active_word_outline_config (JSONB).
  const [outlineEnabled, setOutlineEnabled] = useState(false)
  const [outlineType, setOutlineType] = useState('outline') // 'outline' | 'neon'
  const [outlineColor, setOutlineColor] = useState('#000000')
  const [outlineWidth, setOutlineWidth] = useState(3)
  const [outlineBlur, setOutlineBlur] = useState(8)
  // Outline applied to ALL caption text (not just the active word).
  // Stored inside layout_config.baseOutline so we don't need a new
  // BE column / migration; CaptionLayer composes it onto baseStyle's
  // textShadow before words render. Same shape as active-word
  // outline so the UI maps 1:1.
  const [baseOutlineEnabled, setBaseOutlineEnabled] = useState(false)
  const [baseOutlineType, setBaseOutlineType] = useState('outline')
  const [baseOutlineColor, setBaseOutlineColor] = useState('#000000')
  const [baseOutlineWidth, setBaseOutlineWidth] = useState(3)
  const [baseOutlineBlur, setBaseOutlineBlur] = useState(8)
  // Vertical anchor as % from top of composition. null means "use the
  // aspect-ratio default" (72% on 9:16, 78% on 1:1). User interaction
  // with the slider replaces null with a concrete number; the label
  // shows "default (72%)" while null.
  const [verticalPosition, setVerticalPosition] = useState(null)
  // Halo behind text (default drop-shadow + glow stack) toggle.
  // false / undefined = halo on (default); true = halo off.
  // Stored in layout_config.haloDisabled. Box-style backgrounds
  // never get the halo regardless of this toggle (the pill already
  // provides legibility) — see CaptionLayer.tsx for that gate.
  const [haloDisabled, setHaloDisabled] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(null) // 'base' | 'active' | null
  const [presetsOpen, setPresetsOpen] = useState(false)

  // Which preset (if any) is currently applied to THIS segment. Set when
  // a preset is clicked; cleared whenever the user edits a field so the
  // picker only shows the "applied" ring when the form actually matches
  // a preset. On load, infer from the saved config via deep compare.
  const [appliedPresetId, setAppliedPresetId] = useState(null)

  // Which preset is the job-level default. Applied on top of every
  // segment that lacks its own row. Loaded on mount, updated whenever
  // the user presses "Set as default" on a preset.
  const [defaultPresetId, setDefaultPresetId] = useState(null)
  // Whether this segment currently has no per-segment caption_styles row
  // and is therefore inheriting from the job default. Controls the
  // "Inheriting job default" banner + the "Use job default" button.
  const [inheriting, setInheriting] = useState(false)

  // Apply a preset: overwrite every local state field with the preset's
  // config. Skips the PUT — the user still has to click "Save caption
  // style" so they can tweak first. This mirrors the "customize from
  // preset" flow in the Phase 6.4 spec.
  const applyPreset = (preset) => {
    const c = preset.config
    if (c.base_font_family) setBaseFont(c.base_font_family)
    if (c.base_font_color) setBaseColor(c.base_font_color)
    // Only overwrite the existing size when the preset explicitly
    // specifies one. The previous code wiped baseFontSize to null
    // for any preset that didn't include base_font_size (Bold Pill,
    // most others) — which then fell back to the small minDim×0.055
    // default, rendering microscopic captions on a small preview
    // even though every other segment had a proper size saved.
    if (typeof c.base_font_size === 'number') setBaseFontSize(c.base_font_size)
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
    // Outline config (Phase 2.5). null in the preset → user can still
    // toggle on with default values; non-null hydrates the form.
    const oc = c.active_word_outline_config
    if (oc && typeof oc === 'object') {
      setOutlineEnabled(true)
      setOutlineType(oc.type === 'neon' ? 'neon' : 'outline')
      if (oc.color) setOutlineColor(oc.color)
      if (typeof oc.width === 'number') setOutlineWidth(oc.width)
      if (typeof oc.blur === 'number') setOutlineBlur(oc.blur)
    } else {
      setOutlineEnabled(false)
    }
    // Sync the slider to whatever the preset specifies (or null to
    // fall back to the aspect-ratio default).
    const vp = c.layout_config?.verticalPosition
    setVerticalPosition(typeof vp === 'number' ? vp : null)
    // Base outline (applies to ALL caption text). Stored inside
    // layout_config so we don't need a new BE column.
    const baseOc = c.layout_config?.baseOutline
    if (baseOc && typeof baseOc === 'object') {
      setBaseOutlineEnabled(true)
      setBaseOutlineType(baseOc.type === 'neon' ? 'neon' : 'outline')
      if (baseOc.color) setBaseOutlineColor(baseOc.color)
      if (typeof baseOc.width === 'number') setBaseOutlineWidth(baseOc.width)
      if (typeof baseOc.blur === 'number') setBaseOutlineBlur(baseOc.blur)
    } else {
      setBaseOutlineEnabled(false)
    }
    setHaloDisabled(!!c.layout_config?.haloDisabled)
    // Keep the preset's full config in memory so Save sends animation /
    // reveal / outline / layout too (this UI doesn't yet surface those
    // fields for direct editing; they ride along from the preset).
    setPendingConfig(c)
    setAppliedPresetId(preset.id)
    setPresetsOpen(false)
  }
  const [pendingConfig, setPendingConfig] = useState(null)

  useEffect(() => {
    if (!jobUuid) return
    if (mode === 'segment' && !segmentId) return
    setLoading(true)
    if (isDefault) {
      // Default-mode: only the job default matters. Inheritance banner
      // is meaningless here (this IS what other segments inherit).
      api.getJobDefaultCaptionStyle(jobUuid).catch(() => ({ caption_style: null }))
        .then(defRes => {
          const defCs = defRes?.caption_style || null
          if (defCs) hydrateFormFromConfig(defCs)
          setInheriting(false)
          setAppliedPresetId(defCs ? findMatchingPresetId(defCs) : null)
          setDefaultPresetId(defCs ? findMatchingPresetId(defCs) : null)
        }).finally(() => setLoading(false))
      return
    }
    // Segment-mode: load the per-segment caption_styles row AND the
    // job's default_caption_style in parallel. If the segment has no
    // row, hydrate the form from the default so the user sees what
    // they'd be inheriting before they customize.
    Promise.all([
      api.getCaptionStyle(jobUuid, segmentId).catch(() => ({ caption_style: null })),
      api.getJobDefaultCaptionStyle(jobUuid).catch(() => ({ caption_style: null })),
    ]).then(([segRes, defRes]) => {
      const segCs = segRes?.caption_style || null
      const defCs = defRes?.caption_style || null
      // Pick whichever exists for the form state: segment row wins.
      const active = segCs || defCs
      if (active) hydrateFormFromConfig(active)
      setInheriting(!segCs && !!defCs)
      // Infer which preset the loaded config matches (if any).
      setAppliedPresetId(segCs ? findMatchingPresetId(segCs) : (defCs ? findMatchingPresetId(defCs) : null))
      setDefaultPresetId(defCs ? findMatchingPresetId(defCs) : null)
    }).finally(() => setLoading(false))
  }, [jobUuid, segmentId, mode, isDefault])

  // Helper: populate every form field from a caption_styles-shaped
  // config object (works for both segment rows and job defaults).
  const hydrateFormFromConfig = (cs) => {
    if (cs.base_font_family) setBaseFont(cs.base_font_family)
    if (cs.base_font_color) setBaseColor(cs.base_font_color)
    setBaseFontSize(typeof cs.base_font_size === 'number' ? cs.base_font_size : null)
    if (cs.active_word_color) { setActiveColor(cs.active_word_color); setActiveEnabled(true) }
    else { setActiveEnabled(false) }
    if (cs.active_word_font_family) { setActiveFont(cs.active_word_font_family); setActiveFontEnabled(true) }
    else { setActiveFontEnabled(false) }
    const oc = cs.active_word_outline_config
    if (oc && typeof oc === 'object') {
      setOutlineEnabled(true)
      setOutlineType(oc.type === 'neon' ? 'neon' : 'outline')
      if (oc.color) setOutlineColor(oc.color)
      if (typeof oc.width === 'number') setOutlineWidth(oc.width)
      if (typeof oc.blur === 'number') setOutlineBlur(oc.blur)
    } else {
      setOutlineEnabled(false)
    }
    // verticalPosition lives inside layout_config. null means "use
    // the aspect-ratio default" — preserve that signal (setVertical
    // Position(null)) rather than coercing to a number.
    const vp = cs.layout_config?.verticalPosition
    setVerticalPosition(typeof vp === 'number' ? vp : null)
    // Base outline — same shape as active-word outline, but lives in
    // layout_config.baseOutline.
    const baseOc = cs.layout_config?.baseOutline
    if (baseOc && typeof baseOc === 'object') {
      setBaseOutlineEnabled(true)
      setBaseOutlineType(baseOc.type === 'neon' ? 'neon' : 'outline')
      if (baseOc.color) setBaseOutlineColor(baseOc.color)
      if (typeof baseOc.width === 'number') setBaseOutlineWidth(baseOc.width)
      if (typeof baseOc.blur === 'number') setBaseOutlineBlur(baseOc.blur)
    } else {
      setBaseOutlineEnabled(false)
    }
    setHaloDisabled(!!cs.layout_config?.haloDisabled)
    // Keep JSONB side-fields so Save doesn't drop them.
    setPendingConfig({
      active_word_outline_config: cs.active_word_outline_config || null,
      active_word_scale_pulse: cs.active_word_scale_pulse || null,
      layout_config: cs.layout_config || null,
      entry_animation: cs.entry_animation || null,
      exit_animation: cs.exit_animation || null,
      reveal_config: cs.reveal_config || null,
      continuous_motion: cs.continuous_motion || null,
    })
  }

  // Build a caption_styles-shaped body from the current form state +
  // pendingConfig ride-alongs. Used by both Save (per-segment PUT) and
  // Set-as-default (job-level PUT) so both paths send the same shape.
  const currentConfigBody = () => {
    // Merge verticalPosition into layout_config without clobbering
    // whatever else the preset put there (textEffect, highlighter,
    // backgroundType, etc.). When the user hasn't touched the slider
    // (verticalPosition === null), delete the key entirely so the
    // render path falls back to the aspect-ratio default.
    const existingLayout = (pendingConfig?.layout_config) || null
    let mergedLayout = verticalPosition != null
      ? { ...(existingLayout || {}), verticalPosition }
      : existingLayout && 'verticalPosition' in existingLayout
        ? (() => { const { verticalPosition: _, ...rest } = existingLayout; return Object.keys(rest).length ? rest : null })()
        : existingLayout
    // Merge base outline into layout_config — set when enabled,
    // explicitly remove when disabled so toggling off persists.
    const baseOutlineCfg = baseOutlineEnabled
      ? (baseOutlineType === 'neon'
          ? { type: 'neon', color: baseOutlineColor, width: Math.max(1, Math.min(20, Number(baseOutlineWidth) || 4)), blur: Math.max(0, Math.min(40, Number(baseOutlineBlur) || 8)) }
          : { type: 'outline', color: baseOutlineColor, width: Math.max(1, Math.min(20, Number(baseOutlineWidth) || 3)) })
      : null
    if (baseOutlineCfg) {
      mergedLayout = { ...(mergedLayout || {}), baseOutline: baseOutlineCfg }
    } else if (mergedLayout && 'baseOutline' in mergedLayout) {
      const { baseOutline: _bo, ...restNoBo } = mergedLayout
      mergedLayout = Object.keys(restNoBo).length ? restNoBo : null
    }
    // Halo toggle — set when disabled, remove the key entirely when
    // enabled (the default), so the layout JSONB stays minimal for
    // un-toggled rows.
    if (haloDisabled) {
      mergedLayout = { ...(mergedLayout || {}), haloDisabled: true }
    } else if (mergedLayout && 'haloDisabled' in mergedLayout) {
      const { haloDisabled: _hd, ...restNoHd } = mergedLayout
      mergedLayout = Object.keys(restNoHd).length ? restNoHd : null
    }
    // Build the outline config from the form. Null when disabled so
    // the BE clears the column. Width/blur are clamped client-side
    // (server has no validation here so junk values would render).
    const outlineCfg = outlineEnabled
      ? (outlineType === 'neon'
          ? { type: 'neon', color: outlineColor, width: Math.max(1, Math.min(20, Number(outlineWidth) || 4)), blur: Math.max(0, Math.min(40, Number(outlineBlur) || 8)) }
          : { type: 'outline', color: outlineColor, width: Math.max(1, Math.min(20, Number(outlineWidth) || 3)) })
      : null
    return {
      ...(pendingConfig || {}),
      layout_config: mergedLayout,
      base_font_family: baseFont,
      base_font_color: baseColor,
      base_font_size: baseFontSize, // null = use the aspect-ratio default
      active_word_color: activeEnabled ? activeColor : null,
      active_word_font_family: activeFontEnabled && activeFont ? activeFont : null,
      active_word_outline_config: outlineCfg,
    }
  }

  const save = async () => {
    setSaving(true); setErr(null)
    try {
      if (isDefault) {
        // Default mode — writes to the job-level default. No preview
        // because there's no specific segment audio to pair with.
        const body = currentConfigBody()
        await api.saveJobDefaultCaptionStyle(jobUuid, body)
        setDefaultPresetId(findMatchingPresetId(
          // Snake-case the body for matcher consistency (the matcher
          // compares against preset.config which is snake-cased).
          body
        ))
      } else {
        await api.saveCaptionStyle(jobUuid, segmentId, currentConfigBody())
        setInheriting(false) // segment now has its own row
        // Preview happens inline on the main editor video via
        // InlineCaptionOverlay — no separate render needed here.
      }
      // Tell the live preview's cue cache (useLivePreviewAssets) to
      // refetch so the new style shows immediately. Without this, the
      // user had to regenerate the segment's audio to see the change
      // — which both wastes 11labs credits and is the wrong UX
      // (caption style is purely visual, has nothing to do with the
      // spoken audio). The refetch is debounced 1s on the listening
      // side so rapid saves collapse into a single network round.
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('posty-voiceover-change', {
            detail: { reason: 'caption-style-save', segmentId: segmentId || null, isDefault },
          }))
        }
      } catch {}
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  // Save the passed preset as the job's default_caption_style. Does NOT
  // touch the per-segment row — existing customized segments keep their
  // own style; only segments without a row start inheriting the new
  // default. If THIS segment has no row, we also reflect the new
  // default in the form so the preview matches.
  const setAsDefault = async (preset) => {
    setSaving(true); setErr(null)
    try {
      await api.saveJobDefaultCaptionStyle(jobUuid, preset.config)
      setDefaultPresetId(preset.id)
      // If this segment was inheriting, snap the form to the new default
      // so the editor reflects what would render.
      if (inheriting) {
        hydrateFormFromConfig(preset.config)
        setAppliedPresetId(preset.id)
      }
      // Refetch live preview cues so inheriting segments pick up the
      // new default without an audio regenerate — same reason as the
      // save() path.
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('posty-voiceover-change', {
            detail: { reason: 'set-as-default', presetId: preset.id },
          }))
        }
      } catch {}
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  // Drop this segment's per-segment row so it inherits the job default.
  const useJobDefault = async () => {
    setSaving(true); setErr(null)
    try {
      await api.clearSegmentCaptionStyle(jobUuid, segmentId)
      setInheriting(true)
      // Refresh the form from the default (or clear if no default set).
      const defRes = await api.getJobDefaultCaptionStyle(jobUuid).catch(() => ({ caption_style: null }))
      const defCs = defRes?.caption_style || null
      if (defCs) hydrateFormFromConfig(defCs)
      setAppliedPresetId(defCs ? findMatchingPresetId(defCs) : null)
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  // Any manual edit invalidates the "applied preset" ring since the
  // form no longer matches the preset.
  const markDirty = () => { if (appliedPresetId) setAppliedPresetId(null) }

  if (loading) return <div className="text-[11px] text-muted italic text-center py-4">Loading caption style…</div>

  // Current-selection pill shown next to the preset button so users
  // can see what's active without opening the picker. Priority:
  //   1. Applied preset matches form (appliedPresetId) → show its name.
  //   2. Segment is inheriting the job default → show "default: <name>"
  //      so the user knows what's rendering even though there's no
  //      per-segment row yet.
  //   3. Form has been edited off any preset → "custom".
  //   4. Nothing yet → null (no pill).
  const activePresetPill = (() => {
    if (appliedPresetId) {
      const p = CAPTION_PRESETS.find(x => x.id === appliedPresetId)
      return p ? { label: p.displayName, tone: 'applied', emoji: p.thumbnailEmoji } : null
    }
    if (!isDefault && inheriting && defaultPresetId) {
      const p = CAPTION_PRESETS.find(x => x.id === defaultPresetId)
      return p ? { label: `default: ${p.displayName}`, tone: 'inherited', emoji: p.thumbnailEmoji } : null
    }
    // Only show "custom" when the form actually has content — avoid
    // flashing on the loading→empty transition.
    if (pendingConfig || baseFont !== 'Inter' || baseColor !== '#ffffff') {
      return { label: 'custom', tone: 'custom', emoji: null }
    }
    return null
  })()

  return (
    <div className="bg-[#fafafa] border border-[#e5e5e5] rounded-lg p-3 space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[12px] font-medium">
          {isDefault ? 'Default caption style' : 'Caption style'}
        </div>
        {activePresetPill && (
          <span
            className={`text-[10px] py-0.5 px-1.5 rounded border flex items-center gap-1 ${
              activePresetPill.tone === 'applied'
                ? 'bg-[#6C5CE7]/10 border-[#6C5CE7]/40 text-[#6C5CE7]'
                : activePresetPill.tone === 'inherited'
                  ? 'bg-[#2D9A5E]/10 border-[#2D9A5E]/40 text-[#2D9A5E]'
                  : 'bg-[#fafafa] border-[#e5e5e5] text-muted'
            }`}
            title={
              activePresetPill.tone === 'applied' ? 'This preset is currently applied.'
                : activePresetPill.tone === 'inherited' ? 'Segment has no override — rendering with the job default.'
                : 'Form fields no longer match any preset.'
            }
          >
            {activePresetPill.emoji && <span className="text-[11px] leading-none">{activePresetPill.emoji}</span>}
            {activePresetPill.label}
          </span>
        )}
        <div className="flex-1" />
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

      {/* Segment-mode inheritance UI. Hidden in default-mode because
          the default IS the thing being inherited — it can't inherit
          from itself. */}
      {!isDefault && inheriting && (
        <div className="bg-[#f0faf4] border border-[#2D9A5E]/30 rounded px-2 py-1.5 text-[10px] text-[#2D9A5E] flex items-center gap-2">
          <span className="flex-1">
            <span className="font-medium">Inheriting job default.</span>{' '}
            Edit any field and save to override, or keep it to inherit future default changes.
          </span>
        </div>
      )}
      {!isDefault && !inheriting && defaultPresetId && (
        <div className="flex items-center justify-between bg-white border border-[#e5e5e5] rounded px-2 py-1 text-[10px] text-muted gap-2">
          <span>This segment overrides the job default.</span>
          <button
            type="button"
            onClick={useJobDefault}
            disabled={saving}
            className="text-[10px] py-0.5 px-2 border border-[#2D9A5E]/40 text-[#2D9A5E] bg-white rounded cursor-pointer disabled:opacity-50"
            title="Drop this segment's custom style so it follows the job default"
          >Use job default</button>
        </div>
      )}

      {presetsOpen && (
        <CaptionPresetPicker
          onApply={applyPreset}
          // In default-mode, the "Set as default" action is meaningless
          // (the whole editor is already editing the default). Hiding
          // onSetDefault suppresses the per-tile action in the picker.
          onSetDefault={isDefault ? undefined : setAsDefault}
          selectedId={appliedPresetId}
          defaultId={defaultPresetId}
        />
      )}

      {isDefault && (
        <div className="text-[10px] text-muted italic">
          Applies to every segment that hasn't been customized. Individual segments can still override it.
        </div>
      )}

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
            onChange={f => { setBaseFont(f); setPickerOpen(null); markDirty() }}
          />
        )}
      </div>

      {/* Base color */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] font-medium flex-1">Base color</label>
        <input
          type="color"
          value={baseColor}
          onChange={e => { setBaseColor(e.target.value); markDirty() }}
          className="w-8 h-6 border border-[#e5e5e5] rounded cursor-pointer p-0"
          aria-label="Base caption color"
        />
        <span className="font-mono text-[10px] text-muted">{baseColor}</span>
      </div>

      {/* Base font size — slider + editable numeric input bound to
          the same value, so the user can drag OR type. CaptionLayer
          scales this by width/1080 so the on-screen size stays
          proportional across preview vs final-render dimensions. null
          = use the minDim * 0.055 fallback (~60px on 1080×1920). */}
      <div className="space-y-1">
        <BaseFontSizeRow
          value={baseFontSize}
          onChange={(v) => { setBaseFontSize(v); markDirty() }}
        />
        {/* Live preview — "Aa" rendered in the chosen font at a
            scaled-down version of the slider value so the user can
            see proportional changes without the sample blowing past
            the editor width. */}
        <FontSizePreview
          family={baseFont}
          color={baseColor}
          sizePx={baseFontSize != null ? baseFontSize : 60}
        />
      </div>

      {/* Vertical position — slider with a "default" null state.
          0 = top of frame, 100 = bottom. When null, the caption sits
          at the aspect-ratio default (72% on 9:16, 78% on 1:1). */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] font-medium">Vertical</label>
        <input
          type="range"
          min={5} max={95} step={1}
          value={verticalPosition != null ? verticalPosition : 72}
          onChange={e => { setVerticalPosition(Number(e.target.value)); markDirty() }}
          className="flex-1"
          title="Where the caption sits vertically, 0% = top, 100% = bottom. Default is 72% on vertical video."
        />
        <span className="font-mono text-[10px] text-muted w-14 text-right">
          {verticalPosition != null ? `${verticalPosition}%` : 'default'}
        </span>
        {verticalPosition != null && (
          <button
            type="button"
            onClick={() => { setVerticalPosition(null); markDirty() }}
            className="text-[9px] text-muted border border-[#e5e5e5] rounded px-1.5 py-0.5 bg-white cursor-pointer"
            title="Reset to the aspect-ratio default (72% on 9:16)"
          >reset</button>
        )}
      </div>

      {/* Halo behind text — drop-shadow + glow stack that gives white
          text on raw video a legibility halo. ON by default; off
          renders sharp text. Box-style backgrounds always suppress
          the halo regardless of this toggle (the pill provides its
          own contrast). */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[10px] flex-1 cursor-pointer">
          <input
            type="checkbox"
            checked={!haloDisabled}
            onChange={e => { setHaloDisabled(!e.target.checked); markDirty() }}
          />
          <span className="font-medium">Halo behind text</span>
        </label>
        <span className="text-[9px] text-muted italic">soft glow / drop-shadow for legibility on video</span>
      </div>

      {/* Active color */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[10px] flex-1 cursor-pointer">
          <input
            type="checkbox"
            checked={activeEnabled}
            onChange={e => { setActiveEnabled(e.target.checked); markDirty() }}
          />
          <span className="font-medium">Active-word color</span>
        </label>
        <input
          type="color"
          value={activeColor}
          onChange={e => { setActiveColor(e.target.value); markDirty() }}
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
            onChange={e => { setActiveFontEnabled(e.target.checked); markDirty() }}
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
                onChange={f => { setActiveFont(f); setPickerOpen(null); markDirty() }}
              />
            )}
          </>
        )}
      </div>

      {/* Base outline / glow — applies to ALL caption text (not just
          the active word). Stored in layout_config.baseOutline so no
          BE migration is needed; CaptionLayer composes it onto the
          baseStyle textShadow. Use this for "every word has a black
          outline" looks; use the Active-word card below to make ONLY
          the spoken word have an outline. */}
      <div className="space-y-1.5 border border-[#e5e5e5] rounded p-2 bg-[#fafafa]">
        <label className="flex items-center gap-1.5 text-[10px] font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={baseOutlineEnabled}
            onChange={e => { setBaseOutlineEnabled(e.target.checked); markDirty() }}
          />
          <span>Outline / glow on all caption text</span>
        </label>
        {baseOutlineEnabled && (
          <>
            <div className="flex items-center gap-2 text-[10px]">
              <label className="text-muted">Style</label>
              <select
                value={baseOutlineType}
                onChange={e => { setBaseOutlineType(e.target.value); markDirty() }}
                className="flex-1 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
              >
                <option value="outline">Outline (solid stroke)</option>
                <option value="neon">Neon (colored glow)</option>
              </select>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <label className="text-muted">Color</label>
              <input
                type="color"
                value={baseOutlineColor}
                onChange={e => { setBaseOutlineColor(e.target.value); markDirty() }}
                className="w-8 h-6 border border-[#e5e5e5] rounded cursor-pointer p-0"
              />
              <span className="font-mono text-[10px] text-muted">{baseOutlineColor}</span>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <label className="text-muted">Width</label>
              <input
                type="range"
                min={1} max={12} step={1}
                value={baseOutlineWidth}
                onChange={e => { setBaseOutlineWidth(Number(e.target.value)); markDirty() }}
                className="flex-1"
              />
              <span className="font-mono text-[10px] text-muted w-10 text-right">{baseOutlineWidth}px</span>
            </div>
            {baseOutlineType === 'neon' && (
              <div className="flex items-center gap-2 text-[10px]">
                <label className="text-muted">Glow</label>
                <input
                  type="range"
                  min={0} max={32} step={1}
                  value={baseOutlineBlur}
                  onChange={e => { setBaseOutlineBlur(Number(e.target.value)); markDirty() }}
                  className="flex-1"
                />
                <span className="font-mono text-[10px] text-muted w-10 text-right">{baseOutlineBlur}px</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Outline / glow on the active word — Phase 2.5 active_word_outline_config.
          'outline' draws a solid stroke; 'neon' draws a colored glow
          via blur. Both override CaptionLayer's default text shadow. */}
      <div className="space-y-1.5 border border-[#e5e5e5] rounded p-2 bg-[#fafafa]">
        <label className="flex items-center gap-1.5 text-[10px] font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={outlineEnabled}
            onChange={e => { setOutlineEnabled(e.target.checked); markDirty() }}
          />
          <span>Active-word outline / glow</span>
        </label>
        {outlineEnabled && (
          <>
            <div className="flex items-center gap-2 text-[10px]">
              <label className="text-muted">Style</label>
              <select
                value={outlineType}
                onChange={e => { setOutlineType(e.target.value); markDirty() }}
                className="flex-1 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
              >
                <option value="outline">Outline (solid stroke)</option>
                <option value="neon">Neon (colored glow)</option>
              </select>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <label className="text-muted">Color</label>
              <input
                type="color"
                value={outlineColor}
                onChange={e => { setOutlineColor(e.target.value); markDirty() }}
                className="w-8 h-6 border border-[#e5e5e5] rounded cursor-pointer p-0"
              />
              <span className="font-mono text-[10px] text-muted">{outlineColor}</span>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <label className="text-muted">Width</label>
              <input
                type="range"
                min={1} max={12} step={1}
                value={outlineWidth}
                onChange={e => { setOutlineWidth(Number(e.target.value)); markDirty() }}
                className="flex-1"
              />
              <span className="font-mono text-[10px] text-muted w-10 text-right">{outlineWidth}px</span>
            </div>
            {outlineType === 'neon' && (
              <div className="flex items-center gap-2 text-[10px]">
                <label className="text-muted">Glow</label>
                <input
                  type="range"
                  min={0} max={32} step={1}
                  value={outlineBlur}
                  onChange={e => { setOutlineBlur(Number(e.target.value)); markDirty() }}
                  className="flex-1"
                />
                <span className="font-mono text-[10px] text-muted w-10 text-right">{outlineBlur}px</span>
              </div>
            )}
          </>
        )}
      </div>

      {err && <div className="text-[10px] text-[#c0392b]">{err}</div>}

      <div className="flex gap-1.5 pt-1 flex-wrap">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex-1 text-[11px] py-1.5 bg-[#2D9A5E] text-white border-none rounded cursor-pointer font-medium disabled:opacity-50"
        >{saving ? 'Saving…' : (isDefault ? 'Save as job default' : 'Save caption style')}</button>
        {isDefault && defaultPresetId && (
          <button
            type="button"
            onClick={async () => {
              setSaving(true); setErr(null)
              try {
                await api.saveJobDefaultCaptionStyle(jobUuid, { clear: true })
                setDefaultPresetId(null)
                setAppliedPresetId(null)
                try {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('posty-voiceover-change', {
                      detail: { reason: 'clear-default' },
                    }))
                  }
                } catch {}
              } catch (e) { setErr(e.message || String(e)) }
              finally { setSaving(false) }
            }}
            disabled={saving}
            className="text-[11px] py-1.5 px-3 bg-white border border-[#c0392b]/40 text-[#c0392b] rounded cursor-pointer disabled:opacity-50"
            title="Remove the job default. Segments without their own style will render with the app's built-in minimal style."
          >Clear</button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-[11px] py-1.5 px-3 bg-white border border-[#e5e5e5] rounded cursor-pointer text-muted"
          >Cancel</button>
        )}
      </div>
      {/* Apply-to-all in default mode. Saves the current form as the
          job default first (so the cascade reads the latest values),
          then cascades to every per-segment row so existing customised
          segments adopt the new font size + vertical position too.
          Same endpoint as the inline ApplyCaptionToAllButton in
          FinalPreviewV2 — placed here so users editing the default
          have the action where they expect it. */}
      {isDefault && (
        <ApplyDefaultToAllButton
          jobUuid={jobUuid}
          getBody={currentConfigBody}
          saving={saving}
          setSaving={setSaving}
          setErr={setErr}
        />
      )}
    </div>
  )
}

// Inline action that saves the current form as the job default and
// then cascades the slider-controlled fields (base_font_size +
// verticalPosition) to every per-segment caption_styles row. Lives
// inside the editor so users editing the default have the action
// next to the Save button.
function ApplyDefaultToAllButton({ jobUuid, getBody, saving, setSaving, setErr }) {
  const [done, setDone] = useState(null) // { count } | null
  const handle = async () => {
    setSaving(true); setErr(null); setDone(null)
    try {
      const body = getBody()
      // Persist the current form first so the cascade reads fresh
      // values, even if the user hadn't pressed Save yet.
      await api.saveJobDefaultCaptionStyle(jobUuid, body)
      const cascadeBody = {}
      if (typeof body.base_font_size === 'number') cascadeBody.base_font_size = body.base_font_size
      const vp = body.layout_config?.verticalPosition
      if (typeof vp === 'number') cascadeBody.vertical_position = vp
      const r = await api.cascadeJobDefaultCaptionStyle(jobUuid, cascadeBody)
      setDone({ count: Number(r?.updated) || 0 })
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('posty-voiceover-change', {
            detail: { reason: 'cascade-default-to-all', updated: Number(r?.updated) || 0 },
          }))
        }
      } catch {}
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="space-y-1 pt-1">
      <button
        type="button"
        onClick={handle}
        disabled={saving}
        className="w-full text-[11px] py-1.5 bg-[#f59e0b]/15 border border-[#f59e0b]/40 text-[#b45309] rounded cursor-pointer disabled:opacity-50 font-medium hover:bg-[#f59e0b]/25"
        title="Saves the current form as the job default, then cascades the size + vertical position into every existing per-segment caption_styles row so customised segments pick up the new values too."
      >📥 Apply to all segments</button>
      {done && (
        <div className="text-[10px] text-[#2D9A5E]">
          ✓ {done.count === 0
            ? 'Default saved (no per-segment rows to cascade into)'
            : `Cascaded into ${done.count} segment row${done.count === 1 ? '' : 's'}`}
        </div>
      )}
    </div>
  )
}

// Find the preset whose config matches the given caption_styles-shaped
// object. Returns the preset id or null. Uses JSON.stringify for deep
// compare — key-order differences between backend JSONB round-trip and
// the static preset config can produce false negatives on the JSONB
// sub-fields (layout_config etc), so we normalize by re-stringifying
// through an object literal per key. Simple enough for this many
// presets; if we grow past ~50 we'd want a hash.
function findMatchingPresetId(cs) {
  if (!cs) return null
  const norm = (v) => v == null ? null : JSON.stringify(sortedKeys(v))
  const fields = [
    'base_font_family', 'base_font_color',
    'active_word_color', 'active_word_font_family',
  ]
  const jsonFields = [
    'active_word_outline_config', 'active_word_scale_pulse',
    'layout_config',
    'entry_animation', 'exit_animation', 'reveal_config',
    'continuous_motion',
  ]
  for (const preset of CAPTION_PRESETS) {
    const c = preset.config
    let match = true
    for (const f of fields) {
      if ((cs[f] || null) !== (c[f] || null)) { match = false; break }
    }
    if (!match) continue
    for (const f of jsonFields) {
      if (norm(cs[f]) !== norm(c[f])) { match = false; break }
    }
    if (match) return preset.id
  }
  return null
}

// Recursively sort object keys so deep-compare is order-insensitive.
// Arrays preserve order. Primitives pass through.
function sortedKeys(v) {
  if (Array.isArray(v)) return v.map(sortedKeys)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = sortedKeys(v[k])
    return out
  }
  return v
}

// Slider + editable numeric input bound to the same value. Drag the
// slider to set it; or type into the input. value === null means
// "use the aspect-ratio default" (~60px on 1080×1920) — the input
// shows empty in that state with a "default" placeholder, and a
// "reset" button next to a non-null value clears back to null.
//
// Mirrors the overlays SizeSliderRow's UX so caption + overlay font
// sizing feel identical.
function BaseFontSizeRow({ value, onChange }) {
  const sliderValue = value != null ? value : 60
  const [draft, setDraft] = useState(value != null ? String(value) : '')
  const editingRef = useRef(false)
  // Sync the typed text back to the parent's value when the field
  // ISN'T being edited — covers slider drags, preset apply, and
  // reset → null. Without the editingRef guard, a mid-typed "1"
  // would snap back to the parent's full number on every keystroke.
  useEffect(() => {
    if (!editingRef.current) setDraft(value != null ? String(value) : '')
  }, [value])
  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] font-medium">Size</label>
      <input
        type="range"
        min={30}
        max={140}
        step={2}
        value={sliderValue}
        onChange={e => {
          const n = Number(e.target.value)
          setDraft(String(n))
          onChange(n)
        }}
        className="flex-1"
        title="Caption font size in 1080-reference pixels. Default ≈ 60px (5.5% of frame width). Same value applies on every render resolution because it's scaled by frame width."
      />
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        placeholder="default"
        onFocus={() => { editingRef.current = true }}
        onChange={e => {
          const cleaned = e.target.value.replace(/[^0-9]/g, '')
          setDraft(cleaned)
          if (cleaned === '') {
            // Empty input → reset to default (null). Mirrors the
            // existing reset button so the user has two paths to
            // the same outcome.
            onChange(null)
            return
          }
          const n = Number(cleaned)
          if (Number.isFinite(n) && n > 0) onChange(n)
        }}
        onBlur={() => {
          editingRef.current = false
          // Normalize visible string after typing finishes.
          setDraft(value != null ? String(value) : '')
        }}
        className="w-14 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white text-center font-mono text-muted"
      />
      <span className="text-[10px] text-muted">px</span>
      {value != null && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-[9px] text-muted border border-[#e5e5e5] rounded px-1.5 py-0.5 bg-white cursor-pointer"
          title="Reset to the aspect-ratio default size"
        >reset</button>
      )}
    </div>
  )
}

// Inline "Aa" preview shown beside font-size sliders. Renders at a
// scaled-down version of the slider value so a 30→140px range stays
// visually proportional without the sample overflowing the row. The
// scale (0.4) was tuned so 60px (the typical default) shows as 24px
// — readable, distinguishable, and never wider than ~40px.
//
// Exported so OverlayFontSizeSlider / CaptionFontSizeSlider in
// FinalPreviewV2 can reuse the same component.
export function FontSizePreview({ family, color = '#111', sizePx, scale = 0.4, sample = 'Aa', maxPx = 56, minPx = 12 }) {
  const display = Math.max(minPx, Math.min(maxPx, Math.round((Number(sizePx) || 0) * scale)))
  return (
    <div
      className="flex items-baseline gap-2 bg-[#fafafa] border border-[#e5e5e5] rounded px-2 py-1"
      title={`Live preview at ${sizePx}px (shown ~${display}px to fit the row)`}
    >
      <span className="text-[9px] text-muted uppercase tracking-wide">preview</span>
      <span
        className="leading-none"
        style={{
          fontFamily: family ? `'${family}', system-ui, sans-serif` : undefined,
          fontSize: display,
          color,
          // Mimics common caption shadow so a white sample is still
          // readable on the off-white background.
          textShadow: color && color.toLowerCase() === '#ffffff' ? '0 0 1px rgba(0,0,0,0.6)' : undefined,
        }}
      >{sample}</span>
    </div>
  )
}
