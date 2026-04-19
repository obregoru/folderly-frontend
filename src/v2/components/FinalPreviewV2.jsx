import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

/**
 * Final output preview — the single video/photo surface every v2 tool
 * attaches to. Exposes the internal `<video>` element via an imperative
 * handle so voiceover / overlay / etc panels can drive it without
 * owning their own player.
 *
 * Overlay preview: reads window._postyOverlays (seeded by OverlaysPanelV2)
 * and/or files[0]._overlaySettings (from restored job), and renders the
 * active overlay text (opening / middle / closing) on top of the video in
 * sync with currentTime. Not frame-perfect — timeupdate fires ~4–6×/sec,
 * same as the real-app behavior; the final burned-in ffmpeg render is
 * exact.
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
  const [overlays, setOverlays] = useState(() => {
    if (typeof window !== 'undefined' && window._postyOverlays) return window._postyOverlays
    return null
  })
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useImperativeHandle(ref, () => ({ getVideo: () => videoRef.current }), [])

  // Merge-change subscription
  useEffect(() => {
    const sync = () => setMergedUrl(window._postyMergedVideo?.url || null)
    window.addEventListener('posty-merge-change', sync)
    return () => window.removeEventListener('posty-merge-change', sync)
  }, [])

  // Overlay-change subscription
  useEffect(() => {
    const sync = (e) => setOverlays(e?.detail || window._postyOverlays || null)
    window.addEventListener('posty-overlay-change', sync)
    return () => window.removeEventListener('posty-overlay-change', sync)
  }, [])

  // Seed overlays from the restored file's _overlaySettings when we don't
  // already have a window-level value (i.e. user hasn't opened Overlays yet
  // in this session, but the draft was loaded from the server).
  useEffect(() => {
    if (overlays) return
    const restored = files?.[0]?._overlaySettings
    if (restored && Object.keys(restored).length > 0) {
      setOverlays(restored)
      try { if (typeof window !== 'undefined') window._postyOverlays = restored } catch {}
    }
  }, [files, overlays])

  // Track video time / duration for overlay timing
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => setCurrentTime(v.currentTime || 0)
    const onDur  = () => setDuration(v.duration || 0)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('loadedmetadata', onDur)
    v.addEventListener('durationchange', onDur)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('loadedmetadata', onDur)
      v.removeEventListener('durationchange', onDur)
    }
  }, [mergedUrl]) // re-attach when source changes

  const videoFiles = (files || []).filter(f => f.file?.type?.startsWith('video/') || f._mediaType?.startsWith('video/'))
  const photoFiles = (files || []).filter(f => f.file?.type?.startsWith('image/') || f._mediaType?.startsWith('image/'))
  const onlyPhotos = files.length > 0 && videoFiles.length === 0 && photoFiles.length > 0

  let source = null
  if (mergedUrl) source = { type: 'video', url: mergedUrl }
  else if (videoFiles.length === 1 && videoFiles[0]._previewUrl) source = { type: 'video', url: videoFiles[0]._previewUrl }
  else if (onlyPhotos) source = { type: 'photo', urls: photoFiles.map(f => f._previewUrl).filter(Boolean) }

  const activeOverlayText = useMemo(() => {
    if (!overlays) return null
    const t = currentTime
    const openDur   = Number(overlays.openingDuration)   || 0
    const midStart  = Number(overlays.middleStartTime)   || 0
    const midDur    = Number(overlays.middleDuration)    || 0
    const closeDur  = Number(overlays.closingDuration)   || 0
    if (overlays.openingText && t < openDur) return overlays.openingText
    if (overlays.middleText && t >= midStart && t < midStart + midDur) return overlays.middleText
    if (overlays.closingText && duration > 0 && t >= duration - closeDur) return overlays.closingText
    return null
  }, [overlays, currentTime, duration])

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
          {activeOverlayText && (
            <OverlayText text={activeOverlayText} style={overlays} />
          )}
        </>
      ) : (
        <PhotoCarousel urls={source.urls} />
      )}
    </div>
  )
})

function OverlayText({ text, style }) {
  const fontSize = Math.max(10, Math.round((Number(style?.storyFontSize) || 48) * 0.45))
  const color = style?.storyFontColor || '#ffffff'
  const family = style?.storyFontFamily || 'sans-serif'
  const outlineWidth = style?.storyFontOutline === false ? 0 : Math.max(0, Number(style?.storyFontOutlineWidth) || 3)
  // Emulate SSA outline with a multi-direction text-shadow.
  const shadow = outlineWidth > 0
    ? Array.from({ length: 8 }).map((_, i) => {
        const ang = (i / 8) * Math.PI * 2
        return `${Math.cos(ang) * outlineWidth}px ${Math.sin(ang) * outlineWidth}px 0 #000`
      }).join(', ')
    : 'none'

  return (
    <div
      className="absolute inset-x-0 flex items-center justify-center pointer-events-none px-4 text-center"
      style={{ top: '50%', transform: 'translateY(-50%)' }}
    >
      <div
        style={{
          fontSize: `${fontSize}px`,
          color,
          fontFamily: family,
          textShadow: shadow,
          fontWeight: 700,
          lineHeight: 1.1,
          maxWidth: '95%',
          whiteSpace: 'pre-wrap',
        }}
      >
        {text}
      </div>
    </div>
  )
}

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
