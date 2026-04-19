import { useState, useRef } from 'react'

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
const randThumb = () => `https://picsum.photos/seed/${Math.random().toString(36).slice(2, 8)}/80/140`
const randPhoto = () => `https://picsum.photos/seed/${Math.random().toString(36).slice(2, 8)}/720/1280`

/**
 * Media panel — handles both photos and videos. Mode decides what the
 * "build final" action does:
 *   photo-post  → Post as photo / carousel (no rendering step)
 *   video       → Merge clips / convert photos to video / combined
 *
 * Auto-infers mode from uploads:
 *   only photos, no "make video" toggle → photo-post
 *   any video OR "make video from photos" toggle → video
 *
 * User can override the inferred mode explicitly.
 */
export default function MediaPanel({ outputType, setOutputType, hasFinal, onBuild, onUnbuild }) {
  const [items, setItems] = useState([
    { id: 'm-1', kind: 'video', name: 'IMG_9336.mov', size: '14.6 MB', duration: 6.2, trimStart: 1.2, trimEnd: 4.8, speed: 1.0, thumb: 'https://picsum.photos/seed/v1/80/140' },
    { id: 'm-2', kind: 'video', name: 'IMG_9342.mov', size: '19.0 MB', duration: 8.5, trimStart: 0, trimEnd: 5.5, speed: 1.5, thumb: 'https://picsum.photos/seed/v2/80/140' },
  ])
  const [dragIdx, setDragIdx] = useState(null)
  const fileInputRef = useRef(null)

  const hasAnyVideo = items.some(i => i.kind === 'video')
  const hasAnyPhoto = items.some(i => i.kind === 'photo')
  const onlyPhotos = hasAnyPhoto && !hasAnyVideo

  // Mode can be forced by the user; default inference is based on uploads.
  const effectiveMode = outputType || (onlyPhotos ? 'photo-post' : 'video')

  const handleFiles = (fileList) => {
    const picked = Array.from(fileList || [])
    if (picked.length === 0) return
    const newItems = picked.map((f, i) => {
      const isImage = f.type.startsWith('image/')
      return isImage
        ? {
            id: `m-${Date.now()}-${i}`,
            kind: 'photo',
            name: f.name,
            size: `${(f.size / (1024 * 1024)).toFixed(1)} MB`,
            thumb: randThumb(),
            photoUrl: randPhoto(),
          }
        : {
            id: `m-${Date.now()}-${i}`,
            kind: 'video',
            name: f.name,
            size: `${(f.size / (1024 * 1024)).toFixed(1)} MB`,
            duration: 5 + Math.random() * 8,
            trimStart: 0,
            trimEnd: null,
            speed: 1.0,
            thumb: randThumb(),
          }
    })
    setItems(prev => [...prev, ...newItems])
  }

  const updateItem = (id, patch) => setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))
  const removeItem = (id) => setItems(prev => prev.filter(i => i.id !== id))
  const move = (from, to) => {
    setItems(prev => {
      const next = [...prev]
      const [r] = next.splice(from, 1)
      next.splice(to, 0, r)
      return next
    })
  }

  const total = items.filter(i => i.kind === 'video').reduce((sum, c) => {
    const trimLen = Math.max(0, (c.trimEnd ?? c.duration) - (c.trimStart ?? 0))
    return sum + trimLen / c.speed
  }, 0)

  const buildLabel = effectiveMode === 'photo-post'
    ? (items.length > 1 ? `Use as carousel (${items.length} photos)` : 'Use photo')
    : (items.length > 1 ? `Merge ${items.length} items →` : 'Use video')

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">Media ({items.length})</div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,image/*"
          multiple
          onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-[10px] py-1 px-2.5 border border-[#6C5CE7] text-[#6C5CE7] rounded bg-white cursor-pointer"
        >+ Upload</button>
      </div>

      {/* Output mode — auto-inferred with explicit override. Hidden if
          empty (no uploads yet to infer from). */}
      {items.length > 0 && (
        <div className="flex items-center gap-1 bg-[#f8f7f3] rounded-lg p-0.5">
          <button
            onClick={() => setOutputType('photo-post')}
            disabled={hasAnyVideo && !onlyPhotos}
            title={hasAnyVideo ? 'Photo post not available when videos are in the list — remove videos first, or switch to Video mode.' : ''}
            className={`flex-1 text-[10px] py-1.5 rounded-md border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${effectiveMode === 'photo-post' ? 'bg-white text-ink shadow-sm font-medium' : 'bg-transparent text-muted'}`}
          >📸 Photo post</button>
          <button
            onClick={() => setOutputType('video')}
            className={`flex-1 text-[10px] py-1.5 rounded-md border-none cursor-pointer ${effectiveMode === 'video' ? 'bg-white text-ink shadow-sm font-medium' : 'bg-transparent text-muted'}`}
          >🎬 Video</button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-[10px] text-muted italic text-center py-8 bg-[#f8f7f3] rounded-lg">
          Tap <b>+ Upload</b> to pick photos or videos.
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((it, i) => (
            <div
              key={it.id}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { if (dragIdx != null && dragIdx !== i) move(dragIdx, i); setDragIdx(null) }}
              className={`flex items-center gap-2 bg-[#f8f7f3] border border-[#e5e5e5] rounded px-2 py-1.5 ${dragIdx === i ? 'opacity-50' : ''}`}
            >
              <span className="text-muted cursor-grab text-[14px] leading-none select-none px-0.5" title="Drag to reorder">⋮⋮</span>
              <span className="text-muted text-[10px] w-4">{i + 1}.</span>
              {it.thumb ? (
                <img src={it.thumb} alt="" className="w-8 h-11 rounded object-cover flex-shrink-0" />
              ) : (
                <div className="w-8 h-11 bg-[#e5e5e5] rounded flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[11px] truncate font-medium">
                  <span className="text-[9px] text-muted mr-1">{it.kind === 'photo' ? '📸' : '🎬'}</span>
                  {it.name}
                </div>
                <div className="text-[9px] text-muted">
                  {it.size}
                  {it.kind === 'video' && (
                    <>
                      {' · '}
                      {it.speed !== 1 ? (
                        <>
                          {((it.trimEnd ?? it.duration) - it.trimStart).toFixed(1)}s →{' '}
                          <b className="text-ink">{(((it.trimEnd ?? it.duration) - it.trimStart) / it.speed).toFixed(1)}s</b>
                        </>
                      ) : (
                        <>{((it.trimEnd ?? it.duration) - it.trimStart).toFixed(1)}s</>
                      )}
                    </>
                  )}
                </div>
              </div>
              {it.kind === 'video' && (
                <select
                  value={String(it.speed)}
                  onChange={e => updateItem(it.id, { speed: Number(e.target.value) })}
                  className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
                >
                  {SPEED_OPTIONS.map(s => <option key={s} value={s}>{s}×</option>)}
                </select>
              )}
              <button
                onClick={() => removeItem(it.id)}
                className="text-[9px] text-[#c0392b] bg-transparent border-none cursor-pointer px-1"
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {effectiveMode === 'video' && items.length > 1 && (
        <div className="flex items-center gap-2 text-[10px]">
          <label className="text-muted">Transition:</label>
          <select className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white">
            <option>Hard cut</option>
            <option>Crossfade</option>
            <option>Fade to black</option>
          </select>
          <span className="text-muted ml-auto">Total ~{total.toFixed(1)}s</span>
        </div>
      )}

      {items.length > 0 && (
        <button
          onClick={() => onBuild(items.filter(i => i.kind === 'photo').map(i => i.photoUrl))}
          className="w-full py-2 bg-[#2D9A5E] text-white text-[12px] font-medium border-none rounded cursor-pointer"
        >
          {hasFinal ? `Re-build (${buildLabel.toLowerCase()})` : buildLabel}
        </button>
      )}

      {hasFinal && (
        <button
          onClick={onUnbuild}
          className="text-[10px] text-[#c0392b] underline bg-transparent border-none cursor-pointer p-0"
        >Discard final {effectiveMode === 'photo-post' ? 'post' : 'video'}</button>
      )}
    </div>
  )
}
