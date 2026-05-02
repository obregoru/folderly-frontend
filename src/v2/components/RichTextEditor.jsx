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

// Quill picker list — leaned heavy on playful / display / handwriting
// because most overlay text is hook copy where personality wins over
// neutral readability. Plain workhorses kept to a tight five so they
// don't crowd out the fun stuff. Every family here is also in
// src/lib/fonts/catalog.js, which is what the Remotion renderer
// actually loads — drift between this list and that one means the
// editor would let users pick a font the export can't render.
//
// Hard-coded (not imported) on purpose: importing the catalog module
// pulls extra deps and prevents this RichTextEditor chunk from staying
// lazy.
const FONT_OPTIONS = [
  // Plain workhorses — minimal, just enough for "neutral" copy.
  'Inter', 'Montserrat', 'DM Sans',
  'Playfair Display', 'DM Serif Display',
  // Display — chunky, condensed, attention-grabbing.
  'Bebas Neue', 'Anton', 'Bangers', 'Bungee', 'Righteous',
  'Fredoka', 'Lilita One', 'Paytone One', 'Shrikhand',
  'Black Ops One', 'Alfa Slab One', 'Russo One', 'Ultra',
  // Handwriting / script — playful, casual, signature.
  'Lobster', 'Pacifico', 'Dancing Script', 'Caveat',
  'Permanent Marker', 'Kaushan Script', 'Great Vibes', 'Satisfy',
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
  const toolbarTouchHandlerRef = useRef(null)
  // JSON-stringified version of the runs[] we last emitted via onChange.
  // The runs-sync effect compares against this so a round-tripped value
  // (text-change → onChange → parent state → back here) is skipped.
  // Without this, setContents fires on every keystroke, the cursor
  // resets to position 0, and the next keystroke prepends — which is
  // exactly what users saw as "typing backwards / RTL".
  const lastEmittedRef = useRef('__init__')
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

      // React 19 StrictMode mounts → unmounts → re-mounts every
      // component on first render to surface effect-cleanup bugs. The
      // cleanup below clears quillRef but the host DOM element
      // persists across the re-mount. Without this guard, a second
      // Quill instance attaches to the SAME div on re-mount, two
      // editors fight over every keystroke and selection — visibly
      // typing characters in reverse order, dropping selections when
      // a toolbar button is clicked, etc. Quill.find() returns any
      // existing instance attached to the element so we can reuse
      // instead of double-initializing.
      const existing = Quill.find(hostRef.current)
      if (existing) {
        quillRef.current = existing
        setLoaded(true)
        return
      }

      // Inject Google Fonts <link> tags for every option so the
      // picker dropdown can render each label in its own face. The
      // CSS rules below set font-family on each entry, but if the
      // page hasn't actually loaded the family the browser falls
      // back to system-ui — making every option look identical.
      // Browser caches each woff2, so users only download a given
      // family once across the session.
      for (const family of FONT_OPTIONS) {
        const id = `posty-rte-font-${family.replace(/\s+/g, '-')}`
        if (document.getElementById(id)) continue
        const link = document.createElement('link')
        link.id = id
        link.rel = 'stylesheet'
        // 400 + 700 covers regular + bold (the only weights the
        // toolbar's bold button toggles); display=swap so a slow
        // font load doesn't block the picker rendering.
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;700&display=swap`
        document.head.appendChild(link)
      }

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
          // see what they're picking. Drives off FONT_OPTIONS so the
          // labels can never drift from the toolbar whitelist.
          ...FONT_OPTIONS.map(f => (
            `.ql-snow .ql-picker.ql-font .ql-picker-label[data-value="${f}"]::before, ` +
            `.ql-snow .ql-picker.ql-font .ql-picker-item[data-value="${f}"]::before { content: "${f}"; font-family: '${f}', system-ui, sans-serif; }`
          )),
          // Picker option labels show the bare number ("24") not "24px".
          ...[24,32,40,48,56,64,72,80,96,120,144,180].map(n => (
            `.ql-snow .ql-picker.ql-size .ql-picker-label[data-value="${n}px"]::before, ` +
            `.ql-snow .ql-picker.ql-size .ql-picker-item[data-value="${n}px"]::before { content: "${n}"; }`
          )),
          // WYSIWYG scaling. Each whitelist size class renders as
          //     font-size: calc(Npx * var(--posty-rte-scale))
          // so editor text approximates the rendered size at video
          // scale. The --posty-rte-scale variable is set per-instance
          // from the VIDEO PREVIEW'S measured width / 1080.
          //
          // We DELIBERATELY don't constrain editor width or apply
          // text-align tricks here — earlier attempts at "match the
          // video frame width" produced strange typing behavior
          // (cursor jumps, centered overflow) because Quill expects
          // its container to flow naturally LTR. The font-size
          // scaling alone is enough to give users a sense of the
          // rendered size; pixel-perfect frame matching can come back
          // as a separate <SamplePreview> beneath the editor in a
          // future iteration without touching the typing surface.
          ...[24,32,40,48,56,64,72,80,96,120,144,180].map(n => (
            `.ql-editor .ql-size-${n}px { ` +
              `font-size: calc(${n}px * var(--posty-rte-scale, 0.3)) !important; ` +
            `}`
          )),
          // Default editor text (no explicit size class) renders at
          // the overlay-level default font size, scaled the same way.
          '.ql-editor { font-size: calc(var(--posty-rte-base-size, 60px) * var(--posty-rte-scale, 0.3)) !important; }',
          // iOS Safari: Quill's snow-theme pickers (size/font/color)
          // open on tap but option taps frequently don't register
          // because iOS's 300ms tap delay synthesizes a delayed
          // mousedown that races Quill's outside-tap close listener.
          // Net result: the picker stays open and the format never
          // applies. touch-action: manipulation removes the tap
          // delay entirely; user-select prevents the focus-stealing
          // text selection that interferes with the option click.
          '.ql-snow .ql-picker, .ql-snow .ql-picker-label, .ql-snow .ql-picker-item {',
          '  touch-action: manipulation;',
          '  -webkit-tap-highlight-color: rgba(108, 92, 231, 0.2);',
          '}',
          '.ql-snow .ql-picker-options {',
          '  -webkit-user-select: none;',
          '  user-select: none;',
          // Larger tap targets for picker items on touch devices
          '}',
          '@media (pointer: coarse) {',
          '  .ql-snow .ql-picker-item { padding: 8px 10px !important; min-height: 36px; line-height: 20px; }',
          '  .ql-snow .ql-picker-options { max-height: 60vh; overflow-y: auto; }',
          '}',
        ].join('\n')
        document.head.appendChild(style)
      }

      // Register custom size + font whitelists so Quill emits our
      // whitelisted values (and the toolbar dropdowns show them).
      //
      // Size uses the CLASS attributor (emits `class="ql-size-60px"`)
      // because numeric values are CSS-class-name-safe and our scaling
      // CSS targets those classes directly.
      //
      // Font, in contrast, MUST stay on the inline-STYLE attributor.
      // Class attributor turns 'Bebas Neue' into class="ql-font-Bebas
      // Neue" which the HTML parser interprets as TWO classes
      // ('ql-font-Bebas' and 'Neue'), neither of which matches any
      // CSS rule — so the picked font silently never applied. Inline
      // style 'font-family: \"Bebas Neue\"' has no such issue.
      const Size = Quill.import('attributors/class/size')
      Size.whitelist = SIZE_OPTIONS.map(n => `${n}px`)
      Quill.register(Size, true)
      const Font = Quill.import('attributors/style/font')
      Font.whitelist = FONT_OPTIONS
      Quill.register(Font, true)
      // Color stays inline-style so the saved Delta carries the actual
      // hex value (the runs[] → Delta converter reads it directly).
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
          clipboard: { matchVisual: false },
        },
        placeholder: placeholder || 'Type your overlay text…',
      })
      quillRef.current = q

      // iOS Safari fix for the size/font/color pickers. Quill's
      // built-in option-tap path goes through mousedown handlers
      // that race iOS's outside-tap close listener — net result:
      // tapping a size like "60" opens the picker, then the option
      // tap closes the picker without applying the format. Workaround:
      // intercept touchend on picker-item elements, apply the format
      // through Quill's API directly, then manually close the picker.
      // The desktop click path is untouched.
      const toolbarEl = hostRef.current.previousElementSibling // .ql-toolbar lives right before the editor host
      if (toolbarEl) {
        const onPickerTouchEnd = (ev) => {
          const item = ev.target.closest('.ql-picker-item')
          if (!item) return
          const picker = item.closest('.ql-picker')
          if (!picker) return
          const formatName = ['ql-size', 'ql-font', 'ql-color', 'ql-background', 'ql-align']
            .find(c => picker.classList.contains(c))?.replace('ql-', '')
          if (!formatName) return
          ev.preventDefault()
          ev.stopPropagation()
          const dataValue = item.getAttribute('data-value') || null
          // Use the saved range or fall back to selecting all text so
          // a tap-without-selection still does something useful.
          let range = q.getSelection(true)
          if (!range || range.length === 0) {
            const len = q.getLength()
            if (len > 0) {
              q.setSelection(0, len - 1, 'silent')
              range = q.getSelection(true)
            }
          }
          if (range) {
            q.format(formatName, dataValue, 'user')
          }
          // Close the picker and update the label so the visible
          // selection state matches what we just applied.
          picker.classList.remove('ql-expanded')
          const label = picker.querySelector('.ql-picker-label')
          if (label) {
            label.setAttribute('aria-expanded', 'false')
            if (dataValue) label.setAttribute('data-value', dataValue)
            else label.removeAttribute('data-value')
          }
        }
        toolbarEl.addEventListener('touchend', onPickerTouchEnd, true)
        // Track the cleanup so the unmount path can remove the listener.
        toolbarTouchHandlerRef.current = { el: toolbarEl, fn: onPickerTouchEnd }
      }

      // Strip color / background / size / font on paste so pasted
      // content (e.g. text copied from a webpage with dark CSS,
      // Word, Google Docs) doesn't smuggle in inline color attrs.
      // Without this, users pasted hook copy and the resulting
      // runs[] carried `color: '#1a1814'` from the source style —
      // the live preview + the burned-in mp4 then showed the
      // overlay in dark grey instead of the panel's chosen color.
      // bold / italic / line breaks are still allowed through.
      q.clipboard.addMatcher(Node.ELEMENT_NODE, (_node, delta) => {
        const ops = (delta.ops || []).map(op => {
          if (!op || typeof op.insert !== 'string') return op
          const a = { ...(op.attributes || {}) }
          delete a.color
          delete a.background
          delete a.size
          delete a.font
          return Object.keys(a).length > 0
            ? { insert: op.insert, attributes: a }
            : { insert: op.insert }
        })
        return { ops }
      })

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
      // Record the runs[] we hydrated with as the baseline. The runs-
      // sync effect that fires immediately after mount will compare
      // against this and skip — preventing a redundant setContents
      // before the user has even touched the editor.
      lastEmittedRef.current = JSON.stringify(
        Array.isArray(runs) && runs.length > 0 ? runs : null
      )

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
        const out = next.length > 0 ? next : null
        // Record what we just emitted so the runs-sync effect can
        // recognize the round-trip and skip resetting the editor.
        lastEmittedRef.current = JSON.stringify(out)
        onChange(out)
      })
      setLoaded(true)
    })()
    return () => {
      cancelled = true
      const h = toolbarTouchHandlerRef.current
      if (h?.el && h?.fn) {
        h.el.removeEventListener('touchend', h.fn, true)
        toolbarTouchHandlerRef.current = null
      }
    }
    // Mount-once effect — Quill is initialized on first render and
    // reused across re-renders. The runs[] sync effect below handles
    // external updates without recreating the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // External runs[] change → push into Quill (e.g. another tab updated
  // the same overlay). The earlier comparison was Delta-shape based:
  //   JSON.stringify(runsToDelta(runs)) vs JSON.stringify(q.getContents())
  // That broke because Quill normalizes ops (e.g. merges a trailing
  // "\n" into the prior op as one combined insert string), while
  // runsToDelta always emits them as separate ops. The shapes
  // mismatched on every keystroke, setContents fired, the cursor
  // jumped to 0, and the NEXT keystroke landed at the start —
  // visible to the user as letters being typed in reverse order.
  //
  // The correct test is "is this incoming runs[] the one I just
  // emitted?". If yes, the editor already shows it; do nothing.
  // Only genuinely external changes (different shape from what we
  // last emitted) need a re-sync.
  useEffect(() => {
    const q = quillRef.current
    if (!q || !loaded) return
    const incoming = JSON.stringify(runs || null)
    if (incoming === lastEmittedRef.current) return
    const want = runsToDelta(runs || [], D)
    q.setContents(want, 'silent')
    // Update the marker so this external change becomes the new
    // baseline; otherwise the next keystroke's round-trip would be
    // treated as external and re-sync mid-typing.
    lastEmittedRef.current = incoming
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


  // Cleanup: ONLY disconnect the ResizeObserver. We deliberately do
  // NOT clear quillRef or disable() the Quill instance here. Under
  // React 19 StrictMode, this cleanup fires between the dev-time
  // mount → unmount → re-mount cycle. Tearing down Quill there
  // means the re-mount creates a fresh instance ON THE SAME div
  // that the prior one was on, and they overlap (two editors
  // handling the same keystrokes, RTL-looking text, broken
  // selections). Letting Quill stay attached to the host across
  // the cycle, plus the Quill.find() guard at init, gives us a
  // single instance per host element. When the panel truly
  // unmounts (host removed from the DOM), GC reclaims it.
  useEffect(() => () => {
    if (resizeObsRef.current) {
      try { resizeObsRef.current.disconnect() } catch {}
      resizeObsRef.current = null
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
    // A run only carries a color override when it DIFFERS from the
    // panel's default color — picking white from Quill's palette when
    // the panel default is white shouldn't persist as an override
    // (would lock the run to the now-stale literal value if the user
    // later changes the panel default).
    const colorMatchesDefault = a.color
      && defaults?.color
      && normalizeColor(a.color) === normalizeColor(defaults.color)
    const fontMatchesDefault = a.font
      && defaults?.fontFamily
      && a.font === defaults.fontFamily
    const styleAttrs = {
      bold: !!a.bold,
      italic: !!a.italic,
      color: (a.color && !colorMatchesDefault) ? a.color : undefined,
      fontFamily: (a.font && !fontMatchesDefault) ? a.font : undefined,
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

// Normalize CSS color strings for equality comparison: '#fff' /
// '#FFFFFF' / 'rgb(255,255,255)' / 'rgb(255, 255, 255)' all map to
// 'rgb(255,255,255)'. Used by deltaToRuns to detect when an inline
// color matches the panel default and should NOT be persisted as
// a per-run override.
function normalizeColor(c) {
  if (!c) return null
  const s = String(c).trim().toLowerCase()
  if (s.startsWith('#')) {
    const hex = s.slice(1)
    const full = hex.length === 3
      ? hex.split('').map(ch => ch + ch).join('')
      : hex.length === 4
        ? hex.slice(0, 3).split('').map(ch => ch + ch).join('')  // ignore alpha for shape
        : hex.length >= 6 ? hex.slice(0, 6) : null
    if (!full || !/^[0-9a-f]{6}$/.test(full)) return s
    const r = parseInt(full.slice(0, 2), 16)
    const g = parseInt(full.slice(2, 4), 16)
    const b = parseInt(full.slice(4, 6), 16)
    return `rgb(${r},${g},${b})`
  }
  // 'rgb(255, 255, 255)' → 'rgb(255,255,255)'
  return s.replace(/\s+/g, '')
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
