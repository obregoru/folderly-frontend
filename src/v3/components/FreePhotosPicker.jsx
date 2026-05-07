// V3 follow-up — modal picker for free-stock photo providers.
//
// Today: Pexels only (server-side gates by PEXELS_API_KEY env var).
// Future: Unsplash, Wikimedia Commons — same picker, more providers.
//
// Pattern mirrors WpMediaPicker. The differentiator is per-result
// attribution (photographer + license) shown alongside the thumbnail
// so the operator sees provenance before clicking.
//
// Default-query feature: callers can pass `defaultQuery` and we'll
// auto-search on first open. Useful for "I just generated this draft,
// search free photos using its focus keyword without making me type."

import { useEffect, useState } from 'react'
import * as api from '../api'

export default function FreePhotosPicker({
  open,
  onClose,
  onPick,
  defaultQuery = '',
  defaultOrientation = 'landscape',
  title = 'Pick from free stock photos',
}) {
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  // Orientation filter — Pexels supports landscape/portrait/square
  // natively, so we filter at the source instead of cropping client-
  // side. Default driven by caller (landscape for featured-image
  // pickers, "any" for inline) so the most common case is one click.
  const [orientation, setOrientation] = useState(defaultOrientation)
  const [page, setPage] = useState(1)
  const [items, setItems] = useState([])
  const [hasNextPage, setHasNextPage] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [configured, setConfigured] = useState(true)
  const [unconfiguredReason, setUnconfiguredReason] = useState('')

  // Seed search box from defaultQuery the first time the modal opens.
  // Subsequent opens preserve whatever the user typed last (until
  // close, which resets everything).
  useEffect(() => {
    if (open && defaultQuery && !search && !appliedSearch) {
      setSearch(defaultQuery)
      setAppliedSearch(defaultQuery)
      setPage(1)
    }
  }, [open, defaultQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset on close.
  useEffect(() => {
    if (!open) {
      setSearch('')
      setAppliedSearch('')
      setOrientation(defaultOrientation)
      setPage(1)
      setItems([])
      setError(null)
      setHasNextPage(false)
    }
  }, [open, defaultOrientation])

  // Run the search whenever the applied query, orientation, or page changes.
  useEffect(() => {
    if (!open || !appliedSearch) {
      setItems([])
      return
    }
    let cancelled = false
    setLoading(true); setError(null)
    api.searchFreePhotos({ query: appliedSearch, page, perPage: 24, orientation })
      .then(r => {
        if (cancelled) return
        if (r?.configured === false) {
          setConfigured(false)
          setUnconfiguredReason(r.reason || 'API key not configured')
          setItems([])
          return
        }
        setConfigured(true)
        setItems(Array.isArray(r?.items) ? r.items : [])
        setHasNextPage(!!r?.next_page)
      })
      .catch(e => { if (!cancelled) setError(e?.message || String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, appliedSearch, page, orientation])

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
          <span className="text-[16px]">🌐</span>
          <div className="flex-1">
            <div className="text-[13px] font-medium">{title}</div>
            <div className="text-[10px] text-muted">
              Free for commercial use. Photographer credit recorded for attribution.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] py-1 px-2 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
          >✕ Close</button>
        </div>

        <form onSubmit={submitSearch} className="px-4 py-2 border-b border-[#e5e5e5] flex gap-2 flex-wrap items-center">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search free stock photos (e.g. 'friendship bracelet station')…"
            className="flex-1 min-w-[200px] text-[11px] border border-[#e5e5e5] rounded p-1.5"
            autoFocus
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
          {/* Orientation filter — change snaps the page back to 1 so
              we don't end up paging through filtered results from a
              different filter. */}
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-[10px] text-muted">Shape:</span>
            <OrientationButton current={orientation} value="landscape" label="🖼 Landscape" onChange={v => { setOrientation(v); setPage(1) }} />
            <OrientationButton current={orientation} value="portrait"  label="📱 Portrait"  onChange={v => { setOrientation(v); setPage(1) }} />
            <OrientationButton current={orientation} value="square"    label="◻ Square"    onChange={v => { setOrientation(v); setPage(1) }} />
            <OrientationButton current={orientation} value={null}      label="Any"         onChange={v => { setOrientation(v); setPage(1) }} />
          </div>
        </form>

        <div className="flex-1 overflow-y-auto p-3">
          {!configured && (
            <div className="text-[11px] text-[#8a4b00] bg-[#fff7e6] border border-[#f5a623] rounded p-2 mb-2">
              <b>Free photo search isn't configured on this environment.</b> {unconfiguredReason}
              <div className="mt-1 text-muted">
                Add a Pexels API key to Railway as <code className="font-mono text-[10px] bg-white px-1 rounded">PEXELS_API_KEY</code>. Get one free at <a href="https://www.pexels.com/api/" target="_blank" rel="noopener noreferrer" className="text-[#6C5CE7] underline">pexels.com/api</a>.
              </div>
            </div>
          )}
          {loading && <div className="text-[11px] text-muted italic text-center py-12">Searching…</div>}
          {error && (
            <div className="text-[11px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2 mb-2">
              {error}
            </div>
          )}
          {!loading && configured && items.length === 0 && !error && appliedSearch && (
            <div className="text-[11px] text-muted italic text-center py-12">
              No matches for "{appliedSearch}". Try different keywords.
            </div>
          )}
          {!loading && configured && items.length === 0 && !appliedSearch && (
            <div className="text-[11px] text-muted italic text-center py-12">
              Type a query above to search.
            </div>
          )}
          {!loading && items.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {items.map(p => (
                <button
                  key={`${p.provider}-${p.id}`}
                  type="button"
                  onClick={() => onPick(p)}
                  className="block bg-[#fafafa] border border-[#e5e5e5] hover:border-[#6C5CE7] rounded overflow-hidden cursor-pointer text-left p-0"
                  title={p.alt || `Photo by ${p.photographer}`}
                >
                  <div className="aspect-square bg-black flex items-center justify-center">
                    <img
                      src={p.thumbnail}
                      alt={p.alt || `Photo by ${p.photographer}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="p-1.5">
                    <div className="text-[9px] text-muted truncate" title={p.photographer}>
                      📷 {p.photographer}
                    </div>
                    <div className="text-[8px] text-muted truncate uppercase tracking-wide">
                      {p.provider} · free
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Pagination — Pexels just tells us "is there a next page?",
            so we hide a numeric total and offer prev/next. */}
        {(page > 1 || hasNextPage) && !loading && (
          <div className="px-4 py-2 border-t border-[#e5e5e5] flex items-center gap-2 text-[10px]">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="text-[10px] py-1 px-2 border border-[#e5e5e5] text-ink bg-white rounded cursor-pointer disabled:opacity-40"
            >← Prev</button>
            <span className="text-muted">page {page}</span>
            <button
              type="button"
              onClick={() => setPage(p => p + 1)}
              disabled={!hasNextPage}
              className="text-[10px] py-1 px-2 border border-[#e5e5e5] text-ink bg-white rounded cursor-pointer disabled:opacity-40"
            >Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}

// Tiny pill-style toggle for the orientation filter. `value === null`
// means "any orientation" — Pexels then returns mixed results.
function OrientationButton({ current, value, label, onChange }) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`text-[10px] py-1 px-2 rounded border cursor-pointer ${
        active
          ? 'bg-[#0a4d2c] text-white border-[#0a4d2c]'
          : 'bg-white text-muted border-[#e5e5e5] hover:border-[#0a4d2c]'
      }`}
    >{label}</button>
  )
}
