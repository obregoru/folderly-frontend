// Quill-backed WYSIWYG editor for overlay text. Lets the user
// highlight a selection and apply bold / italic / color / font /
// size / line break — same model as Google Docs / TinyMCE / Quill's
// default behavior. Replaces the older RichRunsEditor's discrete
// list-of-rows UX (which was technically correct but cognitively
// wrong: people expect format-on-selection, not edit-by-row).
//
// Storage shape stays as our existing runs[] schema:
//   { text, color?, fontFamily?, fontSize?, bold?, italic?, newlineAfter? }
//
// Conversion at the boundaries:
//   runs[]   → Quill Delta on hydrate (one Delta op per run, with
//              newlineAfter inserting a "\n" op between)
//   Delta    → runs[] on every change (group consecutive ops with
//              identical attributes into a single run; coalesce
//              "\n" markers into newlineAfter on the previous run)
//
// Quill is lazy-loaded (~75kb gz) so the initial bundle isn't paid
// when nobody opens an overlay panel. CSS is loaded via dynamic
// import alongside the JS module so it's part of the same chunk.

import { useEffect, useRef, useState } from 'react'

// Pre-defined size catalog. Quill v2's size whitelist needs explicit
// values; we pick a reasonable spread that matches the overlay
// renderer's effective range. Stored as 1080-reference px so the
// preview / export math doesn't change.
const SIZE_OPTIONS = [24, 32, 40, 48, 56, 64, 72, 80, 96, 120, 144, 180]

// Shared font catalog. Should match the FontPicker's list so users
// see the same families in both places. Hard-coded here to avoid
// importing the catalog (which would un-lazy this chunk).
const FONT_OPTIONS = [
  'Inter', 'Bebas Neue', 'Anton', 'Oswald', 'Montserrat', 'Poppins',
  'Roboto', 'Open Sans', 'Lato', 'Playfair Display', 'Lora', 'Merriweather',
  'Pacifico', 'Caveat', 'Permanent Marker', 'Shadows Into Light',
  'Fredoka', 'Quicksand', 'Comfortaa', 'Righteous', 'Bangers',
]

// Quill's color picker swatches. Hand-picked for brand-safe variety.
const COLOR_PALETTE = [
  '#ffffff', '#000000',
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#ec4899', '#f43f5e',
]

export default function RichTextEditor({ runs, onChange, defaults }) {
  const hostRef = useRef(null)
  const quillRef = useRef(null)
  const lastDeltaRef = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const [enabled, setEnabled] = useState(Array.isArray(runs) && runs.length > 0)

  const D = defaults || { color: '#ffffff', fontFamily: 'Inter', fontSize: 60 }

  // Lazy-load Quill + its CSS the first time the editor is enabled.
  // Runs once per page session so subsequent opens are instant.
  useEffect(() => {
    if (!enabled || quillRef.current) return
    let cancelled = false
    ;(async () => {
      const QuillMod = await import('quill')
      // Quill ships its theme CSS as a side-effect import; pulling
      // it here keeps the bundle in one chunk.
      await import('quill/dist/quill.snow.css')
      if (cancelled) return
      const Quill = QuillMod.default || QuillMod

      // Register custom size + font whitelists so Quill emits our
      // whitelisted values (and the toolbar dropdowns show them).
      const Size = Quill.import('attributors/style/size')
      Size.whitelist = SIZE_OPTIONS.map(n => `${n}px`)
      Quill.register(Size, true)
      const Font = Quill.import('attributors/style/font')
      Font.whitelist = FONT_OPTIONS
      Quill.register(Font, true)
      // Color via inline-style so it renders identically outside
      // Quill (the default attributor uses CSS classes that wouldn't
      // map onto our preview / export).
      const Color = Quill.import('attributors/style/color')
      Quill.register(Color, true)

      const q = new Quill(hostRef.current, {
        theme: 'snow',
        modules: {
          toolbar: {
            container: [
              [{ size: SIZE_OPTIONS.map(n => `${n}px`) }],
              [{ font: FONT_OPTIONS }],
              ['bold', 'italic'],
              [{ color: COLOR_PALETTE }],
              ['clean'],
            ],
          },
        },
        placeholder: 'Type your overlay text…',
      })
      quillRef.current = q

      // Hydrate from existing runs[] if any.
      if (Array.isArray(runs) && runs.length > 0) {
        const delta = runsToDelta(runs, D)
        q.setContents(delta, 'silent')
      }

      // Wire change → runs[]. Skip 'silent' updates so our own
      // hydration pass doesn't loop back through onChange.
      q.on('text-change', (_delta, _old, source) => {
        if (source === 'silent') return
        const fullDelta = q.getContents()
        const next = deltaToRuns(fullDelta, D)
        // Avoid emitting an empty runs[] just because the user
        // erased everything mid-edit — we still want them inside
        // the editor with no rows, controlled by the disable
        // button.
        onChange(next.length > 0 ? next : null)
      })
      lastDeltaRef.current = q.getContents()
      setLoaded(true)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // External runs[] change → push into Quill (e.g. another tab updated
  // the same overlay). Compare by serialized delta to avoid loops.
  useEffect(() => {
    const q = quillRef.current
    if (!q || !loaded) return
    const want = runsToDelta(runs || [], D)
    const cur = q.getContents()
    // Crude equality check on JSON strings — Quill's deltas don't
    // expose a deep-equal helper publicly.
    if (JSON.stringify(want) === JSON.stringify(cur)) return
    q.setContents(want, 'silent')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs])

  // Tear down Quill on unmount so its global event listeners /
  // observers don't leak across panel switches.
  useEffect(() => () => {
    if (quillRef.current) {
      try { quillRef.current.disable?.() } catch {}
      quillRef.current = null
    }
  }, [])

  const enable = () => {
    setEnabled(true)
    // Seed an empty run so the parent treats us as "active".
    if (!runs || runs.length === 0) onChange([{ text: '', newlineAfter: false }])
  }
  const disable = () => {
    setEnabled(false)
    onChange(null)
    // Quill instance will be GC'd once the host element unmounts.
    quillRef.current = null
  }

  if (!enabled) {
    return (
      <button
        type="button"
        onClick={enable}
        className="text-[10px] py-0.5 px-2 mt-1 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer"
        title="Switch to a rich-text editor — highlight words and click format buttons to style only what you've selected."
      >✨ Rich-text editor</button>
    )
  }

  return (
    <div className="border border-[#6C5CE7]/30 bg-[#f3f0ff]/40 rounded p-1 mt-1 space-y-1">
      <div className="flex items-center gap-2 text-[10px] px-1">
        <span className="font-medium text-[#6C5CE7] flex-1">✨ Rich text</span>
        <button
          type="button"
          onClick={disable}
          className="text-[9px] text-muted border border-[#e5e5e5] rounded px-1.5 py-0.5 bg-white cursor-pointer"
          title="Drop the rich formatting and revert to the plain text above."
        >Use plain text</button>
      </div>
      {/* Quill mounts into this div. Min-height keeps the toolbar
          + editor visible while the chunk loads. */}
      <div ref={hostRef} className="bg-white rounded" style={{ minHeight: 120 }} />
    </div>
  )
}

// runs[] → Quill Delta. Each run becomes one insert op with attributes;
// newlineAfter triggers an explicit "\n" insert between runs (Quill's
// way of marking a paragraph break inside a single editor instance).
// A trailing "\n" is required by Quill — it represents the document's
// final paragraph terminator.
export function runsToDelta(runs, defaults) {
  const ops = []
  const arr = Array.isArray(runs) ? runs : []
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i]
    if (!r) continue
    const text = String(r.text ?? '')
    if (!text) continue
    const attributes = {}
    if (r.bold) attributes.bold = true
    if (r.italic) attributes.italic = true
    if (r.color && r.color !== defaults?.color) attributes.color = r.color
    if (r.fontFamily && r.fontFamily !== defaults?.fontFamily) attributes.font = r.fontFamily
    if (typeof r.fontSize === 'number' && r.fontSize !== defaults?.fontSize) {
      attributes.size = `${r.fontSize}px`
    }
    ops.push(Object.keys(attributes).length > 0
      ? { insert: text, attributes }
      : { insert: text })
    if (r.newlineAfter && i < arr.length - 1) ops.push({ insert: '\n' })
  }
  // Final newline — Quill requires it.
  ops.push({ insert: '\n' })
  return { ops }
}

// Quill Delta → runs[]. Walk ops left-to-right, splitting each op's
// text on "\n" to detect paragraph breaks; consecutive non-newline
// fragments with the same attributes get merged so the user sees
// consolidated runs (rather than one run per character).
export function deltaToRuns(delta, defaults) {
  const out = []
  const ops = (delta && Array.isArray(delta.ops)) ? delta.ops : []
  // Helper: is the next pushed run continuing right after a newline?
  // We use this to set newlineAfter on the previous run.
  let pendingNewline = false
  for (const op of ops) {
    if (typeof op?.insert !== 'string') continue
    const a = op.attributes || {}
    const styleAttrs = {
      bold: !!a.bold,
      italic: !!a.italic,
      color: a.color || undefined,
      fontFamily: a.font || undefined,
      fontSize: parseSize(a.size),
    }
    const fragments = op.insert.split('\n')
    for (let i = 0; i < fragments.length; i++) {
      const frag = fragments[i]
      if (frag.length > 0) {
        if (pendingNewline && out.length > 0) {
          out[out.length - 1].newlineAfter = true
          pendingNewline = false
        }
        // Merge into prior run if same attributes (continuous text).
        const prev = out[out.length - 1]
        if (prev && !prev.newlineAfter && sameStyle(prev, styleAttrs)) {
          prev.text += frag
        } else {
          out.push({
            text: frag,
            ...(styleAttrs.bold ? { bold: true } : {}),
            ...(styleAttrs.italic ? { italic: true } : {}),
            ...(styleAttrs.color ? { color: styleAttrs.color } : {}),
            ...(styleAttrs.fontFamily ? { fontFamily: styleAttrs.fontFamily } : {}),
            ...(typeof styleAttrs.fontSize === 'number' ? { fontSize: styleAttrs.fontSize } : {}),
          })
        }
      }
      // Every separator between fragments is a newline. Mark
      // pending so the NEXT non-empty fragment carries it forward
      // (or, if no more fragments come, it simply terminates the
      // doc — which Quill always appends as one trailing \n).
      if (i < fragments.length - 1) pendingNewline = true
    }
  }
  return out
}

function parseSize(s) {
  if (!s) return undefined
  const m = String(s).match(/^(\d+)px$/)
  return m ? Number(m[1]) : undefined
}

function sameStyle(a, b) {
  return !!a.bold === !!b.bold
    && !!a.italic === !!b.italic
    && (a.color || undefined) === (b.color || undefined)
    && (a.fontFamily || undefined) === (b.fontFamily || undefined)
    && (a.fontSize || undefined) === (b.fontSize || undefined)
}
