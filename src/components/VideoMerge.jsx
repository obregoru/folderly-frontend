import { useState, useRef, useEffect } from 'react'
import { buildDownloadName } from '../lib/filename'
import MergePreviewLightbox from './MergePreviewLightbox'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor,
  useSensor, useSensors,
} from '@dnd-kit/core'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// Read file as base64 (same helper as ResultCard)
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => {
    const bytes = new Uint8Array(r.result)
    let binary = ''
    const chunk = 8192
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
    }
    resolve(btoa(binary))
  }
  r.onerror = reject
  r.readAsArrayBuffer(file)
})

const TRANSITIONS = [
  { value: 'none', label: 'Hard cut' },
  { value: 'crossfade', label: 'Crossfade' },
  { value: 'fade_black', label: 'Fade to black' },
  { value: 'wipe_left', label: 'Wipe left' },
  { value: 'slide_left', label: 'Slide left' },
]

// Sortable clip row. Wraps the row's children in a useSortable context so
// dnd-kit can drag it. `handleListeners` is exposed so we can attach drag
// listeners ONLY to the drag handle — the rest of the row keeps normal
// click/tap behavior (speed select, up/down arrows, etc).
function SortableClipRow({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return children({ setNodeRef, style, attributes, handleListeners: listeners, isDragging })
}

/**
 * Merge UI — shown below individual video trimmers when 2+ videos are uploaded.
 * Lets users reorder clips, pick a transition, and merge into a single MP4.
 * The merged result becomes a virtual file item that the post flow can use.
 */
export default function VideoMerge({ videoFiles, jobId, onMerged, onReorder, restoredMergeUrl }) {
  // The merge list now uses the natural order of videoFiles so reordering here
  // flows back to the file grid + voiceover preview. onReorder(fromIdx, toIdx)
  // is implemented by App.jsx and persists the new order to the server.
  const [transition, setTransition] = useState('crossfade')
  const [transDuration, setTransDuration] = useState(1)
  const [merging, setMerging] = useState(false)
  const [progress, setProgress] = useState('')
  const [mergedUrl, setMergedUrl] = useState(() => restoredMergeUrl || window._postyMergedVideo?.url || null)
  const [error, setError] = useState(null)
  const mergedBlobRef = useRef(window._postyMergedVideo?.blob || null)

  // Pick up restored merge URL when it arrives after mount
  useEffect(() => {
    if (restoredMergeUrl && !mergedUrl) setMergedUrl(restoredMergeUrl)
  }, [restoredMergeUrl])

  // Re-render when any item's duration becomes known (from VideoTrimmer) OR
  // when the user commits a new trim range. Both are mutations React can't
  // observe, so we bump a counter to force re-render.
  const [, setDurTick] = useState(0)
  useEffect(() => {
    const bump = () => setDurTick(t => t + 1)
    window.addEventListener('posty-video-duration', bump)
    window.addEventListener('posty-trim-change', bump)
    return () => {
      window.removeEventListener('posty-video-duration', bump)
      window.removeEventListener('posty-trim-change', bump)
    }
  }, [])

  // Probe duration directly for any clip that doesn't yet have one.
  // Uses a hidden <video> element; works for both File blobs and public URLs.
  useEffect(() => {
    let cancelled = false
    for (const item of videoFiles) {
      if (item._videoDuration || item._videoDurationProbing) continue
      const src = (item.file instanceof Blob || item.file instanceof File)
        ? URL.createObjectURL(item.file)
        : item._publicUrl
      if (!src) continue
      item._videoDurationProbing = true
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.muted = true
      if (!src.startsWith('blob:')) v.crossOrigin = 'anonymous'
      v.src = src
      const done = () => {
        if (cancelled) return
        if (v.duration && isFinite(v.duration)) {
          item._videoDuration = v.duration
          setDurTick(t => t + 1)
        }
        if (src.startsWith('blob:')) try { URL.revokeObjectURL(src) } catch {}
      }
      v.addEventListener('loadedmetadata', done, { once: true })
      v.addEventListener('error', done, { once: true })
    }
    return () => { cancelled = true }
  }, [videoFiles])

  // Clear any stale merge result when the file list itself changes
  const fileIds = videoFiles.map(f => f.id).join(',')
  const prevFileIdsRef = useRef(fileIds)
  if (fileIds !== prevFileIdsRef.current) {
    prevFileIdsRef.current = fileIds
    if (mergedUrl) { URL.revokeObjectURL(mergedUrl); setMergedUrl(null) }
    mergedBlobRef.current = null
    window._postyMergedVideo = null
    setError(null)
  }

  const moveUp = (idx) => {
    if (idx <= 0) return
    if (onReorder) onReorder(idx, idx - 1)
  }
  const moveDown = (idx) => {
    if (idx >= videoFiles.length - 1) return
    if (onReorder) onReorder(idx, idx + 1)
  }

  // DnD sensors — PointerSensor (desktop mouse) + TouchSensor (iOS/Android)
  // + KeyboardSensor (accessibility). Delay 150ms on touch so a tap-to-scroll
  // gesture doesn't accidentally start a drag.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const handleDragEnd = (event) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromIdx = videoFiles.findIndex(f => f.id === active.id)
    const toIdx = videoFiles.findIndex(f => f.id === over.id)
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return
    if (onReorder) onReorder(fromIdx, toIdx)
  }

  // Clip list collapse state — auto-collapsed once a merge exists so the
  // user can focus on the final video. Manual toggle to re-open.
  const [clipsCollapsed, setClipsCollapsed] = useState(false)
  useEffect(() => {
    // Auto-fold once we have a working merge.
    if (mergedUrl && !clipsCollapsed) setClipsCollapsed(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedUrl])

  // Lightbox preview state + playlist builder. The lightbox walks each
  // clip in order (videos respect trim+speed, photos get their display
  // duration). Hard cuts, no crossfades, no overlay / voiceover mix —
  // fast iteration tool; Merge produces the final file.
  const [previewPlaylist, setPreviewPlaylist] = useState(null)

  const itemToPlaylistEntry = (item) => {
    const isImg = item.isImg || item.file?.type?.startsWith('image/') || item._mediaType?.startsWith('image/')
    let url = null
    if (item.file instanceof Blob || item.file instanceof File) {
      if (!item._previewBlobUrl) item._previewBlobUrl = URL.createObjectURL(item.file)
      url = item._previewBlobUrl
    } else if (item._publicUrl) {
      url = item._publicUrl
    } else if (item._uploadKey && item._tenantSlug) {
      url = `${import.meta.env.VITE_API_URL || ''}/api/t/${item._tenantSlug}/upload/serve?key=${encodeURIComponent(item._uploadKey)}`
    }
    const filename = item.file?.name || item._filename || 'Untitled'
    if (isImg) {
      // Photos: _trimEnd doubles as "display duration" (seconds).
      // Default to 5s when unset.
      const duration = item._trimEnd != null && item._trimEnd > 0 ? Number(item._trimEnd) : 5
      return { id: item.id, type: 'photo', url, filename, trimEnd: duration }
    }
    return {
      id: item.id,
      type: 'video',
      url,
      filename,
      trimStart: Number(item._trimStart) || 0,
      trimEnd: item._trimEnd != null ? Number(item._trimEnd) : null,
      speed: Number(item._speed) > 0 ? Number(item._speed) : 1.0,
    }
  }

  const handlePreviewMerge = () => {
    const playlist = videoFiles.map(itemToPlaylistEntry).filter(c => c.url)
    if (playlist.length === 0) { setError('Nothing to preview — no media with a usable URL.'); return }
    setPreviewPlaylist(playlist)
  }

  const clearPreviewMerge = () => setPreviewPlaylist(null)

  const handleMerge = async () => {
    setMerging(true)
    setError(null)
    setProgress('Uploading clips...')
    // Clear the stale merged result immediately so it's obvious a new merge is in progress
    if (mergedUrl) {
      try { URL.revokeObjectURL(mergedUrl) } catch {}
      setMergedUrl(null)
      mergedBlobRef.current = null
      window._postyMergedVideo = null
    }
    try {
      const api = await import('../api')
      // Filter to videos only for the server merge — backend photo-to-video
      // segment support lands in a follow-up. Photos still appear in the
      // Preview lightbox with their display duration; the merged MP4
      // posted to social is video-only for now.
      const isPhotoItem = (i) => i?.isImg || i?.file?.type?.startsWith('image/') || i?._mediaType?.startsWith('image/')
      const videoOnly = videoFiles.filter(i => !isPhotoItem(i))
      const photoCount = videoFiles.length - videoOnly.length
      if (videoOnly.length < 2) {
        throw new Error(photoCount > 0
          ? 'Merge needs at least 2 videos — photo-to-video-segment merge coming in a follow-up. Use Preview to confirm the photo sequencing.'
          : 'Need at least 2 videos to merge.')
      }
      const clips = []
      for (let i = 0; i < videoOnly.length; i++) {
        const item = videoOnly[i]
        let uploadKey = item.uploadResult?.original_temp_path || null
        if (!uploadKey) {
          setProgress(`Uploading clip ${i + 1}/${videoOnly.length} (${item.file?.name || item._filename || 'Untitled'})...`)
          try {
            const result = await api.uploadFile(item.file, null, null, {}, null, jobId)
            item.uploadResult = result
            uploadKey = result.original_temp_path
          } catch (e) {
            throw new Error(`Upload clip ${i + 1} failed: ${e.message}`)
          }
        } else {
          setProgress(`Preparing clip ${i + 1}/${videoOnly.length} (${item.file?.name || item._filename || 'Untitled'})...`)
        }
        clips.push({
          upload_key: uploadKey,
          trim_start: item._trimStart || 0,
          trim_end: item._trimEnd ?? null,
          speed: Number(item._speed) > 0 ? Number(item._speed) : 1.0,
        })
      }
      if (photoCount > 0) {
        console.warn(`[merge] ${photoCount} photo(s) excluded from server merge (video-only for now)`)
      }
      setProgress(`Merging ${clips.length} clips on server...`)
      // mergeVideos now returns a blob URL directly (binary response, not JSON)
      const url = await api.mergeVideos(clips, transition, transDuration, jobId)

      // Read blob for save button
      const resp = await fetch(url)
      const blob = await resp.blob()
      mergedBlobRef.current = blob

      if (mergedUrl) URL.revokeObjectURL(mergedUrl)
      setMergedUrl(url)
      setProgress('')

      // Notify parent so it can use the merged video in the post flow
      if (onMerged) onMerged({ blob, url })
    } catch (err) {
      setError(err.message)
      setProgress('')
    }
    // Real merge takes over — drop the preview playlist so the preview
    // badge disappears and the authoritative "Merged" render shows.
    clearPreviewMerge()
    setMerging(false)
  }

  const handleSave = async () => {
    // If we have no blob ref (e.g. resumed draft), fetch it from the URL
    let blob = mergedBlobRef.current
    if (!blob && mergedUrl) {
      try {
        const resp = await fetch(mergedUrl)
        blob = await resp.blob()
        mergedBlobRef.current = blob
      } catch (e) {
        alert('Failed to load merged video: ' + e.message)
        return
      }
    }
    if (!blob) return
    // Prefer the job name for the download filename so desktop saves are
    // meaningful; fall back to the first clip's filename, then a generic.
    const jobNamed = videoFiles.find(f => f.job_name)
    const filename = buildDownloadName(jobNamed || videoFiles[0] || {}, 'merged', 'mp4')
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '')
    if (isMobile) {
      try {
        const file = new File([blob], filename, { type: 'video/mp4' })
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: filename })
          return
        }
      } catch (e) {
        if (e.name === 'AbortError') return
      }
    }
    // Desktop: classic save-as dialog
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  return (
    <div className="bg-white border border-[#6C5CE7]/30 rounded-sm p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-[11px] font-medium text-ink flex-1">Merge videos</div>
        {/* Collapse toggle — appears only once a merge exists so users
            can focus on the final video. */}
        {mergedUrl && (
          <button
            type="button"
            onClick={() => setClipsCollapsed(c => !c)}
            className="text-[10px] text-muted hover:text-ink bg-transparent border-none cursor-pointer"
          >{clipsCollapsed ? `Show ${videoFiles.length} clip${videoFiles.length === 1 ? '' : 's'} ▼` : 'Hide clips ▲'}</button>
        )}
      </div>

      {/* Clip order — hidden when collapsed after a merge, always visible
          before merge exists. */}
      {!clipsCollapsed && <div className="space-y-1">
        {(() => {
          // Per-item detection: photos contribute their display duration;
          // videos contribute (trim_end - trim_start) / speed.
          const isPhoto = (item) => item?.isImg || item?.file?.type?.startsWith('image/') || item?._mediaType?.startsWith('image/')

          const clipTrimLengths = videoFiles.map(item => {
            if (isPhoto(item)) {
              // Photo "trim" == display duration. Defaults to 5s when unset.
              return item._trimEnd != null && item._trimEnd > 0 ? Number(item._trimEnd) : 5
            }
            const dur = item?._videoDuration || 0
            if (!dur) return 0
            const ts = item._trimStart || 0
            const te = item._trimEnd ?? dur
            return Math.max(0, te - ts)
          })
          const clipDurations = videoFiles.map((item, i) => {
            const trimLen = clipTrimLengths[i]
            if (isPhoto(item)) return trimLen
            const speed = Number(item?._speed) > 0 ? Number(item._speed) : 1.0
            return trimLen / speed
          })
          const totalKept = clipDurations.reduce((a, b) => a + b, 0)
          const hasPhotos = videoFiles.some(isPhoto)
          // Detect filename collisions (iPhone recycles IMG_####.mov numbers
          // when the Photos counter rolls over — two different clips can
          // share the same filename, making the merge list ambiguous).
          // Build a map of basename → positional index so we can append
          // "(1)" / "(2)" / etc. to disambiguate in the display.
          const nameCounts = {}
          videoFiles.forEach(item => {
            const n = item?.file?.name || item?._filename || 'Untitled'
            nameCounts[n] = (nameCounts[n] || 0) + 1
          })
          const seenCount = {}
          const disambiguatedNames = videoFiles.map(item => {
            const n = item?.file?.name || item?._filename || 'Untitled'
            if (nameCounts[n] > 1) {
              seenCount[n] = (seenCount[n] || 0) + 1
              return `${n} (${seenCount[n]})`
            }
            return n
          })
          const transOverhead = transition !== 'none' && videoFiles.length > 1
            ? (videoFiles.length - 1) * transDuration
            : 0
          const finalTotal = Math.max(0, totalKept - transOverhead)
          const sortableIds = videoFiles.map(f => f.id)
          return (
            <>
              <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {videoFiles.map((item, pos) => {
                if (!item) return null
                const itemIsPhoto = isPhoto(item)
                const ts = item._trimStart || 0
                const te = item._trimEnd
                const trimLen = clipTrimLengths[pos]
                const outLen = clipDurations[pos]
                const speed = Number(item._speed) > 0 ? Number(item._speed) : 1.0
                const displayName = disambiguatedNames[pos]
                const thumb = itemIsPhoto
                  ? (item.file instanceof Blob ? (item._imgThumb ||= URL.createObjectURL(item.file)) : (item._publicUrl || null))
                  : (Array.isArray(item._trimThumbs) && item._trimThumbs[0] ? item._trimThumbs[0] : null)
                const size = item.file?.size
                const sizeLabel = size ? `${(size / (1024 * 1024)).toFixed(1)}M` : null
                return (
                  <SortableClipRow key={item.id} id={item.id}>
                    {({ setNodeRef, style, attributes, handleListeners }) => (
                  <div
                    ref={setNodeRef}
                    style={style}
                    {...attributes}
                    className="flex gap-2 bg-cream rounded px-2 py-1.5 text-[10px]"
                  >
                    {/* Drag handle — the ONLY element with drag listeners,
                        so taps on the rest of the row still work normally. */}
                    <span
                      {...handleListeners}
                      className="text-muted hover:text-ink cursor-grab active:cursor-grabbing select-none text-[14px] leading-none px-0.5 flex items-center"
                      style={{ touchAction: 'none' }}
                      title="Drag to reorder"
                    >⋮⋮</span>
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        className="w-7 h-10 object-cover rounded flex-shrink-0 border border-border self-start"
                        style={{ objectFit: 'cover' }}
                      />
                    ) : (
                      <div className="w-7 h-10 bg-[#e5e5e5] rounded flex-shrink-0 flex items-center justify-center text-[8px] text-muted self-start" title="Thumbnail appears after video loads">—</div>
                    )}
                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                      {/* Line 1 — always visible filename with position prefix */}
                      <div className="text-[11px] font-medium text-ink truncate" title={displayName}>
                        <span className="text-muted mr-1">{pos + 1}.</span>
                        {displayName}
                      </div>
                      {/* Line 2 — meta + controls */}
                      <div className="flex items-center gap-1.5 flex-wrap text-[9px] text-muted">
                        {outLen > 0 && (
                          speed !== 1.0 ? (
                            <span className="whitespace-nowrap" title={`Trim: ${trimLen.toFixed(1)}s · Output at ${speed}×: ${outLen.toFixed(1)}s`}>
                              {trimLen.toFixed(1)}s → <b className="text-ink">{outLen.toFixed(1)}s</b>
                            </span>
                          ) : (
                            <span className="whitespace-nowrap" title="Output length">{outLen.toFixed(1)}s</span>
                          )
                        )}
                        {sizeLabel && <span className="text-muted">· {sizeLabel}</span>}
                        {(ts > 0 || te != null) && (
                          <span className="text-[#d97706]">trimmed</span>
                        )}
                        <div className="flex-1" />
                    {itemIsPhoto ? (
                      // Photo: single "display duration" input. trim_end
                      // doubles as the duration in seconds; defaults to 5.
                      <label className="flex items-center gap-0.5" title="How long the photo stays on screen in the merged video.">
                        <span className="text-[9px] text-muted">Show:</span>
                        <input
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={Number(item._trimEnd) > 0 ? item._trimEnd : 5}
                          onChange={e => {
                            const next = Math.max(0.5, Number(e.target.value) || 5)
                            item._trimEnd = next
                            try { window.dispatchEvent(new CustomEvent('posty-speed-change', { detail: { itemId: item.id } })) } catch {}
                            if (mergedUrl) {
                              try { URL.revokeObjectURL(mergedUrl) } catch {}
                              setMergedUrl(null)
                              mergedBlobRef.current = null
                              window._postyMergedVideo = null
                            }
                          }}
                          className="text-[9px] border border-border rounded py-0 px-1 bg-white w-10"
                        />
                        <span className="text-[9px] text-muted">s</span>
                      </label>
                    ) : (
                      <label className="flex items-center gap-0.5" title="Playback speed for this clip. Applied after trim.">
                        <span className="text-[9px] text-muted">Speed:</span>
                        <select
                          value={String(speed)}
                          onChange={e => {
                            const newSpeed = Number(e.target.value)
                            if (!(newSpeed > 0)) return
                            item._speed = newSpeed
                            try { window.dispatchEvent(new CustomEvent('posty-speed-change', { detail: { itemId: item.id } })) } catch {}
                            if (mergedUrl) {
                              try { URL.revokeObjectURL(mergedUrl) } catch {}
                              setMergedUrl(null)
                              mergedBlobRef.current = null
                              window._postyMergedVideo = null
                            }
                          }}
                          className="text-[9px] border border-border rounded py-0 px-0.5 bg-white"
                        >
                          <option value="0.25">0.25×</option>
                          <option value="0.5">0.5×</option>
                          <option value="0.75">0.75×</option>
                          <option value="1">1×</option>
                          <option value="1.25">1.25×</option>
                          <option value="1.5">1.5×</option>
                          <option value="2">2×</option>
                          <option value="3">3×</option>
                          <option value="4">4×</option>
                        </select>
                      </label>
                    )}
                    <div className="flex gap-0.5">
                      <button
                        onClick={() => moveUp(pos)}
                        disabled={pos === 0}
                        className="text-[10px] text-muted hover:text-ink disabled:opacity-30 bg-transparent border-none cursor-pointer px-1"
                      >&#9650;</button>
                      <button
                        onClick={() => moveDown(pos)}
                        disabled={pos === videoFiles.length - 1}
                        className="text-[10px] text-muted hover:text-ink disabled:opacity-30 bg-transparent border-none cursor-pointer px-1"
                      >&#9660;</button>
                    </div>
                      </div>
                    </div>
                  </div>
                    )}
                  </SortableClipRow>
                )
              })}
                </SortableContext>
              </DndContext>
              {totalKept > 0 && (
                <div className="flex items-center gap-2 px-2 py-1 text-[10px] border-t border-border/50 mt-1 pt-1.5">
                  <span className="text-muted flex-1">Total merged length</span>
                  <span className="font-medium text-ink">{finalTotal.toFixed(1)}s</span>
                  {transOverhead > 0 && (
                    <span className="text-[9px] text-muted whitespace-nowrap">({totalKept.toFixed(1)}s − {transOverhead.toFixed(1)}s transitions)</span>
                  )}
                </div>
              )}
            </>
          )
        })()}
      </div>}

      {/* Transition picker */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-[10px] text-muted">Transition:</label>
        <select
          value={transition}
          onChange={e => setTransition(e.target.value)}
          className="text-[10px] border border-border rounded py-0.5 px-1.5 bg-white"
        >
          {TRANSITIONS.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        {transition !== 'none' && (
          <>
            <label className="text-[10px] text-muted">Duration:</label>
            <select
              value={transDuration}
              onChange={e => setTransDuration(Number(e.target.value))}
              className="text-[10px] border border-border rounded py-0.5 px-1.5 bg-white"
            >
              <option value={0.5}>0.5s</option>
              <option value={1}>1s</option>
              <option value={1.5}>1.5s</option>
              <option value={2}>2s</option>
            </select>
          </>
        )}
      </div>

      {/* Merge buttons — fast preview vs authoritative render */}
      <div className="flex gap-1.5">
        <button
          onClick={handlePreviewMerge}
          disabled={merging}
          className="flex-1 text-[11px] py-2 border border-[#d97706] rounded bg-white text-[#d97706] cursor-pointer font-sans font-medium hover:bg-[#fef3c7] disabled:opacity-50"
          title="Play clips in order using current trims + speed. No server call, no ffmpeg, no overlays / voiceover. Good for checking pacing before committing to a real merge."
        >
          ▶ Preview (fast)
        </button>
        <button
          onClick={handleMerge}
          disabled={merging}
          className="flex-1 text-[11px] py-2 border border-[#6C5CE7] rounded bg-[#6C5CE7] text-white cursor-pointer font-sans font-medium hover:bg-[#5a4bd6] disabled:opacity-50"
        >
          {merging ? (progress || 'Merging...') : mergedUrl ? 'Re-merge' : `Merge ${videoFiles.length} clips`}
        </button>
      </div>
      <div className="text-[9px] text-muted italic">
        Preview = hard-cut playthrough (no transitions, no voiceover). Merge = authoritative render that gets posted.
      </div>

      {error && (
        <p className="text-[10px] text-[#c0392b]">{error}</p>
      )}

      {/* Merged preview */}
      {mergedUrl && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-ink">Merged result:</div>
          <div className="relative rounded border border-border overflow-hidden bg-black" style={{ maxHeight: 300 }}>
            <video
              src={mergedUrl}
              controls
              playsInline
              muted
              className="w-full max-h-[300px] object-contain"
            />
          </div>
          <button
            onClick={handleSave}
            className="w-full text-[10px] py-1.5 border border-[#2D9A5E] text-[#2D9A5E] rounded bg-white cursor-pointer font-sans hover:bg-[#f0faf4]"
          >
            Save merged video
          </button>
        </div>
      )}

      {previewPlaylist && (
        <MergePreviewLightbox
          playlist={previewPlaylist}
          onClose={clearPreviewMerge}
        />
      )}
    </div>
  )
}
