// Capture a single frame from a video source at a specific time.
// Uses an off-document <video> element + <canvas> to extract a JPEG
// data URL. Works with blob: URLs directly, and with remote URLs when
// crossOrigin='anonymous' is honored by the server (Supabase public
// URLs are fine).
export function captureVideoFrameAt(src, seconds, opts = {}) {
  const { width = 480, quality = 0.72 } = opts
  return new Promise((resolve) => {
    if (!src) return resolve(null)
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    // crossOrigin is only needed for remote URLs — setting it on blob:
    // URLs is harmless.
    if (!src.startsWith('blob:')) video.crossOrigin = 'anonymous'
    video.src = src
    let settled = false
    const finish = (dataUrl) => {
      if (settled) return
      settled = true
      try { video.src = '' } catch {}
      resolve(dataUrl)
    }
    // iOS Safari sometimes never fires onseeked; time out after 5s.
    const timer = setTimeout(() => finish(null), 5000)
    video.onloadedmetadata = () => {
      const t = Math.max(0, Math.min(Number(seconds) || 0, (video.duration || 0) - 0.05))
      try { video.currentTime = t } catch { finish(null) }
    }
    video.onseeked = () => {
      try {
        const naturalW = video.videoWidth || 1080
        const naturalH = video.videoHeight || 1920
        const scale = Math.min(1, width / naturalW)
        const w = Math.round(naturalW * scale)
        const h = Math.round(naturalH * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0, w, h)
        clearTimeout(timer)
        finish(canvas.toDataURL('image/jpeg', quality))
      } catch (e) {
        // Cross-origin taint → canvas.toDataURL throws. Return null;
        // caller falls back to text-only review.
        console.warn('[captureVideoFrameAt] tainted canvas or error:', e?.message)
        clearTimeout(timer)
        finish(null)
      }
    }
    video.onerror = () => { clearTimeout(timer); finish(null) }
  })
}

// Capture frames at an array of timestamps. Returns a parallel array of
// { startTime, dataUrl } — dataUrl may be null when capture failed for
// a given frame; caller should handle.
export async function captureVideoFrames(src, timestamps = [], opts = {}) {
  if (!src || !Array.isArray(timestamps) || timestamps.length === 0) return []
  // Run sequentially because reusing one <video> is cheaper than N in parallel
  // and most phones can't decode many video elements at once.
  const out = []
  for (const t of timestamps) {
    const dataUrl = await captureVideoFrameAt(src, t, opts)
    out.push({ startTime: Number(t) || 0, dataUrl })
  }
  return out
}

// Strip the "data:image/jpeg;base64," prefix from a data URL.
export function dataUrlToBase64(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null
  const idx = dataUrl.indexOf('base64,')
  return idx >= 0 ? dataUrl.slice(idx + 7) : null
}
