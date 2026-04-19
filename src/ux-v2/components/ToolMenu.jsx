const ALL_TOOLS = [
  { key: 'clips',     icon: '🎬', label: 'Media',    forModes: ['photo-post', 'video'] },
  { key: 'hints',     icon: '🎯', label: 'Hints',    forModes: ['photo-post', 'video'] },
  { key: 'voiceover', icon: '🎤', label: 'Voice',    forModes: ['video'] },
  { key: 'overlays',  icon: '📝', label: 'Overlays', forModes: ['video'] },
  { key: 'captions',  icon: '💬', label: 'Post text',forModes: ['photo-post', 'video'] },
  { key: 'channels',  icon: '📤', label: 'Channels', forModes: ['photo-post', 'video'] },
]

/**
 * Icon menu below the final preview. Filters tools based on output type
 * (photo-post vs video) so irrelevant tools don't clutter the menu.
 *
 * Before final exists: upstream tools (Media, Hints) are navigable;
 * downstream tools (Voice/Overlays/Post text/Channels) are dimmed.
 */
export default function ToolMenu({ active, onChange, hasFinal, outputType = 'video' }) {
  const tools = ALL_TOOLS.filter(t => t.forModes.includes(outputType))

  return (
    <div className="bg-white border border-[#e5e5e5] rounded-lg p-1 flex items-center gap-1 overflow-x-auto">
      {tools.map(t => {
        const isActive = t.key === active
        // Media + Hints are meaningful before final; Voice/Overlays/Post
        // text/Channels need the final to exist.
        const needsFinal = !['clips', 'hints'].includes(t.key)
        const dimmed = needsFinal && !hasFinal
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
