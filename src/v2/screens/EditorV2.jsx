import { useState } from 'react'
import FileGrid from '../../components/FileGrid'
import VideoTrimmer from '../../components/VideoTrimmer'
import VideoMerge from '../../components/VideoMerge'
import Dropzone from '../../components/Dropzone'
import FinalPreviewV2 from '../components/FinalPreviewV2'
import ToolMenuV2 from '../components/ToolMenuV2'

/**
 * EditorV2 — the new mockup-style editor, real data.
 * Layout (constant, never reorders):
 *   FinalPreviewV2 (top, pinned)
 *   ToolMenuV2 (horizontal icon strip)
 *   Active tool panel
 *
 * Phase 2: Clips panel hosts the existing FileGrid + VideoMerge + Dropzone
 * — reuses proven upload/trim/speed/merge logic inside the new shell.
 * Voiceover / Overlays / Captions / Channels are placeholder panels in
 * this phase; they'll be ported one by one in phases 3+.
 */
export default function EditorV2({
  draftId, jobSync, files, setFiles, settings, addFiles, removeFile, reorderFiles,
}) {
  const [activeTool, setActiveTool] = useState('clips')

  const videoFiles = (files || []).filter(f => f.file?.type?.startsWith('video/') || f._mediaType?.startsWith('video/'))
  const photoFiles = (files || []).filter(f => f.file?.type?.startsWith('image/') || f._mediaType?.startsWith('image/'))

  const onlyPhotos = files.length > 0 && videoFiles.length === 0 && photoFiles.length > 0
  const outputType = onlyPhotos ? 'photo-post' : 'video'

  const hasMerge = typeof window !== 'undefined' && !!window._postyMergedVideo?.url
  const hasFinal = hasMerge || (videoFiles.length === 1) || (onlyPhotos && photoFiles.length > 0)

  const VIDEO_ONLY_TOOLS = ['voiceover', 'overlays']
  const safeActiveTool = outputType === 'photo-post' && VIDEO_ONLY_TOOLS.includes(activeTool)
    ? 'clips'
    : activeTool

  return (
    <div className="p-3 space-y-3">
      <FinalPreviewV2 files={files} />

      <ToolMenuV2
        active={safeActiveTool}
        onChange={setActiveTool}
        hasFinal={hasFinal}
        outputType={outputType}
      />

      <div className="bg-white border border-[#e5e5e5] rounded-lg p-3">
        {safeActiveTool === 'clips' && (
          <ClipsPanelV2
            files={files}
            videoFiles={videoFiles}
            addFiles={addFiles}
            removeFile={removeFile}
            reorderFiles={reorderFiles}
            jobSync={jobSync}
          />
        )}
        {safeActiveTool === 'hints' && <PlaceholderPanel label="Hints" />}
        {safeActiveTool === 'voiceover' && <PlaceholderPanel label="Voice" note="Replaces VoiceoverRecorder with a zero-player design in Phase 3." />}
        {safeActiveTool === 'overlays' && <PlaceholderPanel label="Overlays" />}
        {safeActiveTool === 'captions' && <PlaceholderPanel label="Post text" />}
        {safeActiveTool === 'channels' && <PlaceholderPanel label="Channels" />}
      </div>
    </div>
  )
}

function ClipsPanelV2({ files, videoFiles, addFiles, removeFile, reorderFiles, jobSync }) {
  return (
    <div className="space-y-3">
      <div className="text-[12px] font-medium">Media ({files.length})</div>

      <Dropzone onFiles={(fileList) => addFiles(fileList)} />

      {files.length > 0 && (
        <FileGrid files={files} onRemove={removeFile} VideoTrimmer={VideoTrimmer} />
      )}

      {videoFiles.length >= 2 && (
        <VideoMerge
          videoFiles={videoFiles}
          jobId={jobSync.jobId}
          onReorder={(fromIdxLocal, toIdxLocal) => {
            const fromFileId = videoFiles[fromIdxLocal]?.id
            const toFileId = videoFiles[toIdxLocal]?.id
            if (!fromFileId || !toFileId) return
            const fromAbs = files.findIndex(f => f.id === fromFileId)
            const toAbs = files.findIndex(f => f.id === toFileId)
            reorderFiles(fromAbs, toAbs)
          }}
          onMerged={({ blob, url, base64 }) => {
            window._postyMergedVideo = { blob, url, base64 }
            try { window.dispatchEvent(new CustomEvent('posty-merge-change')) } catch {}
          }}
        />
      )}
    </div>
  )
}

function PlaceholderPanel({ label, note }) {
  return (
    <div className="text-center py-6 space-y-2">
      <div className="text-[12px] font-medium">{label}</div>
      <div className="text-[10px] text-muted max-w-[280px] mx-auto">
        {note || 'Ports in a later v2 phase. Use the real app at ?real=1 for now.'}
      </div>
      <a href="/?real=1" className="inline-block text-[10px] py-1.5 px-3 bg-[#6C5CE7] text-white rounded no-underline">
        Open real app →
      </a>
    </div>
  )
}
