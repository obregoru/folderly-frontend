import { useEffect, useMemo, useRef, useState } from 'react'
import { FONT_CATALOG, CATEGORIES } from '../../lib/fonts/catalog'
import FontTile from './FontTile'

const PIN_STORAGE_KEY = 'posty_font_pins'

function loadPins() {
  try { return new Set(JSON.parse(localStorage.getItem(PIN_STORAGE_KEY) || '[]')) }
  catch { return new Set() }
}
function savePins(set) {
  try { localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify([...set])) } catch {}
}

/**
 * Font picker panel. Grid of <FontTile>s with search, category filter,
 * sort toggle, and per-user pinning (localStorage — flag per Phase 4.3
 * spec to promote to a server-side user prefs table once that exists).
 *
 * @param {{
 *   value?: string,
 *   onChange?: (family: string) => void,
 *   purpose?: 'base' | 'active' | 'override',
 * }} props
 */
export default function FontPicker({ value, onChange, purpose }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState('popular') // 'popular' | 'az'
  const [pins, setPins] = useState(() => loadPins())
  const [focusIdx, setFocusIdx] = useState(-1)
  const searchRef = useRef(null)
  const gridRef = useRef(null)

  const togglePin = (family) => {
    setPins(prev => {
      const next = new Set(prev)
      if (next.has(family)) next.delete(family); else next.add(family)
      savePins(next)
      return next
    })
  }

  // Apply filters + sort once per state change. Split into pinned
  // vs remaining so the picker renders a "★ Pinned" row above the
  // main grid when at least one font is pinned.
  const { pinned, remaining } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = FONT_CATALOG.filter(f => {
      if (category !== 'all' && f.category !== category) return false
      if (q && !f.family.toLowerCase().includes(q)) return false
      return true
    })
    const sorter = sort === 'az'
      ? (a, b) => a.family.localeCompare(b.family)
      : (a, b) => (Number(b.popular) - Number(a.popular)) || a.family.localeCompare(b.family)
    const sorted = [...matches].sort(sorter)
    const pinned = sorted.filter(f => pins.has(f.family))
    const remaining = sorted.filter(f => !pins.has(f.family))
    return { pinned, remaining }
  }, [query, category, sort, pins])

  // Flat list used by keyboard nav — pinned first, then remaining —
  // so arrow keys walk in visual order.
  const ordered = useMemo(() => [...pinned, ...remaining], [pinned, remaining])

  // Phase 4.4 — keyboard. We pin focus at the currently selected font
  // on first render so arrow nav starts from "here" rather than tile 0.
  useEffect(() => {
    if (!value || focusIdx >= 0) return
    const initial = ordered.findIndex(f => f.family === value)
    if (initial >= 0) setFocusIdx(initial)
  }, [value, ordered, focusIdx])

  const handleKey = (e) => {
    if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return }
    if (e.key === 'Escape') { searchRef.current?.blur(); return }
    if (document.activeElement === searchRef.current) return // don't steal keys from the search box
    if (!ordered.length) return
    if (e.key === 'ArrowRight') { e.preventDefault(); setFocusIdx(i => Math.min(ordered.length - 1, Math.max(0, i) + 1)); return }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); setFocusIdx(i => Math.max(0, Math.max(0, i) - 1)); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const cols = estimateCols(gridRef.current)
      setFocusIdx(i => {
        const cur = Math.max(0, i)
        const next = e.key === 'ArrowDown' ? cur + cols : cur - cols
        return Math.max(0, Math.min(ordered.length - 1, next))
      })
      return
    }
    if (e.key === 'Enter') {
      if (focusIdx >= 0 && ordered[focusIdx]) {
        onChange?.(ordered[focusIdx].family)
      }
      return
    }
  }

  const label = purpose === 'active' ? 'Active-word font'
    : purpose === 'override' ? 'Word font'
    : 'Font'

  return (
    <div
      className="bg-white border border-[#e5e5e5] rounded-lg p-2 space-y-2"
      onKeyDown={handleKey}
      role="group"
      aria-label={label}
    >
      <div className="flex items-center gap-1.5">
        <input
          ref={searchRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search fonts…  (press / to focus)"
          className="flex-1 text-[11px] border border-[#e5e5e5] rounded py-1 px-2 bg-white outline-none focus:border-[#6C5CE7]"
          aria-label="Search fonts"
        />
        <select
          value={sort}
          onChange={e => setSort(e.target.value)}
          className="text-[10px] border border-[#e5e5e5] rounded py-1 px-1 bg-white"
          aria-label="Sort"
        >
          <option value="popular">Popular</option>
          <option value="az">A–Z</option>
        </select>
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {['all', ...CATEGORIES].map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`text-[9px] py-0.5 px-2 rounded-full border cursor-pointer ${
              category === c
                ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]'
                : 'bg-white text-muted border-[#e5e5e5] hover:border-[#6C5CE7]/50'
            }`}
          >{c === 'all' ? 'All' : shortCategory(c)}</button>
        ))}
      </div>

      {pinned.length > 0 && (
        <div>
          <div className="text-[9px] font-medium text-[#f59e0b] uppercase tracking-wide mb-1">★ Pinned</div>
          <div
            ref={pinned.length && !remaining.length ? gridRef : undefined}
            role="listbox"
            aria-label="Pinned fonts"
            className="grid grid-cols-2 gap-1.5"
          >
            {pinned.map((f, i) => (
              <FontTile
                key={f.family}
                font={f}
                selected={value === f.family}
                pinned
                focused={focusIdx === i}
                onClick={() => { setFocusIdx(i); onChange?.(f.family) }}
                onPin={() => togglePin(f.family)}
              />
            ))}
          </div>
        </div>
      )}

      {remaining.length > 0 ? (
        <div>
          {pinned.length > 0 && (
            <div className="text-[9px] font-medium text-muted uppercase tracking-wide mb-1 mt-1">All fonts</div>
          )}
          <div
            ref={gridRef}
            role="listbox"
            aria-label="All fonts"
            className="grid grid-cols-2 gap-1.5 max-h-[360px] overflow-y-auto"
          >
            {remaining.map((f, i) => {
              const idx = pinned.length + i
              return (
                <FontTile
                  key={f.family}
                  font={f}
                  selected={value === f.family}
                  pinned={false}
                  focused={focusIdx === idx}
                  onClick={() => { setFocusIdx(idx); onChange?.(f.family) }}
                  onPin={() => togglePin(f.family)}
                />
              )
            })}
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-muted italic text-center py-6 border border-dashed border-[#e5e5e5] rounded">
          No fonts match — try a different category.
        </div>
      )}

      <div className="text-[9px] text-muted italic">
        {ordered.length} fonts · <kbd className="text-[8px] border border-[#e5e5e5] rounded px-1">↑↓ ← →</kbd> nav · <kbd className="text-[8px] border border-[#e5e5e5] rounded px-1">Enter</kbd> select · <kbd className="text-[8px] border border-[#e5e5e5] rounded px-1">/</kbd> search
      </div>
    </div>
  )
}

function shortCategory(c) {
  return { 'sans-serif': 'Sans', 'serif': 'Serif', 'display': 'Display', 'handwriting': 'Script', 'monospace': 'Mono' }[c] || c
}

function estimateCols(grid) {
  if (!grid) return 2
  const firstChild = grid.querySelector('[role="option"]')
  if (!firstChild) return 2
  const tileW = firstChild.getBoundingClientRect().width
  if (!tileW) return 2
  return Math.max(1, Math.round(grid.getBoundingClientRect().width / tileW))
}
