import { useState, useRef, useEffect } from 'react'
import { buildDownloadName } from '../lib/filename'
import MergePreviewLightbox from './MergePreviewLightbox'
import { PhotoDurationControl, PhotoMotionControl } from './PhotoDurationBar'
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
export default function VideoMerge({ videoFiles, jobId, onMerged, onReorder, restoredMergeUrl, onSaveTrim, onSaveMotion, onDuplicate, onRemove }) {
  // The merge list now uses the natural order of videoFiles so reordering here
  // flows back to the file grid + voiceover preview. onReorder(fromIdx, toIdx)
  // is implemented by App.jsx and persists the new order to the server.
  const [transition, setTransition] = useState('crossfade')
  const [transDuration, setTransDuration] = useState(1)
  // Job-wide playback speed. Same preset values as the per-clip
  // selector. Multiplied INTO each clip's speed on the server at
  // merge time. Gated OFF when music is attached (re-rendering at a
  // different speed would desync the music cuts).
  const [globalSpeed, setGlobalSpeed] = useState(1)
  const [musicAttached, setMusicAttached] = useState(false)
  // Track whether we've hydrated transition + transDuration from the
  // job's saved merge_settings yet. Without this gate the auto-save
  // effect below would fire on the initial mount with the default
  // values BEFORE we've heard back from the job, overwriting the
  // saved choice with 'crossfade' on every reload.
  const transitionHydrated = useRef(false)
  const [merging, setMerging] = useState(false)
  const [progress, setProgress] = useState('')
  // Local state for the "Clear music effects" button — busy spinner,
  // post-clear ✓ flash, and error surface. Mirrors the same button
  // on the Music tab so operators have one-click access from either
  // place to reset the per-job music_*_loops / music_beat_zoom_all /
  // music_loop_color_effect flags + leftover loop-duplicate rows.
  const [clearingMusic, setClearingMusic] = useState(false)
  const [musicClearedAt, setMusicClearedAt] = useState(null)
  const [musicClearError, setMusicClearError] = useState(null)
  // Broadcast progress + busy state so the music-panel's
  // Re-merge button can mirror the current step. Without this,
  // operators clicking the music-panel button see no feedback
  // until the merge completes (or fails).
  useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('posty-merge-progress', { detail: { message: progress, busy: merging } })) } catch {}
  }, [progress, merging])
  const [mergedUrl, setMergedUrl] = useState(() => restoredMergeUrl || window._postyMergedVideo?.url || null)
  const [error, setError] = useState(null)
  const mergedBlobRef = useRef(window._postyMergedVideo?.blob || null)

  // Pick up restored merge URL when it arrives after mount
  useEffect(() => {
    if (restoredMergeUrl && !mergedUrl) setMergedUrl(restoredMergeUrl)
  }, [restoredMergeUrl])

  // Hydrate transition + transDuration from the job's saved
  // merge_settings on mount (and whenever jobId changes). Without
  // this, the merge type defaulted to 'crossfade' on every reopen
  // even after the user picked 'none' and merged.
  //
  // Critical: re-close the hydration gate at the START of each new
  // jobId so the auto-save effect can't fire the default 'crossfade'
  // before getJob returns. Without the reset, a mount sequence of
  // jobId=undefined → uuid would auto-save the default value back
  // over the saved one before hydration finished.
  useEffect(() => {
    transitionHydrated.current = false
    if (!jobId) return
    let cancelled = false
    import('../api').then(api => {
      api.getJob(jobId).then(job => {
        if (cancelled) return
        const ms = job?.merge_settings || {}
        if (typeof ms.transition === 'string') setTransition(ms.transition)
        if (Number.isFinite(Number(ms.transitionDuration))) {
          setTransDuration(Number(ms.transitionDuration))
        }
        const gr = job?.generation_rules || {}
        const gs = Number(gr.global_speed)
        if (Number.isFinite(gs) && gs > 0) setGlobalSpeed(gs)
        setMusicAttached(!!job?.music_track_key)
        transitionHydrated.current = true
      }).catch(() => { transitionHydrated.current = true })
    })
    return () => { cancelled = true }
  }, [jobId])

  // Re-read music_track_key when something else (the Music panel)
  // attaches or detaches music. Without this the global-speed gate
  // would stay stuck at its initial value until the page reloaded.
  useEffect(() => {
    if (!jobId) return
    const onMusicChange = () => {
      import('../api').then(api => {
        api.getJob(jobId).then(job => {
          setMusicAttached(!!job?.music_track_key)
        }).catch(() => {})
      })
    }
    window.addEventListener('posty-music-change', onMusicChange)
    return () => window.removeEventListener('posty-music-change', onMusicChange)
  }, [jobId])

  // Auto-save on change. Debounced so dragging the duration slider
  // doesn't fire 60 PUTs. Skipped until the hydrate effect above has
  // committed so we don't overwrite the saved value with the
  // useState default on first render.
  useEffect(() => {
    if (!jobId || !transitionHydrated.current) return
    const t = setTimeout(() => {
      import('../api').then(api => {
        api.updateJob(jobId, {
          merge_settings: {
            transition,
            transitionDuration: Number(transDuration) || 1,
          },
        }).catch(e => console.warn('[VideoMerge] save merge_settings failed:', e?.message))
      })
    }, 600)
    return () => clearTimeout(t)
  }, [jobId, transition, transDuration])

  // Re-render when any item's duration becomes known (from VideoTrimmer) OR
  // when the user commits a new trim range. Both are mutations React can't
  // observe, so we bump a counter to force re-render.
  const [, setDurTick] = useState(0)
  useEffect(() => {
    const bump = () => setDurTick(t => t + 1)
    window.addEventListener('posty-video-duration', bump)
    window.addEventListener('posty-trim-change', bump)
    // Force re-render when an insert/overlay change fires — controlled
    // component values (selects, time inputs) need React to see the
    // mutation or the visual reverts. Same trick as the trim/duration
    // listeners.
    window.addEventListener('posty-insert-overlay-change', bump)
    window.addEventListener('posty-speed-change', bump)
    window.addEventListener('posty-volume-change', bump)
    return () => {
      window.removeEventListener('posty-video-duration', bump)
      window.removeEventListener('posty-trim-change', bump)
      window.removeEventListener('posty-insert-overlay-change', bump)
      window.removeEventListener('posty-speed-change', bump)
      window.removeEventListener('posty-volume-change', bump)
    }
  }, [])

  // Listen for an external trigger (the producer's Apply & generate
  // flow fires this after media changes). Re-runs handleMerge with
  // the current videoFiles, then dispatches posty-merge-complete with
  // ok/err so the caller can await the result.
  const handleMergeRef = useRef(null)
  useEffect(() => {
    const onTrigger = async (ev) => {
      try {
        const fn = handleMergeRef.current
        if (!fn) {
          window.dispatchEvent(new CustomEvent('posty-merge-complete', { detail: { ok: false, error: 'merge handler not ready' } }))
          return
        }
        await fn()
        window.dispatchEvent(new CustomEvent('posty-merge-complete', { detail: { ok: true } }))
      } catch (e) {
        window.dispatchEvent(new CustomEvent('posty-merge-complete', { detail: { ok: false, error: e?.message || String(e) } }))
      }
    }
    window.addEventListener('posty-trigger-merge', onTrigger)
    return () => window.removeEventListener('posty-trigger-merge', onTrigger)
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
      return {
        id: item.id,
        type: 'photo',
        url,
        filename,
        trimEnd: duration,
        // Motion + base zoom + rotate + pan so the lightbox can
        // apply the same transform the BE export will burn in.
        motion: item._photoMotion || 'zoom-in',
        zoom: Number(item._photoZoom) > 0 ? Number(item._photoZoom) : 1.0,
        rotate: Number.isFinite(Number(item._photoRotate)) ? Number(item._photoRotate) : 0,
        offsetX: Number.isFinite(Number(item._photoOffsetX)) ? Number(item._photoOffsetX) : 0,
        offsetY: Number.isFinite(Number(item._photoOffsetY)) ? Number(item._photoOffsetY) : 0,
      }
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
    // Build a host-only sequential playlist, but attach each host's
    // B-roll inserts as a sub-array so the lightbox can swap a
    // second video element on top of the host at the right OUTPUT
    // time. Inserts never sit in the main play order — they layer
    // onto their host's timeline and the lightbox handles the
    // z-stack swap.
    const items = videoFiles || []
    const hostsOnly = items.filter(it => it && it._insertIntoFileId == null)
    const isPhoto = it => it?.isImg || it?.file?.type?.startsWith('image/') || it?._mediaType?.startsWith('image/')
    const playlist = hostsOnly.map(host => {
      const baseEntry = itemToPlaylistEntry(host)
      if (!baseEntry || baseEntry.type !== 'video') return baseEntry
      // Find inserts whose host db id matches this host's, in the
      // order they appear in the file list (deterministic).
      const inserts = items
        .filter(it => it && it._insertIntoFileId != null && it._insertIntoFileId === host._dbFileId)
        .map(ins => {
          const insEntry = itemToPlaylistEntry(ins)
          if (!insEntry || !insEntry.url) return null
          const insIsPhoto = isPhoto(ins) || insEntry.type === 'image'
          // For photo inserts, outDur comes from the photo's display
          // duration (trim_end on photo clips = display seconds, same
          // contract as sequential photos). Default 5s. For video
          // inserts, outDur is trim_length / speed.
          let outDur
          if (insIsPhoto) {
            outDur = Number(ins._trimEnd) > 0 ? Number(ins._trimEnd) : 5
          } else {
            const trimLen = insEntry.trimEnd != null && insEntry.trimEnd > 0
              ? Math.max(0.1, insEntry.trimEnd - (insEntry.trimStart || 0))
              : null
            outDur = trimLen != null ? trimLen / (insEntry.speed || 1.0) : null
          }
          return {
            id: insEntry.id,
            url: insEntry.url,
            filename: insEntry.filename,
            // type lets the lightbox render <img> for photos and
            // <video> for videos. Without this, image inserts would
            // be fed to a <video> element and never display.
            type: insIsPhoto ? 'image' : 'video',
            // Photo motion (Ken Burns) for the preview to animate via
            // the Web Animations API. The BE photoToVideo pass uses
            // this same value to render the equivalent motion in the
            // exported mp4 — so preview and export look the same.
            motion: insIsPhoto ? (ins._photoMotion || 'zoom-in') : null,
            // Per-photo base zoom (1.0–5.0). Multiplied into the
            // motion keyframes so a 1.5× starting size shrinks into
            // ~1.5×→1.77× (zoom-in) instead of 1.0×→1.18×.
            zoom: insIsPhoto ? (Number(ins._photoZoom) > 0 ? Number(ins._photoZoom) : 1.0) : 1.0,
            // Per-photo rotation (degrees). Composed onto the
            // transform alongside scale so the photo rotates with
            // its zoom intact.
            rotate: insIsPhoto ? (Number.isFinite(Number(ins._photoRotate)) ? Number(ins._photoRotate) : 0) : 0,
            // Per-photo X/Y pan. The lightbox composes translate(
            // X%, Y%) into the keyframes so the preview matches
            // the BE crop shift.
            offsetX: insIsPhoto ? (Number.isFinite(Number(ins._photoOffsetX)) ? Number(ins._photoOffsetX) : 0) : 0,
            offsetY: insIsPhoto ? (Number.isFinite(Number(ins._photoOffsetY)) ? Number(ins._photoOffsetY) : 0) : 0,
            trimStart: insEntry.trimStart || 0,
            trimEnd: insEntry.trimEnd,
            speed: insIsPhoto ? 1.0 : (insEntry.speed || 1.0),
            atSec: Number(ins._insertAtSec) >= 0 ? Number(ins._insertAtSec) : 0,
            outDur, // null = play to natural end of insert (ffmpeg eof_action=pass)
          }
        })
        .filter(Boolean)
        .sort((a, b) => a.atSec - b.atSec)
      return { ...baseEntry, inserts }
    }).filter(c => c && c.url)
    if (playlist.length === 0) { setError('Nothing to preview — no media with a usable URL.'); return }
    setError(null)
    setPreviewPlaylist(playlist)
  }

  const clearPreviewMerge = () => setPreviewPlaylist(null)

  const handleMerge = async () => {
    setMerging(true)
    setError(null)
    // Broadcast busy state so the Download Final button (and any
    // other downstream consumer) can disable itself while a merge is
    // in flight. Mirrored on every exit path below via setMerging(false).
    try { window.dispatchEvent(new CustomEvent('posty-merge-busy', { detail: { busy: true } })) } catch {}
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
      const isPhotoItem = (i) => i?.isImg || i?.file?.type?.startsWith('image/') || i?._mediaType?.startsWith('image/')
      // Single-clip "merge" is allowed — it normalizes the upload
      // (re-encode to 1080×1920 H.264, applies trim, and produces
      // the merged_video_key the rest of the pipeline keys off).
      // Without this path, a one-video draft was stuck with no way
      // to apply trim and feed downstream tabs.
      if (videoFiles.length < 1) {
        throw new Error('Need at least one clip to process.')
      }
      // Filter out clips the user toggled "skip" on, plus any clip
      // whose source file is missing from storage (BE flagged or FE
      // detected via <video>/<img> onError) — sending those would
      // produce "Clip N: no media data" on the server. Stays in the
      // job (loaded from job_files.skip_in_merge) but doesn't get
      // sent to /merge-videos. If a host with attached B-roll
      // inserts is skipped, its inserts have no host left to attach
      // to and would be dropped by the BE anyway — drop them here
      // too so the counts in the progress bar match what the BE
      // actually merges.
      const activeFiles = videoFiles.filter(f => !f?._skipInMerge && !f?._storageMissing)
      const skippedHostDbIds = new Set(
        videoFiles
          .filter(f => f?._skipInMerge && f._insertIntoFileId == null && f._dbFileId != null)
          .map(f => f._dbFileId)
      )
      const mergeFiles = activeFiles.filter(f => {
        if (f?._insertIntoFileId != null && skippedHostDbIds.has(f._insertIntoFileId)) return false
        return true
      })
      if (mergeFiles.length < 1) {
        throw new Error('All clips are skipped — un-skip at least one to merge.')
      }
      if (mergeFiles.length < videoFiles.length) {
        console.log(`[merge] excluding ${videoFiles.length - mergeFiles.length} skipped clip(s) from payload`)
      }
      const clips = []
      for (let i = 0; i < mergeFiles.length; i++) {
        const item = mergeFiles[i]
        const photo = isPhotoItem(item)
        const niceName = item.file?.name || item._filename || 'Untitled'
        let uploadKey = item.uploadResult?.original_temp_path || null
        if (!uploadKey) {
          setProgress(`Uploading clip ${i + 1}/${mergeFiles.length} (${niceName})...`)
          try {
            const result = await api.uploadFile(item.file, null, null, {}, null, jobId)
            item.uploadResult = result
            uploadKey = result.original_temp_path
          } catch (e) {
            throw new Error(`Upload clip ${i + 1} failed: ${e.message}`)
          }
        } else {
          setProgress(`Preparing clip ${i + 1}/${mergeFiles.length} (${niceName})...`)
        }
        if (photo) {
          // Photo clip — trim_end is the display duration; motion
          // drives the Ken Burns effect the backend applies. When
          // the photo is configured as an insert (overlay onto a
          // video host), include insert_host_idx + insert_at_sec
          // so the BE converts it to a video segment AND treats it
          // as an insert rather than a sequential clip.
          let photoInsertHostIdx = null
          if (item._insertIntoFileId != null) {
            let hostCount = 0
            // Walk mergeFiles (post-skip filter) so the index lines up
            // with the BE's hosts-only list — videoFiles would
            // include skipped clips and shift the index.
            for (const f of mergeFiles) {
              if (!f) continue
              const isInsert = f._insertIntoFileId != null
              if (f._dbFileId === item._insertIntoFileId && !isInsert) {
                photoInsertHostIdx = hostCount
                break
              }
              if (!isInsert) hostCount++
            }
          }
          clips.push({
            upload_key: uploadKey,
            media_type: item.file?.type || item._mediaType || 'image/jpeg',
            trim_end: Number(item._trimEnd) > 0 ? Number(item._trimEnd) : 5,
            photo_to_video_motion: item._photoMotion || 'zoom-in',
            photo_to_video_zoom: Number(item._photoZoom) > 0 ? Number(item._photoZoom) : 1.0,
            photo_to_video_rotate: Number.isFinite(Number(item._photoRotate)) ? Number(item._photoRotate) : 0,
            photo_to_video_offset_x: Number.isFinite(Number(item._photoOffsetX)) ? Number(item._photoOffsetX) : 0,
            photo_to_video_offset_y: Number.isFinite(Number(item._photoOffsetY)) ? Number(item._photoOffsetY) : 0,
            insert_host_idx: photoInsertHostIdx,
            insert_at_sec: Number(item._insertAtSec) >= 0 ? Number(item._insertAtSec) : 0,
          })
        } else {
          // Compute insertHostIdx for the BE — the FE persists
          // _insertIntoFileId (BE job_files.id) but the merge route
          // expects an INDEX into the hosts-only timeline. Walk the
          // file list, count hosts before the referenced one, and
          // pass that index. null when this clip is sequential.
          let insertHostIdx = null
          if (item._insertIntoFileId != null) {
            let hostCount = 0
            // Same as the photo branch: walk the post-skip set so
            // host indices match the BE's hosts-only list.
            for (const f of mergeFiles) {
              if (!f) continue
              const isInsert = f._insertIntoFileId != null
              if (f._dbFileId === item._insertIntoFileId && !isInsert) {
                insertHostIdx = hostCount
                break
              }
              if (!isInsert) hostCount++
            }
          }
          clips.push({
            upload_key: uploadKey,
            media_type: item.file?.type || item._mediaType || 'video/mp4',
            trim_start: item._trimStart || 0,
            trim_end: item._trimEnd ?? null,
            speed: Number(item._speed) > 0 ? Number(item._speed) : 1.0,
            // Per-clip audio volume. 1 = original; > 1 boosts quiet
            // source audio so it isn't drowned out by TTS / music
            // in the final mix. 0 = mute.
            volume: Number.isFinite(Number(item._volume)) && Number(item._volume) >= 0
              ? Number(item._volume) : 1.0,
            // Static crop zoom on the video clip + anchor offsets.
            // 1.0 = no zoom. offsets in [-100, +100] percent (0 = center).
            video_zoom: Number(item._videoZoom) > 0 ? Number(item._videoZoom) : 1.0,
            video_offset_x: Number.isFinite(Number(item._videoOffsetX)) ? Number(item._videoOffsetX) : 0,
            video_offset_y: Number.isFinite(Number(item._videoOffsetY)) ? Number(item._videoOffsetY) : 0,
            // Ken Burns motion. 'static' is the no-animation default;
            // other values mirror the photo motion set and trigger the
            // BE animated crop expression in lib/video.mergeVideos().
            video_motion: typeof item._videoMotion === 'string' && item._videoMotion ? item._videoMotion : 'static',
            // Freeze-frame effect. When true, BE replaces the moving
            // video with a still frame at trim_start held for the
            // trim window's duration. Ignored when this clip is
            // also routed as an insert (insert overlays use their
            // host's timing, freeze isn't meaningful there).
            freeze_frame: !!item._freezeFrame,
            // Effect stack — all skipped on the BE when
            // freeze_frame is true (freeze precedence), except
            // mirror + color which compose with a still.
            reverse_play: !!item._reversePlay,
            mirror_flip:  !!item._mirrorFlip,
            color_effect: item._colorEffect || null,
            strobe:       !!item._strobe,
            beat_zoom:    !!item._beatZoom,
            // B-roll insert overlay. When insert_host_idx is set, the
            // BE places this clip's video on top of that host clip at
            // insert_at_sec; the host's audio plays through unchanged.
            insert_host_idx: insertHostIdx,
            insert_at_sec: Number(item._insertAtSec) >= 0 ? Number(item._insertAtSec) : 0,
          })
        }
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
    try { window.dispatchEvent(new CustomEvent('posty-merge-busy', { detail: { busy: false } })) } catch {}
  }

  // Keep the ref pointing at the latest handleMerge closure so the
  // posty-trigger-merge listener always invokes a function that sees
  // current videoFiles/transition props instead of a stale capture.
  handleMergeRef.current = handleMerge

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
          // Inserts (B-roll overlays) don't add length to the merged
          // video — they're placed INSIDE a host clip's timeline. Sum
          // hosts only for the "Total kept" display.
          const totalKept = videoFiles.reduce((acc, item, i) => {
            if (item && item._insertIntoFileId != null) return acc
            return acc + clipDurations[i]
          }, 0)
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
                      <div className="text-[11px] font-medium text-ink truncate flex items-center gap-1.5" title={item._dbFileId != null ? `${displayName} · clip-${item._dbFileId}` : displayName}>
                        <span className="text-muted">{pos + 1}.</span>
                        <span className="truncate">{displayName}</span>
                        {item._dbFileId != null && (
                          <span className="text-[9px] text-[#6C5CE7]/80 font-mono flex-shrink-0">clip-{item._dbFileId}</span>
                        )}
                        {itemIsPhoto && (
                          <span className="text-[9px] bg-[#6C5CE7]/10 text-[#6C5CE7] rounded-full px-1.5 py-0 font-medium flex-shrink-0">PHOTO</span>
                        )}
                      </div>

                      {/* Line 2 — meta */}
                      <div className="flex items-center gap-1.5 flex-wrap text-[9px] text-muted">
                        {outLen > 0 && (
                          speed !== 1.0 && !itemIsPhoto ? (
                            <span className="whitespace-nowrap" title={`Trim: ${trimLen.toFixed(1)}s · Output at ${speed}×: ${outLen.toFixed(1)}s`}>
                              {trimLen.toFixed(1)}s → <b className="text-ink">{outLen.toFixed(1)}s</b>
                            </span>
                          ) : (
                            <span className="whitespace-nowrap" title={itemIsPhoto ? 'Photo display duration' : 'Output length'}>{outLen.toFixed(1)}s</span>
                          )
                        )}
                        {sizeLabel && <span className="text-muted">· {sizeLabel}</span>}
                        {!itemIsPhoto && (ts > 0 || te != null) && (
                          <span className="text-[#d97706]">trimmed</span>
                        )}
                        <div className="flex-1" />
                        {/* InsertOverlayControl renders for BOTH videos
                            and photos. A photo as an insert overlays
                            its still image on top of the host video
                            for the photo's duration while the host's
                            audio keeps playing. The candidate hosts
                            list inside the control is filtered to
                            videos only — only video clips have audio
                            for the insert to layer on. */}
                        <InsertOverlayControl
                          item={item}
                          allItems={videoFiles}
                          onChange={() => {
                            if (mergedUrl) {
                              try { URL.revokeObjectURL(mergedUrl) } catch {}
                              setMergedUrl(null)
                              mergedBlobRef.current = null
                              window._postyMergedVideo = null
                            }
                          }}
                        />
                        {!itemIsPhoto && (
                          <label
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer ${
                              speed !== 1
                                ? 'bg-[#fff7ed] border-[#d97706]/50 text-[#d97706] font-medium'
                                : 'bg-white border-border text-muted'
                            }`}
                            title={speed !== 1
                              ? `This clip will play at ${speed}× — applied during merge.`
                              : 'Playback speed. Slow down (0.25×–0.75×) or speed up (1.25×–4×). Applied during merge.'}
                          >
                            <span className="text-[10px]">{speed !== 1 ? `${speed}×` : 'Speed'}</span>
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
                              className="text-[10px] border-none bg-transparent cursor-pointer outline-none"
                            >
                              <option value="0.25">0.25×</option>
                              <option value="0.5">0.5×</option>
                              <option value="0.75">0.75×</option>
                              <option value="0.9">0.9×</option>
                              <option value="1">1×</option>
                              <option value="1.1">1.1×</option>
                              <option value="1.25">1.25×</option>
                              <option value="1.5">1.5×</option>
                              <option value="2">2×</option>
                              <option value="3">3×</option>
                              <option value="4">4×</option>
                            </select>
                          </label>
                        )}
                        {/* Per-clip volume. Useful when the original
                            audio is quieter than the TTS voiceover or
                            music bed — boost here so the final mix is
                            balanced. 1 = original, 0 = mute, > 1
                            boosts (2 = +6dB, 4 = +12dB). */}
                        {!itemIsPhoto && (() => {
                          const volume = Number.isFinite(Number(item._volume)) && Number(item._volume) >= 0
                            ? Number(item._volume) : 1.0
                          const changed = Math.abs(volume - 1.0) > 0.001
                          return (
                            <label
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer ${
                                changed
                                  ? 'bg-[#ecfeff] border-[#0891b2]/60 text-[#0e7490] font-medium'
                                  : 'bg-white border-border text-muted'
                              }`}
                              title={changed
                                ? `This clip's audio will play at ${volume.toFixed(2)}× of its source level — applied during merge. Set to boost a quiet clip when mixing with TTS / music.`
                                : 'Audio volume for this clip. Boost quiet videos so they aren\'t drowned out by TTS / music in the merge.'}
                            >
                              <span className="text-[10px]">{volume === 0 ? '🔇 Mute' : changed ? `🔊 ${volume.toFixed(2)}×` : 'Volume'}</span>
                              <select
                                value={String(volume)}
                                onChange={e => {
                                  const newVol = Number(e.target.value)
                                  if (!Number.isFinite(newVol) || newVol < 0) return
                                  item._volume = newVol
                                  try { window.dispatchEvent(new CustomEvent('posty-volume-change', { detail: { itemId: item.id } })) } catch {}
                                  if (mergedUrl) {
                                    try { URL.revokeObjectURL(mergedUrl) } catch {}
                                    setMergedUrl(null)
                                    mergedBlobRef.current = null
                                    window._postyMergedVideo = null
                                  }
                                }}
                                className="text-[10px] border-none bg-transparent cursor-pointer outline-none"
                              >
                                <option value="0">0× (mute)</option>
                                <option value="0.25">0.25×</option>
                                <option value="0.5">0.5×</option>
                                <option value="0.75">0.75×</option>
                                <option value="1">1× (original)</option>
                                <option value="1.5">1.5×</option>
                                <option value="2">2× (+6dB)</option>
                                <option value="3">3×</option>
                                <option value="4">4× (+12dB)</option>
                                <option value="6">6×</option>
                                <option value="8">8×</option>
                              </select>
                            </label>
                          )
                        })()}
                        {!itemIsPhoto && (() => {
                          // Freeze-frame effect. When on, BE replaces the
                          // clip's video with a still frame at trimStart
                          // held for the trim duration. Most useful as a
                          // duplicate-clip effect — a frozen frame on a
                          // hi-hat hit reads as a deliberate stutter
                          // punch in rapid-cut beat-sync montages. Speed
                          // and zoom are ignored on the BE when this is
                          // on (no time axis on a still).
                          const isFrozen = !!item._freezeFrame
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                item._freezeFrame = !isFrozen
                                try { window.dispatchEvent(new CustomEvent('posty-freeze-frame-change', { detail: { itemId: item.id } })) } catch {}
                                if (mergedUrl) {
                                  try { URL.revokeObjectURL(mergedUrl) } catch {}
                                  setMergedUrl(null)
                                  mergedBlobRef.current = null
                                  window._postyMergedVideo = null
                                }
                              }}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer ${
                                isFrozen
                                  ? 'bg-[#e0f2fe] border-[#0284c7]/60 text-[#0369a1] font-medium'
                                  : 'bg-white border-border text-muted'
                              }`}
                              title={isFrozen
                                ? `Freeze frame at ${(item._trimStart || 0).toFixed(2)}s — held for the trim duration. Tap to disable.`
                                : 'Freeze frame: replace this clip with a single still frame at trimStart held for the trim duration. Great as a "stutter punch" on rapid-cut duplicates.'}
                            >
                              <span className="text-[10px]">{isFrozen ? '❄ Frozen' : '❄ Freeze'}</span>
                            </button>
                          )
                        })()}
                        {!itemIsPhoto && !item._freezeFrame && (() => {
                          // Reverse play. Buffers all decoded frames in
                          // memory so safe only on short clips (intended
                          // for beat-sync duplicates of ~0.2-0.5s).
                          // Disabled / hidden when freeze is on — a
                          // single still has no playback direction.
                          const isReversed = !!item._reversePlay
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                item._reversePlay = !isReversed
                                try { window.dispatchEvent(new CustomEvent('posty-reverse-play-change', { detail: { itemId: item.id } })) } catch {}
                                if (mergedUrl) {
                                  try { URL.revokeObjectURL(mergedUrl) } catch {}
                                  setMergedUrl(null)
                                  mergedBlobRef.current = null
                                  window._postyMergedVideo = null
                                }
                              }}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer ${
                                isReversed
                                  ? 'bg-[#fdf2f8] border-[#be185d]/50 text-[#be185d] font-medium'
                                  : 'bg-white border-border text-muted'
                              }`}
                              title={isReversed
                                ? 'Plays backwards. Tap to disable.'
                                : 'Reverse play: clip plays backwards. Best on short duplicates — reverse buffers all decoded frames.'}
                            >
                              <span className="text-[10px]">{isReversed ? '⏪ Reversed' : '⏪ Reverse'}</span>
                            </button>
                          )
                        })()}
                        {!itemIsPhoto && !item._freezeFrame && (() => {
                          // Horizontal mirror (hflip). Cheap, combines
                          // with everything except freeze.
                          const isMirrored = !!item._mirrorFlip
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                item._mirrorFlip = !isMirrored
                                try { window.dispatchEvent(new CustomEvent('posty-mirror-flip-change', { detail: { itemId: item.id } })) } catch {}
                                if (mergedUrl) {
                                  try { URL.revokeObjectURL(mergedUrl) } catch {}
                                  setMergedUrl(null)
                                  mergedBlobRef.current = null
                                  window._postyMergedVideo = null
                                }
                              }}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer ${
                                isMirrored
                                  ? 'bg-[#f0fdf4] border-[#16a34a]/50 text-[#15803d] font-medium'
                                  : 'bg-white border-border text-muted'
                              }`}
                              title={isMirrored ? 'Horizontally flipped. Tap to disable.' : 'Mirror flip: horizontally mirror this clip.'}
                            >
                              <span className="text-[10px]">{isMirrored ? '⇄ Mirrored' : '⇄ Mirror'}</span>
                            </button>
                          )
                        })()}
                        {!itemIsPhoto && !item._freezeFrame && (() => {
                          // Color preset. null = no effect. Dropdown
                          // because there are multiple presets, not a
                          // single toggle.
                          const colorEffect = item._colorEffect || ''
                          return (
                            <label
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer ${
                                colorEffect
                                  ? 'bg-[#fef3c7] border-[#d97706]/50 text-[#92400e] font-medium'
                                  : 'bg-white border-border text-muted'
                              }`}
                              title={colorEffect ? `Color preset: ${colorEffect}` : 'Color preset (b&w / inverted / saturated). Off by default.'}
                            >
                              <span className="text-[10px]">{colorEffect ? `🎨 ${colorEffect}` : '🎨 Color'}</span>
                              <select
                                value={colorEffect}
                                onChange={e => {
                                  const v = e.target.value || null
                                  item._colorEffect = v
                                  try { window.dispatchEvent(new CustomEvent('posty-color-effect-change', { detail: { itemId: item.id } })) } catch {}
                                  if (mergedUrl) {
                                    try { URL.revokeObjectURL(mergedUrl) } catch {}
                                    setMergedUrl(null)
                                    mergedBlobRef.current = null
                                    window._postyMergedVideo = null
                                  }
                                }}
                                className="text-[10px] border-none bg-transparent cursor-pointer outline-none"
                              >
                                <option value="">off</option>
                                <option value="bw">b&w</option>
                                <option value="inverted">inverted</option>
                                <option value="saturated">saturated</option>
                              </select>
                            </label>
                          )
                        })()}
                        {!itemIsPhoto && !item._freezeFrame && (() => {
                          // Beat zoom — punch zoom at clip start with
                          // hard drop. Lands on a bass beat when
                          // apply-snap has used bass as the beat
                          // source. Overrides Ken Burns motion.
                          const isBeatZoom = !!item._beatZoom
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                item._beatZoom = !isBeatZoom
                                try { window.dispatchEvent(new CustomEvent('posty-beat-zoom-change', { detail: { itemId: item.id } })) } catch {}
                                if (mergedUrl) {
                                  try { URL.revokeObjectURL(mergedUrl) } catch {}
                                  setMergedUrl(null)
                                  mergedBlobRef.current = null
                                  window._postyMergedVideo = null
                                }
                              }}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer ${
                                isBeatZoom
                                  ? 'bg-[#fee2e2] border-[#dc2626]/60 text-[#b91c1c] font-medium'
                                  : 'bg-white border-border text-muted'
                              }`}
                              title={isBeatZoom
                                ? 'Beat zoom: punch zoom (1.15× for ~100ms) at clip start, hard drop back. Overrides Ken Burns motion.'
                                : 'Beat zoom: 100ms punch zoom at clip start with a hard drop. Land it on a bass beat by using bass as the snap beat source.'}
                            >
                              <span className="text-[10px]">{isBeatZoom ? '🥁 Beat-zoom' : '🥁 Beat zoom'}</span>
                            </button>
                          )
                        })()}
                        {!itemIsPhoto && !item._freezeFrame && (() => {
                          // Strobe — downsample-then-upsample for a
                          // judder/flicker look. Hidden when freeze is
                          // on; a still has no time axis to judder.
                          const strobed = !!item._strobe
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                item._strobe = !strobed
                                try { window.dispatchEvent(new CustomEvent('posty-strobe-change', { detail: { itemId: item.id } })) } catch {}
                                if (mergedUrl) {
                                  try { URL.revokeObjectURL(mergedUrl) } catch {}
                                  setMergedUrl(null)
                                  mergedBlobRef.current = null
                                  window._postyMergedVideo = null
                                }
                              }}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer ${
                                strobed
                                  ? 'bg-[#fef9c3] border-[#ca8a04]/60 text-[#854d0e] font-medium'
                                  : 'bg-white border-border text-muted'
                              }`}
                              title={strobed
                                ? 'Strobe: clip plays with 10Hz judder. Tap to disable.'
                                : 'Strobe: downsample to ~10fps then upsample back to 30fps — same duration with judder/flicker.'}
                            >
                              <span className="text-[10px]">{strobed ? '⚡ Strobed' : '⚡ Strobe'}</span>
                            </button>
                          )
                        })()}
                        {!itemIsPhoto && (() => {
                          // Static center-crop zoom on video clips. 1.0 = none.
                          // Backend applies as crop=iw/zoom:ih/zoom before the
                          // 1080×1920 scale so the cropped region fills the frame.
                          const videoZoom = Number(item._videoZoom) > 0 ? Number(item._videoZoom) : 1.0
                          return (
                            <label
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer ${
                                videoZoom !== 1
                                  ? 'bg-[#f3f0ff] border-[#6C5CE7]/50 text-[#6C5CE7] font-medium'
                                  : 'bg-white border-border text-muted'
                              }`}
                              title={videoZoom !== 1
                                ? `This clip will be zoomed in ${videoZoom}× — applied during merge.`
                                : 'Static zoom on this video clip. 1× = no zoom; 1.25×–5× crops the center and scales back to fill.'}
                            >
                              <span className="text-[10px]">{videoZoom !== 1 ? `${videoZoom}× zoom` : 'Zoom'}</span>
                              <select
                                value={String(videoZoom)}
                                onChange={e => {
                                  const newZoom = Number(e.target.value)
                                  if (!(newZoom > 0)) return
                                  item._videoZoom = newZoom
                                  try { window.dispatchEvent(new CustomEvent('posty-video-zoom-change', { detail: { itemId: item.id } })) } catch {}
                                  if (mergedUrl) {
                                    try { URL.revokeObjectURL(mergedUrl) } catch {}
                                    setMergedUrl(null)
                                    mergedBlobRef.current = null
                                    window._postyMergedVideo = null
                                  }
                                }}
                                className="text-[10px] border-none bg-transparent cursor-pointer outline-none"
                              >
                                <option value="1">1×</option>
                                <option value="1.25">1.25×</option>
                                <option value="1.5">1.5×</option>
                                <option value="2">2×</option>
                                <option value="3">3×</option>
                                <option value="5">5×</option>
                              </select>
                            </label>
                          )
                        })()}
                    <div className="flex gap-0.5">
                      {/* Reset effects — wipes every effect flag on this
                          clip in one PUT. Shown only when at least one
                          effect is on (otherwise it's noise). Reaches
                          effects the per-toggle UI hides — e.g. strobe
                          + mirror are hidden when freeze is on because
                          freeze takes precedence on the BE, but the
                          flags stay set until something clears them.
                          Apply-snap can stack multiple flags on a
                          single loop_duplicate row, which is how
                          operators ended up with "stuck" effects after
                          removing music. */}
                      {item._dbFileId != null && (() => {
                        const hasAnyEffect = !!(item._freezeFrame || item._reversePlay || item._mirrorFlip || item._strobe || item._beatZoom || item._colorEffect)
                        if (!hasAnyEffect) return null
                        return (
                          <button
                            onClick={async () => {
                              // Optimistic local clear so the badges flip
                              // off immediately; the API call below
                              // persists. mergedUrl is invalidated so the
                              // next merge picks up the cleared state.
                              item._freezeFrame = false
                              item._reversePlay = false
                              item._mirrorFlip = false
                              item._strobe = false
                              item._beatZoom = false
                              item._colorEffect = null
                              try { window.dispatchEvent(new CustomEvent('posty-freeze-frame-change', { detail: { itemId: item.id } })) } catch {}
                              try { window.dispatchEvent(new CustomEvent('posty-reverse-play-change', { detail: { itemId: item.id } })) } catch {}
                              try { window.dispatchEvent(new CustomEvent('posty-mirror-flip-change', { detail: { itemId: item.id } })) } catch {}
                              try { window.dispatchEvent(new CustomEvent('posty-strobe-change', { detail: { itemId: item.id } })) } catch {}
                              try { window.dispatchEvent(new CustomEvent('posty-beat-zoom-change', { detail: { itemId: item.id } })) } catch {}
                              try { window.dispatchEvent(new CustomEvent('posty-color-effect-change', { detail: { itemId: item.id } })) } catch {}
                              if (mergedUrl) {
                                try { URL.revokeObjectURL(mergedUrl) } catch {}
                                setMergedUrl(null)
                                mergedBlobRef.current = null
                                window._postyMergedVideo = null
                                try { window.dispatchEvent(new CustomEvent('posty-merge-change')) } catch {}
                              }
                            }}
                            className="text-[10px] text-[#d97706] hover:text-[#92400e] bg-transparent border-none cursor-pointer px-1 leading-none"
                            title="Reset every effect on this clip (freeze, reverse, mirror, strobe, beat-zoom, color)"
                          >⟲</button>
                        )
                      })()}
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
                      {/* Duplicate — server-side copy, lands at the end
                          of the order list. Lets users build rapid-cut
                          loops (clip A, clip B, A, C, A) without
                          re-uploading. Only enabled once the row is
                          persisted (_dbFileId set). */}
                      {item._dbFileId != null && onDuplicate && (
                        <button
                          onClick={() => onDuplicate(item)}
                          disabled={item._duplicating}
                          className="text-[11px] text-[#6C5CE7] hover:text-[#5847d4] disabled:opacity-30 bg-transparent border-none cursor-pointer px-1 leading-none"
                          title="Duplicate this clip — server-side copy lands at the end. Great for rapid-cut loops."
                        >{item._duplicating ? '…' : '⎘'}</button>
                      )}
                      {/* Remove — drops this clip from the merge list +
                          deletes the underlying job_files row. Same
                          effect as the ✕ on the FileGrid tile above;
                          duplicated here so the operator doesn't have
                          to scroll back up to remove an unwanted
                          (e.g. loop-duplicate) clip. */}
                      {onRemove && (
                        <button
                          onClick={() => {
                            if (!confirm('Remove this clip from the merge list?')) return
                            onRemove(item.id)
                            if (mergedUrl) {
                              try { URL.revokeObjectURL(mergedUrl) } catch {}
                              setMergedUrl(null)
                              mergedBlobRef.current = null
                              window._postyMergedVideo = null
                              try { window.dispatchEvent(new CustomEvent('posty-merge-change')) } catch {}
                            }
                          }}
                          className="text-[11px] text-[#c0392b] hover:text-[#922b21] bg-transparent border-none cursor-pointer px-1 leading-none"
                          title="Remove this clip from the merge list (deletes the job_files row)"
                        >✕</button>
                      )}
                    </div>
                      </div>
                      {/* Line 3 (photo rows only): full-width duration
                          slider + Ken Burns motion picker. */}
                      {itemIsPhoto && (
                        <div className="space-y-1 mt-0.5">
                          <PhotoDurationControl
                            item={item}
                            onInvalidateMerge={() => {
                              if (mergedUrl) {
                                try { URL.revokeObjectURL(mergedUrl) } catch {}
                                setMergedUrl(null)
                                mergedBlobRef.current = null
                                window._postyMergedVideo = null
                              }
                            }}
                            onSaveTrim={onSaveTrim}
                          />
                          <PhotoMotionControl
                            item={item}
                            onInvalidateMerge={() => {
                              if (mergedUrl) {
                                try { URL.revokeObjectURL(mergedUrl) } catch {}
                                setMergedUrl(null)
                                mergedBlobRef.current = null
                                window._postyMergedVideo = null
                              }
                            }}
                            onSaveMotion={onSaveMotion}
                          />
                        </div>
                      )}
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
        {/* Job-wide playback speed. Applied at merge time alongside any
            per-clip speed values. Gated OFF when music is attached so
            cuts stay in sync with the music — operator must detach
            music first to change it. */}
        <label className="text-[10px] text-muted ml-2">Global speed:</label>
        <select
          value={String(globalSpeed)}
          disabled={musicAttached || merging}
          onChange={async e => {
            const next = Number(e.target.value)
            if (!(next > 0)) return
            const prev = globalSpeed
            setGlobalSpeed(next)
            // Invalidate any cached merge so the new speed lands on
            // the next merge press.
            if (mergedUrl) {
              try { URL.revokeObjectURL(mergedUrl) } catch {}
              setMergedUrl(null)
              mergedBlobRef.current = null
              window._postyMergedVideo = null
              try { window.dispatchEvent(new CustomEvent('posty-merge-change')) } catch {}
            }
            if (!jobId) return
            try {
              const api = await import('../api')
              await api.setJobGlobalSpeed(jobId, next)
            } catch (err) {
              alert(err?.message || String(err))
              setGlobalSpeed(prev)
            }
          }}
          title={musicAttached
            ? 'Detach music first — global speed locked at 1× while music is attached so cut timing stays in sync.'
            : `Slow / speed up the whole merged video. Multiplied with each clip's own speed. Range 0.25×–4×.`}
          className={`text-[10px] border rounded py-0.5 px-1.5 ${
            musicAttached
              ? 'bg-[#f5f5f5] border-border text-muted cursor-not-allowed'
              : globalSpeed !== 1
                ? 'bg-[#fff7ed] border-[#d97706]/50 text-[#d97706] font-medium'
                : 'bg-white border-border'
          }`}
        >
          <option value="0.25">0.25×</option>
          <option value="0.5">0.5×</option>
          <option value="0.75">0.75×</option>
          <option value="0.9">0.9×</option>
          <option value="1">1×</option>
          <option value="1.1">1.1×</option>
          <option value="1.25">1.25×</option>
          <option value="1.5">1.5×</option>
          <option value="2">2×</option>
          <option value="3">3×</option>
          <option value="4">4×</option>
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

      {/* Clear music effects — resets every per-job music_*_loops +
          music_beat_zoom_all + music_loop_color_effect flag AND
          deletes leftover is_loop_duplicate rows. Music track stays
          attached. Solves the case where merges keep producing
          effects (beat-zoom-all is a job-level merge-time override
          that doesn't render as a per-clip badge) even though no
          per-clip toggles look enabled. Mirrors the same button on
          the Music tab. */}
      {jobId && (() => {
        const showDone = musicClearedAt && Date.now() - musicClearedAt < 4000
        const label = clearingMusic
          ? 'Clearing…'
          : musicClearError
            ? `⚠ ${musicClearError.slice(0, 60)}`
            : showDone
              ? '✓ Music effects cleared'
              : '⟲ Clear music effects'
        const cls = clearingMusic
          ? 'bg-[#d97706]/80 text-white'
          : musicClearError
            ? 'bg-[#fef2f2] border border-[#c0392b]/60 text-[#c0392b]'
            : showDone
              ? 'bg-[#2D9A5E] text-white'
              : 'bg-white border border-[#d97706] text-[#d97706] hover:bg-[#fff7ed]'
        return (
          <button
            type="button"
            disabled={clearingMusic || merging}
            onClick={async () => {
              if (!confirm('Clear all music effects on this job (beat-zoom-all, freeze / reverse / mirror / strobe / color loops) and remove any leftover loop-duplicate clips? Music track stays attached.')) return
              setClearingMusic(true); setMusicClearError(null); setMusicClearedAt(null)
              try {
                const api = await import('../api')
                await api.clearJobMusicEffects(jobId)
                // Invalidate any cached merge — flags + dupes just changed.
                if (mergedUrl) {
                  try { URL.revokeObjectURL(mergedUrl) } catch {}
                  setMergedUrl(null)
                  mergedBlobRef.current = null
                  window._postyMergedVideo = null
                  try { window.dispatchEvent(new CustomEvent('posty-merge-change')) } catch {}
                }
                // Loop-duplicates just got dropped on the BE — tell
                // the parent (AppV2) to re-hydrate the file list so
                // those tiles disappear and the next merge sends a
                // clean clip set.
                try { window.dispatchEvent(new CustomEvent('posty-files-changed', { detail: { reason: 'cleared-music-effects-from-merge-panel' } })) } catch {}
                setMusicClearedAt(Date.now())
                setTimeout(() => setMusicClearedAt(d => (d && Date.now() - d >= 4000 ? null : d)), 4100)
              } catch (e) {
                setMusicClearError(e?.message || String(e))
              } finally {
                setClearingMusic(false)
              }
            }}
            className={`w-full text-[10px] py-1.5 rounded cursor-pointer font-medium disabled:cursor-wait ${cls}`}
            title="Resets every music-driven effect flag (beat-zoom-all, freeze/reverse/mirror/strobe loops + loop-color) AND deletes leftover loop-duplicate clips. Music track stays attached."
          >{label}</button>
        )
      })()}

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

// Per-clip control for marking a video as a B-roll insert.
//
// Two pieces:
//  1. "Place" select: "Sequential" (default) or "Insert into [Clip N -
//     filename]" for each available host. Picking a host attaches this
//     clip as an overlay; picking Sequential clears the attachment.
//  2. "@" time input (visible only when this clip is an insert) — the
//     position in the host's trimmed output timeline (seconds, decimals
//     allowed) where the overlay starts.
//
// The list of available hosts EXCLUDES this item itself and any other
// item that's also flagged as an insert (an insert can't host another
// insert — keeps the data model flat). Photo clips are also excluded
// because they don't have a video stream that maps onto host time.
function InsertOverlayControl({ item, allItems, onChange }) {
  const isPhoto = it => it?.isImg || it?.file?.type?.startsWith('image/') || it?._mediaType?.startsWith('image/')
  const candidates = (allItems || [])
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => it && it !== item && !isPhoto(it) && it._insertIntoFileId == null && it._dbFileId != null)

  const isInsert = item._insertIntoFileId != null
  const setHost = (hostDbId) => {
    item._insertIntoFileId = hostDbId == null ? null : Number(hostDbId)
    if (item._insertIntoFileId == null) item._insertAtSec = 0
    try { window.dispatchEvent(new CustomEvent('posty-insert-overlay-change', { detail: { itemId: item.id } })) } catch {}
    if (typeof onChange === 'function') onChange()
  }
  const setAtSec = (sec) => {
    item._insertAtSec = Math.max(0, Number(sec) || 0)
    try { window.dispatchEvent(new CustomEvent('posty-insert-overlay-change', { detail: { itemId: item.id } })) } catch {}
    if (typeof onChange === 'function') onChange()
  }

  const fmtTime = sec => {
    const s = Math.max(0, Number(sec) || 0)
    const m = Math.floor(s / 60)
    const r = s - m * 60
    return `${m}:${String(Math.floor(r)).padStart(2, '0')}${(r % 1) > 0.05 ? `.${Math.round((r % 1) * 10)}` : ''}`
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${
        isInsert
          ? 'bg-[#f3f0ff] border-[#6C5CE7]/50 text-[#6C5CE7] font-medium'
          : 'bg-white border-border text-muted'
      }`}
      title={isInsert
        ? `Overlay placed at ${fmtTime(item._insertAtSec)} into the host clip. Host's audio plays through.`
        : 'Place this clip sequentially in the timeline, or attach it as an overlay inside another clip.'}
    >
      <span className="text-[10px]">{isInsert ? '↳ Insert' : 'Place:'}</span>
      <select
        value={item._insertIntoFileId == null ? '' : String(item._insertIntoFileId)}
        onChange={e => setHost(e.target.value === '' ? null : e.target.value)}
        className="text-[10px] border-none bg-transparent cursor-pointer outline-none"
      >
        <option value="">Sequential</option>
        {candidates.map(({ it, idx }) => (
          <option key={it._dbFileId} value={it._dbFileId}>
            into Clip {idx + 1}{it.file?.name || it._filename ? ` (${(it.file?.name || it._filename).slice(0, 18)})` : ''}
          </option>
        ))}
      </select>
      {isInsert && (
        <>
          <span className="text-[10px]">@</span>
          <InsertAtSecInput value={item._insertAtSec} onChange={setAtSec} />
          <span className="text-[10px]">s</span>
        </>
      )}
    </span>
  )
}

// Decimal-friendly input for the insert offset. Same pattern as
// OverlaysPanelV2's DecimalInput: keep an internal draft string so a
// trailing "." (mid-typing "1." → "1.5") survives parent rerenders
// instead of getting eaten by the Number() round-trip. The previous
// implementation pushed Number(cleaned) up on every keystroke, then
// re-read String(_insertAtSec) on the next render — turning "1." into
// "1" before the user could finish typing the decimal.
function InsertAtSecInput({ value, onChange }) {
  const [draft, setDraft] = useState(() => (value == null || value === '' ? '0' : String(value)))
  const editingRef = useRef(false)
  useEffect(() => {
    if (!editingRef.current) {
      const next = (value == null || value === '' ? '0' : String(value))
      if (next !== draft) setDraft(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={() => { editingRef.current = true }}
      onChange={e => {
        const cleaned = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
        setDraft(cleaned)
        const n = cleaned === '' || cleaned === '.' ? 0 : Number(cleaned)
        if (Number.isFinite(n)) onChange(n)
      }}
      onBlur={() => {
        editingRef.current = false
        setDraft(value == null || value === '' ? '0' : String(value))
      }}
      className="w-12 text-[10px] border border-[#6C5CE7]/30 rounded px-1 py-0 bg-white text-center"
      title="Seconds into the host clip's trimmed output where this overlay starts"
    />
  )
}
