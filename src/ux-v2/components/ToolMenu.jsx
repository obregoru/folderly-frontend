const TOOLS = [
  { key: 'clips',     icon: '🎬', label: 'Clips' },
  { key: 'voiceover', icon: '🎤', label: 'Voice' },
  { key: 'overlays',  icon: '📝', label: 'Overlays' },
  { key: 'captions',  icon: '💬', label: 'Captions' },
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
        // Voiceover/overlays/captions/channels are only meaningful after a merge
        // exists; dim them but still tappable (so the mockup is explorable).
        const needsMerge = t.key !== 'clips'
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
