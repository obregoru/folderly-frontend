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

// Uploads
export const uploadFile = (file, folderName, batchId, parsedKeywords, videoThumb) => {
  const fd = new FormData()
  fd.append('file', file)
  if (folderName) fd.append('folder_name', folderName)
  if (batchId) fd.append('batch_id', batchId)
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
export async function generateStream(body, onCaptions) {
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
          if (evt.type === 'captions' && evt.data) onCaptions(evt.data)
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

export const getPostingSchedule = () =>
  fetch(api('/generate/posting-schedule'), { method: 'POST', headers: h(), credentials: 'include' }).then(r => r.json())

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
  const resp = await fetch(api('/post/story/preview'), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ caption, image_base64: imageBase64, media_type: mediaType, caption_style: captionStyle, overlay_y_pct: overlayYPct, font_size: fontOpts?.fontSize, font_family: fontOpts?.fontFamily, font_color: fontOpts?.fontColor, font_outline: fontOpts?.fontOutline, opening_text: fontOpts?.openingText, closing_text: fontOpts?.closingText, opening_duration: fontOpts?.openingDuration, closing_duration: fontOpts?.closingDuration }) })
  if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || 'Preview failed')
  const blob = await resp.blob()
  return URL.createObjectURL(blob)
}
export const postToFacebookStory = (caption, imageBase64, mediaType, captionStyle, overlayYPct, fontOpts) =>
  postWithDupCheck('/post/facebook/story', { caption, image_base64: imageBase64, media_type: mediaType, caption_style: captionStyle, overlay_y_pct: overlayYPct, font_size: fontOpts?.fontSize, font_family: fontOpts?.fontFamily, font_color: fontOpts?.fontColor, font_outline: fontOpts?.fontOutline, opening_text: fontOpts?.openingText, closing_text: fontOpts?.closingText, opening_duration: fontOpts?.openingDuration, closing_duration: fontOpts?.closingDuration, fade_time: fontOpts?.fadeTime })
export const postToInstagramStory = (caption, imageBase64, mediaType, captionStyle, overlayYPct, fontOpts) =>
  postWithDupCheck('/post/instagram/story', { caption, image_base64: imageBase64, media_type: mediaType, caption_style: captionStyle, overlay_y_pct: overlayYPct, font_size: fontOpts?.fontSize, font_family: fontOpts?.fontFamily, font_color: fontOpts?.fontColor, font_outline: fontOpts?.fontOutline, opening_text: fontOpts?.openingText, closing_text: fontOpts?.closingText, opening_duration: fontOpts?.openingDuration, closing_duration: fontOpts?.closingDuration, fade_time: fontOpts?.fadeTime })

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

// YouTube
export const startYoutubeConnect = () =>
  fetch(api('/connect/youtube'), { credentials: 'include' }).then(r => r.json())
export const disconnectYoutube = () =>
  fetch(api('/connect/youtube/disconnect'), { method: 'POST', headers: csrf(), credentials: 'include' }).then(r => r.json())
export const postToYoutubeShorts = (caption, imageBase64, mediaType) =>
  postWithDupCheck('/post/youtube', { caption, image_base64: imageBase64, media_type: mediaType })

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
export const cancelScheduledPost = (uuid) =>
  fetch(api(`/schedule/${uuid}/cancel`), { method: 'POST', headers: csrf(), credentials: 'include' }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const retryScheduledPost = (uuid, scheduledAt) =>
  fetch(api(`/schedule/${uuid}/retry`), { method: 'POST', headers: h(), credentials: 'include', body: JSON.stringify({ scheduled_at: scheduledAt }) }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const deleteScheduledPost = (uuid) =>
  fetch(api(`/schedule/${uuid}`), { method: 'DELETE', headers: csrf(), credentials: 'include' }).then(r => r.json())
