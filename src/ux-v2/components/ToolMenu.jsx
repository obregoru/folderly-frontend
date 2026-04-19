const TOOLS = [
  { key: 'clips',     icon: '🎬', label: 'Clips' },
  { key: 'hints',     icon: '🎯', label: 'Hints' },
  { key: 'voiceover', icon: '🎤', label: 'Voice' },
  { key: 'overlays',  icon: '📝', label: 'Overlays' },
  { key: 'captions',  icon: '💬', label: 'Post text' },
  { key: 'channels',  icon: '📤', label: 'Channels' },
]

/**
 * Icon menu below the final video. Every tool attaches to the same video
 * above — no more duplicate video players per tool.
 */
export default function ToolMenu({ active, onChange, hasMerge }) {
  return (
    <div className="bg-white border border-[#e5e5e5] rounded-lg p-1 flex items-center gap-1 overflow-x-auto">
      {TOOLS.map(t => {
        const isActive = t.key === active
        // Clips + Hints are meaningful before merge exists (Hints accepts
        // description + filename references even without frames). Voiceover,
        // overlays, captions, channels all attach to the merged video.
        const needsMerge = !['clips', 'hints'].includes(t.key)
        const dimmed = needsMerge && !hasMerge
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`flex-1 min-w-0 flex flex-col items-center py-1.5 px-2 rounded-md border-none cursor-pointer ${isActive ? 'bg-[#6C5CE7] text-white' : 'bg-transparent text-ink'} ${dimmed ? 'opacity-50' : ''}`}
          >
            <span className="text-[18px] leading-none">{t.icon}</span>
            <span className="text-[10px] mt-0.5 font-medium">{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}
