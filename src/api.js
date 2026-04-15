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

function h(extra = {}) {
  const base = { 'Content-Type': 'application/json', ...extra }
  if (_csrfToken) base['X-CSRF-Token'] = _csrfToken
  return base
}

function csrf() {
  return _csrfToken ? { 'X-CSRF-Token': _csrfToken } : {}
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

// Jobs — persistent session state
export const listJobs = () => fetch(api('/jobs'), { credentials: 'include' }).then(r => r.json())
export const createJob = () => fetch(api('/jobs'), { method: 'POST', headers: h(), credentials: 'include', body: '{}' }).then(r => r.json())
export const getJob = (id) => fetch(api(`/jobs/${id}`), { credentials: 'include' }).then(r => r.json())
export const updateJob = (id, data) => fetch(api(`/jobs/${id}`), { method: 'PUT', headers: h(), credentials: 'include', body: JSON.stringify(data) }).then(r => r.json())
export const deleteJob = (id) => fetch(api(`/jobs/${id}`), { method: 'DELETE', headers: csrf(), credentials: 'include' }).then(r => r.json())
export const duplicateJob = (id) => fetch(api(`/jobs/${id}/duplicate`), { method: 'POST', headers: { ...h(), ...csrf() }, credentials: 'include', body: '{}' }).then(async r => { if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Duplicate failed') } return r.json() })
export const addJobFile = (jobId, data) => fetch(api(`/jobs/${jobId}/files`), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify(data) }).then(r => r.json())
export const updateJobFile = (jobId, fileId, data) => fetch(api(`/jobs/${jobId}/files/${fileId}`), { method: 'PUT', headers: h(), credentials: 'include', body: JSON.stringify(data) }).then(r => r.json())
export const deleteJobFile = (jobId, fileId) => fetch(api(`/jobs/${jobId}/files/${fileId}`), { method: 'DELETE', headers: csrf(), credentials: 'include' }).then(r => r.json())

// Voice analysis
export const analyzeVoice = (examples) =>
  fetch(api('/generate/analyze-voice'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ examples }) }).then(r => r.json())

// Uploads
export const uploadFile = (file, folderName, batchId, parsedKeywords, videoThumb, jobId) => {
  const fd = new FormData()
  fd.append('file', file)
  if (folderName) fd.append('folder_name', folderName)
  if (batchId) fd.append('batch_id', batchId)
  if (jobId) fd.append('job_id', jobId)
  fd.append('parsed_keywords', JSON.stringify(parsedKeywords))
  if (videoThumb) fd.append('video_thumbnail', videoThumb, 'thumb.jpg')
  return fetch(api('/upload'), { method: 'POST', headers: csrf(), credentials: 'include', body: fd }).then(r => {
    if (!r.ok) return r.json().then(e => { throw new Error(e.error || 'Upload failed') })
    return r.json()
  })
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

export const analyzeAnalytics = (platform, rawText) =>
  fetch(api('/generate/analyze-analytics'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ platform, raw_text: rawText }) }).then(r => r.json())

export const getAnalytics = () =>
  fetch(api('/generate/analytics'), { credentials: 'include' }).then(r => r.json())

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

// Generate spoken-style voiceover hook(s) for the ElevenLabs TTS field
export const generateVoiceoverHook = ({ hint, category, includeBody, count } = {}) =>
  fetch(api('/generate/voiceover-hook'), {
    method: 'POST',
    headers: { ...csrf(), 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ hint: hint || null, category: category || null, includeBody: !!includeBody, count: count || 4 }),
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

// ElevenLabs TTS
export const textToSpeech = (text, voiceId, voiceSettings = {}) =>
  fetch(api('/generate/text-to-speech'), { method: 'POST', headers: { ...csrf(), 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ text, voice_id: voiceId, ...voiceSettings }) }).then(r => r.json())
export const getVoices = () =>
  fetch(api('/generate/voices'), { credentials: 'include' }).then(r => r.json())

// Merge 2+ trimmed video clips into a single MP4 with optional transitions
// clips: [{ video_base64, trim_start, trim_end }], transition: string, transition_duration: number
export const mergeVideos = async (clips, transition = 'none', transitionDuration = 1, jobId = null) => {
  // Step 1: POST clips → server merges and saves to /tmp + Supabase (if job_id), returns merge_id
  const resp = await fetch(api('/post/merge-videos'), { method: 'POST', headers: { ...csrf(), 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ clips, transition, transition_duration: transitionDuration, job_id: jobId }) })
  if (!resp.ok) {
    let msg = 'Merge failed'
    try {
      const text = await resp.text()
      try { msg = JSON.parse(text).error || msg } catch { msg = text.slice(0, 200) || msg }
    } catch {}
    throw new Error(msg)
  }
  const { merge_id } = await resp.json()
  if (!merge_id) throw new Error('Merge failed: no merge ID returned')

  // Step 2: GET the merged video as a binary download
  const dlResp = await fetch(api(`/post/merge-download/${merge_id}`), { credentials: 'include' })
  if (!dlResp.ok) throw new Error('Failed to download merged video')
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
export const cancelScheduledPost = (uuid) =>
  fetch(api(`/schedule/${uuid}/cancel`), { method: 'POST', headers: csrf(), credentials: 'include' }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const retryScheduledPost = (uuid, scheduledAt) =>
  fetch(api(`/schedule/${uuid}/retry`), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ scheduled_at: scheduledAt }) }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const deleteScheduledPost = (uuid) =>
  fetch(api(`/schedule/${uuid}`), { method: 'DELETE', headers: csrf(), credentials: 'include' }).then(r => r.json())
export const updateScheduledPost = (uuid, { caption, title, scheduled_at } = {}) =>
  fetch(api(`/schedule/${uuid}`), { method: 'PUT', headers: h(), credentials: 'include', body: JSON.stringify({ caption, title, scheduled_at }) }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const markScheduledPostPosted = (uuid) =>
  fetch(api(`/schedule/${uuid}/mark-posted`), { method: 'POST', headers: csrf(), credentials: 'include' }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
