import { useEffect, useRef, useState } from 'react'
import * as api from '../../api'
import FileGrid from '../../components/FileGrid'
import VideoTrimmer from '../../components/VideoTrimmer'
import VideoMerge from '../../components/VideoMerge'
import PhotoDurationBarBase from '../../components/PhotoDurationBar'
import Dropzone from '../../components/Dropzone'
import MediaLibraryPicker from '../components/MediaLibraryPicker'
import FinalPreviewV2, { DownloadFinalButton } from '../components/FinalPreviewV2'
import AudioMixLog from '../components/AudioMixLog'
import ToolMenuV2 from '../components/ToolMenuV2'
import HintsPanelV2 from '../components/HintsPanelV2'
import VoiceoverPanelV2 from '../components/VoiceoverPanelV2'
import OverlaysPanelV2 from '../components/OverlaysPanelV2'
import PostTextPanelV2 from '../components/PostTextPanelV2'
import ProducerChatPanel from '../components/ProducerChatPanel'
import First2sPanel from '../components/First2sPanel'
import FullVideoPanel from '../components/FullVideoPanel'
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
  draftId, jobSync, files, setFiles, settings, addFiles, removeFile, reorderFiles, duplicateFile,
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
            setFiles={setFiles}
            videoFiles={videoFiles}
            addFiles={addFiles}
            removeFile={removeFile}
            reorderFiles={reorderFiles}
            duplicateFile={duplicateFile}
            jobSync={jobSync}
            onlyPhotos={onlyPhotos}
            combinePhotosAsVideo={combinePhotosAsVideo}
            onToggleCombinePhotos={toggleCombinePhotos}
            draftId={draftId}
          />
        )}
        {safeActiveTool === 'hints' && <HintsPanelV2 jobSync={jobSync} draftId={draftId} settings={settings} />}
        {safeActiveTool === 'producer' && <ProducerChatPanel draftId={draftId} jobSync={jobSync} files={files} />}
        {safeActiveTool === 'first2s' && <First2sPanel draftId={draftId} jobSync={jobSync} />}
        {safeActiveTool === 'fullvideo' && <FullVideoPanel draftId={draftId} jobSync={jobSync} previewRef={previewRef} />}
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
          <DownloadFinalButton draftId={draftId} jobSync={jobSync} files={files} />
          <div className="flex items-center gap-1.5 flex-wrap">
            <SaveAsTenantDefaultButton draftId={draftId} />
            <ApplyTenantDefaultsButton draftId={draftId} jobSync={jobSync} />
          </div>
          {/* Auto-appears after the first Download press; refreshes
              every subsequent press. Mirrors the BE mix logic so what
              you see in the table is exactly what landed in the mp4. */}
          <AudioMixLog draftId={draftId} />
        </div>
      )}
    </div>
  )
}

function ClipsPanelV2({ files, setFiles, videoFiles, addFiles, removeFile, reorderFiles, duplicateFile, jobSync, onlyPhotos, combinePhotosAsVideo, onToggleCombinePhotos, draftId }) {
  // Show the merge UI when:
  //   - There's at least one video (mixed draft or video-only), OR
  //   - It's a photo-only draft with 2+ items and the user opted into
  //     combining into video.
  //
  // Single-video drafts also surface the merge UI so the user can
  // apply trim and produce a merged_video_key — the rest of the
  // pipeline (final-render, captions, voiceover sync, analyze) keys
  // off that. Without it, a one-video draft was stuck at "no merge
  // button to press" and downstream steps fell apart.
  const hasVideos = videoFiles.length > 0
  const showMerge = hasVideos
    || (onlyPhotos && combinePhotosAsVideo && files.length >= 2)

  const [libraryOpen, setLibraryOpen] = useState(false)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">Media ({files.length})</div>
        <button
          type="button"
          onClick={() => setLibraryOpen(true)}
          disabled={!draftId}
          className="text-[10px] py-1 px-2 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-50"
          title="Pick a file from media you've already uploaded in other drafts. The file is copied so cleanup of the source draft won't break this one."
        >📚 Browse uploads</button>
      </div>

      <Dropzone onFiles={(fileList) => addFiles(fileList)} />

      {libraryOpen && (
        <MediaLibraryPicker
          destJobUuid={draftId}
          kind={onlyPhotos ? 'image' : 'all'}
          onClose={() => setLibraryOpen(false)}
          onPicked={(picked) => {
            // Inject the freshly imported file into the local files
            // state so it appears in the panel immediately. Shape
            // mirrors what useJobSync.loadJob produces for restored
            // files — the lightbox + RestoredMedia tile both require
            // _restored:true plus _publicUrl/_uploadKey/_tenantSlug
            // to resolve a preview source. Without these, the tile
            // falls through to "No preview available — file needs to
            // be re-uploaded" because the lightbox source-resolver
            // returns null.
            const imp = picked?.imported || {}
            const isImg = String(picked?.media_type || '').toLowerCase().startsWith('image/')
            const entry = {
              id: `lib-${Math.random().toString(36).slice(2)}`,
              file: null,
              isImg,
              parsed: { occasions: [], products: [], moments: [] },
              status: 'done',
              captions: null,
              uploadResult: { original_temp_path: imp.upload_key, uuid: null },
              _trimStart: 0,
              _trimEnd: null,
              _restored: true,
              _tenantSlug: api.tenantSlug?.() || null,
              _uploadKey: imp.upload_key || null,
              _publicUrl: imp.public_url || null,
              _filename: imp.filename || picked?.filename,
              _mediaType: imp.media_type || picked?.media_type,
              _dbFileId: imp.id || null,
              _fileHash: imp.file_hash || picked?.file_hash || null,
            }
            setFiles?.(prev => [...(prev || []), entry])
          }}
        />
      )}

      {files.length > 0 && (
        <FileGrid
          files={files}
          onRemove={removeFile}
          onReorder={reorderFiles}
          onDuplicate={duplicateFile}
          onStorageMissing={(itemId) => {
            // Client-side fallback: a tile's <video>/<img> errored
            // loading the source. Lift the flag into files state so
            // VideoTrimmer / PhotoDurationBar unmount and the merge
            // filter sees the missing flag. Bridges the gap between
            // FE deploy and BE deploy lag — once BE GET /jobs:id
            // sets storage_missing on response, this is a no-op.
            setFiles?.(prev => prev.map(f => f.id === itemId ? { ...f, _storageMissing: true } : f))
          }}
          onToggleSkip={(it) => {
            const next = !it._skipInMerge
            // Optimistic local update so the tile dims immediately;
            // saveFileSkip persists in the background. Invalidate the
            // current merge cache so VideoMerge knows it needs a fresh
            // run with the new clip set.
            setFiles?.(prev => prev.map(f => f.id === it.id ? { ...f, _skipInMerge: next } : f))
            jobSync.saveFileSkip?.({ ...it, _skipInMerge: next })
            if (typeof window !== 'undefined' && window._postyMergedVideo) {
              try { URL.revokeObjectURL(window._postyMergedVideo.url) } catch {}
              window._postyMergedVideo = null
              try { window.dispatchEvent(new CustomEvent('posty-merge-change')) } catch {}
            }
          }}
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
              onSaveTrim={it => {
                jobSync.saveFileTrim?.(it)
                // Bump the files array reference so React sees a
                // change and re-renders the thumbnail with the new
                // _trimEnd. PhotoDurationControl mutates item._trimEnd
                // directly; without this nudge the parent never knows
                // the value changed.
                setFiles?.(prev => prev.map(f => f.id === it.id ? { ...f } : f))
              }}
              onSaveMotion={it => {
                jobSync.saveFilePhotoMotion?.(it)
                // Same treatment for motion / zoom / rotate. After the
                // first commit, onInvalidateMerge happened to trigger
                // an incidental re-render; the second commit had no
                // merge to invalidate so the thumbnail / preview kept
                // showing the old transform even though the DB row
                // had updated.
                setFiles?.(prev => prev.map(f => f.id === it.id ? { ...f } : f))
              }}
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

// One-click "use this job's overlay + caption styling as my tenant
// default for all future drafts." Reads the job's overlay_settings
// + default_caption_style, translates into the tenant's
// default_overlay_style shape, and writes via api.saveSettings. The
// next new draft inherits these on creation; the producer's Apply &
// generate flow also reads them.
function SaveAsTenantDefaultButton({ draftId }) {
  const [state, setState] = useState('idle') // idle | working | done | error
  const [msg, setMsg] = useState('')
  const handle = async () => {
    if (!draftId || state === 'working') return
    if (!confirm('Use THIS draft\'s overlay font, color, sizes, and Y placement (plus the VO caption style) as your tenant\'s defaults?\n\nNew drafts will inherit this. Existing drafts are unaffected.')) return
    setState('working'); setMsg('')
    try {
      const [job, captionStyle] = await Promise.all([
        api.getJob(draftId),
        api.getJobDefaultCaptionStyle(draftId).catch(() => ({ caption_style: null })),
      ])
      const overlay = job?.overlay_settings || {}
      const cap = captionStyle?.caption_style || {}
      const layout = (cap.layout_config && typeof cap.layout_config === 'object') ? cap.layout_config : {}
      const payload = {}
      // Color/family/outline — use whichever the job has set, prefer
      // explicit slot values then fall back to the global.
      if (overlay.fontColor) payload.fontColor = overlay.fontColor
      if (overlay.fontFamily) payload.fontFamily = overlay.fontFamily
      if (overlay.fontOutline) payload.fontOutline = overlay.fontOutline
      if (overlay.outlineWidth != null) payload.outlineWidth = Number(overlay.outlineWidth)
      // Per-slot font sizes
      if (overlay.openingFontSize != null) payload.openingFontSize = Number(overlay.openingFontSize)
      if (overlay.middleFontSize  != null) payload.middleFontSize  = Number(overlay.middleFontSize)
      if (overlay.closingFontSize != null) payload.closingFontSize = Number(overlay.closingFontSize)
      // Per-slot Y placements
      if (overlay.openingYPct != null) payload.openingYPct = Number(overlay.openingYPct)
      if (overlay.middleYPct  != null) payload.middleYPct  = Number(overlay.middleYPct)
      if (overlay.closingYPct != null) payload.closingYPct = Number(overlay.closingYPct)
      // VO caption styling — pull from default_caption_style; fall
      // through to overlay font color when caption-specific isn't set.
      if (cap.base_font_size != null) payload.captionFontSize = Number(cap.base_font_size)
      if (cap.font_color) payload.fontColor = payload.fontColor || cap.font_color
      if (cap.font_outline) payload.fontOutline = payload.fontOutline || cap.font_outline
      if (cap.outline_width != null) payload.outlineWidth = payload.outlineWidth ?? Number(cap.outline_width)
      if (cap.font_family) payload.fontFamily = payload.fontFamily || cap.font_family
      if (layout.verticalPosition != null) payload.captionYPct = Number(layout.verticalPosition)

      await api.saveSettings({ default_overlay_style: payload })
      setState('done'); setMsg(`Saved ${Object.keys(payload).length} field(s).`)
      setTimeout(() => { setState('idle'); setMsg('') }, 3000)
    } catch (e) {
      setState('error'); setMsg(e?.message || String(e))
      setTimeout(() => { setState('idle'); setMsg('') }, 4000)
    }
  }
  return (
    <button
      type="button"
      onClick={handle}
      disabled={!draftId || state === 'working'}
      className="text-[10px] py-1 px-2 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-50 self-start hover:bg-[#f3f0ff]"
      title="Save this draft's overlay/caption styling as your tenant's defaults. New drafts will inherit these."
    >
      {state === 'working' ? 'Saving…'
        : state === 'done' ? `✓ ${msg}`
        : state === 'error' ? `✕ ${msg.slice(0, 40)}`
        : '💾 Save as tenant default'}
    </button>
  )
}

// Inverse of SaveAsTenantDefaultButton: pushes the tenant's saved
// default_overlay_style INTO this job. Useful when you've been
// iterating on a draft, then realize the tenant defaults have
// drifted from what you've got — one click brings the draft back in
// line with the brand. Cascades the new caption defaults down to
// every per-segment caption_styles row so existing VO captions pick
// up the new sizing/Y instead of staying on stale per-segment
// overrides. Refreshes the local job state via jobSync.loadJob so
// every panel reflects the new values without a hard reload.
function ApplyTenantDefaultsButton({ draftId, jobSync }) {
  const [state, setState] = useState('idle')
  const [msg, setMsg] = useState('')
  const handle = async () => {
    if (!draftId || state === 'working') return
    if (!confirm('Apply your tenant\'s overlay defaults (font, color, sizes, Y placements) to THIS draft?\n\nThis will overwrite the draft\'s existing overlay + VO caption styling. Per-segment caption overrides will also be reset to the new defaults.')) return
    setState('working'); setMsg('')
    try {
      const r = await api.applyTenantDefaultsToJob(draftId)
      if (!r?.ok) throw new Error(r?.error || 'Apply failed')
      setState('done')
      setMsg(`Applied · ${r.cascaded_segment_rows || 0} segment(s) updated`)
      try { await jobSync?.loadJob?.(draftId) } catch {}
      setTimeout(() => { setState('idle'); setMsg('') }, 3000)
    } catch (e) {
      setState('error'); setMsg(e?.message || String(e))
      setTimeout(() => { setState('idle'); setMsg('') }, 4000)
    }
  }
  return (
    <button
      type="button"
      onClick={handle}
      disabled={!draftId || state === 'working'}
      className="text-[10px] py-1 px-2 border border-[#2D9A5E]/40 text-[#2D9A5E] bg-white rounded cursor-pointer disabled:opacity-50 self-start hover:bg-[#f0faf4]"
      title="Apply your tenant's overlay/caption defaults to this draft, overwriting its current styling. Cascades to every VO segment."
    >
      {state === 'working' ? 'Applying…'
        : state === 'done' ? `✓ ${msg}`
        : state === 'error' ? `✕ ${msg.slice(0, 40)}`
        : '🎨 Apply tenant defaults'}
    </button>
  )
}
