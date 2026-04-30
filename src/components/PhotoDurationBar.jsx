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

// Per-photo base magnification (1.0 = natural object-contain fit
// inside the 9:16 frame; >1.0 magnifies the photo BEFORE Ken Burns
// motion applies; <1.0 shrinks the photo, leaving black letterbox
// bars around it). Range 0.5–5.0 in 0.1 steps.
//
// Why this exists: zoom-in's natural 1.0→1.18 ramp can't cover the
// letterbox gap on a landscape photo inside a portrait frame. This
// slider lets the user dial up the starting size so the photo
// fills the frame, then motion runs on top of that base. Values
// below 1.0 do the opposite — purposeful letterboxing for stylized
// shots or aspect-ratio-correct displays.
export function PhotoZoomControl({ item, onInvalidateMerge, onSaveMotion }) {
  const initial = Number(item._photoZoom) > 0 ? Number(item._photoZoom) : 1.0
  const [value, setValue] = useState(initial)
  useEffect(() => {
    const next = Number(item._photoZoom) > 0 ? Number(item._photoZoom) : 1.0
    if (Math.abs(next - value) > 0.001) setValue(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item._photoZoom])

  const commit = (v) => {
    const clamped = Math.max(0.5, Math.min(5, Number(v) || 1))
    setValue(clamped)
    item._photoZoom = clamped
    onInvalidateMerge?.()
    // Reuses the photo-motion save path on the BE side — same row,
    // same PUT shape — so we don't need a separate endpoint.
    onSaveMotion?.(item)
  }

  return (
    <label
      className="flex items-center gap-2 bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded px-2 py-1"
      title="Base magnification before Ken Burns motion. 1.0 = natural fit; >1.0 fills the frame; <1.0 letterboxes. Use 0.5–1.0 to intentionally show black bars around a non-9:16 photo, or 1.0–5.0 to magnify into the frame."
    >
      <span className="text-[10px] text-[#6C5CE7] font-medium whitespace-nowrap">Zoom</span>
      <input
        type="range"
        min={0.5}
        max={5}
        step={0.1}
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
        max={5}
        step={0.1}
        value={value}
        onChange={e => setValue(Number(e.target.value) || 1)}
        onBlur={e => commit(e.target.value)}
        className="text-[11px] font-semibold text-[#6C5CE7] border border-[#6C5CE7]/30 rounded bg-white w-12 text-right px-1 py-0.5"
      />
      <span className="text-[10px] text-[#6C5CE7] font-medium">×</span>
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
    </div>
  )
}
