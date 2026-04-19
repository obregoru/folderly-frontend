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
  const [activeTool, setActiveTool] = useState('voiceover')

  // Before merge: Clips panel is the primary surface (upload / sort / merge).
  // Player shows empty state below. Tool menu is dimmed — voiceover /
  // overlays / captions aren't meaningful without a video yet.
  if (!hasMerge) {
    return (
      <div className="p-3 space-y-3">
        {/* Clips panel on top — where all the setup work happens. */}
        <div className="bg-white border border-[#e5e5e5] rounded-lg p-3">
          <ClipsPanel
            hasMerge={hasMerge}
            onMerge={() => { setHasMerge(true); setActiveTool('voiceover') }}
            onUnmerge={() => setHasMerge(false)}
          />
        </div>

        {/* Empty player — placeholder so user sees where the result will land. */}
        <FinalVideoPreview hasMerge={hasMerge} />

        {/* Dimmed menu — hint at what's coming next without letting the user
            detour. */}
        <ToolMenu active={'clips'} onChange={() => {}} hasMerge={hasMerge} />
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
        {activeTool === 'voiceover' && <VoiceoverPanel hasMerge={hasMerge} />}
        {activeTool === 'overlays' && <OverlaysPanel hasMerge={hasMerge} />}
        {activeTool === 'channels' && <ChannelsPanel />}
        {activeTool === 'captions' && <CaptionsPanel />}
      </div>
    </div>
  )
}
