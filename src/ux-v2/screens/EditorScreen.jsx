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
  // Clips is the default first action; user moves left-to-right through
  // the icon strip (Clips → Hints → Voice → Overlays → Post text → Channels).
  const [activeTool, setActiveTool] = useState('clips')

  // Constant layout: player pinned at top as the anchor, icon menu below,
  // active panel at the bottom. Empty-state player before merge still
  // shows where the result will land. No conditional reordering.
  return (
    <div className="p-3 space-y-3">
      <FinalVideoPreview hasMerge={hasMerge} />

      <ToolMenu active={activeTool} onChange={setActiveTool} hasMerge={hasMerge} />

      <div className="bg-white border border-[#e5e5e5] rounded-lg p-3">
        {activeTool === 'clips' && (
          <ClipsPanel
            hasMerge={hasMerge}
            onMerge={() => setHasMerge(true)}
            onUnmerge={() => setHasMerge(false)}
          />
        )}
        {activeTool === 'hints' && <HintsPanel hasMerge={hasMerge} />}
        {activeTool === 'voiceover' && <VoiceoverPanel hasMerge={hasMerge} />}
        {activeTool === 'overlays' && <OverlaysPanel hasMerge={hasMerge} />}
        {activeTool === 'channels' && <ChannelsPanel />}
        {activeTool === 'captions' && <CaptionsPanel />}
      </div>
    </div>
  )
}
