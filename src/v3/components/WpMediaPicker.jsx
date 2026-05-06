// V3 Phase 5.5 — modal picker for the tenant's existing WP media
// library. Used in two places:
//
//   1. BlogPostEditor → ImageManager → "Pick from WP library":
//      attach an existing image to the current draft (no re-upload).
//   2. Config → category cards → "Default image": set a fallback
//      image used when articles in this category don't have an
//      explicit featured image.
//
// Shared component because both consumers need the same
// search-paginated grid. onPick(mediaItem) is the only prop the
// callers need to differentiate behavior.

import { useEffect, useState } from 'react'
import * as api from '../api'

export default function WpMediaPicker({ open, onClose, onPick, title = 'Pick from WP media library' }) {
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState([])
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true); setError(null)
    api.listWpMedia({ search: appliedSearch, page, perPage: 24 })
      .then(r => {
        if (cancelled) return
        setItems(Array.isArray(r?.items) ? r.items : [])
        setTotalPages(Number(r?.total_pages) || 1)
      })
      .catch(e => { if (!cancelled) setError(e?.message || String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, appliedSearch, page])

  // Reset state when the modal closes so the next open starts fresh.
  useEffect(() => {
    if (!open) {
      setSearch('')
      setAppliedSearch('')
      setPage(1)
      setItems([])
      setError(null)
    }
  }, [open])

  if (!open) return null

  const submitSearch = (e) => {
    e?.preventDefault()
    setPage(1)
    setAppliedSearch(search.trim())
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-2xl w-full max-w-[900px] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#e5e5e5]">
          <span className="text-[16px]">📚</span>
          <div className="flex-1">
            <div className="text-[13px] font-medium">{title}</div>
            <div className="text-[10px] text-muted">
              Pulled from your WP media library — already-licensed, alt text already set.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] py-1 px-2 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
          >✕ Close</button>
        </div>

        <form onSubmit={submitSearch} className="px-4 py-2 border-b border-[#e5e5e5] flex gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by filename / title (e.g. 'candle')…"
            className="flex-1 text-[11px] border border-[#e5e5e5] rounded p-1.5"
          />
          <button
            type="submit"
            className="text-[11px] py-1 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer"
          >Search</button>
          {appliedSearch && (
            <button
              type="button"
              onClick={() => { setSearch(''); setAppliedSearch(''); setPage(1) }}
              className="text-[11px] py-1 px-3 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
            >Clear</button>
          )}
        </form>

        <div className="flex-1 overflow-y-auto p-3">
          {loading && <div className="text-[11px] text-muted italic text-center py-12">Loading…</div>}
          {error && (
            <div className="text-[11px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2 mb-2">
              {error}
            </div>
          )}
          {!loading && items.length === 0 && !error && (
            <div className="text-[11px] text-muted italic text-center py-12">
              {appliedSearch ? `No matches for "${appliedSearch}".` : 'No images in the WP media library.'}
            </div>
          )}
          {!loading && items.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {items.map(m => (
                <button
                  key={m.wp_id}
                  type="button"
                  onClick={() => onPick(m)}
                  className="block bg-[#fafafa] border border-[#e5e5e5] hover:border-[#6C5CE7] rounded overflow-hidden cursor-pointer text-left p-0"
                  title={m.title}
                >
                  <div className="aspect-square bg-black flex items-center justify-center">
                    <img
                      src={m.thumbnail || m.url}
                      alt={m.alt_text || m.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="p-1.5">
                    <div className="text-[10px] font-medium truncate" title={m.title}>{m.title}</div>
                    <div className="text-[9px] text-muted truncate" title={m.alt_text}>
                      {m.alt_text || <i className="text-[#c0392b]">no alt</i>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-2 border-t border-[#e5e5e5] flex items-center gap-2 text-[10px]">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="text-[10px] py-1 px-2 border border-[#e5e5e5] text-ink bg-white rounded cursor-pointer disabled:opacity-40"
            >← Prev</button>
            <span className="text-muted">page {page} of {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="text-[10px] py-1 px-2 border border-[#e5e5e5] text-ink bg-white rounded cursor-pointer disabled:opacity-40"
            >Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}
