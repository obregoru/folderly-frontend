// Browser-side image compression before upload.
//
// Phone photos routinely arrive at 3-12 MB. Posty Posty's upload
// pipeline buffers them in Railway memory then re-uploads to
// Supabase — two network hops, both throttled by the slowest one.
// Compressing client-side cuts payload typically 10-20×, taking
// the visible wait time from 8-20 seconds down to 1-2 seconds.
//
// Strategy:
//   1. Skip if file is already small (≤ SKIP_BYTES) or non-image.
//   2. Decode via createImageBitmap (fast, off main thread on most
//      browsers) — falls back to <img> + onload for older Safari.
//   3. Compute target dimensions: shrink so the longer edge is
//      MAX_EDGE (2000 px — 4K-display friendly, retains plenty
//      of detail for landing-page hero/inline use). Never upscale.
//   4. Draw to an offscreen canvas, re-encode at JPEG_QUALITY.
//      PNG inputs with transparency stay PNG (no quality loss).
//   5. If the encoded blob is SMALLER than the original, return
//      the new File. Otherwise return the original — compression
//      sometimes inflates already-optimized assets.
//
// All operations swallow errors and fall through to the original
// file so a compression bug never blocks an upload.

const SKIP_BYTES = 500 * 1024;     // ≤ 500 KB → already small, ship as-is
const MAX_EDGE = 2000;             // max longer side after resize
const JPEG_QUALITY = 0.85;
const SUPPORTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

async function decodeFile(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file) } catch { /* fall through */ }
  }
  // Legacy fallback — <img> via FileReader. Slower but universally supported.
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Image decode failed'))
      img.src = reader.result
    }
    reader.onerror = () => reject(new Error('FileReader failed'))
    reader.readAsDataURL(file)
  })
}

function pickOutputMime(mime, hasTransparency) {
  // PNG with transparency stays PNG so we don't bake in a white bg.
  // Everything else encodes to JPEG for best size/quality tradeoff.
  if (mime === 'image/png' && hasTransparency) return 'image/png'
  return 'image/jpeg'
}

// Detect transparency by sampling the alpha channel. Cheap — we
// only need to know if ANY pixel is non-opaque.
function hasAlpha(canvas) {
  try {
    const ctx = canvas.getContext('2d')
    const w = canvas.width, h = canvas.height
    // Stride sample — every Nth pixel, where N is chosen so we read
    // ~10k samples regardless of size.
    const stride = Math.max(1, Math.floor((w * h) / 10000))
    const data = ctx.getImageData(0, 0, w, h).data
    for (let i = 3; i < data.length; i += 4 * stride) {
      if (data[i] !== 255) return true
    }
    return false
  } catch { return false }
}

// Public API. Returns { file, originalSize, compressedSize, skipped, reason }.
// `file` is always a File the caller can hand to FormData.
export async function compressImageForUpload(file, opts = {}) {
  const result = { file, originalSize: file?.size || 0, compressedSize: file?.size || 0, skipped: true, reason: 'no-op' }
  if (!file || !file.size) return result
  if (!SUPPORTED_MIME.has(file.type)) {
    result.reason = `unsupported mime ${file.type}`
    return result
  }
  if (file.size <= SKIP_BYTES) {
    result.reason = 'already small'
    return result
  }

  const maxEdge = opts.maxEdge || MAX_EDGE
  const quality = opts.quality ?? JPEG_QUALITY

  try {
    const bitmap = await decodeFile(file)
    const srcW = bitmap.width || bitmap.naturalWidth
    const srcH = bitmap.height || bitmap.naturalHeight
    if (!srcW || !srcH) {
      result.reason = 'no dimensions'
      return result
    }
    // Compute target — never upscale.
    let dstW = srcW, dstH = srcH
    const longer = Math.max(srcW, srcH)
    if (longer > maxEdge) {
      const ratio = maxEdge / longer
      dstW = Math.round(srcW * ratio)
      dstH = Math.round(srcH * ratio)
    }
    const canvas = (typeof OffscreenCanvas === 'function')
      ? new OffscreenCanvas(dstW, dstH)
      : Object.assign(document.createElement('canvas'), { width: dstW, height: dstH })
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, dstW, dstH)
    if (bitmap.close) bitmap.close()

    const outMime = pickOutputMime(file.type, hasAlpha(canvas))
    // OffscreenCanvas uses convertToBlob; HTMLCanvasElement uses toBlob.
    const blob = canvas.convertToBlob
      ? await canvas.convertToBlob({ type: outMime, quality })
      : await new Promise((resolve, reject) => {
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob returned null')), outMime, quality)
        })

    if (!blob) {
      result.reason = 'encode returned null'
      return result
    }
    // Inflation guard.
    if (blob.size >= file.size) {
      result.reason = `compressed (${blob.size}) ≥ original (${file.size})`
      return result
    }
    // Build a File so multer + the BE see a real filename + mime.
    const newExt = outMime === 'image/png' ? '.png' : '.jpg'
    const baseName = (file.name || 'image').replace(/\.[^.]+$/, '')
    const newName = `${baseName}${newExt}`
    const compressed = new File([blob], newName, { type: outMime })
    return {
      file: compressed,
      originalSize: file.size,
      compressedSize: compressed.size,
      skipped: false,
      reason: `${srcW}×${srcH} → ${dstW}×${dstH}, ${outMime}`,
    }
  } catch (e) {
    result.reason = `error: ${e?.message || e}`
    return result
  }
}
