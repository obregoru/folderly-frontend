import { useState, useEffect, useRef } from 'react'
import { DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core'
import { sortableKeyboardCoordinates, SortableContext, arrayMove, useSortable, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

function MediaLightbox({ item, onClose }) {
  const file = item.file
  const isImg = item.isImg || item._mediaType?.startsWith('image/')
  const videoRef = useRef(null)
  const [src] = useState(() => {
    if (file instanceof Blob || file instanceof File) return URL.createObjectURL(file)
    // Restored file — prefer Supabase public URL (no auth, no memory pressure)
    if (item._publicUrl) return item._publicUrl
    if (item._uploadKey && item._tenantSlug) {
      return `${import.meta.env.VITE_API_URL || ''}/api/t/${item._tenantSlug}/upload/serve?key=${encodeURIComponent(item._uploadKey)}`
    }
    return null
  })

  // Read the current trim bounds from the item. We read at mount AND on
  // every render so the user can re-trim while the lightbox is open and
  // the next play cycle picks up the new bounds.
  const trimStart = item._trimStart || 0
  const trimEnd = item._trimEnd ?? null

  // Enforce trim on the lightbox video: seek to trimStart on play, pause
  // (and reset) when currentTime reaches trimEnd. Uses refs via closure
  // so the latest trim values apply on every tick.
  useEffect(() => {
    if (isImg) return
    const v = videoRef.current
    if (!v) return
    // Clamp initial play position to the trim start.
    const onLoaded = () => {
      try { v.currentTime = trimStart } catch {}
    }
    const onTimeUpdate = () => {
      const end = item._trimEnd ?? (v.duration || Infinity)
      const start = item._trimStart || 0
      if (v.currentTime >= end - 0.03) {
        // Loop back to trim start — feels more like a preview than a hard stop.
        try { v.currentTime = start } catch {}
        if (!v.paused) v.play().catch(() => {})
      } else if (v.currentTime < start - 0.03) {
        try { v.currentTime = start } catch {}
      }
    }
    const onPlay = () => {
      const start = item._trimStart || 0
      if (v.currentTime < start || v.currentTime >= (item._trimEnd ?? Infinity) - 0.03) {
        try { v.currentTime = start } catch {}
      }
    }
    v.addEventListener('loadedmetadata', onLoaded)
    v.addEventListener('timeupdate', onTimeUpdate)
    v.addEventListener('play', onPlay)
    return () => {
      v.removeEventListener('loadedmetadata', onLoaded)
      v.removeEventListener('timeupdate', onTimeUpdate)
      v.removeEventListener('play', onPlay)
    }
  }, [isImg])

  const hasTrim = trimStart > 0 || trimEnd != null

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative max-w-[90vw] max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-ink text-lg flex items-center justify-center shadow cursor-pointer border-none z-10">&times;</button>
        {!src ? (
          <div className="text-white text-[13px] p-8">No preview available — file needs to be re-uploaded</div>
        ) : isImg ? (
          <img src={src} className="max-w-full max-h-[80vh] rounded object-contain" />
        ) : (
          <>
            <video
              ref={videoRef}
              src={src}
              controls
              playsInline
              crossOrigin={src && !src.startsWith('blob:') ? 'anonymous' : undefined}
              className="max-w-full max-h-[80vh] rounded"
            />
            {hasTrim && (
              <div className="absolute bottom-12 left-1/2 -translate-x-1/2 text-[10px] text-white bg-black/70 rounded-full px-2.5 py-1 pointer-events-none">
                Trimmed preview: {trimStart.toFixed(1)}s → {trimEnd != null ? `${trimEnd.toFixed(1)}s` : 'end'}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function VideoThumb({ file, onClick, className, itemId }) {
  const videoRef = useRef(null)
  const [poster, setPoster] = useState(null)
  const [aspect, setAspect] = useState(null)
  const [src] = useState(() => file instanceof Blob || file instanceof File ? URL.createObjectURL(file) : null)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    let cancelled = false
    let captured = false

    // Read rotation-corrected dimensions so the container sizes correctly
    // even if we never manage to paint a poster frame (iOS can be stubborn).
    const readAspect = () => {
      const w = v.videoWidth, h = v.videoHeight
      if (w && h && !aspect) setAspect(w / h)
    }

    // Attempt to draw the current video frame to canvas. iOS Safari silently
    // returns all-black frames until the video has started decoding (play()
    // triggers that), so we sample a 10×10 region and retry on black.
    const tryCapture = () => {
      if (cancelled || captured) return
      const w = v.videoWidth, h = v.videoHeight
      if (!w || !h) return
      try {
        const c = document.createElement('canvas')
        c.width = Math.min(w, 300)
        c.height = Math.round(c.width * h / w)
        const ctx = c.getContext('2d')
        ctx.drawImage(v, 0, 0, c.width, c.height)
        const sw = Math.min(c.width, 10), sh = Math.min(c.height, 10)
        const pixels = ctx.getImageData(0, 0, sw, sh).data
        let sum = 0
        for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2]
        if (sum < 50) return // black frame — wait for the next event
        captured = true
        setPoster(c.toDataURL('image/jpeg', 0.7))
      } catch {}
    }

    // On metadata load, kick the video briefly so iOS decodes a real frame.
    // muted + playsInline (already set below) satisfy autoplay policy.
    const onMeta = async () => {
      readAspect()
      try {
        v.muted = true
        const p = v.play()
        if (p && typeof p.then === 'function') await p
        setTimeout(() => { try { v.pause() } catch {} }, 80)
      } catch {
        // Autoplay blocked — desktop browsers typically still paint anyway,
        // so we fall through and rely on the seeked/canplay listeners.
      }
      try { v.currentTime = Math.min(0.5, (v.duration || 1) / 2) } catch {}
    }

    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('loadeddata', tryCapture)
    v.addEventListener('seeked', tryCapture)
    v.addEventListener('canplay', tryCapture)
    v.addEventListener('playing', tryCapture)

    return () => {
      cancelled = true
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('loadeddata', tryCapture)
      v.removeEventListener('seeked', tryCapture)
      v.removeEventListener('canplay', tryCapture)
      v.removeEventListener('playing', tryCapture)
    }
  }, [])

  // Store thumb + aspect on the file object so ResultCard can reuse it
  useEffect(() => {
    if (poster) file._videoThumb = poster
    if (aspect) file._videoAspect = aspect
  }, [poster, aspect])

  const isPortrait = aspect && aspect < 1
  const height = isPortrait ? 260 : 120

  return (
    <div onClick={onClick} className={`relative cursor-pointer hover:opacity-80 ${className || ''}`} style={{ height }}>
      <video ref={videoRef} data-posty-item-id={itemId} src={src} poster={poster || undefined} className="w-full h-full object-cover" muted playsInline preload="auto" />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-white text-[18px] bg-black/50 rounded-full w-8 h-8 flex items-center justify-center">▶</span>
      </div>
    </div>
  )
}

// Restored file thumbnail — measures aspect ratio on load so vertical
// videos get the tall layout (260px) like fresh portrait uploads.
function RestoredMedia({ item, isVideo, onClick }) {
  const [aspect, setAspect] = useState(() => item._videoDuration && item._videoAspect ? item._videoAspect : null)
  useEffect(() => { if (aspect != null) item._videoAspect = aspect }, [aspect, item])
  const isPortrait = aspect != null && aspect < 1
  const isPhoto = !isVideo
  // Photo tiles render in a 16:9 outer container (matches video
  // tile feel) with a 9:16 outline marking the actual export
  // frame INSIDE — see ImageThumb for the same treatment. Videos
  // keep their height-by-aspect treatment because they're trim/
  // duration controlled, not crop framed.
  // Photo tile aspect matches the export (9:16). Constrained max-width
  // so portrait tiles don't blow up too tall in the grid.
  const tileStyle = isPhoto
    ? { aspectRatio: '9 / 16', maxWidth: '180px', marginInline: 'auto' }
    : { height: isPortrait ? 260 : 120 }
  const src = item._publicUrl || `${import.meta.env.VITE_API_URL || ''}/api/t/${item._tenantSlug || ''}/upload/serve?key=${encodeURIComponent(item._uploadKey)}`
  return (
    <div onClick={onClick} className="w-full bg-black flex items-center justify-center cursor-pointer hover:opacity-80 relative overflow-hidden" style={tileStyle}>
      {isVideo ? (
        <video
          data-posty-item-id={item.id}
          src={src}
          className="w-full h-full object-contain"
          muted playsInline preload="metadata"
          // Use the first captured trim thumbnail as the poster. iOS Safari
          // won't paint the first frame of a <video> until playback starts,
          // so without a poster the tile stays black on mobile. The
          // trim_thumbs array is persisted with the job and arrives as data
          // URLs — perfect for a poster.
          poster={Array.isArray(item._trimThumbs) && item._trimThumbs[0] ? item._trimThumbs[0] : undefined}
          onLoadedMetadata={e => {
            const v = e.target
            if (aspect == null && v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight)
          }}
          onLoadedData={e => { try { e.target.currentTime = item._trimStart || 0.5 } catch {} }}
        />
      ) : (
        // Photo thumb on a restored draft. Same 16:9 outer + 9:16
        // outline inside as ImageThumb. Image fills the outer 16:9
        // tile so cropped regions are visible outside the outline.
        (() => {
          const z = Number(item._photoZoom) > 0 ? Number(item._photoZoom) : 1.0
          const r = Number.isFinite(Number(item._photoRotate)) ? Number(item._photoRotate) : 0
          const ox = Number.isFinite(Number(item._photoOffsetX)) ? Number(item._photoOffsetX) / 4 : 0
          const oy = Number.isFinite(Number(item._photoOffsetY)) ? Number(item._photoOffsetY) / 4 : 0
          return (
            <>
              <img
                src={src}
                className="w-full h-full"
                style={{
                  // Tile is 9:16 (the export aspect) so cover fills
                  // edge-to-edge; matches the BE photoToVideo crop
                  // for landscape/square sources. Contain when zoom<1
                  // so the user can see the letterboxed preview.
                  objectFit: z < 1 ? 'contain' : 'cover',
                  transform: `rotate(${r}deg) scale(${z}) translate(${-ox}%, ${-oy}%)`,
                  transformOrigin: 'center center',
                  imageOrientation: 'from-image',
                }}
                onLoad={e => { if (aspect == null && e.target.naturalWidth && e.target.naturalHeight) setAspect(e.target.naturalWidth / e.target.naturalHeight) }}
                onError={e => { e.target.style.display = 'none' }}
              />
              <span className="absolute top-1 left-1 text-[8px] bg-black/55 text-white rounded px-1 py-0.5 pointer-events-none">9:16</span>
            </>
          )
        })()
      )}
      {isVideo && <span className="absolute text-white text-[18px] bg-black/50 rounded-full w-8 h-8 flex items-center justify-center">▶</span>}
    </div>
  )
}

function ImageThumb({ file, zoom, rotate, offsetX, offsetY, onClick }) {
  const [src] = useState(() => file instanceof Blob || file instanceof File ? URL.createObjectURL(file) : null)
  const [aspect, setAspect] = useState(() => file._imgAspect || null)
  useEffect(() => { if (aspect != null) file._imgAspect = aspect }, [aspect])
  // Photo tile aspect = the export aspect (9:16). What you see in the
  // tile is what gets exported. Cover crops to the 9:16 frame for
  // landscape/square sources (matching the BE photoToVideo middle
  // crop) and fills edge-to-edge for 9:16 sources. zoom > 1 magnifies
  // past the frame edges (visible as cropped); zoom < 1 letterboxes.
  const z = Number(zoom) > 0 ? Number(zoom) : 1.0
  const r = Number.isFinite(Number(rotate)) ? Number(rotate) : 0
  // Pan offsets are -100..+100 percent (BE clamp range). For the
  // thumbnail we apply translate(X%, Y%) where the percentages are
  // relative to the IMG's own dimensions. ÷4 keeps thumbnail nudge
  // proportional — a +100 pan in the BE is "shift to canvas edge"
  // which on the thumbnail looks like ~25% of element width (because
  // the canvas is ~2× target). Empirically this matches.
  const ox = Number.isFinite(Number(offsetX)) ? Number(offsetX) / 4 : 0
  const oy = Number.isFinite(Number(offsetY)) ? Number(offsetY) / 4 : 0
  return (
    <div
      onClick={onClick}
      className="w-full block bg-black overflow-hidden cursor-pointer hover:opacity-80 relative mx-auto"
      style={{ aspectRatio: '9 / 16', maxWidth: '180px' }}
    >
      <img
        src={src}
        onLoad={e => { if (aspect == null && e.target.naturalWidth && e.target.naturalHeight) setAspect(e.target.naturalWidth / e.target.naturalHeight) }}
        className="w-full h-full"
        style={{
          imageOrientation: 'from-image',
          objectFit: z < 1 ? 'contain' : 'cover',
          transform: `rotate(${r}deg) scale(${z}) translate(${-ox}%, ${-oy}%)`,
          transformOrigin: 'center center',
        }}
      />
      <span className="absolute top-1 left-1 text-[8px] bg-black/55 text-white rounded px-1 py-0.5 pointer-events-none">9:16</span>
    </div>
  )
}

// Each grid tile is a Sortable so user can drag-reorder photos. Order
// matters for photo-carousel posts and photo-sourced Reels/Shorts where
// the sequence becomes the video timeline. Videos don't need reorder
// here — VideoMerge has its own sortable list for that — but the photo
// case was missing entirely.
//
// IMPORTANT: useSortable must only be called inside a DndContext subtree,
// otherwise iOS Safari (and some other browsers) throw / blank the page.
// We only mount this component when reorder is actually enabled so the
// hook is always reachable from a matching DndContext.
function SortableTile({ item, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 0,
    opacity: isDragging ? 0.7 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {children({ dragHandle: listeners })}
    </div>
  )
}

export default function FileGrid({ files, onRemove, onReorder, onDuplicate, VideoTrimmer, PhotoDurationBar }) {
  const [previewItem, setPreviewItem] = useState(null)

  // Only put the sensors together when we actually have more than one
  // orderable item; avoids pointer-sensor overhead for single-file drafts.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (!files.length) return null

  const hasVideos = files.some(f => f.file?.type?.startsWith('video/') || f._mediaType?.startsWith('video/'))
  // Reorder for photo grids only. Videos already reorder in VideoMerge —
  // adding it here would compete with trim-bar touches and break iOS.
  const reorderEnabled = !!onReorder && !hasVideos && files.length > 1

  const handleDragEnd = (e) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = files.findIndex(f => f.id === active.id)
    const to   = files.findIndex(f => f.id === over.id)
    if (from < 0 || to < 0) return
    onReorder(from, to)
  }

  const sortableIds = files.map(f => f.id)

  const grid = (
    <div className={hasVideos ? "flex flex-col gap-2" : "grid gap-2"} style={hasVideos ? undefined : { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
      {files.map((item, i) => {
        const isVideo = item.file?.type?.startsWith('video/') || item._mediaType?.startsWith('video/')
        const isImg = item.isImg || item._mediaType?.startsWith('image/')
        const fileName = item.file?.name || item._filename || 'Untitled'
        const tile = ({ dragHandle } = {}) => (
          <>
            <div className="border border-border rounded-sm overflow-hidden bg-white relative">
              {reorderEnabled && (
                <span
                  {...(dragHandle || {})}
                  className="absolute top-1 left-1 z-[5] text-white bg-black/55 rounded text-[10px] leading-none px-1.5 py-1 cursor-grab active:cursor-grabbing select-none"
                  style={{ touchAction: 'none' }}
                  title="Drag to reorder"
                >⋮⋮</span>
              )}
              {reorderEnabled && (
                <span className="absolute bottom-6 left-1 z-[5] text-white bg-[#6C5CE7]/90 rounded-full text-[9px] font-bold w-[18px] h-[18px] flex items-center justify-center leading-none pointer-events-none">{i + 1}</span>
              )}
              {isImg && item.file ? (
                <ImageThumb
                  file={item.file}
                  zoom={item._photoZoom}
                  rotate={item._photoRotate}
                  offsetX={item._photoOffsetX}
                  offsetY={item._photoOffsetY}
                  onClick={() => setPreviewItem(item)}
                />
              ) : isVideo && item.file ? (
                <VideoThumb file={item.file} itemId={item.id} onClick={() => setPreviewItem(item)} className="w-full bg-black" />
              ) : item._restored && (item._publicUrl || item._uploadKey) ? (
                <RestoredMedia item={item} isVideo={isVideo} onClick={() => setPreviewItem(item)} />
              ) : (
                <div
                  onClick={() => setPreviewItem(item)}
                  className="w-full h-[120px] bg-ink flex items-center justify-center text-white text-[22px] cursor-pointer hover:bg-[#333]"
                >▶</div>
              )}
              <div className="text-[9px] text-muted py-1 px-1.5 whitespace-nowrap overflow-hidden text-ellipsis" title={item._dbFileId != null ? `${fileName} · clip-${item._dbFileId}` : fileName}>
                {fileName}
                {item._dbFileId != null && (
                  <span className="text-[#6C5CE7]/80 font-mono ml-1">· clip-{item._dbFileId}</span>
                )}
              </div>
              <button
                onClick={() => onRemove(item.id)}
                className="absolute top-1 right-1 w-[18px] h-[18px] rounded-full bg-black/55 text-white text-xs flex items-center justify-center cursor-pointer border-none z-[5]"
                title="Remove from this draft"
              >&times;</button>
              {/* Duplicate — server-side copy of the source storage
                  object + a new job_files row with all the same per-clip
                  settings (trim, photo motion/zoom/rotate/offsets, speed,
                  captions, post_destinations). Lets the user keep an
                  edited variant alongside the original without re-
                  uploading from disk. Only visible once the file is
                  persisted (_dbFileId set). */}
              {item._dbFileId != null && onDuplicate && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDuplicate(item) }}
                  disabled={item._duplicating}
                  className="absolute top-1 right-6 w-[18px] h-[18px] rounded-full bg-[#6C5CE7]/85 hover:bg-[#6C5CE7] text-white text-[10px] flex items-center justify-center cursor-pointer border-none z-[5] disabled:opacity-50"
                  title="Duplicate this clip with all its settings"
                >{item._duplicating ? '…' : '⎘'}</button>
              )}
              {item.status === 'loading' && <div className="absolute bottom-5 left-0 right-0 text-center text-[9px] font-medium py-0.5 bg-sage/90 text-white">Loading...</div>}
              {item.status === 'done' && <div className="absolute bottom-5 left-0 right-0 text-center text-[9px] font-medium py-0.5 bg-tk/90 text-white">Done</div>}
              {item.status === 'error' && <div className="absolute bottom-5 left-0 right-0 text-center text-[9px] font-medium py-0.5 bg-terra/90 text-white">Error</div>}
            </div>
            {/* Trim bar right under its video */}
            {isVideo && VideoTrimmer && <VideoTrimmer item={item} />}
            {isImg && PhotoDurationBar && <PhotoDurationBar item={item} />}
          </>
        )
        // Only wrap with SortableTile when reorder is enabled — otherwise
        // useSortable runs without a DndContext parent and crashes iOS.
        if (reorderEnabled) {
          return (
            <SortableTile key={item.id} item={item}>
              {tile}
            </SortableTile>
          )
        }
        return <div key={item.id}>{tile()}</div>
      })}
    </div>
  )

  return (
    <>
      {previewItem && (
        <MediaLightbox item={previewItem} onClose={() => setPreviewItem(null)} />
      )}
      {reorderEnabled && (
        <div className="text-[10px] text-muted mb-1 flex items-center gap-1.5">
          <span className="font-mono">⋮⋮</span>
          <span>Drag tiles to reorder — this is the sequence for carousels and photo-to-video reels.</span>
        </div>
      )}
      {reorderEnabled ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
            {grid}
          </SortableContext>
        </DndContext>
      ) : grid}
    </>
  )
}
