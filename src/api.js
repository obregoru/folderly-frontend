// Always use VITE_API_URL if set, otherwise empty (for Vite proxy)
const BASE = import.meta.env.VITE_API_URL || ''

function getTenantSlug() {
  const meta = document.querySelector('meta[name="tenant-slug"]')
  if (meta && meta.content) return meta.content
  const m = window.location.pathname.match(/\/t\/([^/]+)/)
  if (m) return m[1]
  return localStorage.getItem('tenant_slug') || ''
}

let _slug = null
export function tenantSlug() {
  // Always check URL first for super admin context switching
  const urlMatch = window.location.pathname.match(/\/t\/([^/]+)/)
  if (urlMatch) {
    _slug = urlMatch[1]
    return _slug
  }
  if (_slug === null) _slug = getTenantSlug()
  return _slug || ''
}

export function setTenantSlug(slug) {
  _slug = slug
  if (slug) localStorage.setItem('tenant_slug', slug)
}

function api(path) {
  return `${BASE}/api/t/${tenantSlug()}${path}`
}

// CSRF token — set on login and /me, sent with every state-changing request
let _csrfToken = ''
export function setCsrfToken(token) { _csrfToken = token }
export function getCsrfToken() { return _csrfToken }

function h(extra = {}) {
  const base = { 'Content-Type': 'application/json', ...extra }
  if (_csrfToken) base['X-CSRF-Token'] = _csrfToken
  return base
}

function csrf() {
  return _csrfToken ? { 'X-CSRF-Token': _csrfToken } : {}
}

// Auto-refresh the in-memory CSRF token by calling /me. Used by the
// fetch wrappers below on a 403 "Invalid CSRF token" response so the
// user doesn't have to manually reload the page after their session
// was rotated server-side (e.g. silent session refresh, secondary
// tab login, OAuth-triggered cookie change).
//
// Returns one of:
//   { ok: true }                   — token refreshed; retry succeeds
//   { ok: false, expired: true }   — /me returned 401; session is GONE
//   { ok: false, expired: false }  — transient failure (network, 5xx)
let _csrfRefreshPromise = null
async function refreshCsrf() {
  if (_csrfRefreshPromise) return _csrfRefreshPromise
  _csrfRefreshPromise = (async () => {
    try {
      const r = await fetch(`${BASE}/api/auth/me`, { credentials: 'include' })
      if (r.status === 401) return { ok: false, expired: true }
      if (!r.ok) return { ok: false, expired: false }
      const data = await r.json().catch(() => null)
      if (data?.csrf_token) {
        _csrfToken = data.csrf_token
        return { ok: true }
      }
      return { ok: false, expired: false }
    } catch {
      return { ok: false, expired: false }
    } finally {
      // Clear so the NEXT 403 (much later) can trigger a fresh fetch.
      setTimeout(() => { _csrfRefreshPromise = null }, 0)
    }
  })()
  return _csrfRefreshPromise
}

// Module-level flag the FE can read to show a "session expired"
// banner instead of surfacing per-call CSRF errors. Set once
// when refreshCsrf reports expired=true; cleared on a successful
// refresh (e.g. after the operator logs back in via the banner).
let _sessionExpired = false
export function isSessionExpired() { return _sessionExpired }
export function clearSessionExpired() { _sessionExpired = false }
// Fire a window-level event so the app shell can surface a banner /
// modal without each caller having to know about the flag.
function dispatchSessionExpired() {
  _sessionExpired = true
  try { window.dispatchEvent(new CustomEvent('pp:session-expired')) } catch { /* noop */ }
}

// fetch wrapper that retries ONCE on 403 "Invalid CSRF token" after
// rehydrating /me. Use for any state-changing request whose 403 path
// would otherwise surface a confusing "Invalid CSRF token" error to
// the user.
//
// When /me reports session expiry, dispatches a 'pp:session-expired'
// window event and returns a synthetic response with a clearer
// error message so per-call catches show something actionable.
export async function csrfFetch(url, init) {
  const r = await fetch(url, init)
  if (r.status !== 403) return r
  // Peek without consuming so the caller can still read the body if
  // it ends up being a real failure.
  const cloned = r.clone()
  let body = null
  try { body = await cloned.json() } catch { /* not JSON */ }
  if (body?.error !== 'Invalid CSRF token') return r
  const refreshed = await refreshCsrf()
  if (refreshed.ok) {
    // Re-issue with the fresh token. init.headers may be the result
    // of h(), csrf(), or a literal — rebuild minimally so we don't
    // lose a user-provided body type (e.g. FormData).
    const nextInit = { ...(init || {}) }
    const prevHeaders = (init && init.headers) || {}
    nextInit.headers = {
      ...prevHeaders,
      'X-CSRF-Token': _csrfToken,
    }
    return fetch(url, nextInit)
  }
  if (refreshed.expired) {
    dispatchSessionExpired()
    // Replace the original response body with a clearer message so
    // callers that just throw `r.error` show something actionable.
    return new Response(
      JSON.stringify({ error: 'Session expired — reload the page to log in again.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }
  return r
}

// Health
export const checkHealth = () => fetch(`${BASE}/api/health`)

// Auth — login doesn't need CSRF (no session yet)
export const login = (email, password) =>
  fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email, password }) }).then(r => r.json())
export const logout = () => fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: csrf(), credentials: 'include' })
export const getMe = () => fetch(`${BASE}/api/auth/me`, { credentials: 'include' }).then(r => r.ok ? r.json() : null)

// Settings
export const getSettings = () => fetch(api('/settings'), { credentials: 'include' }).then(r => r.json())
export const saveSettings = (s) => fetch(api('/settings'), { method: 'PUT', headers: h(), credentials: 'include', body: JSON.stringify(s) })
export const saveNotificationSettings = (data) => fetch(api('/settings/notifications'), { method: 'PUT', headers: { ...h(), ...csrf() }, credentials: 'include', body: JSON.stringify(data) }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const testNotificationEmail = () => fetch(api('/settings/notifications/test'), { method: 'POST', headers: { ...h(), ...csrf() }, credentials: 'include' }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const uploadWatermark = (file) => {
  const fd = new FormData()
  fd.append('watermark', file)
  return fetch(api('/settings/watermark'), { method: 'POST', headers: csrf(), credentials: 'include', body: fd }).then(r => r.json())
}

// Media library — list deduped media uploaded by this tenant + import
// (server-side copy) one item into a destination job. Powers the
// "Browse uploads" picker on the media panel.
export const listMediaLibrary = (opts = {}) => {
  const params = new URLSearchParams()
  if (opts.limit) params.set('limit', String(opts.limit))
  if (opts.offset) params.set('offset', String(opts.offset))
  if (opts.kind) params.set('kind', String(opts.kind))
  const qs = params.toString()
  return fetch(api(`/media-library${qs ? `?${qs}` : ''}`), { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `listMediaLibrary failed (${r.status})`)
      }
      return r.json()
    })
}
export const importMediaToJob = (destJobUuid, payload) =>
  fetch(api(`/media-library/${destJobUuid}/import`), {
    method: 'POST',
    headers: { ...h(), ...csrf() },
    credentials: 'include',
    body: JSON.stringify(payload),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `importMediaToJob failed (${r.status})`)
    }
    return r.json()
  })

// Campaigns — bulk-create N draft jobs from a pasted multi-video
// brief. dry_run=true returns a preview without writing; dry_run=
// false (or omitted via the create wrapper) persists.
export const previewCampaign = (source_text) =>
  csrfFetch(api('/campaigns'), {
    method: 'POST',
    headers: h(),
    credentials: 'include',
    body: JSON.stringify({ source_text, dry_run: true }),
  }).then(async r => {
    const body = await r.json().catch(() => ({}))
    if (!r.ok || body?.error) throw new Error(body?.error || `previewCampaign failed (${r.status})`)
    return body
  })
export const createCampaign = (source_text) =>
  csrfFetch(api('/campaigns'), {
    method: 'POST',
    headers: h(),
    credentials: 'include',
    body: JSON.stringify({ source_text, dry_run: false }),
  }).then(async r => {
    const body = await r.json().catch(() => ({}))
    if (!r.ok || body?.error) throw new Error(body?.error || `createCampaign failed (${r.status})`)
    return body
  })

// On-demand re-encode of an uploaded video file. Used to shrink
// Sony A6500 / XAVC / GoPro clips in the 20-47 MB range that
// slipped past the auto-compress threshold at upload time.
export const compressJobFile = (jobId, fileId, quality = 'medium') =>
  csrfFetch(api(`/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(fileId)}/compress`), {
    method: 'POST',
    headers: h(),
    credentials: 'include',
    body: JSON.stringify({ quality }),
  }).then(async r => {
    const body = await r.json().catch(() => ({}))
    if (!r.ok || body?.error) throw new Error(body?.error || `compressJobFile failed (${r.status})`)
    return body
  })

// Jobs — persistent session state
export const listJobs = () => fetch(api('/jobs'), { credentials: 'include' }).then(r => r.json())
// Soft-deleted jobs ("archived"). Same shape as listJobs but the BE
// flips the WHERE clause to status = 'archived'. Restore via
// updateJob(id, { status: 'draft' }) — no dedicated unarchive route.
export const listArchivedJobs = () => fetch(api('/jobs?archived=true'), { credentials: 'include' }).then(r => r.json())
export const createJob = () => fetch(api('/jobs'), { method: 'POST', headers: h(), credentials: 'include', body: '{}' }).then(r => r.json())
export const getJob = (id) => fetch(api(`/jobs/${id}`), { credentials: 'include' }).then(r => r.json())
export const updateJob = (id, data) =>
  fetch(api(`/jobs/${id}`), { method: 'PUT', headers: h(), credentials: 'include', body: JSON.stringify(data) })
    .then(async r => {
      const body = await r.json().catch(() => ({}))
      if (!r.ok || body?.error) throw new Error(body?.error || `updateJob failed (${r.status})`)
      return body
    })
export const autoNameJob = (id, opts = {}) => fetch(api(`/jobs/${id}/auto-name`), {
  method: 'POST', headers: h(), credentials: 'include',
  body: JSON.stringify({ force: !!opts.force }),
}).then(r => r.json())
export const deleteJob = (id) => fetch(api(`/jobs/${id}`), { method: 'DELETE', headers: csrf(), credentials: 'include' }).then(r => r.json())
export const duplicateJob = (id, opts = {}) => fetch(api(`/jobs/${id}/duplicate`), {
  method: 'POST', headers: { ...h(), ...csrf() }, credentials: 'include',
  body: JSON.stringify(opts.forceHookMode != null ? { force_hook_mode: !!opts.forceHookMode } : {}),
}).then(async r => {
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Duplicate failed') }
  return r.json()
})
export const addJobFile = (jobId, data) => fetch(api(`/jobs/${jobId}/files`), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify(data) }).then(r => r.json())
export const updateJobFile = (jobId, fileId, data) => fetch(api(`/jobs/${jobId}/files/${fileId}`), { method: 'PUT', headers: h(), credentials: 'include', body: JSON.stringify(data) }).then(async r => {
  // Previously this swallowed non-OK responses (returned the error JSON
  // as if it were the row). useJobSync's per-field savers wrap each call
  // in try/catch and only see the "error" inside the parsed body — never
  // the HTTP status. A missing-column 500 or validation 400 became
  // invisible, the FE assumed the save succeeded, and on reload the
  // field came back null. Throwing on !r.ok surfaces the real status.
  const body = await r.json().catch(() => ({}))
  if (!r.ok || body?.error) throw new Error(body?.error || `updateJobFile failed (${r.status})`)
  return body
})
export const deleteJobFile = (jobId, fileId) => fetch(api(`/jobs/${jobId}/files/${fileId}`), { method: 'DELETE', headers: csrf(), credentials: 'include' }).then(r => r.json())
export const duplicateJobFile = (jobId, fileId) =>
  fetch(api(`/jobs/${jobId}/files/${fileId}/duplicate`), {
    method: 'POST', headers: { ...h(), ...csrf() }, credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `duplicateJobFile failed (${r.status})`)
    }
    return r.json()
  })

// Rebind an existing job_files row to a freshly-uploaded storage
// object. Used when the original storage object is missing — keeps
// the row's trim / speed / order / effects / position intact instead
// of forcing the operator to delete + re-upload (which would land
// at the end of the timeline and lose all their settings).
export const rebindJobFileSource = (jobId, fileId, { upload_key, filename, media_type, file_hash }) =>
  fetch(api(`/jobs/${jobId}/files/${fileId}/rebind-source`), {
    method: 'POST',
    headers: { ...h(), ...csrf() },
    credentials: 'include',
    body: JSON.stringify({ upload_key, filename, media_type, file_hash }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `rebindJobFileSource failed (${r.status})`)
    }
    return r.json()
  })

// One-click reset of every music-driven effect on a job — per-job
// loop flags + music_beat_zoom_all + loop_duplicate rows. Leaves the
// music track itself intact. Returns { loop_duplicates_removed }.
export const clearJobMusicEffects = (jobId) =>
  fetch(api(`/jobs/${jobId}/clear-music-effects`), {
    method: 'POST',
    headers: { ...h(), ...csrf() },
    credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `clearJobMusicEffects failed (${r.status})`)
    }
    return r.json()
  })

// Job-wide playback speed (0.25–4×). Applied to every clip during
// merge. Refused with 409 while music is attached — caller should
// surface that message.
export const setJobGlobalSpeed = (jobId, globalSpeed) =>
  fetch(api(`/jobs/${jobId}/global-speed`), {
    method: 'PATCH',
    headers: { ...h(), ...csrf() },
    credentials: 'include',
    body: JSON.stringify({ global_speed: globalSpeed }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setJobGlobalSpeed failed (${r.status})`)
    }
    return r.json()
  })

// Split a source video file into N subclips. Each range becomes a new
// job_files row pointing to the same upload_key with its own trim
// window. Server returns { files: [...] } in source-timeline order.
export const splitJobFile = (jobId, fileId, ranges) =>
  fetch(api(`/jobs/${jobId}/files/${fileId}/split`), {
    method: 'POST',
    headers: { ...h(), ...csrf() },
    credentials: 'include',
    body: JSON.stringify({ ranges }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `splitJobFile failed (${r.status})`)
    }
    return r.json()
  })

// Push tenant default_overlay_style into an existing job's
// overlay_settings + default_caption_style + cascade to segments.
export const applyTenantDefaultsToJob = (jobId) =>
  fetch(api(`/jobs/${jobId}/apply-tenant-defaults`), {
    method: 'POST', headers: { ...h(), ...csrf() }, credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `applyTenantDefaultsToJob failed (${r.status})`)
    }
    return r.json()
  })

// Speech-to-text the merged video (or the single-clip fallback).
// Returns a [m:ss]-formatted script the Voice tab's Script field can
// drop in directly.
export const transcribeMergedVideo = (jobId) =>
  fetch(api(`/jobs/${jobId}/transcribe-merged`), {
    method: 'POST', headers: { ...h(), ...csrf() }, credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `transcribeMergedVideo failed (${r.status})`)
    }
    return r.json()
  })

// TikTok-tuned vision review of the first 0.5 seconds of a video clip.
// Returns { ok, analysis: {overall_score, motion_velocity, ...,
// frame_notes[], suggestions[]} } the inspector renders inline.
export const tiktokFirstHalfReview = (jobId, fileId) =>
  fetch(api(`/jobs/${jobId}/files/${fileId}/tiktok-half-review`), {
    method: 'POST', headers: { ...h(), ...csrf() }, credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `tiktokFirstHalfReview failed (${r.status})`)
    }
    return r.json()
  })

// End-to-end platform-specific analyzer. Each platform has its own
// scoring criteria + saved row. Caller picks one of: 'tiktok', 'reels',
// 'shorts'.
export const analyzeFullVideo = (draftId, platform) =>
  fetch(api(`/jobs/${draftId}/producer/analyze-full`), {
    method: 'POST',
    headers: { ...h(), ...csrf() },
    credentials: 'include',
    body: JSON.stringify({ platform }),
  }).then(async r => {
    // The BE flushes headers early + sends keepalive whitespace
    // while waiting on Claude (Railway proxy timeout workaround), so
    // it can't change status mid-stream — errors come back as 200
    // with { error } in the JSON body. Check for both shapes.
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `analyzeFullVideo failed (${r.status})`)
    }
    const data = await r.json()
    if (data?.error) throw new Error(data.error)
    return data
  })

// Hydrate the most recent persisted full-video analysis for a specific
// platform. Returns { analysis, analyzedAt, duration_sec, frames_used,
// source_kind, frame_thumbs[], platform }. analysis is null when the
// panel has never been run for this platform.
export const fullVideoAnalysisLast = (draftId, platform) =>
  fetch(api(`/jobs/${draftId}/producer/analyze-full/last?platform=${encodeURIComponent(platform)}`), { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `fullVideoAnalysisLast failed (${r.status})`)
      }
      return r.json()
    })

// Returns the exact mp4 the analyzer WOULD use right now: source_kind,
// source_key (canonical id — full storage path), source_filename,
// public_url for playback, plus timestamps. Cheap GET — no analysis,
// just metadata + URL resolution.
export const fullVideoAnalysisSource = (draftId) =>
  fetch(api(`/jobs/${draftId}/producer/analyze-full/source`), { credentials: 'include' })
    .then(async r => {
      if (r.status === 404) {
        // Distinguish "BE deploy hasn't landed yet" (route missing)
        // from a real failure so the FE can show a friendlier hint.
        throw new Error('Backend deploy in progress — try again in a moment.')
      }
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `fullVideoAnalysisSource failed (${r.status})`)
      }
      return r.json()
    })

// Voice analysis
export const analyzeVoice = (examples) =>
  fetch(api('/generate/analyze-voice'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ examples }) }).then(r => r.json())

// Uploads
// iOS silent-recovery: compute SHA-256 so we can check whether a "Load
// failed" upload actually reached the server before retrying. Safari
// frequently drops long POST responses mid-flight (backgrounded tab,
// connection flapping) even when the server already stored the file.
async function computeSHA256(file) {
  if (!file || !(file instanceof Blob)) return null
  if (!(globalThis.crypto && crypto.subtle && crypto.subtle.digest)) return null
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// "Load failed" / "Failed to fetch" / connection-drop style errors that
// indicate the request MAY have reached the server even though the
// response never came back.
function looksLikeNetworkError(err) {
  if (!err) return false
  const msg = String(err.message || err).toLowerCase()
  return (
    msg.includes('load failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network connection was lost') ||
    msg.includes('networkerror') ||
    err.name === 'TypeError' ||
    err.name === 'AbortError'
  )
}

export const uploadFile = async (file, folderName, batchId, parsedKeywords, videoThumb, jobId, opts = {}) => {
  // Client-side pre-compression for large videos. Cuts wire payload
  // 10-30× on Sony / GoPro / DJI 4K source files, so a ~150 MB clip
  // uploads as ~5-15 MB and the BE re-encode runs on a much smaller
  // input. Skipped for non-video files, small files, and any browser
  // path that throws — never blocks an upload.
  let preCompressed = null
  if ((file?.type || '').startsWith('video/')) {
    try {
      const { compressVideoForUpload } = await import('./utils/videoCompress')
      const result = await compressVideoForUpload(file, {
        onProgress: (frac) => {
          if (typeof opts.onCompressProgress === 'function') {
            try { opts.onCompressProgress(frac) } catch {}
          }
        },
      })
      if (!result.skipped) {
        console.log(`[upload] client-side compressed ${(result.originalSize/1024/1024).toFixed(1)}MB → ${(result.compressedSize/1024/1024).toFixed(1)}MB (${Math.round((1 - result.compressedSize/result.originalSize) * 100)}% smaller) · ${result.reason}`)
        preCompressed = result.file
      } else {
        console.log(`[upload] client-side compress skipped: ${result.reason}`)
      }
    } catch (e) {
      console.warn('[upload] client-side compress threw — uploading original:', e?.message || e)
    }
  }
  const fd = new FormData()
  fd.append('file', preCompressed || file)
  if (folderName) fd.append('folder_name', folderName)
  if (batchId) fd.append('batch_id', batchId)
  if (jobId) fd.append('job_id', jobId)
  fd.append('parsed_keywords', JSON.stringify(parsedKeywords))
  if (videoThumb) fd.append('video_thumbnail', videoThumb, 'thumb.jpg')

  try {
    const r = await fetch(api('/upload'), { method: 'POST', headers: csrf(), credentials: 'include', body: fd })
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || 'Upload failed')
    }
    return await r.json()
  } catch (err) {
    // iOS silent-recovery: if fetch threw with a network-style error, the
    // server may have received the file anyway. Compute the file hash and
    // look it up before giving up.
    if (looksLikeNetworkError(err)) {
      try {
        const hash = await computeSHA256(file)
        if (hash) {
          const lookup = await fetch(api(`/upload/by-hash/${hash}`), {
            method: 'GET',
            credentials: 'include',
            headers: csrf(),
          })
          if (lookup.ok) {
            const record = await lookup.json()
            console.warn('[upload] network error recovered via hash lookup — file was already on server:', hash.slice(0, 8))
            return record
          }
        }
      } catch (e2) {
        console.warn('[upload] hash-lookup recovery failed:', e2.message)
      }
    }
    throw err
  }
}

export const createBatch = (folderName, fileCount) =>
  fetch(api('/upload/batch'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ folder_name: folderName, file_count: fileCount }) }).then(r => r.json())

// Generate (non-streaming fallback)
export const generate = (body) =>
  fetch(api('/generate'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify(body) }).then(r => {
    if (!r.ok) return r.json().then(e => { throw new Error(e.error || 'Server error') })
    return r.json()
  })

// Generate (streaming)
export async function generateStream(body, onCaptions, onWarning) {
  const resp = await fetch(api('/generate/stream'), {
    method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify(body)
  })
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({ error: 'Server error' }))
    throw new Error(e.error || 'Server error')
  }
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const evt = JSON.parse(line.slice(6))
          if (evt.type === 'captions' && evt.data) {
            console.log('[generateStream] captions event, keys:', Object.keys(evt.data))
            onCaptions(evt.data)
          }
          if (evt.type === 'warning' && onWarning) onWarning(evt.message)
          if (evt.type === 'error') throw new Error(evt.error)
        } catch (e) {
          if (e.message !== 'Unexpected end of JSON input') throw e
        }
      }
    }
  }
}

export const humanize = (text, platform) =>
  fetch(api('/generate/humanize'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ text, platform }) }).then(r => r.json())

export const refine = (text, style, platform) =>
  fetch(api('/generate/refine'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ text, style, platform }) }).then(r => r.json())

export const reviewHint = (text, platforms) =>
  fetch(api('/generate/review-hint'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ text, platforms }) }).then(r => r.json())

export const getPostingSchedule = () =>
  fetch(api('/generate/posting-schedule'), { method: 'POST', headers: h(), credentials: 'include' }).then(r => r.json())
export const loadPostingSchedule = () =>
  fetch(api('/generate/posting-schedule'), { credentials: 'include' }).then(r => r.json())

export const analyzeAnalytics = (platform, rawText) =>
  fetch(api('/generate/analyze-analytics'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ platform, raw_text: rawText }) }).then(r => r.json())

export const getAnalytics = () =>
  fetch(api('/generate/analytics'), { credentials: 'include' }).then(r => r.json())

// AI interaction log — request/response history of Anthropic calls.
export const getAiLog = (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v)).toString()
  return fetch(api('/ai/log' + (qs ? '?' + qs : '')), { credentials: 'include' }).then(r => r.json())
}
export const clearAiLog = () =>
  fetch(api('/ai/log'), { method: 'DELETE', headers: csrf(), credentials: 'include' }).then(r => r.json())

export const saveOverlayTemplate = (template) =>
  fetch(api('/settings/overlay-templates'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify(template) }).then(r => r.json())
export const deleteOverlayTemplate = (id) =>
  fetch(api(`/settings/overlay-templates/${id}`), { method: 'DELETE', headers: csrf(), credentials: 'include' }).then(r => r.json())

// History
export const getHistory = (limit = 80) =>
  fetch(api(`/history?limit=${limit}`), { credentials: 'include' }).then(r => r.json())

export const updateCaption = (id, captionText) =>
  fetch(api(`/history/${id}`), { method: 'PUT', headers: h(), credentials: 'include', body: JSON.stringify({ caption_text: captionText }) })

// Hashtags
export const getHashtags = () => fetch(api('/hashtags'), { credentials: 'include' }).then(r => r.json())
export const createHashtag = (name, hashtags) =>
  fetch(api('/hashtags'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ name, hashtags }) }).then(r => r.json())
export const updateHashtag = (id, hashtags) =>
  fetch(api(`/hashtags/${id}`), { method: 'PUT', headers: h(), credentials: 'include', body: JSON.stringify({ hashtags }) })
export const deleteHashtag = (id) =>
  fetch(api(`/hashtags/${id}`), { method: 'DELETE', headers: csrf(), credentials: 'include' })

// SEO keyword sets
export const getSeoKeywordSets = () => fetch(api('/seo-keywords'), { credentials: 'include' }).then(r => r.json())
export const createSeoKeywordSet = (name, keywords) =>
  fetch(api('/seo-keywords'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ name, keywords }) }).then(r => r.json())
export const updateSeoKeywordSet = (id, keywords) =>
  fetch(api(`/seo-keywords/${id}`), { method: 'PUT', headers: h(), credentials: 'include', body: JSON.stringify({ keywords }) })
export const deleteSeoKeywordSet = (id) =>
  fetch(api(`/seo-keywords/${id}`), { method: 'DELETE', headers: csrf(), credentials: 'include' })

// Review a pasted voiceover script for hookworthiness — pure review, no state change
export const reviewVoiceoverScript = ({ script, videoHint, duration, overlayOpening, overlayMiddle, overlayClosing, hookMode, platforms, platformCaptions, frames, segmentLength, shortenToFit } = {}) =>
  fetch(api('/generate/review-voiceover-script'), {
    method: 'POST',
    headers: { ...csrf(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      script,
      videoHint: videoHint || null,
      duration: duration || null,
      overlay_opening: overlayOpening || null,
      overlay_middle: overlayMiddle || null,
      overlay_closing: overlayClosing || null,
      hook_mode: hookMode,
      platforms: Array.isArray(platforms) ? platforms : null,
      platform_captions: platformCaptions || null,
      frames: Array.isArray(frames) ? frames : null,
      segment_length: segmentLength || null,
      shorten_to_fit: !!shortenToFit,
    }),
  }).then(r => r.json())

// One-shot media description — call ONCE per upload. Server returns a
// structured description that gets cached on the upload row and then
// reused as TEXT across every downstream AI call (captions, hooks,
// voiceover, overlays). Raw images never leave the client a second time.
export const describeMedia = ({ frames, mediaType, hint, jobUuid } = {}) =>
  fetch(api('/generate/describe-media'), {
    method: 'POST',
    headers: { ...csrf(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      frames: Array.isArray(frames) ? frames : [],
      media_type: mediaType || 'photo',
      hint: hint || null,
      job_uuid: jobUuid || null,
    }),
  }).then(r => r.json())

// Persist the cached visual description on the upload row so future
// sessions skip the describe call entirely.
export const saveUploadVisualDescription = (uploadUuid, visualDescription) =>
  fetch(api(`/upload/${encodeURIComponent(uploadUuid)}/visual-description`), {
    method: 'PUT',
    headers: { ...csrf(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ visual_description: visualDescription }),
  }).then(r => r.json())

// Propose voiceover segments from video frames (Claude vision)
export const voiceoverFromVideo = ({ frames, videoHint, duration, hookMode, platforms, overlayOpening, overlayMiddle, overlayClosing, style, segmentLength, audienceOverride } = {}) =>
  fetch(api('/generate/voiceover-from-video'), {
    method: 'POST',
    headers: { ...csrf(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      frames: Array.isArray(frames) ? frames : [],
      videoHint: videoHint || null,
      duration: duration || null,
      hook_mode: hookMode,
      platforms: Array.isArray(platforms) ? platforms : null,
      overlay_opening: overlayOpening || null,
      overlay_middle: overlayMiddle || null,
      overlay_closing: overlayClosing || null,
      style: style || null,
      segment_length: segmentLength || 'short',
      audience_override: audienceOverride || 'auto',
    }),
  }).then(r => r.json())

// Generate spoken-style voiceover hook(s) for the ElevenLabs TTS field
// Write a VO script from what the draft already has (hints + generated
// captions + cached visuals). Returns { primary, segments: [{startTime, text}] }.
export const generateVoiceoverScript = ({ jobUuid, mode, segmentLength, hook, secondOpinion, videoDurationS } = {}) =>
  fetch(api('/generate/voiceover-script'), {
    method: 'POST',
    headers: { ...csrf(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      job_uuid: jobUuid || null,
      mode: mode || 'complement',
      segment_length: segmentLength || 'medium',
      hook: hook || null,
      second_opinion: secondOpinion || null,
      video_duration_s: videoDurationS != null ? Number(videoDurationS) : null,
    }),
  }).then(r => r.json())

export const generateVoiceoverHook = ({ hint, category, includeBody, count, frames, audienceOverride, visualContext, jobUuid, rawMode } = {}) =>
  fetch(api('/generate/voiceover-hook'), {
    method: 'POST',
    headers: { ...csrf(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      hint: hint || null,
      category: category || null,
      includeBody: !!includeBody,
      count: count || 4,
      frames: Array.isArray(frames) ? frames : null,
      audience_override: audienceOverride || 'auto',
      visual_context: visualContext || null,
      job_uuid: jobUuid || null,
      raw_mode: !!rawMode,
    }),
  }).then(r => r.json())

// Generate per-platform video overlay texts (opening + closing) from a single hint
export const generateOverlayTexts = (hint, destinations, opts = {}) =>
  fetch(api('/generate/overlay-texts'), {
    method: 'POST',
    headers: { ...csrf(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ hint, destinations, category: opts.category || null, options_per_dest: opts.optionsPerDest || 1 }),
  }).then(r => r.json())

// Public signup (no auth)
export const publicSignup = (email, plan) =>
  fetch(`${BASE}/api/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, plan }),
  }).then(r => r.json())

// Admin
const adm = (path) => `${BASE}/api/admin${path}`
export const getTenants = () => fetch(adm('/tenants'), { credentials: 'include' }).then(r => r.json())
export const createTenant = (data) => fetch(adm('/tenants'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify(data) }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const updateTenant = (id, data) => fetch(adm(`/tenants/${id}`), { method: 'PUT', headers: h(), credentials: 'include', body: JSON.stringify(data) }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const deactivateTenant = (id) => fetch(adm(`/tenants/${id}`), { method: 'DELETE', headers: csrf(), credentials: 'include' })
export const getUsers = () => fetch(adm('/users'), { credentials: 'include' }).then(r => r.json())
export const createUser = (data) => fetch(adm('/users'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify(data) }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const updateUser = (id, data) => fetch(adm(`/users/${id}`), { method: 'PUT', headers: { ...h(), ...csrf() }, credentials: 'include', body: JSON.stringify(data) }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const deactivateUser = (id) => fetch(adm(`/users/${id}`), { method: 'DELETE', headers: csrf(), credentials: 'include' })
export const getThrottleConfig = () => fetch(adm('/throttle'), { credentials: 'include' }).then(r => r.json())
export const updateThrottle = (id, data) => fetch(adm(`/throttle/${id}`), { method: 'PUT', headers: h(), credentials: 'include', body: JSON.stringify(data) })
export const getIpBlocklist = () => fetch(adm('/ip-blocklist'), { credentials: 'include' }).then(r => r.json())
export const blockIp = (data) => fetch(adm('/ip-blocklist'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify(data) }).then(r => r.json())
export const unblockIp = (id) => fetch(adm(`/ip-blocklist/${id}`), { method: 'DELETE', headers: csrf(), credentials: 'include' })

// Social connections
export const startFbConnect = () =>
  fetch(api('/connect/facebook'), { credentials: 'include' }).then(r => r.json())
export const disconnectFb = () =>
  fetch(api('/connect/facebook/disconnect'), { method: 'POST', headers: csrf(), credentials: 'include' }).then(r => r.json())
export const resetFb = () =>
  fetch(api('/connect/facebook/reset'), { method: 'POST', headers: csrf(), credentials: 'include' }).then(r => r.json())

// Social posting -- all accept optional force=true to bypass duplicate check
async function postWithDupCheck(path, body) {
  const resp = await fetch(api(path), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify(body) })
  if (resp.status === 409) {
    const data = await resp.json()
    if (data.error === 'duplicate') {
      const ok = window.confirm(`${data.message}\n\nPost anyway?`)
      if (!ok) throw new Error('Cancelled — duplicate post')
      return postWithDupCheck(path, { ...body, force: true })
    }
  }
  if (!resp.ok) { const e = await resp.json(); throw new Error(e.error) }
  return resp.json()
}

export const postToFacebook = (caption, imageBase64, mediaType) =>
  postWithDupCheck('/post/facebook', { caption, image_base64: imageBase64, media_type: mediaType })
export const postToInstagram = (caption, imageBase64, mediaType, overlayOpts) =>
  postWithDupCheck('/post/instagram', { caption, image_base64: imageBase64, media_type: mediaType, ...overlayOpts })
export const previewStory = async (caption, imageBase64, mediaType, captionStyle, overlayYPct, fontOpts) => {
  const resp = await fetch(api('/post/story/preview'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({
    caption,
    image_base64: imageBase64,
    upload_key: fontOpts?.uploadKey || null,
    job_id: fontOpts?.jobId || null,
    media_type: mediaType, caption_style: captionStyle, overlay_y_pct: overlayYPct,
    font_size: fontOpts?.fontSize, font_family: fontOpts?.fontFamily, font_color: fontOpts?.fontColor, font_outline: fontOpts?.fontOutline,
    font_outline_width: fontOpts?.fontOutlineWidth, line_height: fontOpts?.lineHeight, letter_spacing: fontOpts?.letterSpacing,
    trim_start: fontOpts?.trimStart, trim_end: fontOpts?.trimEnd,
    opening_text: fontOpts?.openingText, closing_text: fontOpts?.closingText, opening_duration: fontOpts?.openingDuration, closing_duration: fontOpts?.closingDuration, middle_text: fontOpts?.middleText, middle_start_time: fontOpts?.middleStartTime, middle_duration: fontOpts?.middleDuration,
    photo_to_video: fontOpts?.photoToVideo, photo_to_video_duration: fontOpts?.photoToVideoDuration, photo_to_video_motion: fontOpts?.photoToVideoMotion,
  }) })
  if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || 'Preview failed')
  const blob = await resp.blob()
  return URL.createObjectURL(blob)
}
export const postToFacebookStory = (caption, imageBase64, mediaType, captionStyle, overlayYPct, fontOpts) =>
  postWithDupCheck('/post/facebook/story', { caption, image_base64: imageBase64, media_type: mediaType, caption_style: captionStyle, overlay_y_pct: overlayYPct, font_size: fontOpts?.fontSize, font_family: fontOpts?.fontFamily, font_color: fontOpts?.fontColor, font_outline: fontOpts?.fontOutline, font_outline_width: fontOpts?.fontOutlineWidth, line_height: fontOpts?.lineHeight, letter_spacing: fontOpts?.letterSpacing, trim_start: fontOpts?.trimStart, trim_end: fontOpts?.trimEnd, opening_text: fontOpts?.openingText, closing_text: fontOpts?.closingText, opening_duration: fontOpts?.openingDuration, closing_duration: fontOpts?.closingDuration, middle_text: fontOpts?.middleText, middle_start_time: fontOpts?.middleStartTime, middle_duration: fontOpts?.middleDuration, fade_time: fontOpts?.fadeTime })
export const postToFacebookReel = (caption, imageBase64, mediaType, overlayOpts) =>
  postWithDupCheck('/post/facebook/reel', { caption, image_base64: imageBase64, media_type: mediaType, ...overlayOpts })
export const postToInstagramStory = (caption, imageBase64, mediaType, captionStyle, overlayYPct, fontOpts) =>
  postWithDupCheck('/post/instagram/story', { caption, image_base64: imageBase64, media_type: mediaType, caption_style: captionStyle, overlay_y_pct: overlayYPct, font_size: fontOpts?.fontSize, font_family: fontOpts?.fontFamily, font_color: fontOpts?.fontColor, font_outline: fontOpts?.fontOutline, font_outline_width: fontOpts?.fontOutlineWidth, line_height: fontOpts?.lineHeight, letter_spacing: fontOpts?.letterSpacing, trim_start: fontOpts?.trimStart, trim_end: fontOpts?.trimEnd, opening_text: fontOpts?.openingText, closing_text: fontOpts?.closingText, opening_duration: fontOpts?.openingDuration, closing_duration: fontOpts?.closingDuration, middle_text: fontOpts?.middleText, middle_start_time: fontOpts?.middleStartTime, middle_duration: fontOpts?.middleDuration, fade_time: fontOpts?.fadeTime })

// X / Twitter
export const saveTwitterCredentials = (apiKey, apiSecret) =>
  fetch(api('/connect/twitter/credentials'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ api_key: apiKey, api_secret: apiSecret }) }).then(r => r.json())
export const startTwitterConnect = () =>
  fetch(api('/connect/twitter'), { credentials: 'include' }).then(r => r.json())
export const disconnectTwitter = () =>
  fetch(api('/connect/twitter/disconnect'), { method: 'POST', headers: csrf(), credentials: 'include' }).then(r => r.json())
export const resetTwitter = () =>
  fetch(api('/connect/twitter/reset'), { method: 'POST', headers: csrf(), credentials: 'include' }).then(r => r.json())
export const postToTwitter = (caption, imageBase64, mediaType) =>
  postWithDupCheck('/post/twitter', { caption, image_base64: imageBase64, media_type: mediaType })

export const postToTiktok = (caption, imageBase64, mediaType) =>
  postWithDupCheck('/post/tiktok', { caption, image_base64: imageBase64, media_type: mediaType })

// TikTok connection
export const saveTiktokCredentials = (clientKey, clientSecret) =>
  fetch(api('/connect/tiktok/credentials'), { method: 'POST', headers: { ...h(), ...csrf() }, credentials: 'include', body: JSON.stringify({ client_key: clientKey, client_secret: clientSecret }) }).then(r => { if (!r.ok) return r.text().then(t => { throw new Error(t.slice(0, 200)) }); return r.json() })
export const startTiktokConnect = () =>
  fetch(api('/connect/tiktok'), { credentials: 'include' }).then(r => r.json())
export const disconnectTiktok = () =>
  fetch(api('/connect/tiktok/disconnect'), { method: 'POST', headers: csrf(), credentials: 'include' }).then(r => r.json())
export const resetTiktok = () =>
  fetch(api('/connect/tiktok/reset'), { method: 'POST', headers: csrf(), credentials: 'include' }).then(r => r.json())

// Google Business
export const startGoogleConnect = () =>
  fetch(api('/connect/google'), { credentials: 'include' }).then(r => r.json())
export const disconnectGoogle = () =>
  fetch(api('/connect/google/disconnect'), { method: 'POST', headers: csrf(), credentials: 'include' }).then(r => r.json())
export const postToGoogle = (caption, imageBase64, mediaType, opts = {}) =>
  postWithDupCheck(`/post/google${opts.type === 'gallery' ? '/gallery' : ''}`, { caption, image_base64: imageBase64, media_type: mediaType })
export const convertToMp4 = (imageBase64, mediaType, quality = 'medium') =>
  fetch(api('/post/convert-to-mp4'), { method: 'POST', headers: { ...csrf(), 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ image_base64: imageBase64, media_type: mediaType, quality }) }).then(r => r.json())
export const photoToVideo = (imageBase64, mediaType, duration = 7, motion = 'zoom') =>
  fetch(api('/post/photo-to-video'), { method: 'POST', headers: { ...csrf(), 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ image_base64: imageBase64, media_type: mediaType, duration, motion }) }).then(r => r.json())

// Save voiceover audio to job storage
export const saveVoiceover = (audioBase64, jobId, mediaType) =>
  fetch(api('/post/save-voiceover'), { method: 'POST', headers: { ...csrf(), 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ audio_base64: audioBase64, job_id: jobId, media_type: mediaType }) }).then(r => r.json())

// Save a single timed voiceover segment to job storage so it survives
// draft resume. `wordTimings` (from api.textToSpeech's response) carries
// the Phase-1 per-word alignment; the backend persists it for the
// Remotion renderer. Omitting it falls back to static text.
export const saveVoiceoverSegment = (audioBase64, jobId, segmentId, mediaType, wordTimings) =>
  fetch(api('/post/save-voiceover-segment'), {
    method: 'POST',
    headers: { ...csrf(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      audio_base64: audioBase64,
      job_id: jobId,
      segment_id: segmentId,
      media_type: mediaType,
      word_timings: Array.isArray(wordTimings) ? wordTimings : null,
    }),
  }).then(r => r.json())

// Voiceover — mix audio onto video
export const addVoiceover = (videoBase64, audioBase64, mode = 'mix', originalVolume = 0.3, voiceoverVolume = 1.0) =>
  fetch(api('/post/add-voiceover'), { method: 'POST', headers: { ...csrf(), 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ video_base64: videoBase64, audio_base64: audioBase64, mode, original_volume: originalVolume, voiceover_volume: voiceoverVolume }) }).then(r => r.json())

// Multi-segment voiceover — place N audio clips at different time offsets on a video.
// segments: [{ audioBase64, startTime, volume? }, ...]
export const addVoiceoverSegments = (videoBase64, segments, mode = 'mix', originalVolume = 0.3) =>
  fetch(api('/post/add-voiceover-segments'), {
    method: 'POST',
    headers: { ...csrf(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      video_base64: videoBase64,
      segments: segments.map(s => ({ audio_base64: s.audioBase64, start_time: s.startTime || 0, volume: s.volume ?? 1 })),
      mode,
      original_volume: originalVolume,
    }),
  }).then(r => r.json())

// Preview render for a single voiceover segment via the Remotion
// pipeline. Renders half-res 4s at 24fps so round-trips are ~5-8s
// instead of ~30. Used by the caption-style editor to show a live
// preview the moment the user saves.
export const renderSegmentPreview = ({ jobUuid, segmentId, videoUrl, audioUrl, text, platform = 'vertical' }) =>
  fetch(api('/video/render'), {
    method: 'POST',
    headers: h(),
    credentials: 'include',
    body: JSON.stringify({
      jobUuid, segmentId, videoUrl, audioUrl, text,
      platform,
      preview: true,
    }),
  }).then(async r => {
    if (!r.ok) {
      let msg = `Preview render failed (${r.status})`
      try { const j = await r.json(); if (j?.error) msg = j.error } catch {}
      throw new Error(msg)
    }
    return r.json()
  })

// Compose a single "final" mp4 for the job: merged video → overlays →
// caption timeline → primary+timed voiceovers. Server reads all the pieces
// off the job record. Optional `primaryAudioBase64` lets the client pass
// an in-memory primary voice that hasn't been persisted yet.
// Produces a no-audio variant of the cached final by stream-copying
// the video track. Sub-second on the server side since there's no
// re-encode. Requires a prior /post/render-final call to have
// populated the job's final_media_keys.
export const stripFinalAudio = ({ jobUuid, finalKeys } = {}) =>
  fetch(api('/post/strip-final-audio'), {
    method: 'POST',
    headers: { ...csrf(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      job_id: jobUuid,
      // Pass the keys from the prior renderFinal response so the BE
      // doesn't have to read final_media_keys from the job row. The
      // DB write is skipped when primary_audio_base64 was in the
      // render request, so reading from the row would 409 even
      // though the freshly-rendered mp4 is in storage.
      final_keys: Array.isArray(finalKeys) ? finalKeys : undefined,
    }),
  }).then(async r => {
    if (!r.ok) {
      let msg = `Strip audio failed (${r.status})`
      try { const j = await r.json(); if (j?.error) msg = j.error } catch {}
      throw new Error(msg)
    }
    return r.json()
  })

export const renderFinal = ({ jobUuid, primaryAudioBase64, primaryAudioStartTime, preview, previewSeconds, sourceVideoKey, forceRerender } = {}) =>
  fetch(api('/post/render-final'), {
    method: 'POST',
    headers: { ...csrf(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      job_id: jobUuid,
      primary_audio_base64: primaryAudioBase64 || null,
      primary_audio_start_time: primaryAudioStartTime != null ? Number(primaryAudioStartTime) : 0,
      // Preview mode: renders only the first previewSeconds of frames
      // at FULL resolution (defaults to 5s server-side). Dropping the
      // frame count is the only lever that meaningfully moves preview
      // time — scale/crf tweaks capped at ~12% savings in benchmarks.
      preview: preview === true,
      preview_seconds: typeof previewSeconds === 'number' ? previewSeconds : undefined,
      // Optional: render on top of an alternate merged-video storage
      // key (e.g. a no-music variant produced by mergeNoMusic). Skips
      // the cache so the result doesn't clobber the canonical final.
      source_video_key: sourceVideoKey || undefined,
      // force_rerender: BE skips the fingerprint cache READ even when
      // the fingerprint would match, but STILL writes the new render
      // to final_media_keys + final_media_fingerprint. Use for the
      // "🎬 Render + Re-analyze" path when the cached final is
      // suspected to be stale even though state hasn't changed.
      force_rerender: forceRerender === true,
    }),
  }).then(async r => {
    // Defensive: handle both shapes (status-coded and 200 + body.error).
    if (!r.ok) {
      let msg = `Render failed (${r.status})`
      try { const j = await r.json(); if (j?.error) msg = j.error } catch {}
      throw new Error(msg)
    }
    const data = await r.json()
    if (data?.error) throw new Error(data.error)
    return data
  })

// ElevenLabs Scribe STT — transcribes a recorded audio blob into
// { text, word_timings }. Used to unlock the Remotion caption pipeline
// (active-word highlight + reveals) on user-recorded voice, not just
// TTS-generated audio.
export const speechToText = ({ audioBase64, mediaType, language } = {}) =>
  fetch(api('/generate/speech-to-text'), {
    method: 'POST',
    headers: { ...csrf(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      audio_base64: audioBase64,
      media_type: mediaType || 'audio/webm',
      language: language || undefined,
    }),
  }).then(async r => {
    if (!r.ok) {
      let msg = `STT failed (${r.status})`
      try { const j = await r.json(); if (j?.error) msg = j.error } catch {}
      throw new Error(msg)
    }
    return r.json()
  })

// Read word_timings for one segment. Used by the browser-side
// LivePreviewPlayer to feed timings through to the FinalRender
// composition without a server-side render round-trip.
export const getSegmentWordTimings = (jobUuid, segmentId) =>
  fetch(api(`/jobs/${jobUuid}/voiceover/${segmentId}/word-timings`), {
    credentials: 'include',
  }).then(r => r.json())

// Step-4 counterpart to the server's [preview-log] line — emitted
// by the browser when <LivePreviewPlayer> mounts a new style config.
// Fire-and-forget: never waits for a response, never retries on
// failure. Telemetry should never break user flow.
export const logPreviewView = ({ jobUuid, styleFp, cueCount, latencyMs, previewSeconds } = {}) => {
  if (!jobUuid || !styleFp) return Promise.resolve()
  return fetch(api('/log/preview-view'), {
    method: 'POST',
    headers: { ...csrf(), 'Content-Type': 'application/json' },
    credentials: 'include',
    // Don't keep a connection open on page-nav — keepalive means the
    // browser still sends the request even if the user closes the
    // tab or navigates away right after mount.
    keepalive: true,
    body: JSON.stringify({
      job_id: jobUuid,
      style_fp: styleFp,
      cue_count: typeof cueCount === 'number' ? cueCount : null,
      latency_ms: typeof latencyMs === 'number' ? latencyMs : 0,
      preview_seconds: typeof previewSeconds === 'number' ? previewSeconds : null,
    }),
  }).catch(() => { /* telemetry never breaks the preview */ })
}

// Bulk-replace word_timings on a segment without re-uploading audio.
export const saveSegmentWordTimings = (jobUuid, segmentId, wordTimings) =>
  fetch(api(`/jobs/${jobUuid}/voiceover/${segmentId}/word-timings`), {
    method: 'PUT',
    headers: h(),
    credentials: 'include',
    body: JSON.stringify({ word_timings: wordTimings }),
  }).then(async r => {
    if (!r.ok) {
      let msg = `save word-timings failed (${r.status})`
      try { const j = await r.json(); if (j?.error) msg = j.error } catch {}
      throw new Error(msg)
    }
    return r.json()
  })

// ElevenLabs TTS
export const textToSpeech = (text, voiceId, voiceSettings = {}) =>
  fetch(api('/generate/text-to-speech'), { method: 'POST', headers: { ...csrf(), 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ text, voice_id: voiceId, ...voiceSettings }) }).then(r => r.json())
export const getVoices = () =>
  fetch(api('/generate/voices'), { credentials: 'include' }).then(r => r.json())

// Re-merge a job's clips without the music swap step, returning the
// storage key of the resulting mp4. Used by "Download final (no
// music)" so the final can be composed on a clip-audio merge
// instead of the canonical music-mixed one — lets the operator
// pull a voiceover-only export when the music was for beat-sync
// only (e.g. rights-limited tracks they don't want to publish).
//
// Reads everything the BE needs from the `files` array (the public
// snake_case shape returned by GET /jobs/:id) so the orchestrator
// doesn't have to know about FE-internal `_*` state.
//
// Returns the merge_key string. Throws on any error.
export const mergeNoMusic = async (files, jobUuid, { transition = 'none', transitionDuration = 1 } = {}) => {
  // The FE keeps files in a `_*` camelCase shape (see useJobSync's
  // hydrate function) — _mediaType, _trimStart, _uploadKey, etc.
  // The merge endpoint expects snake_case. This helper bridges
  // them, mirroring VideoMerge.jsx's clip-assembly so the two
  // paths produce identical merges.
  const mt = (f) => f._mediaType || f.media_type || ''
  const uploadKey = (f) => f._uploadKey || f.upload_key || f.uploadResult?.original_temp_path || null
  const dbFileId = (f) => f._dbFileId != null ? f._dbFileId : (f.id != null ? f.id : null)
  const isImage = (f) => mt(f).startsWith('image/')
  const isVideo = (f) => mt(f).startsWith('video/')
  const isMediaClip = (f) => f && !f._skipInMerge && (isVideo(f) || isImage(f)) && !!uploadKey(f)

  const mergeFiles = (files || []).filter(isMediaClip)
  if (mergeFiles.length === 0) throw new Error('No video clips to merge')

  // Walk hosts-only to compute insert_host_idx. Hosts are clips
  // with no _insertIntoFileId; inserts target a host by its db id.
  const hostsOnly = mergeFiles.filter(f => f._insertIntoFileId == null)
  const hostIdxByDbId = new Map()
  hostsOnly.forEach((h, idx) => {
    const id = dbFileId(h)
    if (id != null) hostIdxByDbId.set(id, idx)
  })

  const clips = mergeFiles.map(f => {
    const hostId = f._insertIntoFileId != null ? Number(f._insertIntoFileId) : null
    const insertHostIdx = hostId != null && hostIdxByDbId.has(hostId)
      ? hostIdxByDbId.get(hostId)
      : null
    if (isImage(f)) {
      return {
        upload_key: uploadKey(f),
        media_type: mt(f) || 'image/jpeg',
        trim_end: Number(f._trimEnd) > 0 ? Number(f._trimEnd) : 5,
        photo_to_video_motion: f._photoMotion || 'zoom-in',
        photo_to_video_zoom: Number(f._photoZoom) > 0 ? Number(f._photoZoom) : 1.0,
        photo_to_video_rotate: Number.isFinite(Number(f._photoRotate)) ? Number(f._photoRotate) : 0,
        photo_to_video_offset_x: Number.isFinite(Number(f._photoOffsetX)) ? Number(f._photoOffsetX) : 0,
        photo_to_video_offset_y: Number.isFinite(Number(f._photoOffsetY)) ? Number(f._photoOffsetY) : 0,
        insert_host_idx: insertHostIdx,
        insert_at_sec: Number(f._insertAtSec) >= 0 ? Number(f._insertAtSec) : 0,
      }
    }
    return {
      upload_key: uploadKey(f),
      media_type: mt(f) || 'video/mp4',
      trim_start: Number(f._trimStart) > 0 ? Number(f._trimStart) : 0,
      trim_end: f._trimEnd != null ? Number(f._trimEnd) : null,
      speed: Number(f._speed) > 0 ? Number(f._speed) : 1.0,
      video_zoom: Number(f._videoZoom) > 0 ? Number(f._videoZoom) : 1.0,
      video_offset_x: Number.isFinite(Number(f._videoOffsetX)) ? Number(f._videoOffsetX) : 0,
      video_offset_y: Number.isFinite(Number(f._videoOffsetY)) ? Number(f._videoOffsetY) : 0,
      video_motion: typeof f._videoMotion === 'string' && f._videoMotion ? f._videoMotion : 'static',
      freeze_frame: !!f._freezeFrame,
      reverse_play: !!f._reversePlay,
      mirror_flip:  !!f._mirrorFlip,
      color_effect: f._colorEffect || null,
      strobe:       !!f._strobe,
      beat_zoom:    !!f._beatZoom,
      insert_host_idx: insertHostIdx,
      insert_at_sec: Number(f._insertAtSec) >= 0 ? Number(f._insertAtSec) : 0,
    }
  })

  const resp = await fetch(api('/post/merge-videos'), {
    method: 'POST',
    headers: { ...csrf(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      clips,
      transition,
      transition_duration: transitionDuration,
      job_id: jobUuid,
      // Causes BE to skip the music-swap step AND write to a
      // `merge-nomusic-` storage key WITHOUT touching
      // jobs.merged_video_key. The canonical merge stays intact.
      skip_music: true,
    }),
  })
  if (!resp.ok) {
    let msg = `Re-merge (no music) failed (${resp.status})`
    try { const j = await resp.json(); if (j?.error) msg = j.error } catch {}
    throw new Error(msg)
  }
  const { merge_key } = await resp.json()
  if (!merge_key) throw new Error('Re-merge returned no merge_key')
  return merge_key
}

// Merge 2+ trimmed video clips into a single MP4 with optional transitions
// clips: [{ video_base64, trim_start, trim_end }], transition: string, transition_duration: number
export const mergeVideos = async (clips, transition = 'none', transitionDuration = 1, jobId = null) => {
  // Wrap fetch with:
  //   1. An explicit AbortController so the request can time out with
  //      a readable message instead of leaving the browser to throw an
  //      ambiguous "TypeError: Failed to fetch" after some opaque
  //      proxy timeout (Cloudflare ~100s, Railway ~5min, browser
  //      varies). 5 minutes is comfortably above what a 20-clip
  //      merge needs but short enough that the operator isn't left
  //      staring at a hung spinner.
  //   2. A TypeError catch so the truly-network case ("Failed to
  //      fetch": DNS, CORS, connection severed) surfaces a useful
  //      message — "BE may have crashed or the request was cut by
  //      Railway / Cloudflare. Check Railway logs for OOM" — rather
  //      than the raw browser string.
  const MERGE_TIMEOUT_MS = 5 * 60 * 1000;
  const fetchWithTimeout = async (url, opts, label) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), MERGE_TIMEOUT_MS);
    try {
      return await fetch(url, { ...opts, signal: controller.signal });
    } catch (e) {
      if (e?.name === 'AbortError') {
        throw new Error(`${label} timed out after ${Math.round(MERGE_TIMEOUT_MS/60000)} min — the merge is probably still running on the server but the browser stopped waiting. Try fewer clips, or wait and refresh the job to see if it landed.`);
      }
      if (e?.message === 'Failed to fetch' || e?.name === 'TypeError') {
        throw new Error(`${label} network error — the BE may have crashed mid-merge (Railway OOM) or the request was cut by Cloudflare / the load balancer. Check Railway logs for the container status.`);
      }
      throw e;
    } finally {
      clearTimeout(t);
    }
  };

  // Step 1: POST clips → server merges and saves to /tmp + Supabase (if job_id), returns merge_id
  const resp = await fetchWithTimeout(
    api('/post/merge-videos'),
    {
      method: 'POST',
      headers: { ...csrf(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ clips, transition, transition_duration: transitionDuration, job_id: jobId }),
    },
    'Merge',
  );
  if (!resp.ok) {
    let msg = `Merge failed (HTTP ${resp.status})`;
    try {
      const text = await resp.text()
      try {
        const parsed = JSON.parse(text);
        // Surface BE's structured error fields. Some merge errors
        // have `error` + `detail`; show both so the operator can
        // see "Concat-filter failed" + ffmpeg's last 500 chars of
        // stderr without digging through Railway logs.
        msg = [parsed.error, parsed.detail].filter(Boolean).join(' — ') || msg;
      } catch {
        msg = text.slice(0, 500) || msg;
      }
    } catch {}
    throw new Error(msg)
  }
  const { merge_id } = await resp.json()
  if (!merge_id) throw new Error('Merge failed: no merge ID returned')

  // Step 2: GET the merged video as a binary download
  const dlResp = await fetchWithTimeout(
    api(`/post/merge-download/${merge_id}`),
    { credentials: 'include' },
    'Merge download',
  );
  if (!dlResp.ok) throw new Error(`Failed to download merged video (HTTP ${dlResp.status})`);
  const blob = await dlResp.blob()
  if (blob.size < 1000) throw new Error('Merge produced empty or corrupt video')
  return URL.createObjectURL(blob)
}

// YouTube
export const startYoutubeConnect = () =>
  fetch(api('/connect/youtube'), { credentials: 'include' }).then(r => r.json())
export const disconnectYoutube = () =>
  fetch(api('/connect/youtube/disconnect'), { method: 'POST', headers: csrf(), credentials: 'include' }).then(r => r.json())
export const postToYoutubeShorts = (caption, imageBase64, mediaType, overlayOpts) =>
  postWithDupCheck('/post/youtube', { caption, image_base64: imageBase64, media_type: mediaType, is_shorts: true, ...overlayOpts })
export const postToYoutubeVideo = (caption, imageBase64, mediaType) =>
  postWithDupCheck('/post/youtube', { caption, image_base64: imageBase64, media_type: mediaType, is_shorts: false })

// Pinterest
export const startPinterestConnect = () =>
  fetch(api('/connect/pinterest'), { credentials: 'include' }).then(r => r.json())
export const disconnectPinterest = () =>
  fetch(api('/connect/pinterest/disconnect'), { method: 'POST', headers: csrf(), credentials: 'include' }).then(r => r.json())
export const postToPinterest = (caption, imageBase64, mediaType) =>
  postWithDupCheck('/post/pinterest', { caption, image_base64: imageBase64, media_type: mediaType })

// WordPress
export const saveWpCredentials = (siteUrl, username, appPassword) =>
  fetch(api('/connect/wordpress/credentials'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ site_url: siteUrl, username, app_password: appPassword }) }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const getWpCategories = () =>
  fetch(api('/connect/wordpress/categories'), { credentials: 'include' }).then(r => r.json())
export const disconnectWp = () =>
  fetch(api('/connect/wordpress/disconnect'), { method: 'POST', headers: csrf(), credentials: 'include' }).then(r => r.json())
export const postToWordPress = (title, content, imageBase64, mediaType, categoryIds, publish = false) =>
  postWithDupCheck('/post/wordpress', { title, content, image_base64: imageBase64, media_type: mediaType, category_ids: categoryIds, publish })

// Scheduling
// Push notifications
export const getVapidKey = () =>
  fetch(api('/push/vapid-key'), { credentials: 'include' }).then(r => r.json())
export const subscribePush = (subscription) =>
  fetch(api('/push/subscribe'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ subscription }) }).then(r => r.json())
export const unsubscribePush = (endpoint) =>
  fetch(api('/push/unsubscribe'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ endpoint }) }).then(r => r.json())
export const testPush = () =>
  fetch(api('/push/test'), { method: 'POST', headers: h(), credentials: 'include' }).then(r => r.json())

export const getWeekSummary = (from, weeks = 8) =>
  fetch(api(`/schedule/week-summary?from=${from}&weeks=${weeks}`), { credentials: 'include' }).then(r => r.json())

export const schedulePosts = (posts, scheduledAt) =>
  fetch(api('/schedule'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ posts, scheduled_at: scheduledAt }) }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const getScheduledPosts = (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v)).toString()
  return fetch(api('/schedule' + (qs ? '?' + qs : '')), { credentials: 'include' }).then(r => r.json())
}
export const getCalendar = (start, end) =>
  fetch(api(`/schedule/calendar?start=${start}&end=${end}`), { credentials: 'include' }).then(r => r.json())
export const backfillJobNames = () =>
  fetch(api('/schedule/backfill-names'), { method: 'POST', headers: csrf(), credentials: 'include' }).then(r => r.json())
export const cancelScheduledPost = (uuid, { group = false } = {}) =>
  fetch(api(`/schedule/${uuid}/cancel${group ? '?group=true' : ''}`), { method: 'POST', headers: csrf(), credentials: 'include' }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
// Per-segment caption style (Phase 2.3 / Phase 3 layout). The backend
// whitelists fields and ON CONFLICT (job_uuid, segment_id) preserves
// unset values, so you can PUT a partial patch.
export const saveCaptionStyle = (jobUuid, segmentId, patch) =>
  fetch(api(`/jobs/${jobUuid}/voiceover/${segmentId}/caption-style`), {
    method: 'PUT',
    headers: h(),
    credentials: 'include',
    body: JSON.stringify(patch),
  }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })

export const getCaptionStyle = (jobUuid, segmentId) =>
  fetch(api(`/jobs/${jobUuid}/voiceover/${segmentId}/caption-style`), { credentials: 'include' })
    .then(r => r.json())

// Drop the per-segment override so it inherits the job default_caption_style.
// Idempotent on the backend.
export const clearSegmentCaptionStyle = (jobUuid, segmentId) =>
  fetch(api(`/jobs/${jobUuid}/voiceover/${segmentId}/caption-style`), {
    method: 'DELETE', headers: csrf(), credentials: 'include',
  }).then(r => r.json())

// Job-level default caption style. Applies to every segment that doesn't
// have its own caption_styles row. Replaces wholesale; pass { clear: true }
// to wipe.
export const getJobDefaultCaptionStyle = (jobUuid) =>
  fetch(api(`/jobs/${jobUuid}/default-caption-style`), { credentials: 'include' })
    .then(r => r.json())

export const saveJobDefaultCaptionStyle = (jobUuid, body) =>
  fetch(api(`/jobs/${jobUuid}/default-caption-style`), {
    method: 'PUT',
    headers: h(),
    credentials: 'include',
    body: JSON.stringify(body),
  }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })

// Propagate the job default's base_font_size and
// layout_config.verticalPosition to every segment's caption_styles
// row. Body lets the caller flush the sliders' current values to the
// default in the same round-trip: { base_font_size?, vertical_position? }.
// Returns { ok, updated, applied }.
export const cascadeJobDefaultCaptionStyle = async (jobUuid, body = {}) => {
  const r = await fetch(api(`/jobs/${jobUuid}/default-caption-style/cascade`), {
    method: 'POST',
    headers: h(),
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify(body),
  })
  // Handle HTML responses (browser-cached 404s, CDN error pages, etc.)
  // by trying JSON and falling back to a friendlier message — the
  // "Unexpected token '<'" parse error was unhelpful in production.
  const text = await r.text()
  let parsed = null
  try { parsed = JSON.parse(text) } catch { /* HTML or plain-text body */ }
  if (!r.ok) {
    const msg = parsed?.error
      || (text.startsWith('<') ? `Server returned HTML (status ${r.status}) — try a hard reload` : text.slice(0, 160))
      || `Request failed (${r.status})`
    throw new Error(msg)
  }
  if (!parsed) throw new Error('Server returned a non-JSON response — try a hard reload')
  return parsed
}

// Phase 7.1 — emoji injection. Returns { original, enriched, noop }.
// Stateless — caller decides whether to replace the segment's text
// with the enriched version.
export const enrichSegmentText = (jobUuid, segmentId) =>
  fetch(api(`/jobs/${jobUuid}/voiceover/${segmentId}/enrich-text`), {
    method: 'POST',
    headers: csrf(),
    credentials: 'include',
  }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })

// Phase 7.2 — segment transition (crossfade vs cut between segments).
// Body { type: 'cut' } or { type: 'crossfade', crossfadeMs: 400 }.
export const getSegmentTransition = (jobUuid) =>
  fetch(api(`/jobs/${jobUuid}/segment-transition`), { credentials: 'include' })
    .then(r => r.json())

export const saveSegmentTransition = (jobUuid, body) =>
  fetch(api(`/jobs/${jobUuid}/segment-transition`), {
    method: 'PUT',
    headers: h(),
    credentials: 'include',
    body: JSON.stringify(body),
  }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })

// User-entered analytics for a scheduled/posted row. Merges with any
// existing values server-side — pass only the fields you're updating.
// POST (not PATCH) because Railway's proxy strips PATCH.
export const saveScheduledPostAnalytics = (uuid, patch) =>
  fetch(api(`/schedule/${uuid}/analytics`), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify(patch) }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const retryScheduledPost = (uuid, scheduledAt) =>
  csrfFetch(api(`/schedule/${uuid}/retry`), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ scheduled_at: scheduledAt }) }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const deleteScheduledPost = (uuid) =>
  csrfFetch(api(`/schedule/${uuid}`), { method: 'DELETE', headers: csrf(), credentials: 'include' }).then(r => r.json())
export const updateScheduledPost = (uuid, { caption, title, scheduled_at } = {}) =>
  csrfFetch(api(`/schedule/${uuid}`), { method: 'PUT', headers: h(), credentials: 'include', body: JSON.stringify({ caption, title, scheduled_at }) }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const markScheduledPostPosted = (uuid) =>
  csrfFetch(api(`/schedule/${uuid}/mark-posted`), { method: 'POST', headers: csrf(), credentials: 'include' }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })

// Producer Chat — streaming Claude conversation scoped to one draft.
// onChunk fires per token so the panel can paint as text arrives.
// Returns { fullText, error? } once the stream ends. Aborts mid-stream
// when the caller's AbortController fires (e.g. user clicks Stop).
export const producerChat = async (jobUuid, { messages, signal, onChunk, metadata }) => {
  const res = await fetch(api(`/jobs/${jobUuid}/producer/chat`), {
    method: 'POST',
    headers: h(),
    credentials: 'include',
    signal,
    body: JSON.stringify({ messages, metadata: metadata || null }),
  })
  if (!res.ok) {
    let msg = `chat failed (${res.status})`
    try { const j = await res.json(); if (j?.error) msg = j.error } catch {}
    throw new Error(msg)
  }
  // SSE-style: each event is `data: {...}\n\n`. We parse the buffer
  // line-by-line so partial chunks don't drop tokens.
  const reader = res.body.getReader()
  const dec = new TextDecoder('utf-8')
  let buf = ''
  let fullText = ''
  let error = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const lines = frame.split('\n').map(l => l.trim()).filter(Boolean)
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        try {
          const payload = JSON.parse(line.slice(5).trim())
          if (payload.kind === 'text' && payload.text) {
            fullText += payload.text
            onChunk?.(payload.text, fullText)
          } else if (payload.kind === 'error') {
            error = payload.error || 'streaming error'
          }
        } catch { /* ignore malformed frames */ }
      }
    }
  }
  return { fullText, error }
}

// Parse a paste from another AI into structured fields. Returns the
// extracted JSON shape ({ primary?, segments?, overlays?, platformCaption?,
// hashtags?, raw }) so the UI can preview before applying.
export const producerImport = (jobUuid, text) =>
  fetch(api(`/jobs/${jobUuid}/producer/import`), {
    method: 'POST', headers: h(), credentials: 'include',
    body: JSON.stringify({ text }),
  }).then(async r => {
    if (!r.ok) {
      let msg = `import failed (${r.status})`
      try { const j = await r.json(); if (j?.error) msg = j.error } catch {}
      throw new Error(msg)
    }
    return r.json()
  })

// Produce a full final-package from the saved Footage flow review.
// Loads the saved analysis + frames + hint on the BE and makes a
// single multimodal Claude call that emits the standard
// ```final-package fenced JSON. Returns { ok, reply, ... } where
// `reply` is the assistant text (including the fence) the FE
// inserts into chat history client-side.
//
// Like analyzeFullVideo, the BE flushes headers early and writes
// keepalive whitespace while waiting on Claude — so errors come
// back as 200 with { error } in the body.
export const produceFromFootage = (jobUuid) =>
  fetch(api(`/jobs/${jobUuid}/producer/produce-from-footage`), {
    method: 'POST', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({}),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `produceFromFootage failed (${r.status})`)
    }
    const data = await r.json()
    if (data?.error) throw new Error(data.error)
    return data
  })

// Replay prior chat turns for this draft so the panel rehydrates on reload.
export const producerHistory = (jobUuid) =>
  fetch(api(`/jobs/${jobUuid}/producer/history`), { credentials: 'include' })
    .then(r => r.ok ? r.json() : { messages: [] })
    .catch(() => ({ messages: [] }))

// ── Music track / beat-sync ──────────────────────────────────────
// Operator uploads a music file; BE stores it, runs aubio for
// BPM + beat positions + onsets, and persists the analysis on the
// job row. Snap-to-beats then overwrites each clip's trim so cuts
// land on beats, and merge swaps the audio to the music track.

export const uploadJobMusic = (jobUuid, { audio_base64, filename, media_type }) =>
  fetch(api(`/jobs/${jobUuid}/music`), {
    method: 'POST', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({ audio_base64, filename, media_type }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `Music upload failed (${r.status})`)
    }
    return r.json()
  })

export const getJobMusic = (jobUuid) =>
  fetch(api(`/jobs/${jobUuid}/music`), { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getJobMusic failed (${r.status})`)
      }
      return r.json()
    })

export const deleteJobMusic = (jobUuid) =>
  fetch(api(`/jobs/${jobUuid}/music`), {
    method: 'DELETE', headers: { ...h(), ...csrf() }, credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `deleteJobMusic failed (${r.status})`)
    }
    return r.json()
  })

// Set or clear the music trim window. Pass nulls on both fields
// to revert to "use full track". The BE rejects inverted ranges
// (trim_end <= trim_start) with a 400.
export const setJobMusicTrim = (jobUuid, { trim_start, trim_end }) =>
  fetch(api(`/jobs/${jobUuid}/music/trim`), {
    method: 'PATCH', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({ trim_start, trim_end }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setJobMusicTrim failed (${r.status})`)
    }
    return r.json()
  })

// Download audio from a TikTok / Instagram / YouTube URL via
// yt-dlp on the BE. Same shape as direct upload — analyze runs,
// beat_map persists, music_track_key updates. The rights checkbox
// is a hard requirement (BE rejects without it).
export const uploadJobMusicFromUrl = (jobUuid, { url, owns_rights_confirmed }) =>
  fetch(api(`/jobs/${jobUuid}/music/url`), {
    method: 'POST', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({ url, owns_rights_confirmed }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `URL import failed (${r.status})`)
    }
    return r.json()
  })

// Set or clear operator-placed manual cut markers. These override
// the auto-snap algorithm entirely: when set + non-empty, the
// snap-preview / apply use them as the interior cut positions.
// Pass an empty array to clear and fall back to auto-snap.
export const setJobMusicManualCuts = (jobUuid, cuts) =>
  fetch(api(`/jobs/${jobUuid}/music/manual-cuts`), {
    method: 'PATCH', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({ cuts }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setJobMusicManualCuts failed (${r.status})`)
    }
    return r.json()
  })

// Replace the persisted beat array. The snap algorithm reads
// music_beat_map.beats so editing here immediately changes what
// the next Preview / Apply will use. /music/reanalyze restores
// fresh aubio output if the operator wants to undo manual edits.
export const setJobMusicBeats = (jobUuid, beats) =>
  fetch(api(`/jobs/${jobUuid}/music/beats`), {
    method: 'PATCH', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({ beats }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setJobMusicBeats failed (${r.status})`)
    }
    return r.json()
  })

// Set or clear per-job watermark overlay settings. The watermark
// IMAGE is tenant-level (uploaded via Settings → tenants.watermark_path);
// this endpoint just controls when/where/how big it renders on
// this draft.
//
// Pass enabled:false to disable for this draft. BE clamps numeric
// fields (x_pct/y_pct 0-100, size_pct 5-100, opacity 0.05-1).
// Per-job pacing intent — re-weights both the first-2s and
// full-video analyzers. Pass null to clear the operator's choice
// (BE falls back to a duration-based auto default).
//
// Allowed: 'hook_driven' | 'balanced' | 'slow_burn' | 'educational' | null
export const setJobPacingIntent = (jobUuid, intent) =>
  fetch(api(`/jobs/${jobUuid}/pacing-intent`), {
    method: 'PATCH', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({ pacing_intent: intent }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setJobPacingIntent failed (${r.status})`)
    }
    return r.json()
  })

export const setJobWatermark = (jobUuid, settings) =>
  fetch(api(`/jobs/${jobUuid}/watermark`), {
    method: 'PATCH', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify(settings || {}),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setJobWatermark failed (${r.status})`)
    }
    return r.json()
  })

// Pick which detected beat array drives the snap algorithm:
//   'all'         → broadband aubio beats (default)
//   'bass'        → kick / bass drum onsets (40-200 Hz band)
//   'hihat'       → hi-hat / cymbal onsets (>5 kHz band)
//   'bass+hihat'  → union of bass and hi-hat
// Existing music tracks need to be re-analyzed once for the band
// arrays to populate (the bass_beats / hihat_beats fields land on
// fresh uploads + reanalyze, not retroactively).
export const setJobMusicBeatSource = (jobUuid, beatSource) =>
  fetch(api(`/jobs/${jobUuid}/music/beat-source`), {
    method: 'PATCH', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({ beat_source: beatSource }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setJobMusicBeatSource failed (${r.status})`)
    }
    return r.json()
  })

// Toggle beat-driven loop mode. When ON, the snap algorithm uses
// EVERY pacing-strided beat as a cut and the operator's clips
// cycle through the windows on Apply. Default OFF (auto-snap
// produces clip-count cuts).
export const setJobMusicLoopToBeats = (jobUuid, loopToBeats) =>
  fetch(api(`/jobs/${jobUuid}/music/loop-to-beats`), {
    method: 'PATCH', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({ loop_to_beats: !!loopToBeats }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setJobMusicLoopToBeats failed (${r.status})`)
    }
    return r.json()
  })

// When true, the next apply-snap marks every loop-duplicate it
// creates as freeze_frame = true so the rapid-cut montage
// stutters on still frames instead of moving video. Only affects
// algorithm-generated duplicates — operator's source clips are
// untouched. Pairs with the per-clip ❄ toggle on each tile;
// this is the bulk-apply version.
export const setJobMusicFreezeLoops = (jobUuid, freezeLoops) =>
  fetch(api(`/jobs/${jobUuid}/music/freeze-loops`), {
    method: 'PATCH', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({ freeze_loops: !!freezeLoops }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setJobMusicFreezeLoops failed (${r.status})`)
    }
    return r.json()
  })

// Same shape as freeze-loops: when true, apply-snap stamps the
// matching effect onto every loop-duplicate it creates.
export const setJobMusicReverseLoops = (jobUuid, reverseLoops) =>
  fetch(api(`/jobs/${jobUuid}/music/reverse-loops`), {
    method: 'PATCH', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({ reverse_loops: !!reverseLoops }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setJobMusicReverseLoops failed (${r.status})`)
    }
    return r.json()
  })

export const setJobMusicMirrorLoops = (jobUuid, mirrorLoops) =>
  fetch(api(`/jobs/${jobUuid}/music/mirror-loops`), {
    method: 'PATCH', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({ mirror_loops: !!mirrorLoops }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setJobMusicMirrorLoops failed (${r.status})`)
    }
    return r.json()
  })

export const setJobMusicStrobeLoops = (jobUuid, strobeLoops) =>
  fetch(api(`/jobs/${jobUuid}/music/strobe-loops`), {
    method: 'PATCH', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({ strobe_loops: !!strobeLoops }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setJobMusicStrobeLoops failed (${r.status})`)
    }
    return r.json()
  })

export const setJobMusicBeatZoomLoops = (jobUuid, beatZoomLoops) =>
  fetch(api(`/jobs/${jobUuid}/music/beat-zoom-loops`), {
    method: 'PATCH', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({ beat_zoom_loops: !!beatZoomLoops }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setJobMusicBeatZoomLoops failed (${r.status})`)
    }
    return r.json()
  })

// Job-level merge-time override: when true, every clip gets
// beat_zoom regardless of its per-clip column. No apply-snap
// needed; the override kicks in at merge time.
export const setJobMusicBeatZoomAll = (jobUuid, beatZoomAll) =>
  fetch(api(`/jobs/${jobUuid}/music/beat-zoom-all`), {
    method: 'PATCH', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({ beat_zoom_all: !!beatZoomAll }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setJobMusicBeatZoomAll failed (${r.status})`)
    }
    return r.json()
  })

// Pass null to clear; otherwise one of 'bw' | 'inverted' | 'saturated'.
export const setJobMusicLoopColorEffect = (jobUuid, colorEffect) =>
  fetch(api(`/jobs/${jobUuid}/music/loop-color-effect`), {
    method: 'PATCH', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({ color_effect: colorEffect || null }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setJobMusicLoopColorEffect failed (${r.status})`)
    }
    return r.json()
  })

// Pacing controls how spread out the snapped cuts are on the
// music. 1 = every detected beat is a snap candidate (densest
// cuts), 2 = every other beat (moderate), 4 = every 4th beat
// (slowest / downbeat-ish). The algorithm still produces N cuts
// for N host clips — pacing changes WHICH beats they can land on.
export const setJobMusicPacing = (jobUuid, pacing) =>
  fetch(api(`/jobs/${jobUuid}/music/pacing`), {
    method: 'PATCH', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({ pacing: Number(pacing) }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setJobMusicPacing failed (${r.status})`)
    }
    return r.json()
  })

export const reanalyzeJobMusic = (jobUuid, opts = {}) =>
  fetch(api(`/jobs/${jobUuid}/music/reanalyze`), {
    method: 'POST', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({
      // Operator-tunable boom-detector params. BE clamps to safe
      // ranges and falls back to defaults when omitted. Pass a
      // number (0..1) to override; omit to use server defaults.
      boom_peak_pct: typeof opts.boomPeakPct === 'number' ? opts.boomPeakPct : undefined,
      boom_sustain_floor: typeof opts.boomSustainFloor === 'number' ? opts.boomSustainFloor : undefined,
    }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `reanalyzeJobMusic failed (${r.status})`)
    }
    return r.json()
  })

// Beat-snap preview — returns the proposed clip plan (new trim
// values + cut points) WITHOUT mutating the DB. Operator reviews
// the diff before clicking Apply.
export const previewBeatSnap = (jobUuid) =>
  fetch(api(`/jobs/${jobUuid}/music/snap-preview`), { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `previewBeatSnap failed (${r.status})`)
      }
      return r.json()
    })

// Beat-snap apply — transactional UPDATE of every host clip's
// trim_start / trim_end / file_order so cuts land on beats.
export const applyBeatSnap = (jobUuid) =>
  fetch(api(`/jobs/${jobUuid}/music/apply-snap`), {
    method: 'POST', headers: { ...h(), ...csrf() }, credentials: 'include',
    body: JSON.stringify({}),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `applyBeatSnap failed (${r.status})`)
    }
    return r.json()
  })

// Load the most recent persisted first-2-second analysis for a job.
// Returns { analysis, analyzedAt, sourceKind } or { analysis: null }
// when no prior run exists. Used by the panel to rehydrate on reload
// without burning fresh Claude tokens. Frame thumbnails are NOT in
// the persisted log, so they don't come back here — re-run analyze
// to see frames again.
export const lastFirstTwoSecAnalysis = (jobUuid) =>
  fetch(api(`/jobs/${jobUuid}/producer/analyze-first-2s/last`), {
    credentials: 'include',
  }).then(r => r.ok ? r.json() : { analysis: null }).catch(() => ({ analysis: null }))

// First-2-second TikTok scroll-stop analyzer. Extracts 6 frames from
// the merged video, sends them to Claude vision, returns structured
// FirstTwoSecondAnalysis JSON + the frame thumbnails so the panel can
// show the user what the AI saw. ~5-10s round-trip on a typical job.
//
// On a 422 (the BE's "critic returned non-JSON" path), we attach the
// raw model response to the thrown error so the panel can surface it
// — otherwise users hit a generic message with no way to debug.
export const analyzeFirstTwoSec = (jobUuid) =>
  fetch(api(`/jobs/${jobUuid}/producer/analyze-first-2s`), {
    method: 'POST', headers: h(), credentials: 'include', body: '{}',
  }).then(async r => {
    if (!r.ok) {
      let body = null
      try { body = await r.json() } catch {}
      const msg = body?.error || `analyze failed (${r.status})`
      const err = new Error(msg)
      if (body?.raw) err.raw = body.raw
      throw err
    }
    return r.json()
  })

// Grade a hook / voiceover / caption. Returns structured scores +
// strengths/weaknesses/AI-detection/viral-potential + concrete
// rewrites. The FE renders the breakdown as cards.
//   mode      — 'onScreen' | 'spoken' | 'both'. Tells the critic
//               whether to gate the hook on read time (overlay),
//               speak time (VO), or both. Default depends on kind.
//   windowSec — display window in seconds the hook must fit within.
//               Default 2.0s.
export const producerGrade = (jobUuid, { text, kind, target, mode, windowSec }) =>
  fetch(api(`/jobs/${jobUuid}/producer/grade`), {
    method: 'POST', headers: h(), credentials: 'include',
    body: JSON.stringify({ text, kind, target, mode, windowSec }),
  }).then(async r => {
    if (!r.ok) {
      let msg = `grade failed (${r.status})`
      try { const j = await r.json(); if (j?.error) msg = j.error } catch {}
      throw new Error(msg)
    }
    return r.json()
  })

// Apply the most recent First-2s analysis to refine overlay /
// voiceover / captionStyle. Returns proposals; the FE renders them
// for confirmation before persisting via the existing save paths.
export const producerApplyAnalysis = (jobUuid, { targets } = {}) =>
  fetch(api(`/jobs/${jobUuid}/producer/apply-analysis`), {
    method: 'POST', headers: h(), credentials: 'include',
    body: JSON.stringify({ targets: Array.isArray(targets) ? targets : null }),
  }).then(async r => {
    if (!r.ok) {
      let msg = `apply-analysis failed (${r.status})`
      try { const j = await r.json(); if (j?.error) msg = j.error } catch {}
      throw new Error(msg)
    }
    return r.json()
  })
