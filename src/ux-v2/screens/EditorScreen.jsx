import { useState } from 'react'
import FinalVideoPreview from '../components/FinalVideoPreview'
import ToolMenu from '../components/ToolMenu'
import ClipsPanel from '../components/ClipsPanel'
import HintsPanel from '../components/HintsPanel'
import VoiceoverPanel from '../components/VoiceoverPanel'
import OverlaysPanel from '../components/OverlaysPanel'
import ChannelsPanel from '../components/ChannelsPanel'
import CaptionsPanel from '../components/CaptionsPanel'

/**
 * The primary v2 workflow. Final video is the center of gravity; every
 * tool (clips, voiceover, overlays, channels, captions) attaches to that
 * single asset rather than maintaining its own preview.
 */
export default function EditorScreen({ draftId }) {
  // Simulated merge status — toggling "Merge" in the clips panel flips this.
  const [hasMerge, setHasMerge] = useState(false)
  const [activeTool, setActiveTool] = useState('hints')

  // Before merge: setup tools (Clips + Hints) are navigable; downstream
  // tools (Voice/Overlays/Captions/Channels) are dimmed since they can't
  // do anything useful without the final video.
  if (!hasMerge) {
    // Pre-merge the default surface is Clips unless user tabs to Hints.
    const preMergeActive = activeTool === 'hints' ? 'hints' : 'clips'
    return (
      <div className="p-3 space-y-3">
        {/* Active setup panel on top — Clips (upload/sort/merge) or Hints
            (the creative brief). Both are meaningful before merge. */}
        <div className="bg-white border border-[#e5e5e5] rounded-lg p-3">
          {preMergeActive === 'clips' && (
            <ClipsPanel
              hasMerge={hasMerge}
              onMerge={() => { setHasMerge(true); setActiveTool('voiceover') }}
              onUnmerge={() => setHasMerge(false)}
            />
          )}
          {preMergeActive === 'hints' && <HintsPanel hasMerge={hasMerge} />}
        </div>

        {/* Empty player — placeholder so user sees where the result will land. */}
        <FinalVideoPreview hasMerge={hasMerge} />

        {/* Tool menu — Clips + Hints are navigable; rest dimmed. */}
        <ToolMenu
          active={preMergeActive}
          onChange={(key) => {
            if (key === 'clips' || key === 'hints') setActiveTool(key)
          }}
          hasMerge={hasMerge}
        />
      </div>
    )
  }

  // After merge: player becomes the anchor. Tools attach to it.
  return (
    <div className="p-3 space-y-3">
      {/* The merged result — center of gravity from here on out. */}
      <FinalVideoPreview hasMerge={hasMerge} />

      {/* Single entry point for every tool that attaches to the final video. */}
      <ToolMenu active={activeTool} onChange={setActiveTool} hasMerge={hasMerge} />

      {/* Active tool panel. Each panel reads/writes the mock state locally. */}
      <div className="bg-white border border-[#e5e5e5] rounded-lg p-3">
        {activeTool === 'clips' && <ClipsPanel hasMerge={hasMerge} onMerge={() => setHasMerge(true)} onUnmerge={() => setHasMerge(false)} />}
        {activeTool === 'hints' && <HintsPanel hasMerge={hasMerge} />}
        {activeTool === 'voiceover' && <VoiceoverPanel hasMerge={hasMerge} />}
        {activeTool === 'overlays' && <OverlaysPanel hasMerge={hasMerge} />}
        {activeTool === 'channels' && <ChannelsPanel />}
        {activeTool === 'captions' && <CaptionsPanel />}
      </div>
    </div>
  )
}
