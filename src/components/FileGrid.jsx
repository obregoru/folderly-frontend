import { useState, useEffect, useRef } from 'react'

function MediaLightbox({ file, isImg, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative max-w-[90vw] max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-ink text-lg flex items-center justify-center shadow cursor-pointer border-none z-10">&times;</button>
        {isImg ? (
          <img src={URL.createObjectURL(file)} className="max-w-full max-h-[80vh] rounded object-contain" />
        ) : (
          <video src={URL.createObjectURL(file)} controls autoPlay playsInline className="max-w-full max-h-[80vh] rounded" />
        )}
      </div>
    </div>
  )
}

function VideoThumb({ file, onClick, className }) {
  const videoRef = useRef(null)
  const [poster, setPoster] = useState(null)
  const [aspect, setAspect] = useState(null)
  const [src] = useState(() => URL.createObjectURL(file))

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onMeta = () => {
      v.currentTime = 0.5
    }
    const onSeeked = async () => {
      const w = v.videoWidth, h = v.videoHeight
      if (!w || !h) return
      try {
        // createImageBitmap respects rotation metadata from iPhone MOV/MP4
        const bmp = await createImageBitmap(v)
        const c = document.createElement('canvas')
        // Use bitmap dimensions (rotation-corrected) not video dimensions
        const bw = bmp.width, bh = bmp.height
        c.width = Math.min(bw, 300)
        c.height = Math.round(c.width * bh / bw)
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
        bmp.close()
        setAspect(bw / bh)
        setPoster(c.toDataURL('image/jpeg', 0.7))
      } catch {
        // Fallback: use video element dimensions directly
        setAspect(w / h)
        try {
          const c = document.createElement('canvas')
          c.width = Math.min(w, 300)
          c.height = Math.round(c.width * h / w)
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
          setPoster(c.toDataURL('image/jpeg', 0.7))
        } catch {}
      }
    }
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('seeked', onSeeked)
    return () => { v.removeEventListener('loadedmetadata', onMeta); v.removeEventListener('seeked', onSeeked) }
  }, [])

  // Store thumb + aspect on the file object so ResultCard can reuse it
  useEffect(() => {
    if (poster) file._videoThumb = poster
    if (aspect) file._videoAspect = aspect
  }, [poster, aspect])

  return (
    <div onClick={onClick} className={`relative cursor-pointer hover:opacity-80 ${className || ''}`}>
      {poster ? (
        <img src={poster} className="w-full h-full object-cover" />
      ) : (
        <video ref={videoRef} src={src + '#t=0.5'} className="w-full h-full object-cover" muted playsInline preload="auto" />
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-white text-[18px] bg-black/50 rounded-full w-8 h-8 flex items-center justify-center">▶</span>
      </div>
      {aspect && aspect < 1 && (
        <span className="absolute top-1 left-1 text-[7px] bg-black/50 text-white rounded px-1">Portrait</span>
      )}
    </div>
  )
}

export default function FileGrid({ files, onRemove }) {
  const [previewItem, setPreviewItem] = useState(null)

  if (!files.length) return null

  return (
    <>
      {previewItem && (
        <MediaLightbox file={previewItem.file} isImg={previewItem.isImg} onClose={() => setPreviewItem(null)} />
      )}
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
        {files.map(item => (
          <div key={item.id} className="border border-border rounded-sm overflow-hidden bg-white relative">
            {item.isImg ? (
              <img
                src={URL.createObjectURL(item.file)}
                onClick={() => setPreviewItem(item)}
                className="w-full h-[78px] object-cover block cursor-pointer hover:opacity-80"
              />
            ) : item.file.type?.startsWith('video/') ? (
              <VideoThumb file={item.file} onClick={() => setPreviewItem(item)} className="w-full h-[78px] bg-black" />
            ) : (
              <div
                onClick={() => setPreviewItem(item)}
                className="w-full h-[78px] bg-ink flex items-center justify-center text-white text-[22px] cursor-pointer hover:bg-[#333]"
              >▶</div>
            )}
            <div className="text-[9px] text-muted py-1 px-1.5 whitespace-nowrap overflow-hidden text-ellipsis">{item.file.name}</div>
            <button
              onClick={() => onRemove(item.id)}
              className="absolute top-1 right-1 w-[18px] h-[18px] rounded-full bg-black/55 text-white text-xs flex items-center justify-center cursor-pointer border-none"
            >&times;</button>
            {item.status === 'loading' && <div className="absolute bottom-5 left-0 right-0 text-center text-[9px] font-medium py-0.5 bg-sage/90 text-white">Loading...</div>}
            {item.status === 'done' && <div className="absolute bottom-5 left-0 right-0 text-center text-[9px] font-medium py-0.5 bg-tk/90 text-white">Done</div>}
            {item.status === 'error' && <div className="absolute bottom-5 left-0 right-0 text-center text-[9px] font-medium py-0.5 bg-terra/90 text-white">Error</div>}
          </div>
        ))}
      </div>
    </>
  )
}
