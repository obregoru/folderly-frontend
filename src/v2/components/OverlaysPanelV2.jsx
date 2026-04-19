import { useEffect, useState } from 'react'

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
export default function OverlaysPanelV2({ jobSync, draftId }) {
  const [openingText, setOpeningText] = useState('')
  const [middleText, setMiddleText] = useState('')
  const [closingText, setClosingText] = useState('')
  const [openingDuration, setOpeningDuration] = useState(3)
  const [middleStartTime, setMiddleStartTime] = useState(4)
  const [middleDuration, setMiddleDuration] = useState(3)
  const [closingDuration, setClosingDuration] = useState(3)
  const [fontSize, setFontSize] = useState(48)
  const [fontFamily, setFontFamily] = useState('sans-serif')
  const [fontColor, setFontColor] = useState('#ffffff')
  const [fontOutline, setFontOutline] = useState(true)
  const [outlineWidth, setOutlineWidth] = useState(3)
  const [saved, setSaved] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Seed state from the job's overlay_settings once on mount.
  useEffect(() => {
    if (!draftId) return
    import('../../api').then(({ getJob }) => {
      getJob(draftId).then(job => {
        const o = job?.overlay_settings || {}
        if (o.openingText) setOpeningText(o.openingText)
        if (o.middleText) setMiddleText(o.middleText)
        if (o.closingText) setClosingText(o.closingText)
        if (o.openingDuration) setOpeningDuration(o.openingDuration)
        if (o.middleStartTime != null) setMiddleStartTime(o.middleStartTime)
        if (o.middleDuration) setMiddleDuration(o.middleDuration)
        if (o.closingDuration) setClosingDuration(o.closingDuration)
        if (o.storyFontSize) setFontSize(o.storyFontSize)
        if (o.storyFontFamily) setFontFamily(o.storyFontFamily)
        if (o.storyFontColor) setFontColor(o.storyFontColor)
        if (o.storyFontOutline != null) setFontOutline(o.storyFontOutline)
        if (o.storyFontOutlineWidth) setOutlineWidth(o.storyFontOutlineWidth)
        setLoaded(true)
      }).catch(() => setLoaded(true))
    })
  }, [draftId])

  // Debounced save on any change — same pattern as legacy app.
  useEffect(() => {
    if (!loaded) return
    const payload = {
      openingText, middleText, closingText,
      openingDuration, middleStartTime, middleDuration, closingDuration,
      storyFontSize: Number(fontSize) || 48,
      storyFontFamily: fontFamily,
      storyFontColor: fontColor,
      storyFontOutline: fontOutline,
      storyFontOutlineWidth: Number(outlineWidth) || 3,
    }
    jobSync.saveOverlaySettings?.(payload)
    setSaved(true)
    const t = setTimeout(() => setSaved(false), 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openingText, middleText, closingText, openingDuration, middleStartTime, middleDuration, closingDuration, fontSize, fontFamily, fontColor, fontOutline, outlineWidth, loaded])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">On-screen captions</div>
        {saved && <span className="text-[9px] text-[#2D9A5E]">✓ Saved</span>}
      </div>

      <div className="space-y-2">
        <div>
          <label className="text-[10px] text-muted">Opening (first 0-2s)</label>
          <textarea
            value={openingText}
            onChange={e => setOpeningText(e.target.value)}
            placeholder="POV: your birthday just got a signature scent"
            rows={2}
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white resize-none"
          />
          <div className="flex items-center gap-2 mt-1 text-[9px] text-muted">
            <label>Duration:</label>
            <input
              type="text"
              inputMode="decimal"
              value={openingDuration}
              onChange={e => setOpeningDuration(Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
              className="w-12 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
            />
            <span>s</span>
          </div>
        </div>

        <div>
          <label className="text-[10px] text-muted">Middle (optional)</label>
          <textarea
            value={middleText}
            onChange={e => setMiddleText(e.target.value)}
            placeholder="You made it together"
            rows={2}
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white resize-none"
          />
          <div className="flex items-center gap-2 mt-1 text-[9px] text-muted">
            <label>Start at:</label>
            <input
              type="text"
              inputMode="decimal"
              value={middleStartTime}
              onChange={e => setMiddleStartTime(Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
              className="w-12 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
            />
            <span>s · </span>
            <label>Duration:</label>
            <input
              type="text"
              inputMode="decimal"
              value={middleDuration}
              onChange={e => setMiddleDuration(Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
              className="w-12 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
            />
            <span>s</span>
          </div>
        </div>

        <div>
          <label className="text-[10px] text-muted">Closing (last 1-2s)</label>
          <textarea
            value={closingText}
            onChange={e => setClosingText(e.target.value)}
            placeholder="Only at Poppy & Thyme"
            rows={2}
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white resize-none"
          />
          <div className="flex items-center gap-2 mt-1 text-[9px] text-muted">
            <label>Duration:</label>
            <input
              type="text"
              inputMode="decimal"
              value={closingDuration}
              onChange={e => setClosingDuration(Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
              className="w-12 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
            />
            <span>s</span>
          </div>
        </div>
      </div>

      <div className="border-t border-[#e5e5e5] pt-2 space-y-2">
        <div className="text-[11px] font-medium">Style</div>
        <div className="flex items-center gap-2 text-[10px] flex-wrap">
          <label>Font:</label>
          <select
            value={fontFamily}
            onChange={e => setFontFamily(e.target.value)}
            className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
          >
            <option value="sans-serif">Sans</option>
            <option value="serif">Serif</option>
            <option value="Permanent Marker">Permanent Marker</option>
            <option value="Bangers">Bangers</option>
          </select>
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
      </div>

      <div className="text-[9px] text-muted italic pt-1 border-t border-[#e5e5e5]">
        Live overlay preview on the video above, AI-suggested captions, and per-channel overrides port in a later sub-phase.
      </div>
    </div>
  )
}
