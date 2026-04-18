import { useState } from 'react'

/**
 * Overlay text panel. Attaches to the final video above — no separate
 * preview. Opening / middle / closing with font + timing controls.
 */
export default function OverlaysPanel({ hasMerge }) {
  const [opening, setOpening] = useState('')
  const [middle, setMiddle] = useState('')
  const [closing, setClosing] = useState('')
  const [fontSize, setFontSize] = useState(48)
  const [outline, setOutline] = useState(true)

  if (!hasMerge) {
    return (
      <div className="text-[11px] text-muted italic text-center py-4">
        Merge your clips first. Overlays burn into the final video above.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-medium">On-screen captions</div>

      <div className="space-y-2">
        <div>
          <label className="text-[10px] text-muted">Opening (first 0-2s)</label>
          <textarea
            value={opening}
            onChange={e => setOpening(e.target.value)}
            placeholder="POV: your birthday just got a signature scent"
            rows={2}
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white resize-none"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted">Middle (optional)</label>
          <div className="flex gap-2">
            <textarea
              value={middle}
              onChange={e => setMiddle(e.target.value)}
              placeholder="You made it together"
              rows={2}
              className="flex-1 text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white resize-none"
            />
            <input
              type="text"
              inputMode="decimal"
              placeholder="@ 4s"
              className="w-14 text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white"
            />
          </div>
        </div>
        <div>
          <label className="text-[10px] text-muted">Closing (last 1-2s)</label>
          <textarea
            value={closing}
            onChange={e => setClosing(e.target.value)}
            placeholder="Only at Poppy & Thyme"
            rows={2}
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white resize-none"
          />
        </div>
      </div>

      <div className="border-t border-[#e5e5e5] pt-2 space-y-2">
        <div className="text-[11px] font-medium">Style</div>
        <div className="flex items-center gap-2 text-[10px] flex-wrap">
          <label>Font:</label>
          <select className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white">
            <option>Bold sans</option>
            <option>Serif</option>
            <option>Permanent Marker</option>
            <option>Bangers</option>
          </select>
          <label>Size:</label>
          <input
            type="text"
            inputMode="numeric"
            value={fontSize}
            onChange={e => setFontSize(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)}
            className="w-12 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
          />
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={outline} onChange={e => setOutline(e.target.checked)} />
            Outline
          </label>
        </div>
      </div>

      <button className="w-full py-1.5 bg-white border border-[#6C5CE7] text-[#6C5CE7] text-[11px] font-medium rounded cursor-pointer">
        🎬 Suggest scroll-stopper captions from video
      </button>
    </div>
  )
}
