// V3 Content Studio API wrappers.
//
// Reuses the auth + tenant scoping helpers from src/api.js (single
// source of truth for /api/me, csrf, tenantSlug). Defines its own
// endpoint wrappers under /api/t/:slug/content/* so V3 stays isolated
// from V2's /jobs/* surface.
//
// Every wrapper throws on non-2xx with a useful message — no
// {ok, error} return shapes. Callers use try/catch.

import { tenantSlug, setTenantSlug, getCsrfToken, setCsrfToken, getMe, getSettings, csrfFetch } from '../api'

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
  csrfFetch(`${apiBase()}/content/config`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getContentConfig failed (${r.status})`)
      }
      return r.json()
    })

export const updateContentConfig = (patch) =>
  csrfFetch(`${apiBase()}/content/config`, {
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
  csrfFetch(`${apiBase()}/content/index`, { credentials: 'include' })
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
  csrfFetch(`${apiBase()}/content/index/refresh`, {
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
  csrfFetch(`${apiBase()}/content/storage-status`, { credentials: 'include' })
    .then(r => r.json())
    .catch(() => ({ configured: false }))

// ── Tenant WP taxonomy ────────────────────────────────────────────
// Snapshot of categories + tags pulled by the WP indexer. Used for
// FE autocomplete on the editor + read-only category chips on
// ideation candidate cards.
export const getTaxonomy = () =>
  csrfFetch(`${apiBase()}/content/taxonomy`, { credentials: 'include' })
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
  csrfFetch(`${apiBase()}/content/topics/ideate`, {
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
  csrfFetch(`${apiBase()}/content/topics`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `listTopics failed (${r.status})`)
      }
      return r.json()
    })

// Fetch one ideation run by id (with full candidates + accept state).
export const getTopic = (id) =>
  csrfFetch(`${apiBase()}/content/topics/${id}`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getTopic failed (${r.status})`)
      }
      return r.json()
    })

// Accept candidate(s) → BE creates blog_posts rows in 'drafting' status.
export const acceptTopics = (topicId, indices) =>
  csrfFetch(`${apiBase()}/content/topics/${topicId}/accept`, {
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
  csrfFetch(`${apiBase()}/content/blog-posts`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `listBlogPosts failed (${r.status})`)
      }
      return r.json()
    })

// Single draft, full row (includes body_md + generation metadata).
export const getBlogPost = (id) =>
  csrfFetch(`${apiBase()}/content/blog-posts/${id}`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getBlogPost failed (${r.status})`)
      }
      return r.json()
    })

// Manual edit. Pass any subset of editable fields.
export const updateBlogPost = (id, patch) =>
  csrfFetch(`${apiBase()}/content/blog-posts/${id}`, {
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
//
// opts.styleHint: optional preset key or free-form critique string.
//   Presets recognized by BE: 'more_conversational', 'more_concise',
//   'fix_flagged_sentences', 'more_specific'. Anything else lands as
//   a custom hint applied verbatim (max 1000 chars).
//
// opts.useFlaggedSentences: when true, BE pulls the saved
//   zerogpt_metadata.sentences off the row and tells Claude to rewrite
//   each one. Combine with styleHint='fix_flagged_sentences' for the
//   "fix what ZeroGPT flagged" flow.
export const generateBlogPost = (id, opts = {}) =>
  csrfFetch(`${apiBase()}/content/blog-posts/${id}/generate`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({
      target_word_count: opts.targetWordCount,
      style_hint: opts.styleHint || null,
      use_flagged_sentences: !!opts.useFlaggedSentences,
    }),
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
  return csrfFetch(`${apiBase()}/content/blog-posts/${postId}/images`, {
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
  csrfFetch(`${apiBase()}/content/blog-posts/${postId}/images/${imageId}`, {
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

// ── WP media library ──────────────────────────────────────────────
// Search/list the tenant's existing WP media — used by the editor's
// "pick from existing image" picker. Avoids re-uploading content that
// already exists on the WP site (and dodges any AI-generated-image
// copyright concerns since we never generate or upload anything new
// in this flow).
export const listWpMedia = ({ search = '', page = 1, perPage = 24 } = {}) => {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) })
  if (search) params.set('search', search)
  return csrfFetch(`${apiBase()}/content/wp-media?${params}`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `listWpMedia failed (${r.status})`)
      }
      return r.json()
    })
}

// Attach an existing WP media item to a draft. Skips the
// upload-to-supabase step; resulting blog_post_images row has
// wp_media_id pre-set so publish-time treats it as already-uploaded.
export const attachWpMedia = (postId, mediaItem, { role = 'inline', positionAfterH2Index = null, altOverride = null, captionOverride = null } = {}) =>
  csrfFetch(`${apiBase()}/content/blog-posts/${postId}/images/from-wp`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({
      wp_media_id: mediaItem.wp_id,
      wp_url: mediaItem.url,
      alt_text: altOverride != null ? altOverride : mediaItem.alt_text,
      caption: captionOverride != null ? captionOverride : (mediaItem.caption || null),
      mime_type: mediaItem.mime_type,
      width: mediaItem.width,
      height: mediaItem.height,
      filename: mediaItem.slug || mediaItem.title || null,
      role,
      position_after_h2_index: positionAfterH2Index,
    }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `attachWpMedia failed (${r.status})`)
    }
    return r.json()
  })

// Set or clear a category's default image. Pass mediaItem=null to clear.
export const setCategoryDefaultImage = (taxonomyId, mediaItem) =>
  csrfFetch(`${apiBase()}/content/taxonomy/${taxonomyId}/default-image`, {
    method: 'PUT',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(
      mediaItem
        ? { wp_media_id: mediaItem.wp_id, wp_url: mediaItem.url, alt_text: mediaItem.alt_text || '' }
        : { wp_media_id: null }
    ),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setCategoryDefaultImage failed (${r.status})`)
    }
    return r.json()
  })

// Delete an image (storage object + row).
export const deleteBlogImage = (postId, imageId) =>
  csrfFetch(`${apiBase()}/content/blog-posts/${postId}/images/${imageId}`, {
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
  csrfFetch(`${apiBase()}/content/blog-posts/${id}/publish`, {
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
  return csrfFetch(`${apiBase()}/content/blog-posts/${postId}/link-candidates?${params}`, { credentials: 'include' })
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
  return csrfFetch(`${apiBase()}/content/blog-posts/${id}/schedule`, {
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
  csrfFetch(`${apiBase()}/content/blog-posts/${id}/unschedule`, {
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
  csrfFetch(`${apiBase()}/content/blog-posts/${id}/zerogpt-recheck`, {
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

// Run a fresh drift-checker score (Haiku-backed self-critique against
// the audience lock + template constraints).
export const recheckDrift = (id) =>
  csrfFetch(`${apiBase()}/content/blog-posts/${id}/drift-recheck`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `recheckDrift failed (${r.status})`)
    }
    return r.json()
  })

// Calendar view: returns N weeks of cadence slots + scheduled / published
// posts attached. weeks defaults to 4 (max 12).
export const getSchedule = (weeks = 4) =>
  csrfFetch(`${apiBase()}/content/schedule?weeks=${weeks}`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getSchedule failed (${r.status})`)
      }
      return r.json()
    })

// Flip the WP post back to draft. Local status returns to 'ready'.
export const unpublishBlogPost = (id) =>
  csrfFetch(`${apiBase()}/content/blog-posts/${id}/unpublish`, {
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

// V3 Phase 7 — recent lifecycle events for the Dashboard panel.
export const getActivity = (limit = 50) =>
  csrfFetch(`${apiBase()}/content/activity?limit=${limit}`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getActivity failed (${r.status})`)
      }
      return r.json()
    })

// V3 follow-up — search free-stock photo providers (Pexels today).
// Returns { configured, items: [...], next_page, ... } or
// { configured: false, reason } when the provider isn't set up.
//
// orientation: 'landscape' | 'portrait' | 'square' | null. Filters
// at the provider level — no client-side cropping needed, subject
// stays in frame.
export const searchFreePhotos = ({ query, page = 1, perPage = 24, provider = 'pexels', orientation = null } = {}) => {
  const params = new URLSearchParams({
    q: query || '',
    page: String(page),
    per_page: String(perPage),
    provider,
  })
  if (orientation) params.set('orientation', orientation)
  return csrfFetch(`${apiBase()}/content/free-photos?${params}`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `searchFreePhotos failed (${r.status})`)
      }
      return r.json()
    })
}

// Attach a free-stock photo to a draft. The server downloads the bytes
// from the provider URL and stores in our blog_post_images table just
// like a direct upload. Pass the full normalized photo object the
// search returned + role/position options.
export const attachFreePhoto = (postId, photo, { role = 'inline', positionAfterH2Index = null, altOverride = null, captionOverride = null, searchQuery = null } = {}) =>
  csrfFetch(`${apiBase()}/content/blog-posts/${postId}/images/from-free-photo`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({
      provider: photo.provider,
      id: photo.id,
      full: photo.full,
      photographer: photo.photographer,
      photographer_url: photo.photographer_url,
      source_page: photo.source_page,
      license: photo.license,
      license_url: photo.license_url,
      alt: photo.alt,
      alt_override: altOverride,
      caption: captionOverride,
      role,
      position_after_h2_index: positionAfterH2Index,
      search_query: searchQuery,
    }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `attachFreePhoto failed (${r.status})`)
    }
    return r.json()
  })

// ── Landing Page Manager (Phase 1) ────────────────────────────────
// List of managed landing pages + the tenant's default post ID + a
// flag for whether WP credentials are configured at all (the FE uses
// that to render a "Connect WordPress first" CTA instead of an
// otherwise-useless Import button).
export const listLandingPages = () =>
  csrfFetch(`${apiBase()}/content/landing`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `listLandingPages failed (${r.status})`)
      }
      return r.json()
    })

// Update the tenant's default landing-page WP post ID. Accepts the
// raw integer OR a wp-admin edit URL — BE parses either out of the
// same input.
// Push a proposed version to the tenant's preview / scratchpad WP
// page. Operator views the result rendered in the actual WP theme
// without committing to a real deploy. Idempotent — subsequent
// pushes overwrite the preview without history.
// Auto-create a preview / scratchpad WP page for this tenant.
// Idempotent — if a preview is already configured, returns the
// existing preview_post_id without creating a new one. Used by
// the FE when an operator clicks 🪞 Preview to sandbox without
// having configured a preview page first.
export const createPreviewPage = () =>
  csrfFetch(`${apiBase()}/content/landing/preview/create`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({}),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `createPreviewPage failed (${r.status})`)
    }
    return r.json()
  })

export const previewLandingPageVersion = (landingPageId, versionId) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(landingPageId)}/preview`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ version_id: versionId }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `previewLandingPageVersion failed (${r.status})`)
    }
    return r.json()
  })

export const setLandingPagePreview = (postIdOrUrl) =>
  csrfFetch(`${apiBase()}/content/landing/settings`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ preview_post_id: postIdOrUrl || null }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setLandingPagePreview failed (${r.status})`)
    }
    return r.json()
  })

export const setLandingPageDefault = (postIdOrUrl) =>
  csrfFetch(`${apiBase()}/content/landing/settings`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ landing_page_wp_post_id: postIdOrUrl }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setLandingPageDefault failed (${r.status})`)
    }
    return r.json()
  })

// Import a WP page. Body is optional — defaults to the tenant's
// stored landing_page_wp_post_id when wp_post_id is omitted. Returns
// the parsed page + capabilities so the workspace can render
// immediately without a follow-up fetch.
export const importLandingPage = (wpPostIdOrUrl) =>
  csrfFetch(`${apiBase()}/content/landing/import`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ wp_post_id: wpPostIdOrUrl || null }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `importLandingPage failed (${r.status})`)
    }
    return r.json()
  })

// Full state of one managed landing page — the row, version history
// (most-recent 50), and audit history (most-recent 20).
export const getLandingPage = (id) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(id)}`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getLandingPage failed (${r.status})`)
      }
      return r.json()
    })

// Run the 5-dimension audit (SEO / AEO / GEO / E-E-A-T /
// AI-naturalness + breadcrumbs check) against the most recent
// imported / human-edited / ai-suggested version. Stores findings
// on landing_page_audits and returns them inline.
export const runLandingPageAudit = (id) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(id)}/audit`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `runLandingPageAudit failed (${r.status})`)
    }
    return r.json()
  })

// Generate a rewrite proposal. Two modes:
//   - With audit: pass { auditId, acceptedSuggestionIds } — Claude
//     addresses the selected findings.
//   - Without audit: pass nothing or { auditId: null } — Claude
//     generates content from scratch using the strategy hint +
//     indexed site pages as source material. Use for scaffold
//     pages where audit is pointless.
export const proposeLandingPageRewrite = (id, { auditId, acceptedSuggestionIds, useCheckFeedback, mode, includeAudit, includeCitations } = {}) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(id)}/propose`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({
      ...(auditId != null ? { audit_id: auditId } : {}),
      ...(Array.isArray(acceptedSuggestionIds) && acceptedSuggestionIds.length > 0
        ? { accepted_suggestion_ids: acceptedSuggestionIds }
        : {}),
      // When set, the BE reads the most recent ai-suggested version's
      // ai_detection + voice_check and feeds them into the propose
      // prompt as remediation guidance. Closes the loop between
      // measurement (Check AI Score / Check Voice) and action.
      ...(useCheckFeedback ? { use_check_feedback: true } : {}),
      // Proposal mode — 'update' (default, surgical edits to existing
      // content) or 'scratch' (full rewrite, existing body is context
      // only). Operator picks via FE button.
      ...(mode ? { mode } : {}),
      // Per-input opt-out flags. Default true on BE; operator can
      // uncheck specific inputs in the FE toggle panel.
      ...(includeAudit === false ? { include_audit: false } : {}),
      ...(includeCitations === false ? { include_citations: false } : {}),
    }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `proposeLandingPageRewrite failed (${r.status})`)
    }
    return r.json()
  })

// Run ZeroGPT on a landing-page version. Returns the score +
// flagged sentences; also persists on the version row so the FE
// doesn't have to re-call ZeroGPT on every tab switch.
export const detectLandingPageAi = (id, versionId) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/detect-ai`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `detectLandingPageAi failed (${r.status})`)
    }
    return r.json()
  })

// Score how well a version's body matches the brand's voice
// profile. Returns { overall_score, verdict, drift_passages,
// summary }. Pairs with ZeroGPT (different failure mode).
export const voiceCheckLandingPageVersion = (id, versionId) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/voice-check`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `voiceCheckLandingPageVersion failed (${r.status})`)
    }
    return r.json()
  })

// Ask Claude to rewrite the version to sound more human. Uses any
// ZeroGPT-flagged sentences on the version as targeted guidance.
// Returns a new ai-suggested version (humanized).
export const humanizeLandingPageVersion = (id, versionId) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/humanize`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `humanizeLandingPageVersion failed (${r.status})`)
    }
    return r.json()
  })

// Push a chosen version to WordPress. Snapshots the current live
// page as a backup BEFORE the deploy, so rollback is always
// available. Returns { backup_version_id, wp_link, wp_modified,
// warnings: [...] }.
export const deployLandingPageVersion = (id, versionId) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(id)}/deploy`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ version_id: versionId }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `deployLandingPageVersion failed (${r.status})`)
    }
    return r.json()
  })

// Roll back to a prior backup. Snapshots current live state as a
// new pre-rollback backup, then PUTs the chosen backup's content
// back to WP. Returns { prebackup_version_id, wp_link }.
export const rollbackLandingPage = (id, backupVersionId) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(id)}/rollback`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ backup_version_id: backupVersionId }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `rollbackLandingPage failed (${r.status})`)
    }
    return r.json()
  })

// Generate Schema.org JSON-LD blocks (LocalBusiness, Service,
// FAQPage, BreadcrumbList, etc.) for a landing-page version.
// Stored on landing_page_versions.schema_jsonld so the FE
// doesn't have to regenerate on tab switch.
export const generateLandingPageSchema = (id, versionId) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/generate-schema`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `generateLandingPageSchema failed (${r.status})`)
    }
    return r.json()
  })

// Google Search Console — get a Google OAuth authorization URL
// for this tenant. FE redirects (or pops up) to this URL; on
// approval Google redirects to our callback which stores the
// refresh token.
export const getGscAuthorizeUrl = () =>
  csrfFetch(`${apiBase()}/content/landing/gsc/authorize-url`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'authorize-url failed')
      return r.json()
    })

// Whether this tenant has connected GSC + which site is selected.
export const getGscStatus = () =>
  csrfFetch(`${apiBase()}/content/landing/gsc/status`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'status failed')
      return r.json()
    })

// List the operator's verified Search Console properties so they
// can pick which one corresponds to the site we manage.
export const listGscSites = () =>
  csrfFetch(`${apiBase()}/content/landing/gsc/sites`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'list-sites failed')
      return r.json()
    })

// Set the chosen GSC property (e.g. "sc-domain:makeandtake.com"
// or "https://makeandtake.com/").
export const setGscSite = (site_url) =>
  csrfFetch(`${apiBase()}/content/landing/gsc/site`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ site_url }),
  }).then(async r => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'set-site failed')
    return r.json()
  })

// Disconnect GSC (wipe refresh_token + site_url).
export const disconnectGsc = () =>
  csrfFetch(`${apiBase()}/content/landing/gsc`, {
    method: 'DELETE',
    headers: jsonHeaders(),
    credentials: 'include',
  }).then(async r => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'disconnect failed')
    return r.json()
  })

// Fetch current 28d vs prior 28d GSC metrics for a specific
// landing page's URL. Operator triggers via "Pull GSC data".
export const fetchLandingPageGsc = (id) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(id)}/gsc`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
  }).then(async r => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'GSC fetch failed')
    return r.json()
  })

// Re-run the per-page audit on every managed page for this
// tenant. Useful after strategy_hint changes or when site
// capabilities update. Sequential on the BE — can take 30s-2m+
// depending on page count + Claude latency.
export const bulkAuditLandingPages = () =>
  csrfFetch(`${apiBase()}/content/landing/bulk-audit`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
  }).then(async r => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'bulk audit failed')
    return r.json()
  })

// Run the cross-page site audit — orphans, broken links,
// cannibalization, stale pages, un-deployed proposals,
// strategic coverage gaps. Returns findings grouped by
// category (graph / content / deploy / strategy).
export const runLandingSiteAudit = () =>
  csrfFetch(`${apiBase()}/content/landing/site-audit`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `runLandingSiteAudit failed (${r.status})`)
    }
    return r.json()
  })

// Edit a proposal's body_html before deploy. Re-parses links /
// headings / images server-side so the diff stays consistent.
// Deploy reads from version.body_html, so saved edits flow
// straight to WordPress on the next deploy.
export const updateLandingVersionBody = (landingPageId, versionId, bodyHtml) =>
  csrfFetch(`${apiBase()}/content/landing/${landingPageId}/versions/${versionId}/body`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ body_html: bodyHtml }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `updateLandingVersionBody failed (${r.status})`)
    }
    return r.json()
  })

// Edit a proposal's title / meta description / focus keyword
// before deploy. Pass any subset of the three; null clears the
// field. Deploy reads from these columns so edits flow straight
// to WordPress on the next deploy without re-running propose.
export const updateLandingVersionMeta = (landingPageId, versionId, fields) =>
  csrfFetch(`${apiBase()}/content/landing/${landingPageId}/versions/${versionId}/meta`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(fields || {}),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `updateLandingVersionMeta failed (${r.status})`)
    }
    return r.json()
  })

// Bulk-import-discover: fetch every WP page from the tenant's
// WordPress install and import any not already managed. Idempotent.
// Onboards a new tenant in one click instead of typing post IDs.
export const bulkImportDiscover = ({ dryRun = false, skipIds = [], refreshUrls = false } = {}) =>
  csrfFetch(`${apiBase()}/content/landing/bulk-import-discover`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ dry_run: dryRun, skip_ids: skipIds, refresh_urls: refreshUrls }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `bulkImportDiscover failed (${r.status})`)
    }
    return r.json()
  })

// Per-finding state on an audit. Operator marks findings as
// 'manual_done' (handled outside the system), 'skipped' (won't
// fix), or 'pending' (default — back to unhandled). Pending
// findings surface as "still needs your attention" in the
// workflow wizard so manual tasks don't get forgotten.
export const setAuditFindingState = (landingPageId, auditId, { suggestionId, state, note }) =>
  csrfFetch(`${apiBase()}/content/landing/${landingPageId}/audits/${auditId}/finding-states`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ suggestion_id: suggestionId, state, ...(note ? { note } : {}) }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setAuditFindingState failed (${r.status})`)
    }
    return r.json()
  })

// Live-page schema validator. Fetches the page from WP and
// validates its JSON-LD entities (same validator the deploy
// success block uses, but operator-triggered). Useful for
// confirming schema is rendering correctly without redeploying.
export const checkLiveSchema = (id) =>
  csrfFetch(`${apiBase()}/content/landing/${id}/check-live-schema`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `checkLiveSchema failed (${r.status})`)
      }
      return r.json()
    })

// Per-page schema allowlist. Lets the operator declare exactly
// which Schema.org @type values this page is allowed to emit. The
// schema generator + deploy filter both enforce the allowlist.
// null = no restriction (current behavior; Claude decides).
export const getSchemaTypesCatalog = () =>
  csrfFetch(`${apiBase()}/content/landing/schema-types-catalog`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getSchemaTypesCatalog failed (${r.status})`)
      }
      return r.json()
    })

export const getLandingPageSchemaTypes = (id) =>
  csrfFetch(`${apiBase()}/content/landing/${id}/schema-types`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getLandingPageSchemaTypes failed (${r.status})`)
      }
      return r.json()
    })

export const setLandingPageSchemaTypes = (id, schemaTypes) =>
  csrfFetch(`${apiBase()}/content/landing/${id}/schema-types`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ schema_types: schemaTypes }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setLandingPageSchemaTypes failed (${r.status})`)
    }
    return r.json()
  })

// Tenant-wide editorial policy — free-form prose the operator
// writes once per tenant; auto-prepended to every audit + propose
// call alongside the per-page strategy hint. Used to encode
// cross-cutting rules (brand separation, neutrality on causes,
// voice discipline) so they don't have to be re-typed on every
// page.
export const getEditorialPolicy = () =>
  csrfFetch(`${apiBase()}/content/landing/editorial-policy`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getEditorialPolicy failed (${r.status})`)
      }
      return r.json()
    })

export const setEditorialPolicy = (text) =>
  csrfFetch(`${apiBase()}/content/landing/editorial-policy`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ editorial_policy: text || null }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setEditorialPolicy failed (${r.status})`)
    }
    return r.json()
  })

// Tenant-wide sitemap strategy brief — the operator's overall plan
// for the site portfolio (tiers, slot rationale, internal-linking
// topology). Typically pasted from a claude.ai brainstorm where
// the strategy was thought through. Auto-prepended to every audit
// + propose call so each page generation knows how it fits the
// larger plan.
export const getSiteIndexHint = () =>
  csrfFetch(`${apiBase()}/content/landing/site-index-hint`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getSiteIndexHint failed (${r.status})`)
      }
      return r.json()
    })

export const setSiteIndexHint = (text) =>
  csrfFetch(`${apiBase()}/content/landing/site-index-hint`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ site_index_hint: text || null }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setSiteIndexHint failed (${r.status})`)
    }
    return r.json()
  })

// Site Setup Wizard — fetch the full state needed to render the
// wizard: plan + per-slot progress + tenant's WP pages list for
// mapping. One round trip; cheap to call on every modal open.
export const getSetupProgress = () =>
  csrfFetch(`${apiBase()}/content/landing/setup-progress`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getSetupProgress failed (${r.status})`)
      }
      return r.json()
    })

// Kick off the auto-content pipeline for a slot. Runs audit +
// propose + schema-gen in the background; FE polls
// getSetupProgress() to see live progress. Returns immediately
// with { ok, slot_id, stage: 'auditing' }.
//
// regenerate: when true, the pipeline ignores prior AI proposals
// and starts fresh from the original imported / scaffold version.
// Use when the previous proposal wasn't right and operator wants
// a clean redo (e.g. created a page, started generating, quit,
// returned days later and wants new content).
export const runSetupSlotPipeline = (slotId, { regenerate = false } = {}) =>
  csrfFetch(`${apiBase()}/content/landing/setup-progress/slot/${encodeURIComponent(slotId)}/run-pipeline`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ regenerate }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `runSetupSlotPipeline failed (${r.status})`)
    }
    return r.json()
  })

// Apply an action to a slot in the Site Setup Wizard. Actions:
//   - 'map': associate slot with an existing landing_page_id
//   - 'create': create a new WP page from the slot's template
//     (optional slug_override)
//   - 'skip' / 'unskip': mark slot skipped or revert
//   - 'unmap': clear the mapping (revert to pending)
export const updateSetupSlot = (slotId, action, extras = {}) =>
  csrfFetch(`${apiBase()}/content/landing/setup-progress/slot`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ slot_id: slotId, action, ...extras }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `updateSetupSlot failed (${r.status})`)
    }
    return r.json()
  })

// Fetch the tenant-specific fan-out plan (canonical page set
// + tier organization). Returns { plan: null } when no plan is
// configured for the tenant — the FE uses that to hide the button.
export const getFanOutPlan = () =>
  csrfFetch(`${apiBase()}/content/landing/fan-out/plan`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getFanOutPlan failed (${r.status})`)
      }
      return r.json()
    })

// Batch-create the selected fan-out plan entries. ids is an array
// of plan-entry ids (from getFanOutPlan().plan[].id). Returns
// { results: [{ id, success, landing_page_id?, error?, skipped? }] }.
export const runFanOut = (ids) =>
  csrfFetch(`${apiBase()}/content/landing/fan-out`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ ids }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `runFanOut failed (${r.status})`)
    }
    return r.json()
  })

// Replace the full ai_citations array for a landing page.
// Operators paste in Google AI Overview / ChatGPT / Perplexity
// snippets that quote this page so we can tell Claude on every
// subsequent audit + propose: "preserve the language earning
// these citations." Server validates + caps each row.
export const setLandingPageAiCitations = (landingPageId, citations) =>
  csrfFetch(`${apiBase()}/content/landing/${landingPageId}/ai-citations`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ ai_citations: citations }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setLandingPageAiCitations failed (${r.status})`)
    }
    return r.json()
  })

// CTA tracking — fetch the tracking snippet (to paste into WP)
// plus the rolling 28-day click count so the operator can verify
// the snippet is live ("clicks_28d > 0" = it's working).
export const getCtaSettings = () =>
  csrfFetch(`${apiBase()}/content/landing/cta-settings`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getCtaSettings failed (${r.status})`)
      }
      return r.json()
    })

// Per-CTA click counts for a single landing page, over the last
// 28 days. Returns anchors in document order + any "orphan"
// cta_id rows (CTAs that had clicks before being restructured
// out of the current version).
export const getCtaStats = (landingPageId) =>
  csrfFetch(`${apiBase()}/content/landing/${landingPageId}/cta-stats`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getCtaStats failed (${r.status})`)
      }
      return r.json()
    })

// Upcoming shopping / seasonal moments + which landing pages are
// likely to benefit from a refresh ahead of each. Window defaults
// to 90 days; we surface a season only once it's within both the
// window AND its season-specific lead-time threshold (so Christmas
// shows up 60 days out, Valentine's at 35, etc.).
export const getSeasonalSuggestions = ({ windowDays } = {}) => {
  const qs = windowDays ? `?window_days=${encodeURIComponent(windowDays)}` : ''
  return csrfFetch(`${apiBase()}/content/landing/seasonal${qs}`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getSeasonalSuggestions failed (${r.status})`)
      }
      return r.json()
    })
}

// Record / clear a one-time acknowledgment for a landing-tab gate.
// Currently used keys: 'backup_guide' (shown before first deploy).
// Pass value: null to UNSET (re-opens the auto-show).
export const setLandingAcknowledgment = (key, value) =>
  csrfFetch(`${apiBase()}/content/landing/acknowledge`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ key, value: value === null ? null : true }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setLandingAcknowledgment failed (${r.status})`)
    }
    return r.json()
  })

// List available landing-page templates (city guide, location page,
// Shop Hop event, category page) for the Create form's picker.
export const listLandingPageTemplates = () =>
  csrfFetch(`${apiBase()}/content/landing/templates`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `listLandingPageTemplates failed (${r.status})`)
      }
      return r.json()
    })

// Create a new landing page from scratch — spins up a draft WP page
// via the REST API + creates a landing_pages row + an initial
// imported version row so audit/propose/diff have something to chew
// on. Body: { title, slug?, parent_landing_page_id?, initial_body?,
// status?: 'draft' | 'publish' }.
export const createLandingPage = ({ title, slug, parent_landing_page_id, initial_body, status, template_id, template_vars }) =>
  csrfFetch(`${apiBase()}/content/landing/create`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ title, slug, parent_landing_page_id, initial_body, status, template_id, template_vars }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `createLandingPage failed (${r.status})`)
    }
    return r.json()
  })

// Set the per-page strategy hint that Claude uses on every audit /
// proposal / schema run. Empty string clears the hint.
export const setLandingPageStrategyHint = (id, hint) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(id)}/strategy-hint`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ strategy_hint: hint || '' }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setLandingPageStrategyHint failed (${r.status})`)
    }
    return r.json()
  })

// Save the per-page targeted-update prompt. Separate from
// strategy_hint by design — this text is ONLY consumed by
// applyTargetedUpdate() below, never by audit / propose /
// regenerate. Empty string clears the saved hint.
export const setLandingPageTargetedUpdateHint = (id, hint) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(id)}/targeted-update-hint`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ targeted_update_hint: hint || '' }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `setLandingPageTargetedUpdateHint failed (${r.status})`)
    }
    return r.json()
  })

// Apply a surgical edit pass to the LATEST version (buffer) using
// the saved targeted-update hint (or an inline override). Returns
// { version_id, status: 'running' }; poll getLandingPageVersion
// until proposal_status flips to 'done' (same pattern as propose).
export const applyLandingPageTargetedUpdate = (id, { hint } = {}) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(id)}/targeted-update`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(typeof hint === 'string' ? { hint } : {}),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `applyLandingPageTargetedUpdate failed (${r.status})`)
    }
    return r.json()
  })

// ─────────────────────────────────────────────────────────────────
// Sitemap Wizard — editable plan (slots + tiers) CRUD wrappers
// ─────────────────────────────────────────────────────────────────

// GET the full editable sitemap plan (slots + tier metadata). The
// BE auto-seeds from the JS starter on first call, so this returns
// useful data even for tenants who haven't touched the wizard yet.
export const getSitemapPlan = () =>
  csrfFetch(`${apiBase()}/content/landing/plan`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getSitemapPlan failed (${r.status})`)
      }
      return r.json()
    })

// Upsert a slot. slot_key + label required; other fields optional.
export const upsertSitemapSlot = (slot) =>
  csrfFetch(`${apiBase()}/content/landing/plan/slot`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(slot || {}),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `upsertSitemapSlot failed (${r.status})`)
    }
    return r.json()
  })

// Partial update on an existing slot row.
export const updateSitemapSlot = (id, patch) =>
  csrfFetch(`${apiBase()}/content/landing/plan/slot/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(patch || {}),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `updateSitemapSlot failed (${r.status})`)
    }
    return r.json()
  })

// Soft-delete a slot (audit trail preserved; re-create with same
// slot_key un-soft-deletes).
export const deleteSitemapSlot = (id) =>
  csrfFetch(`${apiBase()}/content/landing/plan/slot/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: jsonHeaders(),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `deleteSitemapSlot failed (${r.status})`)
    }
    return r.json()
  })

// Parse the saved sitemap strategy brief (tenants.site_index_hint)
// into a structured { tiers, pages } plan via Claude Haiku. ASYNC
// flow: backend kicks off Haiku in setImmediate (otherwise 30-page
// briefs would exceed Cloudflare's 100s edge timeout), returns
// immediately with status='running'. We poll the status endpoint
// every 2.5s until status='done' or 'failed'.
//
// Returns the same { parsed, model_used, tokens_in, tokens_out }
// shape the old synchronous version returned, so the caller code
// stays unchanged. Throws on parse failure.
export const parseSitemapBrief = async () => {
  // 1. Kick off the job.
  const startResp = await csrfFetch(`${apiBase()}/content/landing/plan/parse-brief`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: '{}',
  })
  if (!startResp.ok) {
    const e = await startResp.json().catch(() => ({}))
    throw new Error(e.error || `parseSitemapBrief start failed (${startResp.status})`)
  }
  // Possible immediate states: running (just started) or running
  // (already in flight from a prior request). Either way: poll.

  // 2. Poll the status endpoint until done. Cap at 5 minutes so a
  //    truly stuck server doesn't hang the UI forever.
  const pollDeadline = Date.now() + 5 * 60 * 1000
  while (Date.now() < pollDeadline) {
    await new Promise(r => setTimeout(r, 2500))
    const statusResp = await csrfFetch(`${apiBase()}/content/landing/plan/parse-brief/status`, {
      credentials: 'include',
    })
    if (!statusResp.ok) {
      const e = await statusResp.json().catch(() => ({}))
      throw new Error(e.error || `parseSitemapBrief poll failed (${statusResp.status})`)
    }
    const job = await statusResp.json()
    if (job.status === 'done') {
      return job.result // { parsed, model_used, tokens_in, tokens_out }
    }
    if (job.status === 'failed') {
      throw new Error(job.error || 'parse-brief failed')
    }
    if (job.status === 'idle') {
      // Server restarted mid-job. Re-kick from the top.
      throw new Error('parse-brief job state was lost (server may have restarted) — retry the request')
    }
    // 'running' → keep polling
  }
  throw new Error('parseSitemapBrief timed out after 5 minutes')
}

// Take a parsed { tiers, pages } plan and materialize it. Two modes:
//   - 'add-only' (default, safer): only INSERT new slot_keys; leave
//     existing slots completely untouched. Preserves operator manual
//     edits, applied gap-analysis, images, custom hints, etc. Right
//     choice for progressive sitemap expansion.
//   - 'refresh-existing': full UPSERT — refresh existing slots'
//     metadata from the brief. Will overwrite manual edits.
// Returns { tiers_upserted, pages, summary, mode }.
export const propagateInitialSitemap = (parsed, { mode = 'add-only' } = {}) =>
  csrfFetch(`${apiBase()}/content/landing/plan/initial-propagation`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ parsed, mode }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `propagateInitialSitemap failed (${r.status})`)
    }
    return r.json()
  })

// Re-import the JS starter template — idempotent on slot_key.
// Returns { added: N } for the count of newly added slots.
export const reseedSitemapPlan = () =>
  csrfFetch(`${apiBase()}/content/landing/plan/reseed`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: '{}',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `reseedSitemapPlan failed (${r.status})`)
    }
    return r.json()
  })

// Update tier metadata (label + description). Upserts so works on
// unseeded tenants too.
export const updateSitemapTier = (tier, patch) =>
  csrfFetch(`${apiBase()}/content/landing/plan/tier/${encodeURIComponent(tier)}`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(patch || {}),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `updateSitemapTier failed (${r.status})`)
    }
    return r.json()
  })

// Get the slot's tracked competitor (competitor_pages row + last
// audit findings if any). Returns { slot, competitor | null }.
export const getSlotCompetitor = (slotId) =>
  csrfFetch(`${apiBase()}/content/landing/plan/slot/${encodeURIComponent(slotId)}/competitor`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getSlotCompetitor failed (${r.status})`)
      }
      return r.json()
    })

// Scrape the competitor URL (Playwright) and store as a
// competitor_pages row linked to this slot. Body { url? } sets +
// scrapes in one call; otherwise uses the slot's saved
// competitor_url. Returns { competitor }.
export const importSlotCompetitor = (slotId, { url, competitor_label } = {}) =>
  csrfFetch(`${apiBase()}/content/landing/plan/slot/${encodeURIComponent(slotId)}/import-competitor`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ url: url || undefined, competitor_label: competitor_label || undefined }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `importSlotCompetitor failed (${r.status})`)
    }
    return r.json()
  })

// Run a 5-dim SEO/E-E-A-T/GEO/AEO/content gap analysis comparing
// our page (live landing_page if linked, planned intent otherwise)
// against the scraped competitor. Returns { findings, model_used }.
// Findings shape: { summary, seo, eeat, geo, aeo, content,
// top_recommendations }, each dim has { gaps_to_close, our_strengths,
// recommendations }.
export const runSlotGapAnalysis = (slotId) =>
  csrfFetch(`${apiBase()}/content/landing/plan/slot/${encodeURIComponent(slotId)}/gap-analysis`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: '{}',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `runSlotGapAnalysis failed (${r.status})`)
    }
    return r.json()
  })

// Merge the latest gap-analysis findings into the slot's
// extra_strategy_hint (and the linked landing_page's strategy_hint
// if one exists) as a "## Competitive gap analysis" block.
// Idempotent — re-applying replaces the previous block.
export const applyGapToHint = (slotId) =>
  csrfFetch(`${apiBase()}/content/landing/plan/slot/${encodeURIComponent(slotId)}/apply-gap-to-hint`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: '{}',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `applyGapToHint failed (${r.status})`)
    }
    return r.json()
  })

// Landing-page image management. Three image sources (upload /
// Pexels / scrape from a tenant source URL) all converge on the
// same landing_page_images table. List/update/delete + the three
// "add" endpoints.

export const listLandingImages = (landingPageId) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(landingPageId)}/images`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `listLandingImages failed (${r.status})`)
      }
      return r.json()
    })

// Multipart upload — pass a File. Optional metadata: alt_text,
// caption, role ('featured'|'inline'), filename (SEO slug).
export const uploadLandingImage = (landingPageId, file, { alt_text, caption, role, filename } = {}) => {
  const fd = new FormData()
  fd.append('image', file)
  if (alt_text) fd.append('alt_text', alt_text)
  if (caption) fd.append('caption', caption)
  if (role) fd.append('role', role)
  if (filename) fd.append('filename', filename)
  return csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(landingPageId)}/images`, {
    method: 'POST',
    credentials: 'include',
    body: fd,
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `uploadLandingImage failed (${r.status})`)
    }
    return r.json()
  })
}

export const saveLandingImageFromPexels = (landingPageId, { pexels_photo_id, alt_text, caption, role, filename, size = 'large' }) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(landingPageId)}/images/from-pexels`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ pexels_photo_id, alt_text, caption, role, filename, size }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `saveLandingImageFromPexels failed (${r.status})`)
    }
    return r.json()
  })

// Step 1 of source-domain import: Playwright-scrape the URL, get
// the image list. FE shows a picker; operator picks one or more
// to save via saveLandingImageFromSource.
export const discoverImagesAtUrl = (landingPageId, url) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(landingPageId)}/images/from-source-discover`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ url }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `discoverImagesAtUrl failed (${r.status})`)
    }
    return r.json()
  })

export const saveLandingImageFromSource = (landingPageId, { source_url, image_src, alt_text, caption, role, filename }) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(landingPageId)}/images/from-source-pick`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ source_url, image_src, alt_text, caption, role, filename }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `saveLandingImageFromSource failed (${r.status})`)
    }
    return r.json()
  })

export const updateLandingImage = (landingPageId, imageId, patch) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(landingPageId)}/images/${encodeURIComponent(imageId)}`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(patch || {}),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `updateLandingImage failed (${r.status})`)
    }
    return r.json()
  })

export const deleteLandingImage = (landingPageId, imageId) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(landingPageId)}/images/${encodeURIComponent(imageId)}`, {
    method: 'DELETE',
    headers: jsonHeaders(),
    credentials: 'include',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `deleteLandingImage failed (${r.status})`)
    }
    return r.json()
  })

// Per-slot optimization checklist. Returns 6-dim status (SEO /
// AEO / GEO / E-E-A-T / Schema / FAQ) for every slot in the
// sitemap, with relevance heuristics applied. Plus portfolio
// totals for the wizard header summary.
// Shape: { slots: [{ slot_id, slot_key, label, has_landing_page,
//   dimensions: { seo: {relevant, status, score, last_checked}, ... } }],
//   totals: { pass, warn, fail, unchecked, na } }
export const getChecklist = () =>
  csrfFetch(`${apiBase()}/content/landing/plan/checklist`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getChecklist failed (${r.status})`)
      }
      return r.json()
    })

// Tenant voice-anchor pages — operator-curated existing URLs used
// as background context (not a style cage) at content-generation
// time. List / save (replace + scrape) / refresh.
export const getVoiceAnchors = () =>
  csrfFetch(`${apiBase()}/content/landing/voice-anchors`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getVoiceAnchors failed (${r.status})`)
      }
      return r.json()
    })

export const saveVoiceAnchors = (urls) =>
  csrfFetch(`${apiBase()}/content/landing/voice-anchors`, {
    method: 'PUT',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ urls: Array.isArray(urls) ? urls : [] }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `saveVoiceAnchors failed (${r.status})`)
    }
    return r.json()
  })

export const refreshVoiceAnchors = () =>
  csrfFetch(`${apiBase()}/content/landing/voice-anchors/refresh`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: '{}',
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `refreshVoiceAnchors failed (${r.status})`)
    }
    return r.json()
  })

// Bulk-refresh competitor pages across all slots in the sitemap.
// mode: 'missing' (default) | 'stale' | 'all'.
// run_gap_analysis defaults true on the backend; pass false to skip
// the Haiku calls when you just want fresh scrapes.
// stale_days: only matters in 'stale' mode; defaults 7.
// Returns { total, scraped, scrape_failed, analyzed, analysis_failed,
// elapsed_seconds, slots: [{slot_key, scrape_status, analysis_status?, ...}] }
export const refreshCompetitors = ({ mode = 'missing', run_gap_analysis = true, stale_days = 7 } = {}) =>
  csrfFetch(`${apiBase()}/content/landing/plan/refresh-competitors`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ mode, run_gap_analysis, stale_days }),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `refreshCompetitors failed (${r.status})`)
    }
    return r.json()
  })

// Materialize a planned slot into a WP draft page + landing_page row
// + initial imported version. Slot transitions planned → draft.
export const createWpPageForSlot = (id, { slugOverride } = {}) =>
  csrfFetch(`${apiBase()}/content/landing/plan/slot/${encodeURIComponent(id)}/create-wp`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(slugOverride ? { slug_override: slugOverride } : {}),
  }).then(async r => {
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      throw new Error(e.error || `createWpPageForSlot failed (${r.status})`)
    }
    return r.json()
  })

// Fetch a specific historical audit row's full findings.
export const getLandingPageAudit = (id, auditId) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(id)}/audits/${encodeURIComponent(auditId)}`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getLandingPageAudit failed (${r.status})`)
      }
      return r.json()
    })

// Full body_html + raw payload for one specific version. Fetched
// lazily so the list endpoint stays cheap.
export const getLandingPageVersion = (id, versionId) =>
  csrfFetch(`${apiBase()}/content/landing/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `getLandingPageVersion failed (${r.status})`)
      }
      return r.json()
    })
