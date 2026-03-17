// Always use VITE_API_URL if set, otherwise empty (for Vite proxy)
const BASE = import.meta.env.VITE_API_URL || ''

function getTenantSlug() {
  // Try meta tag first (server-rendered)
  const meta = document.querySelector('meta[name="tenant-slug"]')
  if (meta && meta.content) return meta.content
  // Try URL path
  const m = window.location.pathname.match(/\/t\/([^/]+)/)
  if (m) return m[1]
  // Fallback: stored from login
  return localStorage.getItem('tenant_slug') || ''
}

let _slug = null
export function tenantSlug() {
  if (!_slug) _slug = getTenantSlug()
  return _slug
}

export function setTenantSlug(slug) {
  _slug = slug
  localStorage.setItem('tenant_slug', slug)
}

function api(path) {
  return `${BASE}/api/t/${tenantSlug()}${path}`
}

const json = { 'Content-Type': 'application/json' }

// Health - not tenant-scoped
export const checkHealth = () => fetch(`${BASE}/api/health`)

// Auth
export const login = (email, password) =>
  fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: json, credentials: 'include', body: JSON.stringify({ email, password }) }).then(r => r.json())
export const logout = () => fetch(`${BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' })
export const getMe = () => fetch(`${BASE}/api/auth/me`, { credentials: 'include' }).then(r => r.ok ? r.json() : null)

// Settings
export const getSettings = () => fetch(api('/settings'), { credentials: 'include' }).then(r => r.json())
export const saveSettings = (s) => fetch(api('/settings'), { method: 'PUT', headers: json, credentials: 'include', body: JSON.stringify(s) })
export const uploadWatermark = (file) => {
  const fd = new FormData()
  fd.append('watermark', file)
  return fetch(api('/settings/watermark'), { method: 'POST', credentials: 'include', body: fd }).then(r => r.json())
}

// Uploads
export const uploadFile = (file, folderName, batchId, parsedKeywords, videoThumb) => {
  const fd = new FormData()
  fd.append('file', file)
  if (folderName) fd.append('folder_name', folderName)
  if (batchId) fd.append('batch_id', batchId)
  fd.append('parsed_keywords', JSON.stringify(parsedKeywords))
  if (videoThumb) fd.append('video_thumbnail', videoThumb, 'thumb.jpg')
  return fetch(api('/upload'), { method: 'POST', credentials: 'include', body: fd }).then(r => {
    if (!r.ok) return r.json().then(e => { throw new Error(e.error || 'Upload failed') })
    return r.json()
  })
}

export const createBatch = (folderName, fileCount) =>
  fetch(api('/upload/batch'), { method: 'POST', headers: json, credentials: 'include', body: JSON.stringify({ folder_name: folderName, file_count: fileCount }) }).then(r => r.json())

// Generate (non-streaming fallback)
export const generate = (body) =>
  fetch(api('/generate'), { method: 'POST', headers: json, credentials: 'include', body: JSON.stringify(body) }).then(r => {
    if (!r.ok) return r.json().then(e => { throw new Error(e.error || 'Server error') })
    return r.json()
  })

// Generate (streaming) - calls onCaptions for each batch of results
export async function generateStream(body, onCaptions) {
  const resp = await fetch(api('/generate/stream'), {
    method: 'POST', headers: json, credentials: 'include', body: JSON.stringify(body)
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
  fetch(api('/generate/humanize'), { method: 'POST', headers: json, credentials: 'include', body: JSON.stringify({ text, platform }) }).then(r => r.json())

export const refine = (text, style, platform) =>
  fetch(api('/generate/refine'), { method: 'POST', headers: json, credentials: 'include', body: JSON.stringify({ text, style, platform }) }).then(r => r.json())

// History
export const getHistory = (limit = 80) =>
  fetch(api(`/history?limit=${limit}`), { credentials: 'include' }).then(r => r.json())

export const updateCaption = (id, captionText) =>
  fetch(api(`/history/${id}`), { method: 'PUT', headers: json, credentials: 'include', body: JSON.stringify({ caption_text: captionText }) })

// Hashtags
export const getHashtags = () => fetch(api('/hashtags'), { credentials: 'include' }).then(r => r.json())
export const createHashtag = (name, hashtags) =>
  fetch(api('/hashtags'), { method: 'POST', headers: json, credentials: 'include', body: JSON.stringify({ name, hashtags }) }).then(r => r.json())
export const updateHashtag = (id, hashtags) =>
  fetch(api(`/hashtags/${id}`), { method: 'PUT', headers: json, credentials: 'include', body: JSON.stringify({ hashtags }) })
export const deleteHashtag = (id) =>
  fetch(api(`/hashtags/${id}`), { method: 'DELETE', credentials: 'include' })

// Admin
const adm = (path) => `${BASE}/api/admin${path}`
export const getTenants = () => fetch(adm('/tenants'), { credentials: 'include' }).then(r => r.json())
export const createTenant = (data) => fetch(adm('/tenants'), { method: 'POST', headers: json, credentials: 'include', body: JSON.stringify(data) }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const deactivateTenant = (id) => fetch(adm(`/tenants/${id}`), { method: 'DELETE', credentials: 'include' })
export const getUsers = () => fetch(adm('/users'), { credentials: 'include' }).then(r => r.json())
export const createUser = (data) => fetch(adm('/users'), { method: 'POST', headers: json, credentials: 'include', body: JSON.stringify(data) }).then(r => { if (!r.ok) return r.json().then(e => { throw new Error(e.error) }); return r.json() })
export const deactivateUser = (id) => fetch(adm(`/users/${id}`), { method: 'DELETE', credentials: 'include' })
export const getThrottleConfig = () => fetch(adm('/throttle'), { credentials: 'include' }).then(r => r.json())
export const updateThrottle = (id, data) => fetch(adm(`/throttle/${id}`), { method: 'PUT', headers: json, credentials: 'include', body: JSON.stringify(data) })
export const getIpBlocklist = () => fetch(adm('/ip-blocklist'), { credentials: 'include' }).then(r => r.json())
export const blockIp = (data) => fetch(adm('/ip-blocklist'), { method: 'POST', headers: json, credentials: 'include', body: JSON.stringify(data) }).then(r => r.json())
export const unblockIp = (id) => fetch(adm(`/ip-blocklist/${id}`), { method: 'DELETE', credentials: 'include' })
