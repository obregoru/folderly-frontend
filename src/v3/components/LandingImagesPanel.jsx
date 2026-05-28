// Per-landing-page image manager. Shared between SitemapWizard's
// SlotEditor and LandingPages' per-page workspace. Three image
// sources via tabbed picker modal: upload / Pexels / scrape from URL.
//
// All three sources store via /landing_page_images + Supabase,
// scoped to the tenant. Operator can rename SEO filenames, edit
// alt text, mark featured, delete.

import { useEffect, useState } from 'react'
import * as api from '../api'

// onImagesChanged: optional callback invoked with the latest images
// array after every successful reload. Lets a parent (e.g. the
// LandingPages PageWorkspace) keep an in-sync copy for downstream
// renderers — for example, injecting the featured image into the
// rendered-preview iframe — without needing to refetch on its own.
export function LandingImagesPanel({ landingPageId, onImagesChanged }) {
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [err, setErr] = useState(null)

  const reload = async () => {
    setLoading(true); setErr(null)
    try {
      const r = await api.listLandingImages(landingPageId)
      const next = r?.images || []
      setImages(next)
      if (typeof onImagesChanged === 'function') onImagesChanged(next)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { reload() }, [landingPageId])

  const handleDelete = async (img) => {
    if (!confirm(`Delete image "${img.filename}"? This wipes the Supabase storage object too.`)) return
    try {
      await api.deleteLandingImage(landingPageId, img.id)
      await reload()
    } catch (e) { setErr(e?.message || String(e)) }
  }
  const handleSetFeatured = async (img) => {
    try {
      await api.updateLandingImage(landingPageId, img.id, { role: 'featured' })
      await reload()
    } catch (e) { setErr(e?.message || String(e)) }
  }
  const handleRename = async (img) => {
    const newName = prompt('New SEO filename (no extension):', img.filename)
    if (!newName || newName === img.filename) return
    try {
      await api.updateLandingImage(landingPageId, img.id, { filename: newName })
      await reload()
    } catch (e) { setErr(e?.message || String(e)) }
  }
  const handleAltUpdate = async (img) => {
    const newAlt = prompt('Alt text (for accessibility + SEO):', img.alt_text || '')
    if (newAlt === null) return
    try {
      await api.updateLandingImage(landingPageId, img.id, { alt_text: newAlt })
      await reload()
    } catch (e) { setErr(e?.message || String(e)) }
  }

  return (
    <div className="border border-[#e5e5e5] rounded bg-[#fafafa] p-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium">🖼️ Images</span>
        <span className="text-[9px] text-muted">
          {loading ? 'loading…' : `${images.length} image${images.length === 1 ? '' : 's'}`}
        </span>
        <span className="flex-1" />
        <button
          onClick={() => setPickerOpen(true)}
          className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer"
        >+ Add image</button>
      </div>

      {err && <div className="text-[10px] text-[#c0392b]">⚠ {err}</div>}

      {!loading && images.length === 0 && (
        <div className="text-[10px] text-muted italic text-center py-4">
          No images yet. Add via upload, Pexels, or scrape from an existing page on the tenant's site.
        </div>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map(img => (
            <div key={img.id} className="bg-white border border-[#e5e5e5] rounded overflow-hidden">
              {img.public_url
                ? <img src={img.public_url} alt={img.alt_text || ''} className="w-full h-24 object-cover" />
                : <div className="w-full h-24 bg-[#f0f0f0] flex items-center justify-center text-[9px] text-muted">no preview</div>
              }
              <div className="p-1.5 space-y-1">
                <div className="flex items-center gap-1">
                  {img.role === 'featured' && (
                    <span className="text-[8px] py-0.5 px-1 rounded bg-[#fef3c7] text-[#92400e] border border-[#d97706]/40 font-mono">★ featured</span>
                  )}
                  <span className="text-[8px] py-0.5 px-1 rounded bg-[#f0f0f0] text-muted border border-[#d4d4d8] font-mono">{img.source}</span>
                </div>
                <button
                  onClick={() => handleRename(img)}
                  className="block text-[9px] font-mono text-ink truncate w-full text-left cursor-pointer hover:text-[#6C5CE7] bg-transparent border-none p-0"
                  title="Click to rename (SEO filename)"
                >{img.filename}</button>
                <button
                  onClick={() => handleAltUpdate(img)}
                  className="block text-[8px] text-muted truncate w-full text-left cursor-pointer hover:text-[#6C5CE7] bg-transparent border-none p-0 italic"
                  title="Click to edit alt text"
                >{img.alt_text || '— no alt text —'}</button>
                <div className="flex items-center gap-1 pt-1">
                  {img.role !== 'featured' && (
                    <button
                      onClick={() => handleSetFeatured(img)}
                      className="text-[8px] py-0.5 px-1 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer"
                      title="Make this the featured / hero image (one per page)"
                    >★ Feature</button>
                  )}
                  <span className="flex-1" />
                  <button
                    onClick={() => handleDelete(img)}
                    className="text-[8px] py-0.5 px-1 bg-white border border-[#c0392b] text-[#c0392b] rounded cursor-pointer"
                  >🗑</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {pickerOpen && (
        <ImagePickerModal
          landingPageId={landingPageId}
          onClose={() => setPickerOpen(false)}
          onAdded={async () => { await reload() }}
        />
      )}
    </div>
  )
}

function ImagePickerModal({ landingPageId, onClose, onAdded }) {
  const [tab, setTab] = useState('upload') // 'upload' | 'pexels' | 'source'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded shadow-xl border border-[#e5e5e5] max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e5e5e5]">
          <span className="text-[12px] font-semibold">🖼️ Add image</span>
          <div className="flex gap-1 ml-3">
            <TabButton active={tab === 'upload'} onClick={() => setTab('upload')}>📤 Upload</TabButton>
            <TabButton active={tab === 'pexels'} onClick={() => setTab('pexels')}>🎨 Pexels</TabButton>
            <TabButton active={tab === 'source'} onClick={() => setTab('source')}>🌐 From a URL</TabButton>
          </div>
          <div className="flex-1" />
          <button onClick={onClose} className="text-[10px] text-muted bg-transparent border-none cursor-pointer">✕ Close</button>
        </div>
        <div className="flex-1 overflow-auto p-3">
          {tab === 'upload' && <UploadTab landingPageId={landingPageId} onSuccess={() => { onAdded(); onClose(); }} />}
          {tab === 'pexels' && <PexelsTab landingPageId={landingPageId} onSuccess={() => { onAdded(); onClose(); }} />}
          {tab === 'source' && <SourceUrlTab landingPageId={landingPageId} onSuccess={() => { onAdded(); onClose(); }} />}
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`text-[10px] py-1 px-2 rounded border cursor-pointer ${
        active
          ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]'
          : 'bg-white text-ink border-[#e5e5e5] hover:border-[#6C5CE7]'
      }`}
    >{children}</button>
  )
}

// Camera / phone / OS auto-named files — these names have no
// semantic value, so we DON'T copy them into alt text on pick.
// Matches the common camera prefixes (IMG, MOV, VID, DSC, DCIM,
// PXL — Pixel phone), screenshot patterns, "Untitled", "Photo*",
// and bare numeric strings. Pattern is case-insensitive.
const GENERIC_FILENAME_RE = /^(?:img|mov|vid|dsc|dcim|pxl|photo|untitled|screen[\s_-]?shot|capture)[\s_-]?\d+|^\d{5,}$|^image[\s_-]?\d+$/i

function UploadTab({ landingPageId, onSuccess }) {
  const [file, setFile] = useState(null)
  const [altText, setAltText] = useState('')
  const [seoFilename, setSeoFilename] = useState('')
  const [role, setRole] = useState('inline')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  // Object-URL preview so the operator can confirm the right file
  // before submit. Revoked on cleanup / file swap to avoid leaks.
  const [previewUrl, setPreviewUrl] = useState(null)
  useEffect(() => {
    if (!file) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Smart-prefill: when a file is chosen, derive an SEO slug from
  // the original filename + populate alt text IF the filename looks
  // semantic (not a generic camera/screenshot auto-name). Both
  // fields stay editable; we never overwrite operator edits — only
  // fill when blank.
  useEffect(() => {
    if (!file) return
    const rawBase = file.name.replace(/\.[^.]+$/, '') // strip extension
    const cleanSlug = rawBase
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    setSeoFilename(prev => prev.trim() || cleanSlug)
    if (!GENERIC_FILENAME_RE.test(rawBase)) {
      // Treat underscores + hyphens as word separators; collapse
      // runs of whitespace; leave casing as-typed.
      const altSuggestion = rawBase
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      setAltText(prev => prev.trim() || altSuggestion)
    }
  }, [file])

  const submit = async () => {
    if (!file || busy) return
    setBusy(true); setErr(null)
    try {
      await api.uploadLandingImage(landingPageId, file, {
        alt_text: altText, filename: seoFilename, role,
      })
      onSuccess()
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      <div className="text-[10px] text-muted">Upload a JPG/PNG/WebP from your computer. Stored in Supabase, associated with the tenant. The SEO filename below is what shows in the URL + WP media library — give it a descriptive slug.</div>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        onChange={e => setFile(e.target.files?.[0] || null)}
        className="text-[10px]"
      />
      {file && (
        <>
          {previewUrl && (
            <div className="border border-[#e5e5e5] rounded p-1 bg-white">
              <img
                src={previewUrl}
                alt="Preview of selected file"
                className="block max-w-full max-h-[260px] mx-auto object-contain"
              />
            </div>
          )}
          <div className="text-[10px] text-muted">
            <span>Selected: </span>
            <code className="break-all">{file.name}</code>
            <span> ({(file.size / 1024).toFixed(0)} KB)</span>
          </div>
          <label className="block text-[10px]">
            <span className="text-muted">SEO filename (no extension) <span className="italic">— pre-filled from original filename, editable</span></span>
            <input
              type="text"
              value={seoFilename}
              onChange={e => setSeoFilename(e.target.value)}
              placeholder="e.g. perfume-bar-milwaukee-hero"
              className="block w-full text-[10px] font-mono border border-[#e5e5e5] rounded p-1.5 mt-0.5"
            />
          </label>
          <label className="block text-[10px]">
            <span className="text-muted">Alt text (accessibility + SEO)
              {altText && !GENERIC_FILENAME_RE.test(file.name.replace(/\.[^.]+$/, '')) && (
                <span className="italic"> — pre-filled from filename, edit if it doesn't describe the image</span>
              )}
            </span>
            <input
              type="text"
              value={altText}
              onChange={e => setAltText(e.target.value)}
              placeholder="What's in the image? Describe for screen readers + Google."
              className="block w-full text-[10px] border border-[#e5e5e5] rounded p-1.5 mt-0.5"
            />
          </label>
          <label className="flex items-center gap-2 text-[10px]">
            <input type="checkbox" checked={role === 'featured'} onChange={e => setRole(e.target.checked ? 'featured' : 'inline')} />
            <span>Make this the featured / hero image (replaces existing featured if one is set)</span>
          </label>
        </>
      )}
      {err && <div className="text-[10px] text-[#c0392b]">⚠ {err}</div>}
      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={busy || !file}
          className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
        >{busy ? 'Uploading…' : 'Upload'}</button>
      </div>
    </div>
  )
}

function PexelsTab({ landingPageId, onSuccess }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const search = async () => {
    if (!query.trim() || searching) return
    setSearching(true); setErr(null)
    try {
      const r = await api.searchFreePhotos({ query, perPage: 12 })
      setResults(r?.items || [])
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setSearching(false)
    }
  }
  const save = async (photo) => {
    if (saving) return
    const alt = prompt(`Alt text for this image (defaults to "${photo.alt || photo.description || 'Pexels photo'}"):`, photo.alt || photo.description || '')
    if (alt === null) return
    setSaving(true); setErr(null)
    try {
      await api.saveLandingImageFromPexels(landingPageId, {
        pexels_photo_id: photo.id,
        alt_text: alt,
        filename: '',
      })
      onSuccess()
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-muted">Search Pexels for royalty-free stock photos. Selected images are downloaded + re-stored in Supabase (tenant-scoped) — Pexels attribution is captured automatically.</div>
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="e.g. perfume bottles, candle making, hands crafting"
          className="flex-1 text-[10px] border border-[#e5e5e5] rounded p-1.5"
        />
        <button
          onClick={search}
          disabled={searching || !query.trim()}
          className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
        >{searching ? 'Searching…' : '🔍 Search'}</button>
      </div>
      {err && <div className="text-[10px] text-[#c0392b]">⚠ {err}</div>}
      {results.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {results.map(p => (
            <button
              key={p.id}
              onClick={() => save(p)}
              disabled={saving}
              className="bg-white border border-[#e5e5e5] rounded overflow-hidden cursor-pointer hover:border-[#6C5CE7] disabled:opacity-50 p-0 text-left"
              title={`By ${p.photographer || 'Pexels'} — click to save`}
            >
              <img src={p.thumb_url || p.url} alt={p.alt || ''} className="w-full h-24 object-cover" />
              <div className="p-1 text-[8px] text-muted truncate">{p.photographer || 'Pexels'}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SourceUrlTab({ landingPageId, onSuccess }) {
  const [url, setUrl] = useState('')
  const [discovered, setDiscovered] = useState(null) // { source_url, page_title, images: [...] }
  const [discovering, setDiscovering] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const discover = async () => {
    if (!url.trim() || discovering) return
    setDiscovering(true); setErr(null); setDiscovered(null)
    try {
      const r = await api.discoverImagesAtUrl(landingPageId, url.trim())
      setDiscovered(r)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setDiscovering(false)
    }
  }
  const save = async (img) => {
    if (saving) return
    const alt = prompt(`Alt text for this image (currently: "${img.alt || ''}"):`, img.alt || '')
    if (alt === null) return
    setSaving(true); setErr(null)
    try {
      await api.saveLandingImageFromSource(landingPageId, {
        source_url: discovered.source_url,
        image_src: img.src,
        alt_text: alt,
        filename: '',
      })
      onSuccess()
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-muted">
        Paste a URL from the tenant's existing site (e.g. <code className="text-[9px] bg-[#f0f0f0] px-1">https://www.poppyandthyme.com/make-and-take-perfume-and-cologne</code>). We'll scrape the page with Playwright and show you every image — click one to download + save it to Supabase, tenant-scoped.
      </div>
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && discover()}
          placeholder="https://www.poppyandthyme.com/make-and-take-perfume-and-cologne"
          className="flex-1 text-[10px] border border-[#e5e5e5] rounded p-1.5 font-mono"
        />
        <button
          onClick={discover}
          disabled={discovering || !url.trim()}
          className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
        >{discovering ? 'Scraping…' : '🌐 Scrape'}</button>
      </div>
      {err && <div className="text-[10px] text-[#c0392b]">⚠ {err}</div>}
      {discovered && (
        <>
          <div className="text-[10px] text-muted">
            Found {discovered.images.length} image{discovered.images.length === 1 ? '' : 's'} on <em>{discovered.page_title || discovered.source_url}</em>
          </div>
          {discovered.images.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {discovered.images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => save(img)}
                  disabled={saving}
                  className="bg-white border border-[#e5e5e5] rounded overflow-hidden cursor-pointer hover:border-[#6C5CE7] disabled:opacity-50 p-0 text-left"
                  title={`${img.alt || '(no alt)'} — click to download + save`}
                >
                  <img src={img.src} alt={img.alt || ''} className="w-full h-24 object-cover" loading="lazy" />
                  <div className="p-1 text-[8px] text-muted truncate">{img.alt || '(no alt)'}</div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
