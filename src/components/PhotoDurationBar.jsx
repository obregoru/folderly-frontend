import { useEffect, useState } from 'react'

/**
 * Shared photo controls for video-merge contexts:
 *   - Duration slider (aka "trim" for a still) — 0.5–15s, default 5s
 *   - Ken Burns motion picker (zoom / pan / pan+zoom / static)
 *
 * Used under each photo tile in FileGrid AND next to each photo row in
 * VideoMerge's clip list so the control is wherever the user is
 * thinking about that photo.
 *
 * Writes through item._trimEnd (duration) and item._photoMotion
 * (motion), then calls onSaveTrim / onSaveMotion so the backend
 * persists the choice.
 */

const MOTION_OPTIONS = [
  { v: 'zoom-in',          label: '🔍 Zoom in' },
  { v: 'zoom-out',         label: '🔍 Zoom out' },
  { v: 'pan-lr',           label: '← → Pan L→R' },
  { v: 'pan-rl',           label: '← → Pan R→L' },
  { v: 'pan-lr-zoom-in',   label: '← → Pan + zoom in (L→R)' },
  { v: 'pan-lr-zoom-out',  label: '← → Pan + zoom out (L→R)' },
  { v: 'pan-rl-zoom-in',   label: '← → Pan + zoom in (R→L)' },
  { v: 'pan-rl-zoom-out',  label: '← → Pan + zoom out (R→L)' },
  { v: 'static',           label: '⏸ Still (no motion)' },
]

export function PhotoDurationControl({ item, onInvalidateMerge, onSaveTrim }) {
  const initial = Number(item._trimEnd) > 0 ? Number(item._trimEnd) : 5
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const next = Number(item._trimEnd) > 0 ? Number(item._trimEnd) : 5
    if (Math.abs(next - value) > 0.01) setValue(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item._trimEnd])

  const commit = (v) => {
    const clamped = Math.max(0.5, Math.min(15, Number(v) || 5))
    setValue(clamped)
    item._trimEnd = clamped
    onInvalidateMerge?.()
    onSaveTrim?.(item)
  }

  return (
    <label
      className="flex items-center gap-2 bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded px-2 py-1"
      title="How long the photo stays on screen in the merged video. 0.5–15s."
    >
      <span className="text-[10px] text-[#6C5CE7] font-medium whitespace-nowrap">Show for</span>
      <input
        type="range"
        min={0.5}
        max={15}
        step={0.5}
        value={value}
        onChange={e => setValue(Number(e.target.value))}
        onMouseUp={e => commit(e.target.value)}
        onTouchEnd={e => commit(e.target.value)}
        onKeyUp={e => commit(e.target.value)}
        className="flex-1 min-w-0 accent-[#6C5CE7]"
      />
      <input
        type="number"
        min={0.5}
        max={15}
        step={0.5}
        value={value}
        onChange={e => setValue(Number(e.target.value) || 0)}
        onBlur={e => commit(e.target.value)}
        className="text-[11px] font-semibold text-[#6C5CE7] border border-[#6C5CE7]/30 rounded bg-white w-12 text-right px-1 py-0.5"
      />
      <span className="text-[10px] text-[#6C5CE7] font-medium">s</span>
    </label>
  )
}

// Per-photo base magnification, displayed as an OFFSET centered at
// 0. The slider visually treats 0 as "natural fit", positive values
// as magnification, negative as letterbox. Internally we still
// store a multiplier (1.0 = natural) for back-compat with the
// existing column + render code; the UI translation is just
// stored = displayed + 1.
//
// Visible range: -0.5 to +4 → stored 0.5× to 5×. Negative values
// letterbox in preview/thumbnail; export currently degrades them
// to 1× (see photoToVideo comment for the follow-up).
export function PhotoZoomControl({ item, onInvalidateMerge, onSaveMotion }) {
  const storedMult = (m) => Math.max(0.5, Math.min(5, Number(m) > 0 ? Number(m) : 1.0))
  // displayed = stored - 1 so 0 sits dead-center on the slider.
  const initial = storedMult(item._photoZoom) - 1
  const [display, setDisplay] = useState(initial)
  useEffect(() => {
    const next = storedMult(item._photoZoom) - 1
    if (Math.abs(next - display) > 0.001) setDisplay(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item._photoZoom])

  const commit = (v) => {
    const d = Number(v)
    const clampedDisplay = Math.max(-0.5, Math.min(4, Number.isFinite(d) ? d : 0))
    setDisplay(clampedDisplay)
    item._photoZoom = clampedDisplay + 1 // back to multiplier for storage
    onInvalidateMerge?.()
    onSaveMotion?.(item)
  }

  return (
    <label
      className="flex items-center gap-2 bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded px-2 py-1"
      title="Base zoom centered at 0. Positive = magnify into the frame; negative = letterbox the photo with black bars. Step 0.1."
    >
      <span className="text-[10px] text-[#6C5CE7] font-medium whitespace-nowrap">Zoom</span>
      <input
        type="range"
        min={-0.5}
        max={4}
        step={0.1}
        value={display}
        onChange={e => setDisplay(Number(e.target.value))}
        onMouseUp={e => commit(e.target.value)}
        onTouchEnd={e => commit(e.target.value)}
        onKeyUp={e => commit(e.target.value)}
        className="flex-1 min-w-0 accent-[#6C5CE7]"
      />
      <input
        type="number"
        min={-0.5}
        max={4}
        step={0.1}
        value={display}
        onChange={e => setDisplay(Number(e.target.value) || 0)}
        onBlur={e => commit(e.target.value)}
        className="text-[11px] font-semibold text-[#6C5CE7] border border-[#6C5CE7]/30 rounded bg-white w-14 text-right px-1 py-0.5"
      />
    </label>
  )
}

// Per-photo rotation in degrees, centered at 0. Negative = rotate
// counterclockwise, positive = rotate clockwise. Range -180 to +180.
// Saved through the same photo-motion path as zoom/duration/motion;
// the BE photoToVideo pipeline applies the rotation via sharp before
// the canvas resize so the rotated bounding box is what gets fit
// into the 9:16 frame.
export function PhotoRotateControl({ item, onInvalidateMerge, onSaveMotion }) {
  const initial = Number.isFinite(Number(item._photoRotate)) ? Number(item._photoRotate) : 0
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const next = Number.isFinite(Number(item._photoRotate)) ? Number(item._photoRotate) : 0
    if (Math.abs(next - value) > 0.5) setValue(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item._photoRotate])

  const commit = (v) => {
    const n = Number(v)
    const clamped = Math.max(-180, Math.min(180, Number.isFinite(n) ? n : 0))
    setValue(clamped)
    item._photoRotate = clamped
    onInvalidateMerge?.()
    onSaveMotion?.(item)
  }

  return (
    <label
      className="flex items-center gap-2 bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded px-2 py-1"
      title="Rotate the photo. 0 = no rotation; positive = clockwise; negative = counterclockwise. Range -180° to +180°."
    >
      <span className="text-[10px] text-[#6C5CE7] font-medium whitespace-nowrap">Rotate</span>
      <input
        type="range"
        min={-180}
        max={180}
        step={1}
        value={value}
        onChange={e => setValue(Number(e.target.value))}
        onMouseUp={e => commit(e.target.value)}
        onTouchEnd={e => commit(e.target.value)}
        onKeyUp={e => commit(e.target.value)}
        className="flex-1 min-w-0 accent-[#6C5CE7]"
      />
      <input
        type="number"
        min={-180}
        max={180}
        step={1}
        value={value}
        onChange={e => setValue(Number(e.target.value) || 0)}
        onBlur={e => commit(e.target.value)}
        className="text-[11px] font-semibold text-[#6C5CE7] border border-[#6C5CE7]/30 rounded bg-white w-14 text-right px-1 py-0.5"
      />
      <span className="text-[10px] text-[#6C5CE7] font-medium">°</span>
    </label>
  )
}

export function PhotoMotionControl({ item, onInvalidateMerge, onSaveMotion }) {
  const current = item._photoMotion || 'zoom-in'
  return (
    <label
      className="flex items-center gap-2 bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded px-2 py-1"
      title="Ken Burns effect during this photo's time on screen."
    >
      <span className="text-[10px] text-[#6C5CE7] font-medium whitespace-nowrap">Motion</span>
      <select
        value={current}
        onChange={e => {
          const next = e.target.value
          item._photoMotion = next
          onInvalidateMerge?.()
          onSaveMotion?.(item)
        }}
        className="flex-1 min-w-0 text-[11px] font-semibold text-[#6C5CE7] border border-[#6C5CE7]/30 rounded bg-white px-1 py-0.5"
      >
        {MOTION_OPTIONS.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
      </select>
    </label>
  )
}

/**
 * Stacked combo: duration slider above, motion picker below. Drop this
 * under a photo tile or next to a photo row.
 */
export default function PhotoDurationBar({ item, onInvalidateMerge, onSaveTrim, onSaveMotion }) {
  return (
    <div className="space-y-1 mt-1 px-1.5">
      <PhotoDurationControl item={item} onInvalidateMerge={onInvalidateMerge} onSaveTrim={onSaveTrim} />
      <PhotoMotionControl   item={item} onInvalidateMerge={onInvalidateMerge} onSaveMotion={onSaveMotion} />
      <PhotoZoomControl     item={item} onInvalidateMerge={onInvalidateMerge} onSaveMotion={onSaveMotion} />
      <PhotoRotateControl   item={item} onInvalidateMerge={onInvalidateMerge} onSaveMotion={onSaveMotion} />
    </div>
  )
}
