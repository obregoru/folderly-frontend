// V3 Content Studio — Landing Page Manager (Phase 1).
//
// Imports a WP page, shows its parsed body + links + headings +
// images + Yoast meta + the detected site capabilities. Audit /
// propose / deploy land in later phases (this screen will gain
// tabs alongside the existing "Overview" view).
//
// Phase 1 covers: configure default post ID, list managed pages,
// import (or re-import) one, see the parsed state.

import { useEffect, useState } from 'react'
import * as api from '../api'

export default function LandingPages() {
  const [state, setState] = useState({
    loading: true,
    error: null,
    wp_configured: false,
    wp_site_url: null,
    default_post_id: null,
    pages: [],
  })
  // Active workspace state — when an operator picks a page or imports
  // one fresh, the parsed page lives here so the right pane renders.
  const [active, setActive] = useState(null)
  const [activeLoading, setActiveLoading] = useState(false)
  const [activeError, setActiveError] = useState(null)
  const [importBusy, setImportBusy] = useState(false)
  const [adhocPostId, setAdhocPostId] = useState('')
  const [defaultDraft, setDefaultDraft] = useState('')
  const [defaultSaving, setDefaultSaving] = useState(false)

  const reload = async () => {
    setState(s => ({ ...s, loading: true, error: null }))
    try {
      const r = await api.listLandingPages()
      setState({ loading: false, error: null, ...r })
      setDefaultDraft(r.default_post_id ? String(r.default_post_id) : '')
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: e?.message || String(e) }))
    }
  }
  useEffect(() => { reload() }, [])

  const handleSetDefault = async () => {
    if (defaultSaving) return
    setDefaultSaving(true)
    try {
      await api.setLandingPageDefault(defaultDraft.trim() || null)
      await reload()
    } catch (e) {
      alert('Save failed: ' + (e?.message || e))
    } finally {
      setDefaultSaving(false)
    }
  }

  const handleImport = async (postIdOrUrl) => {
    if (importBusy) return
    setImportBusy(true)
    setActiveError(null)
    try {
      const r = await api.importLandingPage(postIdOrUrl || null)
      setActive(r)
      await reload()
    } catch (e) {
      setActiveError(e?.message || String(e))
    } finally {
      setImportBusy(false)
    }
  }

  const openPage = async (page) => {
    if (activeLoading) return
    setActiveLoading(true)
    setActiveError(null)
    try {
      const r = await api.getLandingPage(page.id)
      // Reshape into the same view-model the import endpoint returns
      // so the right pane has one render path. We don't have body_html
      // here (the list endpoint trims it for size) so we lazily fetch
      // the most recent version's full body.
      const mostRecent = (r.versions || [])[0]
      let body_html = ''
      if (mostRecent) {
        try {
          const v = await api.getLandingPageVersion(page.id, mostRecent.id)
          body_html = v?.version?.body_html || ''
        } catch {}
      }
      setActive({
        landing_page_id: page.id,
        version_id: mostRecent?.id || null,
        page: {
          wp_post_id: page.wp_post_id,
          url: page.url,
          title: page.label,
          body_html,
          body_excerpt: mostRecent?.body_excerpt || '',
          links: mostRecent?.links_meta || [],
          headings: mostRecent?.headings_meta || [],
          images: mostRecent?.images_meta || [],
          yoast_meta: mostRecent?.yoast_meta || null,
        },
        capabilities: page.capabilities || {},
        history: r.versions || [],
      })
    } catch (e) {
      setActiveError(e?.message || String(e))
    } finally {
      setActiveLoading(false)
    }
  }

  if (state.loading) {
    return <div className="text-[11px] text-muted italic py-8 text-center">Loading landing pages…</div>
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-[13px] font-semibold">Landing Pages</h2>
        <div className="text-[10px] text-muted">SEO/marketing manager for your home page and other key landing pages. Imports from WordPress, audits SEO + AEO + GEO + E-E-A-T + AI-naturalness, proposes improvements with internal-link suggestions, and lets you back up + deploy approved changes. Phase 1: import + parse.</div>
      </div>

      {/* WP-not-configured banner — short-circuits everything else.
          Sends the operator to the social-media tenant settings since
          that's where wp_app_password lives today; we'll move it to a
          V3 settings panel in a later phase. */}
      {!state.wp_configured && (
        <div className="bg-[#fef9c3] border border-[#ca8a04]/30 rounded p-3 text-[11px]">
          <div className="font-medium text-[#854d0e]">WordPress isn't connected for this tenant.</div>
          <div className="text-[10px] text-muted mt-1">
            Add <code>wp_site_url</code>, <code>wp_username</code>, and <code>wp_app_password</code> in tenant settings, then come back. (The blog publishing flow uses the same credentials.)
          </div>
        </div>
      )}

      {state.wp_configured && (
        <>
          {/* Tenant default + ad-hoc import controls */}
          <div className="bg-white border border-[#e5e5e5] rounded p-3 space-y-2">
            <div className="text-[11px] font-medium">Default landing page</div>
            <div className="text-[10px] text-muted">
              The WP post ID for the page this workspace opens by default. Paste the integer (e.g. <code>144</code>) or the full <code>wp-admin/post.php?post=144</code> edit URL.
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={defaultDraft}
                onChange={e => setDefaultDraft(e.target.value)}
                placeholder="144 or https://example.com/wp-admin/post.php?post=144"
                className="flex-1 text-[11px] border border-[#e5e5e5] rounded py-1 px-2 outline-none focus:border-[#6C5CE7]"
              />
              <button
                onClick={handleSetDefault}
                disabled={defaultSaving}
                className="text-[11px] py-1 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
              >{defaultSaving ? 'Saving…' : 'Save default'}</button>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => handleImport(null)}
                disabled={importBusy || !state.default_post_id}
                className="text-[11px] py-1 px-3 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50"
                title={state.default_post_id ? `Fetch the default page (post ${state.default_post_id}) from WordPress and parse it for the workspace below.` : 'Set a default post ID first'}
              >{importBusy ? 'Importing…' : `📥 Import default${state.default_post_id ? ` (post ${state.default_post_id})` : ''}`}</button>
              <span className="text-[10px] text-muted">or</span>
              <input
                type="text"
                value={adhocPostId}
                onChange={e => setAdhocPostId(e.target.value)}
                placeholder="Import a different post ID / URL"
                className="flex-1 text-[11px] border border-[#e5e5e5] rounded py-1 px-2 outline-none focus:border-[#6C5CE7]"
              />
              <button
                onClick={() => { if (adhocPostId.trim()) handleImport(adhocPostId.trim()) }}
                disabled={importBusy || !adhocPostId.trim()}
                className="text-[11px] py-1 px-3 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer disabled:opacity-50"
              >Import this one</button>
            </div>
            {activeError && (
              <div className="text-[10px] text-[#c0392b] mt-1">⚠ {activeError}</div>
            )}
          </div>

          {/* Managed pages list */}
          {state.pages.length > 0 && (
            <div className="bg-white border border-[#e5e5e5] rounded p-3">
              <div className="text-[11px] font-medium mb-2">Managed pages ({state.pages.length})</div>
              <div className="space-y-1">
                {state.pages.map(p => (
                  <button
                    key={p.id}
                    onClick={() => openPage(p)}
                    className="w-full flex items-center gap-2 text-[11px] py-1.5 px-2 bg-[#fafafa] hover:bg-[#f0eff5] border border-[#e5e5e5] rounded cursor-pointer text-left"
                  >
                    <span className="font-medium truncate flex-1">{p.label || `Post ${p.wp_post_id}`}</span>
                    {p.cornerstone && <span className="text-[8px] bg-[#6C5CE7] text-white py-0.5 px-1 rounded uppercase">Cornerstone</span>}
                    <span className="font-mono text-[9px] text-muted">#{p.wp_post_id}</span>
                    <span className="text-[9px] text-muted">{p.last_imported_at ? new Date(p.last_imported_at).toLocaleDateString() : '—'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Workspace — the parsed page from the most recent import */}
          {activeLoading && (
            <div className="text-[11px] text-muted italic py-4 text-center">Loading page…</div>
          )}
          {active && <PageWorkspace data={active} />}
        </>
      )}

      {state.error && (
        <div className="bg-[#fef2f2] border border-[#c0392b]/30 rounded p-3 text-[11px] text-[#c0392b]">{state.error}</div>
      )}
    </div>
  )
}

function PageWorkspace({ data }) {
  const { page, capabilities = {}, history = [] } = data
  const links = page.links || []
  const internalLinks = links.filter(l => l.type === 'internal')
  const externalLinks = links.filter(l => l.type === 'external')
  const headings = page.headings || []
  const images = page.images || []
  const missingAlt = images.filter(i => !i.alt || !i.alt.trim()).length

  return (
    <div className="bg-white border border-[#6C5CE7]/30 rounded p-3 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold truncate">{page.title || `Post ${page.wp_post_id}`}</div>
          {page.url && (
            <a
              href={page.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-[#6C5CE7] underline break-all"
            >{page.url}</a>
          )}
        </div>
        <div className="text-[9px] font-mono text-muted whitespace-nowrap">WP #{page.wp_post_id}</div>
      </div>

      {/* Site capabilities pill row — shows the operator what we
          detected so they can sanity-check before trusting downstream
          audit/proposal recommendations. */}
      <div className="flex items-center gap-1 flex-wrap text-[9px]">
        <span className="text-[#6C5CE7] font-medium">Site capabilities:</span>
        {capabilities.seoPlugin && <Pill tone="purple" label={`SEO: ${capabilities.seoPlugin}`} />}
        {capabilities.pageBuilder && <Pill tone="orange" label={`Builder: ${capabilities.pageBuilder}`} />}
        {capabilities.schemaPlugin && <Pill tone="green" label={`Schema: ${capabilities.schemaPlugin}`} />}
        {capabilities.breadcrumbSource && <Pill tone="purple" label={`Breadcrumbs: ${capabilities.breadcrumbSource}`} />}
        {capabilities.cachePlugin && <Pill tone="grey" label={`Cache: ${capabilities.cachePlugin}`} />}
        {capabilities.imageOptim && <Pill tone="grey" label={`Img: ${capabilities.imageOptim}`} />}
        {!capabilities.seoPlugin && !capabilities.pageBuilder && (
          <span className="text-[9px] text-muted italic">No plugins detected — admin REST may be locked. Audits will fall back to generic recommendations.</span>
        )}
      </div>

      {/* Yoast meta surface — only when present */}
      {page.yoast_meta && (
        <details className="text-[10px] border border-[#e5e5e5] rounded">
          <summary className="cursor-pointer py-1.5 px-2 bg-[#fafafa] text-[10px] font-medium">Yoast meta</summary>
          <div className="p-2 space-y-1">
            {page.yoast_meta.title && <div><b>Title:</b> {page.yoast_meta.title}</div>}
            {page.yoast_meta.description && <div><b>Meta description:</b> {page.yoast_meta.description}</div>}
            {page.yoast_meta.canonical && <div><b>Canonical:</b> {page.yoast_meta.canonical}</div>}
          </div>
        </details>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
        <Stat label="Headings" value={headings.length} />
        <Stat label="Internal links" value={internalLinks.length} />
        <Stat label="External links" value={externalLinks.length} />
        <Stat label="Images (missing alt)" value={`${images.length}${missingAlt > 0 ? ` (${missingAlt})` : ''}`} tone={missingAlt > 0 ? 'warn' : 'ok'} />
      </div>

      {/* Headings tree */}
      <details className="text-[10px] border border-[#e5e5e5] rounded">
        <summary className="cursor-pointer py-1.5 px-2 bg-[#fafafa] font-medium">Heading structure ({headings.length})</summary>
        <div className="p-2 space-y-0.5">
          {headings.length === 0 && <div className="text-muted italic">No headings.</div>}
          {headings.map((h, i) => (
            <div key={i} style={{ paddingLeft: `${(h.level - 1) * 12}px` }}>
              <span className="text-[#6C5CE7] font-mono">H{h.level}</span> <span>{h.text}</span>
            </div>
          ))}
        </div>
      </details>

      {/* Links — visible by default since Phase 2 builds on these */}
      <details open className="text-[10px] border border-[#e5e5e5] rounded">
        <summary className="cursor-pointer py-1.5 px-2 bg-[#fafafa] font-medium">Links ({links.length}) — preserved on rewrite</summary>
        <div className="p-2 space-y-0.5 max-h-[200px] overflow-y-auto">
          {links.length === 0 && <div className="text-muted italic">No links in body.</div>}
          {links.map((l, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5 border-b border-[#f0f0f0] last:border-0">
              <span className={`text-[9px] py-0.5 px-1 rounded font-mono ${
                l.type === 'internal' ? 'bg-[#6C5CE7]/10 text-[#6C5CE7]'
                  : l.type === 'anchor' ? 'bg-[#fef9c3] text-[#854d0e]'
                  : 'bg-[#e5e5e5] text-muted'
              }`}>{l.type}</span>
              <span className="flex-1 truncate" title={l.anchor || '(no anchor text)'}>{l.anchor || <i className="text-muted">(no anchor text)</i>}</span>
              <a href={l.href} target="_blank" rel="noopener noreferrer" className="text-[9px] text-[#6C5CE7] underline truncate max-w-[200px]" title={l.href}>{l.href}</a>
            </div>
          ))}
        </div>
      </details>

      {/* Body HTML preview */}
      <details className="text-[10px] border border-[#e5e5e5] rounded">
        <summary className="cursor-pointer py-1.5 px-2 bg-[#fafafa] font-medium">Body HTML preview</summary>
        <pre className="p-2 bg-[#fafafa] overflow-auto max-h-[300px] whitespace-pre-wrap break-all text-[9px] font-mono">{page.body_html || '(empty)'}</pre>
      </details>

      {/* History — only when there are >1 versions worth showing */}
      {history.length > 1 && (
        <details className="text-[10px] border border-[#e5e5e5] rounded">
          <summary className="cursor-pointer py-1.5 px-2 bg-[#fafafa] font-medium">Version history ({history.length})</summary>
          <div className="p-2 space-y-0.5">
            {history.map(v => (
              <div key={v.id} className="flex items-center gap-2 py-0.5">
                <span className="text-[#6C5CE7] font-mono">#{v.id}</span>
                <span className="font-medium uppercase text-[9px]">{v.kind}</span>
                <span className="flex-1 truncate">{v.source_note}</span>
                <span className="text-[9px] text-muted">{new Date(v.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="text-[9px] text-muted italic">
        Phase 1: import + parse. Audit / proposal / deploy land in the next phases (the buttons will appear here).
      </div>
    </div>
  )
}

function Pill({ tone, label }) {
  const cls = tone === 'purple' ? 'bg-[#6C5CE7]/10 text-[#6C5CE7] border-[#6C5CE7]/30'
    : tone === 'orange' ? 'bg-[#fff7ed] text-[#d97706] border-[#d97706]/30'
    : tone === 'green' ? 'bg-[#dcfce7] text-[#16a34a] border-[#16a34a]/30'
    : 'bg-[#f0f0f0] text-muted border-[#e5e5e5]'
  return <span className={`text-[8px] py-0.5 px-1.5 rounded border ${cls}`}>{label}</span>
}

function Stat({ label, value, tone }) {
  const numCls = tone === 'warn' ? 'text-[#d97706]' : tone === 'ok' ? 'text-[#16a34a]' : 'text-ink'
  return (
    <div className="bg-[#fafafa] border border-[#e5e5e5] rounded p-2">
      <div className="text-muted">{label}</div>
      <div className={`text-[14px] font-semibold ${numCls}`}>{value}</div>
    </div>
  )
}
