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
export default function VideoMerge({ videoFiles, jobId, onMerged, onReorder, restoredMergeUrl, onSaveTrim, onSaveMotion }) {
  // The merge list now uses the natural order of videoFiles so reordering here
  // flows back to the file grid + voiceover preview. onReorder(fromIdx, toIdx)
  // is implemented by App.jsx and persists the new order to the server.
  const [transition, setTransition] = useState('crossfade')
  const [transDuration, setTransDuration] = useState(1)
  // Track whether we've hydrated transition + transDuration from the
  // job's saved merge_settings yet. Without this gate the auto-save
  // effect below would fire on the initial mount with the default
  // values BEFORE we've heard back from the job, overwriting the
  // saved choice with 'crossfade' on every reload.
  const transitionHydrated = useRef(false)
  const [merging, setMerging] = useState(false)
  const [progress, setProgress] = useState('')
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
        transitionHydrated.current = true
      }).catch(() => { transitionHydrated.current = true })
    })
    return () => { cancelled = true }
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
    return () => {
      window.removeEventListener('posty-video-duration', bump)
      window.removeEventListener('posty-trim-change', bump)
      window.removeEventListener('posty-insert-overlay-change', bump)
      window.removeEventListener('posty-speed-change', bump)
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
      // Filter out clips the user toggled "skip" on. Stays in the job
      // (loaded from job_files.skip_in_merge) but doesn't get sent to
      // /merge-videos. If a host with attached B-roll inserts is
      // skipped, its inserts have no host left to attach to and would
      // be dropped by the BE anyway — drop them here too so the
      // counts in the progress bar match what the BE actually merges.
      const activeFiles = videoFiles.filter(f => !f?._skipInMerge)
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
