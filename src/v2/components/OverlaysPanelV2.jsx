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
  // Y position 0-100% within the platform-safe center band (same scale
  // as ResultCard's overlayYPct). 70 is a common default — near-bottom
  // but clear of the platform's reserved caption/UI zone.
  const [overlayYPct, setOverlayYPct] = useState(70)
  // Per-slot Y overrides — null = "use global overlayYPct". Old jobs
  // (no per-slot keys in overlay_settings) stay null after hydrate so
  // the burn-in pipeline falls back to the single global Y exactly as
  // before. Setting any of these to a number activates the override.
  const [openingYPct, setOpeningYPct] = useState(null)
  const [middleYPct, setMiddleYPct] = useState(null)
  const [closingYPct, setClosingYPct] = useState(null)
  // Per-slot font color overrides. Same null = "inherit global"
  // pattern as Y. Backwards compatible — old jobs render at the
  // single panel storyFontColor.
  const [openingFontColor, setOpeningFontColor] = useState(null)
  const [middleFontColor, setMiddleFontColor] = useState(null)
  const [closingFontColor, setClosingFontColor] = useState(null)
  const [saved, setSaved] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [fontPickerOpen, setFontPickerOpen] = useState(false)

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
        // Per-slot Y — only adopt when explicitly persisted; otherwise
        // null carries the "inherit from global" meaning into the
        // payload below.
        if (o.openingYPct != null) setOpeningYPct(Number(o.openingYPct))
        if (o.middleYPct  != null) setMiddleYPct(Number(o.middleYPct))
        if (o.closingYPct != null) setClosingYPct(Number(o.closingYPct))
        // Per-slot font color — same inheritance rules.
        if (o.openingFontColor) setOpeningFontColor(String(o.openingFontColor))
        if (o.middleFontColor)  setMiddleFontColor(String(o.middleFontColor))
        if (o.closingFontColor) setClosingFontColor(String(o.closingFontColor))
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
      // Per-slot overrides. null = "no override, use overlayYPct".
      // Persisting null preserves the "global mode" intent across
      // reloads so an unset slot doesn't snap to the global value
      // and silently lose the inheritance.
      openingYPct: openingYPct != null ? Number(openingYPct) : null,
      middleYPct:  middleYPct  != null ? Number(middleYPct)  : null,
      closingYPct: closingYPct != null ? Number(closingYPct) : null,
      // Per-slot font color overrides — same null-as-inherit pattern.
      openingFontColor: openingFontColor || null,
      middleFontColor:  middleFontColor  || null,
      closingFontColor: closingFontColor || null,
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
  }, [openingText, middleText, closingText, openingRuns, middleRuns, closingRuns, openingDuration, middleStartTime, middleDuration, closingDuration, fontSize, fontFamily, fontColor, fontOutline, outlineWidth, lineHeight, letterSpacing, overlayYPct, openingYPct, middleYPct, closingYPct, openingFontColor, middleFontColor, closingFontColor, loaded])

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
        <div className="text-[11px] font-medium">Default style (applies to all overlays)</div>
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

        <OverlayPresetFold
          onApply={(preset) => {
            const c = preset.config || {}
            if (c.base_font_family) setFontFamily(c.base_font_family)
            if (c.base_font_color) setFontColor(c.base_font_color)
            if (c.active_word_outline_config?.type === 'outline') {
              setFontOutline(true)
              if (Number(c.active_word_outline_config.width) > 0) {
                setOutlineWidth(Math.round(c.active_word_outline_config.width))
              }
            }
          }}
        />

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

      <div className="space-y-2">
        <div>
          <label className="text-[10px] text-muted">Opening (first 0-2s)</label>
          <RichTextEditor
            runs={openingRuns}
            onChange={setOpeningRuns}
            defaults={{ color: openingFontColor || fontColor, fontFamily, fontSize }}
            placeholder="POV: your birthday just got a signature scent"
          />
          <ResetColorsLink runs={openingRuns} setRuns={setOpeningRuns} />
          <div className="flex items-center gap-2 mt-1 text-[9px] text-muted">
            <label>Duration:</label>
            <DecimalInput value={openingDuration} onChange={setOpeningDuration} />
            <span>s</span>
          </div>
          <SlotYRow
            value={openingYPct}
            fallback={overlayYPct}
            onChange={setOpeningYPct}
          />
          <SlotColorRow
            value={openingFontColor}
            fallback={fontColor}
            onChange={setOpeningFontColor}
          />
        </div>

        <div>
          <label className="text-[10px] text-muted">Middle (optional)</label>
          <RichTextEditor
            runs={middleRuns}
            onChange={setMiddleRuns}
            defaults={{ color: middleFontColor || fontColor, fontFamily, fontSize }}
            placeholder="You made it together"
          />
          <ResetColorsLink runs={middleRuns} setRuns={setMiddleRuns} />
          <div className="flex items-center gap-2 mt-1 text-[9px] text-muted">
            <label>Start at:</label>
            <DecimalInput value={middleStartTime} onChange={setMiddleStartTime} />
            <span>s · </span>
            <label>Duration:</label>
            <DecimalInput value={middleDuration} onChange={setMiddleDuration} />
            <span>s</span>
          </div>
          <SlotYRow
            value={middleYPct}
            fallback={overlayYPct}
            onChange={setMiddleYPct}
          />
          <SlotColorRow
            value={middleFontColor}
            fallback={fontColor}
            onChange={setMiddleFontColor}
          />
        </div>

        <div>
          <label className="text-[10px] text-muted">Closing (last 1-2s)</label>
          <RichTextEditor
            runs={closingRuns}
            onChange={setClosingRuns}
            defaults={{ color: closingFontColor || fontColor, fontFamily, fontSize }}
            placeholder="Only at Poppy & Thyme"
          />
          <ResetColorsLink runs={closingRuns} setRuns={setClosingRuns} />
          <div className="flex items-center gap-2 mt-1 text-[9px] text-muted">
            <label>Duration:</label>
            <DecimalInput value={closingDuration} onChange={setClosingDuration} />
            <span>s</span>
          </div>
          <SlotYRow
            value={closingYPct}
            fallback={overlayYPct}
            onChange={setClosingYPct}
          />
          <SlotColorRow
            value={closingFontColor}
            fallback={fontColor}
            onChange={setClosingFontColor}
          />
        </div>
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
function OverlayPresetFold({ onApply }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-[#e5e5e5] rounded bg-white">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 p-2 cursor-pointer hover:bg-[#fafafa]"
        title="Apply a caption preset — only font/color/outline flow through"
      >
        <span className="text-[14px] leading-none">🎭</span>
        <span className="text-[11px] font-medium flex-1 text-left">Apply caption preset</span>
        <span className="text-[11px] text-muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-1.5">
          <div className="text-[9px] text-muted italic bg-[#fdf2f1] border border-[#c0392b]/20 rounded px-2 py-1">
            Overlays are burned statically by FFmpeg. Word timings,
            active-word effects, reveals, animations, text fills, and
            blurred/highlighter backgrounds don't apply here — only
            font, color, and outline transfer.
          </div>
          <Suspense fallback={<div className="text-[10px] text-muted italic py-2 text-center">Loading presets…</div>}>
            <CaptionPresetPicker
              onApply={(preset) => { onApply(preset); setOpen(false) }}
              selectedId={null}
              defaultId={null}
            />
          </Suspense>
        </div>
      )}
    </div>
  )
}
