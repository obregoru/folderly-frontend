import * as faceapi from 'face-api.js'

export const CROP_RATIOS = [
  { label: 'TikTok 9:16', w: 1080, h: 1920, wm: 'top-left' },
  { label: 'IG Square 1:1', w: 1080, h: 1080, wm: 'top-right' },
  { label: 'IG Portrait 4:5', w: 1080, h: 1350, wm: 'top-right' },
  { label: 'FB 16:9', w: 1200, h: 630, wm: 'bottom-right' },
  { label: 'X 16:9', w: 1200, h: 675, wm: 'bottom-right' },
  { label: 'Google 4:3', w: 1200, h: 900, wm: 'bottom-right' },
]

let faceModelLoaded = false

export async function loadFaceModel() {
  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri('/models')
    faceModelLoaded = true
  } catch (e) {
    console.warn('Face detection model failed to load:', e)
  }
}

export function detectFaces(item) {
  if (item._facesPromise) return item._facesPromise
  item._facesPromise = new Promise(resolve => {
    if (!item.isImg || !faceModelLoaded) { resolve(null); return }
    const img = new Image()
    img.onload = () => {
      faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 }))
        .then(detections => {
          if (!detections || !detections.length) { resolve(null); return }
          let cx = 0, cy = 0
          detections.forEach(d => { cx += d.box.x + d.box.width / 2; cy += d.box.y + d.box.height / 2 })
          resolve({ x: cx / detections.length, y: cy / detections.length, count: detections.length })
        })
        .catch(() => resolve(null))
    }
    img.onerror = () => resolve(null)
    img.src = URL.createObjectURL(item.file)
  })
  return item._facesPromise
}

export function smartCrop(item, cr) {
  return detectFaces(item).then(faceCenter => {
    return new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = cr.w; canvas.height = cr.h
        const ctx = canvas.getContext('2d')
        const scale = Math.max(cr.w / img.width, cr.h / img.height)
        const sw = cr.w / scale, sh = cr.h / scale
        let sx, sy
        if (faceCenter) {
          sx = faceCenter.x - sw / 2
          sy = faceCenter.y - sh / 2
          sx = Math.max(0, Math.min(sx, img.width - sw))
          sy = Math.max(0, Math.min(sy, img.height - sh))
        } else {
          sx = (img.width - sw) / 2
          sy = (img.height - sh) / 2
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cr.w, cr.h)
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.92)
      }
      img.src = URL.createObjectURL(item.file)
    })
  })
}

let _wmImgCache = null

export function loadWatermarkImg(apiUrl) {
  if (_wmImgCache) return Promise.resolve(_wmImgCache)
  return fetch(apiUrl + '/settings').then(r => r.json()).then(s => {
    if (!s.watermark_enabled || !s.watermark_path) return null
    return new Promise(resolve => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => { _wmImgCache = img; resolve(img) }
      img.onerror = () => resolve(null)
      img.src = '/uploads/' + s.watermark_path
    })
  })
}

export function clearWatermarkCache() {
  _wmImgCache = null
}

export function applyWatermark(blob, placement, apiUrl) {
  if (blob._watermarked) return Promise.resolve(blob)
  return loadWatermarkImg(apiUrl).then(wmImg => {
    if (!wmImg) return blob
    return new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width; canvas.height = img.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const isTall = canvas.height > canvas.width * 1.5
        const wmW = Math.round(canvas.width * (isTall ? 0.12 : 0.15))
        const wmH = Math.round(wmW * (wmImg.height / wmImg.width))
        const margin = Math.round(canvas.width * (isTall ? 0.05 : 0.03))
        const pos = placement || 'bottom-right'
        let x, y
        if (pos === 'top-left') { x = margin; y = margin }
        else if (pos === 'top-right') { x = canvas.width - wmW - margin; y = margin }
        else if (pos === 'bottom-left') { x = margin; y = canvas.height - wmH - margin }
        else { x = canvas.width - wmW - margin; y = canvas.height - wmH - margin }
        ctx.globalAlpha = 0.5
        ctx.drawImage(wmImg, x, y, wmW, wmH)
        ctx.globalAlpha = 1
        canvas.toBlob(b => { b._watermarked = true; resolve(b) }, 'image/jpeg', 0.92)
      }
      img.src = URL.createObjectURL(blob)
    })
  })
}

export function captureVideoFrame(file) {
  return new Promise(resolve => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    const url = URL.createObjectURL(file)
    video.src = url
    video.onloadeddata = () => { video.currentTime = Math.min(1, video.duration / 2) }
    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth; canvas.height = video.videoHeight
      canvas.getContext('2d').drawImage(video, 0, 0)
      canvas.toBlob(blob => { URL.revokeObjectURL(url); resolve(blob) }, 'image/jpeg', 0.85)
    }
    video.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    setTimeout(() => { if (!video.seeked) { URL.revokeObjectURL(url); resolve(null) } }, 5000)
  })
}

export function toBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result.split(',')[1])
    r.onerror = reject
    r.readAsDataURL(file)
  })
}
