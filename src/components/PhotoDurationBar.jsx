import { useEffect, useState } from 'react'

// Round to 2 decimals so float arithmetic doesn't surface noise like
// 0.20000000000000007 in the slider's number input. Returns a Number,
// not a string, so the input's controlled value stays well-typed.
const round2 = (n) => {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.round(x * 100) / 100
}

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
        value={round2(value)}
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
        value={round2(value)}
        onChange={e => setValue(Number(e.target.value) || 0)}
        onBlur={e => commit(e.target.value)}
        className="text-[11px] font-semibold text-[#6C5CE7] border border-[#6C5CE7]/30 rounded bg-white w-12 text-right px-1 py-0.5"
      />
      <span className="text-[10px] text-[#6C5CE7] font-medium">s</span>
    </label>
  )
}

// Per-photo base magnification, displayed on a SYMMETRIC slider
// centered at 0 (matching the Rotate slider's UX). Range -2 to +2,
// 0.1 steps. Mapping is piecewise linear so the symmetric visual
// covers an asymmetric multiplier range — zoom-in feels much
// different in scale than zoom-out, so the slider's slope on each
// side is tuned to that perception:
//   display >= 0 → multiplier = 1 + display × 2  (0→1×, 2→5×)
//   display < 0  → multiplier = 1 + display × 0.25  (0→1×, -2→0.5×)
//
// Storage stays as a positive multiplier (existing photo_to_video_zoom
// column + downstream render code is unchanged); only the UI
// representation flips to 0-centered.
const zoomDisplayToMult = (d) => {
  if (!Number.isFinite(d)) return 1.0
  return d >= 0 ? 1 + d * 2 : 1 + d * 0.25
}
const zoomMultToDisplay = (m) => {
  const mult = Number(m) > 0 ? Number(m) : 1.0
  return mult >= 1 ? (mult - 1) / 2 : (mult - 1) / 0.25
}

export function PhotoZoomControl({ item, onInvalidateMerge, onSaveMotion }) {
  const initial = zoomMultToDisplay(item._photoZoom)
  const [display, setDisplay] = useState(initial)
  useEffect(() => {
    const next = zoomMultToDisplay(item._photoZoom)
    if (Math.abs(next - display) > 0.001) setDisplay(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item._photoZoom])

  const commit = (v) => {
    const d = Number(v)
    const clampedDisplay = Math.max(-2, Math.min(2, Number.isFinite(d) ? d : 0))
    setDisplay(clampedDisplay)
    // Convert symmetric display back to multiplier and clamp to the
    // server-side range. mult below 0.5 / above 5 gets pinned.
    const mult = Math.max(0.5, Math.min(5, zoomDisplayToMult(clampedDisplay)))
    item._photoZoom = mult
    onInvalidateMerge?.()
    onSaveMotion?.(item)
  }

  return (
    <label
      className="flex items-center gap-2 bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded px-2 py-1"
      title="Base zoom centered at 0. Positive = magnify into the frame (max 5×); negative = letterbox the photo with black bars (min 0.5×)."
    >
      <span className="text-[10px] text-[#6C5CE7] font-medium whitespace-nowrap">Zoom</span>
      <input
        type="range"
        min={-2}
        max={2}
        step={0.1}
        value={round2(display)}
        onChange={e => setDisplay(Number(e.target.value))}
        onMouseUp={e => commit(e.target.value)}
        onTouchEnd={e => commit(e.target.value)}
        onKeyUp={e => commit(e.target.value)}
        className="flex-1 min-w-0 accent-[#6C5CE7]"
      />
      <input
        type="number"
        min={-2}
        max={2}
        step={0.1}
        value={round2(display)}
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
        value={round2(value)}
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
        value={round2(value)}
        onChange={e => setValue(Number(e.target.value) || 0)}
        onBlur={e => commit(e.target.value)}
        className="text-[11px] font-semibold text-[#6C5CE7] border border-[#6C5CE7]/30 rounded bg-white w-14 text-right px-1 py-0.5"
      />
      <span className="text-[10px] text-[#6C5CE7] font-medium">°</span>
    </label>
  )
}

// Per-photo X/Y pan offsets, both -100 to +100 (percent of available
// pan range). 0 = centered (legacy behavior). Useful when zoom or
// rotate has shifted the focus of the image off-center — the user
// nudges the framed region back without re-zooming. Saved through
// the same photo-motion path as the other per-photo fields.
export function PhotoPanControl({ item, onInvalidateMerge, onSaveMotion }) {
  const initialX = Number.isFinite(Number(item._photoOffsetX)) ? Number(item._photoOffsetX) : 0
  const initialY = Number.isFinite(Number(item._photoOffsetY)) ? Number(item._photoOffsetY) : 0
  const [x, setX] = useState(initialX)
  const [y, setY] = useState(initialY)
  useEffect(() => {
    const next = Number.isFinite(Number(item._photoOffsetX)) ? Number(item._photoOffsetX) : 0
    if (Math.abs(next - x) > 0.5) setX(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item._photoOffsetX])
  useEffect(() => {
    const next = Number.isFinite(Number(item._photoOffsetY)) ? Number(item._photoOffsetY) : 0
    if (Math.abs(next - y) > 0.5) setY(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item._photoOffsetY])

  const commitX = (v) => {
    const n = Number(v)
    const clamped = Math.max(-100, Math.min(100, Number.isFinite(n) ? n : 0))
    setX(clamped)
    item._photoOffsetX = clamped
    onInvalidateMerge?.()
    onSaveMotion?.(item)
  }
  const commitY = (v) => {
    const n = Number(v)
    const clamped = Math.max(-100, Math.min(100, Number.isFinite(n) ? n : 0))
    setY(clamped)
    item._photoOffsetY = clamped
    onInvalidateMerge?.()
    onSaveMotion?.(item)
  }

  return (
    <div className="flex flex-col gap-1 bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded px-2 py-1">
      <label
        className="flex items-center gap-2"
        title="Move the framed region horizontally. -100 = pan left to canvas edge; +100 = pan right; 0 = centered."
      >
        <span className="text-[10px] text-[#6C5CE7] font-medium whitespace-nowrap w-12">Pan X</span>
        <input
          type="range" min={-100} max={100} step={1}
          value={round2(x)}
          onChange={e => setX(Number(e.target.value))}
          onMouseUp={e => commitX(e.target.value)}
          onTouchEnd={e => commitX(e.target.value)}
          onKeyUp={e => commitX(e.target.value)}
          className="flex-1 min-w-0 accent-[#6C5CE7]"
        />
        <input
          type="number" min={-100} max={100} step={1}
          value={round2(x)}
          onChange={e => setX(Number(e.target.value) || 0)}
          onBlur={e => commitX(e.target.value)}
          className="text-[11px] font-semibold text-[#6C5CE7] border border-[#6C5CE7]/30 rounded bg-white w-14 text-right px-1 py-0.5"
        />
        <span className="text-[10px] text-[#6C5CE7] font-medium">%</span>
      </label>
      <label
        className="flex items-center gap-2"
        title="Move the framed region vertically. -100 = pan up to canvas edge; +100 = pan down; 0 = centered."
      >
        <span className="text-[10px] text-[#6C5CE7] font-medium whitespace-nowrap w-12">Pan Y</span>
        <input
          type="range" min={-100} max={100} step={1}
          value={round2(y)}
          onChange={e => setY(Number(e.target.value))}
          onMouseUp={e => commitY(e.target.value)}
          onTouchEnd={e => commitY(e.target.value)}
          onKeyUp={e => commitY(e.target.value)}
          className="flex-1 min-w-0 accent-[#6C5CE7]"
        />
        <input
          type="number" min={-100} max={100} step={1}
          value={round2(y)}
          onChange={e => setY(Number(e.target.value) || 0)}
          onBlur={e => commitY(e.target.value)}
          className="text-[11px] font-semibold text-[#6C5CE7] border border-[#6C5CE7]/30 rounded bg-white w-14 text-right px-1 py-0.5"
        />
        <span className="text-[10px] text-[#6C5CE7] font-medium">%</span>
      </label>
    </div>
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

// One-click reset of zoom/rotate/pan to the natural-fit defaults.
// For 9:16 source photos this lands the image edge-to-edge inside
// the export frame; for landscape/square sources it centers the
// 9:16 crop without zoom or rotation. Doesn't touch motion or
// duration — those are creative choices, not framing fixes.
export function PhotoFitToFrameButton({ item, onInvalidateMerge, onSaveMotion }) {
  const isAlreadyFit =
    (Number(item._photoZoom) === 1.0 || item._photoZoom == null) &&
    !Number(item._photoRotate) &&
    !Number(item._photoOffsetX) &&
    !Number(item._photoOffsetY)
  const reset = () => {
    item._photoZoom = 1.0
    item._photoRotate = 0
    item._photoOffsetX = 0
    item._photoOffsetY = 0
    onInvalidateMerge?.()
    onSaveMotion?.(item)
  }
  return (
    <button
      type="button"
      onClick={reset}
      disabled={isAlreadyFit}
      className="text-[10px] py-1 px-2 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-50 disabled:cursor-default font-medium hover:bg-[#f3f0ff] self-start"
      title="Reset zoom/rotate/pan so the photo fits the export frame edge-to-edge. Doesn't change motion or duration."
    >⤢ Fit to frame</button>
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
      <PhotoPanControl      item={item} onInvalidateMerge={onInvalidateMerge} onSaveMotion={onSaveMotion} />
      <PhotoFitToFrameButton item={item} onInvalidateMerge={onInvalidateMerge} onSaveMotion={onSaveMotion} />
    </div>
  )
}
