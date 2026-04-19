// Primary flow: Media → Hints → Content → Channels.
// Voice + Overlays are optional tuning for video drafts; they live
// between Content and Channels so the user sees them after the core
// generate step but before scheduling.
const ALL_TOOLS = [
  { key: 'clips',     icon: '🎬', label: 'Media',    forModes: ['photo-post', 'video'] },
  { key: 'hints',     icon: '🎯', label: 'Hints',    forModes: ['photo-post', 'video'] },
  { key: 'captions',  icon: '✨', label: 'Content',  forModes: ['photo-post', 'video'], primary: true },
  { key: 'voiceover', icon: '🎤', label: 'Voice',    forModes: ['video'] },
  { key: 'overlays',  icon: '📝', label: 'Overlays', forModes: ['video'] },
  { key: 'channels',  icon: '📤', label: 'Channels', forModes: ['photo-post', 'video'] },
]

/**
 * Icon strip below the final preview. Filters tools to just what applies
 * to the current output type, dims tools that aren't useful until a merge
 * exists.
 */
export default function ToolMenuV2({ active, onChange, hasFinal, outputType = 'video' }) {
  const tools = ALL_TOOLS.filter(t => t.forModes.includes(outputType))

  return (
    <div className="bg-white border border-[#e5e5e5] rounded-lg p-1 flex items-center gap-1 overflow-x-auto">
      {tools.map(t => {
        const isActive = t.key === active
        // Content + Hints + Clips are always reachable. Voice / Overlays
        // wait on a video being ready. Channels waits on content generated.
        const needsFinal = ['voiceover', 'overlays'].includes(t.key)
        const dimmed = needsFinal && !hasFinal
        const isPrimaryStyle = t.primary && !isActive
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`flex-1 min-w-0 flex flex-col items-center py-1.5 px-2 rounded-md border-none cursor-pointer ${
              isActive ? 'bg-[#6C5CE7] text-white' : isPrimaryStyle ? 'bg-[#6C5CE7]/10 text-[#6C5CE7]' : 'bg-transparent text-ink'
            } ${dimmed ? 'opacity-50' : ''}`}
          >
            <span className="text-[18px] leading-none">{t.icon}</span>
            <span className="text-[10px] mt-0.5 font-medium">{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}
