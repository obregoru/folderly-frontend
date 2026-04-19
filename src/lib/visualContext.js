// Visual-context orchestration.
//
// Every AI call that benefits from knowing "what's in the media" reads a
// TEXT summary produced once per upload by the /generate/describe-media
// endpoint. Raw base64 images never leave the client twice.
//
// Lifecycle per upload:
//   1. Upload completes (photo or video).
//   2. describeUpload(item) captures frames (if video) or the image bytes
//      (if photo), hits /generate/describe-media, stores the result on
//      item._visualDescription AND persists it to the backend upload row.
//   3. Every subsequent AI call for this job reads the cached text via
//      buildJobVisualContext(items).
//   4. Cache stays valid until the upload is replaced or removed — new
//      uploads trigger another describeUpload call.

import * as api from '../api'
import { captureVideoFrames, dataUrlToBase64 } from './videoFrames'

// Extract a photo-ready base64 payload from an upload item. Uses the
// existing thumbnail / preview if available to avoid re-reading the
// original file from disk.
async function photoToBase64(item) {
  if (!item) return null
  // Prefer _previewUrl or thumbnail_path URL over re-reading item.file
  const url = item._previewUrl || item.thumbnail_url || item.thumbnail_path
  if (url) {
    try {
      const r = await fetch(url, { credentials: 'include' })
      if (!r.ok) throw new Error(`fetch thumbnail ${r.status}`)
      const blob = await r.blob()
      return blobToDataUrl(blob).then(dataUrlToBase64)
    } catch (e) {
      console.warn('[visualContext] thumbnail fetch failed, falling back to file:', e.message)
    }
  }
  if (item.file instanceof Blob) {
    return blobToDataUrl(item.file).then(dataUrlToBase64)
  }
  return null
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

// Capture a small coverage frame set from a video upload. Uses the same
// captureVideoFrames helper the voiceover flow uses. Picks 3-4 timestamps
// spread across the clip.
async function videoFramesBase64(item) {
  const src = (item.file instanceof Blob) ? URL.createObjectURL(item.file)
    : (item._previewUrl || item.video_url || null)
  if (!src) return []
  try {
    const el = document.createElement('video')
    el.src = src
    el.muted = true
    await new Promise((res, rej) => {
      el.onloadedmetadata = res
      el.onerror = rej
      setTimeout(rej, 8000)
    })
    const dur = Math.max(0.5, el.duration || 0)
    const timestamps = dur < 3
      ? [0, dur / 2]
      : [0, dur * 0.25, dur * 0.5, dur * 0.75]
    const shots = await captureVideoFrames(src, timestamps, { width: 480, quality: 0.72 })
    return shots
      .map(s => ({ startTime: s.startTime, dataUrl: s.dataUrl }))
      .filter(s => s.dataUrl)
      .map(s => ({ startTime: s.startTime, image_base64: dataUrlToBase64(s.dataUrl) }))
  } catch (e) {
    console.warn('[visualContext] video frame capture failed:', e.message)
    return []
  } finally {
    if (src && src.startsWith('blob:')) { try { URL.revokeObjectURL(src) } catch {} }
  }
}

// Determine if an item is a photo vs video. Falls back to filename check.
function itemMediaKind(item) {
  const t = (item._mediaType || item.media_type || item.file?.type || '').toLowerCase()
  if (t.startsWith('image/')) return 'photo'
  if (t.startsWith('video/')) return 'video'
  if (item.filename && /\.(jpe?g|png|webp|gif|heic)$/i.test(item.filename)) return 'photo'
  if (item.filename && /\.(mp4|mov|webm|m4v)$/i.test(item.filename)) return 'video'
  return 'photo'
}

// Describe a single upload item. Idempotent — skips the call if the item
// already has a cached description. Stores result on item._visualDescription
// AND persists to the backend if the item has a server uuid.
export async function describeUpload(item, { force = false, jobUuid = null } = {}) {
  if (!item) return null
  if (!force) {
    if (item._visualDescription?.summary) return item._visualDescription
    if (item.visual_description?.summary) {
      item._visualDescription = item.visual_description
      return item._visualDescription
    }
  }
  const kind = itemMediaKind(item)
  let frames = []
  if (kind === 'photo') {
    const b64 = await photoToBase64(item)
    if (b64) frames.push({ startTime: 0, image_base64: b64 })
  } else {
    frames = await videoFramesBase64(item)
  }
  if (frames.length === 0) {
    console.warn('[visualContext] no frames captured for', item.filename || item.id)
    return null
  }
  try {
    const r = await api.describeMedia({
      frames,
      mediaType: kind,
      hint: item._hint || null,
      jobUuid: jobUuid || item._jobUuid || null,
    })
    if (r?.error) throw new Error(r.error)
    if (!r?.summary) throw new Error('missing summary')
    item._visualDescription = r
    // Persist to backend when we have a server-side uuid. Non-fatal if it fails.
    const uuid = item.uuid || item.id
    if (uuid && typeof uuid === 'string' && uuid.length >= 32) {
      api.saveUploadVisualDescription(uuid, r).catch(e => {
        console.warn('[visualContext] persist failed:', e.message)
      })
    }
    return r
  } catch (e) {
    console.warn('[visualContext] describe failed for', item.filename || item.id, e.message)
    return null
  }
}

// Describe every item in a list that doesn't already have a description.
// Returns a map of { itemId → description }. Runs sequentially to avoid
// hammering the API.
export async function describeAllUploads(items) {
  const out = {}
  for (const item of items || []) {
    const d = await describeUpload(item)
    if (d) out[item.id || item.uuid] = d
  }
  return out
}

// Build the text block to inject into a downstream AI call's prompt.
// Concatenates each item's summary with clear labeling. Caller passes
// an array of upload items; items without a cached description are
// skipped (they just don't contribute context).
export function buildJobVisualContext(items) {
  if (!Array.isArray(items) || items.length === 0) return ''
  const blocks = []
  items.forEach((item, i) => {
    const d = item._visualDescription || item.visual_description
    if (!d?.summary) return
    const label = item.filename || `item ${i + 1}`
    blocks.push(`## ${label}\n${d.summary.trim()}`)
  })
  if (blocks.length === 0) return ''
  return `MEDIA VISUAL CONTEXT (${blocks.length} item${blocks.length === 1 ? '' : 's'}):\n\n${blocks.join('\n\n')}`
}

// Single-item scene_context — useful for flows that want group size /
// audience / occasion without the full prose summary.
export function buildSceneContextSummary(items) {
  if (!Array.isArray(items) || items.length === 0) return null
  for (const item of items) {
    const d = item._visualDescription || item.visual_description
    if (d?.scene_context) return d.scene_context
  }
  return null
}
