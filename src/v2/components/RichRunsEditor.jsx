// Per-word / per-phrase styling for overlay text. Editor renders the
// overlay as a vertical list of "runs" — each one a small row with
// a text input plus inline color, font, size, bold/italic, and an
// optional newlineAfter break. The list-of-rows shape sidesteps the
// well-known contenteditable cursor/paste/undo nightmare while still
// letting the user style every word independently.
//
// Storage shape (one entry per styled span):
//   { text: string,
//     color?: string,            // hex, e.g. '#ffffff'
//     fontFamily?: string,       // Google Fonts family name
//     fontSize?: number,         // 1080-reference px
//     bold?: boolean,
//     italic?: boolean,
//     newlineAfter?: boolean }   // true = render a line break after this run
//
// The outer overlay's color / font / size act as defaults — any run
// field left undefined inherits from the overlay-level value, so a
// flat "all white, all Inter, all 60px" overlay needs zero per-run
// fields. Only style differences are persisted.
//
// Usage:
//   <RichRunsEditor
//     runs={runs}                 // array | null (null = no rich runs)
//     onChange={setRuns}          // setter, receives array | null
//     defaults={{ color, fontFamily, fontSize }}
//   />

import { useState, lazy, Suspense } from 'react'

// Lazy-load the font picker so the heavy font catalog isn't pulled
// until a user actually opens it on a run.
const FontPicker = lazy(() => import('../../components/fonts/FontPicker'))

const DEFAULT_DEFAULTS = { color: '#ffffff', fontFamily: 'Inter', fontSize: 60 }

export default function RichRunsEditor({ runs, onChange, defaults = DEFAULT_DEFAULTS }) {
  // Track which run is currently expanded for fine-grained controls
  // (font picker takes too much vertical space to leave open per row).
  const [openIdx, setOpenIdx] = useState(null)

  const list = Array.isArray(runs) ? runs : []
  const enabled = list.length > 0

  const update = (idx, patch) => {
    const next = list.map((r, i) => i === idx ? { ...r, ...patch } : r)
    onChange(next)
  }

  const addRun = () => {
    onChange([...list, { text: '', newlineAfter: false }])
    setOpenIdx(list.length)
  }

  const removeRun = (idx) => {
    const next = list.filter((_, i) => i !== idx)
    onChange(next.length > 0 ? next : null)
    setOpenIdx(null)
  }

  const move = (idx, delta) => {
    const newIdx = idx + delta
    if (newIdx < 0 || newIdx >= list.length) return
    const next = list.slice()
    const [moved] = next.splice(idx, 1)
    next.splice(newIdx, 0, moved)
    onChange(next)
    setOpenIdx(newIdx)
  }

  // First-time enable: seed with one empty run so the user has
  // something to type into immediately.
  const enable = () => onChange([{ text: '', newlineAfter: false }])
  const disable = () => { onChange(null); setOpenIdx(null) }

  if (!enabled) {
    return (
      <button
        type="button"
        onClick={enable}
        className="text-[10px] py-0.5 px-2 mt-1 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer"
        title="Style each word or phrase individually — different colors, fonts, sizes per run."
      >✨ Style words individually</button>
    )
  }

  return (
    <div className="border border-[#6C5CE7]/30 bg-[#f3f0ff]/40 rounded p-2 mt-1 space-y-1.5">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="font-medium text-[#6C5CE7] flex-1">✨ Per-run styling</span>
        <button
          type="button"
          onClick={disable}
          className="text-[9px] text-muted border border-[#e5e5e5] rounded px-1.5 py-0.5 bg-white cursor-pointer"
          title="Drop the rich runs and revert to the plain text above."
        >Use plain text</button>
      </div>

      {list.map((run, idx) => (
        <RunRow
          key={idx}
          run={run}
          idx={idx}
          isOpen={openIdx === idx}
          onOpen={() => setOpenIdx(openIdx === idx ? null : idx)}
          onUpdate={(patch) => update(idx, patch)}
          onRemove={() => removeRun(idx)}
          onMove={(delta) => move(idx, delta)}
          canMoveUp={idx > 0}
          canMoveDown={idx < list.length - 1}
          defaults={defaults}
        />
      ))}

      <button
        type="button"
        onClick={addRun}
        className="w-full text-[10px] py-1 border border-dashed border-[#6C5CE7]/50 text-[#6C5CE7] bg-white rounded cursor-pointer"
      >+ Add run</button>
    </div>
  )
}

function RunRow({ run, idx, isOpen, onOpen, onUpdate, onRemove, onMove, canMoveUp, canMoveDown, defaults }) {
  const color = run.color ?? defaults.color
  const family = run.fontFamily ?? defaults.fontFamily
  const size = run.fontSize ?? defaults.fontSize

  return (
    <div className="border border-[#e5e5e5] bg-white rounded p-1.5 space-y-1">
      {/* Top row: text input + quick toggles + open/close + remove. */}
      <div className="flex items-center gap-1">
        <span className="text-[9px] font-mono text-muted w-5 text-center">{idx + 1}</span>
        <input
          type="text"
          value={run.text}
          onChange={e => onUpdate({ text: e.target.value })}
          placeholder="text"
          className="flex-1 text-[11px] border border-[#e5e5e5] rounded py-1 px-1.5 bg-white"
          style={{
            // Inline visual cue of the chosen style — color the text
            // input itself so the user sees what they'll get without
            // opening the live preview.
            color: color,
            fontFamily: family ? `'${family}', system-ui, sans-serif` : undefined,
            fontWeight: run.bold ? 700 : 400,
            fontStyle: run.italic ? 'italic' : 'normal',
            background: '#1f2937', // dark BG so light overlay colors show
          }}
        />
        <ToggleBtn label="B" active={!!run.bold} onClick={() => onUpdate({ bold: !run.bold })} title="Bold" weight={700} />
        <ToggleBtn label="I" active={!!run.italic} onClick={() => onUpdate({ italic: !run.italic })} title="Italic" italic />
        <ToggleBtn
          label="↵"
          active={!!run.newlineAfter}
          onClick={() => onUpdate({ newlineAfter: !run.newlineAfter })}
          title="Line break after this run"
        />
        <button
          type="button"
          onClick={onOpen}
          className="text-[10px] py-0.5 px-1.5 border border-[#e5e5e5] rounded bg-white cursor-pointer text-muted"
          title="Color, font, size"
        >{isOpen ? '▾' : '🎨'}</button>
        <button
          type="button"
          onClick={onRemove}
          className="text-[10px] py-0.5 px-1.5 border border-[#c0392b]/40 text-[#c0392b] rounded bg-white cursor-pointer"
          title="Remove this run"
        >✕</button>
      </div>

      {/* Expanded controls — color picker + font picker + size slider
          + reorder buttons. Only mounts when the row is open so the
          font picker chunk stays unloaded for unedited rows. */}
      {isOpen && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center gap-1.5 text-[10px]">
            <label className="text-muted w-12">Color</label>
            <input
              type="color"
              value={color}
              onChange={e => onUpdate({ color: e.target.value })}
              className="w-8 h-6 border border-[#e5e5e5] rounded cursor-pointer p-0"
            />
            <span className="font-mono text-[10px] text-muted">{color}</span>
            {run.color != null && (
              <button
                type="button"
                onClick={() => onUpdate({ color: undefined })}
                className="text-[9px] text-muted border border-[#e5e5e5] rounded px-1 py-0.5 bg-white cursor-pointer"
                title="Reset to overlay default"
              >reset</button>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[10px]">
            <label className="text-muted w-12">Size</label>
            <input
              type="range"
              min={20} max={180} step={2}
              value={size}
              onChange={e => onUpdate({ fontSize: Number(e.target.value) })}
              className="flex-1"
              title="Run font size in 1080-reference px"
            />
            <span className="font-mono text-[10px] text-muted w-10 text-right">{size}px</span>
            {run.fontSize != null && (
              <button
                type="button"
                onClick={() => onUpdate({ fontSize: undefined })}
                className="text-[9px] text-muted border border-[#e5e5e5] rounded px-1 py-0.5 bg-white cursor-pointer"
              >reset</button>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[10px]">
            <label className="text-muted w-12">Font</label>
            <span
              className="flex-1 truncate"
              style={{ fontFamily: family ? `'${family}', system-ui, sans-serif` : undefined }}
            >{family || '— overlay default —'}</span>
            {run.fontFamily != null && (
              <button
                type="button"
                onClick={() => onUpdate({ fontFamily: undefined })}
                className="text-[9px] text-muted border border-[#e5e5e5] rounded px-1 py-0.5 bg-white cursor-pointer"
              >reset</button>
            )}
          </div>
          <Suspense fallback={<div className="text-[9px] text-muted py-1">Loading fonts…</div>}>
            <FontPicker
              value={family}
              purpose="base"
              onChange={(f) => onUpdate({ fontFamily: f })}
            />
          </Suspense>

          <div className="flex items-center gap-1 pt-1 border-t border-[#e5e5e5]">
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={!canMoveUp}
              className="text-[10px] py-0.5 px-1.5 border border-[#e5e5e5] rounded bg-white cursor-pointer disabled:opacity-40"
              title="Move up"
            >↑</button>
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={!canMoveDown}
              className="text-[10px] py-0.5 px-1.5 border border-[#e5e5e5] rounded bg-white cursor-pointer disabled:opacity-40"
              title="Move down"
            >↓</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ToggleBtn({ label, active, onClick, title, weight, italic }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`text-[10px] w-6 h-6 border rounded cursor-pointer ${
        active
          ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]'
          : 'bg-white text-muted border-[#e5e5e5]'
      }`}
      style={{ fontWeight: weight, fontStyle: italic ? 'italic' : 'normal' }}
    >{label}</button>
  )
}

// Flatten a runs array into the legacy `text` field so any path that
// hasn't been upgraded to runs (server export, older preview code,
// etc.) still has SOMETHING readable. newlineAfter becomes \n.
// Empty list → empty string. Pure utility, no React state.
export function runsToFlatText(runs) {
  if (!Array.isArray(runs)) return ''
  let out = ''
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]
    out += String(r?.text ?? '')
    if (r?.newlineAfter && i < runs.length - 1) out += '\n'
  }
  return out
}
