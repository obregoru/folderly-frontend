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
  const { page, capabilities = {}, history = [], landing_page_id } = data
  const links = page.links || []
  const internalLinks = links.filter(l => l.type === 'internal')
  const externalLinks = links.filter(l => l.type === 'external')
  const headings = page.headings || []
  const images = page.images || []
  const missingAlt = images.filter(i => !i.alt || !i.alt.trim()).length

  // Audit state — null until the operator clicks Run audit. Caches
  // findings keyed by audit row id so switching dimensions doesn't
  // re-fetch. Selected suggestions feed Phase 3's proposal
  // generator (not wired here — just stored locally for now so the
  // operator can shape their shortlist while reviewing).
  const [audit, setAudit] = useState(null)
  const [auditBusy, setAuditBusy] = useState(false)
  const [auditError, setAuditError] = useState(null)
  const [activeDim, setActiveDim] = useState('seo')
  const [selectedSuggestions, setSelectedSuggestions] = useState(new Set())
  // Elapsed-seconds counter while audit is in flight — Claude can
  // take 30-90s on a 30k-char body, no progress feedback at all
  // makes operators think the button is broken.
  const [auditElapsed, setAuditElapsed] = useState(0)
  useEffect(() => {
    if (!auditBusy) { setAuditElapsed(0); return }
    const start = Date.now()
    setAuditElapsed(0)
    const tick = setInterval(() => setAuditElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    return () => clearInterval(tick)
  }, [auditBusy])

  const runAudit = async () => {
    if (auditBusy || !landing_page_id) return
    setAuditBusy(true); setAuditError(null)
    setProposal(null)
    setProposalError(null)
    try {
      const r = await api.runLandingPageAudit(landing_page_id)
      setAudit(r)
      setSelectedSuggestions(new Set())
    } catch (e) {
      setAuditError(e?.message || String(e))
    } finally {
      setAuditBusy(false)
    }
  }

  // Proposal state — Phase 3. Lives alongside audit so the diff
  // view can render the current vs proposed bodies + the
  // link-change ledger Claude emits.
  const [proposal, setProposal] = useState(null)
  const [proposalBusy, setProposalBusy] = useState(false)
  const [proposalError, setProposalError] = useState(null)
  const [proposalElapsed, setProposalElapsed] = useState(0)
  useEffect(() => {
    if (!proposalBusy) { setProposalElapsed(0); return }
    const start = Date.now()
    setProposalElapsed(0)
    const tick = setInterval(() => setProposalElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    return () => clearInterval(tick)
  }, [proposalBusy])

  const runProposal = async () => {
    if (proposalBusy || !landing_page_id || !audit?.audit_id || selectedSuggestions.size === 0) return
    setProposalBusy(true); setProposalError(null)
    try {
      const r = await api.proposeLandingPageRewrite(landing_page_id, {
        auditId: audit.audit_id,
        acceptedSuggestionIds: Array.from(selectedSuggestions),
      })
      setProposal(r)
    } catch (e) {
      setProposalError(e?.message || String(e))
    } finally {
      setProposalBusy(false)
    }
  }
  const toggleSuggestion = (sid) => {
    setSelectedSuggestions(prev => {
      const next = new Set(prev)
      if (next.has(sid)) next.delete(sid); else next.add(sid)
      return next
    })
  }

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

      {/* History — version rows + rollback button on backup rows.
          Always shown (even with 1 version) so the operator knows
          backups are tracked here. */}
      {history.length > 0 && (
        <VersionHistory
          history={history}
          landingPageId={landing_page_id}
          onRolledBack={(r) => {
            // Force a workspace reload of the page state so the
            // "Live" tag follows the rollback. Parent's openPage
            // re-pulls from BE which now has fresh deployed_at.
            try { window.dispatchEvent(new CustomEvent('posty-landing-changed', { detail: { id: landing_page_id } })) } catch {}
          }}
        />
      )}

      {/* Audit panel — Phase 2 */}
      <div className="border border-[#6C5CE7]/30 rounded p-3 space-y-2 bg-[#fafbff]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-[#6C5CE7]">🔍 5-dimension audit</span>
          <span className="text-[9px] text-muted">SEO · AEO · GEO · E-E-A-T · AI-naturalness · breadcrumbs</span>
          <div className="flex-1" />
          {audit?.created_at && (
            <span className="text-[9px] text-muted">Last run {new Date(audit.created_at).toLocaleString()}</span>
          )}
          <button
            onClick={runAudit}
            disabled={auditBusy}
            className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
            title="Send the parsed page to Claude with the brand context + site capabilities. Returns 5 dimensions of structured findings, each with severity + suggestion."
          >{auditBusy
              ? `Auditing… ${auditElapsed}s`
              : audit ? '🔄 Re-run audit' : '🔍 Run audit'}</button>
        </div>
        {auditBusy && (
          <div className="text-[10px] text-muted italic">
            Claude is reading the page (~30-90s on a typical landing page — the model has to scan the whole body, headings, and links to score 5 dimensions). Don't refresh the tab.
          </div>
        )}
        {auditError && <div className="text-[10px] text-[#c0392b]">⚠ {auditError}</div>}
        {audit?.findings && (
          <AuditFindings
            findings={audit.findings}
            activeDim={activeDim}
            setActiveDim={setActiveDim}
            selected={selectedSuggestions}
            toggleSuggestion={toggleSuggestion}
          />
        )}
        {!audit && !auditBusy && !auditError && (
          <div className="text-[10px] text-muted italic">Run an audit to see structured SEO / AEO / GEO / E-E-A-T / AI-naturalness findings for this page.</div>
        )}
      </div>

      {/* Proposal panel — Phase 3 */}
      <div className="border border-[#2D9A5E]/30 rounded p-3 space-y-2 bg-[#f0fdf4]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-[#2D9A5E]">💡 Rewrite proposal</span>
          <span className="text-[9px] text-muted">Generates a full body rewrite that addresses selected audit suggestions. Existing links preserved by design.</span>
          <div className="flex-1" />
          {proposal?.created_at && (
            <span className="text-[9px] text-muted">Generated {new Date(proposal.created_at).toLocaleString()}</span>
          )}
          <button
            onClick={runProposal}
            disabled={proposalBusy || !audit?.audit_id || selectedSuggestions.size === 0}
            className="text-[10px] py-1 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50"
            title={
              !audit?.audit_id ? 'Run an audit first.'
              : selectedSuggestions.size === 0 ? 'Tick the audit findings you want addressed.'
              : `Send ${selectedSuggestions.size} suggestion(s) to Claude and get a rewrite proposal. Takes 30-90s.`
            }
          >{proposalBusy
              ? `Generating… ${proposalElapsed}s`
              : proposal ? '🔄 Re-generate proposal' : '💡 Generate proposal'}</button>
        </div>
        {proposalBusy && (
          <div className="text-[10px] text-muted italic">
            Claude is writing the full body rewrite (longer than the audit because it has to produce 800-1500 words of polished copy). Don't refresh.
          </div>
        )}
        {proposalError && <div className="text-[10px] text-[#c0392b]">⚠ {proposalError}</div>}
        {!proposal && !proposalBusy && !proposalError && (
          <div className="text-[10px] text-muted italic">
            {!audit?.audit_id
              ? 'Run an audit first, then tick suggestions to include.'
              : selectedSuggestions.size === 0
                ? 'Tick the audit findings you want addressed (each card has a checkbox), then click Generate proposal.'
                : `${selectedSuggestions.size} suggestion(s) flagged — ready to generate.`}
          </div>
        )}
        {proposal && (
          <ProposalDiff
            proposal={proposal}
            sourcePage={page}
            landingPageId={landing_page_id}
          />
        )}
      </div>

      <div className="text-[9px] text-muted italic">
        Phase 3 landed: proposal + diff view. AI detection (ZeroGPT) → Phase 4. Backup + deploy + rollback → Phase 5.
      </div>
    </div>
  )
}

const DIMENSIONS = [
  { key: 'seo',            label: 'SEO',        hint: 'Title, meta, H1/H2/H3, alt text, link mix, URL, canonical, breadcrumbs' },
  { key: 'aeo',            label: 'AEO',        hint: 'Answer-engine optimization — direct answers, FAQ schema, question-as-H2' },
  { key: 'geo',            label: 'GEO',        hint: 'Generative engine optimization — brand entity, schema, topical completeness' },
  { key: 'eeat',           label: 'E-E-A-T',    hint: 'Experience · Expertise · Authority · Trust' },
  { key: 'ai_naturalness', label: 'AI vs human', hint: 'Sentence variance, AI-tells, specifics, anecdotes' },
]

function AuditFindings({ findings, activeDim, setActiveDim, selected, toggleSuggestion }) {
  // Score color for each dimension tab — green at 85+, amber 60-84,
  // red below 60. Lets the operator pick which dimension to attack
  // first at a glance.
  const scoreColor = (s) => {
    if (typeof s !== 'number') return 'text-muted'
    if (s >= 85) return 'text-[#16a34a]'
    if (s >= 60) return 'text-[#d97706]'
    return 'text-[#c0392b]'
  }
  const active = findings?.[activeDim] || { score: null, findings: [] }
  const activeFindings = Array.isArray(active.findings) ? active.findings : []
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 flex-wrap text-[10px] border-b border-[#e5e5e5]">
        {DIMENSIONS.map(d => {
          const dim = findings?.[d.key]
          const score = typeof dim?.score === 'number' ? dim.score : null
          const isActive = activeDim === d.key
          return (
            <button
              key={d.key}
              onClick={() => setActiveDim(d.key)}
              className={`py-1.5 px-2 border-b-2 cursor-pointer bg-transparent ${isActive ? 'border-[#6C5CE7]' : 'border-transparent'}`}
              title={d.hint}
            >
              <span className={isActive ? 'font-medium text-ink' : 'text-muted'}>{d.label}</span>
              {score !== null && <span className={`ml-1.5 font-mono ${scoreColor(score)}`}>{score}</span>}
              {Array.isArray(dim?.findings) && dim.findings.length > 0 && (
                <span className="ml-1 text-[8px] text-muted">({dim.findings.length})</span>
              )}
            </button>
          )
        })}
      </div>
      {activeFindings.length === 0 ? (
        <div className="text-[10px] text-muted italic py-2">No findings for this dimension. Either the page is in good shape here or the audit hit token limits.</div>
      ) : (
        <div className="space-y-1.5">
          {activeFindings.map((f, i) => {
            const isSelected = selected.has(f.suggestion_id)
            const sev = f.severity || 'nice'
            const sevColors = sev === 'critical' ? 'border-[#c0392b] bg-[#fef2f2] text-[#c0392b]'
              : sev === 'important' ? 'border-[#d97706] bg-[#fff7ed] text-[#d97706]'
              : 'border-[#94a3b8] bg-[#f0f0f0] text-muted'
            return (
              <div key={f.suggestion_id || i} className="bg-white border border-[#e5e5e5] rounded p-2 text-[10px] space-y-1">
                <div className="flex items-start gap-2">
                  <label className="flex items-center gap-1 cursor-pointer pt-0.5" title="Include in Phase 3 proposal (FE only for now — sent to producer in Phase 3)">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSuggestion(f.suggestion_id)}
                    />
                  </label>
                  <span className={`text-[8px] py-0.5 px-1 rounded border uppercase font-bold ${sevColors}`}>{sev}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-ink">{f.title}</div>
                    {f.target && <div className="text-[9px] text-muted font-mono truncate">→ {f.target}</div>}
                  </div>
                </div>
                {f.detail && <div className="pl-5 text-muted">{f.detail}</div>}
                {f.suggestion && <div className="pl-5 text-ink"><b>Suggestion:</b> {f.suggestion}</div>}
              </div>
            )
          })}
        </div>
      )}
      {selected.size > 0 && (
        <div className="text-[10px] text-[#6C5CE7] italic">
          {selected.size} suggestion{selected.size === 1 ? '' : 's'} flagged for inclusion. (Will feed Phase 3's proposal generator once it ships.)
        </div>
      )}
    </div>
  )
}

function ProposalDiff({ proposal, sourcePage, landingPageId, onReplace }) {
  // ZeroGPT + humanize state — lives here so re-generating the
  // proposal naturally resets both. `aiResult` tracks the latest
  // detect-ai call: { score, flagged_sentences, detected_at }.
  // `currentVersionId` swaps to the humanized version once the
  // operator runs Humanize, so subsequent detect-ai calls run on
  // the new version (not the original proposal).
  const [aiResult, setAiResult] = useState(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState(null)
  const [humanBusy, setHumanBusy] = useState(false)
  const [humanError, setHumanError] = useState(null)
  const [humanElapsed, setHumanElapsed] = useState(0)
  const [currentVersionId, setCurrentVersionId] = useState(proposal?.version_id || null)
  const [currentBodyHtml, setCurrentBodyHtml] = useState(proposal?.proposal?.body_html || '')
  const [humanNotes, setHumanNotes] = useState(null)
  // Reset transient state whenever the parent passes a NEW proposal
  // (e.g. operator clicked Re-generate). React identity check on
  // proposal.version_id keeps the state fresh without manual clears.
  useEffect(() => {
    setAiResult(null); setAiError(null); setHumanError(null); setHumanNotes(null)
    setCurrentVersionId(proposal?.version_id || null)
    setCurrentBodyHtml(proposal?.proposal?.body_html || '')
  }, [proposal?.version_id])
  useEffect(() => {
    if (!humanBusy) { setHumanElapsed(0); return }
    const start = Date.now()
    const tick = setInterval(() => setHumanElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    return () => clearInterval(tick)
  }, [humanBusy])

  const detectAi = async () => {
    if (aiBusy || !landingPageId || !currentVersionId) return
    setAiBusy(true); setAiError(null)
    try {
      const r = await api.detectLandingPageAi(landingPageId, currentVersionId)
      setAiResult(r.ai_detection)
    } catch (e) {
      setAiError(e?.message || String(e))
    } finally {
      setAiBusy(false)
    }
  }
  const humanize = async () => {
    if (humanBusy || !landingPageId || !currentVersionId) return
    setHumanBusy(true); setHumanError(null)
    try {
      const r = await api.humanizeLandingPageVersion(landingPageId, currentVersionId)
      // Swap the diff target to the humanized version. The AI score
      // resets — operator should re-run detect-ai to confirm it
      // dropped.
      setCurrentVersionId(r.version_id)
      setCurrentBodyHtml(r.body_html)
      setAiResult(null)
      setHumanNotes(r.notes || null)
      // Bubble up to parent so the proposal panel knows the deploy
      // target should be the humanized version (Phase 5 will read
      // currentVersionId off the proposal panel).
      if (typeof onReplace === 'function') onReplace({ version_id: r.version_id, body_html: r.body_html })
    } catch (e) {
      setHumanError(e?.message || String(e))
    } finally {
      setHumanBusy(false)
    }
  }

  const p = proposal?.proposal || {}
  const linksKept = Array.isArray(p.links_kept) ? p.links_kept : []
  const linksRefined = Array.isArray(p.links_refined) ? p.links_refined : []
  const linksAdded = Array.isArray(p.links_added) ? p.links_added : []
  const linksRemoved = Array.isArray(p.links_removed) ? p.links_removed : []
  const summary = Array.isArray(p.summary_of_changes) ? p.summary_of_changes : []
  const sourceTitle = sourcePage?.title || ''
  const sourceMeta = sourcePage?.yoast_meta?.description || ''
  const titleChanged = (p.title || '').trim() && (p.title || '').trim() !== sourceTitle.trim()
  const metaChanged = (p.meta_description || '').trim() && (p.meta_description || '').trim() !== sourceMeta.trim()

  // Detect any existing href that doesn't appear in kept/refined/
  // removed — that's an unexpected disappearance the operator
  // should know about. Defensive — the prompt should prevent this
  // but trust-but-verify on a model output.
  const sourceLinks = Array.isArray(proposal?.source_links) ? proposal.source_links : []
  const accountedHrefs = new Set([
    ...linksKept.map(l => l.href),
    ...linksRefined.map(l => l.href),
    ...linksRemoved.map(l => l.href),
  ])
  const unaccountedSource = sourceLinks.filter(l => l.href && !accountedHrefs.has(l.href))

  return (
    <div className="space-y-2 text-[10px]">
      {/* Rationale + summary of changes */}
      {p.rationale && (
        <div className="bg-white border border-[#e5e5e5] rounded p-2">
          <div className="font-medium text-ink mb-1">Rationale</div>
          <div className="text-muted">{p.rationale}</div>
        </div>
      )}
      {summary.length > 0 && (
        <div className="bg-white border border-[#e5e5e5] rounded p-2">
          <div className="font-medium text-ink mb-1">Summary of changes ({summary.length})</div>
          <ul className="list-disc pl-4 space-y-0.5 text-muted">
            {summary.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}

      {/* Title / meta / focus keyword diff */}
      {(titleChanged || metaChanged || p.focus_keyword) && (
        <div className="bg-white border border-[#e5e5e5] rounded p-2 space-y-1">
          <div className="font-medium text-ink">Meta changes</div>
          {titleChanged && (
            <div>
              <div className="text-muted">Title (before):</div>
              <div className="bg-[#fef2f2] border-l-2 border-[#c0392b] pl-2 py-0.5">{sourceTitle || <i>(none)</i>}</div>
              <div className="text-muted mt-1">Title (proposed):</div>
              <div className="bg-[#f0fdf4] border-l-2 border-[#2D9A5E] pl-2 py-0.5">{p.title}</div>
            </div>
          )}
          {metaChanged && (
            <div className="pt-1">
              <div className="text-muted">Meta description (before):</div>
              <div className="bg-[#fef2f2] border-l-2 border-[#c0392b] pl-2 py-0.5">{sourceMeta || <i>(none)</i>}</div>
              <div className="text-muted mt-1">Meta description (proposed):</div>
              <div className="bg-[#f0fdf4] border-l-2 border-[#2D9A5E] pl-2 py-0.5">{p.meta_description}</div>
            </div>
          )}
          {p.focus_keyword && (
            <div className="pt-1"><b>Focus keyword:</b> {p.focus_keyword}</div>
          )}
        </div>
      )}

      {/* Link ledger — kept / refined / added / removed / unaccounted */}
      <div className="bg-white border border-[#e5e5e5] rounded p-2">
        <div className="font-medium text-ink mb-1">Link changes</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1 mb-2">
          <Stat label="Kept" value={linksKept.length} tone="ok" />
          <Stat label="Refined" value={linksRefined.length} />
          <Stat label="Added (internal)" value={linksAdded.length} />
          <Stat label="Removed" value={linksRemoved.length} tone={linksRemoved.length > 0 ? 'warn' : 'ok'} />
        </div>
        {unaccountedSource.length > 0 && (
          <div className="bg-[#fef2f2] border border-[#c0392b]/40 rounded p-1.5 mb-1">
            <div className="font-medium text-[#c0392b]">⚠ {unaccountedSource.length} source link(s) NOT explicitly kept / refined / removed:</div>
            <ul className="list-disc pl-4 text-[#c0392b]/90 mt-1">
              {unaccountedSource.map((l, i) => <li key={i}><span className="font-mono">{l.href}</span> — verify manually before deploy.</li>)}
            </ul>
          </div>
        )}
        {linksRefined.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-muted">Anchor refinements ({linksRefined.length})</summary>
            <div className="pl-3 space-y-0.5 mt-1">
              {linksRefined.map((l, i) => (
                <div key={i}>
                  <div className="font-mono text-[9px] text-muted truncate">{l.href}</div>
                  <div className="line-through text-[#c0392b]">"{l.anchor_before}"</div>
                  <div className="text-[#2D9A5E]">→ "{l.anchor_after}"</div>
                  {l.why && <div className="text-muted text-[9px] italic">{l.why}</div>}
                </div>
              ))}
            </div>
          </details>
        )}
        {linksAdded.length > 0 && (
          <details className="mt-1" open>
            <summary className="cursor-pointer text-muted">New internal links ({linksAdded.length})</summary>
            <div className="pl-3 space-y-0.5 mt-1">
              {linksAdded.map((l, i) => (
                <div key={i} className="border-l-2 border-[#2D9A5E] pl-2 py-0.5">
                  <div><b>"{l.anchor}"</b> → <span className="font-mono text-[9px]">{l.href}</span></div>
                  {l.paragraph_hint && <div className="text-muted italic">in: …{l.paragraph_hint}…</div>}
                </div>
              ))}
            </div>
          </details>
        )}
        {linksRemoved.length > 0 && (
          <details className="mt-1" open>
            <summary className="cursor-pointer text-[#c0392b] font-medium">⚠ Links removed — review before deploy ({linksRemoved.length})</summary>
            <div className="pl-3 space-y-0.5 mt-1">
              {linksRemoved.map((l, i) => (
                <div key={i} className="border-l-2 border-[#c0392b] pl-2 py-0.5">
                  <div className="font-mono text-[9px]">{l.href}</div>
                  {l.anchor && <div className="line-through text-[#c0392b]">"{l.anchor}"</div>}
                  <div className="text-muted italic">{l.reason || '(no reason given)'}</div>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* AI-detection (ZeroGPT) + humanize loop — Phase 4 */}
      <div className="bg-white border border-[#e5e5e5] rounded p-2 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-ink">🤖 AI-detection</span>
          <span className="text-muted">ZeroGPT scans the proposed body and flags sentences that read as machine-written.</span>
          <div className="flex-1" />
          <button
            onClick={detectAi}
            disabled={aiBusy || !currentVersionId}
            className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer disabled:opacity-50"
            title="Run ZeroGPT on the current proposed body."
          >{aiBusy ? 'Scoring…' : aiResult ? '🔄 Re-check' : '🔍 Check AI score'}</button>
          {aiResult && (aiResult.flagged_sentences?.length > 0 || (aiResult.score || 0) > 20) && (
            <button
              onClick={humanize}
              disabled={humanBusy}
              className="text-[10px] py-1 px-2 bg-[#d97706] text-white border-none rounded cursor-pointer disabled:opacity-50"
              title="Ask Claude to rewrite the body more naturally, targeting any flagged sentences. Links and structure preserved. Creates a new version."
            >{humanBusy ? `Humanizing… ${humanElapsed}s` : '✍️ Humanize'}</button>
          )}
        </div>
        {aiError && <div className="text-[10px] text-[#c0392b]">⚠ {aiError}</div>}
        {humanError && <div className="text-[10px] text-[#c0392b]">⚠ {humanError}</div>}
        {aiResult && (
          <div className="space-y-1">
            <AiScoreBar score={aiResult.score} />
            {aiResult.flagged_sentences?.length > 0 ? (
              <details className="text-[10px]">
                <summary className="cursor-pointer text-muted">{aiResult.flagged_sentences.length} sentence{aiResult.flagged_sentences.length === 1 ? '' : 's'} flagged — expand to view</summary>
                <ul className="list-disc pl-4 space-y-0.5 mt-1">
                  {aiResult.flagged_sentences.map((s, i) => (
                    <li key={i} className="text-[#d97706]"><i>"{s}"</i></li>
                  ))}
                </ul>
              </details>
            ) : (
              <div className="text-[10px] text-muted italic">No per-sentence flags returned.</div>
            )}
          </div>
        )}
        {humanNotes && (
          <div className="text-[10px] bg-[#fff7ed] border border-[#d97706]/30 rounded p-1.5 mt-1">
            <b>Humanize notes:</b> {humanNotes}
          </div>
        )}
        {!aiResult && !aiBusy && !aiError && (
          <div className="text-[10px] text-muted italic">Click "Check AI score" to scan the proposed body via ZeroGPT.</div>
        )}
      </div>

      {/* Rendered preview — side-by-side current vs proposed in
          sandboxed iframes. Sandbox="" blocks scripts, popups,
          forms, top-navigation, etc. so any HTML Claude produces
          can't break out. Inline stylesheet approximates a
          generic WordPress prose theme so the preview looks like
          a real page, not naked HTML on a white background.
          (Doesn't perfectly match makeandtake.com's theme — the
          live deploy in Phase 5 will look slightly different —
          but it's much closer to "how it'll read" than the raw
          HTML view below.) */}
      <details className="border border-[#e5e5e5] rounded" open>
        <summary className="cursor-pointer py-1.5 px-2 bg-[#fafafa] text-[10px] font-medium">Rendered preview (current vs proposed)</summary>
        <div className="grid grid-cols-2 gap-2 p-2">
          <div>
            <div className="text-[9px] text-muted mb-1">Current</div>
            <RenderedPreview html={sourcePage?.body_html || ''} tone="red" />
          </div>
          <div>
            <div className="text-[9px] text-muted mb-1">Proposed{currentVersionId !== proposal?.version_id ? ' (humanized)' : ''}</div>
            <RenderedPreview html={currentBodyHtml || ''} tone="green" />
          </div>
        </div>
        <div className="text-[8px] text-muted italic px-2 pb-2">
          Approximate styling — actual rendering will use the live theme on deploy. Scripts and forms are disabled in this preview.
        </div>
      </details>

      {/* Body diff — full HTML side-by-side. Paragraph-level
          highlight is Phase 4/5 territory; v1 = full bodies. */}
      <details className="border border-[#e5e5e5] rounded">
        <summary className="cursor-pointer py-1.5 px-2 bg-[#fafafa] text-[10px] font-medium">Body HTML source (current vs proposed)</summary>
        <div className="grid grid-cols-2 gap-2 p-2">
          <div>
            <div className="text-[9px] text-muted mb-1">Current</div>
            <pre className="text-[9px] font-mono whitespace-pre-wrap break-all bg-[#fef2f2] border border-[#c0392b]/30 rounded p-2 max-h-[400px] overflow-auto">{sourcePage?.body_html || '(empty)'}</pre>
          </div>
          <div>
            <div className="text-[9px] text-muted mb-1">Proposed{currentVersionId !== proposal?.version_id ? ' (humanized)' : ''}</div>
            <pre className="text-[9px] font-mono whitespace-pre-wrap break-all bg-[#f0fdf4] border border-[#2D9A5E]/30 rounded p-2 max-h-[400px] overflow-auto">{currentBodyHtml || '(empty)'}</pre>
          </div>
        </div>
      </details>

      {/* Deploy — Phase 5. Big red CTA so the operator can't miss
          that this is the irreversible-without-rollback step. */}
      <DeployBlock
        landingPageId={landingPageId}
        versionId={currentVersionId}
        onDeployed={(r) => {
          if (typeof onReplace === 'function') onReplace({ deployed: r })
        }}
      />

      <div className="text-[9px] text-muted italic">
        Deploy publishes the proposed version to WordPress. The live page is snapshotted as a backup FIRST so rollback is always available.
      </div>
    </div>
  )
}

function DeployBlock({ landingPageId, versionId, onDeployed }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!busy) { setElapsed(0); return }
    const start = Date.now()
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    return () => clearInterval(tick)
  }, [busy])
  const handleDeploy = async () => {
    if (busy || !landingPageId || !versionId) return
    if (!confirm('Deploy this version to the live WordPress page? The current live page will be snapshotted as a backup FIRST — rollback stays available.')) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      const r = await api.deployLandingPageVersion(landingPageId, versionId)
      setSuccess(r)
      if (typeof onDeployed === 'function') onDeployed(r)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="border border-[#c0392b]/40 rounded p-3 bg-[#fef2f2] space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium text-[#c0392b]">🚀 Deploy to WordPress</span>
        <span className="text-[9px] text-muted">Replaces the live page's body + title + (when Yoast Premium) meta description + focus keyword. Live page snapshotted as a backup first.</span>
        <div className="flex-1" />
        <button
          onClick={handleDeploy}
          disabled={busy || !versionId}
          className="text-[11px] py-1 px-3 bg-[#c0392b] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
          title="Snapshots live page as backup, then PUTs the current version's content to WP REST API."
        >{busy ? `Deploying… ${elapsed}s` : '🚀 Deploy'}</button>
      </div>
      {error && <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>}
      {success && (
        <div className="text-[10px] bg-[#f0fdf4] border border-[#2D9A5E]/40 rounded p-2 space-y-1">
          <div className="font-medium text-[#16a34a]">✓ Deployed</div>
          <div className="text-muted">
            Backup taken as version <b>#{success.backup_version_id}</b> — use it on the History panel below to roll back.
          </div>
          {success.wp_link && (
            <div>
              <a href={success.wp_link} target="_blank" rel="noopener noreferrer" className="text-[#6C5CE7] underline">
                View live page →
              </a>
            </div>
          )}
          {Array.isArray(success.warnings) && success.warnings.length > 0 && (
            <div className="bg-[#fff7ed] border border-[#d97706]/40 rounded p-1.5 mt-1">
              {success.warnings.map((w, i) => <div key={i} className="text-[#d97706]">⚠ {w}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Version history list with kind tag + rollback button on
// backup rows. "Live" tag attaches to whichever row has the
// most recent deployed_at — the BE stamps that on the row that
// went live, and on backups when they're created from a live
// snapshot.
function VersionHistory({ history, landingPageId, onRolledBack }) {
  const [rollbackBusyId, setRollbackBusyId] = useState(null)
  const [rollbackError, setRollbackError] = useState(null)
  // Find the version with the most recent deployed_at — that's
  // what's currently on the live page.
  let liveVersionId = null
  let latestDeployedAt = null
  for (const v of history) {
    if (v.deployed_at) {
      const t = new Date(v.deployed_at).getTime()
      if (!latestDeployedAt || t > latestDeployedAt) {
        latestDeployedAt = t
        liveVersionId = v.id
      }
    }
  }
  const handleRollback = async (versionId) => {
    if (rollbackBusyId) return
    if (!confirm(`Roll back to version #${versionId}? The current live page will be snapshotted as a NEW backup first, so this rollback itself stays reversible.`)) return
    setRollbackBusyId(versionId)
    setRollbackError(null)
    try {
      await api.rollbackLandingPage(landingPageId, versionId)
      if (typeof onRolledBack === 'function') onRolledBack({ versionId })
      alert(`Rolled back to version #${versionId}. Refresh / re-open the page to see the new "Live" tag.`)
    } catch (e) {
      setRollbackError(e?.message || String(e))
    } finally {
      setRollbackBusyId(null)
    }
  }
  const kindColors = (kind) => kind === 'imported' ? 'bg-[#e0e7ff] text-[#3b82f6]'
    : kind === 'ai-suggested' ? 'bg-[#dcfce7] text-[#16a34a]'
    : kind === 'human-edited' ? 'bg-[#fef9c3] text-[#854d0e]'
    : kind === 'backup' ? 'bg-[#fef2f2] text-[#c0392b]'
    : kind === 'deployed' ? 'bg-[#f0fdf4] text-[#16a34a]'
    : 'bg-[#f0f0f0] text-muted'
  return (
    <details open className="text-[10px] border border-[#e5e5e5] rounded">
      <summary className="cursor-pointer py-1.5 px-2 bg-[#fafafa] font-medium">
        Version history ({history.length})
        {liveVersionId && <span className="ml-2 text-[9px] text-[#16a34a]">· current live: #{liveVersionId}</span>}
      </summary>
      {rollbackError && (
        <div className="px-2 py-1 text-[#c0392b]">⚠ {rollbackError}</div>
      )}
      <div className="p-2 space-y-1">
        {history.map(v => {
          const isLive = v.id === liveVersionId
          const isBackup = v.kind === 'backup'
          const canRollback = isBackup && !isLive
          const isRollingBack = rollbackBusyId === v.id
          return (
            <div key={v.id} className="flex items-center gap-2 py-1 border-b border-[#f0f0f0] last:border-0">
              <span className="text-[#6C5CE7] font-mono w-12 text-left">#{v.id}</span>
              <span className={`text-[8px] py-0.5 px-1.5 rounded font-medium uppercase ${kindColors(v.kind)}`}>{v.kind}</span>
              {isLive && <span className="text-[8px] py-0.5 px-1.5 rounded font-bold uppercase bg-[#16a34a] text-white">Live</span>}
              <span className="flex-1 truncate text-muted">{v.source_note}</span>
              <span className="text-[9px] text-muted whitespace-nowrap">{new Date(v.created_at).toLocaleString()}</span>
              {canRollback && (
                <button
                  onClick={() => handleRollback(v.id)}
                  disabled={isRollingBack}
                  className="text-[9px] py-0.5 px-1.5 bg-white border border-[#c0392b] text-[#c0392b] rounded cursor-pointer disabled:opacity-50"
                  title="Push this backup's content back to the live page. The current live state is snapshotted first."
                >{isRollingBack ? 'Rolling back…' : '↶ Rollback'}</button>
              )}
            </div>
          )
        })}
      </div>
    </details>
  )
}

// ZeroGPT score bar: 0-30 green (probably human), 30-60 amber
// (mixed signals), 60+ red (likely AI). ZeroGPT is noisy so this
// is a soft signal — the operator decides whether to act on it.
function AiScoreBar({ score }) {
  const s = Number(score) || 0
  const verdict = s >= 60 ? 'Likely AI-written'
    : s >= 30 ? 'Mixed signals'
    : 'Reads as human'
  const cls = s >= 60 ? 'bg-[#c0392b] text-white'
    : s >= 30 ? 'bg-[#d97706] text-white'
    : 'bg-[#2D9A5E] text-white'
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <div className="flex-1 bg-[#f0f0f0] rounded h-3 overflow-hidden border border-[#e5e5e5]">
        <div
          className={`h-full ${s >= 60 ? 'bg-[#c0392b]' : s >= 30 ? 'bg-[#d97706]' : 'bg-[#2D9A5E]'}`}
          style={{ width: `${Math.max(2, Math.min(100, s))}%` }}
        />
      </div>
      <span className={`py-0.5 px-1.5 rounded font-bold ${cls}`}>{s.toFixed(0)}%</span>
      <span className="text-muted">{verdict}</span>
    </div>
  )
}

// Sandbox=""-iframe renderer for a chunk of HTML. Used by the
// proposal diff to show a styled preview of current vs proposed
// page bodies. Why sandboxed:
//   - No scripts can run (sandbox="" denies allow-scripts)
//   - No top-navigation, no popups, no forms
//   - Same-origin is also denied so it can't read cookies / storage
// The preview is a best-effort approximation of how WP would render
// the post_content. We don't have the live theme's stylesheet so
// we ship a minimal one inline — close enough for "does this read
// like a webpage?" but not identical to the deployed look.
function RenderedPreview({ html, tone = 'green' }) {
  const borderClass = tone === 'red' ? 'border-[#c0392b]/30' : 'border-[#2D9A5E]/30'
  const previewCss = `
    html, body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #1f2937; background: #fff; }
    h1, h2, h3, h4, h5, h6 { font-weight: 700; line-height: 1.25; margin: 1.5em 0 0.5em; color: #111; }
    h1 { font-size: 1.8em; }
    h2 { font-size: 1.4em; }
    h3 { font-size: 1.2em; }
    p { margin: 0.8em 0; }
    ul, ol { margin: 0.8em 0; padding-left: 1.4em; }
    li { margin: 0.3em 0; }
    a { color: #6C5CE7; text-decoration: underline; }
    a:hover { color: #5847d4; }
    strong, b { font-weight: 700; }
    em, i { font-style: italic; }
    img { max-width: 100%; height: auto; display: block; margin: 1em 0; border-radius: 4px; }
    blockquote { border-left: 3px solid #6C5CE7; margin: 1em 0; padding: 0.5em 1em; background: #f9f7ff; color: #4b5563; }
    code { background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
    pre { background: #f3f4f6; padding: 1em; border-radius: 4px; overflow-x: auto; }
    hr { border: 0; border-top: 1px solid #e5e7eb; margin: 2em 0; }
    figure { margin: 1em 0; }
    figcaption { text-align: center; font-size: 0.85em; color: #6b7280; margin-top: 0.5em; }
    /* WP block-editor often emits wp-block-* wrappers — let them flow naturally */
    .wp-block-image { margin: 1em 0; }
    .wp-block-buttons { margin: 1em 0; }
    .wp-block-button__link { display: inline-block; padding: 0.5em 1em; background: #6C5CE7; color: #fff !important; text-decoration: none !important; border-radius: 4px; }
  `
  const srcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>${previewCss}</style></head><body>${html || '<p style="color:#9ca3af;font-style:italic;">(empty body)</p>'}</body></html>`
  return (
    <iframe
      title="rendered preview"
      sandbox=""
      srcDoc={srcDoc}
      className={`w-full rounded border bg-white ${borderClass}`}
      style={{ height: '500px' }}
    />
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
