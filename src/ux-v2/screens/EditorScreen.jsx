import { useState } from 'react'
import FinalVideoPreview from '../components/FinalVideoPreview'
import ToolMenu from '../components/ToolMenu'
import ClipsPanel from '../components/ClipsPanel'
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
  const [activeTool, setActiveTool] = useState('clips')

  return (
    <div className="p-3 space-y-3">
      {/* Final video canvas — always on top. Its state is hasMerge. */}
      <FinalVideoPreview hasMerge={hasMerge} />

      {/* Icon menu — the single entry point for every tool that attaches
          to the final video. Horizontal on mobile, scrollable if needed. */}
      <ToolMenu active={activeTool} onChange={setActiveTool} hasMerge={hasMerge} />

      {/* Active tool panel. Each panel reads/writes the mock state locally. */}
      <div className="bg-white border border-[#e5e5e5] rounded-lg p-3">
        {activeTool === 'clips' && <ClipsPanel hasMerge={hasMerge} onMerge={() => setHasMerge(true)} onUnmerge={() => setHasMerge(false)} />}
        {activeTool === 'voiceover' && <VoiceoverPanel hasMerge={hasMerge} />}
        {activeTool === 'overlays' && <OverlaysPanel hasMerge={hasMerge} />}
        {activeTool === 'channels' && <ChannelsPanel />}
        {activeTool === 'captions' && <CaptionsPanel />}
      </div>
    </div>
  )
}
