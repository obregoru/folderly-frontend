// V3 Content Studio — Landing Page Manager (Phase 1).
//
// Imports a WP page, shows its parsed body + links + headings +
// images + Yoast meta + the detected site capabilities. Audit /
// propose / deploy land in later phases (this screen will gain
// tabs alongside the existing "Overview" view).
//
// Phase 1 covers: configure default post ID, list managed pages,
// import (or re-import) one, see the parsed state.

import { useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api'

export default function LandingPages() {
  const [state, setState] = useState({
    loading: true,
    error: null,
    wp_configured: false,
    wp_site_url: null,
    default_post_id: null,
    acknowledgments: {},
    pages: [],
  })
  // Auto-shows the BackupGuideModal once before the first deploy
  // for this tenant. Acknowledgment persists on tenants.landing_
  // acknowledgments.backup_guide. Manual "📚 Backup guide" button
  // re-opens it any time after acknowledgment.
  const [backupGuideOpen, setBackupGuideOpen] = useState(false)
  // Set when an operator clicks Deploy without having acknowledged
  // the backup guide. The modal opens, and on dismiss/acknowledge
  // we fire pendingDeployRef.current() to proceed with the deploy.
  const pendingDeployRef = useRef(null)
  // Cross-page site audit — on-demand, single button at the top of
  // the Landing tab. Result lives in component state (not persisted
  // server-side yet). Audit history table can come in a later
  // phase if it becomes useful.
  const [siteAudit, setSiteAudit] = useState(null)
  const [siteAuditBusy, setSiteAuditBusy] = useState(false)
  const [siteAuditError, setSiteAuditError] = useState(null)
  const [siteAuditOpen, setSiteAuditOpen] = useState(false)
  // Bulk per-page audit — separate from siteAudit (which checks
  // the cross-page graph). Runs the per-page audit on EVERY managed
  // page sequentially. Useful after strategy shifts.
  const [bulkAudit, setBulkAudit] = useState(null)
  const [bulkAuditBusy, setBulkAuditBusy] = useState(false)
  const [bulkAuditError, setBulkAuditError] = useState(null)
  const [bulkAuditOpen, setBulkAuditOpen] = useState(false)
  const [bulkAuditElapsed, setBulkAuditElapsed] = useState(0)
  useEffect(() => {
    if (!bulkAuditBusy) { setBulkAuditElapsed(0); return }
    const start = Date.now()
    const tick = setInterval(() => setBulkAuditElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    return () => clearInterval(tick)
  }, [bulkAuditBusy])
  const runBulkAudit = async () => {
    if (bulkAuditBusy) return
    if (!confirm(`Re-audit every managed page for this tenant? This calls Claude once per page (~10-30s each) — total runtime scales with page count. Useful after a strategy hint change.`)) return
    setBulkAuditBusy(true); setBulkAuditError(null); setBulkAuditOpen(true)
    try {
      const r = await api.bulkAuditLandingPages()
      setBulkAudit(r)
    } catch (e) {
      setBulkAuditError(e?.message || String(e))
    } finally {
      setBulkAuditBusy(false)
    }
  }

  const runSiteAudit = async () => {
    if (siteAuditBusy) return
    setSiteAuditBusy(true); setSiteAuditError(null)
    setSiteAuditOpen(true)
    try {
      const r = await api.runLandingSiteAudit()
      setSiteAudit(r)
    } catch (e) {
      setSiteAuditError(e?.message || String(e))
    } finally {
      setSiteAuditBusy(false)
    }
  }
  // Fan-out plan — tenant-specific canonical page set (Make & Take
  // only today). Fetched on mount; null = hide the button entirely.
  // No big-bang creation — operator picks which entries to run via
  // the modal, defaulting to Tier 1.
  // Site Setup Wizard — replaces the older one-shot fan-out modal.
  // Persistent per-slot state; operator can walk away + return.
  // The button only renders if the tenant has a configured plan.
  const [setupData, setSetupData] = useState(null)
  const [setupWizardOpen, setSetupWizardOpen] = useState(false)
  const refreshSetup = async () => {
    try {
      const r = await api.getSetupProgress()
      setSetupData(r.plan ? r : null)
    } catch {
      setSetupData(null)
    }
  }
  useEffect(() => { refreshSetup() }, [])

  // Seasonal awareness — shopping moments coming up in the next 90
  // days AND past their lead-time threshold (so Christmas appears 60
  // days out, Valentine's at 35, etc.). Pages are matched by
  // keyword search across label / strategy_hint / latest body_excerpt
  // so the operator gets a "refresh this for Mother's Day" reminder.
  // Loaded once on mount; cheap enough that no manual refresh is
  // worth the UI noise — operator can reload the tab.
  const [seasonal, setSeasonal] = useState(null)
  const [seasonalError, setSeasonalError] = useState(null)
  const [seasonalDismissed, setSeasonalDismissed] = useState(false)
  useEffect(() => {
    let alive = true
    api.getSeasonalSuggestions()
      .then(r => { if (alive) setSeasonal(r) })
      .catch(e => { if (alive) setSeasonalError(e?.message || String(e)) })
    return () => { alive = false }
  }, [])

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
      // Refresh the full active state via getLandingPage so existing
      // strategy_hint (if the row was already managed) loads into
      // the workspace alongside the freshly-imported page state.
      const full = await api.getLandingPage(r.landing_page_id).catch(() => null)
      setActive({
        ...r,
        // detected_schema arrives top-level from the import response;
        // fold it into page so PageWorkspace's single-source-of-truth
        // for page metadata matches the openPage path.
        page: { ...r.page, detected_schema: r.detected_schema || null },
        strategy_hint: full?.page?.strategy_hint || '',
        ai_citations: Array.isArray(full?.page?.ai_citations) ? full.page.ai_citations : [],
        history: full?.versions || [],
      })
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
      // Surface the most recent completed audit row inline so an
      // operator who ran an audit + reopened the page doesn't have
      // to re-run a (potentially expensive) Claude call to recover
      // the result. Skip `running` and `failed` rows — they have
      // no findings to render. Pre-status rows (back-compat) are
      // treated as `done`.
      const mostRecentAudit = (r.audits || []).find(a => !a.status || a.status === 'done')
      const recoveredAudit = mostRecentAudit ? {
        audit_id: mostRecentAudit.id,
        version_id: mostRecentAudit.version_id,
        findings: mostRecentAudit.findings,
        model_used: mostRecentAudit.model_used,
        created_at: mostRecentAudit.created_at,
        recovered_from_history: true,
      } : null
      // Surface the most recent COMPLETED ai-suggested proposal so
      // ProposalDiff renders (and the Deploy button shows up)
      // immediately when an operator reopens the page from the
      // wizard or sidebar. Without this, the workspace looks empty
      // even though a fresh proposal sits in version history. Only
      // pick versions where proposal_status='done' (skips running /
      // failed); legacy rows without a status are treated as done.
      const latestProposalRow = (r.versions || []).find(v =>
        v.kind === 'ai-suggested' &&
        (!v.proposal_status || v.proposal_status === 'done')
      )
      let recoveredProposal = null
      if (latestProposalRow) {
        try {
          const vresp = await api.getLandingPageVersion(page.id, latestProposalRow.id)
          const v = vresp?.version
          if (v) {
            const meta = v.proposal_meta || {}
            recoveredProposal = {
              version_id: v.id,
              created_at: v.created_at,
              recovered_from_history: true,
              proposal: {
                title: v.title,
                body_html: v.body_html,
                meta_description: v.meta_description,
                focus_keyword: v.focus_keyword,
                links_kept: meta.links_kept || [],
                links_refined: meta.links_refined || [],
                links_added: meta.links_added || [],
                links_removed: meta.links_removed || [],
                summary_of_changes: meta.summary_of_changes || [],
                rationale: meta.rationale || '',
              },
              proposed_links: v.links_meta || [],
              source_links: [],
              // Surface check results on the latest version so the
              // per-page WorkflowWizard can show 'AI checked / voice
              // checked' status without making separate API calls.
              ai_detection: v.ai_detection || null,
              voice_check: v.voice_check || null,
              deployed_at: v.deployed_at || null,
            }
          }
        } catch {}
      }
      setActive({
        landing_page_id: page.id,
        version_id: mostRecent?.id || null,
        strategy_hint: r.page?.strategy_hint || page.strategy_hint || '',
        ai_citations: Array.isArray(r.page?.ai_citations) ? r.page.ai_citations : [],
        recovered_audit: recoveredAudit,
        recovered_proposal: recoveredProposal,
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
          detected_schema: mostRecent?.detected_schema || null,
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
    return <div className="text-[11px] text-muted italic py-8 text-center">Loading pages…</div>
  }

  // Deploy-gate handler. If the operator hasn't acknowledged the
  // backup guide for this tenant yet, intercept the deploy: store
  // the actual-deploy callback in a ref, open the modal, and let
  // the modal fire the callback after acknowledgment. If they've
  // already acknowledged, run the callback immediately.
  const backupAcknowledged = !!state.acknowledgments?.backup_guide
  const requireBackupAck = (continueFn) => {
    if (backupAcknowledged) {
      continueFn()
    } else {
      pendingDeployRef.current = continueFn
      setBackupGuideOpen(true)
    }
  }
  const handleBackupAcknowledge = async () => {
    try {
      const r = await api.setLandingAcknowledgment('backup_guide', true)
      setState(s => ({ ...s, acknowledgments: r.acknowledgments }))
    } catch (e) {
      console.warn('[backup-guide] acknowledge failed:', e?.message)
    }
    setBackupGuideOpen(false)
    if (pendingDeployRef.current) {
      const fn = pendingDeployRef.current
      pendingDeployRef.current = null
      fn()
    }
  }
  const handleBackupClose = () => {
    setBackupGuideOpen(false)
    pendingDeployRef.current = null
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h2 className="text-[13px] font-semibold">Pages</h2>
          <div className="text-[10px] text-muted">SEO/marketing manager for your home page and other key pages. Imports from WordPress, audits SEO + AEO + GEO + E-E-A-T + AI-naturalness, proposes improvements with internal-link suggestions, and lets you back up + deploy approved changes.</div>
        </div>
        {/* Cross-page site audit — surfaces orphans, broken links,
            cannibalization, stale pages, strategic gaps. */}
        <button
          onClick={runSiteAudit}
          disabled={siteAuditBusy}
          className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer flex-shrink-0 whitespace-nowrap disabled:opacity-50"
          title="Look at the whole page portfolio: orphans, broken links, pages targeting overlapping keywords, stale content, missing strategy hints, un-deployed proposals."
        >{siteAuditBusy ? 'Auditing…' : '🌐 Site audit'}</button>
        {/* Bulk per-page audit — re-runs the standard audit on
            every managed page. Useful after a strategy shift. */}
        <button
          onClick={runBulkAudit}
          disabled={bulkAuditBusy}
          className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer flex-shrink-0 whitespace-nowrap disabled:opacity-50"
          title="Re-runs the per-page audit on EVERY managed page sequentially. Use after changing a strategy hint that affects all pages, or after a major site change."
        >{bulkAuditBusy ? `Re-auditing… ${bulkAuditElapsed}s` : '🔁 Re-audit all pages'}</button>
        {/* Always-available manual access to the backup guide
            (regardless of acknowledgment). Useful for re-reading
            instructions or sending the link to a teammate. */}
        <button
          onClick={() => setBackupGuideOpen(true)}
          className="text-[10px] py-1 px-2 bg-white border border-[#d97706] text-[#d97706] rounded cursor-pointer flex-shrink-0 whitespace-nowrap"
          title="Show the WordPress backup guide. Recommended before doing any page deploys."
        >📚 Backup guide</button>
        {/* Tenant-specific canonical page set — Make & Take has one
            configured; other tenants don't see the button. */}
        {setupData && setupData.plan && (
          <button
            onClick={() => setSetupWizardOpen(true)}
            className="text-[10px] py-1 px-2 bg-[#16a34a] text-white border-none rounded cursor-pointer flex-shrink-0 whitespace-nowrap"
            title="Site Setup Wizard — walk through the canonical page set for this tenant. Map existing pages or create new ones, slot by slot. Progress saves automatically."
          >🪄 Site setup wizard</button>
        )}
      </div>

      {/* Tenant-wide editorial policy — applies to every audit +
          propose call across all pages. Collapsed by default so it
          doesn't crowd the UI; expand to edit. */}
      <EditorialPolicyEditor />

      {/* Site audit result panel — only visible after Run site
          audit is clicked. Findings are grouped into 4 buckets so
          the operator can navigate by issue type. */}
      {siteAuditOpen && (
        <SiteAuditPanel
          busy={siteAuditBusy}
          error={siteAuditError}
          audit={siteAudit}
          pages={state.pages}
          onClose={() => setSiteAuditOpen(false)}
          onOpenPage={(pageId) => {
            const p = state.pages.find(pp => pp.id === pageId)
            if (p) { openPage(p); setSiteAuditOpen(false) }
          }}
        />
      )}

      {/* Bulk re-audit result panel — runs sequentially on the BE
          so the result returns once everything is done. Per-page
          rows show each dimension's score in a compact grid. */}
      {bulkAuditOpen && (
        <BulkAuditPanel
          busy={bulkAuditBusy}
          elapsed={bulkAuditElapsed}
          error={bulkAuditError}
          result={bulkAudit}
          onClose={() => setBulkAuditOpen(false)}
          onOpenPage={(pageId) => {
            const p = state.pages.find(pp => pp.id === pageId)
            if (p) { openPage(p); setBulkAuditOpen(false) }
          }}
        />
      )}

      {/* Seasonal awareness banner — surfaces upcoming shopping
          seasons + which managed pages likely benefit from a
          pre-season refresh. Dismiss is session-only (no server
          ack) — operators see it again next visit. */}
      {!seasonalDismissed && seasonal && seasonal.upcoming && seasonal.upcoming.length > 0 && (
        <SeasonalBanner
          upcoming={seasonal.upcoming}
          onDismiss={() => setSeasonalDismissed(true)}
          onOpenPage={(pageId) => {
            const p = state.pages.find(pp => pp.id === pageId)
            if (p) openPage(p)
          }}
        />
      )}
      {seasonalError && (
        <div className="bg-[#fef2f2] border border-[#c0392b]/30 rounded p-2 text-[10px] text-[#c0392b]">
          Seasonal suggestions unavailable: {seasonalError}
        </div>
      )}

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
            <div className="text-[11px] font-medium">Default page</div>
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
              {active?.page?.wp_post_id && String(active.page.wp_post_id) !== defaultDraft.trim() && (
                <button
                  onClick={() => setDefaultDraft(String(active.page.wp_post_id))}
                  className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer whitespace-nowrap"
                  title={`Fill in the current page's WP post ID (${active.page.wp_post_id}) so you can save it as the default with one click.`}
                >Use current (#{active.page.wp_post_id})</button>
              )}
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

          {/* Create new landing page — collapsed by default */}
          <CreateNewLandingPage
            pages={state.pages}
            onCreated={async (newId) => {
              await reload()
              // Open the new page in the workspace immediately.
              const fresh = await api.listLandingPages().catch(() => null)
              const created = fresh?.pages?.find(p => p.id === newId)
              if (created) openPage(created)
            }}
          />

          {/* CTA tracking install state — once expanded, shows the
              tracking snippet for one-time copy-paste into WP +
              a 28d click count that flips to "✓ installed" the
              moment any beacon fires. Collapsed by default since
              this is a setup-once concern. */}
          <CtaSettingsCard />

          {/* Managed pages list — hierarchical (children indented
              under their parent). Parents render first; orphan
              children with a parent_landing_page_id that no longer
              resolves get rendered at top level so they stay
              accessible. */}
          {state.pages.length > 0 && (
            <ManagedPagesPanel
              pages={state.pages}
              onOpen={openPage}
              defaultPostId={state.default_post_id}
              activeLandingPageId={active?.landing_page_id || null}
            />
          )}

          {/* Workspace — the parsed page from the most recent import */}
          {activeLoading && (
            <div className="text-[11px] text-muted italic py-4 text-center">Loading page…</div>
          )}
          {active && (
            <PageWorkspace
              // Force a full re-mount on page switch. Without this,
              // PageWorkspace and its children (SchemaTypesAllowlist,
              // SchemaBlock, DeployBlock, etc.) keep their internal
              // state across page changes — so allowlist selections,
              // schema results, etc. leak between pages. Re-mounting
              // on landing_page_id change gives a clean slate every
              // time. UI state like expanded sections resets, but
              // that's the right tradeoff for cross-page correctness.
              key={active.landing_page_id}
              data={active}
              requireBackupAck={requireBackupAck}
            />
          )}
        </>
      )}

      {state.error && (
        <div className="bg-[#fef2f2] border border-[#c0392b]/30 rounded p-3 text-[11px] text-[#c0392b]">{state.error}</div>
      )}

      {/* Modal mounts at top-level so it overlays everything;
          auto-opens before first deploy + manually openable via the
          📚 Backup guide button in the header. */}
      {backupGuideOpen && (
        <BackupGuideModal
          alreadyAcknowledged={backupAcknowledged}
          isPreDeployGate={!!pendingDeployRef.current}
          onAcknowledge={handleBackupAcknowledge}
          onClose={handleBackupClose}
        />
      )}

      {/* Site Setup Wizard — persistent per-slot state, tier-grouped
          map of every recommended page. Map existing / create new /
          skip per slot; status badges + actions update in place. */}
      {setupWizardOpen && setupData && (
        <SetupWizardModal
          data={setupData}
          onClose={() => setSetupWizardOpen(false)}
          onRefresh={refreshSetup}
          onOpenPage={(landingPageId) => {
            const p = state.pages.find(pp => pp.id === landingPageId)
            if (p) {
              openPage(p)
              setSetupWizardOpen(false)
            }
          }}
          onAfterMutation={async () => {
            await reload()
            await refreshSetup()
          }}
        />
      )}
    </div>
  )
}

function PageWorkspace({ data, requireBackupAck }) {
  const { page, capabilities = {}, history = [], landing_page_id, strategy_hint: initialHint, ai_citations: initialCitations, recovered_audit: recoveredAudit, recovered_proposal: recoveredProposal } = data
  const links = page.links || []
  const internalLinks = links.filter(l => l.type === 'internal')
  const externalLinks = links.filter(l => l.type === 'external')
  const headings = page.headings || []
  const images = page.images || []
  const missingAlt = images.filter(i => !i.alt || !i.alt.trim()).length

  // Strategy hint — free-form prose the operator writes to give
  // Claude strategic context on every audit / proposal / schema run
  // for this specific page. Persists on landing_pages.strategy_hint.
  const [hint, setHint] = useState(initialHint || '')
  const [hintSaving, setHintSaving] = useState(false)
  const [hintSaved, setHintSaved] = useState(false)
  const [hintError, setHintError] = useState(null)
  useEffect(() => { setHint(initialHint || '') }, [initialHint, landing_page_id])
  const saveHint = async () => {
    if (hintSaving || !landing_page_id) return
    setHintSaving(true); setHintError(null); setHintSaved(false)
    try {
      await api.setLandingPageStrategyHint(landing_page_id, hint)
      setHintSaved(true)
      setTimeout(() => setHintSaved(false), 2500)
    } catch (e) {
      setHintError(e?.message || String(e))
    } finally {
      setHintSaving(false)
    }
  }

  // Audit state — null until the operator clicks Run audit. Caches
  // findings keyed by audit row id so switching dimensions doesn't
  // re-fetch. Selected suggestions feed the proposal
  // generator (not wired here — just stored locally for now so the
  // operator can shape their shortlist while reviewing).
  // Audit state. Pre-populated from the most recent audit row on
  // workspace open so an operator who hit a proxy timeout (or just
  // opened a previously-audited page) sees the existing findings
  // without re-running the Claude call. Recovered audits carry a
  // `recovered_from_history: true` flag so the UI can show a
  // "this is the saved result from {date}" note.
  const [audit, setAudit] = useState(recoveredAudit || null)
  const [auditBusy, setAuditBusy] = useState(false)
  const [auditError, setAuditError] = useState(null)
  // When the operator switches pages, swap the audit too — without
  // this, stale findings from page A would render on page B.
  useEffect(() => { setAudit(recoveredAudit || null) }, [landing_page_id, recoveredAudit])
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
      // BE returns `{ audit_id, status: 'running', ... }` immediately
      // and runs Claude in the background — no proxy timeout possible.
      // We poll the audit row every 4s until status flips to 'done'
      // (success) or 'failed' (Claude / API error). Soft cap at 5 min
      // since even web-search-heavy audits finish in 2-3.
      const startResp = await api.runLandingPageAudit(landing_page_id)
      if (!startResp || !startResp.audit_id) {
        throw new Error('audit kickoff returned no audit_id')
      }
      const auditId = startResp.audit_id
      const deadline = Date.now() + 5 * 60 * 1000
      let final = null
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 4000))
        try {
          const r = await api.getLandingPageAudit(landing_page_id, auditId)
          const a = r?.audit
          if (a?.status === 'done') { final = a; break }
          if (a?.status === 'failed') {
            throw new Error(a.error || 'Audit failed (see server logs).')
          }
        } catch (pollErr) {
          // Transient poll failures (network blip) — keep trying.
          // A persistent failure will eventually trip the deadline.
          if (pollErr?.message?.includes('Audit failed')) throw pollErr
        }
      }
      if (!final) throw new Error('Audit timed out after 5 minutes. The Claude call may still be running — refresh in a moment to see if it completed.')
      setAudit({
        audit_id: final.id,
        version_id: final.version_id,
        findings: final.findings,
        model_used: final.model_used,
        created_at: final.created_at,
      })
      setSelectedSuggestions(new Set())
    } catch (e) {
      setAuditError(e?.message || String(e))
    } finally {
      setAuditBusy(false)
    }
  }

  // Proposal state. Lives alongside audit so the diff
  // view can render the current vs proposed bodies + the
  // link-change ledger Claude emits. Pre-populated with the most
  // recent completed ai-suggested version so the Deploy button
  // renders immediately when reopening from the wizard or sidebar
  // (no need to re-run propose). Recovered proposals carry a
  // `recovered_from_history: true` flag.
  const [proposal, setProposal] = useState(recoveredProposal || null)
  // Swap when operator changes pages — otherwise a recovered
  // proposal from page A would render on page B.
  useEffect(() => { setProposal(recoveredProposal || null) }, [landing_page_id, recoveredProposal])
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

  const runProposal = async ({ useCheckFeedback = false } = {}) => {
    if (proposalBusy || !landing_page_id) return
    if (audit?.audit_id && selectedSuggestions.size === 0 && !useCheckFeedback) return
    setProposalBusy(true); setProposalError(null)
    try {
      // BE returns { version_id, status: 'running' } immediately;
      // the actual Claude work runs in the background. Poll the
      // version row until proposal_status flips to 'done' (or
      // 'failed'). Six-dimension proposals run 100-150s — well
      // past Cloudflare's 100s edge timeout, so the sync version
      // of this call would CORS-error out.
      const start = await api.proposeLandingPageRewrite(landing_page_id, {
        ...(audit?.audit_id
          ? {
              auditId: audit.audit_id,
              acceptedSuggestionIds: Array.from(selectedSuggestions),
            }
          : {}),
        ...(useCheckFeedback ? { useCheckFeedback: true } : {}),
      })
      const newVersionId = start?.version_id
      if (!newVersionId) throw new Error('Proposal kickoff returned no version_id')

      // Poll up to 5 minutes; checks every 5s.
      const deadline = Date.now() + 5 * 60 * 1000
      let finalVersion = null
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5000))
        try {
          const r = await api.getLandingPageVersion(landing_page_id, newVersionId)
          const v = r?.version
          if (v?.proposal_status === 'done') { finalVersion = v; break }
          if (v?.proposal_status === 'failed') {
            throw new Error(v.proposal_error || 'Proposal failed (see server logs).')
          }
        } catch (pollErr) {
          if (pollErr?.message?.includes('Proposal failed')) throw pollErr
          // Transient poll error — keep trying.
        }
      }
      if (!finalVersion) throw new Error('Proposal timed out after 5 minutes. Refresh in a moment to see if it completed.')

      // Reshape into the {version_id, proposal, source_links} shape
      // that ProposalDiff renders against. Rich metadata (rationale,
      // summary, link ledger) comes from proposal_meta which the BG
      // handler populates after Claude returns.
      const meta = finalVersion.proposal_meta || {}
      setProposal({
        version_id: finalVersion.id,
        created_at: finalVersion.created_at,
        proposal: {
          title: finalVersion.title,
          body_html: finalVersion.body_html,
          meta_description: finalVersion.meta_description,
          focus_keyword: finalVersion.focus_keyword,
          links_kept: meta.links_kept || [],
          links_refined: meta.links_refined || [],
          links_added: meta.links_added || [],
          links_removed: meta.links_removed || [],
          summary_of_changes: meta.summary_of_changes || [],
          rationale: meta.rationale || '',
        },
        proposed_links: finalVersion.links_meta || [],
        source_links: start.source_links || [],
      })
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

      {/* Workflow wizard — 5-step tracker showing what's been done
          on this page + what's recommended next. Steps can be run
          in any order (layered workflow support). Each card has a
          status badge, last-action date, and click-to-jump-to-panel
          for the matching action. */}
      <WorkflowWizard
        page={page}
        audit={audit}
        proposal={proposal}
        history={history}
        recoveredProposal={recoveredProposal}
      />

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

      {/* Strategy hint — free-form intent the operator writes for
          Claude to use on every audit / proposal / schema run. Sits
          near the top so it's high-visibility; saving is explicit
          (no auto-save) so paste-tweaks don't churn DB writes. */}
      <div className="bg-[#fef9c3] border border-[#ca8a04]/40 rounded p-2 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-[#854d0e]">🎯 Strategy hint for AI revisions</span>
          <span className="text-[9px] text-muted">Used by audit + proposal + schema for THIS page only. Other pages have their own.</span>
          <div className="flex-1" />
          <button
            onClick={saveHint}
            disabled={hintSaving}
            className="text-[10px] py-0.5 px-2 bg-[#ca8a04] text-white border-none rounded cursor-pointer disabled:opacity-50"
          >{hintSaving ? 'Saving…' : hintSaved ? '✓ Saved' : 'Save'}</button>
        </div>
        <textarea
          value={hint}
          onChange={e => setHint(e.target.value)}
          rows={5}
          placeholder="e.g. This is an authority/editorial page covering the candle-bar scene in [city]. Rank for 'candle bar [city]', 'perfume making [city]', and adjacent terms. Voice: enthusiastic but editorial — we curate + review actual local venues with honest outbound links, not promotional fluff. Brand-behind-the-platform is Poppy &amp; Thyme (Menomonee Falls, WI); mention as the editorial voice / brand-of-record where natural."
          className="w-full text-[11px] border border-[#ca8a04]/30 rounded p-2 bg-white outline-none focus:border-[#ca8a04] resize-y font-sans"
        />
        {hintError && <div className="text-[10px] text-[#c0392b]">⚠ {hintError}</div>}
        <div className="text-[9px] text-muted italic">
          Tip: describe the page's intent + tone + target searches + brand voice. Claude weights this above generic SEO best-practices when there's a tradeoff.
        </div>
      </div>

      {/* Per-page schema allowlist — explicit operator-declared set
          of Schema.org @type values this page is allowed to emit.
          Stops Claude from guessing (and slipping in Service /
          LocalBusiness for publication contexts). Collapsed by
          default; loads on first expand. */}
      <SchemaTypesAllowlist landingPageId={landing_page_id} />

      {/* AI Overview citations — operator-pasted snippets where
          Google AI Overview / ChatGPT / Perplexity / etc. quote
          this page. Threaded into every audit + propose run as
          "PROTECT THIS LANGUAGE" guidance so a rewrite doesn't
          accidentally lose the AI Overview citation. */}
      <AiCitationsCard
        landingPageId={landing_page_id}
        initial={initialCitations}
      />

      {/* Search Console — per-page performance block. Lazy-fetches
          on operator click since GSC API calls cost (~2-5 round
          trips per page) and not every page workspace open is
          interested in metrics. */}
      <GscBlock landingPageId={landing_page_id} pageUrl={page.url} />

      {/* CTA click tracking — per-anchor click counts for the last
          28 days. Lazy-loaded on expand so the workspace open is
          fast. Shows even with zero clicks (anchors exist, snippet
          may not be installed yet — the per-tenant install state
          is surfaced separately at the top of the Landing tab). */}
      <CtaStatsBlock landingPageId={landing_page_id} />

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

      {/* Detected JSON-LD schema — what's already live on the page,
          captured at import time. Sourced from a public-URL fetch
          (Yoast/RankMath/etc. emit schema in <head>, not body). The
          summary tells the operator what types are present + whether
          there are validation errors. Helps decide what types to
          generate vs. what's already covered. */}
      {page.detected_schema && (
        <DetectedSchemaBlock detected={page.detected_schema} />
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
      <div data-workflow-anchor="audit" className="border border-[#6C5CE7]/30 rounded p-3 space-y-2 bg-[#fafbff]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-[#6C5CE7]">🔍 5-dimension audit</span>
          <span className="text-[9px] text-muted">SEO · AEO · GEO · E-E-A-T · AI-naturalness · breadcrumbs</span>
          <div className="flex-1" />
          {audit?.created_at && (
            <span className="text-[9px] text-muted">
              Last run {new Date(audit.created_at).toLocaleString()}
              {typeof audit.web_search_uses === 'number' && (
                audit.web_search_uses > 0
                  ? <span className="ml-1 text-[#16a34a]" title="Audit compared against the top SERP results via web_search">· 🔎 {audit.web_search_uses} SERP {audit.web_search_uses === 1 ? 'lookup' : 'lookups'}</span>
                  : <span className="ml-1 text-muted" title="Audit didn't use web_search this run">· no SERP comparison</span>
              )}
            </span>
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
            Claude is reading the page (~30-90s on a typical page — the model has to scan the whole body, headings, and links to score 5 dimensions). Don't refresh the tab.
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

      {/* Proposal panel — also serves as anchor target for steps
          3 (AI check), 4 (voice check), and refine (🎯 Re-propose
          with feedback) since those actions all live inside this
          panel via ProposalDiff. */}
      <div data-workflow-anchor="proposal" data-workflow-anchor-secondary="ai-check voice-check refine" className="border border-[#2D9A5E]/30 rounded p-3 space-y-2 bg-[#f0fdf4]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-[#2D9A5E]">💡 Rewrite proposal</span>
          <span className="text-[9px] text-muted">Full body rewrite using: tenant editorial policy + page strategy hint + AI Overview citations (preserve + restore) + selected audit findings + (on 🎯 Re-propose) latest AI-detection + voice-check feedback. Existing links preserved by design.</span>
          <div className="flex-1" />
          {proposal?.created_at && (
            <span className="text-[9px] text-muted">Generated {new Date(proposal.created_at).toLocaleString()}</span>
          )}
          <button
            onClick={() => runProposal()}
            disabled={proposalBusy || (audit?.audit_id && selectedSuggestions.size === 0)}
            className="text-[10px] py-1 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50"
            title={
              audit?.audit_id && selectedSuggestions.size === 0 ? 'Tick the audit findings you want addressed.'
              : audit?.audit_id ? `Send ${selectedSuggestions.size} audit suggestion(s) + the tenant editorial policy + page strategy hint + AI Overview citations (preserve/restore) to Claude. Returns a rewrite proposal. Takes ~100-150s.`
              : 'No audit findings selected — Claude writes from scratch using the tenant editorial policy + page strategy hint + indexed site source material + AI Overview citations (preserve/restore). For 🎯 Re-propose with feedback, also pulls the latest AI-detection + voice-check. Takes ~100-150s.'
            }
          >{proposalBusy
              ? `Generating… ${proposalElapsed}s`
              : proposal ? '🔄 Re-generate proposal'
              : audit?.audit_id ? '💡 Generate proposal'
              : '✨ Generate from scratch'}</button>
          {/* Re-propose with check feedback. Available once a proposal
              exists — the BE loads the latest ai-suggested version's
              ai_detection + voice_check (if either has been run) and
              feeds them into the propose prompt as targeted
              remediation guidance. Falls back to plain regenerate
              if no checks have been run yet (BE handles that case
              gracefully). Tooltip surfaces the loop pattern so
              operators see when this is useful vs the plain regen. */}
          {proposal && !proposalBusy && (
            <button
              onClick={() => runProposal({ useCheckFeedback: true })}
              disabled={proposalBusy}
              className="text-[10px] py-1 px-2 bg-white border border-[#2D9A5E] text-[#2D9A5E] rounded cursor-pointer disabled:opacity-50"
              title="Re-propose using the most recent Check AI Score + Check Voice results. Claude reads the flagged sentences and voice drifts and rewrites the equivalent content specifically to address them. Falls back to plain regenerate if no checks have been run yet."
            >🎯 Re-propose with feedback</button>
          )}
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
              ? "No audit yet — that's fine for scaffold or low-content pages. Click ✨ Generate from scratch to have Claude write content using the strategy hint + indexed site pages as source material."
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
            requireBackupAck={requireBackupAck}
          />
        )}
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
                  <label className="flex items-center gap-1 cursor-pointer pt-0.5" title="Include this finding in the next proposal — Claude will address it in the rewrite.">
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
          {selected.size} suggestion{selected.size === 1 ? '' : 's'} flagged. Click <b>Generate proposal</b> below to have Claude implement them in a rewrite.
        </div>
      )}
    </div>
  )
}

function ProposalDiff({ proposal, sourcePage, landingPageId, onReplace, requireBackupAck }) {
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
  // Voice-check state (pairs with AI-detection — different failure
  // mode). Lazy: only runs when operator clicks Check brand voice.
  const [voiceResult, setVoiceResult] = useState(null)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voiceError, setVoiceError] = useState(null)
  // Reset transient state whenever the parent passes a NEW proposal
  // (e.g. operator clicked Re-generate). React identity check on
  // proposal.version_id keeps the state fresh without manual clears.
  useEffect(() => {
    setAiResult(null); setAiError(null); setHumanError(null); setHumanNotes(null)
    setVoiceResult(null); setVoiceError(null)
    setCurrentVersionId(proposal?.version_id || null)
    setCurrentBodyHtml(proposal?.proposal?.body_html || '')
  }, [proposal?.version_id])
  useEffect(() => {
    if (!humanBusy) { setHumanElapsed(0); return }
    const start = Date.now()
    const tick = setInterval(() => setHumanElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    return () => clearInterval(tick)
  }, [humanBusy])

  const checkVoice = async () => {
    if (voiceBusy || !landingPageId || !currentVersionId) return
    setVoiceBusy(true); setVoiceError(null)
    try {
      const r = await api.voiceCheckLandingPageVersion(landingPageId, currentVersionId)
      setVoiceResult(r)
    } catch (e) {
      setVoiceError(e?.message || String(e))
    } finally {
      setVoiceBusy(false)
    }
  }

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

  // Editable meta state. Operator can refine Claude's suggested
  // title / meta description / focus keyword before deploy —
  // there are real reasons to override (trademark, length,
  // regional emphasis). Edits save on blur; deploy reads from the
  // updated version row, so saved edits flow to WordPress without
  // re-running propose.
  const [editTitle, setEditTitle] = useState(p.title || '')
  const [editMeta, setEditMeta] = useState(p.meta_description || '')
  const [editFocus, setEditFocus] = useState(p.focus_keyword || '')
  const [metaSaving, setMetaSaving] = useState(false)
  const [metaSaved, setMetaSaved] = useState(null)
  const [metaError, setMetaError] = useState(null)
  // Re-seed when the proposal changes (re-generate).
  useEffect(() => {
    setEditTitle(p.title || '')
    setEditMeta(p.meta_description || '')
    setEditFocus(p.focus_keyword || '')
    setMetaSaved(null); setMetaError(null)
  }, [proposal?.version_id])

  const saveMeta = async (field, value) => {
    if (!landingPageId || !currentVersionId) return
    setMetaSaving(true); setMetaError(null); setMetaSaved(null)
    try {
      const r = await api.updateLandingVersionMeta(landingPageId, currentVersionId, { [field]: value })
      setMetaSaved(`${field === 'title' ? 'Title' : field === 'meta_description' ? 'Meta description' : 'Focus keyword'} saved`)
      setTimeout(() => setMetaSaved(null), 2000)
      return r
    } catch (e) {
      setMetaError(e?.message || String(e))
    } finally {
      setMetaSaving(false)
    }
  }

  const titleChanged = (editTitle || '').trim() && (editTitle || '').trim() !== sourceTitle.trim()
  const metaChanged = (editMeta || '').trim() && (editMeta || '').trim() !== sourceMeta.trim()

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

      {/* Title / meta / focus keyword — editable. Operator can refine
          Claude's suggestion before deploy (saves on blur). Deploy
          reads from the version row, so edits flow through. */}
      <div className="bg-white border border-[#e5e5e5] rounded p-2 space-y-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink">Meta changes</span>
          <span className="text-[9px] text-muted">Editable — save on blur</span>
          <span className="flex-1" />
          {metaSaving && <span className="text-[9px] text-muted">Saving…</span>}
          {metaSaved && <span className="text-[9px] text-[#16a34a]">✓ {metaSaved}</span>}
          {metaError && <span className="text-[9px] text-[#c0392b]">⚠ {metaError}</span>}
        </div>

        {/* Title */}
        <div>
          <div className="text-muted">Title (before):</div>
          <div className="bg-[#fef2f2] border-l-2 border-[#c0392b] pl-2 py-0.5">{sourceTitle || <i>(none)</i>}</div>
          <div className="text-muted mt-1 flex items-center gap-2">
            <span>Title (proposed, editable):</span>
            <span className={`text-[9px] ${editTitle.length > 60 ? 'text-[#d97706]' : 'text-muted'}`}>
              {editTitle.length}/60 chars
              {editTitle.length > 60 && <span> · Google may truncate</span>}
            </span>
          </div>
          <input
            type="text"
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onBlur={() => {
              if (editTitle !== (p.title || '')) saveMeta('title', editTitle)
            }}
            className="w-full bg-[#f0fdf4] border-l-2 border-[#2D9A5E] pl-2 py-1 text-[10px] outline-none focus:bg-white focus:border-[#2D9A5E] focus:ring-1 focus:ring-[#2D9A5E]/30"
          />
        </div>

        {/* Meta description */}
        <div>
          <div className="text-muted">Meta description (before):</div>
          <div className="bg-[#fef2f2] border-l-2 border-[#c0392b] pl-2 py-0.5">{sourceMeta || <i>(none)</i>}</div>
          <div className="text-muted mt-1 flex items-center gap-2">
            <span>Meta description (proposed, editable):</span>
            <span className={`text-[9px] ${editMeta.length > 160 ? 'text-[#d97706]' : 'text-muted'}`}>
              {editMeta.length}/160 chars
              {editMeta.length > 160 && <span> · Google may truncate</span>}
            </span>
          </div>
          <textarea
            value={editMeta}
            onChange={e => setEditMeta(e.target.value)}
            onBlur={() => {
              if (editMeta !== (p.meta_description || '')) saveMeta('meta_description', editMeta)
            }}
            rows={3}
            className="w-full bg-[#f0fdf4] border-l-2 border-[#2D9A5E] pl-2 py-1 text-[10px] outline-none focus:bg-white focus:border-[#2D9A5E] focus:ring-1 focus:ring-[#2D9A5E]/30 resize-y font-sans"
          />
        </div>

        {/* Focus keyword */}
        <div>
          <div className="text-muted">Focus keyword (editable):</div>
          <input
            type="text"
            value={editFocus}
            onChange={e => setEditFocus(e.target.value)}
            onBlur={() => {
              if (editFocus !== (p.focus_keyword || '')) saveMeta('focus_keyword', editFocus)
            }}
            placeholder="e.g. candle bar milwaukee"
            className="w-full bg-white border border-[#e5e5e5] rounded px-2 py-1 text-[10px] outline-none focus:border-[#2D9A5E]"
          />
        </div>
      </div>

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

      {/* Brand-voice consistency check — pairs with ZeroGPT but
          catches a different failure mode. ZeroGPT: "is this
          machine-written?" Voice check: "does this sound like THIS
          brand?" Generic-helpful prose passes ZeroGPT but fails
          voice check. */}
      <div className="bg-white border border-[#e5e5e5] rounded p-2 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-ink">🎤 Brand voice</span>
          <span className="text-muted">Catches "human but generic" — copy that passes ZeroGPT but doesn't sound like your brand.</span>
          <div className="flex-1" />
          <button
            onClick={checkVoice}
            disabled={voiceBusy || !currentVersionId}
            className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer disabled:opacity-50"
            title="Score the proposed body against the brand voice profile (tenant brand_rules + audience_notes + strategy_hint + up to 2 sample on-voice pages)."
          >{voiceBusy ? 'Checking…' : voiceResult ? '🔄 Re-check voice' : '🎤 Check brand voice'}</button>
        </div>
        {voiceError && <div className="text-[10px] text-[#c0392b]">⚠ {voiceError}</div>}
        {voiceResult && <VoiceResult result={voiceResult} />}
        {!voiceResult && !voiceBusy && !voiceError && (
          <div className="text-[10px] text-muted italic">Click "Check brand voice" to score how on-brand the proposed body reads.</div>
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
      {/* Body editor with mode toggle. Operator picks Rendered
          preview (contentEditable, friendlier) OR HTML source
          (textarea, byte-exact, preserves WP block comments). One
          mode visible at a time; switching reloads from the saved
          version (so save before switching or you'll lose unsaved
          edits). Schema regen + deploy both read from the saved
          version regardless of which mode the edit was made in. */}
      <BodyEditorWithToggle
        sourcePage={sourcePage}
        currentBodyHtml={currentBodyHtml}
        landingPageId={landingPageId}
        currentVersionId={currentVersionId}
        isHumanized={currentVersionId !== proposal?.version_id}
        onSaved={(newHtml) => setCurrentBodyHtml(newHtml)}
      />

      {/* Schema.org — Phase 6. Generates JSON-LD blocks tailored
          to the current version's content + tenant brand. Operator
          copies each block into Yoast Premium custom schema /
          Schema Pro / theme snippet. Native deploy can come later
          once per-plugin REST paths are validated. */}
      <SchemaBlock
        landingPageId={landingPageId}
        versionId={currentVersionId}
      />

      {/* Deploy — Phase 5. Big red CTA so the operator can't miss
          that this is the irreversible-without-rollback step. */}
      <DeployBlock
        landingPageId={landingPageId}
        versionId={currentVersionId}
        requireBackupAck={requireBackupAck}
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

// Post-deploy schema validation summary. Shown inline in the
// deploy success block so the operator sees Rich-Results-style
// validation feedback immediately, before they navigate away.
// Post-deploy validator links. Three third-party tools that
// independently parse the live page's structured data:
//
//   - Schema.org Validator: the neutral / canonical validator
//     run by Schema.org with help from Google. Tests JSON-LD,
//     Microdata, RDFa. The first stop for "is my schema valid."
//   - Google Rich Results Test: Google's view — tells you which
//     of your schema entities are rich-result-eligible.
//   - Bing URL Inspection: Microsoft/Bing's equivalent of GSC
//     URL inspection. Shows how Bing parses the page (Bing is
//     the upstream of ChatGPT search + Bing Copilot, so this
//     matters for AI surfaces too). Requires Bing Webmaster
//     account login.
function ExternalValidatorLinks({ liveUrl }) {
  if (!liveUrl) return null
  const encoded = encodeURIComponent(liveUrl)
  const schemaOrgValidator = `https://validator.schema.org/#url=${encoded}`
  const googleRichResults = `https://search.google.com/test/rich-results?url=${encoded}`
  // Bing's URL inspection doesn't accept a ?url= param — it only
  // takes the URL once the user is inside Webmaster Tools. Best
  // we can do is deep-link to the inspection page; user pastes
  // the URL there.
  const bingInspect = `https://www.bing.com/webmasters/url-inspection`
  return (
    <div className="bg-white border border-[#e5e5e5] rounded p-1.5 mt-1 space-y-1">
      <div className="text-[10px] text-muted font-medium">Verify on third-party tools</div>
      <div className="flex flex-wrap gap-1.5 text-[9px]">
        <a
          href={schemaOrgValidator}
          target="_blank"
          rel="noopener noreferrer"
          className="py-0.5 px-1.5 bg-[#6C5CE7] text-white rounded no-underline"
          title="Schema.org's canonical validator — neutral test of JSON-LD / Microdata / RDFa"
        >🧪 Schema.org Validator</a>
        <a
          href={googleRichResults}
          target="_blank"
          rel="noopener noreferrer"
          className="py-0.5 px-1.5 bg-[#4285f4] text-white rounded no-underline"
          title="Google's view — tells you which entities are rich-result-eligible"
        >🔎 Google Rich Results Test</a>
        <a
          href={bingInspect}
          target="_blank"
          rel="noopener noreferrer"
          className="py-0.5 px-1.5 bg-[#0078d4] text-white rounded no-underline"
          title="Bing Webmaster URL Inspection — Microsoft's equivalent (Bing powers ChatGPT search + Copilot, so this matters for AI surfaces too). Requires Bing Webmaster login."
        >🅼 Bing URL Inspection</a>
        <button
          type="button"
          onClick={() => { navigator.clipboard?.writeText(liveUrl).catch(() => {}) }}
          className="py-0.5 px-1.5 bg-white border border-[#e5e5e5] text-ink rounded cursor-pointer"
          title="Copy the live URL — paste into Bing Webmaster URL Inspection (it doesn't accept a URL param)"
        >📋 Copy URL</button>
      </div>
      <div className="text-[9px] text-muted italic">
        Run a clean validation now (Schema.org + Google open with the URL prefilled). For Bing, copy the URL then paste it into the inspection tool after sign-in.
      </div>
    </div>
  )
}

function SchemaValidationSummary({ v }) {
  if (!v) return null
  const summary = v.summary || {}
  if (v.fetch_error) {
    return (
      <div className="bg-[#fff7ed] border border-[#d97706]/40 rounded p-1.5 mt-1 text-[10px]">
        ⚠ Schema validation: couldn't fetch the live page ({v.fetch_error}). Schema may still be valid — Google's crawl will tell you for sure.
      </div>
    )
  }
  if (summary.no_jsonld) {
    return (
      <div className="bg-[#fff7ed] border border-[#d97706]/40 rounded p-1.5 mt-1 text-[10px]">
        ⚠ Schema validation: no JSON-LD found on the live page. If you have a schema plugin (Yoast / RankMath / Schema Pro) it usually injects automatically — check the plugin is active + configured.
      </div>
    )
  }
  const tone = summary.error_count > 0 ? 'bg-[#fef2f2] border-[#c0392b]/40' :
    summary.warning_count > 0 ? 'bg-[#fff7ed] border-[#d97706]/40' :
    'bg-[#f0fdf4] border-[#16a34a]/40'
  const headline = summary.error_count > 0
    ? `⚠ ${summary.error_count} schema error${summary.error_count === 1 ? '' : 's'} on the live page`
    : summary.warning_count > 0
      ? `${summary.total_entities} JSON-LD entities found; ${summary.warning_count} warning${summary.warning_count === 1 ? '' : 's'}`
      : `✓ ${summary.total_entities} JSON-LD entities found, all valid`
  return (
    <details className={`text-[10px] border rounded mt-1 ${tone}`}>
      <summary className="cursor-pointer py-1 px-2 font-medium">
        🏷️ {headline}
      </summary>
      <div className="p-2 space-y-1">
        {(v.blocks || []).map((b, bi) => (
          <div key={bi}>
            <div className="font-mono text-[9px] text-muted">Block #{b.block_index + 1} — {b.entity_count} entit{b.entity_count === 1 ? 'y' : 'ies'}</div>
            {b.entities.map((e, ei) => (
              <div key={ei} className="ml-3 mt-0.5">
                <div>
                  <span className="font-mono">{e.type || '(no type)'}</span>
                  {e.ok ? <span className="ml-1 text-[#16a34a]">✓ valid</span> : <span className="ml-1 text-[#c0392b]">⚠ errors</span>}
                </div>
                {(e.errors || []).map((err, i) => <div key={i} className="text-[#c0392b] ml-3">• {err}</div>)}
                {(e.warnings || []).map((w, i) => <div key={i} className="text-[#d97706] ml-3">• {w}</div>)}
              </div>
            ))}
          </div>
        ))}
        <div className="text-[9px] text-muted italic pt-1">
          Validated against schema.org's @context + @type + per-type required fields. For the full Google Rich Results check, paste the URL into <a href="https://search.google.com/test/rich-results" target="_blank" rel="noopener noreferrer" className="text-[#6C5CE7] underline">search.google.com/test/rich-results</a>.
        </div>
      </div>
    </details>
  )
}

// Per-page Google Search Console performance block. Lazy: only
// fetches when operator clicks "Pull GSC data" so we don't blow
// API quota on every workspace open. Three states:
//   1. GSC not connected (or not configured for this tenant) →
//      shows a "Connect Search Console" button that opens the
//      Google OAuth flow in a popup.
//   2. GSC connected but no site selected → site picker dropdown.
//   3. GSC fully set up → "Pull GSC data" + result display.
// Detected JSON-LD on the live page, captured at import time.
// Shows the operator exactly what schema types Yoast/Rank Math/etc.
// are already emitting — separate concern from "what schema should
// we generate to fill the gaps." Renders as a single collapsible
// block with a one-line summary by default + a per-block breakdown
// when expanded. Errors highlighted; ok'd entities listed.
function DetectedSchemaBlock({ detected }) {
  if (!detected) return null
  if (detected.fetch_error) {
    return (
      <details className="text-[10px] border border-[#fef3c7] rounded">
        <summary className="cursor-pointer py-1.5 px-2 bg-[#fffbeb] text-[#92400e] font-medium">
          🏷️ Detected schema — couldn't fetch live page
        </summary>
        <div className="p-2 text-muted">
          <div><b>URL:</b> {detected.url}</div>
          <div><b>Error:</b> {detected.fetch_error}</div>
          <div className="italic mt-1">Schema detection runs by fetching the public URL of the page. If the page is draft/private, or behind a maintenance plugin, this fails — re-import after publishing.</div>
        </div>
      </details>
    )
  }
  const s = detected.summary || {}
  if (s.no_jsonld) {
    return (
      <details className="text-[10px] border border-[#fef3c7] rounded">
        <summary className="cursor-pointer py-1.5 px-2 bg-[#fffbeb] text-[#92400e] font-medium">
          🏷️ No JSON-LD schema detected on live page
        </summary>
        <div className="p-2 text-muted space-y-1">
          <div>The page fetched cleanly (HTTP {detected.http_status}) but no <code>&lt;script type="application/ld+json"&gt;</code> blocks were found in the HTML.</div>
          <div className="italic">Most SEO plugins (Yoast, Rank Math, AIOSEO) emit schema by default. Either your SEO plugin isn't configured, or it's being stripped before render. The next deploy will auto-inject whatever blocks Posty Posty generates.</div>
        </div>
      </details>
    )
  }
  // Collect types across all blocks for the one-line summary.
  const typeCounts = {}
  for (const b of detected.blocks || []) {
    for (const e of b.entities || []) {
      const t = e.type || 'Unknown'
      typeCounts[t] = (typeCounts[t] || 0) + 1
    }
  }
  const typesSummary = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => n > 1 ? `${t} ×${n}` : t)
    .join(', ')
  const tone = s.error_count > 0 ? 'border-[#fef2f2] bg-[#fef2f2]'
    : s.warning_count > 0 ? 'border-[#fef3c7] bg-[#fffbeb]'
    : 'border-[#dcfce7] bg-[#f0fdf4]'
  return (
    <details className={`text-[10px] border rounded ${tone}`}>
      <summary className="cursor-pointer py-1.5 px-2 font-medium flex items-center gap-2">
        <span>🏷️ Detected schema on live page</span>
        <span className="text-[9px] font-normal text-muted">
          {s.total_entities} entit{s.total_entities === 1 ? 'y' : 'ies'} · {typesSummary || 'no recognized types'}
          {s.error_count > 0 && <span className="text-[#c0392b]"> · {s.error_count} error{s.error_count === 1 ? '' : 's'}</span>}
          {s.warning_count > 0 && s.error_count === 0 && <span className="text-[#92400e]"> · {s.warning_count} warning{s.warning_count === 1 ? '' : 's'}</span>}
        </span>
      </summary>
      <div className="p-2 bg-white border-t border-[#e5e5e5] space-y-2">
        <div className="text-[9px] text-muted">
          Captured by fetching <a href={detected.url} target="_blank" rel="noopener" className="text-[#6C5CE7] underline">{detected.url}</a> at {detected.fetched_at ? new Date(detected.fetched_at).toLocaleString() : 'import time'}. This is what Yoast / Rank Math / etc. is already emitting — the propose + schema flows will avoid duplicating these types.
        </div>
        {(detected.blocks || []).map((b, bi) => (
          <details key={bi} className="border border-[#e5e5e5] rounded" open={detected.blocks.length === 1}>
            <summary className="cursor-pointer py-1 px-2 bg-[#fafafa] text-[10px] font-medium">
              Block #{(b.block_index ?? bi) + 1} — {b.entity_count} entit{b.entity_count === 1 ? 'y' : 'ies'}
            </summary>
            <div className="p-1.5 space-y-1">
              {(b.entities || []).map((e, i) => {
                const okTone = e.ok ? 'text-[#16a34a]' : e.errors?.length > 0 ? 'text-[#c0392b]' : 'text-[#92400e]'
                return (
                  <div key={i} className="text-[10px] border-b border-[#f0f0f0] last:border-0 py-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{e.type || '?'}</span>
                      <span className={`text-[9px] ${okTone}`}>
                        {e.ok ? '✓ valid' : e.errors?.length > 0 ? '⚠ errors' : '⚠ warnings'}
                      </span>
                    </div>
                    {(e.errors || []).map((err, ei) => (
                      <div key={`e-${ei}`} className="pl-3 text-[9px] text-[#c0392b]">• {err}</div>
                    ))}
                    {(e.warnings || []).map((w, wi) => (
                      <div key={`w-${wi}`} className="pl-3 text-[9px] text-muted">• {w}</div>
                    ))}
                  </div>
                )
              })}
            </div>
          </details>
        ))}
      </div>
    </details>
  )
}

// AI Overview citation manager. Operators paste in snippets from
// Google AI Overview / ChatGPT / Perplexity / etc. that quote this
// page, plus the originating query + a source label. The list is
// threaded into every audit + propose run via the page's strategy
// context — Claude is told "PROTECT THIS LANGUAGE" so rewrites
// preserve the concepts + distinctive phrasing earning the
// citation. Whole array is sent on every save; server validates +
// caps each row.
const CITATION_SOURCES = [
  { value: 'google-ai-overview', label: 'Google AI Overview' },
  { value: 'chatgpt',            label: 'ChatGPT' },
  { value: 'perplexity',         label: 'Perplexity' },
  { value: 'bing-copilot',       label: 'Bing Copilot' },
  { value: 'claude',             label: 'Claude' },
  { value: 'gemini',             label: 'Gemini' },
  { value: 'you-com',            label: 'You.com' },
  { value: 'other',              label: 'Other' },
]
function sourceLabel(v) {
  const s = CITATION_SOURCES.find(x => x.value === v)
  return s ? s.label : (v || 'Unknown')
}
// Per-page schema allowlist. The operator picks which Schema.org
// types this specific page is allowed to emit; the schema generator
// + deploy filter both enforce the list. null/empty = no restriction
// (Claude decides — original behavior). Collapsed by default; loads
// catalog + current setting on first expand to keep workspace open
// cheap.
function SchemaTypesAllowlist({ landingPageId }) {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [catalog, setCatalog] = useState([])
  const [selected, setSelected] = useState(null)
  const [original, setOriginal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  // Reset on page switch. PageWorkspace now has a key= prop that
  // forces full re-mount on landing_page_id change, so this useEffect
  // is mostly belt-and-suspenders — covers the edge case where the
  // component stays mounted (e.g. parent doesn't pass the key or
  // changes the prop without re-mounting).
  useEffect(() => {
    setLoaded(false)
    setSelected(null)
    setOriginal(null)
    setError(null)
    setSaved(false)
    setOpen(false)
  }, [landingPageId])

  const load = async () => {
    try {
      const [cat, mine] = await Promise.all([
        api.getSchemaTypesCatalog(),
        api.getLandingPageSchemaTypes(landingPageId),
      ])
      setCatalog(cat?.types || [])
      const initial = Array.isArray(mine?.schema_types) ? mine.schema_types : null
      setSelected(initial)
      setOriginal(initial)
      setLoaded(true)
    } catch (e) {
      setError(e?.message || String(e))
    }
  }

  const handleToggle = () => {
    setOpen(o => {
      if (!o && !loaded) load()
      return !o
    })
  }

  const toggle = (type) => {
    setSelected(prev => {
      const cur = Array.isArray(prev) ? new Set(prev) : new Set()
      if (cur.has(type)) cur.delete(type)
      else cur.add(type)
      return Array.from(cur)
    })
  }

  const setNone = () => setSelected(null)

  const save = async () => {
    if (busy) return
    setBusy(true); setError(null); setSaved(false)
    try {
      const payload = Array.isArray(selected) && selected.length > 0 ? selected : null
      await api.setLandingPageSchemaTypes(landingPageId, payload)
      setOriginal(payload)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const isDirty = JSON.stringify(selected) !== JSON.stringify(original)

  const groups = useMemo(() => {
    const g = {}
    for (const t of catalog) {
      const k = t.group || 'other'
      if (!g[k]) g[k] = []
      g[k].push(t)
    }
    return g
  }, [catalog])

  const groupLabels = {
    page: 'Page envelope',
    list: 'Lists',
    nav: 'Navigation',
    content: 'Content',
    venue: 'Venue / commercial',
    event: 'Event',
    commerce: 'E-commerce',
    identity: 'Brand identity',
    other: 'Other',
  }

  return (
    <details open={open} className="border border-[#6C5CE7]/40 rounded bg-[#fafbff]">
      <summary
        onClick={(e) => { e.preventDefault(); handleToggle() }}
        className="cursor-pointer py-2 px-3 flex items-center gap-2"
      >
        <span className="text-[11px] font-medium text-[#6C5CE7]">🏷️ Page schema allowlist</span>
        <span className="text-[9px] text-muted">
          Explicit per-page Schema.org @type allowlist. Stops Claude from guessing — schema-gen + deploy both enforce.
        </span>
        <span className="flex-1" />
        {loaded && (
          <span className="text-[9px] text-muted">
            {Array.isArray(original) && original.length > 0
              ? `${original.length} type(s) allowed`
              : 'No restriction'}
          </span>
        )}
        <span className="text-[10px] text-muted">{open ? '▾' : '▸'}</span>
      </summary>
      {open && (
        <div className="p-3 pt-0 space-y-2">
          {!loaded && !error && (
            <div className="text-[10px] text-muted italic">Loading…</div>
          )}
          {error && (
            <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>
          )}
          {loaded && (
            <>
              <div className="text-[10px] text-muted">
                Pick which types this page is allowed to emit. Schema generator drops anything outside the list — even if Claude thinks it fits. Empty = no restriction (Claude decides).
              </div>
              <div className="space-y-2">
                {Object.entries(groups).map(([groupKey, items]) => (
                  <div key={groupKey} className="border border-[#e5e5e5] rounded bg-white p-2">
                    <div className="text-[10px] font-semibold text-[#6C5CE7] mb-1">{groupLabels[groupKey] || groupKey}</div>
                    <div className="space-y-1">
                      {items.map(t => {
                        const isChecked = Array.isArray(selected) && selected.includes(t.type)
                        return (
                          <label key={t.type} className="flex items-start gap-2 text-[10px] cursor-pointer hover:bg-[#fafafa] rounded p-1">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggle(t.type)}
                              className="mt-0.5 cursor-pointer"
                            />
                            <div className="flex-1">
                              <span className="font-mono text-[#6C5CE7]">{t.type}</span>
                              <span className="ml-2 text-muted">{t.note}</span>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={setNone}
                  className="text-[9px] py-1 px-2 bg-white border border-[#e5e5e5] text-muted rounded cursor-pointer"
                  title="Clear the allowlist — no restriction, Claude decides which types fit."
                >Clear (no restriction)</button>
                {saved && <span className="text-[9px] text-[#16a34a]">✓ Saved</span>}
                <span className="flex-1" />
                <span className="text-[9px] text-muted">
                  {Array.isArray(selected) && selected.length > 0
                    ? `${selected.length} type(s) selected`
                    : 'No types selected (Claude will decide on next regen)'}
                </span>
                <button
                  onClick={save}
                  disabled={busy || !isDirty}
                  className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
                >{busy ? 'Saving…' : 'Save allowlist'}</button>
              </div>
              <div className="text-[9px] text-muted italic">
                After saving: click <b>🏷️ Re-generate</b> in the Schema.org structured data panel below to regenerate schema honoring the new allowlist. No need to re-run propose — only the schema regenerates.
              </div>
            </>
          )}
        </div>
      )}
    </details>
  )
}

function AiCitationsCard({ landingPageId, initial }) {
  const [citations, setCitations] = useState(Array.isArray(initial) ? initial : [])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  // Add-form state. Kept inline (not a modal) since the workspace
  // is already a long scroll — modals would compound the awkward.
  const [addOpen, setAddOpen] = useState(false)
  const [draftQuery, setDraftQuery] = useState('')
  const [draftSnippet, setDraftSnippet] = useState('')
  const [draftSource, setDraftSource] = useState('google-ai-overview')
  const [draftNotes, setDraftNotes] = useState('')

  // Re-sync local state when the operator switches pages — initial
  // value is per-page, not session-wide.
  useEffect(() => {
    setCitations(Array.isArray(initial) ? initial : [])
    setAddOpen(false)
    setDraftQuery(''); setDraftSnippet(''); setDraftSource('google-ai-overview'); setDraftNotes('')
  }, [landingPageId, initial])

  const persist = async (next) => {
    setSaving(true); setError(null); setSaved(false)
    try {
      const r = await api.setLandingPageAiCitations(landingPageId, next)
      setCitations(r.ai_citations || [])
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const addOne = async () => {
    if (!draftSnippet.trim()) {
      setError('Snippet is required (the content to protect). Query is optional — leave blank for "protect regardless of query".')
      return
    }
    const next = [
      ...citations,
      {
        query: draftQuery.trim(), // optional — empty string OK
        snippet: draftSnippet.trim(),
        source: draftSource,
        notes: draftNotes.trim() || undefined,
        captured_at: new Date().toISOString(),
      },
    ]
    await persist(next)
    setAddOpen(false)
    setDraftQuery(''); setDraftSnippet(''); setDraftNotes(''); setDraftSource('google-ai-overview')
  }

  const removeOne = async (id) => {
    if (!confirm('Remove this citation? Claude will no longer be told to preserve this language on future runs.')) return
    await persist(citations.filter(c => c.id !== id))
  }

  return (
    <div className="bg-[#eef2ff] border border-[#6366f1]/30 rounded p-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium text-[#4338ca]">🤖 AI Overview citations to preserve</span>
        <span className="text-[9px] text-muted">
          ({citations.length}) Quoted by Google AI, ChatGPT, etc. → Claude will be told to protect this language.
        </span>
        <div className="flex-1" />
        {saving && <span className="text-[9px] text-muted">Saving…</span>}
        {saved && <span className="text-[9px] text-[#16a34a]">✓ Saved</span>}
        <button
          onClick={() => setAddOpen(o => !o)}
          className="text-[10px] py-0.5 px-2 bg-[#4338ca] text-white border-none rounded cursor-pointer"
        >{addOpen ? 'Cancel' : '+ Add citation'}</button>
      </div>

      {addOpen && (
        <div className="bg-white border border-[#6366f1]/30 rounded p-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <label className="text-[9px] text-muted w-14">Source</label>
            <select
              value={draftSource}
              onChange={e => setDraftSource(e.target.value)}
              className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
            >
              {CITATION_SOURCES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-[9px] text-muted w-14">Query <span className="opacity-60">(optional)</span></label>
            <input
              type="text"
              value={draftQuery}
              onChange={e => setDraftQuery(e.target.value)}
              placeholder='e.g. "What is make and take" — or leave blank to protect this content regardless of query'
              className="flex-1 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1.5 outline-none focus:border-[#4338ca]"
            />
          </div>
          <div>
            <label className="text-[9px] text-muted block mb-0.5">Pasted snippet from the AI answer (the part that came from this page)</label>
            <textarea
              value={draftSnippet}
              onChange={e => setDraftSnippet(e.target.value)}
              rows={5}
              placeholder='Paste the AI Overview text here, e.g.: "A make-and-take is a hands-on workshop, class, or drop-in event where participants create a project with provided supplies and take their finished item home that same day..."'
              className="w-full text-[10px] border border-[#e5e5e5] rounded p-1.5 outline-none focus:border-[#4338ca] resize-y font-sans"
            />
          </div>
          <div>
            <label className="text-[9px] text-muted block mb-0.5">Notes (optional — context for the operator)</label>
            <input
              type="text"
              value={draftNotes}
              onChange={e => setDraftNotes(e.target.value)}
              placeholder='e.g. "Captured 2026-05-16, position #1 in AI Overview, source link cited"'
              className="w-full text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1.5 outline-none focus:border-[#4338ca]"
            />
          </div>
          <div className="flex items-center justify-end gap-1.5 pt-1">
            <button
              onClick={() => setAddOpen(false)}
              className="text-[10px] py-1 px-2 bg-white border border-[#e5e5e5] text-ink rounded cursor-pointer"
            >Cancel</button>
            <button
              onClick={addOne}
              disabled={saving || !draftQuery.trim() || !draftSnippet.trim()}
              className="text-[10px] py-1 px-3 bg-[#4338ca] text-white border-none rounded cursor-pointer disabled:opacity-50"
            >Save citation</button>
          </div>
        </div>
      )}

      {error && <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>}

      {citations.length === 0 && !addOpen && (
        <div className="text-[10px] text-muted italic">
          No citations yet. When you find an AI Overview / ChatGPT / Perplexity answer that quotes this page, paste it in here so Claude protects that language on future rewrites.
        </div>
      )}

      {citations.length > 0 && (
        <div className="space-y-1">
          {citations.map(c => (
            <details key={c.id} className="bg-white border border-[#e5e5e5] rounded">
              <summary className="cursor-pointer py-1.5 px-2 text-[10px] flex items-center gap-2">
                <span className="text-[9px] py-0.5 px-1.5 rounded bg-[#eef2ff] text-[#4338ca] font-medium">
                  {sourceLabel(c.source)}
                </span>
                <span className="font-medium truncate flex-1">"{c.query}"</span>
                <span className="text-[9px] text-muted flex-shrink-0">
                  {c.captured_at ? new Date(c.captured_at).toLocaleDateString() : ''}
                </span>
              </summary>
              <div className="p-2 border-t border-[#f0f0f0] space-y-1.5">
                <div className="text-[10px] whitespace-pre-wrap bg-[#fafafa] border-l-2 border-[#6366f1] px-2 py-1.5 italic">
                  {c.snippet}
                </div>
                {c.notes && <div className="text-[9px] text-muted"><b>Notes:</b> {c.notes}</div>}
                <div className="flex items-center justify-end">
                  <button
                    onClick={() => removeOne(c.id)}
                    disabled={saving}
                    className="text-[9px] py-0.5 px-1.5 bg-white border border-[#c0392b] text-[#c0392b] rounded cursor-pointer disabled:opacity-50"
                  >Remove</button>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}

      <div className="text-[9px] text-muted italic">
        Tip: when you Google a brand-relevant query and see an AI Overview that quotes this page, paste the whole AI answer above. Claude reads these on every audit + propose run and is explicitly told to preserve the concepts + distinctive phrasing that earned the citation.
      </div>
    </div>
  )
}

function GscBlock({ landingPageId, pageUrl }) {
  const [status, setStatus] = useState(null) // { connected, site_url } once loaded
  const [statusBusy, setStatusBusy] = useState(true)
  const [data, setData] = useState(null)
  const [fetchBusy, setFetchBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sites, setSites] = useState(null)
  const [sitesBusy, setSitesBusy] = useState(false)
  const [connectBusy, setConnectBusy] = useState(false)

  // Initial status check.
  useEffect(() => {
    let cancelled = false
    setStatusBusy(true)
    api.getGscStatus()
      .then(s => { if (!cancelled) setStatus(s) })
      .catch(() => { if (!cancelled) setStatus({ connected: false }) })
      .finally(() => { if (!cancelled) setStatusBusy(false) })
    return () => { cancelled = true }
  }, [landingPageId])

  // Clear cached data when the active landing page changes —
  // metrics are per-URL and we don't want to show stale data.
  useEffect(() => { setData(null); setError(null) }, [pageUrl])

  const handleConnect = async () => {
    if (connectBusy) return
    setConnectBusy(true); setError(null)
    try {
      const { url } = await api.getGscAuthorizeUrl()
      // Pop-up window so the operator stays on the workspace.
      // After Google redirects to our callback (which closes the
      // popup), we re-fetch status to flip the UI.
      const popup = window.open(url, 'gsc-auth', 'width=560,height=720')
      // Poll for popup close, then re-check status.
      const poll = setInterval(async () => {
        if (popup.closed) {
          clearInterval(poll)
          try {
            const s = await api.getGscStatus()
            setStatus(s)
            if (s.connected) {
              // Auto-load site picker for convenience.
              loadSites()
            }
          } catch {}
          setConnectBusy(false)
        }
      }, 750)
    } catch (e) {
      setError(e?.message || String(e))
      setConnectBusy(false)
    }
  }

  const loadSites = async () => {
    if (sitesBusy) return
    setSitesBusy(true); setError(null)
    try {
      const r = await api.listGscSites()
      setSites(r.sites || [])
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setSitesBusy(false)
    }
  }

  const handlePickSite = async (siteUrl) => {
    try {
      const r = await api.setGscSite(siteUrl)
      setStatus(s => ({ ...s, site_url: r.site_url }))
      setSites(null)
    } catch (e) {
      setError(e?.message || String(e))
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Google Search Console for this tenant? You can reconnect any time.')) return
    try {
      await api.disconnectGsc()
      setStatus({ connected: false })
      setData(null)
      setSites(null)
    } catch (e) {
      setError(e?.message || String(e))
    }
  }

  const handleFetch = async () => {
    if (fetchBusy || !landingPageId) return
    setFetchBusy(true); setError(null)
    try {
      const r = await api.fetchLandingPageGsc(landingPageId)
      setData(r)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setFetchBusy(false)
    }
  }

  // Loading / states
  if (statusBusy) return null
  // Sites picker view
  const showingSitePicker = Array.isArray(sites)

  return (
    <div className="bg-white border border-[#16a34a]/30 rounded p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium text-[#16a34a]">📈 Search Console</span>
        <span className="text-[9px] text-muted">Real Google performance — impressions, clicks, position, top queries.</span>
        <div className="flex-1" />
        {status?.connected ? (
          <>
            {status.site_url ? (
              <span className="text-[9px] font-mono text-muted truncate max-w-[260px]" title={status.site_url}>{status.site_url}</span>
            ) : null}
            <button
              onClick={loadSites}
              disabled={sitesBusy}
              className="text-[9px] py-0.5 px-1.5 bg-white border border-[#e5e5e5] rounded cursor-pointer text-muted"
              title="Change which verified Search Console property to read from"
            >{sitesBusy ? 'Loading…' : 'Change site'}</button>
            <button
              onClick={handleDisconnect}
              className="text-[9px] py-0.5 px-1.5 bg-white border border-[#c0392b] text-[#c0392b] rounded cursor-pointer"
              title="Disconnect GSC for this tenant"
            >Disconnect</button>
          </>
        ) : (
          <button
            onClick={handleConnect}
            disabled={connectBusy}
            className="text-[10px] py-1 px-2 bg-[#16a34a] text-white border-none rounded cursor-pointer disabled:opacity-50"
            title="Authorize Make & Take to read your Google Search Console data (read-only). Stays separate from any existing Google Business Profile connection."
          >{connectBusy ? 'Connecting…' : '🔗 Connect Search Console'}</button>
        )}
      </div>

      {error && <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>}

      {/* Site picker (after connect, or via "Change site") */}
      {showingSitePicker && (
        <div className="bg-[#f0fdf4] border border-[#16a34a]/20 rounded p-2 space-y-1">
          <div className="text-[10px] font-medium">Pick the GSC property for this site</div>
          {sites.length === 0 ? (
            <div className="text-[10px] text-muted italic">No verified GSC properties found on this Google account. Verify your site in Search Console first, then come back.</div>
          ) : (
            <div className="space-y-1">
              {sites.map(s => (
                <button
                  key={s.siteUrl}
                  onClick={() => handlePickSite(s.siteUrl)}
                  className={`w-full flex items-center gap-2 text-[10px] py-1 px-2 border rounded cursor-pointer text-left
                    ${s.siteUrl === status?.site_url ? 'bg-[#16a34a]/10 border-[#16a34a]' : 'bg-white border-[#e5e5e5] hover:bg-[#fafafa]'}`}
                >
                  <span className="font-mono flex-1 truncate">{s.siteUrl}</span>
                  <span className="text-[8px] text-muted uppercase">{s.permissionLevel?.replace('site', '')}</span>
                  {s.siteUrl === status?.site_url && <span className="text-[8px] text-[#16a34a] font-bold">SELECTED</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fetch + display */}
      {status?.connected && status?.site_url && pageUrl && !showingSitePicker && (
        <>
          <div className="flex items-center gap-2">
            <button
              onClick={handleFetch}
              disabled={fetchBusy}
              className="text-[10px] py-1 px-2 bg-white border border-[#16a34a] text-[#16a34a] rounded cursor-pointer disabled:opacity-50"
              title="Fetches last 28 days vs the prior 28 days for this page's URL. ~3-8 seconds."
            >{fetchBusy ? 'Fetching…' : data ? '🔄 Refresh data' : '📥 Pull GSC data'}</button>
            {data?.fetched_at && (
              <span className="text-[9px] text-muted">Fetched {new Date(data.fetched_at).toLocaleString()} · {data.windows?.current?.start} → {data.windows?.current?.end}</span>
            )}
          </div>
          {data && <GscMetrics data={data} />}
        </>
      )}
      {status?.connected && !status?.site_url && !showingSitePicker && (
        <div className="text-[10px] text-muted italic">No GSC property selected yet. Click "Change site" above to pick one.</div>
      )}
      {status?.connected && status?.site_url && !pageUrl && (
        <div className="text-[10px] text-muted italic">This page has no URL yet — re-import from WordPress so GSC has a URL to query.</div>
      )}
    </div>
  )
}

function GscMetrics({ data }) {
  const cur = data?.current || {}
  const delta = data?.delta || {}
  const fmtNum = (n) => (n == null ? '—' : Math.round(n).toLocaleString())
  const fmtPct = (n) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`)
  const fmtPos = (n) => (n == null ? '—' : n.toFixed(1))
  const deltaTone = (n, betterWhenNegative = false) => {
    if (n == null || n === 0) return 'text-muted'
    if (betterWhenNegative) return n < 0 ? 'text-[#16a34a]' : 'text-[#c0392b]'
    return n > 0 ? 'text-[#16a34a]' : 'text-[#c0392b]'
  }
  const deltaArrow = (n, betterWhenNegative = false) => {
    if (n == null || n === 0) return '·'
    if (betterWhenNegative) return n < 0 ? '↓' : '↑'
    return n > 0 ? '↑' : '↓'
  }
  const sign = (n) => n > 0 ? `+${Math.round(n).toLocaleString()}` : Math.round(n).toLocaleString()
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
        <div className="bg-[#f0fdf4] border border-[#16a34a]/20 rounded p-2">
          <div className="text-muted">Impressions (28d)</div>
          <div className="text-[16px] font-semibold">{fmtNum(cur.impressions)}</div>
          <div className={`text-[9px] ${deltaTone(delta.impressions)}`}>
            {deltaArrow(delta.impressions)} {sign(delta.impressions)} vs prior 28d
          </div>
        </div>
        <div className="bg-[#f0fdf4] border border-[#16a34a]/20 rounded p-2">
          <div className="text-muted">Clicks (28d)</div>
          <div className="text-[16px] font-semibold">{fmtNum(cur.clicks)}</div>
          <div className={`text-[9px] ${deltaTone(delta.clicks)}`}>
            {deltaArrow(delta.clicks)} {sign(delta.clicks)} vs prior 28d
          </div>
        </div>
        <div className="bg-[#f0fdf4] border border-[#16a34a]/20 rounded p-2">
          <div className="text-muted">CTR</div>
          <div className="text-[16px] font-semibold">{fmtPct(cur.ctr)}</div>
          <div className={`text-[9px] ${deltaTone(delta.ctr_pp)}`}>
            {deltaArrow(delta.ctr_pp)} {delta.ctr_pp == null ? '—' : `${delta.ctr_pp > 0 ? '+' : ''}${delta.ctr_pp.toFixed(2)} pp`}
          </div>
        </div>
        <div className="bg-[#f0fdf4] border border-[#16a34a]/20 rounded p-2">
          <div className="text-muted">Avg position</div>
          <div className="text-[16px] font-semibold">{fmtPos(cur.position)}</div>
          <div className={`text-[9px] ${deltaTone(delta.position, true)}`}>
            {deltaArrow(delta.position, true)} {delta.position == null ? '—' : `${delta.position > 0 ? '+' : ''}${delta.position.toFixed(1)}`}
            <span className="text-muted ml-1">(lower = better)</span>
          </div>
        </div>
      </div>
      {Array.isArray(cur.top_queries) && cur.top_queries.length > 0 && (
        <details className="text-[10px] border border-[#e5e5e5] rounded">
          <summary className="cursor-pointer py-1.5 px-2 bg-[#fafafa] font-medium">
            Top {cur.top_queries.length} queries driving this page (last 28d)
          </summary>
          <div className="p-2 space-y-0.5">
            {cur.top_queries.map((q, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5 border-b border-[#f0f0f0] last:border-0">
                <span className="text-muted font-mono w-5 text-right">{i + 1}.</span>
                <span className="flex-1 truncate">{q.query}</span>
                {q.new_this_period && <span className="text-[8px] py-0.5 px-1 bg-[#dcfce7] text-[#16a34a] rounded">NEW</span>}
                <span className="font-mono text-muted w-12 text-right" title="Impressions">{fmtNum(q.impressions)}</span>
                <span className="font-mono text-muted w-10 text-right" title="Clicks">{fmtNum(q.clicks)}</span>
                <span className="font-mono text-muted w-10 text-right" title="Avg position">{fmtPos(q.position)}</span>
              </div>
            ))}
            <div className="text-[8px] text-muted italic pt-1">Columns: impressions · clicks · avg position. Look for "NEW" queries — these are searches your page wasn't getting before; lean into them if they match your intent.</div>
          </div>
        </details>
      )}
    </div>
  )
}

// Tenant-level CTA tracking settings — the one-time install of
// the JS snippet operators paste into WordPress. Collapsed by
// default; on expand we fetch the snippet + last-28d count and
// surface a clear "installed / not installed" indicator. After
// the operator confirms install, they shouldn't need to revisit
// this card — per-page click counts live inside each workspace.
function CtaSettingsCard() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!open || data) return
    setLoading(true); setError(null)
    api.getCtaSettings()
      .then(r => setData(r))
      .catch(e => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [open, data])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch (e) {
      // Fallback: prompt the user to copy manually.
      alert('Copy failed — select the snippet text and copy with Cmd/Ctrl+C.')
    }
  }
  const refresh = () => { setData(null) }
  return (
    <details onToggle={e => setOpen(e.target.open)} className="bg-white border border-[#e5e5e5] rounded">
      <summary className="cursor-pointer py-2 px-3 text-[11px] flex items-center gap-2">
        <span className="font-medium">🎯 CTA tracking</span>
        {data && (
          <span className={`text-[9px] py-0.5 px-1.5 rounded ${data.installed ? 'bg-[#dcfce7] text-[#16a34a]' : 'bg-[#fef3c7] text-[#92400e]'}`}>
            {data.installed ? `✓ Installed · ${data.clicks_28d} clicks (28d)` : 'Not installed yet'}
          </span>
        )}
        <span className="flex-1" />
        <span className="text-[9px] text-muted">Paste once into WordPress to capture link clicks.</span>
      </summary>
      <div className="p-3 border-t border-[#f0f0f0] space-y-2">
        {loading && <div className="text-[10px] text-muted italic">Loading…</div>}
        {error && <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>}
        {data && (
          <>
            <div className="text-[10px] text-muted">
              On every page deploy we tag each link with a stable <code>data-fldy-cta</code> attribute. Paste this snippet ONCE into WordPress (Custom HTML block in the footer, a header/footer plugin, or your theme's <code>functions.php</code> as a <code>wp_footer</code> hook) and we'll capture clicks on every tagged link across the whole site. No further setup per page.
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={copy}
                className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer"
              >{copied ? '✓ Copied' : '📋 Copy snippet'}</button>
              <button
                onClick={refresh}
                className="text-[10px] py-1 px-2 bg-white border border-[#e5e5e5] text-ink rounded cursor-pointer"
                title="Re-check whether clicks have started arriving"
              >↻ Re-check install</button>
              {data.last_click_at && (
                <span className="text-[9px] text-muted">Last click: {new Date(data.last_click_at).toLocaleString()}</span>
              )}
            </div>
            <pre className="text-[9px] bg-[#0f172a] text-[#e2e8f0] rounded p-2 overflow-x-auto whitespace-pre font-mono leading-snug max-h-[280px]">
{data.snippet}
            </pre>
            <div className="text-[9px] text-muted">
              <b>Privacy:</b> the snippet sends the clicked link's id + href + anchor text + your page URL + referrer. The end-user's IP is hashed server-side (not stored in plaintext) and used only for rate-limiting. No cookies, no fingerprinting.
            </div>
          </>
        )}
      </div>
    </details>
  )
}

// Per-page CTA click counts. Lazy-loaded on expand. Each anchor in
// the page's current body shows: clicks (28d), last clicked at,
// destination href + anchor text. "Orphan" cta_ids (CTAs that were
// in a prior version + are no longer in the current body but still
// had clicks) get a separate row so the operator can see historical
// pull even after a restructure.
function CtaStatsBlock({ landingPageId }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!open || data) return
    setLoading(true); setError(null)
    api.getCtaStats(landingPageId)
      .then(r => setData(r))
      .catch(e => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [open, data, landingPageId])
  const refresh = () => { setData(null) }
  return (
    <details onToggle={e => setOpen(e.target.open)} className="bg-white border border-[#e5e5e5] rounded">
      <summary className="cursor-pointer py-2 px-3 text-[11px] flex items-center gap-2">
        <span className="font-medium">📊 CTA click stats (28d)</span>
        {data && (
          <span className="text-[9px] text-muted">
            {data.total_clicks_28d} total click{data.total_clicks_28d === 1 ? '' : 's'} across {data.ctas.filter(c => c.in_current_version).length} link{data.ctas.filter(c => c.in_current_version).length === 1 ? '' : 's'}
          </span>
        )}
        <span className="flex-1" />
        <span className="text-[9px] text-muted">Which links on this page are working.</span>
      </summary>
      <div className="p-2 border-t border-[#f0f0f0] space-y-2">
        {loading && <div className="text-[10px] text-muted italic">Loading…</div>}
        {error && <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>}
        {data && (
          <>
            <div className="flex items-center justify-end">
              <button
                onClick={refresh}
                className="text-[9px] py-0.5 px-1.5 bg-white border border-[#e5e5e5] text-ink rounded cursor-pointer"
              >↻ Refresh</button>
            </div>
            {data.ctas.length === 0 ? (
              <div className="text-[10px] text-muted italic">No links on this page yet. Deploy a version with at least one anchor to start tracking.</div>
            ) : (
              <div className="space-y-0.5">
                {/* Current-version anchors first, ordered by document position. */}
                {data.ctas.filter(c => c.in_current_version).map(c => {
                  const tone = c.clicks_28d === 0 ? 'bg-[#fafafa] text-muted'
                    : c.clicks_28d < 5 ? 'bg-[#fff7ed] text-[#92400e]'
                    : 'bg-[#dcfce7] text-[#166534]'
                  return (
                    <div key={c.cta_id || `pos-${c.position}`} className="flex items-center gap-2 text-[10px] py-1 px-1.5 border-b border-[#f0f0f0] last:border-0">
                      <span className="text-muted font-mono w-5 text-right">{c.position}.</span>
                      <div className="flex-1 min-w-0">
                        <div className="truncate"><b>{c.anchor || <span className="italic text-muted">(no text)</span>}</b></div>
                        <div className="text-[9px] text-muted font-mono truncate">→ {c.href || '(no href)'}</div>
                      </div>
                      <span className={`text-[9px] py-0.5 px-1.5 rounded font-mono ${tone}`}>
                        {c.clicks_28d}
                      </span>
                      {c.last_clicked_at && (
                        <span className="text-[8px] text-muted w-20 text-right" title={new Date(c.last_clicked_at).toLocaleString()}>
                          {timeAgoShort(c.last_clicked_at)}
                        </span>
                      )}
                    </div>
                  )
                })}
                {/* Orphans: clicks recorded against cta_ids that are no
                    longer in the current body. Surface separately so
                    they don't masquerade as "current page is working"
                    signal. */}
                {data.ctas.some(c => !c.in_current_version) && (
                  <details className="pt-1 border-t border-dashed border-[#e5e5e5]">
                    <summary className="cursor-pointer text-[9px] text-muted py-1">
                      Historical CTAs (no longer in current body) — {data.ctas.filter(c => !c.in_current_version).length}
                    </summary>
                    <div className="pl-2 pt-1 space-y-0.5">
                      {data.ctas.filter(c => !c.in_current_version).map(c => (
                        <div key={c.cta_id} className="flex items-center gap-2 text-[10px] py-0.5 text-muted">
                          <span className="font-mono">{c.cta_id}</span>
                          <span className="flex-1" />
                          <span className="font-mono">{c.clicks_28d} clicks</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </details>
  )
}

// Compact relative-time formatter — used by CTA stats. Matches
// "5m / 3h / 2d / 12d" style for tight columns. Falls back to
// the absolute date for anything older than 28 days (which
// shouldn't happen given the 28d window, but defensive).
function timeAgoShort(iso) {
  try {
    const d = new Date(iso).getTime()
    const diffMs = Date.now() - d
    const m = Math.floor(diffMs / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const days = Math.floor(h / 24)
    if (days < 28) return `${days}d ago`
    return new Date(iso).toLocaleDateString()
  } catch { return '' }
}

// Seasonal awareness banner. Compact strip listing upcoming
// shopping/seasonal moments — newest first — with matched-page
// chips that jump straight into the workspace. The BE only
// surfaces seasons that are both inside the 90-day window AND past
// their lead-time threshold, so the list is naturally short (1-3
// items most of the year).
// Tenant-wide editorial policy editor. Collapsed by default so it
// doesn't dominate the Pages header. The policy auto-prepends to
// every audit + propose call alongside per-page strategy hints —
// it's where cross-cutting rules (brand separation, neutrality on
// causes, voice discipline) live so they don't have to be re-typed
// per page. Loads lazily on first expand to keep the initial
// render light.
// Per-page workflow wizard. 5-step tracker showing where the page
// is in its lifecycle. Each step shows status (done/never/stale)
// + last-action timestamp + a button to scroll to the relevant
// panel for taking that action. Steps can be done in any order
// across multiple sessions — the wizard reads state from BE-
// persisted data, not in-session state alone.
function WorkflowWizard({ page, audit, proposal, history, recoveredProposal }) {
  // Step 1 — Audit. Done if last_audited_at on the page row OR an
  // audit was run this session.
  const auditDate = audit?.created_at || page?.last_audited_at || null
  const hasAudit = !!auditDate
  const isAuditStale = hasAudit && (Date.now() - new Date(auditDate).getTime() > 30 * 24 * 60 * 60 * 1000)

  // Step 2 — Proposal. Done if a proposal exists in-session OR a
  // recovered ai-suggested version exists.
  const proposalDate = proposal?.created_at || recoveredProposal?.created_at || null
  const hasProposal = !!proposalDate

  // Step 3 — AI score. Read from recoveredProposal.ai_detection
  // (which surfaces the latest version's check).
  const aiDetection = recoveredProposal?.ai_detection || null
  const hasAi = !!aiDetection
  const aiScore = aiDetection?.score
  const aiActionable = aiDetection?.actionable_flagged_count

  // Step 4 — Voice check.
  const voiceCheck = recoveredProposal?.voice_check || null
  const hasVoice = !!voiceCheck
  const voiceScore = voiceCheck?.overall_score
  const voiceVerdict = voiceCheck?.verdict
  const voiceActionable = voiceCheck?.actionable_drift_count

  // Step 5 — Deploy. Done if last_deployed_at OR a deployed_at on
  // the latest version. "Stale" if deployed BEFORE the last audit
  // (meaning audit findings haven't been applied to live yet).
  const deployDate = page?.last_deployed_at || recoveredProposal?.deployed_at || null
  const hasDeploy = !!deployDate
  const isDeployStale = hasDeploy && hasAudit &&
    new Date(deployDate) < new Date(auditDate)

  // Determine the recommended next step. Earliest unfinished step
  // in the standard flow wins. Refinement step (re-propose with
  // feedback) is recommended when checks have been run AND scores
  // indicate the content needs work.
  const wantsRefine = (hasAi && aiActionable > 0) || (hasVoice && voiceScore != null && voiceScore < 65)
  let next = 'audit'
  if (hasAudit) {
    if (!hasProposal) next = 'proposal'
    else if (!hasAi) next = 'ai-check'
    else if (!hasVoice) next = 'voice-check'
    else if (wantsRefine) next = 'refine'
    else if (!hasDeploy || isDeployStale) next = 'deploy'
    else next = 'complete'
  }

  // Helpers for rendering each step.
  const fmtShort = (d) => d ? new Date(d).toLocaleDateString() : null
  const stepCardCls = (key) => {
    const isNext = next === key
    return `flex-1 min-w-[140px] border rounded p-2 ${
      isNext ? 'border-[#6C5CE7] bg-[#f5f3ff] shadow-sm' : 'border-[#e5e5e5] bg-white'
    }`
  }
  const statusBadge = (state, color = 'gray') => {
    const cls = {
      done:    'bg-[#dcfce7] text-[#16a34a]',
      stale:   'bg-[#fff7ed] text-[#d97706]',
      never:   'bg-[#f0f0f0] text-muted',
      next:    'bg-[#6C5CE7] text-white',
      warning: 'bg-[#fef2f2] text-[#c0392b]',
    }[state] || 'bg-[#f0f0f0] text-muted'
    return cls
  }

  // Each step's status icon + scroll-target id (we use HTML id
  // anchors so the click handler just sets window.location.hash
  // OR scrolls into view). For simplicity, we use a data-anchor
  // attribute matching panel ids set below.
  const scrollTo = (anchor) => {
    if (typeof document === 'undefined') return
    // Try primary anchor first, then any element listing this
    // anchor in its data-workflow-anchor-secondary attribute (e.g.
    // ai-check, voice-check, refine all live inside the proposal
    // panel via ProposalDiff).
    let el = document.querySelector(`[data-workflow-anchor="${anchor}"]`)
    if (!el) {
      const candidates = document.querySelectorAll('[data-workflow-anchor-secondary]')
      for (const c of candidates) {
        const list = (c.getAttribute('data-workflow-anchor-secondary') || '').split(/\s+/)
        if (list.includes(anchor)) { el = c; break }
      }
    }
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.style.transition = 'box-shadow 0.4s ease'
      el.style.boxShadow = '0 0 0 3px rgba(108,92,231,0.4)'
      setTimeout(() => { el.style.boxShadow = '' }, 1500)
    }
  }

  const Step = ({ num, label, status, statusText, date, anchor, nextHint }) => {
    const isNext = next === anchor
    return (
      <button
        onClick={() => scrollTo(anchor)}
        className={`${stepCardCls(anchor)} text-left cursor-pointer hover:shadow-sm transition-shadow`}
        title={isNext ? `Recommended next step. Click to jump to the section.` : `Click to jump to the ${label} section.`}
      >
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`text-[9px] py-0.5 px-1.5 rounded font-bold ${isNext ? statusBadge('next') : statusBadge(status)}`}>
            {num}
          </span>
          <span className="text-[10px] font-medium flex-1 truncate">{label}</span>
          {isNext && <span className="text-[8px] text-[#6C5CE7] font-bold">NEXT</span>}
        </div>
        <div className={`text-[9px] ${
          status === 'done' ? 'text-[#16a34a]'
          : status === 'stale' ? 'text-[#d97706]'
          : status === 'warning' ? 'text-[#c0392b]'
          : 'text-muted'
        }`}>{statusText}</div>
        {date && <div className="text-[8px] text-muted mt-0.5">{date}</div>}
      </button>
    )
  }

  return (
    <div className="bg-[#fafbff] border border-[#6C5CE7]/30 rounded p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-[#6C5CE7]">🪄 Page workflow</span>
        <span className="text-[9px] text-muted">Click any step to jump to its section. Steps can be done in any order across sessions.</span>
        <div className="flex-1" />
        {next === 'complete' && (
          <span className="text-[10px] py-0.5 px-2 bg-[#16a34a] text-white rounded font-bold">✓ Complete</span>
        )}
      </div>
      <div className="flex items-stretch gap-1.5 flex-wrap">
        <Step
          num="1"
          label="Audit"
          status={!hasAudit ? 'never' : isAuditStale ? 'stale' : 'done'}
          statusText={!hasAudit ? 'Never audited' : isAuditStale ? 'Stale (>30d)' : '✓ Audited'}
          date={fmtShort(auditDate)}
          anchor="audit"
        />
        <Step
          num="2"
          label="Proposal"
          status={!hasProposal ? 'never' : 'done'}
          statusText={!hasProposal ? 'No proposal yet' : '✓ Proposal ready'}
          date={fmtShort(proposalDate)}
          anchor="proposal"
        />
        <Step
          num="3"
          label="AI score"
          status={!hasAi ? 'never' : aiActionable > 0 ? 'warning' : 'done'}
          statusText={!hasAi ? 'Never checked' : `Score ${aiScore}% · ${aiActionable ?? 0} actionable`}
          date={hasAi ? fmtShort(aiDetection.detected_at) : null}
          anchor="ai-check"
        />
        <Step
          num="4"
          label="Voice check"
          status={!hasVoice ? 'never' : voiceActionable > 0 ? 'warning' : 'done'}
          statusText={!hasVoice ? 'Never checked' : `${voiceScore} · ${voiceVerdict || '?'}`}
          date={hasVoice ? fmtShort(voiceCheck.checked_at) : null}
          anchor="voice-check"
        />
        <Step
          num="5"
          label="Deploy"
          status={!hasDeploy ? 'never' : isDeployStale ? 'stale' : 'done'}
          statusText={!hasDeploy ? 'Never deployed' : isDeployStale ? 'Stale (audit newer)' : '✓ Live'}
          date={fmtShort(deployDate)}
          anchor="deploy"
        />
      </div>
      {wantsRefine && hasProposal && (
        <div className="text-[9px] text-[#d97706] bg-[#fff7ed] border border-[#d97706]/30 rounded p-1.5">
          💡 Score(s) suggest the content needs work. Use <b>🎯 Re-propose with feedback</b> in the Proposal panel to regenerate addressing the flagged sentences + voice drifts. Then re-check.
        </div>
      )}
    </div>
  )
}

function EditorialPolicyEditor() {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [policy, setPolicy] = useState('')
  const [original, setOriginal] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  const load = async () => {
    try {
      const r = await api.getEditorialPolicy()
      const text = r?.editorial_policy || ''
      setPolicy(text)
      setOriginal(text)
      setLoaded(true)
    } catch (e) {
      setError(e?.message || String(e))
    }
  }

  const handleToggle = () => {
    setOpen(o => {
      if (!o && !loaded) load()
      return !o
    })
  }

  const save = async () => {
    if (busy) return
    setBusy(true); setError(null); setSaved(false)
    try {
      await api.setEditorialPolicy(policy)
      setOriginal(policy)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const isDirty = loaded && policy !== original
  const charCount = policy.length

  return (
    <details open={open} className="border border-[#e5e5e5] rounded bg-white">
      <summary
        onClick={(e) => { e.preventDefault(); handleToggle() }}
        className="cursor-pointer py-2 px-3 flex items-center gap-2"
      >
        <span className="text-[11px] font-medium">📜 Tenant-wide editorial policy</span>
        <span className="text-[9px] text-muted">
          Applies to every audit + propose call across all pages. Brand separation, neutrality on causes, voice discipline.
        </span>
        <span className="flex-1" />
        {loaded && (
          <span className="text-[9px] text-muted">
            {original ? `${original.length.toLocaleString()} chars saved` : 'empty'}
          </span>
        )}
        <span className="text-[10px] text-muted">{open ? '▾' : '▸'}</span>
      </summary>
      {open && (
        <div className="p-3 pt-0 space-y-2">
          {!loaded && !error && (
            <div className="text-[10px] text-muted italic">Loading…</div>
          )}
          {error && (
            <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>
          )}
          {loaded && (
            <>
              <div className="text-[10px] text-muted">
                Free-form prose. Auto-prepended to every Claude call for this tenant as <em>highest priority</em>, before per-page strategy hints. Overrides per-page conflicts.
              </div>
              <textarea
                value={policy}
                onChange={e => setPolicy(e.target.value)}
                rows={14}
                spellCheck={false}
                className="w-full text-[11px] font-mono border border-[#e5e5e5] rounded p-2 outline-none focus:border-[#6C5CE7] resize-y"
                placeholder="e.g. BRAND SEPARATION (HARD RULE): makeandtake.com is a publication, not a venue. Never use first-person ownership..."
              />
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-muted">{charCount.toLocaleString()} chars</span>
                {saved && <span className="text-[9px] text-[#16a34a]">✓ Saved</span>}
                <span className="flex-1" />
                <button
                  onClick={save}
                  disabled={busy || !isDirty}
                  className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
                >{busy ? 'Saving…' : 'Save policy'}</button>
              </div>
            </>
          )}
        </div>
      )}
    </details>
  )
}

function SeasonalBanner({ upcoming, onDismiss, onOpenPage }) {
  // Soonest season drives the banner accent. Within ≤14 days =
  // urgent (amber); within ≤45 days = warm (lavender); further
  // out = neutral. Just affects the left strip and the days_ahead
  // pill so the operator can triage at a glance.
  const soonest = upcoming[0]
  const accent = soonest.days_ahead <= 14 ? 'border-[#d97706] bg-[#fff7ed]'
    : soonest.days_ahead <= 45 ? 'border-[#6C5CE7]/40 bg-[#f5f3ff]'
    : 'border-[#e5e5e5] bg-[#fafafa]'
  return (
    <div className={`border rounded p-2.5 space-y-2 ${accent}`}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold">📅 Upcoming seasonal moments</span>
        <span className="text-[9px] text-muted">Refresh pages ahead of the rush.</span>
        <div className="flex-1" />
        <button
          onClick={onDismiss}
          className="text-[10px] text-muted bg-transparent border-none cursor-pointer"
          title="Hide for this session"
        >✕ Hide</button>
      </div>
      <div className="space-y-1.5">
        {upcoming.map(s => {
          const urgent = s.days_ahead <= 14
          return (
            <details key={s.id} className="bg-white border border-[#e5e5e5] rounded">
              <summary className="cursor-pointer py-1.5 px-2 text-[10px] flex items-center gap-2">
                <span className={`text-[9px] py-0.5 px-1.5 rounded font-mono ${urgent ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#f0f0f0] text-muted'}`}>
                  {s.days_ahead === 0 ? 'TODAY' : `${s.days_ahead}d`}
                </span>
                <span className="font-medium text-ink">{s.name}</span>
                <span className="text-muted">· {s.date}</span>
                <span className="flex-1" />
                <span className="text-[9px] text-muted">
                  {s.page_count} matched page{s.page_count === 1 ? '' : 's'}
                </span>
              </summary>
              <div className="p-2 border-t border-[#f0f0f0] space-y-1.5">
                <div className="text-[10px]"><b className="text-muted">Applies to:</b> {s.applies_to}</div>
                <div className="text-[10px]"><b className="text-muted">Refresh angle:</b> {s.refresh_angle}</div>
                {s.pages && s.pages.length > 0 ? (
                  <div className="pt-1 space-y-1">
                    <div className="text-[9px] text-muted uppercase font-medium tracking-wide">Matched pages</div>
                    {s.pages.map(p => (
                      <div key={p.id} className="flex items-center gap-2 text-[10px] bg-[#fafafa] border border-[#f0f0f0] rounded px-2 py-1">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{p.label}</div>
                          <div className="text-[9px] text-muted truncate">{p.why}</div>
                        </div>
                        <button
                          onClick={() => onOpenPage(p.id)}
                          className="text-[9px] py-0.5 px-1.5 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer flex-shrink-0"
                        >Open →</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[9px] text-muted italic pt-1">No managed pages obviously match. Consider whether a new page would help — Create new page above.</div>
                )}
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}

// Cross-page site audit results panel. Renders 4 buckets of
// findings (graph / content / deploy / strategy) plus a summary
// strip. Per-finding "Open page" buttons let the operator jump
// straight into the workspace for the affected page.
function SiteAuditPanel({ busy, error, audit, pages, onClose, onOpenPage }) {
  const buckets = [
    { key: 'graph',    label: 'Graph & links',     hint: 'Orphan pages, broken internal links' },
    { key: 'content',  label: 'Content hygiene',   hint: 'Missing hints, stale pages' },
    { key: 'deploy',   label: 'Deploy state',      hint: 'Un-deployed proposals, sync issues' },
    { key: 'strategy', label: 'Strategy (Claude)', hint: 'Cannibalization, voice drift, coverage gaps' },
  ]
  const summary = audit?.summary || null
  return (
    <div className="bg-white border border-[#6C5CE7]/30 rounded p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-semibold">🌐 Site audit</span>
        {audit?.generated_at && (
          <span className="text-[9px] text-muted">Generated {new Date(audit.generated_at).toLocaleString()}</span>
        )}
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="text-[10px] text-muted bg-transparent border-none cursor-pointer"
        >✕ Close</button>
      </div>

      {busy && <div className="text-[10px] text-muted italic">Running cross-page checks… (~10-30s for the strategic Claude pass when 3+ pages exist)</div>}
      {error && <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>}

      {summary && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-1.5 text-[10px]">
          <SiteStat label="Pages" value={summary.page_count} />
          <SiteStat label="Orphans" value={summary.orphan_count} tone={summary.orphan_count > 0 ? 'warn' : 'ok'} />
          <SiteStat label="Broken links" value={summary.broken_link_count} tone={summary.broken_link_count > 0 ? 'warn' : 'ok'} />
          <SiteStat label="Stale (90+d)" value={summary.stale_count} tone={summary.stale_count > 0 ? 'warn' : 'ok'} />
          <SiteStat label="No hint" value={summary.missing_hint_count} tone={summary.missing_hint_count > 0 ? 'warn' : 'ok'} />
          <SiteStat label="Undeployed" value={summary.undeployed_proposal_count} tone={summary.undeployed_proposal_count > 0 ? 'warn' : 'ok'} />
        </div>
      )}

      {audit && (
        <div className="space-y-2">
          {buckets.map(b => {
            const items = audit.findings?.[b.key] || []
            if (items.length === 0) return null
            return (
              <details key={b.key} open className="border border-[#e5e5e5] rounded">
                <summary className="cursor-pointer py-1.5 px-2 bg-[#fafafa] text-[10px] font-medium">
                  {b.label} ({items.length})
                  <span className="text-muted font-normal ml-2">— {b.hint}</span>
                </summary>
                <div className="p-2 space-y-1.5">
                  {items.map((f, i) => {
                    const sev = f.severity || 'nice'
                    const sevColors = sev === 'critical' ? 'border-[#c0392b] bg-[#fef2f2] text-[#c0392b]'
                      : sev === 'important' ? 'border-[#d97706] bg-[#fff7ed] text-[#d97706]'
                      : 'border-[#94a3b8] bg-[#f0f0f0] text-muted'
                    return (
                      <div key={f.suggestion_id || i} className="bg-white border border-[#e5e5e5] rounded p-2 text-[10px] space-y-1">
                        <div className="flex items-start gap-2">
                          <span className={`text-[8px] py-0.5 px-1 rounded border uppercase font-bold ${sevColors}`}>{sev}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-ink">{f.title}</div>
                            {f.target && <div className="text-[9px] text-muted font-mono truncate">→ {f.target}</div>}
                          </div>
                          {f.page_id && (
                            <button
                              onClick={() => onOpenPage(f.page_id)}
                              className="text-[9px] py-0.5 px-1.5 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer flex-shrink-0"
                            >Open page →</button>
                          )}
                        </div>
                        {f.detail && <div className="pl-1 text-muted">{f.detail}</div>}
                        {f.suggestion && <div className="pl-1 text-ink"><b>Suggestion:</b> {f.suggestion}</div>}
                        {Array.isArray(f.page_labels) && f.page_labels.length > 0 && (
                          <div className="pl-1 text-[9px] text-muted">Pages referenced: {f.page_labels.join(' · ')}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </details>
            )
          })}
          {Object.values(audit.findings || {}).every(arr => !arr || arr.length === 0) && (
            <div className="text-[10px] text-muted italic">No cross-page issues surfaced. The portfolio looks healthy.</div>
          )}
        </div>
      )}
    </div>
  )
}

// Bulk audit result panel. Shows per-page rows with each
// dimension's score in a compact grid. While busy, shows just
// an elapsed-time message — the BE runs sequentially so progress
// isn't surfaced (we'd need streaming for that; not worth it
// for this workflow).
function BulkAuditPanel({ busy, elapsed, error, result, onClose, onOpenPage }) {
  const DIMS = ['seo', 'aeo', 'geo', 'eeat', 'ai_naturalness']
  const dimLabel = (k) => k === 'ai_naturalness' ? 'AI' : k.toUpperCase()
  const scoreColor = (s) => {
    if (typeof s !== 'number') return 'text-muted'
    if (s >= 85) return 'text-[#16a34a]'
    if (s >= 60) return 'text-[#d97706]'
    return 'text-[#c0392b]'
  }
  return (
    <div className="bg-white border border-[#6C5CE7]/30 rounded p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-semibold">🔁 Bulk re-audit</span>
        {result && (
          <span className="text-[9px] text-muted">
            {result.succeeded}/{result.total} succeeded
            {result.failed > 0 && <span className="ml-1 text-[#c0392b]">· {result.failed} failed</span>}
            {result.elapsed_ms && <span className="ml-1">· {(result.elapsed_ms / 1000).toFixed(1)}s</span>}
          </span>
        )}
        <div className="flex-1" />
        <button onClick={onClose} className="text-[10px] text-muted bg-transparent border-none cursor-pointer">✕ Close</button>
      </div>
      {busy && (
        <div className="text-[10px] text-muted italic">
          Re-auditing every page sequentially… {elapsed}s elapsed. Don't navigate away — refreshing loses the in-flight progress (result lands when all pages are done).
        </div>
      )}
      {error && <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>}
      {result && Array.isArray(result.audits) && result.audits.length > 0 && (
        <div className="space-y-1 text-[10px]">
          <div className="grid grid-cols-[1fr_repeat(5,auto)_auto] gap-2 px-2 py-1 text-[9px] text-muted font-medium uppercase border-b border-[#e5e5e5]">
            <div>Page</div>
            {DIMS.map(d => <div key={d} className="text-center">{dimLabel(d)}</div>)}
            <div>Action</div>
          </div>
          {result.audits.map(a => (
            <div key={a.page_id} className="grid grid-cols-[1fr_repeat(5,auto)_auto] gap-2 px-2 py-1 items-center border-b border-[#f0f0f0] last:border-0">
              <div className="truncate">
                <span className="font-medium">{a.label || `Page #${a.page_id}`}</span>
                {a.status === 'skipped' && <span className="ml-1 text-[8px] text-muted">({a.reason})</span>}
                {a.status === 'error' && <span className="ml-1 text-[8px] text-[#c0392b]" title={a.error}>⚠ error</span>}
                {a.web_search_uses > 0 && <span className="ml-1 text-[8px] text-[#16a34a]" title="Used web_search for SERP-comparative analysis">🔎 {a.web_search_uses}</span>}
              </div>
              {DIMS.map(d => {
                const s = a.scores?.[d]
                return <div key={d} className={`text-center font-mono ${scoreColor(s)}`}>{typeof s === 'number' ? s : '—'}</div>
              })}
              <div>
                {a.status === 'ok' ? (
                  <button
                    onClick={() => onOpenPage(a.page_id)}
                    className="text-[9px] py-0.5 px-1.5 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer"
                  >Open →</button>
                ) : (
                  <span className="text-[8px] text-muted">—</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {result?.total === 0 && (
        <div className="text-[10px] text-muted italic">No managed pages to audit. Create some via the "+ Create new page" button.</div>
      )}
    </div>
  )
}

function SiteStat({ label, value, tone }) {
  const numCls = tone === 'warn' ? 'text-[#d97706]' : tone === 'ok' ? 'text-[#16a34a]' : 'text-ink'
  return (
    <div className="bg-[#fafafa] border border-[#e5e5e5] rounded p-1.5">
      <div className="text-muted">{label}</div>
      <div className={`text-[14px] font-semibold ${numCls}`}>{value ?? '—'}</div>
    </div>
  )
}

// One-time pre-deploy guide for setting up WordPress site-level
// backups (hosting + UpdraftPlus + manual snapshot before deploys).
// Auto-shows when the operator first clicks Deploy on this tenant;
// Fan-out modal: tier-grouped checklist of the canonical page set
// for this tenant. Defaults to Tier 1 checked (foundation pages
// every makeandtake.com install should have), other tiers
// unchecked. Operator scans the list, deselects anything they
// don't want, hits Create. Pages create as drafts in WordPress
// + show up in the Managed pages tree afterward.
// Rendered preview section. Left side = current live page (read-
// only iframe). Right side has a mode toggle:
//   - Preview (default): iframe rendering of currentBodyHtml
//   - Edit:               contentEditable div with the same styling
// In Edit mode, operator clicks into the preview and edits text
// inline. Save commits the edited innerHTML to the version row;
// deploy reads from there.
// Body editor with mode toggle. Wraps RenderedPreviewSection
// (contentEditable preview) + EditableBodyDiff (textarea HTML
// source). Only one renders at a time based on `mode`. Switching
// modes re-mounts the underlying component, which re-seeds from
// the current saved body — so unsaved local edits are lost on
// switch (warning surfaced in UI). Save commits to DB; both
// schema regen + deploy read from the saved version.
function BodyEditorWithToggle({ sourcePage, currentBodyHtml, landingPageId, currentVersionId, isHumanized, onSaved }) {
  const [mode, setMode] = useState('preview') // 'preview' | 'html'
  // Re-mount key forces the underlying editor to discard its local
  // state on mode switch — otherwise unsaved drafts in one mode
  // could leak visually into the other. The actual save target is
  // always the DB so cross-mode leakage would also confuse the
  // operator about what's persisted.
  const editorKey = `${mode}-${currentVersionId}`
  return (
    <div className="border border-[#e5e5e5] rounded">
      <div className="flex items-center gap-2 p-2 bg-[#fafafa] border-b border-[#e5e5e5]">
        <span className="text-[10px] font-medium">Body editor</span>
        <span className="text-[9px] text-muted italic">
          Switching modes reloads from the saved version — save your edits first or they'll be discarded.
        </span>
        <span className="flex-1" />
        <div className="flex items-center border border-[#e5e5e5] rounded overflow-hidden">
          <button
            onClick={() => setMode('preview')}
            className={`text-[9px] py-1 px-2 cursor-pointer border-none ${
              mode === 'preview' ? 'bg-[#6C5CE7] text-white' : 'bg-white text-ink hover:bg-[#fafafa]'
            }`}
            title="Edit in the rendered preview (contentEditable). Friendlier for prose edits; can normalize HTML / strip WP block comments."
          >👁 Rendered preview</button>
          <button
            onClick={() => setMode('html')}
            className={`text-[9px] py-1 px-2 cursor-pointer border-none ${
              mode === 'html' ? 'bg-[#6C5CE7] text-white' : 'bg-white text-ink hover:bg-[#fafafa]'
            }`}
            title="Edit raw HTML (textarea). Byte-exact; preserves WP block comments + any structure. Best for structural edits + fact corrections that need to land exactly as typed."
          >📝 HTML source</button>
        </div>
      </div>
      {mode === 'preview' ? (
        <RenderedPreviewSection
          key={editorKey}
          sourcePage={sourcePage}
          currentBodyHtml={currentBodyHtml}
          landingPageId={landingPageId}
          currentVersionId={currentVersionId}
          isHumanized={isHumanized}
          onSaved={onSaved}
        />
      ) : (
        <EditableBodyDiff
          key={editorKey}
          sourcePage={sourcePage}
          currentBodyHtml={currentBodyHtml}
          landingPageId={landingPageId}
          currentVersionId={currentVersionId}
          versionLabel={isHumanized ? 'humanized' : 'proposed'}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

function RenderedPreviewSection({ sourcePage, currentBodyHtml, landingPageId, currentVersionId, isHumanized, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  const save = async (newHtml) => {
    if (!landingPageId || !currentVersionId) return
    setSaving(true); setError(null)
    try {
      const r = await api.updateLandingVersionBody(landingPageId, currentVersionId, newHtml)
      if (typeof onSaved === 'function') onSaved(r.body_html)
      setSavedAt(Date.now())
      setEditing(false)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="border border-[#e5e5e5] rounded" open>
      <summary className="cursor-pointer py-1.5 px-2 bg-[#fafafa] text-[10px] font-medium flex items-center gap-2">
        <span>Rendered preview (current vs {isHumanized ? 'humanized' : 'proposed'})</span>
        {editing && <span className="text-[#16a34a]">· editing</span>}
        {savedAt && !editing && <span className="text-[9px] text-[#16a34a]">· ✓ saved</span>}
      </summary>
      <div className="grid grid-cols-2 gap-2 p-2">
        <div>
          <div className="text-[9px] text-muted mb-1">Current (live)</div>
          <RenderedPreview html={sourcePage?.body_html || ''} tone="red" />
        </div>
        <div>
          <div className="text-[9px] text-muted mb-1 flex items-center gap-2">
            <span>{isHumanized ? 'Humanized' : 'Proposed'} — {editing ? 'editing in place' : 'click ✏️ Edit to modify'}</span>
            <span className="flex-1" />
            {!editing && (
              <button
                onClick={() => { setEditing(true); setError(null); setSavedAt(null) }}
                className="text-[9px] py-0.5 px-1.5 bg-white border border-[#2D9A5E] text-[#2D9A5E] rounded cursor-pointer"
                title="Edit the proposed content inline in the preview. Save commits changes to the version row; deploy reads from there."
              >✏️ Edit preview</button>
            )}
            {editing && (
              <button
                onClick={() => { setEditing(false); setError(null) }}
                disabled={saving}
                className="text-[9px] py-0.5 px-1.5 bg-white border border-[#e5e5e5] text-ink rounded cursor-pointer disabled:opacity-50"
              >Cancel</button>
            )}
          </div>
          {editing ? (
            <EditableRenderedPreview
              html={currentBodyHtml || ''}
              onSave={save}
              busy={saving}
            />
          ) : (
            <RenderedPreview html={currentBodyHtml || ''} tone="green" />
          )}
          {error && <div className="text-[9px] text-[#c0392b] mt-1">⚠ {error}</div>}
        </div>
      </div>
      <div className="text-[8px] text-muted italic px-2 pb-2">
        Approximate styling — actual rendering will use the live theme on deploy. Scripts and forms are disabled in this preview. Inline edits save to the version row; you can also edit raw HTML below.
      </div>
    </details>
  )
}

// Editable body-HTML diff. Left side (current) stays read-only;
// right side (proposed) is an editable textarea so the operator
// can tweak phrasing / fix typos / adjust copy before deploy.
// Uses a textarea (not Quill) intentionally — WordPress block-
// editor HTML contains <!-- wp:paragraph --> / <!-- wp:yoast/
// faq-block --> block comments that rich-text editors strip
// during normalization. Textarea preserves them verbatim.
function EditableBodyDiff({ sourcePage, currentBodyHtml, landingPageId, currentVersionId, versionLabel, onSaved }) {
  const [draft, setDraft] = useState(currentBodyHtml || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  // Re-seed when the parent's currentBodyHtml changes (re-propose,
  // humanize, slot switch) so we don't show stale draft state.
  useEffect(() => {
    setDraft(currentBodyHtml || '')
    setSaved(false); setError(null); setEditing(false)
  }, [currentBodyHtml, currentVersionId])

  const isDirty = draft !== (currentBodyHtml || '')

  const save = async () => {
    if (saving || !isDirty || !landingPageId || !currentVersionId) return
    setSaving(true); setError(null); setSaved(false)
    try {
      const r = await api.updateLandingVersionBody(landingPageId, currentVersionId, draft)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      if (typeof onSaved === 'function') onSaved(r.body_html)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="border border-[#e5e5e5] rounded">
      <summary className="cursor-pointer py-1.5 px-2 bg-[#fafafa] text-[10px] font-medium">
        Body HTML source (current vs {versionLabel})
        {isDirty && <span className="ml-2 text-[#d97706]">· unsaved edits</span>}
      </summary>
      <div className="grid grid-cols-2 gap-2 p-2">
        <div>
          <div className="text-[9px] text-muted mb-1">Current (live)</div>
          <pre className="text-[9px] font-mono whitespace-pre-wrap break-all bg-[#fef2f2] border border-[#c0392b]/30 rounded p-2 max-h-[400px] overflow-auto">{sourcePage?.body_html || '(empty)'}</pre>
        </div>
        <div>
          <div className="text-[9px] text-muted mb-1 flex items-center gap-2">
            <span>{versionLabel === 'humanized' ? 'Humanized' : 'Proposed'} — editable</span>
            <span className="flex-1" />
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-[9px] py-0.5 px-1.5 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer"
                title="Edit the proposed body HTML inline. Edits save to the version row; deploy reads from there."
              >✏️ Edit</button>
            )}
            {editing && (
              <>
                {saving && <span className="text-[8px] text-muted">Saving…</span>}
                {saved && <span className="text-[8px] text-[#16a34a]">✓ Saved</span>}
                <button
                  onClick={() => { setDraft(currentBodyHtml || ''); setEditing(false); setError(null) }}
                  disabled={saving}
                  className="text-[9px] py-0.5 px-1.5 bg-white border border-[#e5e5e5] text-ink rounded cursor-pointer disabled:opacity-50"
                >Cancel</button>
                <button
                  onClick={save}
                  disabled={saving || !isDirty}
                  className="text-[9px] py-0.5 px-1.5 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50"
                  title="Save the edited body to this version. Deploy will use the saved version."
                >Save</button>
              </>
            )}
          </div>
          {editing ? (
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              spellCheck={true}
              className="w-full text-[10px] font-mono whitespace-pre-wrap bg-white border border-[#2D9A5E]/30 rounded p-2 max-h-[400px] outline-none focus:border-[#2D9A5E] focus:ring-1 focus:ring-[#2D9A5E]/30 resize-y"
              style={{ minHeight: '300px' }}
            />
          ) : (
            <pre className="text-[9px] font-mono whitespace-pre-wrap break-all bg-[#f0fdf4] border border-[#2D9A5E]/30 rounded p-2 max-h-[400px] overflow-auto">{currentBodyHtml || '(empty)'}</pre>
          )}
          {error && <div className="text-[9px] text-[#c0392b] mt-1">⚠ {error}</div>}
          {editing && (
            <div className="text-[8px] text-muted italic mt-1">
              Tip: WordPress block comments (<code>&lt;!-- wp:paragraph --&gt;</code>) must stay intact for the block editor to recognize the content as proper blocks. Edit the text inside the paragraph tags, not the block comments themselves.
            </div>
          )}
        </div>
      </div>
    </details>
  )
}

// Per-slot status badge tone mapping.
function statusTone(status) {
  switch (status) {
    case "deployed":  return { bg: "bg-[#dcfce7]", fg: "text-[#166534]", border: "border-[#16a34a]/40", icon: "✓" }
    case "created":   return { bg: "bg-[#dbeafe]", fg: "text-[#1d4ed8]", border: "border-[#3b82f6]/40", icon: "📝" }
    case "mapped":    return { bg: "bg-[#f5f3ff]", fg: "text-[#5b21b6]", border: "border-[#8b5cf6]/40", icon: "🔗" }
    case "skipped":   return { bg: "bg-[#f0f0f0]", fg: "text-muted", border: "border-[#e5e5e5]", icon: "—" }
    default:          return { bg: "bg-white", fg: "text-muted", border: "border-[#e5e5e5]", icon: "○" }
  }
}
function statusLabel(status) {
  switch (status) {
    case "deployed":  return "Deployed"
    case "created":   return "Created (draft)"
    case "mapped":    return "Mapped to existing"
    case "skipped":   return "Skipped"
    default:          return "Pending"
  }
}

// Site Setup Wizard. Persistent per-slot state — operator walks
// through the canonical plan, mapping existing pages or creating
// new ones, slot by slot. Each slot tracks: status, mapped
// landing_page_id, slug override, optional skip reason.
function SetupWizardModal({ data, onClose, onRefresh, onOpenPage, onAfterMutation }) {
  const plan = data.plan || []
  const pages = data.pages || []
  const tierDescriptions = data.tier_descriptions || {}
  const [activeSlotId, setActiveSlotId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Auto-poll while any slot has a pipeline in progress. Stops as
  // soon as every slot is either idle, ready_for_review, or failed.
  const ACTIVE_STAGES = useMemo(() => new Set(["auditing", "proposing", "generating_schema"]), [])
  const hasActivePipeline = plan.some(p => p.stored?.pipeline?.stage && ACTIVE_STAGES.has(p.stored.pipeline.stage))
  useEffect(() => {
    if (!hasActivePipeline) return
    const tick = setInterval(() => { onRefresh().catch(() => {}) }, 8000)
    return () => clearInterval(tick)
  }, [hasActivePipeline, onRefresh])

  // Group plan by tier for rendering.
  const tiers = {}
  for (const p of plan) {
    const t = p.tier || 0
    if (!tiers[t]) tiers[t] = []
    tiers[t].push(p)
  }
  const tierKeys = Object.keys(tiers).sort((a, b) => Number(a) - Number(b))

  // Overall progress summary.
  const totalSlots = plan.length
  const counts = plan.reduce((acc, p) => {
    acc[p.effective_status] = (acc[p.effective_status] || 0) + 1
    return acc
  }, {})

  const submitAction = async (slotId, action, extras = {}) => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      if (action === "run-pipeline") {
        await api.runSetupSlotPipeline(slotId, { regenerate: !!extras?.regenerate })
        // Refresh once immediately so the slot flips into running
        // state; the polling effect above takes over from there.
        await onRefresh()
      } else {
        await api.updateSetupSlot(slotId, action, extras)
        await onAfterMutation()
      }
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
      <div className="bg-white rounded shadow-xl max-w-5xl w-full max-h-[92vh] overflow-hidden flex flex-col">
        <div className="p-3 border-b border-[#e5e5e5] flex items-center gap-2">
          <h3 className="text-[13px] font-semibold flex-1">🪄 Site Setup Wizard</h3>
          <span className="text-[10px] text-muted">
            {(counts.deployed || 0) + (counts.created || 0) + (counts.mapped || 0) + (counts.skipped || 0)} / {totalSlots} progressed
            {counts.deployed > 0 && <span className="ml-1 text-[#16a34a]">· {counts.deployed} deployed</span>}
          </span>
          <button onClick={onClose} className="text-[12px] text-muted bg-transparent border-none cursor-pointer">✕</button>
        </div>
        <div className="text-[10px] text-muted px-3 py-2 bg-[#fafafa] border-b border-[#e5e5e5]">
          Each slot below is a recommended page for this tenant. For each: <b>Map to existing</b> WP page, <b>Create new</b> from the template, or <b>Skip</b>. Progress saves automatically — close + come back any time. Created or mapped pages open in the regular workspace (Audit → Propose → Deploy as normal).
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {tierKeys.map(tierKey => {
            const tierItems = tiers[tierKey]
            const tierMeta = tierDescriptions[tierKey] || { label: `Tier ${tierKey}`, subtitle: '' }
            const done = tierItems.filter(p => p.effective_status === 'deployed' || p.effective_status === 'created' || p.effective_status === 'mapped' || p.effective_status === 'skipped').length
            return (
              <details key={tierKey} open={Number(tierKey) === 1 || done < tierItems.length}>
                <summary className="cursor-pointer py-2 px-2.5 bg-[#fafafa] border border-[#e5e5e5] rounded flex items-center gap-2">
                  <span className="text-[11px] font-semibold">{tierMeta.label}</span>
                  <span className="text-[9px] text-muted">— {tierMeta.subtitle}</span>
                  <span className="flex-1" />
                  <span className="text-[9px] text-muted">{done} / {tierItems.length} progressed</span>
                </summary>
                <div className="space-y-1.5 pt-2">
                  {tierItems.map(slot => (
                    <SetupSlotCard
                      key={slot.id}
                      slot={slot}
                      pages={pages}
                      active={activeSlotId === slot.id}
                      setActive={() => setActiveSlotId(activeSlotId === slot.id ? null : slot.id)}
                      busy={busy}
                      onAction={(action, extras) => submitAction(slot.id, action, extras)}
                      onOpenPage={onOpenPage}
                    />
                  ))}
                </div>
              </details>
            )
          })}
        </div>

        {error && <div className="px-3 py-2 text-[10px] text-[#c0392b] border-t border-[#e5e5e5]">⚠ {error}</div>}

        <div className="p-3 border-t border-[#e5e5e5] flex items-center gap-2">
          <span className="text-[10px] text-muted flex-1">
            Progress autosaves on every action. Close anytime — pick up here later.
          </span>
          <button onClick={onClose} className="text-[10px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer">Done</button>
        </div>
      </div>
    </div>
  )
}

// One slot in the wizard. Renders a compact card with status,
// rationale, and inline action panel that expands on click.
function SetupSlotCard({ slot, pages, active, setActive, busy, onAction, onOpenPage }) {
  const tone = statusTone(slot.effective_status)
  const [slugOverride, setSlugOverride] = useState(slot.stored?.slug_override || "")
  const [mapTarget, setMapTarget] = useState(slot.mapped_page?.id || slot.auto_suggested_page?.id || "")
  const [skipReason, setSkipReason] = useState(slot.stored?.skipped_reason || "")
  const isDone = slot.effective_status === "deployed" || slot.effective_status === "created" || slot.effective_status === "mapped"
  const isSkipped = slot.effective_status === "skipped"

  // Pipeline state — runs only for mapped/created slots. Stages
  // live on slot.stored.pipeline as the BE writes them.
  const pipeline = slot.stored?.pipeline || null
  // Microcopy depends on whether the slot was mapped (audit ran)
  // or created (audit skipped — proposing expands the scaffold).
  const PIPELINE_STAGE_LABELS = pipeline?.audit_skipped ? {
    proposing: "✍️ Drafting content from scratch (~1-2 min)",
    generating_schema: "🏷️ Generating schema (~30s)",
    ready_for_review: "✓ Ready for review",
    failed: "✗ Failed",
  } : {
    auditing: "🔍 Auditing (~1-2 min)",
    proposing: "✍️ Drafting proposal (~1-2 min)",
    generating_schema: "🏷️ Generating schema (~30s)",
    ready_for_review: "✓ Ready for review",
    failed: "✗ Failed",
  }
  const stageRunning = pipeline?.stage && ["auditing", "proposing", "generating_schema"].includes(pipeline.stage)
  const stageReady = pipeline?.stage === "ready_for_review"
  const stageFailed = pipeline?.stage === "failed"
  // Slot is pipeline-eligible if it has a mapped landing page +
  // hasn't been deployed yet (deployed pages don't need re-pipeline).
  const canRunPipeline = slot.mapped_page && slot.effective_status !== "deployed" && slot.effective_status !== "skipped"

  return (
    <div className={`border ${tone.border} ${tone.bg} rounded`}>
      <div className="flex items-start gap-2 p-2">
        <span className={`text-[9px] py-0.5 px-1.5 rounded font-mono flex-shrink-0 ${tone.fg} bg-white border ${tone.border}`}>
          {tone.icon} {statusLabel(slot.effective_status)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-[#6C5CE7] font-mono text-[11px]">{slot.label}</code>
            <span className="text-[9px] py-0.5 px-1.5 rounded bg-white text-muted border border-[#e5e5e5]">
              {slot.template_id}
            </span>
            {slot.mapped_page && (
              <span className="text-[9px] py-0.5 px-1.5 rounded bg-[#f5f3ff] text-[#5b21b6]">
                ↔ {slot.mapped_page.label} (page #{slot.mapped_page.id})
              </span>
            )}
            {!slot.mapped_page && slot.auto_suggested_page && (
              <span className="text-[9px] py-0.5 px-1.5 rounded bg-[#fffbeb] text-[#92400e]">
                Suggested match: {slot.auto_suggested_page.label}
              </span>
            )}
            {pipeline?.stage && (
              <span className={`text-[9px] py-0.5 px-1.5 rounded ${
                stageReady ? "bg-[#dcfce7] text-[#166534]"
                : stageFailed ? "bg-[#fef2f2] text-[#c0392b]"
                : "bg-[#dbeafe] text-[#1d4ed8]"
              }`}>
                {PIPELINE_STAGE_LABELS[pipeline.stage] || pipeline.stage}
                {pipeline?.regenerate && <span className="ml-1 opacity-70">· 🔄 fresh</span>}
              </span>
            )}
          </div>
          <div className="text-[10px] text-muted mt-0.5">{slot.why}</div>
          {slot.stored?.skipped_reason && (
            <div className="text-[10px] text-muted italic mt-0.5">Skipped: {slot.stored.skipped_reason}</div>
          )}
          {stageFailed && pipeline?.error && (
            <div className="text-[10px] text-[#c0392b] italic mt-0.5">⚠ {pipeline.error}</div>
          )}
          {stageRunning && (
            <div className="text-[9px] text-muted italic mt-0.5">
              Pipeline running — auto-refreshing every 8s. Safe to close (state is saved server-side) but you don't have to.
            </div>
          )}
          {pipeline?.auto_accepted_finding_count != null && (
            <div className="text-[9px] text-muted mt-0.5">
              Auto-accepted {pipeline.auto_accepted_finding_count} audit finding{pipeline.auto_accepted_finding_count === 1 ? '' : 's'} (critical + important)
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {canRunPipeline && !stageRunning && !stageReady && (
            <button
              onClick={() => onAction("run-pipeline")}
              disabled={busy}
              className="text-[9px] py-1 px-2 bg-[#16a34a] text-white border-none rounded cursor-pointer disabled:opacity-50"
              title={slot.effective_status === "created"
                ? "New page — propose + schema-gen (no audit since the scaffold has nothing meaningful to audit yet). ~2-3 min."
                : "Existing page — audit + propose + schema-gen. Auto-accepts critical+important audit findings. ~3-5 min."}
            >🤖 {slot.effective_status === "created" ? "Generate content" : "Audit + auto-fill"}</button>
          )}
          {stageReady && slot.mapped_page && (
            <>
              <button
                onClick={() => onOpenPage(slot.mapped_page.id)}
                className="text-[9px] py-1 px-2 bg-[#16a34a] text-white border-none rounded cursor-pointer"
                title="Pipeline is done — review the proposed content + deploy from the regular workspace."
              >Review & deploy →</button>
              <button
                onClick={() => {
                  if (!confirm("Regenerate from scratch?\n\nThe current AI proposal stays in version history (you can roll back to it from the workspace), but a fresh proposal will be generated and become the new latest version. Use when the previous proposal wasn't right.")) return
                  onAction("run-pipeline", { regenerate: true })
                }}
                disabled={busy}
                className="text-[9px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer disabled:opacity-50"
                title="Discard the current proposal and start fresh from the original imported / scaffold version. Previous proposal stays in version history."
              >🔄 Regenerate</button>
            </>
          )}
          {stageFailed && (
            <>
              <button
                onClick={() => onAction("run-pipeline")}
                disabled={busy}
                className="text-[9px] py-1 px-2 bg-[#d97706] text-white border-none rounded cursor-pointer disabled:opacity-50"
                title="Retry from where it failed (uses the most-recent source version)."
              >Retry</button>
              <button
                onClick={() => {
                  if (!confirm("Regenerate from scratch?\n\nStarts fresh from the original imported / scaffold version, ignoring any prior AI proposals.")) return
                  onAction("run-pipeline", { regenerate: true })
                }}
                disabled={busy}
                className="text-[9px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer disabled:opacity-50"
              >🔄 Regenerate</button>
            </>
          )}
          {isDone && slot.mapped_page && !stageReady && (
            <button
              onClick={() => onOpenPage(slot.mapped_page.id)}
              className="text-[9px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer"
            >Open →</button>
          )}
          <button
            onClick={setActive}
            disabled={busy}
            className="text-[9px] py-1 px-2 bg-white border border-[#e5e5e5] text-ink rounded cursor-pointer disabled:opacity-50"
          >{active ? 'Close' : isDone ? 'Change' : isSkipped ? 'Un-skip' : 'Action'}</button>
        </div>
      </div>

      {active && (
        <div className="border-t border-[#e5e5e5] p-2 space-y-2 bg-white">
          {/* Action 1: Map to existing page */}
          {!isSkipped && (
            <div className="border border-[#e5e5e5] rounded p-2 space-y-1">
              <div className="text-[10px] font-medium">🔗 Map to an existing WordPress page</div>
              <div className="text-[9px] text-muted">If a page already covers this slot's purpose, pick it here. Existing audit / propose / deploy history stays intact.</div>
              <div className="flex items-center gap-1.5">
                <select
                  value={mapTarget}
                  onChange={e => setMapTarget(e.target.value)}
                  className="flex-1 text-[10px] border border-[#e5e5e5] rounded py-1 px-1.5 bg-white"
                >
                  <option value="">— pick a page —</option>
                  {pages.map(p => {
                    const mappedElsewhere = p.mapped_to_slot && p.mapped_to_slot !== slot.id
                    return (
                      <option key={p.id} value={p.id} disabled={mappedElsewhere}>
                        {p.label} {p.url ? `· ${p.url}` : ''} {mappedElsewhere ? `(used by ${p.mapped_to_slot})` : ''}
                      </option>
                    )
                  })}
                </select>
                <button
                  onClick={() => onAction('map', { landing_page_id: Number(mapTarget) })}
                  disabled={busy || !mapTarget}
                  className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
                >Map</button>
                {slot.mapped_page && (
                  <button
                    onClick={() => onAction('unmap')}
                    disabled={busy}
                    className="text-[10px] py-1 px-2 bg-white border border-[#c0392b] text-[#c0392b] rounded cursor-pointer disabled:opacity-50"
                  >Unmap</button>
                )}
              </div>
            </div>
          )}

          {/* Action 2: Create new from template */}
          {!isSkipped && slot.effective_status !== "created" && slot.effective_status !== "deployed" && (
            <div className="border border-[#e5e5e5] rounded p-2 space-y-1">
              <div className="text-[10px] font-medium">📝 Create a new page from the <code>{slot.template_id}</code> template</div>
              <div className="text-[9px] text-muted">A WP page draft is created with the template's body scaffold + pre-filled strategy hint. You'll Audit / Propose / Deploy via the regular workspace afterward.</div>
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] text-muted">Slug:</label>
                <input
                  type="text"
                  value={slugOverride || slot.label.replace(/^\/|\/$/g, "")}
                  onChange={e => setSlugOverride(e.target.value.replace(/^\/|\/$/g, ""))}
                  className="flex-1 text-[10px] border border-[#e5e5e5] rounded py-1 px-1.5 outline-none focus:border-[#16a34a] font-mono"
                />
                <button
                  onClick={() => onAction('create', { slug_override: slugOverride || null })}
                  disabled={busy}
                  className="text-[10px] py-1 px-2 bg-[#16a34a] text-white border-none rounded cursor-pointer disabled:opacity-50"
                >{busy ? '…' : 'Create'}</button>
              </div>
            </div>
          )}

          {/* Action 3: Skip / Un-skip */}
          <div className="border border-[#e5e5e5] rounded p-2 space-y-1">
            <div className="text-[10px] font-medium">
              {isSkipped ? '— Un-skip this slot' : '— Skip this slot'}
            </div>
            <div className="text-[9px] text-muted">
              {isSkipped
                ? "Re-open this slot if you want to address it after all."
                : "Mark as not applicable for this tenant. You can un-skip later."}
            </div>
            {!isSkipped && (
              <input
                type="text"
                value={skipReason}
                onChange={e => setSkipReason(e.target.value)}
                placeholder="Optional reason (e.g. 'covered by an existing /faq2/ page')"
                className="w-full text-[10px] border border-[#e5e5e5] rounded py-1 px-1.5 outline-none focus:border-[#94a3b8]"
              />
            )}
            <div className="flex items-center justify-end">
              {isSkipped ? (
                <button
                  onClick={() => onAction('unskip')}
                  disabled={busy}
                  className="text-[10px] py-1 px-2 bg-white border border-[#94a3b8] text-ink rounded cursor-pointer disabled:opacity-50"
                >Un-skip</button>
              ) : (
                <button
                  onClick={() => onAction('skip', { skipped_reason: skipReason || null })}
                  disabled={busy}
                  className="text-[10px] py-1 px-2 bg-white border border-[#94a3b8] text-ink rounded cursor-pointer disabled:opacity-50"
                >Skip</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FanOutModal({ data, onClose, onCreated }) {
  const plan = data.plan || []
  const tierDescriptions = data.tier_descriptions || {}
  // Initial selection: Tier 1 checked, others unchecked. Plus skip
  // anything already_exists (operator can opt back in).
  const [selectedIds, setSelectedIds] = useState(() => {
    const s = new Set()
    for (const p of plan) {
      if (p.tier === 1 && !p.already_exists) s.add(p.id)
    }
    return s
  })
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)

  const toggleOne = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleTier = (tier, value) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      for (const p of plan) {
        if (p.tier !== tier || p.already_exists) continue
        if (value) next.add(p.id)
        else next.delete(p.id)
      }
      return next
    })
  }

  // Group plan items by tier for rendering.
  const tiers = {}
  for (const p of plan) {
    const t = p.tier || 0
    if (!tiers[t]) tiers[t] = []
    tiers[t].push(p)
  }
  const tierKeys = Object.keys(tiers).sort((a, b) => Number(a) - Number(b))

  const ids = Array.from(selectedIds)
  const handleRun = async () => {
    if (running || ids.length === 0) return
    if (!confirm(`Create ${ids.length} page(s) as drafts in WordPress? You'll deploy each one through the normal Audit → Propose → Deploy flow afterward.`)) return
    setRunning(true); setError(null); setResults(null)
    try {
      const r = await api.runFanOut(ids)
      setResults(r)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
      <div className="bg-white rounded shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-3 border-b border-[#e5e5e5] flex items-center gap-2">
          <h3 className="text-[13px] font-semibold flex-1">🪄 Fan out recommended pages</h3>
          <span className="text-[10px] text-muted">
            {ids.length} of {plan.length} selected
          </span>
          <button onClick={onClose} className="text-[12px] text-muted bg-transparent border-none cursor-pointer">✕</button>
        </div>
        <div className="text-[10px] text-muted px-3 py-2 bg-[#fafafa] border-b border-[#e5e5e5]">
          The canonical schema-aware page set for this tenant. Each entry uses a template + pre-filled values. Pages create as <b>drafts</b> in WordPress — you'll run audit → propose → deploy on each afterward. Tier 1 is checked by default; expand other tiers to add more.
        </div>

        {!results && (
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {tierKeys.map(tierKey => {
              const tierItems = tiers[tierKey]
              const tierMeta = tierDescriptions[tierKey] || { label: `Tier ${tierKey}`, subtitle: '' }
              const tierActiveItems = tierItems.filter(p => !p.already_exists)
              const tierSelected = tierActiveItems.filter(p => selectedIds.has(p.id)).length
              const allSelected = tierActiveItems.length > 0 && tierSelected === tierActiveItems.length
              const noneSelected = tierSelected === 0
              return (
                <details key={tierKey} open={Number(tierKey) === 1} className="border border-[#e5e5e5] rounded">
                  <summary className="cursor-pointer py-2 px-2.5 bg-[#fafafa] flex items-center gap-2">
                    <span className="text-[11px] font-semibold">{tierMeta.label}</span>
                    <span className="text-[9px] text-muted">— {tierMeta.subtitle}</span>
                    <span className="flex-1" />
                    <span className="text-[9px] text-muted">
                      {tierSelected} / {tierActiveItems.length} selected
                    </span>
                    <button
                      onClick={e => { e.preventDefault(); toggleTier(Number(tierKey), !allSelected) }}
                      className="text-[9px] py-0.5 px-1.5 bg-white border border-[#e5e5e5] text-ink rounded cursor-pointer"
                    >{allSelected ? 'Clear tier' : noneSelected ? 'Select tier' : 'Select all'}</button>
                  </summary>
                  <div className="divide-y divide-[#f0f0f0]">
                    {tierItems.map(item => {
                      const checked = selectedIds.has(item.id)
                      const disabled = item.already_exists
                      return (
                        <label key={item.id} className={`flex items-start gap-2 py-2 px-2.5 ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-[#fafafa]'}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleOne(item.id)}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] flex items-center gap-2 flex-wrap">
                              <code className="text-[#6C5CE7] font-mono">{item.label}</code>
                              <span className="text-[9px] py-0.5 px-1.5 rounded bg-[#f0f0f0] text-muted">{item.template_id}</span>
                              {disabled && (
                                <span className="text-[9px] py-0.5 px-1.5 rounded bg-[#dcfce7] text-[#166534]">✓ already exists</span>
                              )}
                            </div>
                            <div className="text-[10px] text-muted mt-0.5">{item.why}</div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </details>
              )
            })}
          </div>
        )}

        {results && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <div className="text-[11px] font-semibold">Done.</div>
            <div className="grid grid-cols-3 gap-2 text-[10px]">
              <Stat label="Created" value={results.summary?.created || 0} tone="ok" />
              <Stat label="Skipped (already exists)" value={results.summary?.skipped || 0} />
              <Stat label="Failed" value={results.summary?.failed || 0} tone={results.summary?.failed > 0 ? 'warn' : 'ok'} />
            </div>
            <div className="space-y-1 pt-2">
              {(results.results || []).map(r => {
                const item = plan.find(p => p.id === r.id)
                const tone = r.success ? 'text-[#166534]' : r.skipped ? 'text-muted' : 'text-[#c0392b]'
                return (
                  <div key={r.id} className="flex items-start gap-2 text-[10px] py-1 border-b border-[#f0f0f0] last:border-0">
                    <span className={tone}>
                      {r.success ? '✓' : r.skipped ? '○' : '✗'}
                    </span>
                    <code className="text-[#6C5CE7] font-mono flex-1">{item?.label || r.id}</code>
                    {r.error && <span className="text-[9px] text-[#c0392b]">{r.error}</span>}
                    {r.reason && <span className="text-[9px] text-muted">{r.reason}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {error && <div className="px-3 py-2 text-[10px] text-[#c0392b] border-t border-[#e5e5e5]">⚠ {error}</div>}

        <div className="p-3 border-t border-[#e5e5e5] flex items-center gap-2">
          <span className="text-[10px] text-muted flex-1">
            {!results && (ids.length === 0
              ? 'Select at least one page to continue.'
              : `${ids.length} page${ids.length === 1 ? '' : 's'} will be created as drafts. Audit + Propose + Deploy each via the normal flow afterward.`
            )}
            {results && 'Refresh the page list — new drafts are now in the Managed pages tree.'}
          </span>
          {!results && (
            <>
              <button onClick={onClose} className="text-[10px] py-1.5 px-3 bg-white border border-[#e5e5e5] text-ink rounded cursor-pointer">Cancel</button>
              <button
                onClick={handleRun}
                disabled={running || ids.length === 0}
                className="text-[10px] py-1.5 px-3 bg-[#16a34a] text-white border-none rounded cursor-pointer disabled:opacity-50"
              >{running ? 'Creating…' : `Create ${ids.length} page${ids.length === 1 ? '' : 's'}`}</button>
            </>
          )}
          {results && (
            <button onClick={onCreated} className="text-[10px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer">Done</button>
          )}
        </div>
      </div>
    </div>
  )
}

// also openable any time from the "📚 Backup guide" header button.
// Acknowledgment persists on tenants.landing_acknowledgments.
function BackupGuideModal({ alreadyAcknowledged, isPreDeployGate, onAcknowledge, onClose }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg max-w-[700px] w-full max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#e5e5e5] flex items-start gap-3">
          <span className="text-[20px]">📚</span>
          <div className="flex-1">
            <h3 className="text-[14px] font-semibold">Before you deploy: WordPress backup setup</h3>
            <p className="text-[11px] text-muted mt-0.5">
              {isPreDeployGate
                ? <span>You're about to push changes to a live WordPress site. Take 15 minutes to confirm backups are in place — it could save your site if a deploy ever goes wrong.</span>
                : <span>Reference guide for setting up WordPress backups before deploying page changes.</span>}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[16px] text-muted bg-transparent border-none cursor-pointer leading-none"
            title="Close"
          >×</button>
        </div>

        {/* What we do vs don't back up */}
        <div className="px-4 py-3 space-y-3 text-[11px]">
          <div className="bg-[#f3f0ff] border border-[#6C5CE7]/20 rounded p-2">
            <div className="font-medium text-[#6C5CE7] mb-1">What this tool already backs up</div>
            <div className="text-muted">Every time you click Deploy or Rollback, we snapshot the SPECIFIC PAGE'S content (body + title + Yoast meta) into Version History before pushing. That covers content rewrites of pages you manage here.</div>
          </div>
          <div className="bg-[#fef2f2] border border-[#c0392b]/30 rounded p-2">
            <div className="font-medium text-[#c0392b] mb-1">What this tool does NOT back up</div>
            <ul className="list-disc pl-5 space-y-0.5 text-muted">
              <li>Other pages, posts, users, comments — only the page you're deploying</li>
              <li>Theme settings + customizer (live in wp_options)</li>
              <li>Plugin settings + plugin database tables</li>
              <li>Media library (wp-content/uploads/) — images, videos, downloads</li>
              <li>Theme files + plugin files (wp-content/themes/, wp-content/plugins/)</li>
              <li>wp-config.php, .htaccess, server-level config</li>
            </ul>
            <div className="mt-1.5 text-muted italic">For these, you need a real site-level backup. Recommended setup below.</div>
          </div>

          {/* Step 1 */}
          <div className="border border-[#e5e5e5] rounded p-2.5 space-y-1">
            <div className="font-medium text-ink">Step 1 — Verify your hosting backups <span className="text-[10px] text-muted font-normal">(5 min, free with most hosts)</span></div>
            <p className="text-muted">Most managed WordPress hosts run daily backups automatically. Log in to your hosting dashboard and confirm. Quick links:</p>
            <ul className="list-disc pl-5 text-muted">
              <li><a href="https://my.wpengine.com" target="_blank" rel="noopener noreferrer" className="text-[#6C5CE7] underline">WP Engine</a> — included, 14-30 day retention, one-click restore</li>
              <li><a href="https://my.kinsta.com" target="_blank" rel="noopener noreferrer" className="text-[#6C5CE7] underline">Kinsta</a> — daily + downloadable + on-demand</li>
              <li><a href="https://my.siteground.com" target="_blank" rel="noopener noreferrer" className="text-[#6C5CE7] underline">SiteGround</a>, <a href="https://my.bluehost.com" target="_blank" rel="noopener noreferrer" className="text-[#6C5CE7] underline">Bluehost</a>, <a href="https://hpanel.hostinger.com" target="_blank" rel="noopener noreferrer" className="text-[#6C5CE7] underline">Hostinger</a> — usually on paid plans</li>
              <li>Other hosts — search "[your host] WordPress backup" in their docs</li>
            </ul>
          </div>

          {/* Step 2 */}
          <div className="border border-[#e5e5e5] rounded p-2.5 space-y-1">
            <div className="font-medium text-ink">Step 2 — Install UpdraftPlus <span className="text-[10px] text-muted font-normal">(15 min, free)</span></div>
            <p className="text-muted">Even with hosting backups, an in-WP plugin gives you on-demand snapshots + off-site storage (in case your hosting account is ever locked or compromised).</p>
            <ol className="list-decimal pl-5 text-muted">
              <li>In WP admin: <strong>Plugins → Add New</strong> → search <em>UpdraftPlus</em> → Install + Activate</li>
              <li>Go to <strong>Settings → UpdraftPlus Backups</strong> → Settings tab</li>
              <li>Choose a remote storage destination (Dropbox / Google Drive / Amazon S3)</li>
              <li>Set automatic schedule: weekly for files, weekly for database</li>
              <li>Click <strong>"Backup Now"</strong> to run your first backup immediately</li>
            </ol>
            <a href="https://wordpress.org/plugins/updraftplus/" target="_blank" rel="noopener noreferrer" className="text-[#6C5CE7] underline">→ UpdraftPlus on WordPress.org</a>
          </div>

          {/* Step 3 */}
          <div className="border border-[#e5e5e5] rounded p-2.5 space-y-1">
            <div className="font-medium text-ink">Step 3 — Manual backup before deploy sessions <span className="text-[10px] text-muted font-normal">(30 seconds)</span></div>
            <p className="text-muted">Before any session of page deployments:</p>
            <ol className="list-decimal pl-5 text-muted">
              <li>Open WP admin → <strong>Settings → UpdraftPlus Backups</strong></li>
              <li>Click <strong>"Backup Now"</strong></li>
              <li>Wait for the confirmation banner</li>
              <li>Come back here and deploy with confidence</li>
            </ol>
          </div>

          {/* Footnote */}
          <div className="text-[10px] text-muted italic px-1">
            You can always re-open this guide from the <strong>📚 Backup guide</strong> button in the Landing tab header. {alreadyAcknowledged ? "You've already acknowledged this guide — no need to acknowledge again." : 'Acknowledging below stops the auto-popup; the manual button still works any time.'}
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-4 py-3 border-t border-[#e5e5e5] flex items-center gap-2">
          <div className="flex-1 text-[10px] text-muted">
            {isPreDeployGate && 'Acknowledge below to proceed with the deploy that\'s waiting.'}
          </div>
          <button
            onClick={onClose}
            className="text-[11px] py-1.5 px-3 bg-white border border-[#e5e5e5] rounded cursor-pointer"
          >{isPreDeployGate ? 'Cancel deploy' : 'Close'}</button>
          {!alreadyAcknowledged && (
            <button
              onClick={onAcknowledge}
              className="text-[11px] py-1.5 px-3 bg-[#d97706] text-white border-none rounded cursor-pointer font-medium"
              title="Records that you've reviewed this guide. Stops the auto-popup on future deploys. The manual 📚 Backup guide button keeps working."
            >{isPreDeployGate ? '✓ I have backups — deploy now' : '✓ Got it — I have backups'}</button>
          )}
        </div>
      </div>
    </div>
  )
}

function SchemaBlock({ landingPageId, versionId }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [copiedIndex, setCopiedIndex] = useState(null)
  // Live-schema check state — separate from generate state so the
  // operator can check live + regenerate without clobbering one
  // result with the other.
  const [liveBusy, setLiveBusy] = useState(false)
  const [liveError, setLiveError] = useState(null)
  const [liveResult, setLiveResult] = useState(null)
  useEffect(() => {
    if (!busy) { setElapsed(0); return }
    const start = Date.now()
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    return () => clearInterval(tick)
  }, [busy])
  // Reset on version change so a humanize / re-proposal clears the
  // stale schema view. Also reset on page change (landingPageId) so
  // navigating between pages doesn't leak Milwaukee's results onto
  // FAQ's panel (same bug class we just fixed on DeployBlock).
  useEffect(() => {
    setResult(null); setError(null); setCopiedIndex(null)
    setLiveResult(null); setLiveError(null); setLiveBusy(false)
  }, [versionId, landingPageId])

  const handleGenerate = async () => {
    if (busy || !landingPageId || !versionId) return
    setBusy(true); setError(null)
    try {
      const r = await api.generateLandingPageSchema(landingPageId, versionId)
      setResult(r)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleCheckLive = async () => {
    if (liveBusy || !landingPageId) return
    setLiveBusy(true); setLiveError(null)
    try {
      const r = await api.checkLiveSchema(landingPageId)
      setLiveResult(r)
    } catch (e) {
      setLiveError(e?.message || String(e))
    } finally {
      setLiveBusy(false)
    }
  }

  const copy = async (idx, text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIndex(idx)
      setTimeout(() => setCopiedIndex(c => (c === idx ? null : c)), 2000)
    } catch {
      alert('Clipboard write failed — manually copy from the textarea.')
    }
  }
  const copyAll = async () => {
    if (!result?.blocks) return
    const scripts = result.blocks.map(b => `<script type="application/ld+json">\n${JSON.stringify(b.jsonld, null, 2)}\n</script>`).join('\n\n')
    try {
      await navigator.clipboard.writeText(scripts)
      setCopiedIndex(-1)
      setTimeout(() => setCopiedIndex(c => (c === -1 ? null : c)), 2000)
    } catch {
      alert('Clipboard write failed.')
    }
  }

  const blocks = result?.blocks || []
  const missing = result?.missing_data_notes || []

  return (
    <div className="border border-[#6C5CE7]/30 rounded p-3 space-y-2 bg-[#fafbff]">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium text-[#6C5CE7]">🏷️ Schema.org structured data</span>
        <span className="text-[9px] text-muted">Generates JSON-LD blocks (LocalBusiness, Service, FAQ, BreadcrumbList) tailored to this page.</span>
        <div className="flex-1" />
        <button
          onClick={handleGenerate}
          disabled={busy || !versionId}
          className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
          title="Sends the current version's content + tenant brand info to Claude. Returns ready-to-paste JSON-LD."
        >{busy ? `Generating… ${elapsed}s` : result ? '🔄 Re-generate' : '🏷️ Generate schema'}</button>
        {result && blocks.length > 0 && (
          <button
            onClick={copyAll}
            className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer"
            title="Copy all blocks as a single <script>-wrapped chunk ready to paste into a theme snippet or schema plugin."
          >{copiedIndex === -1 ? '✓ Copied' : '📋 Copy all'}</button>
        )}
        <button
          onClick={handleCheckLive}
          disabled={liveBusy || !landingPageId}
          className="text-[10px] py-1 px-2 bg-white border border-[#2D9A5E] text-[#2D9A5E] rounded cursor-pointer disabled:opacity-50"
          title="Fetch the LIVE page from WordPress + validate its JSON-LD entities. Same validator the deploy success block uses, but you can run it anytime — useful for confirming schema is actually rendering correctly without redeploying."
        >{liveBusy ? 'Checking…' : '🔎 Check live schema'}</button>
      </div>
      {busy && <div className="text-[10px] text-muted italic">Claude is generating JSON-LD blocks (~10-30s). One block per applicable schema type.</div>}
      {error && <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>}
      {!result && !busy && !error && (
        <div className="text-[10px] text-muted italic">
          Click Generate to produce schema blocks for this version. Operator copies each block into Yoast Premium custom schema, Schema Pro, or a theme snippet.
        </div>
      )}
      {result && blocks.length === 0 && (
        <div className="text-[10px] text-muted italic">No applicable schema types detected for this page.</div>
      )}
      {blocks.length > 0 && (
        <div className="space-y-1.5">
          {blocks.map((b, i) => (
            <details key={i} className="text-[10px] bg-white border border-[#e5e5e5] rounded">
              <summary className="cursor-pointer py-1 px-2 flex items-center gap-2">
                <span className="font-medium text-ink">{b.type}</span>
                <span className="text-muted truncate flex-1">{b.why}</span>
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); copy(i, JSON.stringify(b.jsonld, null, 2)) }}
                  className="text-[9px] py-0.5 px-1.5 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer"
                >{copiedIndex === i ? '✓ Copied' : '📋 Copy'}</button>
              </summary>
              <pre className="p-2 bg-[#fafafa] overflow-auto max-h-[300px] text-[9px] font-mono whitespace-pre-wrap">{JSON.stringify(b.jsonld, null, 2)}</pre>
            </details>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <details className="text-[10px] bg-[#fff7ed] border border-[#d97706]/30 rounded">
          <summary className="cursor-pointer py-1 px-2 text-[#d97706] font-medium">⚠ {missing.length} field(s) Claude skipped because it didn't have the data</summary>
          <ul className="list-disc pl-5 py-1 px-2 text-muted">
            {missing.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </details>
      )}
      {result && (
        <div className="text-[9px] text-muted italic">
          These blocks deploy automatically with the page — they're appended to the body as <code>&lt;script type="application/ld+json"&gt;</code> tags inside Gutenberg <code>core/html</code> blocks, fenced so re-deploys replace rather than duplicate. No paste required. (If your install also runs Yoast Premium's auto-schema, both will coexist — Google merges duplicate JSON-LD blocks of the same type.)
        </div>
      )}

      {/* Live-schema check results — what's CURRENTLY on the
          published page (after our injection + Yoast auto-emit +
          any other plugin/theme schema). Separate from the
          generate-schema results above so the operator can compare
          "what we generated for THIS version" vs "what's actually
          live now." */}
      {liveError && <div className="text-[10px] text-[#c0392b] mt-1">⚠ Live check: {liveError}</div>}
      {liveResult && (
        <div className="border-t border-[#6C5CE7]/20 pt-2 mt-1 space-y-1">
          <div className="text-[10px] font-medium text-[#2D9A5E]">🔎 Live page schema (just fetched from {liveResult.url})</div>
          <SchemaValidationSummary v={liveResult} />
          <div className="text-[9px] text-muted italic">
            Shows ALL JSON-LD on the live page — what we injected, what Yoast auto-emits, what the theme/other plugins emit. If you see types here you didn't expect (e.g. a rogue LocalBusiness), it's coming from somewhere outside Posty Posty's pipeline.
          </div>
        </div>
      )}
    </div>
  )
}

function DeployBlock({ landingPageId, versionId, onDeployed, requireBackupAck }) {
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
  // Reset deploy state on page/version switch. Without this, the
  // ✓ Deployed success block (including schema_validation summary
  // + wp_link) from a prior deploy stays visible when the operator
  // navigates to a different page — they see the OLD page's
  // validation results misattributed to the NEW page. Real bug
  // observed when deploying Milwaukee then opening FAQ.
  useEffect(() => {
    setSuccess(null); setError(null); setBusy(false)
  }, [landingPageId, versionId])
  const handleDeploy = async () => {
    if (busy || !landingPageId || !versionId) return
    // Run the deploy after the backup-guide gate. If operator
    // hasn't acknowledged the backup guide for this tenant yet,
    // requireBackupAck opens the modal and only calls actualDeploy
    // after acknowledgment. If already acknowledged, it runs
    // immediately. Falls through if requireBackupAck is missing
    // (defensive — unused but keeps DeployBlock independently
    // testable).
    const actualDeploy = async () => {
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
    if (typeof requireBackupAck === 'function') {
      requireBackupAck(actualDeploy)
    } else {
      actualDeploy()
    }
  }
  return (
    <div data-workflow-anchor="deploy" className="border border-[#c0392b]/40 rounded p-3 bg-[#fef2f2] space-y-2">
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
          {success.schema_validation && <SchemaValidationSummary v={success.schema_validation} />}
          {success.wp_link && (
            <ExternalValidatorLinks liveUrl={success.wp_link} />
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

// Hierarchical render of the managed pages. Parents render at top
// level; children appear indented under them. Only one level of
// indent is rendered even if the DB supports deeper nesting —
// arbitrary depth would get unwieldy in a flat list. If/when an
// operator legitimately needs 3 levels, we'd swap this for a
// tree component; for now the use case is `LA → Pasadena/Downey`
// which is two levels.
// Determine workflow completion state for a page. Used by both
// the filter chips (count pages by state) and the inline next-step
// indicator on each row. Returns: { hasAudit, hasAi, hasVoice,
// hasDeploy, isComplete, nextStep }.
function getPageWorkflowState(page) {
  const hasAudit = !!page.last_audited_at
  const hasAi = !!page.latest_ai_detection
  const hasVoice = !!page.latest_voice_check
  const hasDeploy = !!page.last_deployed_at
  // "Complete" = audited + AI checked + voice checked + deployed
  // (and deployed AFTER the last audit so changes are applied).
  const auditApplied = hasAudit && hasDeploy &&
    new Date(page.last_deployed_at) >= new Date(page.last_audited_at)
  const isComplete = hasAudit && hasAi && hasVoice && hasDeploy && auditApplied
  // Recommend the EARLIEST missing step in the standard flow.
  let nextStep = null
  if (!hasAudit) nextStep = 'audit'
  else if (!hasAi) nextStep = 'ai-check'
  else if (!hasVoice) nextStep = 'voice-check'
  else if (!hasDeploy || !auditApplied) nextStep = 'deploy'
  return { hasAudit, hasAi, hasVoice, hasDeploy, auditApplied, isComplete, nextStep }
}

// Top-level managed pages panel with column headers + filter chips
// for completion state. Filters operate client-side over the
// already-fetched pages array. Filter options:
//   • All — every page
//   • Needs audit — last_audited_at is null
//   • Needs AI check — latest_ai_detection is null
//   • Needs voice check — latest_voice_check is null
//   • Not deployed — last_deployed_at is null
//   • Complete — every step done + deploy is after last audit
// Each chip shows the matching count so the operator sees at a
// glance how much work is left site-wide.
function ManagedPagesPanel({ pages, onOpen, defaultPostId, activeLandingPageId }) {
  const [filter, setFilter] = useState('all')

  const counts = useMemo(() => {
    const c = { all: pages.length, audit: 0, ai: 0, voice: 0, deploy: 0, complete: 0 }
    for (const p of pages) {
      const s = getPageWorkflowState(p)
      if (!s.hasAudit) c.audit++
      if (!s.hasAi) c.ai++
      if (!s.hasVoice) c.voice++
      if (!s.hasDeploy || !s.auditApplied) c.deploy++
      if (s.isComplete) c.complete++
    }
    return c
  }, [pages])

  const filteredPages = useMemo(() => {
    if (filter === 'all') return pages
    return pages.filter(p => {
      const s = getPageWorkflowState(p)
      if (filter === 'audit') return !s.hasAudit
      if (filter === 'ai') return !s.hasAi
      if (filter === 'voice') return !s.hasVoice
      if (filter === 'deploy') return !s.hasDeploy || !s.auditApplied
      if (filter === 'complete') return s.isComplete
      return true
    })
  }, [pages, filter])

  const chipCls = (key) =>
    `text-[10px] py-1 px-2 rounded cursor-pointer whitespace-nowrap border ${
      filter === key
        ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]'
        : 'bg-white text-ink border-[#e5e5e5] hover:bg-[#f0eff5]'
    }`

  return (
    <div className="bg-white border border-[#e5e5e5] rounded p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium">Managed pages</span>
        <span className="text-[10px] text-muted">— filter by what's left to do</span>
      </div>
      {/* Filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => setFilter('all')} className={chipCls('all')}>All ({counts.all})</button>
        <button onClick={() => setFilter('audit')} className={chipCls('audit')} title="Pages that have never been audited">Needs audit ({counts.audit})</button>
        <button onClick={() => setFilter('ai')} className={chipCls('ai')} title="Pages where AI detection has not been run on the latest version">Needs AI check ({counts.ai})</button>
        <button onClick={() => setFilter('voice')} className={chipCls('voice')} title="Pages where brand voice check has not been run on the latest version">Needs voice check ({counts.voice})</button>
        <button onClick={() => setFilter('deploy')} className={chipCls('deploy')} title="Pages never deployed OR deployed before the last audit (changes pending)">Needs deploy ({counts.deploy})</button>
        <button onClick={() => setFilter('complete')} className={chipCls('complete')} title="Audited + AI checked + voice checked + deployed after audit">Complete ({counts.complete})</button>
      </div>
      {/* Column headers */}
      <div className="grid items-center gap-2 text-[9px] text-muted uppercase font-medium px-2 py-1 border-b border-[#e5e5e5]" style={{ gridTemplateColumns: '1fr 60px 70px 70px 70px 70px 70px' }}>
        <span>Page</span>
        <span className="text-right">WP #</span>
        <span className="text-right" title="Last imported from WordPress">📥 Imported</span>
        <span className="text-right" title="Last audited (analysis date)">🔍 Audited</span>
        <span className="text-right" title="Last AI-detection score on latest version">🤖 AI</span>
        <span className="text-right" title="Last brand-voice verdict on latest version">🎙️ Voice</span>
        <span className="text-right" title="Last deployed to WordPress">🚀 Deployed</span>
      </div>
      {filteredPages.length === 0 ? (
        <div className="text-[10px] text-muted italic px-2 py-3 text-center">
          No pages match this filter. {filter !== 'all' && <button onClick={() => setFilter('all')} className="underline text-[#6C5CE7] bg-transparent border-none cursor-pointer">Show all</button>}
        </div>
      ) : (
        <ManagedPagesTree
          pages={filteredPages}
          onOpen={onOpen}
          defaultPostId={defaultPostId}
          activeLandingPageId={activeLandingPageId}
        />
      )}
    </div>
  )
}

function ManagedPagesTree({ pages, onOpen, defaultPostId, activeLandingPageId }) {
  // Build a parent → children map. Orphans (children whose parent
  // doesn't resolve in this list, e.g. cross-tenant deletion) get
  // bumped to top level so they stay accessible.
  const byId = new Map(pages.map(p => [p.id, p]))
  const parents = []
  const childrenByParent = new Map()
  for (const p of pages) {
    const parentId = p.parent_landing_page_id || null
    if (parentId && byId.has(parentId)) {
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, [])
      childrenByParent.get(parentId).push(p)
    } else {
      parents.push(p)
    }
  }
  // Pinned default-page row at the top — surfaces the operator's
  // chosen default landing page (set via the Default page section)
  // so it's always easy to find regardless of where it sits in the
  // parent/child tree below. If the default isn't imported yet
  // (no matching page in the list), we just skip it — the Import
  // default button handles that case.
  const defaultPage = defaultPostId
    ? pages.find(p => p.wp_post_id === defaultPostId)
    : null
  return (
    <div className="space-y-1">
      {defaultPage && (
        <div className="border border-[#6C5CE7]/40 rounded p-1 bg-[#fafbff] mb-2">
          <div className="text-[9px] text-[#6C5CE7] font-medium px-1 pb-1">⭐ Default page (set in Default page section above)</div>
          <PageRow
            page={defaultPage}
            onOpen={onOpen}
            indent={0}
            isDefault
            isActive={activeLandingPageId === defaultPage.id}
          />
        </div>
      )}
      {parents.map(p => (
        <div key={p.id}>
          <PageRow
            page={p}
            onOpen={onOpen}
            indent={0}
            isDefault={defaultPostId && p.wp_post_id === defaultPostId}
            dimmed={defaultPostId && p.wp_post_id === defaultPostId}
            isActive={activeLandingPageId === p.id}
          />
          {(childrenByParent.get(p.id) || []).map(child => (
            <PageRow
              key={child.id}
              page={child}
              onOpen={onOpen}
              indent={1}
              isDefault={defaultPostId && child.wp_post_id === defaultPostId}
              dimmed={defaultPostId && child.wp_post_id === defaultPostId}
              isActive={activeLandingPageId === child.id}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function PageRow({ page, onOpen, indent = 0, isDefault = false, dimmed = false, isActive = false }) {
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—'
  const ai = page.latest_ai_detection || null
  const voice = page.latest_voice_check || null
  // AI score color: low (≤40%) = green, mid (40-65%) = amber, high (>65%) = red.
  const aiScore = ai?.score
  const aiClass = aiScore == null ? 'text-muted'
    : aiScore <= 40 ? 'text-[#16a34a]'
    : aiScore <= 65 ? 'text-[#d97706]'
    : 'text-[#c0392b]'
  const voiceScore = voice?.overall_score
  const voiceClass = voiceScore == null ? 'text-muted'
    : voiceScore >= 75 ? 'text-[#16a34a]'
    : voiceScore >= 50 ? 'text-[#d97706]'
    : 'text-[#c0392b]'
  return (
    <button
      onClick={() => onOpen(page)}
      className={`w-full grid items-center gap-2 text-[11px] py-1.5 px-2 ${
        isActive ? 'bg-[#dcfce7] border-[#16a34a]/40' :
        isDefault && !dimmed ? 'bg-[#f5f3ff] border-[#6C5CE7]/30' : 'bg-[#fafafa] border-[#e5e5e5]'
      } hover:bg-[#f0eff5] border rounded cursor-pointer text-left ${dimmed ? 'opacity-60' : ''}`}
      style={{
        ...(indent > 0 ? { marginLeft: `${indent * 16}px` } : {}),
        gridTemplateColumns: '1fr 60px 70px 70px 70px 70px 70px',
      }}
      title={dimmed ? 'Also pinned at the top as the Default page' : isActive ? 'Currently loaded in the workspace below' : undefined}
    >
      <div className="flex items-center gap-2 min-w-0">
        {indent > 0 && <span className="text-muted">↳</span>}
        <span className="font-medium truncate flex-1">{page.label || `Post ${page.wp_post_id}`}</span>
        {isActive && <span className="text-[8px] bg-[#16a34a] text-white py-0.5 px-1 rounded uppercase font-bold">Loaded</span>}
        {isDefault && !dimmed && <span className="text-[8px] bg-[#6C5CE7] text-white py-0.5 px-1 rounded uppercase">Def</span>}
        {page.cornerstone && <span className="text-[8px] bg-[#6C5CE7] text-white py-0.5 px-1 rounded uppercase">Corn</span>}
      </div>
      <span className="font-mono text-[9px] text-muted text-right">#{page.wp_post_id}</span>
      <span
        className="text-[9px] text-muted text-right whitespace-nowrap"
        title={`Last imported: ${page.last_imported_at ? new Date(page.last_imported_at).toLocaleString() : 'never'}`}
      >{fmtDate(page.last_imported_at)}</span>
      <span
        className={`text-[9px] text-right whitespace-nowrap ${page.last_audited_at ? 'text-[#6C5CE7]' : 'text-muted'}`}
        title={`Last audited: ${page.last_audited_at ? new Date(page.last_audited_at).toLocaleString() : 'never audited'}`}
      >{fmtDate(page.last_audited_at)}</span>
      <span
        className={`text-[9px] text-right whitespace-nowrap ${aiClass}`}
        title={ai ? `AI score ${aiScore}% on ${ai.detected_at ? new Date(ai.detected_at).toLocaleString() : 'unknown'} — ${ai.actionable_flagged_count ?? '?'} actionable flagged sentence(s)` : 'AI check never run'}
      >{ai ? `${aiScore}%` : '—'}</span>
      <span
        className={`text-[9px] text-right whitespace-nowrap ${voiceClass}`}
        title={voice ? `Voice score ${voiceScore}, verdict: ${voice.verdict || '?'}, checked ${voice.checked_at ? new Date(voice.checked_at).toLocaleString() : 'unknown'} — ${voice.actionable_drift_count ?? '?'} actionable drift(s)` : 'Voice check never run'}
      >{voice ? voiceScore : '—'}</span>
      <span
        className={`text-[9px] text-right whitespace-nowrap ${page.last_deployed_at ? 'text-[#16a34a]' : 'text-muted'}`}
        title={`Last deployed: ${page.last_deployed_at ? new Date(page.last_deployed_at).toLocaleString() : 'never deployed'}`}
      >{fmtDate(page.last_deployed_at)}</span>
    </button>
  )
}

// Create-new-landing-page form. Collapsed by default to avoid
// cluttering the steady-state Landing tab. When expanded:
//   - Title (required) — becomes WP page title
//   - Slug (optional) — WP auto-generates from title if blank
//   - Parent (optional, dropdown of existing pages) — sets both
//     our internal parent_landing_page_id FK AND WP's native
//     parent post id so the WP page tree mirrors ours.
//   - Status — draft (default; safe) or publish (live immediately)
//
// On success: parent re-loads + opens the new page in the workspace.
function CreateNewLandingPage({ pages, onCreated }) {
  const [open, setOpen] = useState(false)
  const [templates, setTemplates] = useState([])
  const [templateId, setTemplateId] = useState('') // '' = blank (no template)
  const [templateVars, setTemplateVars] = useState({})
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [parentId, setParentId] = useState('')
  const [status, setStatus] = useState('draft')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Load templates on first open.
  useEffect(() => {
    if (!open || templates.length > 0) return
    api.listLandingPageTemplates().then(r => setTemplates(r.templates || [])).catch(() => {})
  }, [open, templates.length])

  const activeTemplate = templates.find(t => t.id === templateId) || null
  // When the template changes, reset templateVars + clear title/slug
  // (so the template's title/slug pattern takes over). When switching
  // to "blank" template (''), keep whatever the operator typed.
  useEffect(() => {
    if (!templateId) return
    setTemplateVars({})
    setTitle('')
    setSlug('')
  }, [templateId])

  const reset = () => {
    setTemplateId(''); setTemplateVars({})
    setTitle(''); setSlug(''); setParentId(''); setStatus('draft'); setError(null)
  }

  // Validate required placeholders for the chosen template.
  const missingPlaceholders = activeTemplate
    ? (activeTemplate.placeholders || []).filter(p => p.required && !templateVars[p.key]?.trim())
    : []

  const canCreate = activeTemplate
    ? missingPlaceholders.length === 0
    : title.trim().length > 0

  const handleCreate = async () => {
    if (busy || !canCreate) return
    setBusy(true); setError(null)
    try {
      const payload = {
        parent_landing_page_id: parentId ? Number(parentId) : undefined,
        status,
      }
      if (activeTemplate) {
        // Template-driven create. Server resolves title / slug /
        // body / strategy_hint from template + template_vars.
        payload.template_id = activeTemplate.id
        payload.template_vars = templateVars
        // Operator overrides (rare — most operators just use the template defaults).
        if (title.trim()) payload.title = title.trim()
        if (slug.trim()) payload.slug = slug.trim()
      } else {
        // Blank create — operator types everything.
        payload.title = title.trim()
        if (slug.trim()) payload.slug = slug.trim()
      }
      const r = await api.createLandingPage(payload)
      reset()
      setOpen(false)
      if (typeof onCreated === 'function' && r?.landing_page_id) {
        onCreated(r.landing_page_id)
      }
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] py-1 px-3 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer"
        title="Spin up a brand-new WP page + landing_pages row. Status defaults to draft so nothing goes live until you deploy."
      >+ Create new page</button>
    )
  }
  return (
    <div className="bg-white border border-[#6C5CE7]/40 rounded p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium">+ Create new page</span>
        <span className="text-[9px] text-muted">Creates a draft WP page + manages it here</span>
        <div className="flex-1" />
        <button
          onClick={() => { reset(); setOpen(false) }}
          className="text-[10px] text-muted bg-transparent border-none cursor-pointer"
        >✕ Close</button>
      </div>
      {/* Template picker — first thing the operator picks. "Blank"
          option keeps the old behavior (operator types title/slug/
          body themselves). Picking a template surfaces its specific
          placeholder fields below + bakes in the right strategy_hint
          at create time. */}
      <label className="text-[10px] block">
        <span className="text-muted">Template</span>
        <select
          value={templateId}
          onChange={e => setTemplateId(e.target.value)}
          className="w-full mt-0.5 text-[11px] border border-[#e5e5e5] rounded py-1 px-2 bg-white"
        >
          <option value="">Blank (operator types everything)</option>
          {templates.map(t => (
            <option key={t.id} value={t.id}>{t.name} — {t.description.slice(0, 80)}{t.description.length > 80 ? '…' : ''}</option>
          ))}
        </select>
      </label>

      {/* Template-specific placeholder fields. Each template
          declares which inputs it needs (city, state, category,
          etc.). Required ones get a red asterisk. Operator-typed
          values populate templateVars. */}
      {activeTemplate && (activeTemplate.placeholders || []).length > 0 && (
        <div className="bg-[#fafbff] border border-[#6C5CE7]/20 rounded p-2 space-y-1.5">
          <div className="text-[9px] text-[#6C5CE7] font-medium">{activeTemplate.name} placeholders</div>
          <div className="grid grid-cols-2 gap-2">
            {(activeTemplate.placeholders || []).map(ph => (
              <label key={ph.key} className="text-[10px] block">
                <span className="text-muted">
                  {ph.label}{ph.required ? <span className="text-[#c0392b]"> *</span> : ''}
                </span>
                <input
                  type="text"
                  value={templateVars[ph.key] || ''}
                  onChange={e => setTemplateVars(v => ({ ...v, [ph.key]: e.target.value }))}
                  placeholder={ph.example ? `e.g. ${ph.example}` : ''}
                  className="w-full mt-0.5 text-[11px] border border-[#e5e5e5] rounded py-1 px-2 outline-none focus:border-[#6C5CE7]"
                />
              </label>
            ))}
          </div>
          {missingPlaceholders.length > 0 && (
            <div className="text-[9px] text-[#c0392b]">Fill in required fields: {missingPlaceholders.map(p => p.label).join(', ')}</div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {!activeTemplate && (
          <label className="text-[10px] block">
            <span className="text-muted">Title <span className="text-[#c0392b]">*</span></span>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Make & Take Milwaukee — Candle bars, paint & sip…"
              className="w-full mt-0.5 text-[11px] border border-[#e5e5e5] rounded py-1 px-2 outline-none focus:border-[#6C5CE7]"
            />
          </label>
        )}
        {activeTemplate && (
          <label className="text-[10px] block">
            <span className="text-muted">Title (override — optional)</span>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="(uses template title if blank)"
              className="w-full mt-0.5 text-[11px] border border-[#e5e5e5] rounded py-1 px-2 outline-none focus:border-[#6C5CE7]"
            />
          </label>
        )}
        <label className="text-[10px] block">
          <span className="text-muted">Slug ({activeTemplate ? 'override — optional' : 'optional'})</span>
          <input
            type="text"
            value={slug}
            onChange={e => setSlug(e.target.value.replace(/[^a-z0-9/-]/gi, '-').toLowerCase())}
            placeholder={activeTemplate ? '(uses template slug if blank)' : 'auto from title'}
            className="w-full mt-0.5 text-[11px] border border-[#e5e5e5] rounded py-1 px-2 outline-none focus:border-[#6C5CE7] font-mono"
          />
        </label>
        <label className="text-[10px] block">
          <span className="text-muted">Parent page (optional)</span>
          <select
            value={parentId}
            onChange={e => setParentId(e.target.value)}
            className="w-full mt-0.5 text-[11px] border border-[#e5e5e5] rounded py-1 px-2 bg-white"
          >
            <option value="">(none — top level)</option>
            {pages.filter(p => !p.parent_landing_page_id).map(p => (
              <option key={p.id} value={p.id}>{p.label || `Post ${p.wp_post_id}`}</option>
            ))}
          </select>
        </label>
        <label className="text-[10px] block">
          <span className="text-muted">Initial status</span>
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="w-full mt-0.5 text-[11px] border border-[#e5e5e5] rounded py-1 px-2 bg-white"
          >
            <option value="draft">Draft (recommended — not live yet)</option>
            <option value="publish">Publish (live immediately)</option>
          </select>
        </label>
      </div>
      {error && <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>}
      <div className="flex items-center gap-2">
        <button
          onClick={handleCreate}
          disabled={busy || !canCreate}
          className="text-[11px] py-1 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
        >{busy ? 'Creating…' : '+ Create'}</button>
        <span className="text-[9px] text-muted">
          {activeTemplate
            ? `Uses the ${activeTemplate.name} template — body + strategy hint pre-filled with the right framing for this page type.`
            : 'Creates a blank WP page. Set strategy hint + run audit + propose afterward to generate content.'}
        </span>
      </div>
    </div>
  )
}

// Renders the brand-voice consistency check result. Score bar +
// verdict tag + summary + quoted drift passages with fix
// directions. Designed for a quick eyeball: "does this need a
// voice pass before deploy?"
function VoiceResult({ result }) {
  if (!result) return null
  const score = Number(result.overall_score) || 0
  const verdict = result.verdict || 'neutral-generic'
  const verdictColor = verdict === 'on-voice' ? 'bg-[#2D9A5E] text-white'
    : verdict === 'off-brand' ? 'bg-[#c0392b] text-white'
    : 'bg-[#d97706] text-white'
  const verdictLabel = verdict === 'on-voice' ? 'On-voice'
    : verdict === 'off-brand' ? 'Off-brand'
    : 'Neutral / generic'
  const barColor = score >= 75 ? 'bg-[#2D9A5E]' : score >= 50 ? 'bg-[#d97706]' : 'bg-[#c0392b]'
  return (
    <div className="space-y-1 text-[10px]">
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-[#f0f0f0] rounded h-3 overflow-hidden border border-[#e5e5e5]">
          <div className={`h-full ${barColor}`} style={{ width: `${Math.max(2, Math.min(100, score))}%` }} />
        </div>
        <span className={`py-0.5 px-1.5 rounded font-bold ${verdictColor}`}>{score}</span>
        <span className={`text-[9px] py-0.5 px-1.5 rounded border uppercase font-bold ${verdictColor.replace('bg-', 'border-').replace('text-white', 'bg-white text-[#111]')}`}>{verdictLabel}</span>
      </div>
      {result.summary && (
        <div className="text-ink">{result.summary}</div>
      )}
      {Array.isArray(result.drift_passages) && result.drift_passages.length > 0 && (
        <details open>
          <summary className="cursor-pointer text-muted">
            {result.drift_passages.length} passage{result.drift_passages.length === 1 ? '' : 's'} drifting — expand to view
          </summary>
          <div className="space-y-1.5 mt-1">
            {result.drift_passages.map((p, i) => (
              <div key={i} className="bg-[#fff7ed] border border-[#d97706]/30 rounded p-1.5">
                <div className="italic text-[#854d0e]">"{p.quote}"</div>
                {p.issue && <div className="mt-0.5"><b>Issue:</b> {p.issue}</div>}
                {p.fix_direction && <div className="mt-0.5"><b>Fix:</b> {p.fix_direction}</div>}
              </div>
            ))}
          </div>
        </details>
      )}
      {result.sample_count != null && (
        <div className="text-[9px] text-muted italic">
          Compared against tenant voice profile + {result.sample_count} on-voice sample page{result.sample_count === 1 ? '' : 's'}.
          {result.sample_count === 0 && ' No deployed pages yet for sampling — score is based on tenant voice signals alone, which is thinner.'}
        </div>
      )}
    </div>
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
// Inline CSS shared between the iframe (read-only) and the
// contentEditable mode (editable). Kept as a string so the iframe
// can include it via srcDoc and the editable mode can drop it
// into a <style> tag inside the wrapper.
const RENDERED_PREVIEW_CSS = `
    .fldy-preview { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #1f2937; background: #fff; }
    .fldy-preview h1, .fldy-preview h2, .fldy-preview h3, .fldy-preview h4, .fldy-preview h5, .fldy-preview h6 { font-weight: 700; line-height: 1.25; margin: 1.5em 0 0.5em; color: #111; }
    .fldy-preview h1 { font-size: 1.8em; }
    .fldy-preview h2 { font-size: 1.4em; }
    .fldy-preview h3 { font-size: 1.2em; }
    .fldy-preview p { margin: 0.8em 0; }
    .fldy-preview ul, .fldy-preview ol { margin: 0.8em 0; padding-left: 1.4em; }
    .fldy-preview li { margin: 0.3em 0; }
    .fldy-preview a { color: #6C5CE7; text-decoration: underline; }
    .fldy-preview a:hover { color: #5847d4; }
    .fldy-preview strong, .fldy-preview b { font-weight: 700; }
    .fldy-preview em, .fldy-preview i { font-style: italic; }
    .fldy-preview img { max-width: 100%; height: auto; display: block; margin: 1em 0; border-radius: 4px; }
    .fldy-preview blockquote { border-left: 3px solid #6C5CE7; margin: 1em 0; padding: 0.5em 1em; background: #f9f7ff; color: #4b5563; }
    .fldy-preview code { background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; }
    .fldy-preview pre { background: #f3f4f6; padding: 1em; border-radius: 4px; overflow-x: auto; }
    .fldy-preview hr { border: 0; border-top: 1px solid #e5e7eb; margin: 2em 0; }
    .fldy-preview figure { margin: 1em 0; }
    .fldy-preview figcaption { text-align: center; font-size: 0.85em; color: #6b7280; margin-top: 0.5em; }
    .fldy-preview .wp-block-image { margin: 1em 0; }
    .fldy-preview .wp-block-buttons { margin: 1em 0; }
    .fldy-preview .wp-block-button__link { display: inline-block; padding: 0.5em 1em; background: #6C5CE7; color: #fff !important; text-decoration: none !important; border-radius: 4px; }
    .fldy-preview[contenteditable="true"] { outline: 2px solid #2D9A5E; outline-offset: -2px; }
    .fldy-preview[contenteditable="true"]:focus { outline-color: #16a34a; }
`

function RenderedPreview({ html, tone = 'green' }) {
  const borderClass = tone === 'red' ? 'border-[#c0392b]/30' : 'border-[#2D9A5E]/30'
  // Iframe-flavored CSS (without the .fldy-preview class wrapper).
  const iframeCss = RENDERED_PREVIEW_CSS.replace(/\.fldy-preview\s*/g, "").replace(/\.fldy-preview\[contenteditable[^}]+\}/g, "")
  const fullCss = `html, body { margin:0; padding:0; }
    body { padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #1f2937; background: #fff; }
    ${iframeCss}`
  const srcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>${fullCss}</style></head><body>${html || '<p style="color:#9ca3af;font-style:italic;">(empty body)</p>'}</body></html>`
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

// Editable variant of RenderedPreview. Renders the body_html
// inside a contentEditable div (not an iframe — iframes can't be
// edited from the parent without scripts). The wrapper class
// fldy-preview applies the same WP-prose styling so it looks
// like the read-only preview.
//
// Save is explicit — operator clicks the green Save button when
// ready, rather than auto-save on blur. Two reasons:
//   1. contentEditable normalizes HTML on input (strips block
//      comments, reformats tags) — operator should explicitly
//      commit to that change, not have it happen silently.
//   2. Yoast FAQ blocks lose their `<!-- wp:yoast/faq-block -->`
//      wrapper when content-edited, which kills Yoast Premium's
//      FAQPage schema auto-emit. The microcopy warns about this.
function EditableRenderedPreview({ html, onSave, busy }) {
  const ref = useRef(null)
  const [dirty, setDirty] = useState(false)
  // Hydrate the contentEditable div with the current HTML once on
  // mount. Subsequent React re-renders DON'T overwrite the user's
  // in-progress edits — only the initial render seeds the DOM.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== html) {
      ref.current.innerHTML = html || ''
      setDirty(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const handleInput = () => {
    if (!dirty) setDirty(true)
  }
  const save = () => {
    if (!ref.current || busy || !dirty) return
    const newHtml = ref.current.innerHTML
    onSave(newHtml)
    setDirty(false)
  }
  const revert = () => {
    if (!ref.current) return
    ref.current.innerHTML = html || ''
    setDirty(false)
  }
  return (
    <div className="space-y-1">
      <style>{RENDERED_PREVIEW_CSS}</style>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        spellCheck={true}
        className="fldy-preview w-full rounded border border-[#2D9A5E]/40 bg-white overflow-auto"
        style={{ height: '500px' }}
      />
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-muted italic flex-1">
          Click anywhere in the preview to edit text inline. Save commits your changes to the version (deploy reads from there).
          {' '}<b>Heads-up:</b> editing here can normalize WordPress block markers — for Yoast FAQ blocks specifically, prefer the Body HTML source editor below to keep schema intact.
        </span>
        {dirty && (
          <button
            onClick={revert}
            disabled={busy}
            className="text-[9px] py-1 px-2 bg-white border border-[#e5e5e5] text-ink rounded cursor-pointer disabled:opacity-50"
          >Revert</button>
        )}
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="text-[9px] py-1 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50"
          title="Save the edits made in the preview. Deploy reads from the saved version."
        >{busy ? 'Saving…' : dirty ? '💾 Save preview edits' : '✓ Saved'}</button>
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
