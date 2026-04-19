import { useState, useRef } from 'react'

/**
 * Voiceover panel. Zero video elements — the player above is the only
 * surface, and these segments play in real time over it along with the
 * overlay captions.
 *
 * Segments list: timed, drag-reorderable, per-segment speed / regenerate
 * / preview. Mirrors the existing real-app segment model.
 */
export default function VoiceoverPanel({ hasMerge }) {
  const [mode, setMode] = useState('ai') // 'record' | 'ai' | 'paste'
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [mixMode, setMixMode] = useState('mix') // 'replace' | 'mix'
  const [origVolume, setOrigVolume] = useState(30)
  const [segments, setSegments] = useState([
    { id: 's-1', startTime: 0.0, text: "Everyone else bought theirs. You made yours.", speed: 1.0, ready: true, duration: 2.4 },
    { id: 's-2', startTime: 2.8, text: "You made it with your whole crew there.", speed: 1.0, ready: true, duration: 2.1 },
    { id: 's-3', startTime: 5.5, text: "Then months later—", speed: 1.0, ready: false, duration: 0 },
    { id: 's-4', startTime: 7.0, text: "you're still wearing it.", speed: 1.0, ready: false, duration: 0 },
    { id: 's-5', startTime: 9.5, text: "That's what sticks.", speed: 1.0, ready: false, duration: 0 },
  ])
  const [dragIdx, setDragIdx] = useState(null)

  if (!hasMerge) {
    return (
      <div className="text-[11px] text-muted italic text-center py-4">
        Merge your clips first. Voiceover attaches to the final video above.
      </div>
    )
  }

  const update = (id, patch) => setSegments(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  const remove = (id) => setSegments(prev => prev.filter(s => s.id !== id))
  const add = () => setSegments(prev => [
    ...prev,
    { id: `s-${Date.now()}`, startTime: (prev[prev.length - 1]?.startTime || 0) + 2, text: '', speed: 1.0, ready: false, duration: 0 },
  ])
  const move = (from, to) => {
    setSegments(prev => {
      const next = [...prev]
      const [removed] = next.splice(from, 1)
      next.splice(to, 0, removed)
      return next
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">Voiceover</div>
        <button
          onClick={() => alert('Mock: plays the merged video above with voiceover + overlays in real time')}
          className="text-[10px] py-1 px-2.5 bg-[#2D9A5E] text-white border-none rounded cursor-pointer"
        >▶ Play with video</button>
      </div>

      <div className="flex items-center gap-1 bg-[#f8f7f3] rounded-lg p-0.5">
        {[
          { key: 'ai', label: 'AI voice' },
          { key: 'record', label: 'Record' },
          { key: 'paste', label: 'Paste script' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setMode(t.key)}
            className={`flex-1 text-[10px] py-1.5 rounded-md border-none cursor-pointer ${mode === t.key ? 'bg-white text-ink shadow-sm font-medium' : 'bg-transparent text-muted'}`}
          >{t.label}</button>
        ))}
      </div>

      {mode === 'ai' && (
        <>
          {/* Global voice settings — apply to all segments */}
          <div className="flex items-center gap-2 text-[10px] flex-wrap">
            <label className="text-muted">Voice:</label>
            <select className="text-[10px] border border-[#e5e5e5] rounded py-1 px-1.5 bg-white flex-1">
              <option>Rachel (warm)</option>
              <option>Adam (deep)</option>
              <option>Bella (bright)</option>
            </select>
            <label className="text-muted">Length:</label>
            <select className="text-[10px] border border-[#e5e5e5] rounded py-1 px-1.5 bg-white">
              <option>Short</option>
              <option>Medium</option>
              <option>Long</option>
            </select>
          </div>

          {/* Timed segments — drag to reorder, per-segment controls */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium flex items-center gap-2">
              <span className="flex-1">Segments ({segments.length})</span>
              <button onClick={add} className="text-[10px] text-[#6C5CE7] bg-white border border-[#6C5CE7] rounded py-0.5 px-2 cursor-pointer">+ Add</button>
            </div>
            {segments.map((s, i) => (
              <div
                key={s.id}
                draggable
                onDragStart={() => setDragIdx(i)}
                onDragOver={e => { e.preventDefault() }}
                onDrop={() => { if (dragIdx != null && dragIdx !== i) move(dragIdx, i); setDragIdx(null) }}
                className={`bg-[#f8f7f3] border border-[#e5e5e5] rounded p-2 space-y-1.5 ${dragIdx === i ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-muted cursor-grab text-[13px] leading-none select-none" title="Drag to reorder">⋮⋮</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={s.startTime}
                    onChange={e => update(s.id, { startTime: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })}
                    className="w-12 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white font-mono"
                    title="Start time (seconds)"
                  />
                  <span className="text-[9px] text-muted">s</span>
                  {s.ready ? (
                    <span className="text-[9px] text-[#2D9A5E]">● ready ({s.duration.toFixed(1)}s)</span>
                  ) : (
                    <span className="text-[9px] text-muted italic">(not generated)</span>
                  )}
                  <button
                    onClick={() => remove(s.id)}
                    className="text-[9px] text-[#c0392b] bg-transparent border-none cursor-pointer ml-auto px-1"
                  >✕</button>
                </div>
                <input
                  type="text"
                  value={s.text}
                  onChange={e => update(s.id, { text: e.target.value })}
                  placeholder="Spoken line…"
                  className="w-full text-[11px] border border-[#e5e5e5] rounded py-1 px-1.5 bg-white"
                />
                <div className="flex items-center gap-1.5 text-[9px]">
                  {s.ready && (
                    <button className="text-[#6C5CE7] bg-white border border-[#e5e5e5] rounded py-0.5 px-1.5 cursor-pointer">▶ Play</button>
                  )}
                  <label className="text-muted">Speed:</label>
                  <select
                    value={String(s.speed)}
                    onChange={e => update(s.id, { speed: Number(e.target.value) })}
                    className="text-[9px] border border-[#e5e5e5] rounded py-0 px-1 bg-white"
                  >
                    {[0.7, 0.85, 1, 1.1, 1.2].map(v => <option key={v} value={v}>{v}×</option>)}
                  </select>
                  <button className="text-[#6C5CE7] bg-white border border-[#e5e5e5] rounded py-0.5 px-1.5 cursor-pointer ml-auto">↻ Regenerate</button>
                </div>
              </div>
            ))}
          </div>

          <button className="w-full py-2 bg-[#6C5CE7] text-white text-[11px] font-medium border-none rounded cursor-pointer">
            Generate all voices ({segments.length})
          </button>
        </>
      )}

      {mode === 'record' && (
        <div className="space-y-2 text-center py-4">
          <div className="text-[36px]">🎤</div>
          <div className="text-[11px] text-muted">The video above plays muted while you narrate. Tap to start.</div>
          <button className="py-2 px-6 bg-[#c0392b] text-white text-[11px] font-medium border-none rounded cursor-pointer">
            ● Start recording
          </button>
        </div>
      )}

      {mode === 'paste' && (
        <div className="space-y-2">
          <textarea
            placeholder="[0:00] Everyone else bought theirs. You made yours.&#10;[0:02] You made it with your whole crew there.&#10;[0:04] Months later—&#10;[0:06] you're still wearing it.&#10;[0:08] That's what sticks."
            rows={6}
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y min-h-[140px] font-mono"
          />
          <button className="w-full py-1.5 bg-white border border-[#6C5CE7] text-[#6C5CE7] text-[11px] font-medium rounded cursor-pointer">
            Apply pasted script
          </button>
        </div>
      )}

      {/* Mix settings — how voiceover blends with original video audio */}
      <div className="border-t border-[#e5e5e5] pt-2 space-y-1.5">
        <div className="text-[10px] font-medium">Mix with original audio</div>
        <div className="flex items-center gap-3 text-[10px]">
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" checked={mixMode === 'replace'} onChange={() => setMixMode('replace')} />
            Replace original
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" checked={mixMode === 'mix'} onChange={() => setMixMode('mix')} />
            Mix
          </label>
        </div>
        {mixMode === 'mix' && (
          <div className="flex items-center gap-2 text-[10px]">
            <label className="text-muted">Original volume</label>
            <input
              type="range"
              min={0} max={100}
              value={origVolume}
              onChange={e => setOrigVolume(Number(e.target.value))}
              className="flex-1"
            />
            <span className="w-8 text-right">{origVolume}%</span>
          </div>
        )}
      </div>

      {/* Advanced — power tools behind a disclosure */}
      <button
        onClick={() => setShowAdvanced(s => !s)}
        className="text-[10px] text-muted bg-transparent border-none cursor-pointer p-0"
      >
        {showAdvanced ? '▲' : '▼'} More tools (export, review, suggest, bundle)
      </button>
      {showAdvanced && (
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          <button className="text-[10px] py-1.5 border border-[#e5e5e5] rounded bg-white text-ink cursor-pointer">📋 Export script</button>
          <button className="text-[10px] py-1.5 border border-[#e5e5e5] rounded bg-white text-ink cursor-pointer">⚡ Review with AI</button>
          <button className="text-[10px] py-1.5 border border-[#6C5CE7] rounded bg-white text-[#6C5CE7] cursor-pointer">🎬 Suggest from video</button>
          <button className="text-[10px] py-1.5 border border-[#e5e5e5] rounded bg-white text-ink cursor-pointer">📦 Bundle for chat</button>
          <button className="text-[10px] py-1.5 border border-[#e5e5e5] rounded bg-white text-ink cursor-pointer col-span-2">Get ChatGPT prompt</button>
        </div>
      )}
    </div>
  )
}
