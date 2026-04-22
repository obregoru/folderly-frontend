import { useEffect, useState } from 'react'
import * as api from '../../api'
import FontPicker from './FontPicker'
import CaptionPresetPicker from './CaptionPresetPicker'
import { CAPTION_PRESETS } from '../../lib/captionPresets/catalog'

/**
 * Caption-style authoring UI. Two modes:
 *
 *   mode='segment'  — (default) edits ONE segment's caption_styles row.
 *                     Shows inheritance banner + "Use job default"
 *                     button + "Set as default" on preset picker +
 *                     preview render tied to the segment's audio.
 *
 *   mode='default'  — edits the JOB-LEVEL default_caption_style that
 *                     applies to every segment without its own row.
 *                     No inheritance banner, no preview (not tied to
 *                     any single segment's audio), and the Save button
 *                     writes to PUT /jobs/:id/default-caption-style.
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
  const [activeColor, setActiveColor] = useState('#f59e0b')
  const [activeEnabled, setActiveEnabled] = useState(false)
  const [activeFont, setActiveFont] = useState('')
  const [activeFontEnabled, setActiveFontEnabled] = useState(false)
  // Vertical anchor as % from top of composition. null means "use the
  // aspect-ratio default" (72% on 9:16, 78% on 1:1). User interaction
  // with the slider replaces null with a concrete number; the label
  // shows "default (72%)" while null.
  const [verticalPosition, setVerticalPosition] = useState(null)
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
    // Sync the slider to whatever the preset specifies (or null to
    // fall back to the aspect-ratio default).
    const vp = c.layout_config?.verticalPosition
    setVerticalPosition(typeof vp === 'number' ? vp : null)
    // Keep the preset's full config in memory so Save sends animation /
    // reveal / outline / layout too (this UI doesn't yet surface those
    // fields for direct editing; they ride along from the preset).
    setPendingConfig(c)
    setAppliedPresetId(preset.id)
    setPresetsOpen(false)
  }
  const [pendingConfig, setPendingConfig] = useState(null)

  // Preview state — small Remotion-rendered clip we fetch after save.
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewErr, setPreviewErr] = useState(null)

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
    if (cs.active_word_color) { setActiveColor(cs.active_word_color); setActiveEnabled(true) }
    else { setActiveEnabled(false) }
    if (cs.active_word_font_family) { setActiveFont(cs.active_word_font_family); setActiveFontEnabled(true) }
    else { setActiveFontEnabled(false) }
    // verticalPosition lives inside layout_config. null means "use
    // the aspect-ratio default" — preserve that signal (setVertical
    // Position(null)) rather than coercing to a number.
    const vp = cs.layout_config?.verticalPosition
    setVerticalPosition(typeof vp === 'number' ? vp : null)
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
    const mergedLayout = verticalPosition != null
      ? { ...(existingLayout || {}), verticalPosition }
      : existingLayout && 'verticalPosition' in existingLayout
        ? (() => { const { verticalPosition: _, ...rest } = existingLayout; return Object.keys(rest).length ? rest : null })()
        : existingLayout
    return {
      ...(pendingConfig || {}),
      layout_config: mergedLayout,
      base_font_family: baseFont,
      base_font_color: baseColor,
      active_word_color: activeEnabled ? activeColor : null,
      active_word_font_family: activeFontEnabled && activeFont ? activeFont : null,
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
        // Fire a preview render in the background — don't block the close.
        triggerPreview()
      }
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

      {/* Preview — 4-second Remotion render at half-res. Segment mode
          only — the default-style editor has no specific segment audio
          to pair with, so the preview block is hidden there. */}
      {!isDefault && (
        <>
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
        </>
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

      {err && <div className="text-[10px] text-[#c0392b]">{err}</div>}

      <div className="flex gap-1.5 pt-1">
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
