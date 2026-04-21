import { useEffect, useRef, useState } from 'react'
import { sampleTextFor } from '../../lib/fonts/catalog'

/**
 * Visual representation of a single font. Injects a Google Fonts
 * stylesheet link on first intersection so we don't pull 50 fonts on
 * panel mount — only the ones the user actually scrolls past.
 *
 * Font-face loading is cached globally: if another tile previously
 * mounted the same family, the <link> is already in <head> and CSS
 * finds it instantly (no flash).
 *
 * @param {{
 *   font: import('../../lib/fonts/catalog').CatalogFont,
 *   sampleText?: string,
 *   selected?: boolean,
 *   pinned?: boolean,
 *   onClick?: () => void,
 *   onPin?: () => void,
 *   tabIndex?: number,
 *   focused?: boolean,
 * }} props
 */
export default function FontTile({ font, sampleText, selected, pinned, onClick, onPin, tabIndex, focused }) {
  const ref = useRef(null)
  const [loaded, setLoaded] = useState(() => isFontInjected(font.family))

  useEffect(() => {
    if (loaded || !ref.current) return
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          injectFont(font.family)
          setLoaded(true)
          obs.disconnect()
          break
        }
      }
    }, { rootMargin: '120px' }) // start loading just before the tile enters view
    obs.observe(ref.current)
    return () => obs.disconnect()
  }, [font.family, loaded])

  // Keyboard focus ring — drives Phase 4.4 roving focus.
  useEffect(() => {
    if (focused && ref.current) {
      try { ref.current.focus({ preventScroll: false }) } catch {}
    }
  }, [focused])

  const preview = sampleText || sampleTextFor(font)

  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={!!selected}
      tabIndex={tabIndex ?? (focused ? 0 : -1)}
      onClick={onClick}
      onKeyDown={e => {
        // Enter/Space select → handled by the button's native click,
        // but on Space we prevent default page-scroll.
        if (e.key === ' ') { e.preventDefault(); onClick?.() }
      }}
      className={`text-left bg-white border rounded-lg p-2 cursor-pointer transition-colors outline-none focus:ring-2 focus:ring-[#6C5CE7] ${
        selected ? 'border-[#6C5CE7] ring-1 ring-[#6C5CE7]' : 'border-[#e5e5e5] hover:border-[#6C5CE7]/50'
      }`}
      title={font.family}
    >
      <div
        className="text-[18px] leading-[1.1] mb-1 truncate"
        style={{
          fontFamily: `'${font.family}', ${fallbackStackFor(font.category)}`,
          // While loading, the system fallback shows — acceptable flicker
          // alternative to blocking tile render for a network round-trip.
          opacity: loaded ? 1 : 0.55,
        }}
      >
        {preview}
      </div>
      <div className="flex items-center gap-1 text-[9px]">
        <span className="font-medium text-ink truncate flex-1">{font.family}</span>
        <span className="text-[8px] text-muted bg-[#f8f7f3] rounded px-1 py-0.5 flex-shrink-0">
          {categoryShort(font.category)}
        </span>
        {onPin && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onPin() }}
            aria-label={pinned ? 'Unpin font' : 'Pin font'}
            className={`text-[11px] leading-none px-1 bg-transparent border-none cursor-pointer ${
              pinned ? 'text-[#f59e0b]' : 'text-muted hover:text-[#f59e0b]'
            }`}
          >{pinned ? '★' : '☆'}</button>
        )}
      </div>
    </button>
  )
}

// ── font injection helpers ───────────────────────────────────────────

const injectedFamilies = new Set()

function fontUrl(family) {
  // Most weights by default — tiles don't need every weight, but the
  // render endpoint will use the same family at 700. Picking 400+700
  // keeps preview + render consistent without bloating the URL.
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;700&display=swap`
}

function isFontInjected(family) {
  if (injectedFamilies.has(family)) return true
  // If the page pre-loaded this family via another code path, skip.
  const exists = !!document.head.querySelector(`link[data-font="${cssEscape(family)}"]`)
  if (exists) injectedFamilies.add(family)
  return exists
}

function injectFont(family) {
  if (injectedFamilies.has(family)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = fontUrl(family)
  link.dataset.font = family
  document.head.appendChild(link)
  injectedFamilies.add(family)
}

function cssEscape(s) {
  // Minimal — family names have only letters / digits / spaces, so
  // quoting the attribute selector with escaped whitespace is enough.
  return String(s).replace(/"/g, '\\"')
}

function fallbackStackFor(category) {
  switch (category) {
    case 'serif':       return 'Georgia, "Times New Roman", serif'
    case 'monospace':   return '"Courier New", monospace'
    case 'handwriting': return '"Comic Sans MS", cursive'
    case 'display':     return '"Impact", sans-serif'
    default:            return 'system-ui, -apple-system, sans-serif'
  }
}

function categoryShort(c) {
  return { 'sans-serif': 'sans', 'serif': 'serif', 'display': 'display', 'handwriting': 'script', 'monospace': 'mono' }[c] || c
}
