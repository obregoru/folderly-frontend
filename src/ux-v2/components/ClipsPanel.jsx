import { useState, useRef } from 'react'
import { sampleClips } from '../mockData'

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

// Generate a random picsum thumbnail for newly uploaded mock clips.
const randThumb = () => `https://picsum.photos/seed/${Math.random().toString(36).slice(2, 8)}/80/140`

/**
 * Clips panel — upload / reorder / trim / speed / merge. Once merged,
 * collapses to a compact summary. Reexpand with a tap.
 */
export default function ClipsPanel({ hasMerge, onMerge, onUnmerge }) {
  const [clips, setClips] = useState(sampleClips)
  const [collapsed, setCollapsed] = useState(hasMerge)
  const [dragIdx, setDragIdx] = useState(null)
  const fileInputRef = useRef(null)

  // Mock upload — reads the actual File's name/size so you see real
  // metadata, generates a fake duration + random thumbnail so the clip
  // card looks populated. No upload happens; no backend hit.
  const handleFiles = (fileList) => {
    const picked = Array.from(fileList || [])
    if (picked.length === 0) return
    const newClips = picked.map((f, i) => ({
      id: `c-${Date.now()}-${i}`,
      name: f.name,
      size: `${(f.size / (1024 * 1024)).toFixed(1)} MB`,
      duration: 5 + Math.random() * 8,
      trimStart: 0,
      trimEnd: null,
      speed: 1.0,
      thumb: randThumb(),
    }))
    setClips(prev => [...prev, ...newClips])
  }

  const total = clips.reduce((sum, c) => {
    const trimLen = Math.max(0, (c.trimEnd ?? c.duration) - (c.trimStart ?? 0))
    return sum + trimLen / c.speed
  }, 0)

  const updateClip = (id, patch) => setClips(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  const removeClip = (id) => setClips(prev => prev.filter(c => c.id !== id))

  const move = (fromIdx, toIdx) => {
    setClips(prev => {
      const next = [...prev]
      const [removed] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, removed)
      return next
    })
  }

  if (hasMerge && collapsed) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] font-medium">{clips.length} clips merged</div>
            <div className="text-[10px] text-muted">Total length ~{total.toFixed(1)}s</div>
          </div>
          <button
            onClick={() => setCollapsed(false)}
            className="text-[10px] py-1 px-2 border border-[#6C5CE7] text-[#6C5CE7] rounded bg-white cursor-pointer"
          >Edit clips ▼</button>
        </div>
        <button
          onClick={() => { onUnmerge(); setCollapsed(false) }}
          className="text-[10px] text-[#c0392b] underline bg-transparent border-none cursor-pointer p-0"
        >Discard merge</button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">Clips ({clips.length})</div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,image/*"
          multiple
          onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-[10px] py-1 px-2.5 border border-[#6C5CE7] text-[#6C5CE7] rounded bg-white cursor-pointer"
        >+ Upload</button>
        {hasMerge && (
          <button
            onClick={() => setCollapsed(true)}
            className="text-[10px] text-muted bg-transparent border-none cursor-pointer"
          >▲ Hide</button>
        )}
      </div>

      <div className="space-y-1.5">
        {clips.map((c, i) => {
          const trimLen = Math.max(0, (c.trimEnd ?? c.duration) - (c.trimStart ?? 0))
          const outLen = trimLen / c.speed
          return (
            <div
              key={c.id}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={e => { e.preventDefault() }}
              onDrop={() => { if (dragIdx != null && dragIdx !== i) move(dragIdx, i); setDragIdx(null) }}
              className={`flex items-center gap-2 bg-[#f8f7f3] border border-[#e5e5e5] rounded px-2 py-1.5 ${dragIdx === i ? 'opacity-50' : ''}`}
            >
              <span className="text-muted cursor-grab text-[14px] leading-none select-none px-0.5" title="Drag to reorder">⋮⋮</span>
              <span className="text-muted text-[10px] w-4">{i + 1}.</span>
              {c.thumb ? (
                <img src={c.thumb} alt="" className="w-8 h-11 rounded object-cover flex-shrink-0" />
              ) : (
                <div className="w-8 h-11 bg-[#e5e5e5] rounded flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[11px] truncate font-medium">{c.name}</div>
                <div className="text-[9px] text-muted">
                  {c.size} · {c.speed !== 1 ? (
                    <>{trimLen.toFixed(1)}s → <b className="text-ink">{outLen.toFixed(1)}s</b></>
                  ) : <>{trimLen.toFixed(1)}s</>}
                </div>
              </div>
              <select
                value={String(c.speed)}
                onChange={e => updateClip(c.id, { speed: Number(e.target.value) })}
                className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
              >
                {SPEED_OPTIONS.map(s => <option key={s} value={s}>{s}×</option>)}
              </select>
              <button
                onClick={() => removeClip(c.id)}
                className="text-[9px] text-[#c0392b] bg-transparent border-none cursor-pointer px-1"
                title="Remove"
              >✕</button>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2 text-[10px]">
        <label className="text-muted">Transition:</label>
        <select className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white">
          <option>Hard cut</option>
          <option>Crossfade</option>
          <option>Fade to black</option>
        </select>
        <span className="text-muted ml-auto">Total ~{total.toFixed(1)}s</span>
      </div>

      <button
        onClick={() => { onMerge(); setCollapsed(true) }}
        disabled={clips.length === 0}
        className="w-full py-2 bg-[#2D9A5E] text-white text-[12px] font-medium border-none rounded cursor-pointer disabled:opacity-50"
      >{hasMerge ? 'Re-merge' : 'Merge clips →'}</button>
    </div>
  )
}
