import { useState, useRef } from 'react'

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
export default function VideoMerge({ videoFiles, jobId, onMerged }) {
  const [order, setOrder] = useState(() => videoFiles.map((_, i) => i))
  const [transition, setTransition] = useState('crossfade')
  const [transDuration, setTransDuration] = useState(1)
  const [merging, setMerging] = useState(false)
  const [progress, setProgress] = useState('')
  const [mergedUrl, setMergedUrl] = useState(null)
  const [error, setError] = useState(null)
  const mergedBlobRef = useRef(null)

  // Keep order in sync if files change — also clear stale merge result
  const fileIds = videoFiles.map(f => f.id).join(',')
  const prevFileIdsRef = useRef(fileIds)
  if (fileIds !== prevFileIdsRef.current) {
    prevFileIdsRef.current = fileIds
    setOrder(videoFiles.map((_, i) => i))
    if (mergedUrl) { URL.revokeObjectURL(mergedUrl); setMergedUrl(null) }
    mergedBlobRef.current = null
    window._postyMergedVideo = null
    setError(null)
  }

  const moveUp = (idx) => {
    if (idx <= 0) return
    const next = [...order]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    setOrder(next)
  }
  const moveDown = (idx) => {
    if (idx >= order.length - 1) return
    const next = [...order]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    setOrder(next)
  }

  const handleMerge = async () => {
    setMerging(true)
    setError(null)
    setProgress('Uploading clips...')
    try {
      const api = await import('../api')
      const clips = []
      for (let i = 0; i < order.length; i++) {
        const item = videoFiles[order[i]]
        // Ensure each clip has been uploaded to the server (sets uploadResult
        // with original_temp_path). This uses FormData multipart upload which
        // works on iOS for any file size — no base64 encoding needed.
        let uploadKey = item.uploadResult?.original_temp_path || null
        if (!uploadKey) {
          setProgress(`Uploading clip ${i + 1}/${order.length} (${item.file.name})...`)
          try {
            const result = await api.uploadFile(item.file, null, null, {}, null, jobId)
            item.uploadResult = result
            uploadKey = result.original_temp_path
          } catch (e) {
            throw new Error(`Upload clip ${i + 1} failed: ${e.message}`)
          }
        } else {
          setProgress(`Preparing clip ${i + 1}/${order.length}...`)
        }
        clips.push({
          upload_key: uploadKey,
          trim_start: item._trimStart || 0,
          trim_end: item._trimEnd ?? null,
        })
      }
      setProgress(`Merging ${clips.length} clips on server...`)
      // mergeVideos now returns a blob URL directly (binary response, not JSON)
      const url = await api.mergeVideos(clips, transition, transDuration)

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
    const blob = mergedBlobRef.current
    if (!blob) return
    const filename = 'merged-video.mp4'
    try {
      const file = new File([blob], filename, { type: 'video/mp4' })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename })
        return
      }
    } catch (e) {
      if (e.name === 'AbortError') return
    }
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
        {order.map((fileIdx, pos) => {
          const item = videoFiles[fileIdx]
          const ts = item._trimStart || 0
          const te = item._trimEnd
          return (
            <div key={item.id} className="flex items-center gap-2 bg-cream rounded px-2 py-1.5 text-[10px]">
              <span className="text-muted font-medium w-4">{pos + 1}.</span>
              <span className="flex-1 truncate" title={item.file.name}>{item.file.name}</span>
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
                  disabled={pos === order.length - 1}
                  className="text-[10px] text-muted hover:text-ink disabled:opacity-30 bg-transparent border-none cursor-pointer px-1"
                >&#9660;</button>
              </div>
            </div>
          )
        })}
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
        {merging ? (progress || 'Merging...') : mergedUrl ? 'Re-merge' : `Merge ${order.length} clips`}
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
