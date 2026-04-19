import { useState } from 'react'
import FinalPreview from '../components/FinalPreview'
import ToolMenu from '../components/ToolMenu'
import MediaPanel from '../components/MediaPanel'
import HintsPanel from '../components/HintsPanel'
import VoiceoverPanel from '../components/VoiceoverPanel'
import OverlaysPanel from '../components/OverlaysPanel'
import ChannelsPanel from '../components/ChannelsPanel'
import CaptionsPanel from '../components/CaptionsPanel'

/**
 * Editor — the primary v2 workflow. Constant layout: preview on top, icon
 * strip, active panel below. The preview + tool menu adapt based on
 * outputType ('photo-post' | 'video') so the workflow surfaces only what's
 * relevant.
 */
export default function EditorScreen({ draftId }) {
  const [outputType, setOutputType] = useState('video') // 'photo-post' | 'video'
  const [hasFinal, setHasFinal] = useState(false)
  const [photos, setPhotos] = useState([])
  const [activeTool, setActiveTool] = useState('clips')

  // When user switches output type, fall back the active tool if it was
  // a video-only tool and we're now in photo-post mode.
  const VIDEO_ONLY_TOOLS = ['voiceover', 'overlays']
  const safeActiveTool = outputType === 'photo-post' && VIDEO_ONLY_TOOLS.includes(activeTool)
    ? 'clips'
    : activeTool

  return (
    <div className="p-3 space-y-3">
      <FinalPreview outputType={outputType} hasFinal={hasFinal} photos={photos} />

      <ToolMenu
        active={safeActiveTool}
        onChange={setActiveTool}
        hasFinal={hasFinal}
        outputType={outputType}
      />

      <div className="bg-white border border-[#e5e5e5] rounded-lg p-3">
        {safeActiveTool === 'clips' && (
          <MediaPanel
            outputType={outputType}
            setOutputType={setOutputType}
            hasFinal={hasFinal}
            onBuild={(photoUrls) => {
              setHasFinal(true)
              if (outputType === 'photo-post') {
                setPhotos(photoUrls.length > 0 ? photoUrls : ['https://picsum.photos/seed/default/720/1280'])
              }
              // Default tool after build: voiceover for video, post text for photo
              setActiveTool(outputType === 'photo-post' ? 'captions' : 'voiceover')
            }}
            onUnbuild={() => { setHasFinal(false); setPhotos([]) }}
          />
        )}
        {safeActiveTool === 'hints' && <HintsPanel hasMerge={hasFinal} />}
        {safeActiveTool === 'voiceover' && <VoiceoverPanel hasMerge={hasFinal} />}
        {safeActiveTool === 'overlays' && <OverlaysPanel hasMerge={hasFinal} />}
        {safeActiveTool === 'channels' && <ChannelsPanel />}
        {safeActiveTool === 'captions' && <CaptionsPanel />}
      </div>
    </div>
  )
}
