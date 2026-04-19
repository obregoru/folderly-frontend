import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

/**
 * Final output preview — the single video/photo surface every v2 tool
 * attaches to. Exposes the internal `<video>` element via an imperative
 * handle so voiceover / overlay / etc panels can drive it without
 * owning their own player.
 *
 * Source priority:
 *   1. Merged video (window._postyMergedVideo.url)
 *   2. Single uploaded video's preview URL
 *   3. Photo carousel (all photos, onlyPhotos == true)
 *   4. Empty state
 */
const FinalPreviewV2 = forwardRef(function FinalPreviewV2({ files, restoredMergeUrl }, ref) {
  const videoRef = useRef(null)
  const [mergedUrl, setMergedUrl] = useState(
    restoredMergeUrl || (typeof window !== 'undefined' ? window._postyMergedVideo?.url : null) || null
  )

  // Expose the <video> element to parents (voiceover panel, etc).
  useImperativeHandle(ref, () => ({
    getVideo: () => videoRef.current,
  }), [])

  useEffect(() => {
    const sync = () => setMergedUrl(window._postyMergedVideo?.url || null)
    window.addEventListener('posty-merge-change', sync)
    return () => window.removeEventListener('posty-merge-change', sync)
  }, [])

  const videoFiles = (files || []).filter(f => f.file?.type?.startsWith('video/') || f._mediaType?.startsWith('video/'))
  const photoFiles = (files || []).filter(f => f.file?.type?.startsWith('image/') || f._mediaType?.startsWith('image/'))
  const onlyPhotos = files.length > 0 && videoFiles.length === 0 && photoFiles.length > 0

  let source = null
  if (mergedUrl) source = { type: 'video', url: mergedUrl }
  else if (videoFiles.length === 1 && videoFiles[0]._previewUrl) source = { type: 'video', url: videoFiles[0]._previewUrl }
  else if (onlyPhotos) source = { type: 'photo', urls: photoFiles.map(f => f._previewUrl).filter(Boolean) }

  return (
    <div className="bg-black rounded-lg overflow-hidden relative aspect-[9/16] max-h-[56vh] w-[80%] mx-auto">
      {!source ? (
        <div className="w-full h-full flex flex-col items-center justify-center text-white/70 p-6 text-center">
          <div className="text-[36px] mb-2">{onlyPhotos ? '📸' : '🎬'}</div>
          <div className="text-[13px] font-medium text-white">
            {files.length > 0 ? 'Merge your clips to see the preview' : 'No media uploaded yet'}
          </div>
          <div className="text-[11px] mt-1">
            {files.length > 0
              ? (videoFiles.length >= 2 ? 'Use the Clips tab to merge your videos.' : 'Upload more clips or photos in the Clips tab.')
              : 'Upload photos or videos in the Clips tab below.'}
          </div>
        </div>
      ) : source.type === 'video' ? (
        <>
          <video
            ref={videoRef}
            src={source.url}
            controls
            playsInline
            className="w-full h-full object-contain bg-black"
          />
          {mergedUrl && (
            <div className="absolute top-2 left-2 text-[10px] text-white bg-[#2D9A5E]/80 rounded-full px-2 py-0.5 pointer-events-none">
              Merged
            </div>
          )}
        </>
      ) : (
        <PhotoCarousel urls={source.urls} />
      )}
    </div>
  )
})

function PhotoCarousel({ urls }) {
  const [idx, setIdx] = useState(0)
  if (urls.length === 0) return null
  return (
    <>
      <img src={urls[idx]} alt="" className="w-full h-full object-cover" />
      {urls.length > 1 && (
        <>
          <button
            onClick={() => setIdx(i => Math.max(0, i - 1))}
            disabled={idx === 0}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 text-white border-none cursor-pointer disabled:opacity-30"
          >‹</button>
          <button
            onClick={() => setIdx(i => Math.min(urls.length - 1, i + 1))}
            disabled={idx === urls.length - 1}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 text-white border-none cursor-pointer disabled:opacity-30"
          >›</button>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1">
            {urls.map((_, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === idx ? 'bg-white' : 'bg-white/40'}`} />
            ))}
          </div>
          <div className="absolute top-2 left-2 text-[10px] text-white bg-[#2D9A5E]/80 rounded-full px-2 py-0.5 pointer-events-none">
            Carousel · {idx + 1} / {urls.length}
          </div>
        </>
      )}
    </>
  )
}

export default FinalPreviewV2
