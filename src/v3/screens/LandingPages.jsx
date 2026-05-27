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
import { LandingImagesPanel } from '../components/LandingImagesPanel'
import GapFindings from '../components/GapFindings'

export default function LandingPages() {
  const [state, setState] = useState({
    loading: true,
    error: null,
    wp_configured: false,
    wp_site_url: null,
    default_post_id: null,
    preview_post_id: null,
    acknowledgments: {},
    // Phase 1: site_platform is the renderer the tenant dispatches
    // to. 'wordpress' (default) keeps existing behavior; 'ecommerce'
    // starts being usable in Phase 4 (Square packets).
    site_platform: 'wordpress',
    // Phase 3: capability map from the BE renderer dispatcher.
    // Drives which action surfaces are enabled / disabled
    // (e.g. 🚀 Deploy hidden on ecommerce tenants until Phase 4).
    platform_capabilities: {
      can_deploy: true,
      can_preview: true,
      can_import: true,
      can_bulk_deploy: true,
      can_validate_live_schema: true,
      can_write_seo_meta: true,
      output_shape: 'rest-api',
      display_name: 'WordPress',
      emoji: '📝',
    },
    pages: [],
  })
  // Auto-shows the BackupGuideModal once before the first deploy
  // for this tenant. Acknowledgment persists on tenants.landing_
  // acknowledgments.backup_guide. Manual "📚 Backup guide" button
  // re-opens it any time after acknowledgment.
  const [backupGuideOpen, setBackupGuideOpen] = useState(false)
  const [platformSwitchOpen, setPlatformSwitchOpen] = useState(false)
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
  // Bulk import discovery — fetches all WP pages and imports any
  // not already managed. Onboards a new tenant in one click.
  const [bulkImport, setBulkImport] = useState(null)
  const [bulkImportBusy, setBulkImportBusy] = useState(false)
  const [bulkImportError, setBulkImportError] = useState(null)
  const runBulkImport = async (opts = {}) => {
    if (bulkImportBusy) return
    const refreshUrls = !!opts.refreshUrls
    const confirmMsg = refreshUrls
      ? 'Refresh URLs on all already-imported pages?\n\nThis re-fetches each page from WordPress and updates the stored URL + title to reflect the current canonical domain (useful after switching the WP primary domain). Versions + audit history are NOT touched. Pages not yet imported get imported.'
      : 'Discover every page on the WordPress install and import any not already managed?\n\nIdempotent — pages already managed are skipped. Use for onboarding a new tenant.'
    if (!confirm(confirmMsg)) return
    setBulkImportBusy(true); setBulkImportError(null); setBulkImport(null)
    try {
      const result = await api.bulkImportDiscover({ refreshUrls })
      setBulkImport(result)
      await reload()
      // Also refresh setupData so the Site Setup Wizard sees the
      // newly-imported pages immediately. Without this the wizard
      // shows stale page list from before the import.
      await refreshSetup()
    } catch (e) {
      setBulkImportError(e?.message || String(e))
    } finally {
      setBulkImportBusy(false)
    }
  }
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

  // ── Bulk deploy state ────────────────────────────────────────
  // Three-stage workflow:
  //   1. operator clicks "🚀 Deploy all ready" → preview loads
  //   2. modal shows preview list + Confirm button
  //   3. Confirm → BE starts background job → FE polls every 3s
  //      until status='done', then surfaces per-page results.
  const [bulkDeployOpen, setBulkDeployOpen] = useState(false)
  const [bulkDeployPreview, setBulkDeployPreview] = useState(null)
  const [bulkDeployPreviewError, setBulkDeployPreviewError] = useState(null)
  const [bulkDeployJob, setBulkDeployJob] = useState(null) // { status, total, processed, results }
  const [bulkDeployJobError, setBulkDeployJobError] = useState(null)
  const [bulkDeployElapsed, setBulkDeployElapsed] = useState(0)
  useEffect(() => {
    if (bulkDeployJob?.status !== 'running') { setBulkDeployElapsed(0); return }
    const start = bulkDeployJob.started_at ? new Date(bulkDeployJob.started_at).getTime() : Date.now()
    const tick = setInterval(() => setBulkDeployElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    return () => clearInterval(tick)
  }, [bulkDeployJob?.status, bulkDeployJob?.started_at])

  const openBulkDeploy = async () => {
    setBulkDeployOpen(true)
    setBulkDeployPreview(null); setBulkDeployPreviewError(null)
    setBulkDeployJob(null); setBulkDeployJobError(null)
    try {
      const r = await api.getBulkDeployPreview()
      setBulkDeployPreview(r)
    } catch (e) {
      setBulkDeployPreviewError(e?.message || String(e))
    }
    // Also check for any already-running job (operator closed the
    // modal mid-deploy — we should pick up the in-flight state on
    // re-open instead of acting like it never started).
    try {
      const s = await api.getBulkDeployStatus()
      if (s && s.status !== 'idle') setBulkDeployJob(s)
    } catch { /* fine */ }
  }

  // ── Sitewide keyword-rank report state ──────────────────────
  // Cheap (one GSC call) so no background-job pattern needed —
  // a single async request fills the panel.
  const [rankReportOpen, setRankReportOpen] = useState(false)
  const [rankReportBusy, setRankReportBusy] = useState(false)
  const [rankReport, setRankReport] = useState(null)
  const [rankReportError, setRankReportError] = useState(null)
  const runKeywordRankReport = async () => {
    if (rankReportBusy) return
    setRankReportOpen(true); setRankReportBusy(true); setRankReportError(null)
    try {
      const r = await api.getKeywordRankReport()
      setRankReport(r)
    } catch (e) {
      setRankReportError(e?.message || String(e))
    } finally {
      setRankReportBusy(false)
    }
  }

  // ── Sitewide voice-drift report state ───────────────────────
  // Sequential per-page voice-check pass; FE polls every 5s
  // (per-page Claude call is ~10-20s — no point checking faster).
  const [voiceDriftOpen, setVoiceDriftOpen] = useState(false)
  const [voiceDriftJob, setVoiceDriftJob] = useState(null)
  const [voiceDriftError, setVoiceDriftError] = useState(null)
  const [voiceDriftElapsed, setVoiceDriftElapsed] = useState(0)
  useEffect(() => {
    if (voiceDriftJob?.status !== 'running') { setVoiceDriftElapsed(0); return }
    const start = voiceDriftJob.started_at ? new Date(voiceDriftJob.started_at).getTime() : Date.now()
    const tick = setInterval(() => setVoiceDriftElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    return () => clearInterval(tick)
  }, [voiceDriftJob?.status, voiceDriftJob?.started_at])
  const openVoiceDriftReport = async () => {
    setVoiceDriftOpen(true); setVoiceDriftError(null)
    // Pick up any in-flight job on open (operator closed mid-run).
    try {
      const s = await api.getVoiceDriftReportStatus()
      if (s && s.status !== 'idle') setVoiceDriftJob(s)
    } catch { /* fine */ }
  }
  const runVoiceDriftReport = async () => {
    if (voiceDriftJob?.status === 'running') return
    if (!confirm('Run the voice-drift report? This runs Claude Sonnet on every managed page sequentially (~15-20s each) to score how on-voice each page reads against the tenant baseline. Total runtime scales with page count — expect ~5-10 min for a full sitemap.\n\nResults persist on each version row, so the per-page voice-check panel reflects the score after this completes. Continue?')) return
    setVoiceDriftError(null)
    try {
      const initial = await api.startVoiceDriftReport()
      setVoiceDriftJob(initial)
      const poll = setInterval(async () => {
        try {
          const r = await api.getVoiceDriftReportStatus()
          setVoiceDriftJob(r)
          if (r.status !== 'running') clearInterval(poll)
        } catch { /* keep polling */ }
      }, 5000)
    } catch (e) {
      setVoiceDriftError(e?.message || String(e))
    }
  }

  const triggerBulkDeploy = async () => {
    if (bulkDeployJob?.status === 'running') return
    if (!confirm(
      `Deploy ${bulkDeployPreview?.count || 0} page(s) to WordPress?\n\n` +
      `Each page's latest done proposal will be pushed to its WP post. Sequential — runs one page at a time to avoid hammering the WP REST API. ` +
      `Each deploy backs up the live page FIRST so rollback is always available.\n\n` +
      `Estimated time: ~${Math.max(1, Math.ceil((bulkDeployPreview?.count || 1) * 8 / 60))} minute(s) (~5-15s per page depending on schema generation + WP response).\n\n` +
      `Don't close the tab — refreshing loses the in-flight progress (the server keeps running, but the FE has to re-poll on reload).\n\n` +
      `Continue?`
    )) return
    setBulkDeployJobError(null)
    try {
      const initial = await api.startBulkDeploy()
      setBulkDeployJob(initial)
      // Poll every 3s until status flips off 'running'. Reasonable
      // floor — each deploy takes ~10s, no point hammering at 1s.
      const poll = setInterval(async () => {
        try {
          const r = await api.getBulkDeployStatus()
          setBulkDeployJob(r)
          if (r.status !== 'running') {
            clearInterval(poll)
            // Refresh the page list so deployed badges update.
            await reload()
          }
        } catch (e) {
          // Transient — keep polling.
        }
      }, 3000)
    } catch (e) {
      setBulkDeployJobError(e?.message || String(e))
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

  // Content recency — pages bucketed by days-since-last-deploy.
  // Surfaced in a RecencyBanner that nudges the operator to refresh
  // stale pages before rankings decay. Cheap query — no Claude
  // call. Loaded once on mount.
  const [recency, setRecency] = useState(null)
  const [recencyDismissed, setRecencyDismissed] = useState(false)
  useEffect(() => {
    let alive = true
    api.getLandingRecency()
      .then(r => { if (alive) setRecency(r) })
      .catch(() => { /* non-fatal — banner just won't show */ })
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
  const [previewDraft, setPreviewDraft] = useState('')
  const [previewSaving, setPreviewSaving] = useState(false)

  const reload = async () => {
    setState(s => ({ ...s, loading: true, error: null }))
    try {
      const r = await api.listLandingPages()
      setState({ loading: false, error: null, ...r })
      setDefaultDraft(r.default_post_id ? String(r.default_post_id) : '')
      setPreviewDraft(r.preview_post_id ? String(r.preview_post_id) : '')
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: e?.message || String(e) }))
    }
  }
  useEffect(() => { reload() }, [])

  // Deep-link handler: when LandingPages mounts from a URL like
  // /content-studio?go=landing&id=N, auto-select page #N once the
  // page list has loaded. Without this, the link from the Sitemap
  // Wizard's "Open in Pages" button just lands on the empty default
  // workspace state and the operator has to manually find their page
  // in the sidebar.
  useEffect(() => {
    if (state.loading || !state.pages || state.pages.length === 0) return
    if (typeof window === 'undefined') return
    let targetId
    try {
      const params = new URLSearchParams(window.location.search)
      targetId = Number(params.get('id'))
    } catch { return }
    if (!Number.isFinite(targetId)) return
    const target = state.pages.find(p => p.id === targetId)
    if (!target) return
    openPage(target)
    // Clear the query param so a manual reload doesn't re-fire the
    // deep-link logic (preserves the operator's actual navigation).
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('id')
      url.searchParams.delete('go')
      window.history.replaceState({}, '', url.toString())
    } catch {}
  }, [state.loading, state.pages])

  const handleSetPreview = async () => {
    if (previewSaving) return
    setPreviewSaving(true)
    try {
      await api.setLandingPagePreview(previewDraft.trim() || null)
      await reload()
    } catch (e) {
      alert('Save failed: ' + (e?.message || e))
    } finally {
      setPreviewSaving(false)
    }
  }

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
        page: {
          ...r.page,
          detected_schema: r.detected_schema || null,
          targeted_update_hint: full?.page?.targeted_update_hint || '',
        },
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
            const seoMeta = v.seo_meta || {}
            recoveredProposal = {
              version_id: v.id,
              created_at: v.created_at,
              recovered_from_history: true,
              proposal: {
                title: v.title,
                body_html: v.body_html,
                meta_description: v.meta_description,
                focus_keyword: v.focus_keyword,
                // Social-card + SEO-title fields live in seo_meta JSONB.
                // Surfacing here so the operator-edit UI can render +
                // save them.
                seo_title: seoMeta.seo_title || null,
                og_title: seoMeta.og_title || null,
                og_description: seoMeta.og_description || null,
                twitter_title: seoMeta.twitter_title || null,
                twitter_description: seoMeta.twitter_description || null,
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
        // Linked sitemap slot's hint, if any. Surfaced so the
        // Pages workspace can show divergence + offer a "📥 Copy
        // from slot" button when the slot has more content (e.g.
        // operator typed extensively into the slot editor; the
        // page wasn't synced because we removed the auto-cascade).
        linked_slot: r.linked_slot || null,
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
          // Per-page one-shot targeted-update prompt. Surfaced into
          // page so TargetedUpdateEditor hydrates with the saved
          // text on workspace open.
          targeted_update_hint: r.page?.targeted_update_hint || '',
          // Cached gap-analysis from the most recent operator-run
          // PageGapAnalysisPanel. Surfaced so the panel renders
          // findings on open without re-running the Claude call.
          last_gap_analysis: r.page?.last_gap_analysis || null,
          last_gap_analyzed_at: r.page?.last_gap_analyzed_at || null,
          last_gap_competitor_url: r.page?.last_gap_competitor_url || null,
          last_gap_version_id: r.page?.last_gap_version_id || null,
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
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold">Pages</h2>
            {/* Phase 5: platform pill is now clickable — opens
                the change-platform modal. */}
            <button
              onClick={() => setPlatformSwitchOpen(true)}
              className={
                state.site_platform === 'ecommerce'
                  ? 'text-[9px] py-0.5 px-1.5 rounded bg-[#fef3c7] text-[#92400e] border border-[#d97706]/40 font-mono cursor-pointer hover:bg-[#fde68a]'
                  : 'text-[9px] py-0.5 px-1.5 rounded bg-[#e0e7ff] text-[#3730a3] border border-[#6366f1]/40 font-mono cursor-pointer hover:bg-[#c7d2fe]'
              }
              title="Click to change publishing platform. Content + sitemap are preserved; the renderer (WordPress automated publish vs Square copy/paste packets) changes. Switch is reversible — pages already published stay live where they were published."
            >
              {state.site_platform === 'ecommerce' ? '🛒 Ecommerce' : '📝 WordPress'}
              <span className="ml-1 opacity-60">⚙</span>
            </button>
          </div>
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
        {/* Sitewide voice-drift report — scores every managed
            page against the tenant's voice baseline. Surfaces
            consistency outliers across the sitemap. */}
        <button
          onClick={openVoiceDriftReport}
          disabled={voiceDriftJob?.status === 'running'}
          className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer flex-shrink-0 whitespace-nowrap disabled:opacity-50"
          title="Run the brand-voice check on every managed page. Surfaces pages that drift from the tenant's voice baseline so you can re-propose them with the drift findings as feedback. ~15-20s per page. Results also persist on each version row so the per-page voice-check panel updates."
        >{voiceDriftJob?.status === 'running' ? `Checking… ${voiceDriftJob.processed}/${voiceDriftJob.total}` : '🎭 Voice drift report'}</button>
        {/* Sitewide keyword-rank report — pulls GSC current vs
            prior 28d for every (page, query) pair across the
            connected property. Tracks rank trajectory without
            needing a third-party SERP API. */}
        <button
          onClick={runKeywordRankReport}
          disabled={rankReportBusy}
          className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer flex-shrink-0 whitespace-nowrap disabled:opacity-50"
          title="Pull GSC current 28d vs prior 28d for every (page, query) on the connected property. Surfaces position trajectory + new/lost queries + which managed page each query lives on. ~3-8s — single GSC call."
        >{rankReportBusy ? 'Loading…' : '📈 Keyword ranks'}</button>
        {/* Bulk deploy — pushes every page whose latest done proposal
            hasn't been deployed yet. Sequential on the BE; FE polls
            for per-page progress. Use after fan-out + proposal
            iteration is complete and you're ready to ship a whole
            wave of pages at once. */}
        {state.wp_configured && state.platform_capabilities?.can_bulk_deploy && (
          <button
            onClick={openBulkDeploy}
            disabled={bulkDeployJob?.status === 'running'}
            className="text-[10px] py-1 px-2 bg-[#c0392b] text-white border-none rounded cursor-pointer flex-shrink-0 whitespace-nowrap disabled:opacity-50"
            title="Deploy every page whose latest done proposal hasn't been pushed to WP yet. Sequential — one page at a time. Each deploy backs up the live page first so rollback stays available. Opens a preview list first; you confirm before anything ships."
          >{bulkDeployJob?.status === 'running' ? `Deploying… ${bulkDeployJob.processed}/${bulkDeployJob.total}` : '🚀 Deploy all ready'}</button>
        )}
        {/* Phase 3: when bulk deploy isn't supported (ecommerce
            tenants), surface a "📦 Generate packets" CTA in its
            place. Phase 4 wires the actual packet-generation
            modal; for now it just informs the operator. */}
        {state.wp_configured && state.platform_capabilities?.output_shape === 'copy-paste-packet' && (
          <button
            disabled
            className="text-[10px] py-1 px-2 bg-[#fef3c7] text-[#92400e] border border-[#d97706]/40 rounded flex-shrink-0 whitespace-nowrap cursor-not-allowed opacity-80"
            title="Ecommerce tenants use copy-paste packets rather than automated publishing — Phase 4 of the multi-platform rollout ships those packet flows."
          >📦 Packets (Phase 4)</button>
        )}
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
            onClick={async () => { await refreshSetup(); setSetupWizardOpen(true) }}
            className="text-[10px] py-1 px-2 bg-[#16a34a] text-white border-none rounded cursor-pointer flex-shrink-0 whitespace-nowrap"
            title="Site Setup Wizard — walk through the canonical page set for this tenant. Map existing pages or create new ones, slot by slot. Progress saves automatically."
          >🪄 Site setup wizard</button>
        )}
        {/* Bulk discover + import — onboard a new tenant by pulling
            every existing WP page in one shot. Idempotent. */}
        {state.wp_configured && (
          <>
            <button
              onClick={() => runBulkImport()}
              disabled={bulkImportBusy}
              className="text-[10px] py-1 px-2 bg-white border border-[#2D9A5E] text-[#2D9A5E] rounded cursor-pointer flex-shrink-0 whitespace-nowrap disabled:opacity-50"
              title="Discover every page from WordPress and import any not already managed. Idempotent — pages already managed are skipped."
            >{bulkImportBusy ? 'Importing…' : '📥 Discover & import all WP pages'}</button>
            <button
              onClick={() => runBulkImport({ refreshUrls: true })}
              disabled={bulkImportBusy}
              className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer flex-shrink-0 whitespace-nowrap disabled:opacity-50"
              title="Re-fetch every page from WordPress and update the stored URL + title on already-imported pages. Use after switching the WP primary domain (e.g. Cloudways URL → canonical domain)."
            >{bulkImportBusy ? 'Refreshing…' : '🔄 Refresh URLs from WP'}</button>
          </>
        )}
      </div>

      {/* Bulk-import result panel — shows after a discover-and-import run. */}
      {bulkImportError && (
        <div className="bg-[#fef2f2] border border-[#c0392b]/30 rounded p-2 text-[10px] text-[#c0392b]">
          ⚠ Bulk import failed: {bulkImportError}
        </div>
      )}
      {bulkImport && (
        <details className="bg-white border border-[#2D9A5E]/40 rounded p-3 space-y-2">
          <summary className="cursor-pointer text-[11px] font-medium text-[#2D9A5E]">
            ✓ Bulk import complete — discovered {bulkImport.discovered}, imported {bulkImport.imported}, skipped {bulkImport.skipped_existing} already-managed{bulkImport.errors > 0 ? `, ${bulkImport.errors} errors` : ''}
          </summary>
          <div className="space-y-0.5 text-[9px] max-h-[300px] overflow-y-auto pt-1">
            {(bulkImport.pages || []).map((p, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5">
                <span className={`py-0.5 px-1 rounded uppercase text-[8px] font-bold ${
                  p.status === 'imported' ? 'bg-[#dcfce7] text-[#16a34a]' :
                  p.status === 'url-refreshed' ? 'bg-[#f5f3ff] text-[#6C5CE7]' :
                  p.status === 'already-imported' ? 'bg-[#f0f0f0] text-muted' :
                  p.status === 'error' ? 'bg-[#fef2f2] text-[#c0392b]' :
                  'bg-[#fafafa] text-muted'
                }`}>{
                  p.status === 'imported' ? '✓ new' :
                  p.status === 'url-refreshed' ? '🔄 url updated' :
                  p.status === 'already-imported' ? 'already' :
                  p.status === 'error' ? '⚠ error' :
                  p.status
                }</span>
                <span className="font-mono text-muted">#{p.wp_post_id}</span>
                <span className="font-medium flex-1 truncate">{p.title || '(no title)'}</span>
                {p.link && <a href={p.link} target="_blank" rel="noopener noreferrer" className="text-[#6C5CE7] underline truncate max-w-[150px]">{p.slug}</a>}
                {p.error && <span className="text-[#c0392b] truncate max-w-[200px]">{p.error}</span>}
              </div>
            ))}
          </div>
        </details>
      )}

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

      {/* Sitewide keyword-rank report — pulls GSC current vs prior
          28d for every (page, query). Live fetch, no caching. */}
      {rankReportOpen && (
        <KeywordRankReportPanel
          busy={rankReportBusy}
          report={rankReport}
          error={rankReportError}
          onClose={() => setRankReportOpen(false)}
          onOpenPage={(pageId) => {
            const p = state.pages.find(pp => pp.id === pageId)
            if (p) { openPage(p); setRankReportOpen(false) }
          }}
        />
      )}

      {/* Sitewide voice-drift report. Pre-kickoff shows a one-click
          start button + scope estimate; running/done shows per-page
          scores ranked worst-first so drift outliers surface fast. */}
      {voiceDriftOpen && (
        <VoiceDriftPanel
          job={voiceDriftJob}
          error={voiceDriftError}
          elapsed={voiceDriftElapsed}
          onStart={runVoiceDriftReport}
          onClose={() => setVoiceDriftOpen(false)}
          onOpenPage={(pageId) => {
            const p = state.pages.find(pp => pp.id === pageId)
            if (p) { openPage(p); setVoiceDriftOpen(false) }
          }}
        />
      )}

      {/* Bulk deploy preview + progress panel. Three states:
          (1) loading preview, (2) preview ready w/ Confirm,
          (3) running w/ per-page progress, (4) done w/ results. */}
      {bulkDeployOpen && (
        <BulkDeployPanel
          preview={bulkDeployPreview}
          previewError={bulkDeployPreviewError}
          job={bulkDeployJob}
          jobError={bulkDeployJobError}
          elapsed={bulkDeployElapsed}
          onConfirm={triggerBulkDeploy}
          onClose={() => setBulkDeployOpen(false)}
          onOpenPage={(pageId) => {
            const p = state.pages.find(pp => pp.id === pageId)
            if (p) { openPage(p); setBulkDeployOpen(false) }
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

      {/* Recency banner — nags the operator about pages that haven't
          shipped in a long time. Only renders when there's at least
          one stale (>90d) page. Dismiss is session-only (no server
          ack) — operator sees it again next visit so decaying pages
          stay top-of-mind. */}
      {!recencyDismissed && recency && (recency.summary.stale + recency.summary.very_stale + recency.summary.ancient) > 0 && (
        <RecencyBanner
          recency={recency}
          onDismiss={() => setRecencyDismissed(true)}
          onOpenPage={(pageId) => {
            const p = state.pages.find(pp => pp.id === pageId)
            if (p) openPage(p)
          }}
        />
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
          {/* Tenant default + ad-hoc import controls. Collapsed by
              default once the tenant has at least one managed page
              AND a configured default — operators only revisit this
              when wiring up a new tenant or switching the default.
              Auto-opens for fresh tenants (no managed pages) or when
              no default is set, so the configuration is obvious. */}
          <details className="bg-white border border-[#e5e5e5] rounded" open={!state.default_post_id || (state.pages || []).length === 0}>
            <summary className="cursor-pointer flex items-center gap-2 p-3">
              <span className="text-[11px] font-medium">Default page</span>
              <span className="text-[9px] text-muted">
                {state.default_post_id ? `(post #${state.default_post_id})` : '(not configured)'}
              </span>
              <span className="text-[9px] text-muted">— default landing-page workspace + import controls</span>
            </summary>
            <div className="px-3 pb-3 pt-0 space-y-2">
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
          </details>

          {/* Preview / scratchpad page configuration. Designate one WP
              page as a live-rendered sandbox. Operator pushes
              in-progress proposals here to see the rendered theme
              version before committing to a real deploy. Hidden from
              the Managed pages list + bulk-import. Same collapse
              rule as the Default-page block above. */}
          <details className="bg-white border border-[#e5e5e5] rounded" open={!state.preview_post_id || (state.pages || []).length === 0}>
            <summary className="cursor-pointer flex items-center gap-2 p-3">
              <span className="text-[11px] font-medium">🪞 Preview / scratchpad page</span>
              <span className="text-[9px] text-muted">
                {state.preview_post_id ? `(post #${state.preview_post_id})` : '(not configured)'}
              </span>
              <span className="text-[9px] text-muted">— sandbox page for in-progress proposals</span>
            </summary>
            <div className="px-3 pb-3 pt-0 space-y-2">
            <div className="text-[10px] text-muted">
              WP post ID of a designated sandbox page. The <b>Preview to sandbox</b> button (next to Deploy on each page) pushes the current proposal here so you can view the rendered theme output without committing a real deploy. Subsequent previews overwrite without version history. This page is hidden from the Managed pages list.
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={previewDraft}
                onChange={e => setPreviewDraft(e.target.value)}
                placeholder="e.g. 200 or https://example.com/wp-admin/post.php?post=200"
                className="flex-1 text-[11px] border border-[#e5e5e5] rounded py-1 px-2 outline-none focus:border-[#6C5CE7]"
              />
              <button
                onClick={handleSetPreview}
                disabled={previewSaving}
                className="text-[11px] py-1 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
              >{previewSaving ? 'Saving…' : 'Save preview page'}</button>
            </div>
            {state.preview_post_id && (
              <div className="text-[9px] text-muted italic">
                ✓ Preview configured (post #{state.preview_post_id}). Pushes from any page's workspace will overwrite this sandbox.
              </div>
            )}
            </div>
          </details>

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
              platformCapabilities={state.platform_capabilities}
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

      {/* Phase 5: platform switch modal. Triggered by clicking
          the platform pill in the header. Calls the BE endpoint
          + refreshes the page list so all action surfaces re-render
          with the new platform's capabilities. */}
      {platformSwitchOpen && (
        <PlatformSwitchModal
          currentPlatform={state.site_platform}
          targetUrl={state.wp_site_url}
          onClose={() => setPlatformSwitchOpen(false)}
          onSwitched={async (result) => {
            // Re-fetch the full state so platform_capabilities +
            // every dependent UI element (deploy button, etc.)
            // re-renders.
            await reload()
            setPlatformSwitchOpen(false)
          }}
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

function PageWorkspace({ data, requireBackupAck, platformCapabilities }) {
  const { capabilities = {}, history = [], landing_page_id, strategy_hint: initialHint, ai_citations: initialCitations, recovered_audit: recoveredAudit, recovered_proposal: recoveredProposal, linked_slot: linkedSlot } = data
  // page is mirrored to local state so children that mutate the
  // version body (prepend-h1, future surgical edits) can refresh
  // the source-page panels (Heading structure, Body HTML preview,
  // links / images stats) without a full page refetch. Re-syncs
  // whenever the parent passes a new data.page (page switch or
  // explicit reload).
  const [page, setPage] = useState(data.page || {})
  useEffect(() => { setPage(data.page || {}) }, [data.page, landing_page_id])
  // Patch callback handed down through ProposalDiff → BodyEditor.
  // Accepts a partial like { body_html, headings, links, images } and
  // merges into local page state. Children call this after a body
  // mutation succeeds + the BE returns the re-parsed meta.
  const patchSourcePage = (patch) => {
    if (!patch || typeof patch !== 'object') return
    setPage(prev => ({ ...prev, ...patch }))
  }
  // Detect whether the page has real, audit-worthy content yet.
  // Freshly-scaffolded pages (Create WP draft from a Sitemap Wizard
  // slot) have only an imported placeholder version (~250 chars).
  // Auditing that produces noise; proposal "Update" mode is also
  // meaningless. We gate both surfaces on this heuristic:
  //   - A proposal exists (recovered or fresh) → real content
  //   - OR a non-imported version exists (ai-suggested / human-edited
  //     / deployed) → real content
  //   - OR multiple imported versions (operator re-imported) → real content
  // Computed once, used by both the Audit gate (#4) and the Proposal
  // UX simplification for fresh pages (#5).
  // NOTE: `proposal` is set further down via useState; we recompute
  // below where it's in scope. Stub here keeps the constant near
  // its dependent heuristics.
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

  // Per-finding state (manual_done / skipped / pending). Optimistic
  // update — we update local state immediately + PATCH the BE; if
  // the BE call fails, the next workspace re-open will reload from
  // BE state.
  const handleFindingStateChange = async (suggestionId, state) => {
    if (!audit?.audit_id) return
    setAudit(prev => {
      if (!prev) return prev
      const nextStates = { ...(prev.finding_states || {}) }
      if (state === 'pending') {
        delete nextStates[suggestionId]
      } else {
        nextStates[suggestionId] = { state, set_at: new Date().toISOString() }
      }
      return { ...prev, finding_states: nextStates }
    })
    try {
      await api.setAuditFindingState(landing_page_id, audit.audit_id, { suggestionId, state })
    } catch (e) {
      console.warn('Failed to persist finding state:', e?.message || e)
    }
  }
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

  // hasGeneratedContent: see big comment near top of PageWorkspace.
  // Gates the Audit button (#4) and simplifies the Proposal UX for
  // fresh pages (#5).
  const hasGeneratedContent = !!proposal
    || history.some(v => v.kind === 'ai-suggested' || v.kind === 'human-edited' || v.kind === 'deployed')
    || history.filter(v => v.kind === 'imported').length > 1
  // In-session check results (lifted up from ProposalDiff via the
  // onCheckResult callback) so the WorkflowWizard sees fresh AI +
  // voice scores immediately after a check completes, without
  // waiting for a workspace re-open. Reset on page switch.
  const [liveCheckResults, setLiveCheckResults] = useState({
    ai_detection: recoveredProposal?.ai_detection || null,
    voice_check: recoveredProposal?.voice_check || null,
  })
  useEffect(() => {
    setLiveCheckResults({
      ai_detection: recoveredProposal?.ai_detection || null,
      voice_check: recoveredProposal?.voice_check || null,
    })
  }, [landing_page_id, recoveredProposal])

  // Associated images for this landing_page. Populated by
  // LandingImagesPanel via its onImagesChanged callback so we
  // don't double-fetch. Threaded into ProposalDiff so the rendered
  // preview can show the featured image at the top + inline thumbs
  // below the body. Reset on page-switch.
  const [pageImages, setPageImages] = useState([])
  useEffect(() => { setPageImages([]) }, [landing_page_id])

  // Mirror of ProposalDiff's currentVersionId so DeployBlock can
  // live at the BOTTOM of the workspace (irreversible action =
  // last step). ProposalDiff still owns the source-of-truth state
  // (which it needs locally for humanize / checks / body editor);
  // it just calls back here whenever the version flips (humanize
  // creates a new version row). Reset on proposal swap.
  const [deployVersionId, setDeployVersionId] = useState(proposal?.version_id || null)
  useEffect(() => {
    setDeployVersionId(proposal?.version_id || null)
  }, [proposal?.version_id])
  const [proposalBusy, setProposalBusy] = useState(false)
  const [proposalError, setProposalError] = useState(null)
  const [proposalElapsed, setProposalElapsed] = useState(0)
  // 'generating' (Claude proposal) → 'scoring' (ZeroGPT) →
  // 'humanizing' (auto-regen with feedback) → 'scoring-regen' →
  // null. Drives the in-flight status line under the spinner so
  // the operator sees what stage the auto-pipeline is on.
  const [proposalPhase, setProposalPhase] = useState(null)
  useEffect(() => {
    if (!proposalBusy) { setProposalElapsed(0); return }
    const start = Date.now()
    setProposalElapsed(0)
    const tick = setInterval(() => setProposalElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    return () => clearInterval(tick)
  }, [proposalBusy])

  // Per-page input opt-outs for the next proposal call. Defaults
  // true; operator can uncheck specific inputs in the toggle panel
  // before generating. Reset on page switch so flags don't leak.
  const [includeAudit, setIncludeAudit] = useState(true)
  const [includeCitations, setIncludeCitations] = useState(true)
  useEffect(() => {
    setIncludeAudit(true); setIncludeCitations(true)
  }, [landing_page_id])

  const runProposal = async ({ useCheckFeedback = false, mode = "update", skipConfirm = false } = {}) => {
    if (proposalBusy || !landing_page_id) return
    if (audit?.audit_id && selectedSuggestions.size === 0 && !useCheckFeedback && includeAudit) {
      // Only enforce findings-selection check if audit-inputs are on
      return
    }
    // Scratch mode warning — replacing existing content is destructive
    // (current body becomes a backup but the proposed body is fresh).
    // skipConfirm=true bypasses the warning for the fresh-page Generate
    // path (#5) where there's no real content to overwrite anyway.
    if (mode === "scratch" && !skipConfirm) {
      const sourceHasContent = (page?.body_html || "").trim().length > 100
      if (sourceHasContent) {
        if (!confirm("⚠ Generate from scratch will REPLACE the existing page content with a brand-new AI-written body.\n\nThe current content will be saved as a backup version (you can roll back), but the proposed version won't preserve it. Existing operator edits, links, and structure may be lost.\n\nUse this for blank scaffolds or when the existing content needs a fundamental rewrite. For targeted improvements, use ✏️ Update existing content instead.\n\nContinue with scratch generation?")) {
          return
        }
      }
    }
    setProposalBusy(true); setProposalError(null); setProposalPhase('generating')
    try {
      // BE returns { version_id, status: 'running' } immediately;
      // the actual Claude work runs in the background. Poll the
      // version row until proposal_status flips to 'done' (or
      // 'failed').
      const start = await api.proposeLandingPageRewrite(landing_page_id, {
        ...(audit?.audit_id && includeAudit
          ? {
              auditId: audit.audit_id,
              acceptedSuggestionIds: Array.from(selectedSuggestions),
            }
          : {}),
        ...(useCheckFeedback ? { useCheckFeedback: true } : {}),
        mode,
        includeAudit,
        includeCitations,
      })
      const newVersionId = start?.version_id
      if (!newVersionId) throw new Error('Proposal kickoff returned no version_id')

      // Phase 1: poll the original version row until Claude finishes
      // writing the proposal body. Up to 5 minutes, every 5s.
      const deadline = Date.now() + 5 * 60 * 1000
      let firstVersion = null
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5000))
        try {
          const r = await api.getLandingPageVersion(landing_page_id, newVersionId)
          const v = r?.version
          if (v?.proposal_status === 'done') { firstVersion = v; break }
          if (v?.proposal_status === 'failed') {
            throw new Error(v.proposal_error || 'Proposal failed (see server logs).')
          }
        } catch (pollErr) {
          if (pollErr?.message?.includes('Proposal failed')) throw pollErr
          // Transient poll error — keep trying.
        }
      }
      if (!firstVersion) throw new Error('Proposal timed out after 5 minutes. Refresh in a moment to see if it completed.')

      // Phase 2: wait for the BE's auto-AI-check pipeline.
      //
      // After proposal_status='done', the BE setImmediate handler
      // fires detect-ai on the new version. If the AI-likely score
      // ≥ 50%, it spawns ONE regen with use_check_feedback=true
      // (mode='update'), which creates a NEWER ai-suggested version
      // and runs its own detect-ai. We poll the page's version list
      // for the LATEST done+scored ai-suggested version since the
      // kickoff, then re-fetch its full body. Cap at 3 minutes; if
      // we time out, fall back to firstVersion so the UI doesn't
      // hang. Skip Phase 2 entirely when this propose call IS the
      // regen (useCheckFeedback=true) — the auto-pipeline doesn't
      // re-fire on itself, so there's nothing to wait for.
      setProposalPhase('scoring')
      let pickedVersion = firstVersion
      if (!useCheckFeedback) {
        const phase2Deadline = Date.now() + 3 * 60 * 1000
        let sawRegen = false
        while (Date.now() < phase2Deadline) {
          await new Promise(r => setTimeout(r, 5000))
          try {
            const lp = await api.getLandingPage(landing_page_id)
            const allAi = (lp?.versions || []).filter(v => v.kind === 'ai-suggested')
            // Newer (regen) ai-suggested version since kickoff?
            const newer = allAi.filter(v => v.id > newVersionId)
            if (newer.length > 0 && !sawRegen) {
              sawRegen = true
              setProposalPhase('humanizing')
            }
            // Pick: latest done + scored ai-suggested ≥ newVersionId.
            const winner = allAi
              .filter(v => v.id >= newVersionId)
              .filter(v => !v.proposal_status || v.proposal_status === 'done')
              .filter(v => v.ai_detection && typeof v.ai_detection.score === 'number')
              .sort((a, b) => b.id - a.id)[0]
            if (winner) {
              // If the winner IS the first version + no regen ever
              // appeared, score was under threshold → keep firstVersion.
              // If it's a newer version, re-fetch to get full body_html.
              if (winner.id === newVersionId) {
                pickedVersion = { ...firstVersion, ai_detection: winner.ai_detection }
              } else {
                setProposalPhase('scoring-regen')
                const full = await api.getLandingPageVersion(landing_page_id, winner.id)
                if (full?.version) pickedVersion = full.version
              }
              break
            }
          } catch {
            // Transient — keep polling.
          }
        }
      }

      // Reshape into the {version_id, proposal, source_links} shape
      // that ProposalDiff renders against. Rich metadata (rationale,
      // summary, link ledger) comes from proposal_meta which the BG
      // handler populates after Claude returns.
      const meta = pickedVersion.proposal_meta || {}
      const seoMeta = pickedVersion.seo_meta || {}
      setProposal({
        version_id: pickedVersion.id,
        created_at: pickedVersion.created_at,
        proposal: {
          title: pickedVersion.title,
          body_html: pickedVersion.body_html,
          meta_description: pickedVersion.meta_description,
          focus_keyword: pickedVersion.focus_keyword,
          seo_title: seoMeta.seo_title || null,
          og_title: seoMeta.og_title || null,
          og_description: seoMeta.og_description || null,
          twitter_title: seoMeta.twitter_title || null,
          twitter_description: seoMeta.twitter_description || null,
          links_kept: meta.links_kept || [],
          links_refined: meta.links_refined || [],
          links_added: meta.links_added || [],
          links_removed: meta.links_removed || [],
          summary_of_changes: meta.summary_of_changes || [],
          rationale: meta.rationale || '',
        },
        proposed_links: pickedVersion.links_meta || [],
        source_links: start.source_links || [],
      })
      // Surface the freshly-computed AI score into the in-session
      // check results so the WorkflowWizard + AI-check panel both
      // light up without making the operator click "Check AI score"
      // manually.
      if (pickedVersion.ai_detection) {
        setLiveCheckResults(prev => ({
          ...prev,
          ai_detection: pickedVersion.ai_detection,
        }))
      }
    } catch (e) {
      setProposalError(e?.message || String(e))
    } finally {
      setProposalBusy(false)
      setProposalPhase(null)
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
        liveCheckResults={liveCheckResults}
      />

      {/* Current page content preview — what's actually on the page
          right now (as imported from WordPress). Lets the operator
          see what they're working with BEFORE deciding to audit,
          update, or regenerate. Renders the live body in a styled
          read-only div so it reads close to the actual page. */}
      {page.body_html && (
        <details className="border border-[#e5e5e5] rounded bg-white" open={!proposal}>
          <summary className="cursor-pointer py-2 px-3 flex items-center gap-2">
            <span className="text-[11px] font-medium">📄 Current page content</span>
            <span className="text-[9px] text-muted">
              {page.body_html ? `${page.body_html.length.toLocaleString()} chars` : 'empty'} · what's live on WordPress right now
            </span>
            <span className="flex-1" />
            {page.url && (
              <a
                href={page.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-[9px] py-0.5 px-1.5 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded no-underline"
                title="Open the live page on WordPress in a new tab"
              >🔗 Open live page</a>
            )}
          </summary>
          <div className="p-3 max-h-[500px] overflow-auto bg-[#fafafa] border-t border-[#e5e5e5]">
            <RenderedPreview html={page.body_html} tone="neutral" />
          </div>
          <div className="text-[9px] text-muted italic px-3 py-1.5 border-t border-[#e5e5e5]">
            This is the imported body — what's currently live. Audit + update modes treat this as the source. ✨ Generate from scratch will REPLACE it (with confirmation).
          </div>
        </details>
      )}

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

      {/* Page hint — free-form intent the operator writes for
          Claude to use on every audit / proposal / schema run. Same
          field the SitemapWizard calls "Page hint (strategy)", BUT
          stored in a separate column (landing_pages.strategy_hint
          vs landing_page_plan.extra_strategy_hint). The slot's
          hint seeds this at WP-creation time, but they can drift
          afterwards — e.g. AI revisions (gap analysis, link plan)
          append blocks here on the page side. We surface the slot's
          version side-by-side when they diverge so the operator
          can explicitly choose which one to use. */}
      <div className="bg-[#fef9c3] border border-[#ca8a04]/40 rounded p-2 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-medium text-[#854d0e]">🎯 Page hint</span>
          <span className="text-[9px] text-muted">— strategy hint for AI revisions. Used by audit + propose + schema for THIS page only.</span>
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

        {/* Linked-slot divergence card. Renders when the slot's
            extra_strategy_hint differs from this page's
            strategy_hint — typical case: operator typed extensive
            content into the slot editor before WP creation, or
            kept editing slot after WP creation, and the page's
            hint is shorter / lagging. Read-only view of the slot
            hint + a "📥 Copy from slot" button. Operator decides
            whether to overwrite — we never auto-cascade. */}
        {linkedSlot && (linkedSlot.extra_strategy_hint || '').trim() !== (hint || '').trim() && (
          <details className="bg-white border border-[#ca8a04]/40 rounded">
            <summary className="cursor-pointer py-1.5 px-2 text-[10px] flex items-center gap-2">
              <span className="font-medium text-[#854d0e]">📋 Linked slot hint differs</span>
              <span className="text-[9px] text-muted">
                ({(linkedSlot.extra_strategy_hint || '').length} chars on slot · {(hint || '').length} chars here)
              </span>
              <span className="flex-1" />
              <span className="text-[9px] text-[#ca8a04]">click to compare + copy →</span>
            </summary>
            <div className="p-2 space-y-2 border-t border-[#ca8a04]/20">
              <div className="text-[9px] text-muted italic">
                Slot "<b>{linkedSlot.label || linkedSlot.slot_key}</b>" in the Sitemap Wizard has a different hint than this page. AI-revision blocks (gap analysis, link plan) get appended on the PAGE side, so this side may grow over time independently. The slot side is usually your original prose. Copying from slot → page REPLACES the page hint — back up your appended blocks first if you want to keep them.
              </div>
              <div className="bg-[#fafafa] border border-[#e5e5e5] rounded p-2 max-h-[200px] overflow-auto">
                <div className="text-[9px] uppercase font-medium text-muted mb-1">Slot hint (read-only):</div>
                <pre className="whitespace-pre-wrap text-[10px] font-sans">{linkedSlot.extra_strategy_hint || '(empty)'}</pre>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (!confirm('Replace the page hint textarea above with the slot\'s hint?\n\n⚠ Any unsaved edits to the page hint will be lost. Any AI-revision blocks (gap analysis, link plan) currently appended to the PAGE hint will also be replaced — copy them out first if you want to keep them.\n\nThis just loads the slot text into the textarea; click Save afterwards to commit.')) return
                    setHint(linkedSlot.extra_strategy_hint || '')
                  }}
                  className="text-[10px] py-1 px-2 bg-[#ca8a04] text-white border-none rounded cursor-pointer"
                  title="Load the slot's hint into the textarea above (does not save yet — review then click Save)"
                >📥 Load slot hint into textarea</button>
                <button
                  onClick={() => {
                    const merged = `${(linkedSlot.extra_strategy_hint || '').trim()}\n\n${(hint || '').trim()}`.trim()
                    setHint(merged)
                  }}
                  className="text-[10px] py-1 px-2 bg-white border border-[#ca8a04] text-[#854d0e] rounded cursor-pointer"
                  title="Concatenate slot hint + current page hint (slot first). Useful when the slot has the original prose and the page has appended AI-revision blocks."
                >⇄ Merge slot + page</button>
              </div>
            </div>
          </details>
        )}

        <div className="text-[9px] text-muted italic">
          Same canonical field as the SitemapWizard's "Page hint (strategy)" — edits here mirror to the linked slot (and vice versa). Describe the page's intent + tone + target searches + brand voice. Claude weights this above generic SEO best-practices when there's a tradeoff. Gap analysis + internal-link plan applies merge into this hint as their own "## ..." blocks; never replace the operator-typed portion above them.
        </div>
      </div>

      {/* Targeted update — one-shot surgical edit instructions. Saved
          per page but DELIBERATELY NOT threaded into audit / propose /
          regenerate. Only the 🎯 Apply targeted update button reads
          this text. Use when the content is mostly good and you just
          need to change specific parts (e.g. "swap the second
          paragraph for X" or "drop the testimonials block").
          currentBufferHtml = whatever's currently the buffer (the
          active proposal body if one exists, else the imported body).
          The editor captures this snapshot the moment Apply is
          clicked so the before/after preview renders correctly even
          after the parent's proposal state flips to the new version. */}
      <TargetedUpdateEditor
        landingPageId={landing_page_id}
        initialHint={data?.page?.targeted_update_hint || ''}
        currentBufferHtml={proposal?.proposal?.body_html || page?.body_html || ''}
        onApplied={(version) => {
          // The new version is now the buffer. Set it as the active
          // proposal so ProposalDiff renders against it without
          // waiting for a workspace re-open. Shape matches the
          // recoveredProposal/runProposal payload.
          const meta = version.proposal_meta || {}
          setProposal({
            version_id: version.id,
            created_at: version.created_at,
            proposal: {
              title: version.title,
              body_html: version.body_html,
              meta_description: version.meta_description,
              focus_keyword: version.focus_keyword,
              links_kept: [],
              links_refined: [],
              links_added: [],
              links_removed: [],
              summary_of_changes: Array.isArray(meta.summary_of_changes) ? meta.summary_of_changes : [],
              rationale: meta.rationale || 'Targeted update applied.',
            },
            proposed_links: version.links_meta || [],
            source_links: [],
          })
        }}
      />

      {/* Per-page schema allowlist — explicit operator-declared set
          of Schema.org @type values this page is allowed to emit.
          Stops Claude from guessing (and slipping in Service /
          LocalBusiness for publication contexts). Collapsed by
          default; loads on first expand. */}
      <SchemaTypesAllowlist landingPageId={landing_page_id} />

      {/* Image manager — same component used in the SlotEditor.
          Shows existing images for this page + tabbed picker
          (upload / Pexels / scrape from URL). Pre-wave images
          uploaded against the slot persist here since they're
          keyed to landing_page_id.
          onImagesChanged: keeps the workspace's pageImages state
          in sync so the rendered preview can show featured +
          inline images without a separate fetch. */}
      <LandingImagesPanel
        landingPageId={landing_page_id}
        onImagesChanged={setPageImages}
      />

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
      <details className="text-[10px] border border-[#e5e5e5] rounded">
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
          {/* Audit button. Disabled on freshly-scaffolded pages —
              auditing the ~250-char placeholder body produces noise,
              not findings. See hasGeneratedContent heuristic above. */}
          <button
            onClick={runAudit}
            disabled={auditBusy || !hasGeneratedContent}
            className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
            title={hasGeneratedContent
              ? "Send the parsed page to Claude with the brand context + site capabilities. Returns 5 dimensions of structured findings, each with severity + suggestion."
              : "No content to audit yet — this page only has the scaffold placeholder body. Click 🚀 Generate content in the Proposal panel first to generate real content, then run audit."}
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
            findingStates={audit.finding_states || {}}
            onFindingStateChange={handleFindingStateChange}
          />
        )}
        {!audit && !auditBusy && !auditError && (
          <div className="text-[10px] text-muted italic">Run an audit to see structured SEO / AEO / GEO / E-E-A-T / AI-naturalness findings for this page.</div>
        )}
      </div>

      {/* Quality checks panel — AI detection + brand-voice score on
          the latest version, runnable WITHOUT generating a proposal
          first. Targets history[0] (the most recent version row,
          which is the imported body on a fresh page). When a proposal
          exists, this panel hides because the same buttons live inside
          ProposalDiff (targeting the proposal's version_id). Lifts
          results up via onCheckResult so the WorkflowWizard reflects
          fresh scores immediately. */}
      {!proposal && history[0]?.id && (
        <QualityChecksPanel
          landingPageId={landing_page_id}
          versionId={history[0].id}
          liveCheckResults={liveCheckResults}
          onCheckResult={({ ai_detection, voice_check }) => {
            setLiveCheckResults(prev => ({
              ...prev,
              ...(ai_detection !== undefined ? { ai_detection } : {}),
              ...(voice_check !== undefined ? { voice_check } : {}),
            }))
          }}
        />
      )}

      {/* Proposal panel — also serves as anchor target for steps
          3 (AI check), 4 (voice check), and refine (🎯 Re-propose
          with feedback) since those actions all live inside this
          panel via ProposalDiff. */}
      <div data-workflow-anchor="proposal" data-workflow-anchor-secondary="ai-check voice-check refine" className="border border-[#2D9A5E]/30 rounded p-3 space-y-2 bg-[#f0fdf4]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-[#2D9A5E]">💡 Proposal</span>
          {/* For freshly-scaffolded pages with no real content, the
              Update-vs-Scratch decision is meaningless — there's
              nothing to update. Show just one Generate button. Once
              the page has real content (a proposal or non-imported
              version), surface both modes with the explainer. */}
          {hasGeneratedContent ? (
            <span className="text-[9px] text-muted">✏️ Update — applies inputs surgically to the LATEST content (imported body OR current proposal if one exists). Iterates on whatever you're working on. ✨ Scratch — full rewrite, warns before replacing. Inputs: tenant editorial policy + strategy hint + AI citations + selected audit findings + (on 🎯 Re-propose) AI/voice check feedback.</span>
          ) : (
            <span className="text-[9px] text-muted">No content yet. Click 🚀 Generate to produce the first version using the slot's strategy hint + voice anchors + competitive gap analysis + editorial policy.</span>
          )}
          <div className="flex-1" />
          {proposal?.created_at && (
            <span className="text-[9px] text-muted">Generated {new Date(proposal.created_at).toLocaleString()}</span>
          )}
          {hasGeneratedContent ? (
            <>
              {/* Pages with real content get both modes. */}
              <button
                onClick={() => runProposal({ mode: 'update' })}
                disabled={proposalBusy || (audit?.audit_id && selectedSuggestions.size === 0 && includeAudit)}
                className="text-[10px] py-1 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50"
                title={
                  audit?.audit_id && selectedSuggestions.size === 0 && includeAudit ? 'Tick the audit findings you want addressed (or uncheck audit input below).'
                  : proposal
                    ? 'Iterate on the CURRENT PROPOSAL. Always uses the latest strategy hint (including any "## Competitive gap analysis" block you applied below), tenant editorial policy, and voice anchors. Optional inputs (per toggle): selected audit findings + AI Overview citations + check feedback. Preserves what works; modifies only what needs changing. ~100-150s.'
                    : 'Modify the EXISTING content surgically. Always uses the latest strategy hint (including any "## Competitive gap analysis" block you applied below), tenant editorial policy, and voice anchors. Optional inputs (per toggle): selected audit findings + AI Overview citations + check feedback. Preserves structure, links, and unchanged sentences. ~100-150s.'
                }
              >{proposalBusy
                  ? `Generating… ${proposalElapsed}s`
                  : proposal ? '✏️ Apply suggestions to proposal' : '✏️ Update existing content'}</button>
              <button
                onClick={() => runProposal({ mode: 'scratch' })}
                disabled={proposalBusy}
                className="text-[10px] py-1 px-2 bg-white border border-[#c0392b] text-[#c0392b] rounded cursor-pointer disabled:opacity-50"
                title="REPLACE the existing body with a full AI-written rewrite from the strategy hint (including any '## Competitive gap analysis' block you applied below) + tenant editorial policy + voice anchors + template. Existing content becomes a backup version (rollback available). Use for blank scaffolds or fundamental redesigns. Confirms before proceeding."
              >{proposalBusy ? '...' : '✨ Generate from scratch'}</button>
            </>
          ) : (
            // Fresh page (only scaffold placeholder) — single primary
            // Generate button. Calls scratch mode but with no scary
            // confirm (no real content to wipe). After this lands, the
            // panel flips back to the full Update / Scratch dual-button.
            <button
              onClick={() => runProposal({ mode: 'scratch', skipConfirm: true })}
              disabled={proposalBusy}
              className="text-[10px] py-1 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50"
              title="Generate the first version of this page using all the strategic inputs: the page's strategy hint (which includes any '## Competitive gap analysis' block you applied via the ⚔️ panel below) + voice anchors + slot-level competitive context + tenant editorial policy. ~60-90s single-phase; ~2-3 min with two-phase self-review enabled."
            >{proposalBusy ? `Generating… ${proposalElapsed}s` : '🚀 Generate content'}</button>
          )}
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
              title="Re-propose using the most recent Check AI Score + Check Voice results as targeted remediation. Always uses the latest strategy hint (including any '## Competitive gap analysis' block applied below). Falls back to a plain regenerate if no AI/voice checks have been run yet."
            >🎯 Re-propose with feedback</button>
          )}
        </div>
        {/* Input toggle panel — operator can opt OUT of specific
            inputs before generating. Default = all enabled. Useful
            when an input is producing bad output (e.g. citations
            overriding intended changes) or when you want to test
            'just the audit' or 'just the strategy hint.' */}
        <details className="text-[9px] border border-[#2D9A5E]/30 rounded bg-white">
          <summary className="cursor-pointer py-1 px-2 font-medium">
            ⚙ Inputs used (
            {[
              audit?.audit_id && includeAudit && `audit (${selectedSuggestions.size})`,
              includeCitations && (initialCitations?.length || 0) > 0 && `${initialCitations.length} citation(s)`,
              recoveredProposal?.ai_detection && 'AI score',
              recoveredProposal?.voice_check && 'voice check',
            ].filter(Boolean).join(', ') || 'strategy hint + editorial policy only'}
            )
          </summary>
          <div className="p-2 space-y-1.5">
            {audit?.audit_id && (
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeAudit}
                  onChange={e => setIncludeAudit(e.target.checked)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="font-medium">Audit findings ({selectedSuggestions.size} selected)</div>
                  <div className="text-muted">Apply the checked audit suggestions in this generation. Uncheck to ignore the audit entirely.</div>
                </div>
              </label>
            )}
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeCitations}
                onChange={e => setIncludeCitations(e.target.checked)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="font-medium">AI Overview citations ({(initialCitations || []).length})</div>
                <div className="text-muted">Preserve / restore the cited content. Uncheck only if you intentionally want to drop the citation-bearing language.</div>
              </div>
            </label>
            <div className="text-muted italic pt-1 border-t border-[#e5e5e5]">
              Tenant editorial policy + page strategy hint (including any "## Competitive gap analysis" block applied from the ⚔️ panel below) + voice anchors + (on 🎯 Re-propose) AI/voice check feedback are always included — those are baked in, not toggleable here.
            </div>
          </div>
        </details>
        {proposalBusy && (
          <div className="text-[10px] text-muted italic">
            {proposalPhase === 'generating' && "Claude is writing the body (longer than the audit because it has to produce 800-1500 words of polished copy). Don't refresh."}
            {proposalPhase === 'scoring' && "Body written. Scoring against ZeroGPT — if the score is too AI-likely, the system will auto-regenerate one more time with the flagged sentences as feedback."}
            {proposalPhase === 'humanizing' && "ZeroGPT scored the first pass as too AI-likely. Claude is rewriting the flagged sentences with more human phrasing."}
            {proposalPhase === 'scoring-regen' && "Re-scoring the humanized version. Almost done."}
            {!proposalPhase && "Working…"}
          </div>
        )}
        {proposalError && <div className="text-[10px] text-[#c0392b]">⚠ {proposalError}</div>}
        {!proposal && !proposalBusy && !proposalError && (
          <div className="text-[10px] text-muted italic">
            {!audit?.audit_id
              ? "No audit yet. For most pages, run the audit first → tick the findings you want addressed → click ✏️ Update existing content. For blank scaffolds or fundamental redesigns, use ✨ Generate from scratch instead (will warn before replacing existing content)."
              : selectedSuggestions.size === 0 && includeAudit
                ? 'Tick the audit findings you want addressed (each card has a checkbox), then click ✏️ Update existing content. OR uncheck "Audit findings" in the input panel above to generate without audit input.'
                : `${selectedSuggestions.size} audit suggestion(s) flagged — ready to generate. ✏️ Update modifies existing content surgically; ✨ Scratch replaces it entirely.`}
          </div>
        )}
        {/* Explicit save-state banner. Proposals auto-save on
            generation (no draft / dirty state to commit) but
            operators don't always realize that — they expect a
            "Save" affordance after editing or running checks. This
            banner removes the ambiguity: shows the saved version
            id + a direct Deploy shortcut so the operator's mental
            model of "I made changes → save → ship" maps to the
            actual flow. */}
        {proposal && (
          <div className="bg-white border border-[#2D9A5E]/40 rounded p-2 flex items-center gap-2 text-[10px]">
            <span className="text-[#15803d]">✓</span>
            <span className="font-medium text-[#15803d]">Proposal saved</span>
            <span className="text-muted">as version #{proposal.version_id}{proposal?.created_at ? ` · ${new Date(proposal.created_at).toLocaleString()}` : ''}</span>
            <span className="text-muted">·</span>
            <span className="text-muted">Any inline edits, AI-check rewrites (Humanize), or auto-regens land as new versions automatically. Nothing else to save manually.</span>
            <span className="flex-1" />
            <button
              onClick={() => {
                const el = document.querySelector('[data-deploy-anchor]') || document.querySelector('h2, h3, [class*="Deploy"]')
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}
              className="text-[10px] py-1 px-2 bg-[#c0392b] text-white border-none rounded cursor-pointer"
              title="Scroll to the Deploy panel below. Deploy is the only thing that pushes the saved proposal to WordPress."
            >🚀 Deploy →</button>
          </div>
        )}
        {proposal && (
          <ProposalDiff
            proposal={proposal}
            sourcePage={page}
            landingPageId={landing_page_id}
            pageImages={pageImages}
            requireBackupAck={requireBackupAck}
            onVersionChange={setDeployVersionId}
            onSourcePatch={patchSourcePage}
            onCheckResult={({ ai_detection, voice_check }) => {
              // Lift in-session check results up so the WorkflowWizard
              // immediately reflects scores without waiting for a page
              // re-open. Only merges keys that were provided.
              setLiveCheckResults(prev => ({
                ...prev,
                ...(ai_detection !== undefined ? { ai_detection } : {}),
                ...(voice_check !== undefined ? { voice_check } : {}),
              }))
            }}
          />
        )}
      </div>

      {/* Competitive gap analysis — runs the same 5-dim comparison
          as the slot editor but uses the latest BUFFERED version's
          body (instead of just the slot's strategy hint). Lives
          here so the operator can see how the current draft stacks
          up against the tracked competitor without leaving the
          page workspace. The competitor URL itself is set on the
          sitemap slot; this panel reverse-looks it up.

          onHintApplied: when the operator clicks ✨ Apply to page
          hint, the BE merges findings into strategy_hint. We push
          the new hint back into the strategy-hint editor state so
          the textarea reflects the change AND every subsequent
          propose call picks it up automatically (propose always
          reads landing_pages.strategy_hint server-side; this just
          keeps the visible editor in sync). */}
      <PageGapAnalysisPanel
        landingPageId={landing_page_id}
        pageDetail={data}
        onHintApplied={(newHint) => {
          if (typeof newHint === 'string') {
            setHint(newHint)
            setHintSaved(true)
            setTimeout(() => setHintSaved(false), 2500)
          }
        }}
      />

      {/* Pre-deploy checklist — a final gate above DeployBlock
          showing the state of every input that matters at publish
          time (schema, images + alt text, AI score, voice check,
          meta description, gap analysis). Informational only —
          doesn't block deploy. Operator can deploy with reds, but
          the friction stops "deploy and discover later" mistakes. */}
      {proposal && deployVersionId && (
        <PreDeployChecklist
          landingPageId={landing_page_id}
          versionId={deployVersionId}
          proposal={proposal}
          pageImages={pageImages}
          liveCheckResults={liveCheckResults}
          pageDetail={data}
        />
      )}

      {/* Deploy — Phase 5. Big red CTA. Pinned at the bottom of
          the workspace so the irreversible publish-to-WordPress
          action is the last thing the operator sees, after all
          generation / editing / analysis panels above. Only
          renders when a proposal exists + we have a target
          version id from ProposalDiff (which mirrors humanized
          versions too). */}
      {proposal && deployVersionId && platformCapabilities?.can_deploy && (
        <>
          <DeployBlock
            landingPageId={landing_page_id}
            versionId={deployVersionId}
            requireBackupAck={requireBackupAck}
            onDeployed={() => { /* deploy success surfaces inline */ }}
          />
          <div className="text-[9px] text-muted italic">
            Deploy publishes the proposed version to WordPress. The live page is snapshotted as a backup FIRST so rollback is always available.
          </div>
        </>
      )}
      {/* Phase 4: ecommerce tenants see the Square packet
          generator + copy-paste UI in place of the WP Deploy
          panel. */}
      {proposal && deployVersionId && platformCapabilities?.output_shape === 'copy-paste-packet' && (
        <SquarePacketPanel
          landingPageId={landing_page_id}
          versionId={deployVersionId}
          platformCapabilities={platformCapabilities}
        />
      )}

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

function AuditFindings({ findings, activeDim, setActiveDim, selected, toggleSuggestion, findingStates, onFindingStateChange }) {
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
            const findingState = findingStates?.[f.suggestion_id]?.state || 'pending'
            const isManualDone = findingState === 'manual_done'
            const isSkipped = findingState === 'skipped'
            const stateRowCls = isManualDone ? 'opacity-60 bg-[#f0fdf4] border-[#16a34a]/30'
              : isSkipped ? 'opacity-50 bg-[#fafafa] border-[#94a3b8]/30'
              : 'bg-white border-[#e5e5e5]'
            const setState = (newState) => onFindingStateChange?.(f.suggestion_id, newState === findingState ? 'pending' : newState)
            return (
              <div key={f.suggestion_id || i} className={`border rounded p-2 text-[10px] space-y-1 ${stateRowCls}`}>
                <div className="flex items-start gap-2">
                  <label className="flex items-center gap-1 cursor-pointer pt-0.5" title="Include this finding in the next proposal — Claude will address it in the rewrite.">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSuggestion(f.suggestion_id)}
                      disabled={isManualDone || isSkipped}
                    />
                  </label>
                  <span className={`text-[8px] py-0.5 px-1 rounded border uppercase font-bold ${sevColors}`}>{sev}</span>
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium ${isManualDone || isSkipped ? 'line-through text-muted' : 'text-ink'}`}>{f.title}</div>
                    {f.target && <div className="text-[9px] text-muted font-mono truncate">→ {f.target}</div>}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setState('manual_done')}
                      className={`text-[9px] py-0.5 px-1.5 rounded cursor-pointer border ${
                        isManualDone ? 'bg-[#16a34a] text-white border-[#16a34a]' : 'bg-white text-muted border-[#e5e5e5] hover:bg-[#f0fdf4] hover:border-[#16a34a]'
                      }`}
                      title="Mark as manually handled outside the system (e.g. fixed in WP admin, set up a redirect, requested a backlink)."
                    >{isManualDone ? '✓ Done' : '✋ Manual'}</button>
                    <button
                      onClick={() => setState('skipped')}
                      className={`text-[9px] py-0.5 px-1.5 rounded cursor-pointer border ${
                        isSkipped ? 'bg-[#94a3b8] text-white border-[#94a3b8]' : 'bg-white text-muted border-[#e5e5e5] hover:bg-[#fafafa]'
                      }`}
                      title="Skip this finding — won't fix or not relevant. Falls off the pending count."
                    >{isSkipped ? '⛔ Skipped' : '⛔ Skip'}</button>
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

// QualityChecksPanel — standalone AI detection + brand-voice check
// surface that runs against any version_id (typically the latest
// version, which IS the imported body on a freshly-imported page).
// Solves the case where the operator runs an audit on an existing
// page and wants to score it BEFORE generating a proposal. When a
// proposal exists, the equivalent buttons inside ProposalDiff take
// over (they target the proposal's version_id instead).
function QualityChecksPanel({ landingPageId, versionId, liveCheckResults, onCheckResult }) {
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState(null)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voiceError, setVoiceError] = useState(null)
  const [localAi, setLocalAi] = useState(null)
  const [localVoice, setLocalVoice] = useState(null)

  // Reset transient state on version switch (e.g. page change).
  useEffect(() => {
    setLocalAi(null); setLocalVoice(null); setAiError(null); setVoiceError(null)
  }, [versionId])

  const ai = localAi || liveCheckResults?.ai_detection || null
  const voice = localVoice || liveCheckResults?.voice_check || null

  const detectAi = async () => {
    if (aiBusy || !landingPageId || !versionId) return
    setAiBusy(true); setAiError(null)
    try {
      const r = await api.detectLandingPageAi(landingPageId, versionId)
      setLocalAi(r.ai_detection)
      if (typeof onCheckResult === 'function') onCheckResult({ ai_detection: r.ai_detection })
    } catch (e) {
      setAiError(e?.message || String(e))
    } finally {
      setAiBusy(false)
    }
  }

  const checkVoice = async () => {
    if (voiceBusy || !landingPageId || !versionId) return
    setVoiceBusy(true); setVoiceError(null)
    try {
      const r = await api.voiceCheckLandingPageVersion(landingPageId, versionId)
      setLocalVoice(r)
      if (typeof onCheckResult === 'function') onCheckResult({ voice_check: r })
    } catch (e) {
      setVoiceError(e?.message || String(e))
    } finally {
      setVoiceBusy(false)
    }
  }

  if (!versionId) return null

  const aiScore = typeof ai?.score === 'number' ? Math.round(ai.score) : null
  const voiceScore = typeof voice?.score === 'number' ? Math.round(voice.score) : null
  // AI: lower is better (less AI-like). Voice: higher is better
  // (closer to brand tone).
  const aiColor = aiScore == null ? 'text-muted'
    : aiScore >= 50 ? 'text-[#c0392b]'
    : aiScore >= 25 ? 'text-[#d97706]'
    : 'text-[#16a34a]'
  const voiceColor = voiceScore == null ? 'text-muted'
    : voiceScore >= 80 ? 'text-[#16a34a]'
    : voiceScore >= 60 ? 'text-[#d97706]'
    : 'text-[#c0392b]'

  return (
    <div data-workflow-anchor="ai-check" data-workflow-anchor-secondary="voice-check" className="border border-[#0ea5e9]/30 rounded p-3 space-y-2 bg-[#f0f9ff]">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium text-[#0369a1]">🧪 Quality checks</span>
        <span className="text-[9px] text-muted">Scores the latest content (imported body or current proposal). Run BEFORE generating a proposal to inform the rewrite, or after to verify improvement.</span>
        <div className="flex-1" />
        <button
          onClick={detectAi}
          disabled={aiBusy}
          className="text-[10px] py-1 px-2 bg-white border border-[#0ea5e9] text-[#0369a1] rounded cursor-pointer disabled:opacity-50"
          title="Send the latest body to ZeroGPT. Returns an AI-likelihood score (0-100, lower = more human) + per-sentence flags."
        >{aiBusy ? 'Checking…' : ai ? '🔄 Re-check AI score' : '🤖 Check AI score'}</button>
        <button
          onClick={checkVoice}
          disabled={voiceBusy}
          className="text-[10px] py-1 px-2 bg-white border border-[#0ea5e9] text-[#0369a1] rounded cursor-pointer disabled:opacity-50"
          title="Claude scores the latest body against the tenant's brand voice. Returns 0-100 (higher = better fit) plus a list of voice drifts."
        >{voiceBusy ? 'Checking…' : voice ? '🔄 Re-check voice' : '🎤 Check brand voice'}</button>
      </div>
      {aiError && <div className="text-[10px] text-[#c0392b]">⚠ AI check: {aiError}</div>}
      {voiceError && <div className="text-[10px] text-[#c0392b]">⚠ Voice check: {voiceError}</div>}
      {(ai || voice) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px]">
          {ai && (
            <div className="bg-white border border-[#e5e5e5] rounded p-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">AI likelihood</span>
                <span className={`font-mono ${aiColor}`}>{aiScore != null ? `${aiScore}%` : '—'}</span>
                {ai.detected_at && <span className="text-[9px] text-muted">· {new Date(ai.detected_at).toLocaleString()}</span>}
              </div>
              {Array.isArray(ai.flagged_sentences) && ai.flagged_sentences.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[9px] text-muted">{ai.flagged_sentences.length} flagged sentence{ai.flagged_sentences.length === 1 ? '' : 's'}</summary>
                  <ul className="list-disc pl-4 pt-1 space-y-0.5">
                    {ai.flagged_sentences.slice(0, 12).map((s, i) => (
                      <li key={i} className="text-muted">{typeof s === 'string' ? s : (s.text || s.sentence || JSON.stringify(s))}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {voice && (
            <div className="bg-white border border-[#e5e5e5] rounded p-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">Brand voice fit</span>
                <span className={`font-mono ${voiceColor}`}>{voiceScore != null ? `${voiceScore}/100` : '—'}</span>
                {voice.checked_at && <span className="text-[9px] text-muted">· {new Date(voice.checked_at).toLocaleString()}</span>}
              </div>
              {voice.summary && <div className="text-muted pt-1">{voice.summary}</div>}
              {Array.isArray(voice.drifts) && voice.drifts.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[9px] text-muted">{voice.drifts.length} voice drift{voice.drifts.length === 1 ? '' : 's'}</summary>
                  <ul className="list-disc pl-4 pt-1 space-y-0.5">
                    {voice.drifts.slice(0, 12).map((d, i) => (
                      <li key={i} className="text-muted">{typeof d === 'string' ? d : (d.note || d.text || d.issue || JSON.stringify(d))}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      )}
      {!ai && !voice && !aiBusy && !voiceBusy && !aiError && !voiceError && (
        <div className="text-[10px] text-muted italic">
          Run a check to score the current content. After both checks have results, generate a proposal — Claude will use the flagged sentences + voice drifts as targeted remediation guidance via 🎯 Re-propose with feedback.
        </div>
      )}
    </div>
  )
}

// Per-page competitive gap analysis. Reverse-looks-up the slot
// linked to this landing_page, finds the competitor URL stored
// there, loads the latest BUFFERED version of this page (the body
// the operator sees in the proposal panel), and runs the same
// 5-dim SEO/E-E-A-T/GEO/AEO/content comparison the slot editor
// uses — but against actual content rather than a strategy hint.
//
// Result is cached on landing_pages.last_gap_analysis so reopening
// the page re-renders findings without re-running the Claude call.
// "Re-run" always fires a fresh call (~3-8s Haiku + persist).
function PageGapAnalysisPanel({ landingPageId, pageDetail, onHintApplied }) {
  const cachedFindings = pageDetail?.page?.last_gap_analysis || null
  const cachedAt = pageDetail?.page?.last_gap_analyzed_at || null
  const cachedCompetitorUrl = pageDetail?.page?.last_gap_competitor_url || null
  const cachedVersionId = pageDetail?.page?.last_gap_version_id || null

  const [findings, setFindings] = useState(cachedFindings)
  const [analyzedAt, setAnalyzedAt] = useState(cachedAt)
  const [competitorUrl, setCompetitorUrl] = useState(cachedCompetitorUrl)
  const [versionId, setVersionId] = useState(cachedVersionId)
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState(null)
  const [applied, setApplied] = useState(false)

  const run = async () => {
    if (busy) return
    setBusy(true); setError(null); setApplied(false)
    try {
      const r = await api.runLandingGapAnalysis(landingPageId)
      setFindings(r.findings)
      setAnalyzedAt(r.analyzed_at)
      setCompetitorUrl(r.competitor_url)
      setVersionId(r.version_id)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const applyToHint = async () => {
    if (applying || !findings) return
    if (!confirm('Merge the gap-analysis findings into this page\'s strategy hint?\n\nThis adds (or replaces) a "## Competitive gap analysis" block at the bottom of the hint. After this lands, every subsequent ✏️ Apply suggestions / ✨ Generate from scratch / 🎯 Re-propose call will see the findings — Claude will treat the gaps as required improvements + the "highest-impact moves" as priority items.\n\nIdempotent — re-applying replaces the prior block rather than stacking.\n\nContinue?')) return
    setApplying(true); setError(null); setApplied(false)
    try {
      const r = await api.applyLandingGapToHint(landingPageId)
      if (typeof onHintApplied === 'function' && r?.strategy_hint) {
        onHintApplied(r.strategy_hint)
      }
      setApplied(true)
      setTimeout(() => setApplied(false), 4000)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setApplying(false)
    }
  }

  return (
    <div data-workflow-anchor="gap-analysis" className="border border-[#6C5CE7]/30 rounded p-3 space-y-2 bg-[#faf5ff]">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-[#6C5CE7]">⚔️ Competitive gap analysis</span>
        <span className="text-[9px] text-muted flex-1">
          Compares the latest BUFFERED version of this page against the competitor URL set on the linked sitemap slot. Same 5-dim analysis the wizard uses, but against your real draft.
        </span>
        <button
          onClick={run}
          disabled={busy || applying}
          className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 flex-shrink-0"
          title="Re-runs Claude Haiku — costs ~$0.005, takes ~3-8s. Overwrites the cached result for this page."
        >{busy ? 'Analyzing…' : (findings ? '🔁 Re-run gap analysis' : '🔍 Run gap analysis')}</button>
        {findings && !busy && (
          <button
            onClick={applyToHint}
            disabled={applying || busy}
            className="text-[10px] py-1 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50 flex-shrink-0"
            title="Merge the findings into this page's strategy hint as a '## Competitive gap analysis' block. After applying, every subsequent ✏️ Apply suggestions / ✨ Generate from scratch / 🎯 Re-propose call automatically picks up the findings — no extra checkbox or toggle needed. Idempotent: re-applying replaces the prior block rather than stacking."
          >{applying ? 'Applying…' : '✨ Apply to page hint'}</button>
        )}
      </div>

      {applied && (
        <div className="text-[10px] text-[#15803d] bg-[#f0fdf4] border border-[#15803d]/30 rounded p-2">
          ✓ Findings merged into the page strategy hint. The next ✏️ Apply suggestions / ✨ Generate / 🎯 Re-propose call will use them automatically.
        </div>
      )}

      {(competitorUrl || analyzedAt) && (
        <div className="text-[9px] text-muted">
          {competitorUrl && (
            <>
              vs{' '}
              <a href={competitorUrl} target="_blank" rel="noopener noreferrer" className="text-[#6C5CE7] underline break-all">{competitorUrl}</a>
            </>
          )}
          {analyzedAt && (
            <>
              {competitorUrl ? ' · ' : ''}
              analyzed {new Date(analyzedAt).toLocaleString()}
              {versionId ? ` (version #${versionId})` : ''}
            </>
          )}
        </div>
      )}

      {error && (
        <div className="text-[10px] text-[#c0392b] bg-[#fef2f2] border border-[#c0392b]/30 rounded p-2">
          ⚠ {error}
        </div>
      )}

      {!findings && !busy && !error && (
        <div className="text-[10px] text-muted italic">
          No analysis yet. Click Run to compare this page's latest buffered draft against the competitor tracked on the linked sitemap slot. After Run completes, click ✨ Apply to page hint to fold the findings into the strategy hint so the next propose call uses them automatically.
        </div>
      )}

      {findings && !busy && (
        <GapFindings findings={findings} />
      )}
    </div>
  )
}

function ProposalDiff({ proposal, sourcePage, landingPageId, pageImages, onReplace, requireBackupAck, onCheckResult, onVersionChange, onSourcePatch }) {
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
  // Bubble currentVersionId up to PageWorkspace so DeployBlock
  // (rendered at the bottom of the workspace, outside this
  // component) can target the latest buffered version — including
  // humanized versions, which only this component knows about.
  useEffect(() => {
    if (typeof onVersionChange === 'function') onVersionChange(currentVersionId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVersionId])
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
      // Lift up so the workflow wizard sees the fresh score
      // immediately (without requiring a workspace re-open).
      if (typeof onCheckResult === 'function') onCheckResult({ voice_check: r })
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
      if (typeof onCheckResult === 'function') onCheckResult({ ai_detection: r.ai_detection })
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
  // SEO + social-card fields. Editable inline (save on blur) just
  // like title/meta/focus. Persists into version.seo_meta JSONB
  // via PATCH /versions/:id/meta — same endpoint, extended to
  // accept these keys.
  const [editSeoTitle, setEditSeoTitle] = useState(p.seo_title || '')
  const [editOgTitle, setEditOgTitle] = useState(p.og_title || '')
  const [editOgDesc, setEditOgDesc] = useState(p.og_description || '')
  const [editTwTitle, setEditTwTitle] = useState(p.twitter_title || '')
  const [editTwDesc, setEditTwDesc] = useState(p.twitter_description || '')
  const [metaSaving, setMetaSaving] = useState(false)
  const [metaSaved, setMetaSaved] = useState(null)
  const [metaError, setMetaError] = useState(null)
  // Re-seed when the proposal changes (re-generate).
  useEffect(() => {
    setEditTitle(p.title || '')
    setEditMeta(p.meta_description || '')
    setEditFocus(p.focus_keyword || '')
    setEditSeoTitle(p.seo_title || '')
    setEditOgTitle(p.og_title || '')
    setEditOgDesc(p.og_description || '')
    setEditTwTitle(p.twitter_title || '')
    setEditTwDesc(p.twitter_description || '')
    setMetaSaved(null); setMetaError(null)
  }, [proposal?.version_id])

  const saveMeta = async (field, value) => {
    if (!landingPageId || !currentVersionId) return
    setMetaSaving(true); setMetaError(null); setMetaSaved(null)
    try {
      const r = await api.updateLandingVersionMeta(landingPageId, currentVersionId, { [field]: value })
      const labels = {
        title: 'Title',
        meta_description: 'Meta description',
        focus_keyword: 'Focus keyword',
        seo_title: 'SEO title',
        og_title: 'OG title',
        og_description: 'OG description',
        twitter_title: 'Twitter title',
        twitter_description: 'Twitter description',
      }
      setMetaSaved(`${labels[field] || field} saved`)
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
        <details className="bg-white border border-[#e5e5e5] rounded">
          <summary className="cursor-pointer py-1.5 px-2 font-medium text-ink">
            Summary of changes ({summary.length})
          </summary>
          <ul className="list-disc pl-6 pr-2 pb-2 space-y-0.5 text-muted">
            {summary.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </details>
      )}

      {/* Title / meta / focus keyword — editable. Operator can refine
          Claude's suggestion before deploy (saves on blur). Deploy
          reads from the version row, so edits flow through.
          Collapsed by default to keep the proposal panel compact;
          operator expands when ready to tune meta. */}
      <details className="bg-white border border-[#e5e5e5] rounded">
        <summary className="cursor-pointer flex items-center gap-2 p-2">
          <span className="font-medium text-ink">Meta changes</span>
          <span className="text-[9px] text-muted">
            ({[
              (editTitle || '').trim() && (editTitle || '').trim() !== sourceTitle.trim() && 'title',
              (editMeta || '').trim() && (editMeta || '').trim() !== sourceMeta.trim() && 'description',
              (editFocus || '').trim() && 'focus keyword',
              (editSeoTitle || '').trim() && 'SEO title',
              ((editOgTitle || editOgDesc || editTwTitle || editTwDesc) || '').trim() && 'social cards',
            ].filter(Boolean).join(', ') || 'click to expand'})
          </span>
          <span className="text-[9px] text-muted">— editable, saves on blur</span>
          <span className="flex-1" />
          {metaSaving && <span className="text-[9px] text-muted">Saving…</span>}
          {metaSaved && <span className="text-[9px] text-[#16a34a]">✓ {metaSaved}</span>}
          {metaError && <span className="text-[9px] text-[#c0392b]">⚠ {metaError}</span>}
        </summary>
        <div className="p-2 pt-0 space-y-2">

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

        {/* SEO title + social-card meta. All editable, save on blur.
            Persists into version.seo_meta JSONB via the same PATCH
            endpoint as title/meta/focus (now extended). Deploy reads
            these and writes them through to the right plugin keys
            (Yoast Premium / Rank Math / AIOSEO). */}
        <details className="border border-[#e5e5e5] rounded bg-[#fafafa]">
          <summary className="cursor-pointer text-muted py-1 px-2 text-[10px]">
            SEO title + social cards (5 fields)
          </summary>
          <div className="space-y-2 p-2 pt-1">
            <div>
              <div className="text-muted">SEO title (editable, distinct from H1):</div>
              <div className="text-[9px] text-muted italic">Often differs from the page title — keyword-first placement, brand suffix, tightened to ≤60 chars. Yoast Premium / Rank Math read this for the SERP rendering.</div>
              <input
                type="text"
                value={editSeoTitle}
                onChange={e => setEditSeoTitle(e.target.value)}
                onBlur={() => {
                  if (editSeoTitle !== (p.seo_title || '')) saveMeta('seo_title', editSeoTitle)
                }}
                placeholder="e.g. Perfume Bar Milwaukee | Walk-In Sessions at Poppy & Thyme"
                className="w-full bg-white border border-[#e5e5e5] rounded px-2 py-1 text-[10px] outline-none focus:border-[#2D9A5E]"
              />
            </div>

            <div>
              <div className="text-muted">OG title (Facebook / LinkedIn / Slack / Discord card):</div>
              <input
                type="text"
                value={editOgTitle}
                onChange={e => setEditOgTitle(e.target.value)}
                onBlur={() => {
                  if (editOgTitle !== (p.og_title || '')) saveMeta('og_title', editOgTitle)
                }}
                placeholder="More conversational than SEO title — link-share users scroll, not search."
                className="w-full bg-white border border-[#e5e5e5] rounded px-2 py-1 text-[10px] outline-none focus:border-[#2D9A5E]"
              />
            </div>

            <div>
              <div className="text-muted">OG description (Facebook / LinkedIn / Slack / Discord card body):</div>
              <textarea
                value={editOgDesc}
                onChange={e => setEditOgDesc(e.target.value)}
                onBlur={() => {
                  if (editOgDesc !== (p.og_description || '')) saveMeta('og_description', editOgDesc)
                }}
                rows={2}
                placeholder="Hook-style copy — what would make someone click on a friend's share?"
                className="w-full bg-white border border-[#e5e5e5] rounded px-2 py-1 text-[10px] outline-none focus:border-[#2D9A5E] resize-y font-sans"
              />
            </div>

            <div>
              <div className="text-muted">Twitter / X title:</div>
              <input
                type="text"
                value={editTwTitle}
                onChange={e => setEditTwTitle(e.target.value)}
                onBlur={() => {
                  if (editTwTitle !== (p.twitter_title || '')) saveMeta('twitter_title', editTwTitle)
                }}
                placeholder="Often the same as OG title; can be slightly punchier."
                className="w-full bg-white border border-[#e5e5e5] rounded px-2 py-1 text-[10px] outline-none focus:border-[#2D9A5E]"
              />
            </div>

            <div>
              <div className="text-muted">Twitter / X description:</div>
              <textarea
                value={editTwDesc}
                onChange={e => setEditTwDesc(e.target.value)}
                onBlur={() => {
                  if (editTwDesc !== (p.twitter_description || '')) saveMeta('twitter_description', editTwDesc)
                }}
                rows={2}
                placeholder="Often the same as OG description; can be tuned for the X audience."
                className="w-full bg-white border border-[#e5e5e5] rounded px-2 py-1 text-[10px] outline-none focus:border-[#2D9A5E] resize-y font-sans"
              />
            </div>
          </div>
        </details>
        </div>
      </details>

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
        pageImages={pageImages}
        onSaved={(newHtml) => setCurrentBodyHtml(newHtml)}
        onSourcePatch={onSourcePatch}
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

      {/* DeployBlock used to live here. Now rendered at the very
          BOTTOM of PageWorkspace (after gap analysis) so the
          irreversible publish-to-WordPress action is the last
          thing on screen, not buried in the middle of the
          proposal panel. PageWorkspace tracks the target
          version via onVersionChange callback above. */}
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
  // Lightweight count of currently-allowed schemas — fetched on
  // mount so the COLLAPSED summary can show "N type(s) allowed" /
  // "No restriction" without forcing the operator to expand the
  // section first. The full catalog still lazy-loads on first
  // expand (catalog is bigger; keep workspace-open cheap).
  const [allowedCount, setAllowedCount] = useState(null) // null = loading, 0 = no restriction, N = N types

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
    setAllowedCount(null)
  }, [landingPageId])

  // Fetch just the count on mount so collapsed summary shows it.
  useEffect(() => {
    let cancelled = false
    api.getLandingPageSchemaTypes(landingPageId)
      .then(r => {
        if (cancelled) return
        const types = r?.schema_types
        setAllowedCount(Array.isArray(types) ? types.length : 0)
      })
      .catch(() => { if (!cancelled) setAllowedCount(0) })
    return () => { cancelled = true }
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
          {(() => {
            // Counter right after the label, in parens — same shape as
            // the other expandable section summaries on this page
            // (e.g. "Meta changes (title, focus keyword)").
            // Prefer post-expand state once loaded; fall back to the
            // lightweight count fetched on mount.
            const n = loaded
              ? (Array.isArray(original) ? original.length : 0)
              : allowedCount
            if (n === null) return '(loading…)'
            if (n === 0) return '(no restriction)'
            return `(${n})`
          })()}
        </span>
        <span className="text-[9px] text-muted">
          — explicit per-page Schema.org @type allowlist. Stops Claude from guessing; schema-gen + deploy both enforce.
        </span>
        <span className="flex-1" />
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

// TargetedUpdateEditor — paste-and-save textbox for one-shot
// surgical edit instructions. The 🎯 Apply button runs Claude with
// the latest version (the buffer) + this text and emits a NEW
// version with only the requested edits applied. DELIBERATELY NOT
// hooked into audit / propose / regenerate — operators want a way
// to apply small targeted changes without those instructions
// leaking into the broader prompts.
//
// After Apply completes, an inline rendered Before / After preview
// drops in below the buttons so the operator can SEE the surgical
// change without scrolling down to ProposalDiff. The "before" is
// captured the moment Apply is clicked (whatever the buffer was);
// the "after" is the new version's body_html. Both render in the
// same iframe-styled preview the diff section uses, so visual
// parity is exact.
function TargetedUpdateEditor({ landingPageId, currentBufferHtml, initialHint, onApplied }) {
  const [hint, setHint] = useState(initialHint || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState(null)
  const [applyElapsed, setApplyElapsed] = useState(0)
  const [lastSummary, setLastSummary] = useState(null)
  // Before / after preview state — captured at Apply time so the
  // operator can see the surgical change inline without scrolling.
  // Stays sticky across re-renders until cleared or a new update
  // starts. Reset on page switch.
  const [beforeHtml, setBeforeHtml] = useState(null)
  const [afterHtml, setAfterHtml] = useState(null)

  // Re-sync when the operator switches pages.
  useEffect(() => {
    setHint(initialHint || '')
    setBeforeHtml(null); setAfterHtml(null); setLastSummary(null)
  }, [initialHint, landingPageId])

  // Elapsed-seconds counter while Claude is in flight — surgical
  // edits typically finish in 10-30s but a big body can stretch
  // longer; showing the count keeps the operator from refreshing.
  useEffect(() => {
    if (!applying) { setApplyElapsed(0); return }
    const start = Date.now()
    setApplyElapsed(0)
    const tick = setInterval(() => setApplyElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    return () => clearInterval(tick)
  }, [applying])

  const save = async () => {
    if (saving || !landingPageId) return
    setSaving(true); setSaveError(null); setSaved(false)
    try {
      await api.setLandingPageTargetedUpdateHint(landingPageId, hint)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setSaveError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const apply = async () => {
    if (applying || !landingPageId) return
    const text = (hint || '').trim()
    if (!text) {
      setApplyError('Paste targeted-update instructions first.')
      return
    }
    // Snapshot the buffer NOW — once the new version lands the
    // parent's proposal state flips and currentBufferHtml shifts
    // to the new body; capturing here pins the "before" for the
    // inline preview.
    const snapshotBefore = currentBufferHtml || ''
    setApplying(true); setApplyError(null); setLastSummary(null)
    setBeforeHtml(null); setAfterHtml(null)
    try {
      // Always save before applying so the buffer doesn't apply
      // stale persisted text. The endpoint also accepts an inline
      // override but persisting first keeps the saved state in
      // sync with what just ran.
      try { await api.setLandingPageTargetedUpdateHint(landingPageId, hint) } catch {}
      const start = await api.applyLandingPageTargetedUpdate(landingPageId, { hint: text })
      const newVersionId = start?.version_id
      if (!newVersionId) throw new Error('Targeted update kickoff returned no version_id')

      // Poll up to 5 minutes; checks every 5s. Same pattern as
      // propose/audit.
      const deadline = Date.now() + 5 * 60 * 1000
      let finalVersion = null
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5000))
        try {
          const r = await api.getLandingPageVersion(landingPageId, newVersionId)
          const v = r?.version
          if (v?.proposal_status === 'done') { finalVersion = v; break }
          if (v?.proposal_status === 'failed') {
            throw new Error(v.proposal_error || 'Targeted update failed (see server logs).')
          }
        } catch (pollErr) {
          if (pollErr?.message?.includes('Targeted update failed')) throw pollErr
        }
      }
      if (!finalVersion) throw new Error('Targeted update timed out after 5 minutes. Refresh in a moment to see if it completed.')

      const summary = Array.isArray(finalVersion.proposal_meta?.summary_of_changes)
        ? finalVersion.proposal_meta.summary_of_changes
        : []
      setLastSummary(summary)
      setBeforeHtml(snapshotBefore)
      setAfterHtml(finalVersion.body_html || '')
      if (typeof onApplied === 'function') onApplied(finalVersion)
    } catch (e) {
      setApplyError(e?.message || String(e))
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="bg-[#eef2ff] border border-[#6366f1]/40 rounded p-2 space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-medium text-[#4338ca]">🎯 Targeted update — one-shot edits</span>
        <span className="text-[9px] text-muted">NOT used by audit / propose / regenerate. Only applied when you click Apply below.</span>
        <div className="flex-1" />
        <button
          onClick={save}
          disabled={saving || applying}
          className="text-[10px] py-0.5 px-2 bg-white border border-[#6366f1] text-[#4338ca] rounded cursor-pointer disabled:opacity-50"
          title="Save the instructions for later. Stays attached to this page until you change or clear it."
        >{saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}</button>
        <button
          onClick={apply}
          disabled={applying || saving || !(hint || '').trim()}
          className="text-[10px] py-0.5 px-2 bg-[#6366f1] text-white border-none rounded cursor-pointer disabled:opacity-50"
          title="Run Claude on the LATEST version (the buffer) with these instructions. Preserves everything else. Creates a new version with the edits applied."
        >{applying ? `Applying… ${applyElapsed}s` : '🎯 Apply targeted update'}</button>
      </div>
      <textarea
        value={hint}
        onChange={e => setHint(e.target.value)}
        rows={4}
        placeholder="e.g. Replace the second paragraph with a stronger lead about [topic]. Drop the testimonials block at the bottom. Change every mention of '2024' to '2026'. — Be specific; this is a surgical edit pass, not a rewrite."
        className="w-full text-[11px] border border-[#6366f1]/30 rounded p-2 bg-white outline-none focus:border-[#6366f1] resize-y font-sans"
        disabled={applying}
      />
      {saveError && <div className="text-[10px] text-[#c0392b]">⚠ Save: {saveError}</div>}
      {applyError && <div className="text-[10px] text-[#c0392b]">⚠ Apply: {applyError}</div>}
      {applying && (
        <div className="text-[10px] text-muted italic">
          Claude is editing the buffer (~10-30s on a typical body). Don't refresh. The result becomes the new latest version automatically.
        </div>
      )}
      {lastSummary && lastSummary.length > 0 && (
        <div className="bg-white border border-[#16a34a]/30 rounded p-2 text-[10px]">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-[#16a34a]">✓ {lastSummary.length} change(s) applied — buffer updated</span>
            <span className="flex-1" />
            <button
              onClick={() => { setBeforeHtml(null); setAfterHtml(null); setLastSummary(null) }}
              className="text-[9px] py-0.5 px-1.5 bg-white border border-[#e5e5e5] text-muted rounded cursor-pointer"
              title="Hide the before/after preview. The buffer change stays applied — this just collapses the inline preview."
            >Dismiss preview</button>
          </div>
          <ul className="list-disc pl-4 text-muted space-y-0.5">
            {lastSummary.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
      {/* Inline before / after rendered preview — sits right under
          the Apply button so the operator can verify the surgical
          edit without scrolling. Iframe-styled to match the diff
          section below so visual parity is exact. */}
      {beforeHtml !== null && afterHtml !== null && (
        <details className="bg-white border border-[#6366f1]/30 rounded">
          <summary className="cursor-pointer py-1.5 px-2 text-[10px] font-medium flex items-center gap-2">
            <span>🔍 Rendered before / after</span>
            <span className="text-[9px] text-muted">Visual diff of the surgical edit. Scroll down for the full proposal diff + deploy.</span>
          </summary>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
            <div>
              <div className="text-[9px] text-muted mb-1">Before (pre-update buffer)</div>
              <RenderedPreview html={beforeHtml} tone="red" />
            </div>
            <div>
              <div className="text-[9px] text-muted mb-1">After (new buffer — applied)</div>
              <RenderedPreview html={afterHtml} tone="green" images={pageImages} />
            </div>
          </div>
          <div className="text-[8px] text-muted italic px-2 pb-2">
            Approximate styling — actual rendering uses the live theme on deploy. The new buffer is also reflected in the proposal diff + deploy block below.
          </div>
        </details>
      )}
      <div className="text-[9px] text-muted italic">
        Tip: save the text first if you want to come back to it. Apply reads the LATEST version (whatever's currently in the buffer — imported body, prior proposal, or prior targeted-update) and produces a new version with ONLY the listed edits applied.
      </div>
    </div>
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
  // Edit-mode state — keyed by citation id so only one row is
  // editable at a time without a separate "which row is open"
  // selector. editingDraft holds the in-progress edits.
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(null) // { query, snippet, source, notes }

  // Re-sync local state when the operator switches pages — initial
  // value is per-page, not session-wide.
  useEffect(() => {
    setCitations(Array.isArray(initial) ? initial : [])
    setAddOpen(false)
    setDraftQuery(''); setDraftSnippet(''); setDraftSource('google-ai-overview'); setDraftNotes('')
    setEditingId(null); setEditDraft(null)
  }, [landingPageId, initial])

  const startEdit = (c) => {
    setEditingId(c.id)
    setEditDraft({
      query: c.query || '',
      snippet: c.snippet || '',
      source: c.source || 'google-ai-overview',
      notes: c.notes || '',
    })
  }
  const cancelEdit = () => { setEditingId(null); setEditDraft(null) }
  const saveEdit = async () => {
    if (!editingId || !editDraft) return
    if (!editDraft.snippet.trim()) {
      setError('Snippet is required.')
      return
    }
    const next = citations.map(c => c.id === editingId ? {
      ...c,
      query: editDraft.query.trim(),
      snippet: editDraft.snippet.trim(),
      source: editDraft.source,
      notes: editDraft.notes.trim() || undefined,
    } : c)
    await persist(next)
    setEditingId(null); setEditDraft(null)
  }

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
          {citations.map(c => {
            const isEditing = editingId === c.id
            return (
              <details key={c.id} open={isEditing} className="bg-white border border-[#e5e5e5] rounded">
                <summary className="cursor-pointer py-1.5 px-2 text-[10px] flex items-center gap-2">
                  <span className="text-[9px] py-0.5 px-1.5 rounded bg-[#eef2ff] text-[#4338ca] font-medium">
                    {sourceLabel(c.source)}
                  </span>
                  <span className="font-medium truncate flex-1">"{c.query || '(no query)'}"</span>
                  <span className="text-[9px] text-muted flex-shrink-0">
                    {c.captured_at ? new Date(c.captured_at).toLocaleDateString() : ''}
                  </span>
                </summary>
                <div className="p-2 border-t border-[#f0f0f0] space-y-1.5">
                  {/* Read-only view */}
                  {!isEditing && (
                    <>
                      <div className="text-[10px] whitespace-pre-wrap bg-[#fafafa] border-l-2 border-[#6366f1] px-2 py-1.5 italic">
                        {c.snippet}
                      </div>
                      {c.notes && <div className="text-[9px] text-muted"><b>Notes:</b> {c.notes}</div>}
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => startEdit(c)}
                          disabled={saving}
                          className="text-[9px] py-0.5 px-1.5 bg-white border border-[#6366f1] text-[#4338ca] rounded cursor-pointer disabled:opacity-50"
                          title="Edit this citation — change source / query / snippet / notes. Same fields as the Add form."
                        >✏️ Edit</button>
                        <button
                          onClick={() => removeOne(c.id)}
                          disabled={saving}
                          className="text-[9px] py-0.5 px-1.5 bg-white border border-[#c0392b] text-[#c0392b] rounded cursor-pointer disabled:opacity-50"
                        >Remove</button>
                      </div>
                    </>
                  )}
                  {/* Edit mode — same fields as the add form, save-on-button */}
                  {isEditing && editDraft && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <label className="text-[9px] text-muted w-14">Source</label>
                        <select
                          value={editDraft.source}
                          onChange={e => setEditDraft(d => ({ ...d, source: e.target.value }))}
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
                          value={editDraft.query}
                          onChange={e => setEditDraft(d => ({ ...d, query: e.target.value }))}
                          placeholder='e.g. "what is a perfume bar"'
                          className="flex-1 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] text-muted mb-0.5">Snippet (the content to protect)</label>
                        <textarea
                          value={editDraft.snippet}
                          onChange={e => setEditDraft(d => ({ ...d, snippet: e.target.value }))}
                          rows={4}
                          placeholder='Paste the AI Overview / ChatGPT / Perplexity answer that quotes this page'
                          className="w-full text-[10px] border border-[#e5e5e5] rounded p-1 bg-white resize-y font-sans"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] text-muted mb-0.5">Notes <span className="opacity-60">(optional)</span></label>
                        <input
                          type="text"
                          value={editDraft.notes}
                          onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value }))}
                          placeholder='e.g. "Captured 2026-05-16, position #1 in AI Overview"'
                          className="w-full text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
                        />
                      </div>
                      <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-[#f0f0f0]">
                        <button
                          onClick={cancelEdit}
                          disabled={saving}
                          className="text-[9px] py-0.5 px-2 bg-white border border-[#e5e5e5] text-muted rounded cursor-pointer disabled:opacity-50"
                        >Cancel</button>
                        <button
                          onClick={saveEdit}
                          disabled={saving}
                          className="text-[9px] py-0.5 px-2 bg-[#4338ca] text-white border-none rounded cursor-pointer disabled:opacity-50"
                        >{saving ? 'Saving…' : 'Save changes'}</button>
                      </div>
                    </div>
                  )}
                </div>
              </details>
            )
          })}
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
function WorkflowWizard({ page, audit, proposal, history, recoveredProposal, liveCheckResults }) {
  // Step 1 — Audit. Done if last_audited_at on the page row OR an
  // audit was run this session. Plus per-finding state tracking:
  // each finding is pending / manual_done / skipped. Pending count
  // = "still needs your attention." Done + skipped = "addressed."
  const auditDate = audit?.created_at || page?.last_audited_at || null
  const hasAudit = !!auditDate
  const isAuditStale = hasAudit && (Date.now() - new Date(auditDate).getTime() > 30 * 24 * 60 * 60 * 1000)
  // Walk all findings across all dimensions; classify by state.
  let totalFindings = 0
  let pendingFindings = 0
  let manualDoneFindings = 0
  let skippedFindings = 0
  if (audit?.findings) {
    const states = audit.finding_states || {}
    for (const dim of ['seo', 'aeo', 'geo', 'eeat', 'ai_naturalness']) {
      const list = Array.isArray(audit.findings?.[dim]?.findings) ? audit.findings[dim].findings : []
      for (const f of list) {
        totalFindings++
        const s = states[f.suggestion_id]?.state || 'pending'
        if (s === 'manual_done') manualDoneFindings++
        else if (s === 'skipped') skippedFindings++
        else pendingFindings++
      }
    }
  }
  const auditNeedsWork = hasAudit && pendingFindings > 0

  // Step 2 — Proposal. Done if a proposal exists in-session OR a
  // recovered ai-suggested version exists.
  const proposalDate = proposal?.created_at || recoveredProposal?.created_at || null
  const hasProposal = !!proposalDate

  // Step 3 — AI score. Prefer in-session check results (lifted up
  // from ProposalDiff via onCheckResult), falling back to the
  // recovered version's stored check.
  const aiDetection = liveCheckResults?.ai_detection || recoveredProposal?.ai_detection || null
  const hasAi = !!aiDetection
  const aiScore = aiDetection?.score
  const aiActionable = aiDetection?.actionable_flagged_count

  // Step 4 — Voice check. Same lift-up pattern.
  const voiceCheck = liveCheckResults?.voice_check || recoveredProposal?.voice_check || null
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
    if (auditNeedsWork) next = 'audit' // findings still pending — operator should address them first
    else if (!hasProposal) next = 'proposal'
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
          status={!hasAudit ? 'never' : isAuditStale ? 'stale' : auditNeedsWork ? 'warning' : 'done'}
          statusText={
            !hasAudit ? 'Never audited' :
            isAuditStale ? `Stale (>30d) · ${pendingFindings}/${totalFindings} pending` :
            auditNeedsWork ? `⚠ ${pendingFindings}/${totalFindings} pending` :
            totalFindings > 0 ? `✓ All ${totalFindings} addressed` :
            '✓ Audited (no findings)'
          }
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
  // Banner itself is collapsed by default — operator expands to see
  // matched pages + refresh angles. The soonest season's days_ahead
  // chip stays visible in the summary so urgency is still readable
  // at a glance without expanding.
  return (
    <details className={`border rounded ${accent}`}>
      <summary className="cursor-pointer flex items-center gap-2 p-2.5">
        <span className="text-[11px] font-semibold">📅 Upcoming seasonal moments</span>
        <span className={`text-[9px] py-0.5 px-1.5 rounded font-mono ${soonest.days_ahead <= 14 ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#f0f0f0] text-muted'}`}>
          ({upcoming.length}) · soonest {soonest.days_ahead === 0 ? 'TODAY' : `in ${soonest.days_ahead}d`}
        </span>
        <span className="text-[9px] text-muted">— refresh pages ahead of the rush.</span>
        <div className="flex-1" />
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); onDismiss() }}
          className="text-[10px] text-muted bg-transparent border-none cursor-pointer"
          title="Hide for this session"
        >✕ Hide</button>
      </summary>
      <div className="p-2.5 pt-0 space-y-2">
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
    </details>
  )
}

// Cross-page site audit results panel. Renders 4 buckets of
// findings (graph / content / deploy / strategy) plus a summary
// strip. Per-finding "Open page" buttons let the operator jump
// straight into the workspace for the affected page.
// Per-tenant content-recency nudge. Buckets pages by
// days-since-last-deploy: fresh (≤90), stale (91-180), very stale
// (181-365), ancient (>365), never deployed. Renders collapsed
// banner with the worst bucket's count in the summary; expand to
// see per-page rows with last-deploy date + Open button. Dismiss
// is session-only so decaying pages re-surface every visit.
function RecencyBanner({ recency, onDismiss, onOpenPage }) {
  const total = recency.summary.stale + recency.summary.very_stale + recency.summary.ancient
  // Banner accent picks the worst bucket present — operators
  // working through Ancient pages should see the urgent tone, not
  // a generic warm one.
  const accent = recency.summary.ancient > 0
    ? 'border-[#c0392b]/40 bg-[#fef2f2]'
    : recency.summary.very_stale > 0
      ? 'border-[#d97706]/40 bg-[#fff7ed]'
      : 'border-[#6C5CE7]/30 bg-[#f5f3ff]'

  // Buckets rendered in worst-first order so the operator sees the
  // most-decayed pages first when they expand.
  const sections = [
    { key: 'ancient', label: 'Ancient (>1 year)', tone: 'text-[#c0392b]', items: recency.buckets.ancient },
    { key: 'very_stale', label: 'Very stale (6-12 months)', tone: 'text-[#d97706]', items: recency.buckets.very_stale },
    { key: 'stale', label: 'Stale (3-6 months)', tone: 'text-[#6C5CE7]', items: recency.buckets.stale },
  ].filter(s => s.items.length > 0)

  return (
    <details className={`border rounded ${accent}`}>
      <summary className="cursor-pointer flex items-center gap-2 p-2.5">
        <span className="text-[11px] font-semibold">🕐 Content recency</span>
        <span className={`text-[9px] py-0.5 px-1.5 rounded font-mono ${recency.summary.ancient > 0 ? 'bg-[#fee2e2] text-[#991b1b]' : recency.summary.very_stale > 0 ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#e0e7ff] text-[#3730a3]'}`}>
          {total} need{total === 1 ? 's' : ''} refresh
        </span>
        <span className="text-[9px] text-muted">— pages whose rankings will decay if not updated soon</span>
        <div className="flex-1" />
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); onDismiss() }}
          className="text-[10px] text-muted bg-transparent border-none cursor-pointer"
          title="Hide for this session"
        >✕ Hide</button>
      </summary>
      <div className="p-2.5 pt-0 space-y-2">
        {sections.map(s => (
          <div key={s.key} className="space-y-1">
            <div className={`text-[10px] font-medium ${s.tone}`}>
              {s.label} <span className="text-[9px] text-muted font-mono">({s.items.length})</span>
            </div>
            <div className="space-y-0.5">
              {s.items.map(p => (
                <div key={p.id} className="flex items-center gap-2 text-[10px] bg-white border border-[#e5e5e5] rounded px-2 py-1">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.label || `Page #${p.id}`}</div>
                    {p.url && <div className="text-[8px] text-muted truncate">{p.url}</div>}
                  </div>
                  <div className="text-[9px] text-muted whitespace-nowrap">
                    {p.days_since_deploy} days · {new Date(p.last_deployed_at).toLocaleDateString()}
                  </div>
                  <button
                    onClick={() => onOpenPage(p.id)}
                    className="text-[9px] py-0.5 px-1.5 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer flex-shrink-0"
                    title="Open in workspace — run audit + propose to refresh this page"
                  >Open →</button>
                </div>
              ))}
            </div>
          </div>
        ))}
        {recency.buckets.never_deployed.length > 0 && (
          <div className="text-[9px] text-muted italic pt-1 border-t border-[#e5e5e5]">
            ℹ {recency.buckets.never_deployed.length} page(s) imported but never deployed — they're not in the "stale" buckets because there's no baseline to age from. Generate + ship them to start the clock.
          </div>
        )}
      </div>
    </details>
  )
}

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

// Sitewide GSC keyword-rank report. Single GSC call returns
// (page, query) rows with current + prior position. We render a
// table with filter (managed-only / all), sort modes (by
// impressions / by position change / new only), and a per-row
// Open button to jump to the matching page workspace.
function KeywordRankReportPanel({ busy, report, error, onClose, onOpenPage }) {
  const [filter, setFilter] = useState('managed') // managed | all
  const [sortBy, setSortBy] = useState('impressions') // impressions | improving | declining | new
  const [query, setQuery] = useState('')
  const rows = useMemo(() => {
    if (!report?.rows) return []
    let r = report.rows
    if (filter === 'managed') r = r.filter(x => x.landing_page_id)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      r = r.filter(x => (x.query || '').toLowerCase().includes(q) || (x.page_label || '').toLowerCase().includes(q))
    }
    if (sortBy === 'impressions') r = r.slice().sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
    if (sortBy === 'improving') r = r.slice().sort((a, b) => (a.position_delta ?? 999) - (b.position_delta ?? 999))
    if (sortBy === 'declining') r = r.slice().sort((a, b) => (b.position_delta ?? -999) - (a.position_delta ?? -999))
    if (sortBy === 'new') r = r.slice().filter(x => x.new_this_period).sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
    return r.slice(0, 200) // cap render — most operators won't scroll past this
  }, [report, filter, sortBy, query])
  const positionColor = (pos) => typeof pos !== 'number' ? 'text-muted'
    : pos <= 3 ? 'text-[#15803d] font-semibold'
    : pos <= 10 ? 'text-[#16a34a]'
    : pos <= 20 ? 'text-[#d97706]'
    : 'text-muted'
  const deltaColor = (d) => typeof d !== 'number' ? 'text-muted'
    : d < -0.5 ? 'text-[#15803d]'    // improved (lower position = better)
    : d > 0.5 ? 'text-[#c0392b]'     // declined
    : 'text-muted'
  const deltaStr = (d) => typeof d !== 'number' ? '—'
    : d === 0 ? '·'
    : (d < 0 ? `↑${Math.abs(d).toFixed(1)}` : `↓${d.toFixed(1)}`)
  return (
    <div className="bg-white border border-[#6C5CE7]/30 rounded p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] font-semibold">📈 Keyword rank report</span>
        {report && (
          <span className="text-[9px] text-muted">
            {report.total_rows} (page, query) pairs · {report.windows.current.start} → {report.windows.current.end} vs {report.windows.prior.start} → {report.windows.prior.end}
          </span>
        )}
        <div className="flex-1" />
        <button onClick={onClose} className="text-[10px] text-muted bg-transparent border-none cursor-pointer">✕ Close</button>
      </div>
      {busy && <div className="text-[10px] text-muted italic">Pulling GSC current vs prior 28d (one call covers the whole property)…</div>}
      {error && (
        <div className="text-[10px] text-[#c0392b] bg-[#fef2f2] border border-[#c0392b]/30 rounded p-2">
          ⚠ {error}
          {/not connected|No GSC site|gsc_refresh_token/i.test(error) && (
            <div className="mt-1 text-[9px]">Connect GSC in the per-page GSC block (or on the GSC settings panel) before running this report.</div>
          )}
        </div>
      )}
      {report && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter by query or page label…"
              className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1.5 bg-white min-w-[200px]"
            />
            <select
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="text-[9px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
            >
              <option value="managed">Managed pages only ({(report.rows || []).filter(x => x.landing_page_id).length})</option>
              <option value="all">All pages ({report.total_rows})</option>
            </select>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="text-[9px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
            >
              <option value="impressions">Sort: most-visible first</option>
              <option value="improving">Sort: biggest gains</option>
              <option value="declining">Sort: biggest declines</option>
              <option value="new">New this period only</option>
            </select>
            <span className="text-[9px] text-muted">Showing {rows.length}</span>
          </div>
          <div className="bg-[#fafafa] border border-[#e5e5e5] rounded max-h-[500px] overflow-auto">
            <div className="grid grid-cols-[1fr_140px_50px_50px_50px_60px] gap-2 px-2 py-1 border-b border-[#e5e5e5] text-[9px] font-medium uppercase text-muted sticky top-0 bg-[#fafafa]">
              <div>Query</div>
              <div>Page</div>
              <div className="text-right">Pos</div>
              <div className="text-right">Δ</div>
              <div className="text-right">Impr</div>
              <div className="text-right">Action</div>
            </div>
            {rows.map((r, i) => (
              <div key={`${r.page}|${r.query}|${i}`} className="grid grid-cols-[1fr_140px_50px_50px_50px_60px] gap-2 px-2 py-1 border-b border-[#f0f0f0] last:border-0 text-[10px] items-center">
                <div className="truncate min-w-0">
                  <div className="font-medium truncate">{r.query}</div>
                  <div className="text-[8px] text-muted truncate">{r.page}</div>
                </div>
                <div className="truncate min-w-0">
                  {r.page_label ? (
                    <span className="text-[9px]">{r.page_label}</span>
                  ) : (
                    <span className="text-[9px] text-muted italic">(unmanaged)</span>
                  )}
                </div>
                <div className={`text-right font-mono text-[10px] ${positionColor(r.position)}`}>
                  {typeof r.position === 'number' ? r.position.toFixed(1) : '—'}
                </div>
                <div className={`text-right font-mono text-[9px] ${deltaColor(r.position_delta)}`} title={typeof r.position_delta === 'number' ? `Position changed ${r.position_delta > 0 ? '+' : ''}${r.position_delta.toFixed(2)} (negative = improved)` : ''}>
                  {r.new_this_period ? <span className="text-[#6C5CE7]">new</span> : deltaStr(r.position_delta)}
                </div>
                <div className="text-right text-[9px] text-muted font-mono">{r.impressions || 0}</div>
                <div className="text-right">
                  {r.landing_page_id ? (
                    <button
                      onClick={() => onOpenPage(r.landing_page_id)}
                      className="text-[9px] py-0.5 px-1.5 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer"
                    >Open →</button>
                  ) : (
                    <span className="text-[8px] text-muted">—</span>
                  )}
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <div className="text-[9px] text-muted italic p-2">No rows match the current filter.</div>
            )}
          </div>
          <div className="text-[9px] text-muted italic">
            Position is GSC's average position over the 28-day window. ↑ = improved (lower number is better). New = query didn't appear in the prior window. Click a row to jump to the matching managed page workspace.
          </div>
        </>
      )}
    </div>
  )
}

// Sitewide voice-drift report panel. Mirrors BulkDeployPanel
// pattern: parent owns the polling, component is pure-render +
// emits onStart. Ranks per-page scores worst-first so the
// operator sees the biggest outliers without scrolling.
function VoiceDriftPanel({ job, error, elapsed, onStart, onClose, onOpenPage }) {
  const isRunning = job?.status === 'running'
  const isDone = job?.status === 'done'
  const hasJob = !!job && job.status !== 'idle'
  // Sort done-job results worst-first (off-brand → neutral → on-voice)
  // so the operator's eye lands on the pages that need attention.
  const sorted = (job?.results || []).slice().sort((a, b) => {
    const sa = typeof a.score === 'number' ? a.score : 999
    const sb = typeof b.score === 'number' ? b.score : 999
    return sa - sb
  })
  const verdictColor = (v) => v === 'on-voice' ? 'text-[#15803d]'
    : v === 'neutral-generic' ? 'text-[#d97706]'
    : v === 'off-brand' ? 'text-[#c0392b]'
    : 'text-muted'
  const scoreColor = (s) => typeof s !== 'number' ? 'text-muted'
    : s >= 75 ? 'text-[#15803d]'
    : s >= 50 ? 'text-[#d97706]'
    : 'text-[#c0392b]'
  return (
    <div className="bg-white border border-[#6C5CE7]/30 rounded p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-semibold">🎭 Voice drift report</span>
        {isRunning && (
          <span className="text-[9px] text-muted">
            Checking… {job.processed}/{job.total} · {elapsed}s elapsed
          </span>
        )}
        {isDone && (
          <span className="text-[9px] text-muted">
            {job.results.filter(r => r.status === 'ok').length}/{job.total} scored
            {job.results.filter(r => r.status === 'failed').length > 0 && (
              <span className="ml-1 text-[#c0392b]">· {job.results.filter(r => r.status === 'failed').length} failed</span>
            )}
            {job.elapsed_ms && <span className="ml-1">· {(job.elapsed_ms / 1000).toFixed(1)}s</span>}
          </span>
        )}
        <div className="flex-1" />
        <button onClick={onClose} className="text-[10px] text-muted bg-transparent border-none cursor-pointer">✕ Close</button>
      </div>
      {error && <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>}
      {!hasJob && (
        <>
          <div className="text-[10px] text-muted">
            Runs the brand-voice check on every managed page sequentially. ~15-20s per page · ~5-10 min for a full sitemap. The voice baseline is the tenant's voice anchors + editorial policy + up to 2 already-deployed pages used as on-voice samples.
          </div>
          <div className="text-[10px] text-muted italic">
            Results persist on each version row so the per-page voice-check panel reflects them after this completes. Use the scores to identify which pages need a re-propose with voice feedback.
          </div>
          <button
            onClick={onStart}
            className="text-[10px] py-1 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer"
          >🎭 Start voice drift report</button>
        </>
      )}
      {hasJob && (
        <>
          <div className="text-[9px] text-muted">
            {isRunning && <>Running. Worst-first ranking lands as each page finishes — failures don't stop the run.</>}
            {isDone && <>Sorted worst-first. Open any page to re-propose with voice feedback ("🎯 Re-propose with feedback" on the page workspace).</>}
          </div>
          <div className="bg-[#fafafa] border border-[#e5e5e5] rounded max-h-[400px] overflow-auto">
            <div className="grid grid-cols-[60px_1fr_90px_60px_60px] gap-2 px-2 py-1 border-b border-[#e5e5e5] text-[9px] font-medium uppercase text-muted">
              <div>Score</div>
              <div>Page</div>
              <div>Verdict</div>
              <div className="text-right">Drifts</div>
              <div className="text-right">Action</div>
            </div>
            {sorted.map(r => (
              <div key={r.landing_page_id} className="grid grid-cols-[60px_1fr_90px_60px_60px] gap-2 px-2 py-1 border-b border-[#f0f0f0] last:border-0 text-[10px] items-center">
                <div className={`text-center font-mono font-medium ${scoreColor(r.score)}`}>
                  {r.status === 'failed' ? '✗' : typeof r.score === 'number' ? r.score : '…'}
                </div>
                <div className="truncate min-w-0">
                  <div className="font-medium truncate">{r.label || `Page #${r.landing_page_id}`}</div>
                  {r.summary && <div className="text-[8px] text-muted truncate" title={r.summary}>{r.summary}</div>}
                  {r.error && <div className="text-[8px] text-[#c0392b] truncate" title={r.error}>{r.error}</div>}
                </div>
                <div className={`text-[9px] ${verdictColor(r.verdict)}`}>{r.verdict || (r.status === 'running' ? 'running' : '—')}</div>
                <div className="text-right text-[9px] text-muted">{r.actionable_drift_count ?? '—'}</div>
                <div className="text-right">
                  <button
                    onClick={() => onOpenPage(r.landing_page_id)}
                    className="text-[9px] py-0.5 px-1.5 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer"
                  >Open →</button>
                </div>
              </div>
            ))}
            {sorted.length === 0 && (
              <div className="text-[9px] text-muted italic p-2">Waiting for the first page to finish…</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// Bulk deploy preview + per-page progress. Walks the operator
// through (1) preview list → confirm, (2) running progress,
// (3) final results with deploy status + link to each page.
//
// Doesn't own the polling — parent (LandingPages) manages the
// in-flight job state and passes it down. This component is
// pure render + emits onConfirm to start the deploy.
function BulkDeployPanel({ preview, previewError, job, jobError, elapsed, onConfirm, onClose, onOpenPage }) {
  const isRunning = job?.status === 'running'
  const isDone = job?.status === 'done'
  const hasJob = !!job && job.status !== 'idle'
  // When the job is in flight or finished, the per-page progress
  // table is the source of truth. Before kickoff, render the
  // preview (the "what's about to happen" list).
  return (
    <div className="bg-white border border-[#c0392b]/30 rounded p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-semibold">🚀 Bulk deploy</span>
        {isRunning && (
          <span className="text-[9px] text-muted">
            Deploying… {job.processed}/{job.total} · {elapsed}s elapsed
          </span>
        )}
        {isDone && job?.results && (
          <span className="text-[9px] text-muted">
            {job.results.filter(r => r.status === 'deployed').length}/{job.total} deployed
            {job.results.filter(r => r.status === 'failed').length > 0 && (
              <span className="ml-1 text-[#c0392b]">· {job.results.filter(r => r.status === 'failed').length} failed</span>
            )}
            {job.elapsed_ms && <span className="ml-1">· {(job.elapsed_ms / 1000).toFixed(1)}s</span>}
          </span>
        )}
        <div className="flex-1" />
        <button onClick={onClose} className="text-[10px] text-muted bg-transparent border-none cursor-pointer">✕ Close</button>
      </div>

      {previewError && <div className="text-[10px] text-[#c0392b]">⚠ {previewError}</div>}
      {jobError && <div className="text-[10px] text-[#c0392b]">⚠ {jobError}</div>}

      {/* Preview state — pre-kickoff */}
      {!hasJob && !previewError && (
        <>
          {preview === null && <div className="text-[10px] text-muted italic">Loading preview…</div>}
          {preview && preview.count === 0 && (
            <div className="text-[10px] text-muted italic">
              Nothing to deploy. Every managed page either has no proposal yet OR its latest proposal already matches what's live on WordPress. Generate / iterate on proposals first.
            </div>
          )}
          {preview && preview.count > 0 && (
            <>
              <div className="text-[10px] text-muted">
                <b>{preview.count}</b> page{preview.count === 1 ? ' has' : 's have'} a proposal newer than what's currently live. Review the list, then click Confirm to start the sequential deploy.
              </div>
              <div className="bg-[#fafafa] border border-[#e5e5e5] rounded max-h-[280px] overflow-auto">
                <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-2 py-1 border-b border-[#e5e5e5] text-[9px] font-medium uppercase text-muted">
                  <div>Page</div>
                  <div>Last deployed</div>
                  <div className="text-right">Candidate</div>
                </div>
                {preview.pages.map(p => (
                  <div key={p.id} className="grid grid-cols-[1fr_auto_auto] gap-2 px-2 py-1 border-b border-[#f0f0f0] last:border-0 text-[10px] items-center">
                    <div className="truncate">
                      <span className="font-medium">{p.label || `Page #${p.id}`}</span>
                      {p.url && <div className="text-[8px] text-muted truncate">{p.url}</div>}
                    </div>
                    <div className="text-[9px] text-muted">
                      {p.last_deployed_at ? new Date(p.last_deployed_at).toLocaleString() : <span className="text-[#d97706]">never deployed</span>}
                    </div>
                    <div className="text-[9px] font-mono text-right text-muted">v#{p.candidate_version_id}</div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={onConfirm}
                  className="text-[10px] py-1 px-3 bg-[#c0392b] text-white border-none rounded cursor-pointer"
                  title={`Start the sequential deploy. ~${Math.max(1, Math.ceil(preview.count * 8 / 60))} min total. Each page is backed up first; rollback stays available.`}
                >🚀 Confirm + deploy {preview.count} page{preview.count === 1 ? '' : 's'}</button>
                <span className="text-[9px] text-muted italic">
                  Sequential — one page at a time. Don't close the tab; the server keeps running but the FE has to re-poll on reload.
                </span>
              </div>
            </>
          )}
        </>
      )}

      {/* In-flight / done state — per-page progress table */}
      {hasJob && (
        <>
          <div className="text-[9px] text-muted">
            {isRunning && <>Deploying sequentially. The table updates as each page completes — failures don't stop the run.</>}
            {isDone && <>Run complete. Click "Open →" on any row to jump to its workspace.</>}
          </div>
          <div className="bg-[#fafafa] border border-[#e5e5e5] rounded max-h-[400px] overflow-auto">
            <div className="grid grid-cols-[24px_1fr_90px_70px] gap-2 px-2 py-1 border-b border-[#e5e5e5] text-[9px] font-medium uppercase text-muted">
              <div></div>
              <div>Page</div>
              <div>Status</div>
              <div className="text-right">Action</div>
            </div>
            {(job.results || []).map(r => {
              const tone = r.status === 'deployed' ? 'text-[#15803d]'
                : r.status === 'failed' ? 'text-[#c0392b]'
                : 'text-muted'
              const icon = r.status === 'deployed' ? '✓'
                : r.status === 'failed' ? '✗'
                : '…'
              return (
                <div key={r.landing_page_id} className="grid grid-cols-[24px_1fr_90px_70px] gap-2 px-2 py-1 border-b border-[#f0f0f0] last:border-0 text-[10px] items-center">
                  <span className={`font-mono text-[12px] ${tone}`}>{icon}</span>
                  <div className="truncate">
                    <span className="font-medium">{r.label || `Page #${r.landing_page_id}`}</span>
                    {r.error && <div className="text-[8px] text-[#c0392b] truncate" title={r.error}>{r.error}</div>}
                    {r.live_url && r.status === 'deployed' && (
                      <div className="text-[8px] text-muted truncate">
                        <a href={r.live_url} target="_blank" rel="noopener noreferrer" className="text-[#6C5CE7] underline">↗ live page</a>
                        {r.elapsed_ms && <span className="ml-1">· {(r.elapsed_ms / 1000).toFixed(1)}s</span>}
                      </div>
                    )}
                  </div>
                  <div className={`text-[9px] ${tone}`}>{r.status}</div>
                  <div className="text-right">
                    <button
                      onClick={() => onOpenPage(r.landing_page_id)}
                      className="text-[9px] py-0.5 px-1.5 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer"
                    >Open →</button>
                  </div>
                </div>
              )
            })}
            {(!job.results || job.results.length === 0) && (
              <div className="text-[9px] text-muted italic p-2">Waiting for the first page to finish…</div>
            )}
          </div>
        </>
      )}
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
function BodyEditorWithToggle({ sourcePage, currentBodyHtml, landingPageId, currentVersionId, isHumanized, pageImages, onSaved, onSourcePatch }) {
  const [mode, setMode] = useState('preview') // 'preview' | 'html'
  const [prepH1Busy, setPrepH1Busy] = useState(false)
  const [prepH1Msg, setPrepH1Msg] = useState(null)
  // Re-mount key forces the underlying editor to discard its local
  // state on mode switch — otherwise unsaved drafts in one mode
  // could leak visually into the other. The actual save target is
  // always the DB so cross-mode leakage would also confuse the
  // operator about what's persisted.
  const editorKey = `${mode}-${currentVersionId}`

  const handlePrependH1 = async () => {
    if (!landingPageId || !currentVersionId || prepH1Busy) return
    setPrepH1Busy(true); setPrepH1Msg(null)
    try {
      const r = await api.prependLandingVersionH1(landingPageId, currentVersionId)
      if (typeof onSaved === 'function') onSaved(r.body_html)
      // Refresh the source-page panels (Heading structure +
      // Body HTML preview). The BE re-parsed headings server-side
      // and returned them on the response; merge into PageWorkspace
      // page state so the new H1 shows up immediately without a
      // full page reload.
      if (typeof onSourcePatch === 'function') {
        onSourcePatch({
          body_html: r.body_html,
          headings: Array.isArray(r.headings) ? r.headings : undefined,
        })
      }
      setPrepH1Msg({ tone: 'ok', text: `✓ H1 set: "${r.h1_text}"` })
    } catch (e) {
      setPrepH1Msg({ tone: 'err', text: e?.message || String(e) })
    } finally {
      setPrepH1Busy(false)
    }
  }

  return (
    <div className="border border-[#e5e5e5] rounded">
      <div className="flex items-center gap-2 p-2 bg-[#fafafa] border-b border-[#e5e5e5]">
        <span className="text-[10px] font-medium">Body editor</span>
        <span className="text-[9px] text-muted italic">
          Switching modes reloads from the saved version — save your edits first or they'll be discarded.
        </span>
        <span className="flex-1" />
        <button
          onClick={handlePrependH1}
          disabled={prepH1Busy}
          className="text-[9px] py-1 px-2 bg-white border border-[#d97706] text-[#d97706] rounded cursor-pointer disabled:opacity-50"
          title="Idempotently prepend an <h1> matching the page title to the top of body_html. Strips any existing leading <h1> first, so it's safe to click multiple times. Use this on pages generated under the old 'no H1 in body' rule."
        >{prepH1Busy ? 'Working…' : '📐 Prepend <h1> from title'}</button>
        {prepH1Msg && (
          <span className={`text-[9px] ${prepH1Msg.tone === 'ok' ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>
            {prepH1Msg.text}
          </span>
        )}
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
          pageImages={pageImages}
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

function RenderedPreviewSection({ sourcePage, currentBodyHtml, landingPageId, currentVersionId, isHumanized, pageImages, onSaved }) {
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
            <RenderedPreview html={currentBodyHtml || ''} tone="green" images={pageImages} />
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

// Phase 5: platform-switch modal. Lets the operator change the
// tenant's site_platform between 'wordpress' and 'ecommerce'.
// Modal explains what changes (renderer swap, automated WP →
// copy-paste packets) and what stays (content + sitemap + all
// WP credentials preserved so switching back is instant).
// Optional re-audit checkbox runs the site audit + non-destructive
// slot classifier after the switch (recommended when switching
// TO ecommerce).
function PlatformSwitchModal({ currentPlatform, targetUrl, onClose, onSwitched }) {
  const [target, setTarget] = useState(currentPlatform === 'ecommerce' ? 'wordpress' : 'ecommerce')
  const [reAudit, setReAudit] = useState(currentPlatform !== 'ecommerce') // default ON when switching to ecommerce
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const switchPlatform = async () => {
    if (busy) return
    setBusy(true); setError(null); setResult(null)
    try {
      const r = await api.switchTenantPlatform({
        sitePlatform: target,
        ecommerceProvider: target === 'ecommerce' ? 'square' : undefined,
        reAudit,
      })
      setResult(r)
      // Small delay so the operator sees the success state before
      // the parent reload kicks in.
      setTimeout(() => onSwitched && onSwitched(r), 800)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const isSamePlatform = target === currentPlatform

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
      onClick={onClose}
    >
      <div
        className="bg-white rounded shadow-lg max-w-lg w-full max-h-[90vh] overflow-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b border-[#e5e5e5] flex items-center gap-2">
          <span className="text-[14px] font-semibold">Change publishing platform</span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-[12px] text-muted bg-transparent border-none cursor-pointer">✕</button>
        </div>

        <div className="p-4 space-y-3 text-[11px]">
          {/* Current state */}
          <div className="bg-[#fafafa] border border-[#e5e5e5] rounded p-2">
            <div className="text-[9px] uppercase text-muted font-medium">Current</div>
            <div className="text-[11px] mt-0.5">
              {currentPlatform === 'ecommerce'
                ? <>🛒 <b>Ecommerce</b> — packet output (copy/paste into Square's editor)</>
                : <>📝 <b>WordPress</b> — automated REST publishing via Yoast/Rank Math/AIOSEO</>
              }
            </div>
          </div>

          {/* Target picker */}
          <div className="space-y-1.5">
            <div className="text-[9px] uppercase text-muted font-medium">Switch to</div>
            <label className={`flex items-start gap-2 border rounded p-2 cursor-pointer ${target === 'wordpress' ? 'border-[#6366f1] bg-[#eef2ff]' : 'border-[#e5e5e5] bg-white'}`}>
              <input
                type="radio"
                checked={target === 'wordpress'}
                onChange={() => setTarget('wordpress')}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="font-medium">📝 WordPress</div>
                <div className="text-[10px] text-muted">Automated publish via WP REST + Yoast / Rank Math / AIOSEO meta. The current default for all PostyPosty tenants.</div>
              </div>
            </label>
            <label className={`flex items-start gap-2 border rounded p-2 cursor-pointer ${target === 'ecommerce' ? 'border-[#d97706] bg-[#fff7ed]' : 'border-[#e5e5e5] bg-white'}`}>
              <input
                type="radio"
                checked={target === 'ecommerce'}
                onChange={() => setTarget('ecommerce')}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="font-medium">🛒 Ecommerce (Square Online)</div>
                <div className="text-[10px] text-muted">Generates 9-section copy/paste packets — page settings, SEO meta, OG/Twitter, body blocks, embed code (CSS + FAQ HTML + JSON-LD), internal links, validation checklist. Operator pastes into Square's page editor.</div>
              </div>
            </label>
          </div>

          {/* What happens explanation */}
          <div className="bg-[#eef2ff] border border-[#6366f1]/30 rounded p-2 text-[10px] space-y-1">
            <div className="font-medium text-[#3730a3]">What changes vs. what stays:</div>
            <ul className="list-disc pl-4 space-y-0.5">
              <li><b>Stays:</b> all slot data + landing page content + version history + audit history + WordPress credentials (preserved so switching back is instant).</li>
              <li><b>Changes:</b> the renderer dispatched on deploy. {target === 'ecommerce' ? 'Deploy buttons become 📦 Generate packet surfaces. No automated publish — operator pastes the packet into Square.' : 'Packet surfaces go away — Deploy publishes to WordPress automatically again.'}</li>
              <li><b>Reversible:</b> click the platform pill again anytime. Pages already published on the prior platform stay live where they were published — switching the renderer doesn't unpublish anything.</li>
            </ul>
          </div>

          {/* Re-audit checkbox */}
          <label className="flex items-start gap-2 cursor-pointer p-2 border border-[#e5e5e5] rounded bg-white">
            <input
              type="checkbox"
              checked={reAudit}
              onChange={e => setReAudit(e.target.checked)}
              className="mt-0.5"
              disabled={!targetUrl}
            />
            <div className="flex-1 text-[10px]">
              <div className="font-medium">🔍 Re-audit my site after switching</div>
              <div className="text-muted">
                {targetUrl
                  ? <>Runs the site audit + classifies existing slots against the live state ({targetUrl}). Recommended {target === 'ecommerce' ? 'when switching TO ecommerce — surfaces what\'s on the Square site.' : 'when switching TO WordPress — refreshes the audit against the live WP state.'}</>
                  : <>Disabled — set tenant.target_url first.</>
                }
              </div>
            </div>
          </label>

          {/* Result / error */}
          {error && (
            <div className="bg-[#fef2f2] border border-[#c0392b]/30 rounded p-2 text-[10px] text-[#c0392b]">⚠ {error}</div>
          )}
          {result && (
            <div className="bg-[#f0fdf4] border border-[#15803d]/30 rounded p-2 text-[10px] text-[#15803d]">
              ✓ Switched: {result.previous_platform} → {result.site_platform}.
              {result.re_audit && !result.re_audit.error && (
                <> Re-audit found {result.re_audit.audit_url_count || 0} pages
                {result.re_audit.classified_summary && <>; classified {result.re_audit.classified_summary.enhance + result.re_audit.classified_summary.fix} slot(s) ({result.re_audit.classified_summary.enhance}E / {result.re_audit.classified_summary.fix}F).</>}
                </>
              )}
              {result.re_audit?.error && <span className="text-[#92400e]"> — re-audit issue: {result.re_audit.error}</span>}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[#e5e5e5] flex items-center gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-[11px] py-1.5 px-3 bg-white border border-[#e5e5e5] text-ink rounded cursor-pointer disabled:opacity-50"
          >Cancel</button>
          <span className="flex-1" />
          <button
            onClick={switchPlatform}
            disabled={busy || isSamePlatform || !!result}
            className={`text-[11px] py-1.5 px-3 border-none rounded cursor-pointer disabled:opacity-50 ${
              target === 'ecommerce' ? 'bg-[#d97706] text-white' : 'bg-[#6C5CE7] text-white'
            }`}
          >
            {busy ? 'Switching…'
              : result ? '✓ Switched'
              : isSamePlatform ? 'Already on this platform'
              : `Switch to ${target === 'ecommerce' ? '🛒 Ecommerce' : '📝 WordPress'}`}
          </button>
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

// Final-gate checklist rendered above DeployBlock. Synthesizes
// every input that matters at publish time (schema allowlist,
// images + alt text + featured, AI detection score, voice check,
// meta description, gap analysis applied) into a single
// at-a-glance status panel. Informational — operator can still
// click Deploy with reds visible; this just makes the gaps
// obvious instead of hidden behind scrolled-past panels.
//
// Each row has:
//   - status icon (✓ ok | ⚠ warn | ✗ fail | — n/a)
//   - label + short status reason
//   - "Fix →" jump link to the relevant workspace anchor
//
// Score color in the header summarizes ready vs not.
function PreDeployChecklist({ landingPageId, versionId, proposal, pageImages, liveCheckResults, pageDetail }) {
  // Schema_types live on landing_pages.schema_types — separate
  // fetch since neither proposal nor pageDetail carry it. Cheap
  // single-int query; refresh on landing_page_id change.
  const [schemaTypes, setSchemaTypes] = useState(null) // null = loading, [] = no restriction, [...] = N types
  useEffect(() => {
    let cancelled = false
    api.getLandingPageSchemaTypes(landingPageId)
      .then(r => { if (!cancelled) setSchemaTypes(Array.isArray(r?.schema_types) ? r.schema_types : []) })
      .catch(() => { if (!cancelled) setSchemaTypes([]) })
    return () => { cancelled = true }
  }, [landingPageId])

  // Build the check rows. Order matters — schema + images first
  // (most often missed), then content checks, then optional ones.
  const ai = liveCheckResults?.ai_detection || null
  const voice = liveCheckResults?.voice_check || null
  const p = proposal?.proposal || {}
  const imagesWithAlt = (pageImages || []).filter(i => (i.alt_text || '').trim().length > 0)
  const featuredImage = (pageImages || []).find(i => i.role === 'featured')
  const gapApplied = !!(pageDetail?.page?.last_gap_analyzed_at) // any gap analysis run counts

  const checks = [
    {
      key: 'schema',
      label: 'Schema types allowlist',
      status: schemaTypes === null ? 'loading'
        : schemaTypes.length === 0 ? 'warn'
        : 'ok',
      detail: schemaTypes === null ? 'loading…'
        : schemaTypes.length === 0 ? 'no explicit allowlist — Claude will guess types per page'
        : `${schemaTypes.length} type(s) — ${schemaTypes.join(', ')}`,
      fixHint: 'scroll up to 🏷️ Page schema allowlist',
    },
    {
      key: 'images',
      label: 'At least one image attached',
      status: (pageImages || []).length === 0 ? 'fail' : 'ok',
      detail: (pageImages || []).length === 0
        ? 'no images on this page'
        : `${pageImages.length} image(s) attached`,
      fixHint: 'scroll up to 🖼️ Images panel',
    },
    {
      key: 'featured',
      label: 'Featured / hero image set',
      status: (pageImages || []).length === 0 ? 'skip'
        : featuredImage ? 'ok'
        : 'warn',
      detail: (pageImages || []).length === 0 ? 'n/a — no images yet'
        : featuredImage ? `★ ${featuredImage.filename}`
        : 'no image marked featured — WP theme may not have a hero image',
      fixHint: 'click ★ Feature on the image you want as hero in 🖼️ Images',
    },
    {
      key: 'alt-text',
      label: 'All images have alt text',
      status: (pageImages || []).length === 0 ? 'skip'
        : imagesWithAlt.length === pageImages.length ? 'ok'
        : 'warn',
      detail: (pageImages || []).length === 0 ? 'n/a — no images yet'
        : `${imagesWithAlt.length} / ${pageImages.length} have alt text`,
      fixHint: 'click the italic alt-text line under each image in 🖼️ Images',
    },
    {
      key: 'meta-desc',
      label: 'Meta description',
      status: !p.meta_description ? 'fail'
        : (p.meta_description.length < 50 || p.meta_description.length > 160) ? 'warn'
        : 'ok',
      detail: !p.meta_description ? 'missing — Google will synthesize from body'
        : p.meta_description.length < 50 ? `${p.meta_description.length} chars — too short`
        : p.meta_description.length > 160 ? `${p.meta_description.length} chars — may truncate in SERP`
        : `${p.meta_description.length} chars — good`,
      fixHint: 'expand "Meta changes" in the proposal panel above',
    },
    {
      key: 'focus-kw',
      label: 'Focus keyword',
      status: !p.focus_keyword ? 'warn' : 'ok',
      detail: !p.focus_keyword ? 'missing — Yoast/Rank Math grading uses this'
        : `"${p.focus_keyword}"`,
      fixHint: 'expand "Meta changes" in the proposal panel above',
    },
    {
      key: 'ai-score',
      label: 'AI-detection score',
      status: !ai ? 'warn'
        : typeof ai.score !== 'number' ? 'warn'
        : ai.score < 30 ? 'ok'
        : ai.score < 50 ? 'warn'
        : 'fail',
      detail: !ai ? 'not run yet — click "Check AI score" in the proposal panel'
        : typeof ai.score !== 'number' ? 'no score available'
        : ai.score < 30 ? `${ai.score}% — looks human`
        : ai.score < 50 ? `${ai.score}% — borderline, consider humanize`
        : `${ai.score}% — Claude-like, run Humanize or Re-propose`,
      fixHint: 'use the 🔵 AI check panel in the proposal section',
    },
    {
      key: 'voice',
      label: 'Voice check',
      status: !voice ? 'warn'
        : typeof voice.score !== 'number' ? 'warn'
        : voice.score >= 70 ? 'ok'
        : voice.score >= 50 ? 'warn'
        : 'fail',
      detail: !voice ? 'not run yet — click "Check brand voice" in the proposal panel'
        : typeof voice.score !== 'number' ? 'no score available'
        : voice.score >= 70 ? `${voice.score}/100 — on-brand`
        : voice.score >= 50 ? `${voice.score}/100 — some drift`
        : `${voice.score}/100 — significant drift, re-propose with feedback`,
      fixHint: 'use the voice-check panel in the proposal section',
    },
    {
      key: 'gap',
      label: 'Competitive gap analysis',
      status: gapApplied ? 'ok' : 'warn',
      detail: gapApplied
        ? `analyzed ${new Date(pageDetail.page.last_gap_analyzed_at).toLocaleDateString()}`
        : 'not run yet — recommended to confirm parity with the competitor',
      fixHint: 'scroll to ⚔️ Competitive gap analysis below the proposal',
    },
  ]

  // Roll-up: ok counts toward ready, fail/warn don't. Skip is neutral.
  const counted = checks.filter(c => c.status !== 'skip' && c.status !== 'loading')
  const okCount = counted.filter(c => c.status === 'ok').length
  const failCount = checks.filter(c => c.status === 'fail').length
  const warnCount = checks.filter(c => c.status === 'warn').length
  const allGreen = failCount === 0 && warnCount === 0 && counted.length > 0
  const headerColor = failCount > 0 ? 'border-[#c0392b]/40 bg-[#fef2f2]'
    : warnCount > 0 ? 'border-[#d97706]/40 bg-[#fff7ed]'
    : 'border-[#16a34a]/40 bg-[#f0fdf4]'
  const headerLabel = failCount > 0 ? `${failCount} blocker${failCount === 1 ? '' : 's'}`
    : warnCount > 0 ? `${warnCount} warning${warnCount === 1 ? '' : 's'}`
    : 'all checks green'

  return (
    <details className={`border rounded ${headerColor}`} open={!allGreen}>
      <summary className="cursor-pointer flex items-center gap-2 p-3">
        <span className="text-[11px] font-medium">✅ Pre-deploy checklist</span>
        <span className="text-[9px] font-mono py-0.5 px-1.5 rounded bg-white border border-[#e5e5e5]">
          {okCount} / {counted.length} ready
        </span>
        <span className="text-[9px]">
          {failCount > 0 && <span className="text-[#c0392b] font-medium">⚠ {headerLabel}</span>}
          {failCount === 0 && warnCount > 0 && <span className="text-[#d97706] font-medium">⚠ {headerLabel}</span>}
          {allGreen && <span className="text-[#15803d] font-medium">✓ {headerLabel}</span>}
        </span>
        <span className="text-[9px] text-muted">— informational, doesn't block deploy</span>
        <span className="flex-1" />
      </summary>
      <div className="p-3 pt-0 space-y-1">
        {checks.map(c => {
          const icon = c.status === 'ok' ? '✓'
            : c.status === 'warn' ? '⚠'
            : c.status === 'fail' ? '✗'
            : c.status === 'loading' ? '…'
            : '—'
          const color = c.status === 'ok' ? 'text-[#15803d]'
            : c.status === 'warn' ? 'text-[#d97706]'
            : c.status === 'fail' ? 'text-[#c0392b]'
            : 'text-muted'
          const showFix = c.status === 'fail' || c.status === 'warn'
          return (
            <div key={c.key} className="flex items-start gap-2 text-[10px] bg-white border border-[#e5e5e5] rounded p-1.5">
              <span className={`font-mono text-[12px] w-4 ${color}`} aria-hidden>{icon}</span>
              <div className="flex-1 min-w-0">
                <div className={`font-medium ${color}`}>{c.label}</div>
                <div className="text-[9px] text-muted">{c.detail}</div>
              </div>
              {showFix && (
                <div className="text-[9px] text-[#6C5CE7] italic flex-shrink-0">→ {c.fixHint}</div>
              )}
            </div>
          )
        })}
      </div>
    </details>
  )
}

// Phase 4 (multi-platform): Square packet panel. Replaces the
// WordPress Deploy block on ecommerce tenants. Generates the
// 9-section copy/paste packet via the BE, renders each section
// as a collapsible card with per-field + per-section + whole-
// packet copy buttons, character-count badges with traffic-light
// tone, schema-type badges, and an interactive validation
// checklist with session-local state.
function SquarePacketPanel({ landingPageId, versionId, platformCapabilities }) {
  const [packet, setPacket] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [generatedAt, setGeneratedAt] = useState(null)
  // Per-check completion state for the validation checklist.
  // Session-local — no server-side persistence (packets are
  // ephemeral; operator typically works through the checklist in
  // one sitting).
  const [validationDone, setValidationDone] = useState({})
  const [copiedFlash, setCopiedFlash] = useState(null) // key of last-copied element

  const generate = async () => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const r = await api.generateSquarePacket(landingPageId, { versionId })
      setPacket(r?.packet || null)
      setGeneratedAt(r?.generated_at || null)
      setValidationDone({})
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const flashCopied = (key) => {
    setCopiedFlash(key)
    setTimeout(() => setCopiedFlash(prev => prev === key ? null : prev), 1500)
  }
  const copyText = async (text, key) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      flashCopied(key)
    } catch (e) {
      // Clipboard API can fail on insecure contexts; fall back to
      // the legacy textarea trick so the operator isn't blocked.
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy'); flashCopied(key) } catch { /* swallow */ }
      document.body.removeChild(ta)
    }
  }

  // Copy the whole packet as one big formatted text dump. Useful
  // for archiving alongside the project record.
  const copyEntirePacket = async () => {
    if (!packet) return
    const lines = []
    lines.push(`# PostyPosty Square Packet`)
    lines.push(`Generated: ${packet.meta.generated_at}`)
    lines.push(`Page: ${packet.meta.page_label} (${packet.meta.page_url || '—'})`)
    lines.push(`Version: v#${packet.meta.version_id} (${packet.meta.version_kind})`)
    lines.push(`Audit class: ${packet.meta.audit_class}`)
    lines.push('')
    for (const key of packet.section_keys) {
      const s = packet.sections[key]
      if (!s) continue
      lines.push(`## ${s.title}`)
      lines.push(s.description || '')
      lines.push('')
      if (s.fields) {
        for (const f of s.fields) {
          lines.push(`### ${f.label}${f.internal ? ' (internal)' : ''}`)
          lines.push(f.value || '(empty)')
          if (f.char_count) lines.push(`  [${f.char_count.count} chars · ${f.char_count.hint}]`)
          lines.push('')
        }
      }
      if (s.blocks) {
        s.blocks.forEach((b, i) => {
          lines.push(`### Block ${i + 1} — ${b.square_layout}${b.heading ? `: ${b.heading}` : ''}`)
          lines.push(b.content_text || b.content_html || '(empty)')
          if (b.image_suggestion) lines.push(`[img] ${b.image_suggestion}`)
          lines.push('')
        })
      }
      if (s.code) {
        lines.push('```html')
        lines.push(s.code)
        lines.push('```')
        lines.push('')
      }
      if (s.links) {
        for (const l of s.links) {
          lines.push(`- "${l.anchor}" → ${l.target}${l.placement ? ` (${l.placement})` : ''}`)
        }
        if (s.note) lines.push(`Note: ${s.note}`)
        lines.push('')
      }
      if (s.checks) {
        for (const c of s.checks) {
          lines.push(`- [ ] ${c.label}`)
          if (c.hint) lines.push(`    ${c.hint}`)
        }
        lines.push('')
      }
    }
    await copyText(lines.join('\n'), 'entire-packet')
  }

  if (!packet) {
    return (
      <div className="bg-[#fef3c7] border border-[#d97706]/40 rounded p-3 space-y-2">
        <div className="font-medium text-[11px] text-[#92400e]">📦 Generate {platformCapabilities?.display_name || 'Square'} packet</div>
        <div className="text-[10px] text-[#92400e]">
          This tenant publishes via copy-paste packets, not automated WP. Click below to generate the 9-section packet — operator pastes each section into Square Online's page editor.
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={generate}
            disabled={busy}
            className="text-[10px] py-1 px-3 bg-[#d97706] text-white border-none rounded cursor-pointer disabled:opacity-50"
          >{busy ? 'Generating…' : '📦 Generate packet'}</button>
          {error && <span className="text-[10px] text-[#c0392b]">⚠ {error}</span>}
        </div>
      </div>
    )
  }

  const variantLabel = packet.variant === 'enhance' ? '✨ Enhance (existing page improvements)'
    : packet.variant === 'fix' ? '🔧 Fix (surgical meta repair)'
    : '🆕 Create (new page)'
  const variantTone = packet.variant === 'enhance' ? 'bg-[#dcfce7] text-[#15803d] border-[#16a34a]/40'
    : packet.variant === 'fix' ? 'bg-[#fef3c7] text-[#92400e] border-[#d97706]/40'
    : 'bg-[#e0e7ff] text-[#3730a3] border-[#6366f1]/40'

  return (
    <div className="bg-white border border-[#d97706]/40 rounded p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-[11px] text-[#92400e]">📦 Square packet</span>
        <span className={`text-[9px] py-0.5 px-1.5 rounded border font-mono ${variantTone}`}>{variantLabel}</span>
        <span className="text-[9px] text-muted">{Object.keys(packet.sections).length} sections · generated {generatedAt ? new Date(generatedAt).toLocaleString() : 'just now'}</span>
        <div className="flex-1" />
        <button
          onClick={copyEntirePacket}
          className="text-[10px] py-1 px-2 bg-[#d97706] text-white border-none rounded cursor-pointer"
          title="Copy the entire packet as a single formatted text dump (good for archiving)"
        >{copiedFlash === 'entire-packet' ? '✓ Copied' : '📋 Copy entire packet'}</button>
        <button
          onClick={generate}
          disabled={busy}
          className="text-[10px] py-1 px-2 bg-white border border-[#d97706] text-[#d97706] rounded cursor-pointer disabled:opacity-50"
        >{busy ? '…' : '🔁 Re-generate'}</button>
      </div>

      {packet.section_keys.map(key => {
        const s = packet.sections[key]
        if (!s) return null
        return (
          <details key={key} className="bg-[#fafafa] border border-[#e5e5e5] rounded" open={key === 'seo' || key === 'embed_code'}>
            <summary className="cursor-pointer py-1.5 px-2 text-[11px] font-medium flex items-center gap-2">
              <span>{s.title}</span>
              {s.has_visible_faq && <span className="text-[8px] py-0.5 px-1 rounded bg-[#dcfce7] text-[#15803d] border border-[#16a34a]/40 font-mono">+ visible FAQ</span>}
              {Array.isArray(s.schema_types_included) && s.schema_types_included.length > 0 && (
                <span className="text-[8px] py-0.5 px-1 rounded bg-[#eef2ff] text-[#4338ca] border border-[#6366f1]/40 font-mono">
                  {s.schema_types_included.join(', ')}
                </span>
              )}
              {s.fields && <span className="text-[9px] text-muted">({s.fields.length} field{s.fields.length === 1 ? '' : 's'})</span>}
              {s.blocks && <span className="text-[9px] text-muted">({s.blocks.length} block{s.blocks.length === 1 ? '' : 's'})</span>}
              {s.links && <span className="text-[9px] text-muted">({s.links.length} link{s.links.length === 1 ? '' : 's'})</span>}
              {s.checks && <span className="text-[9px] text-muted">({Object.values(validationDone).filter(Boolean).length}/{s.checks.length} done)</span>}
            </summary>
            <div className="p-2 space-y-2 text-[10px]">
              {s.description && <div className="text-[9px] text-muted">{s.description}</div>}

              {/* Fields rendering (Sections 1, 2, 3, 9) */}
              {s.fields && s.fields.map(f => {
                const toneCls = f.char_count?.tone === 'green' ? 'border-[#16a34a]/50 bg-[#f0fdf4]'
                  : f.char_count?.tone === 'yellow' ? 'border-[#d97706]/50 bg-[#fff7ed]'
                  : f.char_count?.tone === 'red' ? 'border-[#c0392b]/50 bg-[#fef2f2]'
                  : 'border-[#e5e5e5] bg-white'
                const fieldKey = `${s.id}.${f.key}`
                return (
                  <div key={f.key} className={`border ${toneCls} rounded p-1.5`}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-[10px]">{f.label}</span>
                      {f.internal && <span className="text-[8px] py-0 px-1 rounded bg-[#e5e7eb] text-muted">internal</span>}
                      {f.char_count && (
                        <span className={`text-[9px] font-mono ${
                          f.char_count.tone === 'green' ? 'text-[#15803d]'
                          : f.char_count.tone === 'yellow' ? 'text-[#92400e]'
                          : 'text-[#c0392b]'
                        }`}>{f.char_count.count} chars · {f.char_count.hint}</span>
                      )}
                      <div className="flex-1" />
                      <button
                        onClick={() => copyText(f.value, fieldKey)}
                        disabled={!f.value}
                        className="text-[9px] py-0.5 px-1.5 bg-white border border-[#d97706] text-[#d97706] rounded cursor-pointer disabled:opacity-50"
                      >{copiedFlash === fieldKey ? '✓' : '📋'}</button>
                    </div>
                    <div className="text-[10px] font-mono break-all whitespace-pre-wrap select-all bg-white border border-[#e5e5e5] rounded px-1.5 py-1">
                      {f.value || <span className="text-muted italic">(empty)</span>}
                    </div>
                    {f.hint && <div className="text-[9px] text-muted italic mt-0.5">{f.hint}</div>}
                  </div>
                )
              })}

              {/* Body content blocks (Section 4) — SEO note + per-block + full-body fallback */}
              {s.seo_note && (
                <div className="bg-[#eef2ff] border border-[#6366f1]/30 rounded p-1.5 text-[9px] text-[#3730a3]">
                  <b>SEO note:</b> {s.seo_note}
                </div>
              )}
              {s.blocks && s.blocks.map((b, i) => {
                const layoutColor = b.heading_level === 'h1'
                  ? 'bg-[#fef3c7] text-[#92400e] border-[#d97706]/50'
                  : 'bg-[#e0e7ff] text-[#3730a3] border-[#6366f1]/40'
                // Heading blocks copy as plain text (no formatting
                // to preserve). Body blocks have two paste modes:
                // 📝 text (for Square's native Text blocks — Square
                // doesn't accept HTML in native blocks; pasted <p>
                // renders as literal text), 🔧 HTML (for Square
                // Embed Code blocks).
                const isHeading = b.heading_level === 'h1' || b.heading_level === 'h2' && !b.content_html
                const textPayload = b.heading_level === 'h1'
                  ? b.heading
                  : (b.content_text_rich || b.content_text || '')
                const htmlPayload = b.heading_level === 'h1'
                  ? b.content_html
                  : (b.content_html || '')
                return (
                  <div key={i} className="border border-[#e5e5e5] bg-white rounded p-1.5 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[9px] py-0.5 px-1 rounded border font-mono ${layoutColor}`}>{b.square_layout}</span>
                      {b.heading && <span className="font-medium text-[10px]">{b.heading_level}: {b.heading}</span>}
                      <div className="flex-1" />
                      <button
                        onClick={() => copyText(textPayload, `${s.id}.block.${i}.text`)}
                        className="text-[9px] py-0.5 px-1.5 bg-[#d97706] text-white border-none rounded cursor-pointer"
                        title={b.heading_level === 'h1' ? "Copy heading text → paste into Square's Title 1 block" : "Copy as plain text with formatting cues (**bold**, *italic*, • bullets, 'anchor (url)' for links). Paste into Square's native Text block, then re-apply formatting via the editor toolbar."}
                      >{copiedFlash === `${s.id}.block.${i}.text` ? '✓ Text' : '📝 Copy text'}</button>
                      {b.content_html && (
                        <button
                          onClick={() => copyText(htmlPayload, `${s.id}.block.${i}.html`)}
                          className="text-[9px] py-0.5 px-1.5 bg-white border border-[#d97706] text-[#d97706] rounded cursor-pointer"
                          title="Copy as raw HTML — paste into a Square Embed Code block (not a native Text block)."
                        >{copiedFlash === `${s.id}.block.${i}.html` ? '✓ HTML' : '🔧 Copy HTML'}</button>
                      )}
                    </div>
                    {b.hint && <div className="text-[9px] text-muted italic">{b.hint}</div>}
                    <pre className="text-[9px] font-sans whitespace-pre-wrap bg-[#fafafa] border border-[#e5e5e5] rounded px-1.5 py-1 max-h-[240px] overflow-auto">
                      {textPayload || '(empty)'}
                    </pre>
                    {b.image_suggestion && <div className="text-[9px] text-muted italic">🖼 {b.image_suggestion}</div>}
                  </div>
                )
              })}
              {/* Fallback: copy entire body as one HTML block */}
              {s.full_body_html && (
                <details className="border border-[#d97706]/40 bg-[#fff7ed] rounded">
                  <summary className="cursor-pointer py-1 px-2 text-[10px] font-medium text-[#92400e] flex items-center gap-2">
                    📋 Copy entire body as one HTML block (alternative)
                    <span className="text-[9px] text-muted font-normal">— for pasting into a single Square "Embed Code" block instead of per-block native blocks</span>
                  </summary>
                  <div className="p-2 space-y-1">
                    <div className="text-[9px] text-[#92400e] bg-white border border-[#d97706]/30 rounded p-1.5">
                      <b>⚠ SEO tradeoff:</b> using one big HTML block is more convenient but loses the H1/H2 semantic-structure weighting Google + Bing apply when those headings live in native Square block types. Schema in Section 5 still works. Use this only when convenience matters more than per-page ranking margins.
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-muted">{s.full_body_html.length} chars</span>
                      <div className="flex-1" />
                      <button
                        onClick={() => copyText(s.full_body_html, `${s.id}.full_body_html`)}
                        className="text-[10px] py-1 px-2 bg-[#d97706] text-white border-none rounded cursor-pointer"
                      >{copiedFlash === `${s.id}.full_body_html` ? '✓ Copied' : '📋 Copy full body HTML'}</button>
                    </div>
                    <pre className="text-[9px] font-mono whitespace-pre-wrap bg-white border border-[#e5e5e5] rounded p-2 max-h-[250px] overflow-auto select-all">
                      {s.full_body_html}
                    </pre>
                  </div>
                </details>
              )}

              {/* Embed code block (Section 5) — one big textarea
                  with the full CSS + FAQ HTML + JSON-LD bundle */}
              {s.code && (
                <div className="border border-[#e5e5e5] bg-white rounded p-1.5 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-muted">Paste into a Square "Embed Code" / "Custom HTML" block at the END of the page body.</span>
                    <div className="flex-1" />
                    <button
                      onClick={() => copyText(s.code, `${s.id}.code`)}
                      className="text-[10px] py-1 px-2 bg-[#d97706] text-white border-none rounded cursor-pointer"
                    >{copiedFlash === `${s.id}.code` ? '✓ Copied' : '📋 Copy embed code'}</button>
                  </div>
                  <pre className="text-[9px] font-mono whitespace-pre-wrap bg-[#fafafa] border border-[#e5e5e5] rounded p-2 max-h-[300px] overflow-auto select-all">
                    {s.code}
                  </pre>
                </div>
              )}

              {/* Internal links (Sections 6, 7) */}
              {s.links && (
                <div className="space-y-1">
                  {s.links.length === 0 && (
                    <div className="text-[9px] text-muted italic">(none{s.note ? ' — ' + s.note : ''})</div>
                  )}
                  {s.links.map((l, i) => (
                    <div key={i} className="flex items-center gap-2 bg-white border border-[#e5e5e5] rounded px-1.5 py-1">
                      <span className="font-medium text-[10px]">"{l.anchor}"</span>
                      <span className="text-[9px] text-muted">→</span>
                      <a href={l.target} target="_blank" rel="noopener noreferrer" className="text-[9px] text-[#6C5CE7] underline break-all flex-1 min-w-0 truncate">{l.target}</a>
                      {l.placement && <span className="text-[8px] text-muted italic">{l.placement}</span>}
                      <button
                        onClick={() => copyText(`<a href="${l.target}">${l.anchor}</a>`, `${s.id}.link.${i}`)}
                        className="text-[9px] py-0.5 px-1.5 bg-white border border-[#d97706] text-[#d97706] rounded cursor-pointer"
                      >{copiedFlash === `${s.id}.link.${i}` ? '✓' : '📋'}</button>
                    </div>
                  ))}
                  {s.links.length > 0 && s.note && <div className="text-[9px] text-muted italic mt-1">ℹ {s.note}</div>}
                </div>
              )}

              {/* Validation checklist (Section 8) */}
              {s.checks && (
                <div className="space-y-1">
                  {s.checks.map(c => (
                    <label key={c.id} className="flex items-start gap-2 bg-white border border-[#e5e5e5] rounded px-1.5 py-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!validationDone[c.id]}
                        onChange={e => setValidationDone(prev => ({ ...prev, [c.id]: e.target.checked }))}
                        className="mt-0.5"
                      />
                      <div className="flex-1 text-[10px]">
                        <div className={validationDone[c.id] ? 'line-through text-muted' : 'font-medium'}>{c.label}</div>
                        {c.hint && <div className="text-[9px] text-muted">{c.hint}</div>}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </details>
        )
      })}

      <div className="text-[9px] text-muted italic">
        Packet is computed on-demand from the latest version + slot. No persistence — re-generate after editing the proposal or changing the slot's audit_class.
      </div>
    </div>
  )
}

function DeployBlock({ landingPageId, versionId, onDeployed, requireBackupAck }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  // Preview-to-sandbox state. Separate from deploy state so they
  // don't overwrite each other's UI feedback.
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState(null)
  const [previewSuccess, setPreviewSuccess] = useState(null)
  useEffect(() => {
    if (!busy) { setElapsed(0); return }
    const start = Date.now()
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500)
    return () => clearInterval(tick)
  }, [busy])
  // Reset deploy + preview state on page/version switch. Without
  // this, success blocks from a prior page leak onto the current
  // page's view.
  useEffect(() => {
    setSuccess(null); setError(null); setBusy(false)
    setPreviewSuccess(null); setPreviewError(null); setPreviewBusy(false)
  }, [landingPageId, versionId])
  const handlePreview = async () => {
    if (previewBusy || !landingPageId || !versionId) return
    setPreviewBusy(true); setPreviewError(null); setPreviewSuccess(null)
    try {
      const r = await api.previewLandingPageVersion(landingPageId, versionId)
      setPreviewSuccess(r)
    } catch (e) {
      const msg = e?.message || String(e)
      // Auto-create flow: if the failure is 'preview not configured,'
      // offer to create one automatically + retry. Saves the operator
      // from manually creating a WP page, finding the post ID, and
      // pasting it into the settings panel.
      if (/preview_post_id|preview page not configured/i.test(msg)) {
        const wantsAutoCreate = confirm(
          "No preview sandbox is configured for this tenant.\n\n" +
          "Posty Posty can create one automatically — it'll add a WordPress page titled 'Posty Posty Preview Sandbox' as a DRAFT (not publicly visible) and use it for previews going forward. You can change its status to Private or Published later in WP admin if you want a shareable URL.\n\n" +
          "Create one now?"
        )
        if (wantsAutoCreate) {
          try {
            const created = await api.createPreviewPage()
            // Successfully created; now retry the preview push.
            const retry = await api.previewLandingPageVersion(landingPageId, versionId)
            setPreviewSuccess({
              ...retry,
              auto_created: !created.already_existed,
              auto_created_post_id: created.preview_post_id,
            })
          } catch (e2) {
            setPreviewError(`Auto-create failed: ${e2?.message || String(e2)}`)
          }
        } else {
          // Operator declined; show the original error with hint.
          setPreviewError(msg + " (Set preview_post_id manually in the Preview / scratchpad section at the top of Pages, OR click the button again + accept the auto-create prompt.)")
        }
      } else {
        setPreviewError(msg)
      }
    } finally {
      setPreviewBusy(false)
    }
  }
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
        <span data-deploy-anchor className="text-[11px] font-medium text-[#c0392b]">🚀 Deploy to WordPress</span>
        <span className="text-[9px] text-muted">Preview = push to sandbox to see rendered theme version (ephemeral). Deploy = replace the live page (snapshotted as backup first).</span>
        <div className="flex-1" />
        <button
          onClick={handlePreview}
          disabled={previewBusy || !versionId}
          className="text-[11px] py-1 px-3 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer disabled:opacity-50"
          title="Push the current proposal to the tenant's preview / scratchpad WP page so you can see the rendered theme output. Doesn't touch the real page. Subsequent pushes overwrite without history. Configure the preview page in tenant settings first (top of Pages screen)."
        >{previewBusy ? 'Preview…' : '🪞 Preview to sandbox'}</button>
        <button
          onClick={handleDeploy}
          disabled={busy || !versionId}
          className="text-[11px] py-1 px-3 bg-[#c0392b] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
          title="Snapshots live page as backup, then PUTs the current version's content to WP REST API."
        >{busy ? `Deploying… ${elapsed}s` : '🚀 Deploy'}</button>
      </div>
      {previewError && (
        <div className="text-[10px] text-[#c0392b]">⚠ Preview failed: {previewError}</div>
      )}
      {previewSuccess && (
        <div className="text-[10px] bg-[#f5f3ff] border border-[#6C5CE7]/40 rounded p-2 space-y-1">
          <div className="font-medium text-[#6C5CE7]">🪞 Previewed to sandbox</div>
          {previewSuccess.auto_created && (
            <div className="bg-[#fff7ed] border border-[#d97706]/40 rounded p-1.5 text-[#854d0e]">
              ✨ Created a new WP preview page (post <b>#{previewSuccess.auto_created_post_id}</b>) as a draft. Saved as the tenant's preview sandbox going forward. Future previews will reuse the same page.
            </div>
          )}
          <div className="text-muted">
            Pushed to preview post <b>#{previewSuccess.preview_post_id}</b>
            {previewSuccess.schema_blocks_count > 0 && ` · ${previewSuccess.schema_blocks_count} schema block(s) injected`}.
            Preview pages don't accumulate version history.
          </div>
          {previewSuccess.wp_link && (
            <div>
              <a href={previewSuccess.wp_link} target="_blank" rel="noopener noreferrer" className="text-[#6C5CE7] underline font-medium">
                🔗 Open preview page →
              </a>
            </div>
          )}
        </div>
      )}
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
          {/* SEO plugin status — surfaces fresh per-deploy detection
              + Yoast indexable-rebuild outcome. Replaces the stale
              "No SEO plugin detected" warning. Green tone when
              everything worked; amber tone when rebuild failed or
              wasn't applicable. */}
          {success.seo_status && (
            <div
              className={`rounded p-1.5 mt-1 ${
                success.seo_status.ok === false
                  ? 'bg-[#fff7ed] border border-[#d97706]/40 text-[#92400e]'
                  : 'bg-[#eef2ff] border border-[#6366f1]/30 text-[#4338ca]'
              }`}
            >
              <div className="font-medium">🔌 SEO plugin status</div>
              <div className="text-[10px] mt-0.5">{success.seo_status.message}</div>
              {success.seo_status.indexable_rebuild?.status === 'rebuilt' && success.seo_status.indexable_rebuild?.included_target === false && (
                <div className="text-[9px] mt-1 italic">
                  This post wasn't in the first batch — Yoast's indexer queues by ID. The editor sidebar may take an extra page load to populate.
                </div>
              )}
              {/* Bridge plugin CTA. Shown for any Yoast failure
                  state AND when the AJAX path succeeded but didn't
                  go through the bridge (admin-ajax fallback). Hides
                  only when bridge plugin succeeded. Independent of
                  the exact ajax_meta_write shape — guards against
                  edge cases where the field isn't populated. */}
              {(success.seo_status.plugin === 'yoast' || success.seo_status.plugin === 'yoast-premium') && success.seo_status.ajax_meta_write?.via !== 'bridge-plugin' && (
                <div className="mt-2 bg-white border border-current/30 rounded p-2 space-y-1.5">
                  <div className="font-medium text-[10px]">📦 Fix: install PostyPosty Yoast Bridge plugin</div>
                  <div className="text-[9px]">
                    One-time install (single PHP file, ~110 lines). After activation, every PostyPosty deploy writes Yoast meta directly via REST — no wp-admin, no nonces, works on every host including Cloudways / WP Engine.
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <a
                      href="https://github.com/obregoru/postyposty/raw/main/wp-plugin/postyposty-yoast-bridge.php"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded no-underline"
                      title="Download postyposty-yoast-bridge.php from the postyposty repo on GitHub"
                    >📥 Download plugin file</a>
                    <a
                      href="https://github.com/obregoru/postyposty/blob/main/wp-plugin/postyposty-yoast-bridge.php"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded no-underline"
                      title="View the plugin source code on GitHub before installing"
                    >👀 View source on GitHub</a>
                  </div>
                  <details className="text-[9px] mt-1">
                    <summary className="cursor-pointer underline">Install steps</summary>
                    <ol className="list-decimal pl-4 mt-1 space-y-0.5">
                      <li>Download the file from the link above (right-click → Save As if it renders inline)</li>
                      <li>On the WordPress site: connect via SFTP / SSH / file manager and navigate to <code className="font-mono bg-white/60 px-1">wp-content/plugins/</code></li>
                      <li>Create a folder named <code className="font-mono bg-white/60 px-1">postyposty-yoast-bridge</code></li>
                      <li>Upload <code className="font-mono bg-white/60 px-1">postyposty-yoast-bridge.php</code> into that folder</li>
                      <li>In WordPress admin: <b>Plugins</b> → activate <b>"PostyPosty Yoast Bridge"</b></li>
                      <li>Redeploy this page from PostyPosty — the next deploy will auto-detect the endpoint and write Yoast meta directly</li>
                    </ol>
                  </details>
                </div>
              )}
              {/* Diagnostic detail when AJAX path failed at the
                  nonce-fetch step. Surfaces per-candidate HTTP
                  status, signal counts (how many "yoast"/"wpseo"/
                  "nonce" strings appeared in the HTML), variable
                  names detected, and sample lines mentioning
                  yoast/wpseo/nonce — so the operator can see
                  exactly what's in the HTML without console
                  access. Pastes well into a bug report. */}
              {success.seo_status.ajax_meta_write?.attempts && Array.isArray(success.seo_status.ajax_meta_write.attempts) && (
                <details className="mt-2 text-[9px]">
                  <summary className="cursor-pointer underline">🔧 Show nonce-fetch diagnostics ({success.seo_status.ajax_meta_write.attempts.length} URL{success.seo_status.ajax_meta_write.attempts.length === 1 ? '' : 's'} tried)</summary>
                  <div className="mt-1 space-y-2 font-mono">
                    {success.seo_status.ajax_meta_write.attempts.map((a, i) => (
                      <div key={i} className="bg-white/60 border border-current/20 rounded p-1.5">
                        <div className="break-all"><b>URL:</b> {a.url}</div>
                        <div><b>HTTP:</b> {a.status ?? 'no response'}{a.error ? ` · error: ${a.error}` : ''}{a.note ? ` · ${a.note}` : ''}</div>
                        {a.html_length !== undefined && <div><b>HTML length:</b> {a.html_length} bytes</div>}
                        {a.signals && (
                          <div>
                            <b>Signal counts:</b>{' '}
                            yoast={a.signals.yoast_mentions} · wpseo={a.signals.wpseo_mentions} · nonce={a.signals.nonce_mentions} · apiFetch={a.signals.wp_dot_apifetch} · scripts={a.signals.script_tag_count} · block_editor={a.signals.block_editor ? 'yes' : 'no'}
                          </div>
                        )}
                        {Array.isArray(a.found_vars) && a.found_vars.length > 0 && (
                          <div><b>Vars detected:</b> [{a.found_vars.join(', ')}]</div>
                        )}
                        {Array.isArray(a.sample_lines) && a.sample_lines.length > 0 && (
                          <div className="mt-1">
                            <b>Sample lines mentioning yoast/wpseo/nonce:</b>
                            <ul className="list-disc pl-4 mt-0.5">
                              {a.sample_lines.map((line, j) => <li key={j} className="break-all">{line}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
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
    <details className="text-[10px] border border-[#e5e5e5] rounded">
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
        <details>
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

// Escape user-provided strings before interpolating into iframe srcDoc.
// alt_text + caption come from operator input + Pexels metadata — both
// can contain quotes / brackets that would break the HTML attribute.
function escapeHtmlAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeHtmlText(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Build the image blocks that bracket the body inside the iframe:
//   - Featured image (one per page max) → large hero at the very top,
//     with caption + alt text. Matches what most WP themes do when
//     they read the featured image of a post.
//   - Inline (non-featured) images → small thumbnail strip at the
//     bottom of the preview labeled "Other associated images" so the
//     operator can confirm what's attached to the page without
//     needing to scroll up to the LandingImagesPanel.
// Returns [topHtml, bottomHtml] strings.
function buildImageBlocks(images) {
  if (!Array.isArray(images) || images.length === 0) return ['', '']
  const featured = images.find(i => i.role === 'featured') || null
  const inline = images.filter(i => i.role !== 'featured' && i.public_url)
  let top = ''
  if (featured && featured.public_url) {
    const alt = escapeHtmlAttr(featured.alt_text || '')
    const cap = featured.caption ? `<figcaption>${escapeHtmlText(featured.caption)}</figcaption>` : ''
    top = `<figure class="fldy-featured-image">
      <img src="${escapeHtmlAttr(featured.public_url)}" alt="${alt}" />
      ${cap}
    </figure>`
  }
  let bottom = ''
  if (inline.length > 0) {
    const tiles = inline.map(i => {
      const alt = escapeHtmlAttr(i.alt_text || i.filename || '')
      const fname = escapeHtmlText(i.filename || '')
      return `<div class="fldy-image-tile">
        <img src="${escapeHtmlAttr(i.public_url)}" alt="${alt}" />
        <div class="fldy-image-tile-name">${fname}</div>
      </div>`
    }).join('')
    bottom = `<div class="fldy-image-strip-wrap">
      <div class="fldy-image-strip-label">Other associated images (${inline.length})</div>
      <div class="fldy-image-strip">${tiles}</div>
    </div>`
  }
  return [top, bottom]
}

function RenderedPreview({ html, tone = 'green', images = null }) {
  const borderClass = tone === 'red' ? 'border-[#c0392b]/30'
    : tone === 'neutral' ? 'border-[#e5e5e5]'
    : 'border-[#2D9A5E]/30'
  // Iframe-flavored CSS (without the .fldy-preview class wrapper).
  const iframeCss = RENDERED_PREVIEW_CSS.replace(/\.fldy-preview\s*/g, "").replace(/\.fldy-preview\[contenteditable[^}]+\}/g, "")
  // Featured + inline image presentation. Featured is a full-width
  // hero so operators see it the way the deployed theme typically
  // renders the post's featured image; inline thumbnails are small
  // tiles so they don't dominate the preview.
  const imageCss = `
    .fldy-featured-image { margin: 0 0 16px 0; }
    .fldy-featured-image img { width: 100%; height: auto; display: block; border-radius: 6px; max-height: 320px; object-fit: cover; }
    .fldy-featured-image figcaption { text-align: center; font-size: 12px; color: #6b7280; margin-top: 4px; }
    .fldy-image-strip-wrap { margin-top: 24px; padding-top: 12px; border-top: 1px dashed #d1d5db; }
    .fldy-image-strip-label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
    .fldy-image-strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; }
    .fldy-image-tile { border: 1px solid #e5e7eb; border-radius: 4px; overflow: hidden; background: #fafafa; }
    .fldy-image-tile img { width: 100%; height: 72px; object-fit: cover; display: block; }
    .fldy-image-tile-name { font-size: 9px; color: #6b7280; padding: 2px 4px; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `
  const fullCss = `html, body { margin:0; padding:0; }
    body { padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #1f2937; background: #fff; }
    ${iframeCss}
    ${imageCss}`
  const [topImgHtml, bottomImgHtml] = buildImageBlocks(images)
  const bodyHtml = html || '<p style="color:#9ca3af;font-style:italic;">(empty body)</p>'
  const srcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>${fullCss}</style></head><body>${topImgHtml}${bodyHtml}${bottomImgHtml}</body></html>`
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
