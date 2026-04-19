import { useState } from 'react'

/**
 * Final output preview — mode-aware. Three shapes:
 *   - photo-post-single   → one image fills the frame
 *   - photo-post-carousel → swipeable slides
 *   - video               → video player (merged / single / photo-to-video)
 *
 * This is the single anchor surface the whole editor revolves around.
 * Every downstream tool attaches to it; no tool owns its own preview.
 */
export default function FinalPreview({ outputType, hasFinal, photos = [] }) {
  const [slideIdx, setSlideIdx] = useState(0)

  const isPhotoPost = outputType === 'photo-post'
  const isCarousel = isPhotoPost && photos.length > 1

  return (
    <div className="bg-black rounded-lg overflow-hidden relative aspect-[9/16] max-h-[56vh] w-[80%] mx-auto">
      {!hasFinal ? (
        <div className="w-full h-full flex flex-col items-center justify-center text-white/70 p-6 text-center">
          <div className="text-[36px] mb-2">{isPhotoPost ? '📸' : '🎬'}</div>
          <div className="text-[13px] font-medium text-white">
            {isPhotoPost ? 'No photos yet' : 'No final video yet'}
          </div>
          <div className="text-[11px] mt-1">
            {isPhotoPost
              ? 'Upload photos in Media — they post as-is or as a carousel.'
              : 'Upload clips or photos in Media, then tap Merge.'}
          </div>
        </div>
      ) : isPhotoPost ? (
        <>
          <img
            src={photos[slideIdx] || photos[0]}
            alt=""
            className="w-full h-full object-cover"
          />
          {isCarousel && (
            <>
              {/* Carousel nav */}
              <button
                onClick={() => setSlideIdx(i => Math.max(0, i - 1))}
                disabled={slideIdx === 0}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 text-white border-none cursor-pointer disabled:opacity-30"
              >‹</button>
              <button
                onClick={() => setSlideIdx(i => Math.min(photos.length - 1, i + 1))}
                disabled={slideIdx === photos.length - 1}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 text-white border-none cursor-pointer disabled:opacity-30"
              >›</button>
              {/* Dots indicator */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1">
                {photos.map((_, i) => (
                  <span
                    key={i}
                    className={`w-1.5 h-1.5 rounded-full ${i === slideIdx ? 'bg-white' : 'bg-white/40'}`}
                  />
                ))}
              </div>
            </>
          )}
          <div className="absolute top-2 left-2 text-[10px] text-white bg-[#2D9A5E]/80 rounded-full px-2 py-0.5">
            {isCarousel ? `Carousel · ${slideIdx + 1} / ${photos.length}` : 'Photo post'}
          </div>
        </>
      ) : (
        <>
          <img
            src="https://picsum.photos/seed/final/720/1280"
            alt="Merged preview"
            className="w-full h-full object-cover"
          />
          <button
            className="absolute inset-0 flex items-center justify-center bg-transparent border-none cursor-pointer"
            onClick={() => alert('Mock: would play the merged video here')}
          >
            <div className="w-16 h-16 rounded-full bg-black/50 flex items-center justify-center">
              <div style={{
                width: 0, height: 0,
                borderLeft: '20px solid white',
                borderTop: '12px solid transparent',
                borderBottom: '12px solid transparent',
                marginLeft: 6,
              }} />
            </div>
          </button>
          <div className="absolute top-2 left-2 text-[10px] text-white bg-[#2D9A5E]/80 rounded-full px-2 py-0.5">
            Video · 22.4s
          </div>
        </>
      )}
    </div>
  )
}
