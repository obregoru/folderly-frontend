import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import RichTextEditor from './RichTextEditor'
import { runsToFlatText } from './RichRunsEditor'

// Lazy-load the font picker chunk so the 52-font catalog isn't pulled
// on initial panel mount — only when the user actually opens the
// picker panel from the Style row.
const FontPicker = lazy(() => import('../../components/fonts/FontPicker'))
// Same lazy pattern for the caption preset picker — presets only
// matter when the user opens the "Apply caption preset" fold below.
const CaptionPresetPicker = lazy(() => import('../../components/fonts/CaptionPresetPicker'))

/**
 * OverlaysPanelV2 — on-screen text overlays burned into the final video.
 * Opening / Middle / Closing blocks, each with their own text + duration,
 * plus shared font controls.
 *
 * Persists to jobSync.saveOverlaySettings (uses existing overlay_settings
 * JSONB column — same shape the legacy overlay system expects).
 *
 * Live preview of the overlays ON the shared FinalPreview video lands in
 * a later sub-phase; for now the text just saves.
 */
export default function OverlaysPanelV2({ jobSync, draftId, previewRef }) {
  const [openingText, setOpeningText] = useState('')
  const [middleText, setMiddleText] = useState('')
  const [closingText, setClosingText] = useState('')
  // Rich runs — per-word styling. When non-null, each slot's runs[]
  // is the source of truth and the *Text field above is a flattened
  // back-compat copy (so the legacy ffmpeg-drawtext export still
  // produces something readable until the Remotion overlay path
  // ships). null = plain text mode (legacy behavior).
  const [openingRuns, setOpeningRuns] = useState(null)
  const [middleRuns, setMiddleRuns] = useState(null)
  const [closingRuns, setClosingRuns] = useState(null)
  const [openingDuration, setOpeningDuration] = useState(3)
  const [middleStartTime, setMiddleStartTime] = useState(4)
  const [middleDuration, setMiddleDuration] = useState(3)
  const [closingDuration, setClosingDuration] = useState(3)
  const [fontSize, setFontSize] = useState(48)
  const [fontFamily, setFontFamily] = useState('sans-serif')
  const [fontColor, setFontColor] = useState('#ffffff')
  const [fontOutline, setFontOutline] = useState(true)
  const [outlineWidth, setOutlineWidth] = useState(3)
  const [lineHeight, setLineHeight] = useState(1.3)
  const [letterSpacing, setLetterSpacing] = useState(0)
  // Background box behind the overlay text (e.g. the white "pill"
  // background from the Bold Pill preset). null = no box. When set:
  //   { color: '#ffffff', opacity: 0.95, paddingX: 28, paddingY: 14 }
  // cornerRadius is also accepted but only honored in the FE
  // preview — ffmpeg's drawtext draws rectangular boxes only.
  const [boxConfig, setBoxConfig] = useState(null)
  // Y position 0-100% within the platform-safe center band (same scale
  // as ResultCard's overlayYPct). 70 is a common default — near-bottom
  // but clear of the platform's reserved caption/UI zone.
  const [overlayYPct, setOverlayYPct] = useState(70)

  // Per-slot full style overrides — one partial config per slot.
  // Fields that are set override the same-named default; missing
  // fields inherit. Empty object {} = inherit everything (the
  // SlotStyleFold's "inherits all" state). Persisted under
  // overlay_settings.{opening,middle,closing}Style. For back-compat
  // we ALSO mirror common fields (yPct, fontColor, fontSize) into
  // the legacy openingYPct / openingFontColor / openingFontSize keys
  // that the BE has read for a while; the new persistence path is
  // additive, so old consumers keep working.
  //
  // Supported fields (each optional):
  //   yPct, fontColor, fontFamily, fontSize, fontOutline,
  //   outlineWidth, lineHeight, letterSpacing, box
  // box has the same shape as the panel-level boxConfig.
  const [slotStyles, setSlotStyles] = useState({ opening: {}, middle: {}, closing: {} })

  const [saved, setSaved] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [fontPickerOpen, setFontPickerOpen] = useState(false)
  // Default-block presets toggle. When open, the CaptionPresetPicker
  // replaces the form controls inline — same behaviour as the
  // voiceover CaptionStyleEditor's "🎭 presets" button.
  const [defaultPresetsOpen, setDefaultPresetsOpen] = useState(false)
  // Catalog of overlay-compatible presets — loaded once for the
  // matcher that powers the indicator pills (default + per slot).
  const [presetCatalog, setPresetCatalog] = useState(null)
  useEffect(() => {
    let cancelled = false
    import('../../lib/captionPresets/catalog').then(mod => {
      if (cancelled) return
      setPresetCatalog(mod.CAPTION_PRESETS || [])
    }).catch(() => setPresetCatalog([]))
    return () => { cancelled = true }
  }, [])

  // Patch a single field on a single slot. Setting to null/undefined/''
  // removes the field so the slot falls back to the default — the
  // "inherits all" reset happens by passing an empty patch through the
  // applyDefaultsToAllSlots helper below.
  const updateSlotStyle = (slot, field, value) => {
    setSlotStyles(prev => {
      const cur = { ...(prev[slot] || {}) }
      if (value === null || value === undefined || value === '') {
        delete cur[field]
      } else {
        cur[field] = value
      }
      return { ...prev, [slot]: cur }
    })
  }

  // Seed state from the job's overlay_settings once on mount.
  useEffect(() => {
    if (!draftId) return
    import('../../api').then(({ getJob }) => {
      getJob(draftId).then(job => {
        const o = job?.overlay_settings || {}
        if (o.openingText) setOpeningText(o.openingText)
        if (o.middleText) setMiddleText(o.middleText)
        if (o.closingText) setClosingText(o.closingText)
        // Hydrate runs from saved data; if a draft has only the
        // legacy openingText (no openingRuns yet), wrap it in a
        // single-run array so Quill shows the existing text and
        // any subsequent edit upgrades the storage to runs[].
        if (Array.isArray(o.openingRuns) && o.openingRuns.length > 0) setOpeningRuns(o.openingRuns)
        else if (o.openingText) setOpeningRuns([{ text: o.openingText }])
        if (Array.isArray(o.middleRuns) && o.middleRuns.length > 0) setMiddleRuns(o.middleRuns)
        else if (o.middleText) setMiddleRuns([{ text: o.middleText }])
        if (Array.isArray(o.closingRuns) && o.closingRuns.length > 0) setClosingRuns(o.closingRuns)
        else if (o.closingText) setClosingRuns([{ text: o.closingText }])
        if (o.openingDuration) setOpeningDuration(o.openingDuration)
        if (o.middleStartTime != null) setMiddleStartTime(o.middleStartTime)
        if (o.middleDuration) setMiddleDuration(o.middleDuration)
        if (o.closingDuration) setClosingDuration(o.closingDuration)
        if (o.storyFontSize) setFontSize(o.storyFontSize)
        if (o.storyFontFamily) setFontFamily(o.storyFontFamily)
        if (o.storyFontColor) setFontColor(o.storyFontColor)
        if (o.storyFontOutline != null) setFontOutline(o.storyFontOutline)
        if (o.storyFontOutlineWidth) setOutlineWidth(o.storyFontOutlineWidth)
        if (o.lineHeight != null) setLineHeight(Number(o.lineHeight) || 1.3)
        if (o.letterSpacing != null) setLetterSpacing(Number(o.letterSpacing) || 0)
        if (o.overlayYPct != null) setOverlayYPct(Number(o.overlayYPct))
        // Default-level box config (background pill / box behind the
        // text). Stored under overlay_settings.storyBox so the persist
        // shape stays close to the rest of the storyFont* defaults.
        if (o.storyBox && typeof o.storyBox === 'object') setBoxConfig(o.storyBox)

        // Hydrate per-slot styles. New canonical shape is
        // {opening,middle,closing}Style objects. Old jobs only have
        // the flat openingYPct / openingFontColor / openingFontSize
        // fields, so we backfill the new objects from those when the
        // new shape is absent. Either way, slotStyles is the source
        // of truth from this point on.
        const buildSlotStyle = (prefix) => {
          const fromObj = (typeof o[`${prefix}Style`] === 'object' && o[`${prefix}Style`] != null)
            ? o[`${prefix}Style`]
            : null
          if (fromObj) {
            const out = {}
            if (fromObj.yPct != null) out.yPct = Number(fromObj.yPct)
            if (fromObj.fontColor) out.fontColor = String(fromObj.fontColor)
            if (fromObj.fontFamily) out.fontFamily = String(fromObj.fontFamily)
            if (fromObj.fontSize != null) out.fontSize = Number(fromObj.fontSize)
            if (fromObj.fontOutline != null) out.fontOutline = !!fromObj.fontOutline
            if (fromObj.outlineWidth != null) out.outlineWidth = Number(fromObj.outlineWidth)
            if (fromObj.lineHeight != null) out.lineHeight = Number(fromObj.lineHeight)
            if (fromObj.letterSpacing != null) out.letterSpacing = Number(fromObj.letterSpacing)
            if (fromObj.box && typeof fromObj.box === 'object') out.box = fromObj.box
            return out
          }
          // Legacy back-compat: pull from individual flat keys.
          const out = {}
          if (o[`${prefix}YPct`] != null) out.yPct = Number(o[`${prefix}YPct`])
          if (o[`${prefix}FontColor`]) out.fontColor = String(o[`${prefix}FontColor`])
          if (o[`${prefix}FontSize`] != null) out.fontSize = Number(o[`${prefix}FontSize`])
          return out
        }
        setSlotStyles({
          opening: buildSlotStyle('opening'),
          middle:  buildSlotStyle('middle'),
          closing: buildSlotStyle('closing'),
        })

        setLoaded(true)
      }).catch(() => setLoaded(true))
    })
  }, [draftId])

  // Keep the *Text fields in sync with the runs[] arrays so the
  // legacy ffmpeg-drawtext export path + the play-segment buttons
  // (which gate on text presence) always have something to read.
  // Quill is the only editor now, but openingText/middleText/closingText
  // remain the persisted "flat fallback" and the source-of-truth for
  // disabled-state checks.
  useEffect(() => {
    if (!loaded) return
    const t = openingRuns?.length ? runsToFlatText(openingRuns) : ''
    if (t !== openingText) setOpeningText(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openingRuns, loaded])
  useEffect(() => {
    if (!loaded) return
    const t = middleRuns?.length ? runsToFlatText(middleRuns) : ''
    if (t !== middleText) setMiddleText(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [middleRuns, loaded])
  useEffect(() => {
    if (!loaded) return
    const t = closingRuns?.length ? runsToFlatText(closingRuns) : ''
    if (t !== closingText) setClosingText(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closingRuns, loaded])

  // Debounced save on any change — same pattern as legacy app.
  useEffect(() => {
    if (!loaded) return
    // openingText / middleText / closingText are now flat-fallback
    // copies kept in sync via the effects above. Use them directly.
    const flatOpening = openingText
    const flatMiddle = middleText
    const flatClosing = closingText
    const payload = {
      openingText: flatOpening,
      middleText: flatMiddle,
      closingText: flatClosing,
      // null instead of [] so the back-compat read at line ~52 stays
      // simple (truthy = present, falsy = plain text mode).
      openingRuns: openingRuns?.length ? openingRuns : null,
      middleRuns:  middleRuns?.length  ? middleRuns  : null,
      closingRuns: closingRuns?.length ? closingRuns : null,
      openingDuration, middleStartTime, middleDuration, closingDuration,
      storyFontSize: Number(fontSize) || 48,
      storyFontFamily: fontFamily,
      storyFontColor: fontColor,
      storyFontOutline: fontOutline,
      storyFontOutlineWidth: Number(outlineWidth) || 3,
      lineHeight: Number(lineHeight) || 1.3,
      letterSpacing: Number(letterSpacing) || 0,
      overlayYPct: Number(overlayYPct),
      // Default-level box config (e.g. white pill background). null
      // means "no box". Slot-level boxes override the default of
      // the same name when set.
      storyBox: boxConfig || null,

      // Per-slot full style overrides — canonical shape. The BE
      // export pipeline reads these directly when the per-slot key
      // is set; otherwise it falls back to the default of the same
      // name. Each object is sparse: missing fields = inherit.
      openingStyle: slotStyles.opening || {},
      middleStyle:  slotStyles.middle  || {},
      closingStyle: slotStyles.closing || {},

      // Legacy mirror — old BE/FE consumers read these flat keys.
      // Keep them in sync so a deploy carrying the new code can
      // still serve a session running the old code (and vice-versa).
      // null = "no override, use overlayYPct / storyFontColor / size".
      openingYPct:      slotStyles.opening?.yPct      != null ? Number(slotStyles.opening.yPct)      : null,
      middleYPct:       slotStyles.middle?.yPct       != null ? Number(slotStyles.middle.yPct)       : null,
      closingYPct:      slotStyles.closing?.yPct      != null ? Number(slotStyles.closing.yPct)      : null,
      openingFontColor: slotStyles.opening?.fontColor || null,
      middleFontColor:  slotStyles.middle?.fontColor  || null,
      closingFontColor: slotStyles.closing?.fontColor || null,
      openingFontSize:  slotStyles.opening?.fontSize  != null ? Number(slotStyles.opening.fontSize)  : null,
      middleFontSize:   slotStyles.middle?.fontSize   != null ? Number(slotStyles.middle.fontSize)   : null,
      closingFontSize:  slotStyles.closing?.fontSize  != null ? Number(slotStyles.closing.fontSize)  : null,
      // Flat per-slot box keys — mirrors slotStyles.{slot}.box so the
      // FE preview's OverlayText (reads style?.{slot}Box) and the BE
      // render-final route (reads overlay.{slot}Box) get the box
      // override without having to peek into the nested style obj.
      openingBox: slotStyles.opening?.box || null,
      middleBox:  slotStyles.middle?.box  || null,
      closingBox: slotStyles.closing?.box || null,
    }
    jobSync.saveOverlaySettings?.(payload)
    // Broadcast to FinalPreviewV2 so the overlay preview updates live.
    try {
      if (typeof window !== 'undefined') {
        window._postyOverlays = payload
        window.dispatchEvent(new CustomEvent('posty-overlay-change', { detail: payload }))
      }
    } catch {}
    setSaved(true)
    const t = setTimeout(() => setSaved(false), 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openingText, middleText, closingText, openingRuns, middleRuns, closingRuns, openingDuration, middleStartTime, middleDuration, closingDuration, fontSize, fontFamily, fontColor, fontOutline, outlineWidth, lineHeight, letterSpacing, overlayYPct, boxConfig, slotStyles, loaded])

  // Wipe every per-slot override so all three slots inherit the
  // current default style. Used by the explicit "Apply to all
  // overlays" button on the Default style block AND by the preset
  // fold's onApply path so picking a preset doesn't leave orphan
  // per-slot overrides from a previous tweak. Resets to the canonical
  // empty-object form which serializes to the same shape as a fresh
  // job so no orphan keys survive.
  const applyDefaultsToAllSlots = () => {
    setSlotStyles({ opening: {}, middle: {}, closing: {} })
  }

  // Scrub the shared FinalPreview <video> so the user can see their
  // overlays rendered in sync with the clip. No server re-render —
  // OverlayText already reads window._postyOverlays on every timeupdate,
  // so playing the merged video shows the current settings burned on top.
  const getVideo = () => previewRef?.current?.getVideo?.() || null
  const scheduleStop = (video, stopAt) => {
    // Pauses the video when it reaches `stopAt` seconds. We poll via
    // timeupdate + a safety timeout so we stop even if the event is slow.
    const onTick = () => {
      if (video.currentTime >= stopAt - 0.05) {
        try { video.pause() } catch {}
        video.removeEventListener('timeupdate', onTick)
      }
    }
    video.addEventListener('timeupdate', onTick)
    const ms = Math.max(200, (stopAt - video.currentTime) * 1000 + 200)
    setTimeout(() => {
      video.removeEventListener('timeupdate', onTick)
      if (!video.paused && video.currentTime >= stopAt - 0.1) {
        try { video.pause() } catch {}
      }
    }, ms)
  }
  const playAll = () => {
    const v = getVideo(); if (!v) return
    try { v.currentTime = 0; v.play() } catch {}
  }
  const playOpening = () => {
    const v = getVideo(); if (!v) return
    const stopAt = Math.max(0.3, Number(openingDuration) || 3) + 0.3
    try { v.currentTime = 0; v.play(); scheduleStop(v, stopAt) } catch {}
  }
  const playMiddle = () => {
    const v = getVideo(); if (!v) return
    const start = Math.max(0, Number(middleStartTime) || 0)
    const stopAt = start + Math.max(0.3, Number(middleDuration) || 3) + 0.3
    try { v.currentTime = start; v.play(); scheduleStop(v, stopAt) } catch {}
  }
  const playClosing = () => {
    const v = getVideo(); if (!v) return
    const dur = Number(v.duration) || 0
    if (!dur) return
    const closeDur = Math.max(0.3, Number(closingDuration) || 3)
    try { v.currentTime = Math.max(0, dur - closeDur); v.play() } catch {}
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">On-screen captions</div>
        {saved && <span className="text-[9px] text-[#2D9A5E]">✓ Saved</span>}
      </div>

      <div className="bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded p-2 space-y-1.5">
        <div className="text-[10px] text-muted">
          Preview overlays on the video above. Plays locally — no re-render needed.
        </div>
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={playAll}
            className="flex-1 min-w-[80px] text-[10px] py-1 bg-[#6C5CE7] text-white border-none rounded cursor-pointer"
            title="Play the whole clip with current overlays applied"
          >▶ Play all</button>
          <button
            onClick={playOpening}
            disabled={!openingText?.trim()}
            className="flex-1 min-w-[80px] text-[10px] py-1 border border-[#6C5CE7] text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-40"
          >▶ Opening</button>
          <button
            onClick={playMiddle}
            disabled={!middleText?.trim()}
            className="flex-1 min-w-[80px] text-[10px] py-1 border border-[#6C5CE7] text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-40"
          >▶ Middle</button>
          <button
            onClick={playClosing}
            disabled={!closingText?.trim()}
            className="flex-1 min-w-[80px] text-[10px] py-1 border border-[#6C5CE7] text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-40"
          >▶ Closing</button>
        </div>
      </div>

      {/* Style block intentionally first — it sets the defaults
          (font / color / size / outline / vertical position) that
          every overlay slot inherits. Overlay-specific Quill rich-
          text overrides only kick in when the user explicitly
          styles a selection. */}
      <div className="border border-[#e5e5e5] rounded p-2 space-y-2 bg-[#fafafa]">
        {/* Header row mirrors the voiceover CaptionStyleEditor —
            title, current-preset pill, "🎭 presets" toggle that
            swaps the form for the picker, and "Apply to all" on the
            far right. Pill is two-state on the default (applied vs
            custom) since the default has nothing to inherit from. */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-[11px] font-medium">Default style</div>
          {(() => {
            const matched = matchOverlayPreset(presetCatalog || [], {
              fontFamily, fontColor, fontOutline, outlineWidth, box: boxConfig,
            })
            return matched ? (
              <span
                className="text-[10px] py-0.5 px-1.5 rounded border bg-[#6C5CE7]/10 border-[#6C5CE7]/40 text-[#6C5CE7] flex items-center gap-1"
                title={`Default matches the "${matched.displayName}" preset`}
              >
                {matched.thumbnailEmoji && <span className="leading-none">{matched.thumbnailEmoji}</span>}
                {matched.displayName}
              </span>
            ) : (
              <span
                className="text-[10px] py-0.5 px-1.5 rounded border bg-[#fafafa] border-[#e5e5e5] text-muted"
                title="Default — doesn't match any preset"
              >custom</span>
            )
          })()}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setDefaultPresetsOpen(v => !v)}
            className={`text-[10px] py-1 px-2 border rounded cursor-pointer flex items-center gap-1 ${
              defaultPresetsOpen
                ? 'border-[#6C5CE7] bg-[#6C5CE7]/10 text-[#6C5CE7]'
                : 'border-[#6C5CE7]/40 bg-white text-[#6C5CE7]'
            }`}
            title="Pick a preset for the default style — applies to every slot that inherits"
          >{defaultPresetsOpen ? '✕' : '🎭'} presets</button>
          <button
            type="button"
            onClick={applyDefaultsToAllSlots}
            className="text-[10px] py-1 px-2 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer"
            title="Clear every per-slot override so opening, middle, and closing all inherit this default"
          >Apply to all overlays</button>
        </div>
        <div className="text-[10px] text-muted italic">
          Applies to every overlay slot that hasn't been customized. Individual slots can still override it.
        </div>
        {defaultPresetsOpen && (
          <Suspense fallback={<div className="text-[10px] text-muted italic py-2 text-center">Loading presets…</div>}>
            <CaptionPresetPicker
              onApply={(preset) => {
                const c = preset.config || {}
                if (c.base_font_family) setFontFamily(c.base_font_family)
                if (c.base_font_color) setFontColor(c.base_font_color)
                // Outline is bidirectional — turn ON when the preset
                // has an outline config, OFF when it doesn't. Without
                // this, applying e.g. Bold Pill (no outline) over a
                // default with outline=true left fontOutline stuck on
                // → matcher mismatched → pill never showed.
                if (c.active_word_outline_config?.type === 'outline') {
                  setFontOutline(true)
                  if (Number(c.active_word_outline_config.width) > 0) {
                    setOutlineWidth(Math.round(c.active_word_outline_config.width))
                  }
                } else {
                  setFontOutline(false)
                }
                // Box / pill background — taken from the preset's
                // layout_config.box. null when the preset has no box
                // config so applying a non-box preset over a previous
                // box-based one wipes the background cleanly.
                setBoxConfig(c.layout_config?.box || null)
                applyDefaultsToAllSlots()
                setDefaultPresetsOpen(false)
              }}
            />
          </Suspense>
        )}
        {!defaultPresetsOpen && <DefaultStyleControls
          fontFamily={fontFamily} setFontFamily={setFontFamily}
          fontSize={fontSize} setFontSize={setFontSize}
          fontColor={fontColor} setFontColor={setFontColor}
          fontOutline={fontOutline} setFontOutline={setFontOutline}
          outlineWidth={outlineWidth} setOutlineWidth={setOutlineWidth}
          lineHeight={lineHeight} setLineHeight={setLineHeight}
          letterSpacing={letterSpacing} setLetterSpacing={setLetterSpacing}
          overlayYPct={overlayYPct} setOverlayYPct={setOverlayYPct}
          fontPickerOpen={fontPickerOpen} setFontPickerOpen={setFontPickerOpen}
        />}
      </div>

      <div className="space-y-2">
        {[
          { key: 'opening', label: 'Opening (first 0-2s)', runs: openingRuns, setRuns: setOpeningRuns, placeholder: 'POV: your birthday just got a signature scent' },
          { key: 'middle',  label: 'Middle (optional)',     runs: middleRuns,  setRuns: setMiddleRuns,  placeholder: 'You made it together' },
          { key: 'closing', label: 'Closing (last 1-2s)',   runs: closingRuns, setRuns: setClosingRuns, placeholder: 'Only at Poppy & Thyme' },
        ].map(slot => {
          const ss = slotStyles[slot.key] || {}
          return (
            <div key={slot.key}>
              <label className="text-[10px] text-muted">{slot.label}</label>
              <RichTextEditor
                runs={slot.runs}
                onChange={slot.setRuns}
                defaults={{
                  color: ss.fontColor || fontColor,
                  fontFamily: ss.fontFamily || fontFamily,
                  fontSize: ss.fontSize != null ? ss.fontSize : fontSize,
                }}
                placeholder={slot.placeholder}
              />
              <ResetColorsLink runs={slot.runs} setRuns={slot.setRuns} />
              <div className="flex items-center gap-2 mt-1 text-[9px] text-muted">
                {slot.key === 'middle' ? (
                  <>
                    <label>Start at:</label>
                    <DecimalInput value={middleStartTime} onChange={setMiddleStartTime} />
                    <span>s · </span>
                    <label>Duration:</label>
                    <DecimalInput value={middleDuration} onChange={setMiddleDuration} />
                    <span>s</span>
                  </>
                ) : (
                  <>
                    <label>Duration:</label>
                    <DecimalInput
                      value={slot.key === 'opening' ? openingDuration : closingDuration}
                      onChange={slot.key === 'opening' ? setOpeningDuration : setClosingDuration}
                    />
                    <span>s</span>
                  </>
                )}
              </div>
              <SlotStyleFold
                slotStyle={ss}
                onPatch={(field, value) => updateSlotStyle(slot.key, field, value)}
                defaults={{ fontFamily, fontSize, fontColor, fontOutline, outlineWidth, lineHeight, letterSpacing, overlayYPct, box: boxConfig }}
                presetCatalog={presetCatalog}
              />
            </div>
          )
        })}
      </div>

      <div className="text-[9px] text-muted italic pt-1 border-t border-[#e5e5e5]">
        Preview shown live on the video above. Each slot's Y can override the global slider — leave a slot's Y blank (italic <em>=global</em>) to inherit; type 0–100 to lock that slot to its own vertical position.
      </div>
    </div>
  )
}

// Full-row per-slot Y position control. The previous compact
// version (a tiny "Y:" input squeezed into the duration row) was
// too easy to mistake for informational text — users were
// looking for the new control and not finding it. This version
// is its own row with a slider, an explicit label, the live
// percentage value, and a clear "← Use global" button when an
// override is active. Inheriting the global value reads as
// "Y position: inherits global (70%)".
// Decimal-friendly text input for second-precision timing fields.
//
// Bug we hit: a controlled input that does
//   onChange={e => setValue(Number(e.target.value) || 0)}
// can't accept decimals because typing "1." → Number("1.") = 1 →
// state becomes 1 → input re-binds to "1" → the trailing "." is
// erased before the user can type "5". Result: only whole numbers
// accepted.
//
// Fix: keep the typed string locally while the field is being
// edited; only coerce to Number on blur (or when the parent is
// already storing strings). The parent's effects already do
// Number(value) where they need a number, so it doesn't matter
// whether the prop is a "1.5" string or a 1.5 number.
function DecimalInput({ value, onChange, placeholder, ariaLabel }) {
  // Keep an internal "draft" string so an in-progress decimal
  // ("1.") survives parent re-renders. Sync to the parent's value
  // when the field is NOT being edited so external changes
  // (defaults, programmatic updates) flow through.
  const [draft, setDraft] = useState(() => (value == null || value === '' ? '' : String(value)))
  const editingRef = useRef(false)
  useEffect(() => {
    if (!editingRef.current) {
      const next = (value == null || value === '' ? '' : String(value))
      if (next !== draft) setDraft(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onFocus={() => { editingRef.current = true }}
      onChange={e => {
        // Allow digits and at most one decimal separator.
        const cleaned = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
        setDraft(cleaned)
        // Push a parsed number up so live preview / save effects
        // see the latest value mid-typing. Empty string and bare
        // "." both flow up as 0; "1." flows up as 1; "1.5" as 1.5.
        const n = cleaned === '' || cleaned === '.' ? 0 : Number(cleaned)
        if (Number.isFinite(n)) onChange(n)
      }}
      onBlur={() => {
        editingRef.current = false
        // On blur, normalize the visible string to whatever the
        // parent now considers canonical (e.g. trailing "." becomes
        // "1"). Avoids visual confusion if focus moves away
        // mid-decimal.
        setDraft(value == null || value === '' ? '' : String(value))
      }}
      className="w-12 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
    />
  )
}

// Tiny "reset colors" link below each editor — only visible when
// at least one run carries an explicit color override. Stripping
// per-run color makes the slot fall back to the panel's global
// font color (storyFontColor) so the overlay re-honors what the
// outer color picker says. Common cause of stuck color overrides:
// pasted text from a webpage with inline `color: #xxx` styles
// gets captured into the run, and the user later changes the
// panel color but the runs still carry the literal old color.
function ResetColorsLink({ runs, setRuns }) {
  const hasColorOverride = Array.isArray(runs) && runs.some(r => r && r.color)
  if (!hasColorOverride) return null
  const reset = () => {
    setRuns(runs.map(r => {
      if (!r) return r
      // eslint-disable-next-line no-unused-vars
      const { color, ...rest } = r
      return rest
    }))
  }
  return (
    <button
      type="button"
      onClick={reset}
      className="mt-1 text-[9px] text-[#6C5CE7] bg-transparent border-none cursor-pointer underline px-0"
      title="Drop per-run color overrides so this slot's text follows the global font color"
    >↺ reset colors to global</button>
  )
}

// Per-slot font color row. Mirrors SlotYRow's UX: a color swatch
// sits next to a row label, with "inherits" / "← global" status
// on the right. value === null/undefined means "use global"; any
// hex string activates the override and the swatch renders that
// color even if it matches the global (so the user can still see
// what they picked). The color picker is the same browser-native
// input the panel-wide picker uses.
function SlotColorRow({ value, fallback, onChange }) {
  const overridden = value != null && value !== ''
  const fb = String(fallback || '#ffffff')
  const effective = overridden ? value : fb
  return (
    <div className="flex items-center gap-2 mt-1 text-[9px] text-muted bg-[#f8f7f3] rounded px-2 py-1.5">
      <span className="text-[9px] font-medium text-ink whitespace-nowrap">Color:</span>
      <input
        type="color"
        value={effective}
        onChange={e => onChange(e.target.value)}
        className="w-6 h-6 border border-[#e5e5e5] rounded cursor-pointer p-0"
        aria-label="Slot font color"
      />
      <span className={`font-mono text-[10px] w-[68px] ${overridden ? 'text-ink' : 'text-muted italic'}`}>
        {effective}
      </span>
      {overridden ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-auto text-[9px] py-0.5 px-1.5 border border-[#e5e5e5] bg-white rounded cursor-pointer"
          title="Clear this slot's color override and inherit from the global picker"
        >← global</button>
      ) : (
        <span className="ml-auto text-[9px] italic text-muted whitespace-nowrap" title="This slot inherits from the global Color picker — pick a swatch to override">inherits</span>
      )}
    </div>
  )
}

// All the default-style form fields, lifted out of the panel body so
// they can be hidden when the presets picker is open (mirrors the
// voiceover CaptionStyleEditor pattern: presets toggle swaps the
// form ↔ picker inline).
function DefaultStyleControls({
  fontFamily, setFontFamily,
  fontSize, setFontSize,
  fontColor, setFontColor,
  fontOutline, setFontOutline,
  outlineWidth, setOutlineWidth,
  lineHeight, setLineHeight,
  letterSpacing, setLetterSpacing,
  overlayYPct, setOverlayYPct,
  fontPickerOpen, setFontPickerOpen,
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] flex-wrap">
        <label>Font:</label>
        <button
          type="button"
          onClick={() => setFontPickerOpen(v => !v)}
          className="flex-1 min-w-[140px] text-left flex items-center gap-2 bg-white border border-[#e5e5e5] hover:border-[#6C5CE7]/50 rounded py-1 px-2 cursor-pointer"
          title="Pick an overlay font — preview tiles show the real face"
        >
          <span
            className="text-[12px] truncate flex-1"
            style={{ fontFamily: `'${fontFamily}', system-ui, sans-serif` }}
          >The quick brown fox</span>
          <span className="text-[9px] text-muted truncate">{fontFamily}</span>
          <span className="text-[10px] text-muted">{fontPickerOpen ? '▾' : '▸'}</span>
        </button>
        <label>Size:</label>
        <input
          type="text"
          inputMode="numeric"
          value={fontSize}
          onChange={e => setFontSize(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
          className="w-12 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
        />
        <label>Color:</label>
        <input
          type="color"
          value={fontColor}
          onChange={e => setFontColor(e.target.value)}
          className="w-6 h-6 border border-[#e5e5e5] rounded cursor-pointer p-0"
        />
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={fontOutline} onChange={e => setFontOutline(e.target.checked)} />
          Outline
        </label>
        {fontOutline && (
          <>
            <label>Width:</label>
            <input
              type="text"
              inputMode="numeric"
              value={outlineWidth}
              onChange={e => setOutlineWidth(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
              className="w-10 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
            />
            <span>px</span>
          </>
        )}
      </div>

      {fontPickerOpen && (
        <Suspense fallback={<div className="text-[11px] text-muted italic py-4 text-center">Loading fonts…</div>}>
          <FontPicker
            value={fontFamily}
            purpose="base"
            onChange={(fam) => { setFontFamily(fam); setFontPickerOpen(false) }}
          />
        </Suspense>
      )}

      <div className="flex items-center gap-2 text-[10px] flex-wrap">
        <label className="flex items-center gap-1 text-muted">
          <span>Line height:</span>
          <input
            type="text"
            inputMode="decimal"
            value={lineHeight}
            onChange={e => setLineHeight(e.target.value.replace(/[^0-9.]/g, ''))}
            onBlur={e => {
              const n = parseFloat(e.target.value)
              setLineHeight(Number.isFinite(n) && n > 0 ? n : 1.3)
            }}
            className="w-14 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
            title="Space between lines as a multiplier of font size (e.g. 1.3)"
          />
        </label>
        <label className="flex items-center gap-1 text-muted">
          <span>Letter spacing:</span>
          <input
            type="text"
            inputMode="decimal"
            value={letterSpacing}
            onChange={e => setLetterSpacing(e.target.value.replace(/[^0-9.-]/g, ''))}
            onBlur={e => {
              const n = parseFloat(e.target.value)
              setLetterSpacing(Number.isFinite(n) ? n : 0)
            }}
            className="w-14 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
            title="Character spacing (0 = normal, positive = wider)"
          />
        </label>
      </div>

      <div className="bg-white border border-[#e5e5e5] rounded p-2 space-y-1">
        <label className="text-[10px] font-medium flex items-center gap-2">
          <span>↕ Vertical position</span>
          <span className="font-mono text-[#6C5CE7] ml-auto">{overlayYPct}%</span>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={overlayYPct}
          onChange={e => setOverlayYPct(Number(e.target.value))}
          className="w-full h-5 accent-[#6C5CE7]"
          aria-label="Vertical overlay position"
        />
        <div className="flex items-center justify-between text-[8px] text-muted">
          <span>top</span>
          <span className="opacity-60">clears TikTok/IG UI chrome</span>
          <span>bottom</span>
        </div>
      </div>
    </div>
  )
}

// Collapsible per-slot style controls — mirrors the voiceover
// CaptionStyleEditor: closed = trigger button + state pill; open =
// header (title + pill + "🎭 presets" toggle + "✕ close") and a body
// that swaps form ↔ preset picker based on `presetsOpen`. State pill
// is three-state — purple "<preset>" for an applied override that
// matches a preset, grey "custom" for an applied override with no
// preset match, green "inherit: <default preset>" when the slot
// inherits.
function SlotStyleFold({ slotStyle, onPatch, defaults, presetCatalog }) {
  const [open, setOpen] = useState(false)
  const [presetsOpen, setPresetsOpen] = useState(false)
  const [fontPickerOpen, setFontPickerOpen] = useState(false)
  const effective = {
    fontFamily:    slotStyle?.fontFamily    ?? defaults.fontFamily,
    fontSize:      slotStyle?.fontSize      ?? defaults.fontSize,
    fontColor:     slotStyle?.fontColor     ?? defaults.fontColor,
    fontOutline:   slotStyle?.fontOutline   ?? defaults.fontOutline,
    outlineWidth:  slotStyle?.outlineWidth  ?? defaults.outlineWidth,
    lineHeight:    slotStyle?.lineHeight    ?? defaults.lineHeight,
    letterSpacing: slotStyle?.letterSpacing ?? defaults.letterSpacing,
    yPct:          slotStyle?.yPct          ?? defaults.overlayYPct,
    box:           slotStyle?.box           ?? defaults.box,
  }
  const slotPreset = matchOverlayPreset(presetCatalog || [], effective)
  const defaultPreset = matchOverlayPreset(presetCatalog || [], {
    fontFamily: defaults.fontFamily,
    fontColor: defaults.fontColor,
    fontOutline: defaults.fontOutline,
    outlineWidth: defaults.outlineWidth,
    box: defaults.box,
  })
  const overrideKeys = Object.keys(slotStyle || {}).filter(k => slotStyle[k] !== undefined)
  const isOverride = overrideKeys.length > 0

  // Pill model — shared by the closed-state trigger button and the
  // open-state editor header so both reads are byte-identical.
  const pill = isOverride
    ? slotPreset
      ? { tone: 'applied', label: slotPreset.displayName, emoji: slotPreset.thumbnailEmoji, title: `Matches the "${slotPreset.displayName}" preset` }
      : { tone: 'custom', label: 'custom', emoji: null, title: 'Custom override — doesn\'t match any preset' }
    : defaultPreset
      ? { tone: 'inherited', label: `inherit: ${defaultPreset.displayName}`, emoji: defaultPreset.thumbnailEmoji, title: 'No per-slot override — inheriting default style' }
      : { tone: 'inherited', label: 'inherit default', emoji: null, title: 'No per-slot override — inheriting default style' }
  const pillClasses =
    pill.tone === 'applied' ? 'bg-[#6C5CE7]/10 border-[#6C5CE7]/40 text-[#6C5CE7]'
      : pill.tone === 'inherited' ? 'bg-[#2D9A5E]/10 border-[#2D9A5E]/40 text-[#2D9A5E]'
      : 'bg-[#fafafa] border-[#e5e5e5] text-muted'

  // Closed-state trigger row.
  if (!open) {
    return (
      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[10px] py-0.5 px-2 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer"
          title="Edit this slot's font, color, outline, line height, letter spacing, and vertical position"
        >🎨 caption style</button>
        <span
          className={`text-[9px] py-0.5 px-1.5 rounded border flex items-center gap-1 ${pillClasses}`}
          title={pill.title}
        >
          {pill.emoji && <span className="text-[10px] leading-none">{pill.emoji}</span>}
          {pill.label}
        </span>
      </div>
    )
  }

  // Open-state editor — header + body (form OR picker).
  return (
    <div className="mt-1 bg-[#fafafa] border border-[#e5e5e5] rounded-lg p-3 space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[12px] font-medium">Caption style</div>
        <span
          className={`text-[10px] py-0.5 px-1.5 rounded border flex items-center gap-1 ${pillClasses}`}
          title={pill.title}
        >
          {pill.emoji && <span className="text-[11px] leading-none">{pill.emoji}</span>}
          {pill.label}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setPresetsOpen(v => !v)}
          className="text-[10px] py-1 px-2 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer"
          title="Start from a preset — you can still customize below"
        >{presetsOpen ? '✕' : '🎭'} presets</button>
        <button
          type="button"
          onClick={() => { setOpen(false); setPresetsOpen(false); setFontPickerOpen(false) }}
          className="text-[10px] text-muted bg-transparent border-none cursor-pointer"
        >✕ close</button>
      </div>

      {/* Inheritance hint — same UX as the voiceover editor's
          "Inheriting job default" / "This segment overrides" rows.
          When inheriting, encourages editing; when overriding, shows
          a "↺ inherit default" button to drop every override. */}
      {!isOverride && (
        <div className="bg-[#f0faf4] border border-[#2D9A5E]/30 rounded px-2 py-1.5 text-[10px] text-[#2D9A5E] flex items-center gap-2">
          <span className="flex-1">
            <span className="font-medium">Inheriting default style.</span>{' '}
            Edit any field below to override, or apply a preset to this slot only.
          </span>
        </div>
      )}
      {isOverride && (
        <div className="flex items-center justify-between bg-white border border-[#e5e5e5] rounded px-2 py-1 text-[10px] text-muted gap-2">
          <span>This slot overrides the default style.</span>
          <button
            type="button"
            onClick={() => {
              for (const k of ['yPct', 'fontColor', 'fontFamily', 'fontSize', 'fontOutline', 'outlineWidth', 'lineHeight', 'letterSpacing', 'box']) {
                onPatch(k, null)
              }
            }}
            className="text-[10px] py-0.5 px-2 border border-[#2D9A5E]/40 text-[#2D9A5E] bg-white rounded cursor-pointer"
            title="Drop every per-slot override so this slot follows the default style"
          >↺ inherit default</button>
        </div>
      )}

      {presetsOpen ? (
        <Suspense fallback={<div className="text-[10px] text-muted italic py-2 text-center">Loading presets…</div>}>
          <CaptionPresetPicker
            onApply={(preset) => {
              const c = preset.config || {}
              if (c.base_font_family) onPatch('fontFamily', c.base_font_family)
              if (c.base_font_color) onPatch('fontColor', c.base_font_color)
              // Bidirectional outline — see DefaultStyleControls
              // applyPreset for the same reasoning. Without the
              // explicit `false` branch, a slot that picked a
              // non-outline preset stayed at outline=true (inherited
              // from default) and the pill never showed.
              if (c.active_word_outline_config?.type === 'outline') {
                onPatch('fontOutline', true)
                if (Number(c.active_word_outline_config.width) > 0) {
                  onPatch('outlineWidth', Math.round(c.active_word_outline_config.width))
                }
              } else {
                onPatch('fontOutline', false)
              }
              onPatch('box', c.layout_config?.box || null)
              setPresetsOpen(false)
            }}
          />
        </Suspense>
      ) : (
        <div className="space-y-1.5">
          {/* Font row — picker + size + color + outline. Mirrors the
              default style row's controls 1:1, but each writes onto
              the slot's override bundle via onPatch. */}
          <div className="flex items-center gap-2 text-[10px] flex-wrap">
            <label>Font:</label>
            <button
              type="button"
              onClick={() => setFontPickerOpen(v => !v)}
              className="flex-1 min-w-[140px] text-left flex items-center gap-2 bg-white border border-[#e5e5e5] hover:border-[#6C5CE7]/50 rounded py-1 px-2 cursor-pointer"
            >
              <span className="text-[12px] truncate flex-1" style={{ fontFamily: `'${effective.fontFamily}', system-ui, sans-serif` }}>The quick brown fox</span>
              <span className="text-[9px] text-muted truncate">{slotStyle?.fontFamily ? effective.fontFamily : `${effective.fontFamily} (default)`}</span>
              <span className="text-[10px] text-muted">{fontPickerOpen ? '▾' : '▸'}</span>
            </button>
            <label>Size:</label>
            <input
              type="text"
              inputMode="numeric"
              value={effective.fontSize}
              onChange={e => onPatch('fontSize', Number(e.target.value.replace(/[^0-9]/g, '')) || null)}
              className="w-12 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
            />
            <label>Color:</label>
            <input
              type="color"
              value={effective.fontColor}
              onChange={e => onPatch('fontColor', e.target.value)}
              className="w-6 h-6 border border-[#e5e5e5] rounded cursor-pointer p-0"
            />
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={!!effective.fontOutline}
                onChange={e => onPatch('fontOutline', e.target.checked)}
              />
              Outline
            </label>
            {effective.fontOutline && (
              <>
                <label>Width:</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={effective.outlineWidth}
                  onChange={e => onPatch('outlineWidth', Number(e.target.value.replace(/[^0-9]/g, '')) || null)}
                  className="w-10 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
                />
                <span>px</span>
              </>
            )}
          </div>
          {fontPickerOpen && (
            <Suspense fallback={<div className="text-[11px] text-muted italic py-4 text-center">Loading fonts…</div>}>
              <FontPicker
                value={effective.fontFamily}
                purpose="base"
                onChange={(fam) => { onPatch('fontFamily', fam); setFontPickerOpen(false) }}
              />
            </Suspense>
          )}

          <div className="flex items-center gap-2 text-[10px] flex-wrap">
            <label className="flex items-center gap-1 text-muted">
              <span>Line height:</span>
              <input
                type="text"
                inputMode="decimal"
                value={effective.lineHeight}
                onChange={e => onPatch('lineHeight', Number(String(e.target.value).replace(/[^0-9.]/g, '')) || null)}
                className="w-14 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
              />
            </label>
            <label className="flex items-center gap-1 text-muted">
              <span>Letter spacing:</span>
              <input
                type="text"
                inputMode="decimal"
                value={effective.letterSpacing}
                onChange={e => {
                  const cleaned = String(e.target.value).replace(/[^0-9.-]/g, '')
                  const n = parseFloat(cleaned)
                  onPatch('letterSpacing', Number.isFinite(n) ? n : null)
                }}
                className="w-14 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
              />
            </label>
          </div>

          <SlotYRow
            value={slotStyle?.yPct ?? null}
            fallback={defaults.overlayYPct}
            onChange={(v) => onPatch('yPct', v)}
          />
        </div>
      )}
    </div>
  )
}

// Match an overlay-effective config (fontFamily / fontColor /
// fontOutline / outlineWidth) against the catalog of caption presets.
// Only the overlay-compatible fields are compared because the rest
// (word timings, animations, etc.) don't render in static drawtext.
// Returns the best match or null. Comparison is case-insensitive on
// font names + 6-digit hex normalization on colors.
function matchOverlayPreset(catalog, eff) {
  if (!Array.isArray(catalog) || catalog.length === 0) return null
  const normColor = (c) => {
    if (!c) return null
    const s = String(c).toLowerCase().trim()
    if (s.startsWith('#') && s.length === 4) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
    return s
  }
  // Box equality: presence of a box (and its color) is the meaningful
  // signal — paddings vary by preset but rarely uniquely identify it.
  // Match by hasBox + boxColor; let padding/cornerRadius drift.
  const boxKey = (b) => {
    if (!b || typeof b !== 'object') return 'none'
    return `box:${normColor(b.color) || 'na'}`
  }
  const targetFam = String(eff.fontFamily || '').trim().toLowerCase()
  const targetColor = normColor(eff.fontColor)
  const targetOutline = !!eff.fontOutline
  const targetBoxKey = boxKey(eff.box)
  for (const p of catalog) {
    const c = p.config || {}
    if (!c.base_font_family || !c.base_font_color) continue
    const pFam = String(c.base_font_family).trim().toLowerCase()
    const pColor = normColor(c.base_font_color)
    const pOutline = c.active_word_outline_config?.type === 'outline'
    const pBoxKey = boxKey(c.layout_config?.box)
    if (pFam === targetFam && pColor === targetColor && pOutline === targetOutline && pBoxKey === targetBoxKey) return p
  }
  return null
}

function SlotYRow({ value, fallback, onChange }) {
  const overridden = value != null
  const fb = Math.round(Number(fallback) || 0)
  const effective = overridden ? Number(value) : fb
  return (
    <div className="flex items-center gap-2 mt-1 text-[9px] text-muted bg-[#f8f7f3] rounded px-2 py-1.5">
      <span className="text-[9px] font-medium text-ink whitespace-nowrap">Y position:</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={effective}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 accent-[#6C5CE7]"
        aria-label="Slot vertical position 0-100"
      />
      <span className={`font-mono text-[10px] w-8 text-right ${overridden ? 'text-ink font-medium' : 'text-muted italic'}`}>
        {effective}%
      </span>
      {overridden ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-[9px] py-0.5 px-1.5 border border-[#e5e5e5] bg-white rounded cursor-pointer"
          title="Clear this slot's Y override and inherit from the global slider"
        >← global</button>
      ) : (
        <span className="text-[9px] italic text-muted whitespace-nowrap" title="This slot inherits from the global Y slider — drag to override">inherits</span>
      )}
    </div>
  )
}

// Foldable "Apply caption preset" UI. Only the overlay-compatible
// fields flow through — word timings, active-word effects, reveals,
// and animations are caption-layer concepts that don't map onto
// FFmpeg drawtext burn-in. Rendered as an advisory line under the
// picker so users aren't surprised when their "Floating Wave"
// preset doesn't actually wave on the overlay.
