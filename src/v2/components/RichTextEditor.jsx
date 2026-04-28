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

export default function RichTextEditor({ runs, onChange, defaults, placeholder }) {
  const hostRef = useRef(null)
  const quillRef = useRef(null)
  const resizeObsRef = useRef(null)
  const [loaded, setLoaded] = useState(false)

  const D = defaults || { color: '#ffffff', fontFamily: 'Inter', fontSize: 60 }

  // Lazy-load Quill + its CSS the first time this editor mounts.
  // Runs once per panel mount; subsequent re-renders reuse the
  // existing Quill instance.
  useEffect(() => {
    if (quillRef.current) return
    let cancelled = false
    ;(async () => {
      const QuillMod = await import('quill')
      // Quill ships its theme CSS as a side-effect import; pulling
      // it here keeps the bundle in one chunk.
      await import('quill/dist/quill.snow.css')
      if (cancelled) return
      const Quill = QuillMod.default || QuillMod

      // One-time stylesheet injection. Three purposes:
      //   1. Hide the default-no-value picker options ("Normal" /
      //      "Sans Serif") that Quill prepends to whitelisted
      //      dropdowns — users saw them as duplicates of the
      //      explicit whitelist entries below.
      //   2. Make picker labels human-readable + render each font
      //      option in its own face so users see what they're picking.
      //   3. Scale every font-size class IN THE EDITOR by the editor's
      //      width / 1080. The rendered video applies the same math
      //      (size in 1080-ref px × frame_width / 1080), so without
      //      this the editor displays "24px" literally while the
      //      video shows it as ~6px on a 280-px-wide preview.
      //      WYSIWYG means the editor preview must match the export.
      if (!document.getElementById('posty-quill-overrides')) {
        const style = document.createElement('style')
        style.id = 'posty-quill-overrides'
        style.textContent = [
          // Hide picker entries with no data-value attribute (the
          // "default" pseudo-options that match Quill's empty-state).
          '.ql-snow .ql-picker.ql-size .ql-picker-item:not([data-value]),',
          '.ql-snow .ql-picker.ql-font .ql-picker-item:not([data-value]) { display: none; }',
          // When toolbar shows the default state in its label spot,
          // give it readable text instead of an empty string.
          '.ql-snow .ql-picker.ql-size .ql-picker-label:not([data-value])::before,',
          '.ql-snow .ql-picker.ql-size .ql-picker-label[data-value=""]::before { content: "Size"; }',
          '.ql-snow .ql-picker.ql-font .ql-picker-label:not([data-value])::before,',
          '.ql-snow .ql-picker.ql-font .ql-picker-label[data-value=""]::before { content: "Font"; }',
          // Make the picker dropdowns roomier — the default size of
          // ~80px chops long font names like "Playfair Display".
          '.ql-snow .ql-picker.ql-font { width: 130px; }',
          '.ql-snow .ql-picker.ql-size { width: 70px; }',
          // Render each font option in its own face so users can
          // see what they're picking. Hand-listed because Quill
          // doesn't emit data-value for font-family directly.',
          ...['Inter','Bebas Neue','Anton','Oswald','Montserrat','Poppins','Roboto','Open Sans','Lato','Playfair Display','Lora','Merriweather','Pacifico','Caveat','Permanent Marker','Shadows Into Light','Fredoka','Quicksand','Comfortaa','Righteous','Bangers'].map(f => (
            `.ql-snow .ql-picker.ql-font .ql-picker-label[data-value="${f}"]::before, ` +
            `.ql-snow .ql-picker.ql-font .ql-picker-item[data-value="${f}"]::before { content: "${f}"; font-family: '${f}', system-ui, sans-serif; }`
          )),
          // Picker option labels show the bare number ("24") not "24px".
          ...[24,32,40,48,56,64,72,80,96,120,144,180].map(n => (
            `.ql-snow .ql-picker.ql-size .ql-picker-label[data-value="${n}px"]::before, ` +
            `.ql-snow .ql-picker.ql-size .ql-picker-item[data-value="${n}px"]::before { content: "${n}"; }`
          )),
          // WYSIWYG scaling. The editor's --posty-rte-scale CSS
          // variable is set per-instance from the editor's measured
          // width / 1080. Each whitelist size renders as
          //     font-size: calc(Npx * var(--posty-rte-scale))
          // so what the user sees in the editor matches the relative
          // size that'll render in a 1080-wide export. !important is
          // needed because Quill writes inline styles which would
          // otherwise win cascade.
          ...[24,32,40,48,56,64,72,80,96,120,144,180].map(n => (
            `.ql-editor [style*="font-size: ${n}px"] { ` +
              `font-size: calc(${n}px * var(--posty-rte-scale, 0.3)) !important; ` +
            `}`
          )),
          // Default editor text (no explicit size) renders at the
          // overlay-level default font size, also scaled. The
          // --posty-rte-base-size variable holds the overlay's
          // default size in 1080-ref px; combined with the scale,
          // it gives us the correct visual default.
          '.ql-editor { font-size: calc(var(--posty-rte-base-size, 60px) * var(--posty-rte-scale, 0.3)); }',
        ].join('\n')
        document.head.appendChild(style)
      }

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
        placeholder: placeholder || 'Type your overlay text…',
      })
      quillRef.current = q

      // The "Default" picker entries Quill auto-prepends to size +
      // font dropdowns are hidden via the CSS injected below — they
      // looked like duplicates of our whitelist values to users.
      // The `clean` button on the toolbar is the explicit reset path.

      // WYSIWYG scale: the rendered video shrinks every fontSize
      // by frame_width / 1080. Match that here so what the user
      // sees in the editor matches the export.
      //
      // The reference width is the VIDEO PREVIEW'S rendered width,
      // not the editor's own width. The editor and video are in
      // different panels with different widths; using the editor's
      // width made type look ~30% bigger than the matching overlay
      // in the video. Looking up the video element by data tag
      // anchors the math to what the user actually sees.
      const findVideoEl = () => document.querySelector('video[data-posty-video-preview="true"]')
      const updateScale = () => {
        const video = findVideoEl()
        const w = (video?.clientWidth)
          || hostRef.current?.querySelector('.ql-editor')?.clientWidth
          || hostRef.current?.clientWidth
          || 280
        if (w > 0 && hostRef.current) {
          // Clamp to [0.15, 0.8] so unusually narrow / wide players
          // don't produce illegible or inappropriately huge text.
          const s = Math.max(0.15, Math.min(0.8, w / 1080))
          hostRef.current.style.setProperty('--posty-rte-scale', String(s))
        }
      }
      updateScale()
      if (typeof ResizeObserver !== 'undefined' && hostRef.current) {
        // Observe BOTH the host element AND the video so window
        // resizes that change the video's box update the editor's
        // scale too.
        resizeObsRef.current = new ResizeObserver(updateScale)
        resizeObsRef.current.observe(hostRef.current)
        const video = findVideoEl()
        if (video) resizeObsRef.current.observe(video)
      }

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
      setLoaded(true)
    })()
    return () => { cancelled = true }
    // Mount-once effect — Quill is initialized on first render and
    // reused across re-renders. The runs[] sync effect below handles
    // external updates without recreating the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Update the editor's base-size CSS variable whenever the
  // overlay-level default font size changes. This is what unstyled
  // editor text (text with no explicit size from the size dropdown)
  // renders at — combined with --posty-rte-scale, the visible size
  // matches the rendered video. Variable is read by the .ql-editor
  // font-size rule in the injected stylesheet above.
  useEffect(() => {
    if (!hostRef.current) return
    hostRef.current.style.setProperty(
      '--posty-rte-base-size',
      `${Number(defaults?.fontSize) > 0 ? defaults.fontSize : 60}px`
    )
  }, [defaults?.fontSize])

  // Tear down Quill + the ResizeObserver on unmount so they don't
  // leak listeners across panel switches.
  useEffect(() => () => {
    if (resizeObsRef.current) {
      try { resizeObsRef.current.disconnect() } catch {}
      resizeObsRef.current = null
    }
    if (quillRef.current) {
      try { quillRef.current.disable?.() } catch {}
      quillRef.current = null
    }
  }, [])

  return (
    <div className="bg-white border border-[#e5e5e5] rounded">
      {/* Quill mounts into this div. Min-height keeps the toolbar +
          editor visible while the chunk loads. */}
      <div ref={hostRef} style={{ minHeight: 120 }} />
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
