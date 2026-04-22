import { useEffect, useRef, useState } from 'react'
import * as api from '../../api'
import FileGrid from '../../components/FileGrid'
import VideoTrimmer from '../../components/VideoTrimmer'
import VideoMerge from '../../components/VideoMerge'
import PhotoDurationBarBase from '../../components/PhotoDurationBar'
import Dropzone from '../../components/Dropzone'
import FinalPreviewV2, { DownloadFinalButton } from '../components/FinalPreviewV2'
import ToolMenuV2 from '../components/ToolMenuV2'
import HintsPanelV2 from '../components/HintsPanelV2'
import VoiceoverPanelV2 from '../components/VoiceoverPanelV2'
import OverlaysPanelV2 from '../components/OverlaysPanelV2'
import PostTextPanelV2 from '../components/PostTextPanelV2'
import ChannelsPanelV2 from '../components/ChannelsPanelV2'

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
  // Shared ref to the FinalPreview <video>. Every tool that wants to
  // drive the preview (voiceover, overlays) grabs it via previewRef.
  const previewRef = useRef(null)

  const videoFiles = (files || []).filter(f => f.file?.type?.startsWith('video/') || f._mediaType?.startsWith('video/'))
  const photoFiles = (files || []).filter(f => f.file?.type?.startsWith('image/') || f._mediaType?.startsWith('image/'))

  const onlyPhotos = files.length > 0 && videoFiles.length === 0 && photoFiles.length > 0

  // Photo-only drafts default to posting as a photo/carousel. The user
  // can explicitly opt-in to combining photos into a video — that flips
  // outputType to 'video' and reveals VideoMerge. Persisted per-job so
  // the choice survives refresh.
  const [combinePhotosAsVideo, setCombinePhotosAsVideo] = useState(false)
  useEffect(() => {
    if (!draftId) return
    api.getJob(draftId).then(job => {
      setCombinePhotosAsVideo(!!job?.generation_rules?.combine_photos_as_video)
    }).catch(() => {})
  }, [draftId])

  const toggleCombinePhotos = async (next) => {
    setCombinePhotosAsVideo(next)
    if (!draftId) return
    try {
      const current = await api.getJob(draftId)
      const existing = current?.generation_rules || {}
      await api.updateJob(draftId, { generation_rules: { ...existing, combine_photos_as_video: next } })
    } catch (e) {
      console.warn('[EditorV2] save combine flag failed:', e.message)
    }
  }

  // outputType drives the ToolMenu filter. A photo-only draft stays in
  // 'photo-post' mode (no voiceover / overlays tabs) unless the user
  // opts into combining the photos into a video.
  const outputType = onlyPhotos && !combinePhotosAsVideo ? 'photo-post' : 'video'

  // Reactive merge flag — true when the job has a merged video available.
  // Covers: in-session merge (window._postyMergedVideo), job reload
  // (job.merged_video_url pulled via getJob). Subscribes to the
  // 'posty-merge-change' event so the Export panel appears as soon as the
  // merge completes, without a full re-render cycle.
  const [hasMerge, setHasMerge] = useState(() =>
    typeof window !== 'undefined' && !!window._postyMergedVideo?.url
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sync = () => setHasMerge(!!window._postyMergedVideo?.url)
    window.addEventListener('posty-merge-change', sync)
    return () => window.removeEventListener('posty-merge-change', sync)
  }, [])
  useEffect(() => {
    if (!draftId) return
    api.getJob(draftId).then(job => {
      if (job?.merged_video_url || job?.merged_video_key) setHasMerge(true)
    }).catch(() => {})
  }, [draftId])
  const hasFinal = hasMerge || (videoFiles.length === 1) || (onlyPhotos && photoFiles.length > 0)

  const VIDEO_ONLY_TOOLS = ['voiceover', 'overlays']
  const safeActiveTool = outputType === 'photo-post' && VIDEO_ONLY_TOOLS.includes(activeTool)
    ? 'clips'
    : activeTool

  return (
    <div className="p-3 space-y-3">
      <FinalPreviewV2 ref={previewRef} files={files} draftId={draftId} jobSync={jobSync} />

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
            onlyPhotos={onlyPhotos}
            combinePhotosAsVideo={combinePhotosAsVideo}
            onToggleCombinePhotos={toggleCombinePhotos}
          />
        )}
        {safeActiveTool === 'hints' && <HintsPanelV2 jobSync={jobSync} draftId={draftId} settings={settings} />}
        {/*
          VoiceoverPanelV2 stays MOUNTED on every tab — only its
          visibility toggles. Its playback-sync useEffect owns the
          primary-audio <audio> element and the per-segment Audio()
          pool, and attaches timeupdate/play/pause listeners to the
          shared preview video. Unmounting the panel detached all
          that, so the Overlays / Captions / Channels tabs' preview
          played video + captions but silent voiceover. Captions
          didn't break because InlineCaptionOverlay lives in
          FinalPreviewV2 (always mounted).
        */}
        <div style={{ display: safeActiveTool === 'voiceover' ? 'block' : 'none' }}>
          <VoiceoverPanelV2 previewRef={previewRef} settings={settings} jobSync={jobSync} draftId={draftId} />
        </div>
        {safeActiveTool === 'overlays' && <OverlaysPanelV2 jobSync={jobSync} draftId={draftId} previewRef={previewRef} />}
        {safeActiveTool === 'captions' && <PostTextPanelV2 jobSync={jobSync} draftId={draftId} files={files} settings={settings} />}
        {safeActiveTool === 'channels' && <ChannelsPanelV2 draftId={draftId} jobSync={jobSync} files={files} settings={settings} />}
      </div>

      {(hasMerge || (onlyPhotos && photoFiles.length >= 1 && !combinePhotosAsVideo)) && draftId && (
        <div className="bg-white border border-[#e5e5e5] rounded-lg p-3 space-y-2">
          <div className="text-[12px] font-medium">Export</div>
          <div className="text-[10px] text-muted">
            {hasMerge
              ? 'Bakes overlays, closed captions, and voiceover into the merged video. Takes 10–30s. On phone, opens the share sheet so you can Save to Photos.'
              : (photoFiles.length === 1
                  ? 'Bakes the overlay caption onto the photo. Static — no animation. Takes a few seconds.'
                  : `Bakes the overlay caption onto each of the ${photoFiles.length} photos and gives you all ${photoFiles.length} files to save. Carousel publishing from Schedule is coming next — for now Schedule posts only the first photo.`)
            }
          </div>
          <DownloadFinalButton draftId={draftId} jobSync={jobSync} />
        </div>
      )}
    </div>
  )
}

function ClipsPanelV2({ files, videoFiles, addFiles, removeFile, reorderFiles, jobSync, onlyPhotos, combinePhotosAsVideo, onToggleCombinePhotos }) {
  // Show the merge UI when:
  //   - There's at least one video (mixed draft or video-only) AND 2+ items, OR
  //   - It's a photo-only draft and the user opted into combining into video.
  const hasVideos = videoFiles.length > 0
  const showMerge = files.length >= 2 && (hasVideos || (onlyPhotos && combinePhotosAsVideo))

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-medium">Media ({files.length})</div>

      <Dropzone onFiles={(fileList) => addFiles(fileList)} />

      {files.length > 0 && (
        <FileGrid
          files={files}
          onRemove={removeFile}
          onReorder={reorderFiles}
          VideoTrimmer={VideoTrimmer}
          // Only surface the photo duration + motion controls under
          // photo tiles when this draft is actually going to combine
          // into a video. Pure photo-carousel drafts don't need them.
          PhotoDurationBar={showMerge ? (({ item }) => (
            <PhotoDurationBarBase
              item={item}
              onInvalidateMerge={() => {
                if (typeof window !== 'undefined' && window._postyMergedVideo) {
                  try { URL.revokeObjectURL(window._postyMergedVideo.url) } catch {}
                  window._postyMergedVideo = null
                  try { window.dispatchEvent(new CustomEvent('posty-merge-change')) } catch {}
                }
              }}
              onSaveTrim={it => jobSync.saveFileTrim?.(it)}
              onSaveMotion={it => jobSync.saveFilePhotoMotion?.(it)}
            />
          )) : null}
        />
      )}

      {/* Photo-only drafts default to posting as a photo/carousel.
          This toggle explicitly opts into combining the photos into a
          single video (Reel / Short). Hides itself in mixed or
          video-only drafts where the merge intent is already obvious. */}
      {onlyPhotos && files.length >= 2 && (
        <label className={`flex items-start gap-2 border rounded p-2 cursor-pointer ${combinePhotosAsVideo ? 'border-[#6C5CE7]/40 bg-[#f3f0ff]' : 'border-[#e5e5e5] bg-white'}`}>
          <input
            type="checkbox"
            checked={!!combinePhotosAsVideo}
            onChange={e => onToggleCombinePhotos?.(e.target.checked)}
            className="mt-0.5"
          />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-medium">Combine these photos into a video</div>
            <div className="text-[9px] text-muted mt-0.5">
              Off (default) → post as a photo carousel on IG / FB / TikTok.<br />
              On → assemble into a Reel / Short with per-photo display durations. Enables voiceover + overlays tabs.
            </div>
          </div>
        </label>
      )}

      {/* VideoMerge (trim + reorder list + real server merge + Preview
          lightbox). Hidden for photo-only drafts that haven't opted
          into combining as video — no merge = no trim/duration UI
          shown by default. */}
      {showMerge && (
        <VideoMerge
          videoFiles={files}
          jobId={jobSync.jobId}
          onReorder={(fromIdxLocal, toIdxLocal) => {
            const fromFileId = files[fromIdxLocal]?.id
            const toFileId = files[toIdxLocal]?.id
            if (!fromFileId || !toFileId) return
            const fromAbs = files.findIndex(f => f.id === fromFileId)
            const toAbs = files.findIndex(f => f.id === toFileId)
            reorderFiles(fromAbs, toAbs)
          }}
          onMerged={({ blob, url, base64 }) => {
            window._postyMergedVideo = { blob, url, base64 }
            try { window.dispatchEvent(new CustomEvent('posty-merge-change')) } catch {}
          }}
          onSaveTrim={item => jobSync.saveFileTrim?.(item)}
          onSaveMotion={item => jobSync.saveFilePhotoMotion?.(item)}
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
