import { useState } from 'react'

/**
 * Voiceover panel. No duplicate video player — attaches to the final
 * video above. Tabs: Record / AI (TTS) / Paste script. Advanced tools
 * (export, review, suggest-from-video, bundle) live behind a disclosure.
 */
export default function VoiceoverPanel({ hasMerge }) {
  const [mode, setMode] = useState('ai') // 'record' | 'ai' | 'paste'
  const [text, setText] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  if (!hasMerge) {
    return (
      <div className="text-[11px] text-muted italic text-center py-4">
        Merge your clips first. Voiceover attaches to the final video above.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-medium">Voiceover</div>

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
        <div className="space-y-2">
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
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Type what the voiceover should say…"
            rows={4}
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y min-h-[80px]"
          />
          <button className="w-full py-2 bg-[#6C5CE7] text-white text-[11px] font-medium border-none rounded cursor-pointer">
            Generate voice
          </button>
        </div>
      )}

      {mode === 'record' && (
        <div className="space-y-2 text-center py-4">
          <div className="text-[36px]">🎤</div>
          <div className="text-[11px] text-muted">Tap to start recording. The video above plays muted while you narrate.</div>
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

      {/* Advanced tools — collapsed by default. Keeps the power features
          around (export, review, suggest, bundle) without cluttering the
          primary flow. */}
      <button
        onClick={() => setShowAdvanced(s => !s)}
        className="text-[10px] text-muted bg-transparent border-none cursor-pointer p-0"
      >
        {showAdvanced ? '▲' : '▼'} More tools (export, review, suggest from video, bundle for chat)
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
