import { useState, useRef, useEffect } from 'react'
import { buildDownloadName } from '../lib/filename'

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
      const clips = []
      for (let i = 0; i < videoFiles.length; i++) {
        const item = videoFiles[i]
        let uploadKey = item.uploadResult?.original_temp_path || null
        if (!uploadKey) {
          setProgress(`Uploading clip ${i + 1}/${videoFiles.length} (${item.file?.name || item._filename || 'Untitled'})...`)
          try {
            const result = await api.uploadFile(item.file, null, null, {}, null, jobId)
            item.uploadResult = result
            uploadKey = result.original_temp_path
          } catch (e) {
            throw new Error(`Upload clip ${i + 1} failed: ${e.message}`)
          }
        } else {
          setProgress(`Preparing clip ${i + 1}/${videoFiles.length} (${item.file?.name || item._filename || 'Untitled'})...`)
        }
        clips.push({
          upload_key: uploadKey,
          trim_start: item._trimStart || 0,
          trim_end: item._trimEnd ?? null,
        })
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
      <div className="text-[11px] font-medium text-ink">Merge videos</div>

      {/* Clip order */}
      <div className="space-y-1">
        {(() => {
          const clipDurations = videoFiles.map(item => {
            const dur = item?._videoDuration || 0
            if (!dur) return 0
            const ts = item._trimStart || 0
            const te = item._trimEnd ?? dur
            return Math.max(0, te - ts)
          })
          const totalKept = clipDurations.reduce((a, b) => a + b, 0)
          const transOverhead = transition !== 'none' && videoFiles.length > 1
            ? (videoFiles.length - 1) * transDuration
            : 0
          const finalTotal = Math.max(0, totalKept - transOverhead)
          return (
            <>
              {videoFiles.map((item, pos) => {
                if (!item) return null
                const ts = item._trimStart || 0
                const te = item._trimEnd
                const kept = clipDurations[pos]
                return (
                  <div key={item.id} className="flex items-center gap-2 bg-cream rounded px-2 py-1.5 text-[10px]">
                    <span className="text-muted font-medium w-4">{pos + 1}.</span>
                    <span className="flex-1 truncate" title={item.file?.name || item._filename || 'Untitled'}>{item.file?.name || item._filename || 'Untitled'}</span>
                    {kept > 0 && (
                      <span className="text-[9px] text-muted whitespace-nowrap" title="Time kept after trim">{kept.toFixed(1)}s</span>
                    )}
                    {(ts > 0 || te != null) && (
                      <span className="text-[9px] text-[#d97706]">trimmed</span>
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
                )
              })}
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
      </div>

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

      {/* Merge button */}
      <button
        onClick={handleMerge}
        disabled={merging}
        className="w-full text-[11px] py-2 border border-[#6C5CE7] rounded bg-[#6C5CE7] text-white cursor-pointer font-sans font-medium hover:bg-[#5a4bd6] disabled:opacity-50"
      >
        {merging ? (progress || 'Merging...') : mergedUrl ? 'Re-merge' : `Merge ${videoFiles.length} clips`}
      </button>

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
    </div>
  )
}
