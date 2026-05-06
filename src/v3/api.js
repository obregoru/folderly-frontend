// V3 Content Studio API wrappers.
//
// Reuses the auth + tenant scoping helpers from src/api.js (single
// source of truth for /api/me, csrf, tenantSlug). Defines its own
// endpoint wrappers under /api/t/:slug/content/* so V3 stays isolated
// from V2's /jobs/* surface.
//
// Every wrapper throws on non-2xx with a useful message — no
// {ok, error} return shapes. Callers use try/catch.

import { tenantSlug, setTenantSlug, getCsrfToken, setCsrfToken, getMe, getSettings } from '../api'

// Re-export the shared helpers so V3 components don't need to know
// they're sourced from src/api.js. If we ever split fully, only this
// file changes.
export { tenantSlug, setTenantSlug, getCsrfToken, setCsrfToken, getMe, getSettings }

// Resolve the V3 base URL once. Mirrors the api() helper in src/api.js
// but is private to this module so we don't accidentally make V3 calls
// against the V2 base.
const apiBase = () => {
  const slug = tenantSlug()
  if (!slug) throw new Error('Tenant not loaded — wait for getMe() before calling V3 endpoints.')
  const root = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || ''
  return `${root}/api/t/${slug}`
}

// Shared headers helper. Mirrors V2's csrf-aware request shape.
const jsonHeaders = () => {
  const h = { 'Content-Type': 'application/json' }
  const c = getCsrfToken()
  if (c) h['x-csrf-token'] = c
  return h
}

// ── Tenant content config ─────────────────────────────────────────
export const getContentConfig = () =>
  fetch(`${apiBase()}/content/config`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getContentConfig failed (${r.status})`)
      }
      return r.json()
    })

export const updateContentConfig = (patch) =>
  fetch(`${apiBase()}/content/config`, {
    method: 'PUT',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(patch || {}),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `updateContentConfig failed (${r.status})`)
    }
    return r.json()
  })

// ── Indexed-content listing (debug + UI) ──────────────────────────
export const getContentIndex = () =>
  fetch(`${apiBase()}/content/index`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getContentIndex failed (${r.status})`)
      }
      return r.json()
    })

// ── Manual indexer trigger ────────────────────────────────────────
// opts.forceReembed: re-embed every indexed post regardless of
// modified_at. Used when you've changed embedding providers or
// want to back-fill rows whose previous embedding call failed.
export const refreshContentIndex = (opts = {}) =>
  fetch(`${apiBase()}/content/index/refresh`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ force_reembed: !!opts.forceReembed }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `refreshContentIndex failed (${r.status})`)
    }
    return r.json()
  })

// ── Storage health ────────────────────────────────────────────────
// Returns { configured: boolean }. Used by the editor to surface a
// "image storage not configured" banner BEFORE the user attempts an
// upload. Works without auth checks beyond the standard tenant
// wrapper since the response is pure boolean state.
export const getStorageStatus = () =>
  fetch(`${apiBase()}/content/storage-status`, { credentials: 'include' })
    .then(r => r.json())
    .catch(() => ({ configured: false }))

// ── Tenant WP taxonomy ────────────────────────────────────────────
// Snapshot of categories + tags pulled by the WP indexer. Used for
// FE autocomplete on the editor + read-only category chips on
// ideation candidate cards.
export const getTaxonomy = () =>
  fetch(`${apiBase()}/content/taxonomy`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getTaxonomy failed (${r.status})`)
      }
      return r.json()
    })

// ── Topic ideation ────────────────────────────────────────────────
// Run Claude + web_search to produce 8 candidate topics for the
// chosen template. BE persists to blog_topics and returns the
// candidates inline so the UI shows them immediately.
export const ideateTopics = ({ template, promptText }) =>
  fetch(`${apiBase()}/content/topics/ideate`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ template, prompt_text: promptText }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `ideateTopics failed (${r.status})`)
    }
    return r.json()
  })

// List recent ideation runs.
export const listTopics = () =>
  fetch(`${apiBase()}/content/topics`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `listTopics failed (${r.status})`)
      }
      return r.json()
    })

// Fetch one ideation run by id (with full candidates + accept state).
export const getTopic = (id) =>
  fetch(`${apiBase()}/content/topics/${id}`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getTopic failed (${r.status})`)
      }
      return r.json()
    })

// Accept candidate(s) → BE creates blog_posts rows in 'drafting' status.
export const acceptTopics = (topicId, indices) =>
  fetch(`${apiBase()}/content/topics/${topicId}/accept`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ indices }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `acceptTopics failed (${r.status})`)
    }
    return r.json()
  })

// ── Blog drafts list ──────────────────────────────────────────────
export const listBlogPosts = () =>
  fetch(`${apiBase()}/content/blog-posts`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `listBlogPosts failed (${r.status})`)
      }
      return r.json()
    })

// Single draft, full row (includes body_md + generation metadata).
export const getBlogPost = (id) =>
  fetch(`${apiBase()}/content/blog-posts/${id}`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getBlogPost failed (${r.status})`)
      }
      return r.json()
    })

// Manual edit. Pass any subset of editable fields.
export const updateBlogPost = (id, patch) =>
  fetch(`${apiBase()}/content/blog-posts/${id}`, {
    method: 'PUT',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(patch || {}),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `updateBlogPost failed (${r.status})`)
    }
    return r.json()
  })

// Run full article generation. Slow (60-90s) — caller should show
// a "generating" UI and poll/refresh when the response lands.
export const generateBlogPost = (id, opts = {}) =>
  fetch(`${apiBase()}/content/blog-posts/${id}/generate`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ target_word_count: opts.targetWordCount }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `generateBlogPost failed (${r.status})`)
    }
    return r.json()
  })

// ── Blog post images (multipart) ──────────────────────────────────
// Upload one image. file is a File / Blob; meta is optional and
// accepts: filename (SEO slug), alt_text, caption, role, position_after_h2_index.
export const uploadBlogImage = (postId, file, meta = {}) => {
  const fd = new FormData()
  fd.append('image', file)
  if (meta.filename != null) fd.append('filename', meta.filename)
  if (meta.alt_text != null) fd.append('alt_text', meta.alt_text)
  if (meta.caption != null) fd.append('caption', meta.caption)
  if (meta.role != null) fd.append('role', meta.role)
  if (meta.position_after_h2_index != null) fd.append('position_after_h2_index', String(meta.position_after_h2_index))
  // Don't set Content-Type — the browser fills in the multipart
  // boundary automatically. Manually set csrf header only.
  const c = getCsrfToken()
  return fetch(`${apiBase()}/content/blog-posts/${postId}/images`, {
    method: 'POST',
    headers: c ? { 'x-csrf-token': c } : {},
    credentials: 'include',
    body: fd,
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `uploadBlogImage failed (${r.status})`)
    }
    return r.json()
  })
}

// Edit metadata (filename, alt, caption, role, position).
export const updateBlogImage = (postId, imageId, patch) =>
  fetch(`${apiBase()}/content/blog-posts/${postId}/images/${imageId}`, {
    method: 'PUT',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(patch || {}),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `updateBlogImage failed (${r.status})`)
    }
    return r.json()
  })

// Delete an image (storage object + row).
export const deleteBlogImage = (postId, imageId) =>
  fetch(`${apiBase()}/content/blog-posts/${postId}/images/${imageId}`, {
    method: 'DELETE',
    headers: jsonHeaders(),
    credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `deleteBlogImage failed (${r.status})`)
    }
    return r.json()
  })

// ── WP publish / unpublish ────────────────────────────────────────
// Publish a 'ready' draft to the tenant's WordPress site. Slow
// (image uploads + post create + Yoast meta). wpStatus options:
//   'publish' (default) → live immediately
//   'draft'             → land in WP Admin as draft for review
//   'private'           → published but only visible to logged-in users
export const publishBlogPost = (id, opts = {}) =>
  fetch(`${apiBase()}/content/blog-posts/${id}/publish`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ wp_status: opts.wpStatus || 'publish' }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `publishBlogPost failed (${r.status})`)
    }
    return r.json()
  })

// Top-K internal-link candidates for a draft, with similarity scores.
// Drives the editor's "swap a link" UI so the user can see which
// existing posts the model considered.
//
// constraintModeOverride: 'open' | 'match_post_categories' | null
//   When set, overrides the saved per-draft / per-template constraint
//   FOR THIS QUERY ONLY — useful for "show me what's out there if I
//   relaxed the rule" exploration without changing saved settings.
export const getLinkCandidates = (postId, k = 12, constraintModeOverride = null) => {
  const params = new URLSearchParams({ k: String(k) })
  if (constraintModeOverride) params.set('constraint_mode', constraintModeOverride)
  return fetch(`${apiBase()}/content/blog-posts/${postId}/link-candidates?${params}`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getLinkCandidates failed (${r.status})`)
      }
      return r.json()
    })
}

// ── Schedule controls ─────────────────────────────────────────────
// Force-schedule a 'ready' / 'flagged' / 'failed' draft. Pass an
// explicit scheduledFor (Date or ISO string) to override the
// cadence finder; omit to let the BE pick the next available slot
// from the tenant's blog_schedule.
export const scheduleBlogPost = (id, opts = {}) => {
  const body = {}
  if (opts.scheduledFor) body.scheduled_for = new Date(opts.scheduledFor).toISOString()
  return fetch(`${apiBase()}/content/blog-posts/${id}/schedule`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(body),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `scheduleBlogPost failed (${r.status})`)
    }
    return r.json()
  })
}

// Pull a 'scheduled' draft back to 'ready'. Clears scheduled_for.
export const unscheduleBlogPost = (id) =>
  fetch(`${apiBase()}/content/blog-posts/${id}/unschedule`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `unscheduleBlogPost failed (${r.status})`)
    }
    return r.json()
  })

// Run a fresh ZeroGPT score against the current body. Returns either
// { ok: true, zerogpt_score, last_zerogpt_check } or { skipped: true,
// reason } when the API key isn't configured.
export const recheckZeroGpt = (id) =>
  fetch(`${apiBase()}/content/blog-posts/${id}/zerogpt-recheck`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `recheckZeroGpt failed (${r.status})`)
    }
    return r.json()
  })

// Flip the WP post back to draft. Local status returns to 'ready'.
export const unpublishBlogPost = (id) =>
  fetch(`${apiBase()}/content/blog-posts/${id}/unpublish`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `unpublishBlogPost failed (${r.status})`)
    }
    return r.json()
  })
