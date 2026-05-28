// Sitemap Wizard — V3 Content Studio's strategic page-planning
// surface. Replaces the modal Site Setup Wizard with a full-page
// route. Vertical-slice scope (this iteration):
//
//   - Load the editable plan (slots + tier metadata) — auto-seeded
//     from the JS starter on first call.
//   - Grouped-by-tier slot grid, click to select.
//   - Per-slot editor (right pane): label, tier, template,
//     rationale, strategy hint, template variables.
//   - Add new slot.
//   - Soft-delete a slot.
//   - Reseed from JS starter (idempotent).
//   - 'Create WP draft' button — materializes a planned slot into a
//     real WP page + landing_page row + imported version.
//
// Not in this slice (layered in next): keyword pool, competitor
// URLs + audit, gap analysis. The data model exists in the DB
// already; this just doesn't wire those panels in yet.

import { useEffect, useMemo, useState } from 'react'
import * as api from '../api'
import { LandingImagesPanel } from '../components/LandingImagesPanel'
import GapFindings from '../components/GapFindings'

export default function SitemapWizard() {
  const [plan, setPlan] = useState({ slots: [], tiers: [], platform: 'wordpress', tenant_target_url: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeSlotId, setActiveSlotId] = useState(null)
  const [reseeding, setReseeding] = useState(false)
  const [reseedMsg, setReseedMsg] = useState(null)
  // Adding a new slot state — inline panel below the grid.
  const [adding, setAdding] = useState(false)
  // Initial-sitemap propagation flow state. propagateModal holds the
  // parsed { tiers, pages } from parse-brief. Switches into result
  // mode once propagation runs and we have per-slot statuses.
  const [propagateModal, setPropagateModal] = useState(null) // null | { phase, parsed, propagating, result, error }
  // Bulk competitor-refresh modal state — separate from propagateModal
  // because the flow is different (no preview phase; just run + result).
  const [refreshModal, setRefreshModal] = useState(null) // null | { phase, mode, runAnalysis, result, error }
  // Bulk fan-out + propose modal state. Long-running (~25-30 min for
  // 18 slots), polls /status every 4s. Phase: 'running' | 'done' | 'error'.
  const [fanOutModal, setFanOutModal] = useState(null) // null | { phase, total, processed, results, started_at, error }
  // Per-slot optimization checklist data. Keyed by slot_id so the
  // grid + SlotEditor can both look up by id. Loaded alongside the
  // main plan on every wizard refresh.
  const [checklistBySlot, setChecklistBySlot] = useState({})
  const [checklistTotals, setChecklistTotals] = useState(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [planR, checklistR] = await Promise.all([
        api.getSitemapPlan(),
        api.getChecklist().catch(() => ({ slots: [], totals: null })), // checklist failures non-fatal
      ])
      setPlan({
        slots: Array.isArray(planR?.slots) ? planR.slots : [],
        tiers: Array.isArray(planR?.tiers) ? planR.tiers : [],
        platform: planR?.platform || 'wordpress',
        tenant_target_url: planR?.tenant_target_url || null,
      })
      const cMap = {}
      for (const c of (checklistR?.slots || [])) cMap[c.slot_id] = c
      setChecklistBySlot(cMap)
      setChecklistTotals(checklistR?.totals || null)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const activeSlot = plan.slots.find(s => s.id === activeSlotId) || null

  const reseed = async () => {
    if (reseeding) return
    setReseeding(true); setReseedMsg(null)
    try {
      const r = await api.reseedSitemapPlan()
      setReseedMsg(r?.added ? `+${r.added} slot(s) imported from starter` : 'Starter already in sync — no new slots')
      setTimeout(() => setReseedMsg(null), 4000)
      await load()
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setReseeding(false)
    }
  }

  // Step 1 of the initial-sitemap flow: parse the saved brief into
  // { tiers, pages } via Claude Haiku. No DB writes — opens the
  // modal in 'preview' phase so the operator can review before
  // committing the propagation.
  const openPropagateModal = async () => {
    setError(null)
    setPropagateModal({ phase: 'parsing', parsed: null, propagating: false, result: null, error: null })
    try {
      const r = await api.parseSitemapBrief()
      if (!r?.parsed) throw new Error('Parse returned no plan')
      setPropagateModal({ phase: 'preview', parsed: r.parsed, propagating: false, result: null, error: null })
    } catch (e) {
      setPropagateModal({ phase: 'error', parsed: null, propagating: false, result: null, error: e?.message || String(e) })
    }
  }

  // Step 2: confirmed parsed plan → run propagation. Two modes:
  //   - 'add-only' (default): only INSERT new slot_keys; existing
  //     slots stay untouched (preserves manual edits, gap analysis,
  //     hint customizations). Right for progressive sitemap expansion.
  //   - 'refresh-existing': full UPSERT — refresh existing slots'
  //     metadata from the brief.
  const runPropagation = async (mode = 'add-only') => {
    if (!propagateModal?.parsed) return
    setPropagateModal(m => ({ ...m, propagating: true, error: null }))
    try {
      const r = await api.propagateInitialSitemap(propagateModal.parsed, { mode })
      setPropagateModal(m => ({ ...m, phase: 'result', propagating: false, result: r }))
      await load() // refresh the wizard's slot grid
    } catch (e) {
      setPropagateModal(m => ({ ...m, propagating: false, error: e?.message || String(e) }))
    }
  }

  // Bulk competitor refresh. mode: 'missing' | 'stale' | 'all'.
  // runAnalysis controls whether gap analysis runs after scraping.
  // Long-running synchronous call (2-5 min for 24 slots with analysis).
  const openRefreshModal = (mode, runAnalysis) => {
    setRefreshModal({ phase: 'running', mode, runAnalysis, result: null, error: null })
    api.refreshCompetitors({ mode, run_gap_analysis: runAnalysis })
      .then(r => setRefreshModal(m => ({ ...m, phase: 'result', result: r })))
      .catch(e => setRefreshModal(m => ({ ...m, phase: 'error', error: e?.message || String(e) })))
  }

  // Bulk fan-out + propose: walks every planned slot, scaffolds WP
  // draft, kicks off propose for each. ~25-30 minutes for 18 slots
  // sequentially. Polls /status every 4s for live progress.
  const openFanOutModal = async () => {
    const plannedCount = plan.slots.filter(s => s.status === 'planned').length
    if (plannedCount === 0) {
      alert("No planned slots to fan out — every slot already has a landing page.")
      return
    }
    if (!confirm(`This will scaffold WP drafts + generate content for ${plannedCount} planned slot(s).\n\nEach slot:\n  1. Creates a WP draft + landing_page row\n  2. Kicks off Propose (two-phase generation)\n  3. Uses the slot's strategy hint + voice anchors + competitive gap analysis\n\nProcessed sequentially. Expect ~${Math.ceil(plannedCount * 1.5)} minutes total. You can leave this tab open or close it — the work runs server-side and the wizard reloads with results.\n\nContinue?`)) return
    setFanOutModal({ phase: 'running', total: plannedCount, processed: 0, results: [], started_at: null, error: null })
    try {
      const r = await api.fanOutAndProposeAllPlanned()
      setFanOutModal(m => ({ ...m, total: r.total || plannedCount, started_at: r.started_at }))
      // Poll loop
      const poll = async () => {
        try {
          const s = await api.getFanOutProposeStatus()
          if (s.status === 'idle') {
            setFanOutModal(m => ({ ...m, phase: 'error', error: 'Job state lost (server may have restarted). Re-trigger to continue.' }))
            return
          }
          setFanOutModal(m => ({ ...m, total: s.total, processed: s.processed, results: s.results || [] }))
          if (s.status === 'done') {
            setFanOutModal(m => ({ ...m, phase: 'done' }))
            await load()
            return
          }
          setTimeout(poll, 4000)
        } catch (e) {
          setFanOutModal(m => ({ ...m, phase: 'error', error: e?.message || String(e) }))
        }
      }
      setTimeout(poll, 2000)
    } catch (e) {
      setFanOutModal(m => ({ ...m, phase: 'error', error: e?.message || String(e) }))
    }
  }

  if (loading) {
    return <div className="text-[11px] text-muted italic py-8 text-center">Loading sitemap plan…</div>
  }

  // Tier-grouped slot list. If no DB tiers exist yet, derive a
  // sorted distinct tier list from slots so the operator still sees
  // grouping.
  const tierList = plan.tiers.length > 0
    ? plan.tiers
    : Array.from(new Set(plan.slots.map(s => s.tier || 1)))
        .sort((a, b) => a - b)
        .map(t => ({ tier: t, label: `Tier ${t}`, subtitle: null }))

  const slotsByTier = (tier) => plan.slots
    .filter(s => (s.tier || 1) === tier)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h2 className="text-[13px] font-semibold">🗺️ Sitemap Wizard</h2>
          <div className="text-[10px] text-muted">
            Strategic planning surface for the tenant's page portfolio.
            Edit slots, plan keywords (coming next), reference competitor
            pages (coming next), then materialize each planned slot into
            a real WordPress draft.
          </div>
        </div>
        <button
          onClick={openPropagateModal}
          className="text-[10px] py-1 px-2 bg-[#16a34a] text-white border-none rounded cursor-pointer flex-shrink-0"
          title="Parse the 📋 Sitemap strategy brief into tiers + pages via Claude, then for each page: check if it exists on WP or your existing source domain, and import/scrape accordingly. Slots that don't exist anywhere stay 'planned'."
        >🪄 Generate initial sitemap</button>
        <button
          onClick={openFanOutModal}
          className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer flex-shrink-0"
          title="BULK: scaffold WP drafts + generate content for EVERY planned slot. Sequential (~1.5 min per slot). Use after 🪄 Generate initial sitemap when you want to ship the whole wave at once."
        >✨ Generate all content</button>
        <RefreshCompetitorsMenu onChoose={openRefreshModal} />
        <button
          onClick={reseed}
          disabled={reseeding}
          className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer flex-shrink-0 disabled:opacity-50"
          title="Re-import the starter template (lib/landing-fan-out-plan.js). Idempotent on slot_key — existing slots aren't touched, missing ones get added."
        >{reseeding ? 'Reseeding…' : '🌱 Reseed from starter'}</button>
        <button
          onClick={() => setAdding(true)}
          className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer flex-shrink-0"
        >+ Add slot</button>
      </div>
      {reseedMsg && <div className="text-[10px] text-[#16a34a]">✓ {reseedMsg}</div>}
      {error && <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>}

      {checklistTotals && <ChecklistTotalsStrip totals={checklistTotals} />}

      <SiteIndexHintEditor />
      <VoiceAnchorsEditor />
      <InternalLinkPlanPanel slots={plan.slots} />
      <StrategicSitemapPanel onApplied={async () => { await load() }} />

      <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-3 min-w-0">
        {/* Sitemap grid — tier-grouped */}
        {/* min-w-0 is critical here: CSS Grid tracks default to
            min-content sizing, so a long slot label (e.g. "Birthday
            Party Venues Waukesha County") will blow this column past
            its 2fr allotment and squeeze the editor pane. min-w-0
            forces the column to honor its fr share + lets the inner
            truncate classes actually clip. */}
        <div className="space-y-3 min-w-0">
          {tierList.map(t => {
            const slots = slotsByTier(t.tier)
            return (
              <div key={t.tier} className="bg-white border border-[#e5e5e5] rounded p-2">
                <div className="flex items-baseline gap-2 mb-1">
                  <div className="text-[11px] font-medium text-ink">{t.label}</div>
                  <div className="text-[9px] text-muted">{slots.length} slot{slots.length === 1 ? '' : 's'}</div>
                </div>
                {t.subtitle && (
                  <div className="text-[9px] text-muted mb-2 italic">{t.subtitle}</div>
                )}
                {slots.length === 0 ? (
                  <div className="text-[9px] text-muted italic">No slots in this tier yet.</div>
                ) : (
                  <ul className="space-y-1">
                    {slots.map(s => {
                      // Per-slot hint preview. extra_strategy_hint is the
                      // AI-injection field that seeds landing_pages.strategy_hint
                      // at scaffold time, so it's the headline. Fall back to
                      // rationale (operator-readable "why this page exists") so
                      // a slot with no AI hint but a rationale still says
                      // something useful on the row. Empty = explicit "no hint"
                      // dim marker so gaps are visible at a glance.
                      const hint = (s.extra_strategy_hint || '').trim()
                      const rationale = (s.rationale || '').trim()
                      const preview = hint || rationale
                      const previewSource = hint ? 'hint' : (rationale ? 'rationale' : null)
                      return (
                        <li key={s.id} className="min-w-0">
                          <button
                            type="button"
                            onClick={() => { setActiveSlotId(s.id); setAdding(false) }}
                            className={`w-full text-left text-[10px] py-1 px-2 rounded border cursor-pointer flex flex-col gap-0.5 min-w-0 ${
                              activeSlotId === s.id
                                ? 'bg-[#f5f3ff] border-[#6C5CE7] text-ink'
                                : 'bg-white border-[#e5e5e5] hover:border-[#6C5CE7]'
                            }`}
                          >
                            <div className="flex items-center gap-2 w-full min-w-0">
                              <StatusPill status={s.status} />
                              {/* Phase 2: audit_class badge — only renders
                                  when the strategic-sitemap generator
                                  has been run AND classified this slot.
                                  Legacy slots default to 'create' which
                                  matches their semantic state. */}
                              {s.audit_class && s.audit_class !== 'create' && (
                                <span
                                  className={`text-[8px] py-0.5 px-1 rounded border font-mono flex-shrink-0 ${
                                    s.audit_class === 'enhance' ? 'bg-[#dcfce7] text-[#15803d] border-[#16a34a]/40'
                                    : 'bg-[#fef3c7] text-[#92400e] border-[#d97706]/40'
                                  }`}
                                  title={s.audit_class === 'enhance'
                                    ? 'Existing page matches this intent — needs SEO upgrades. Click to see audit finding.'
                                    : 'Existing page matches but has broken/missing meta. Click to see audit finding.'}
                                >{s.audit_class}</span>
                              )}
                              <span className="flex-1 min-w-0 truncate font-medium">{s.label}</span>
                              {s.template_kind && (
                                <span className="text-[8px] text-muted font-mono flex-shrink-0">{s.template_kind}</span>
                              )}
                            </div>
                            {preview ? (
                              <div
                                className="text-[9px] text-muted pl-[2px] truncate w-full"
                                title={`${previewSource === 'hint' ? 'Page hint' : 'Rationale'}: ${preview}`}
                              >
                                {previewSource === 'hint' ? '💡 ' : '📝 '}{preview}
                              </div>
                            ) : (
                              <div className="text-[9px] text-muted/60 italic pl-[2px]">
                                — no hint —
                              </div>
                            )}
                            {checklistBySlot[s.id] && <ChecklistDotRow checklist={checklistBySlot[s.id]} />}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
          {plan.slots.length === 0 && (
            <div className="text-[10px] text-muted italic py-4 text-center">
              No slots planned yet. Click <b>🌱 Reseed from starter</b> to import the canonical page set, or <b>+ Add slot</b> to create one from scratch.
            </div>
          )}
        </div>

        {/* Right pane — slot editor or add-slot form */}
        <div>
          {adding ? (
            <SlotEditor
              key="new"
              slot={null}
              tiers={tierList}
              platform={plan.platform}
              tenantTargetUrl={plan.tenant_target_url}
              onSaved={async () => { await load(); setAdding(false) }}
              onCancel={() => setAdding(false)}
            />
          ) : activeSlot ? (
            <SlotEditor
              key={activeSlot.id}
              slot={activeSlot}
              tiers={tierList}
              checklist={checklistBySlot[activeSlot.id] || null}
              platform={plan.platform}
              tenantTargetUrl={plan.tenant_target_url}
              onSaved={async () => { await load() }}
              onDeleted={async () => { await load(); setActiveSlotId(null) }}
              onCreatedWp={async () => { await load() }}
            />
          ) : (
            <div className="bg-white border border-[#e5e5e5] rounded p-4 text-center text-[10px] text-muted italic">
              Select a slot on the left to edit, or click <b>+ Add slot</b> to create a new one.
            </div>
          )}
        </div>
      </div>

      <DangerZone tenantSlot={plan.slots} onReset={async () => { await load() }} />

      {propagateModal && (
        <PropagateModal
          state={propagateModal}
          existingSlotKeys={new Set(plan.slots.map(s => s.slot_key))}
          onClose={() => setPropagateModal(null)}
          onRun={runPropagation}
        />
      )}

      {refreshModal && (
        <RefreshCompetitorsModal
          state={refreshModal}
          onClose={() => { setRefreshModal(null); load() }}
        />
      )}

      {fanOutModal && (
        <FanOutAndProposeModal
          state={fanOutModal}
          onClose={() => { setFanOutModal(null); load() }}
        />
      )}
    </div>
  )
}

// Three-button cluster for bulk competitor refresh: Missing /
// Stale / All. Each fires the same endpoint with a different mode.
// 'Missing' is the safest + most common default (right after a
// sitemap generation, to bulk-import all the new slots' competitors).
function RefreshCompetitorsMenu({ onChoose }) {
  const [open, setOpen] = useState(false)
  const [runAnalysis, setRunAnalysis] = useState(true)
  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer"
        title="Bulk-scrape competitor pages for every slot in the sitemap that has a competitor URL set. Optionally run 5-dim gap analysis on each."
      >🔄 Refresh competitors ▾</button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-40 bg-white border border-[#e5e5e5] rounded shadow-lg p-2 min-w-[280px] space-y-2">
          <label className="flex items-center gap-2 text-[10px] cursor-pointer">
            <input
              type="checkbox"
              checked={runAnalysis}
              onChange={e => setRunAnalysis(e.target.checked)}
            />
            <span>Also run gap analysis (slower, costs Claude tokens)</span>
          </label>
          <div className="border-t border-[#e5e5e5] pt-1 space-y-1">
            <button
              onClick={() => { setOpen(false); onChoose('missing', runAnalysis) }}
              className="w-full text-left text-[10px] py-1 px-2 rounded hover:bg-[#f5f3ff] cursor-pointer"
              title="Scrape only slots that have a competitor_url but no successful scraped data yet. Safe default after Generate Initial Sitemap."
            >
              <div className="font-medium">📥 Import missing</div>
              <div className="text-[9px] text-muted">For slots with a URL but no scraped data yet</div>
            </button>
            <button
              onClick={() => { setOpen(false); onChoose('stale', runAnalysis) }}
              className="w-full text-left text-[10px] py-1 px-2 rounded hover:bg-[#f5f3ff] cursor-pointer"
              title="Re-scrape slots whose last_fetched_at is older than 7 days. Periodic maintenance."
            >
              <div className="font-medium">⏰ Refresh stale (&gt;7 days)</div>
              <div className="text-[9px] text-muted">Re-scrape pages that haven't been checked recently</div>
            </button>
            <button
              onClick={() => { setOpen(false); onChoose('all', runAnalysis) }}
              className="w-full text-left text-[10px] py-1 px-2 rounded hover:bg-[#fff7ed] cursor-pointer"
              title="Re-scrape EVERY slot with a competitor_url regardless of staleness. Use after a competitor's known site-wide redesign."
            >
              <div className="font-medium">🔁 Refresh all</div>
              <div className="text-[9px] text-muted">Re-scrape every slot with a competitor URL</div>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Modal showing progress + result of a bulk competitor refresh.
// Two phases: 'running' (spinner + estimated time) and 'result' /
// 'error' (summary + per-slot table). No preview phase — the user
// already chose the mode in the menu.
// Bulk fan-out + propose progress modal. Long-running (~25-30 min
// for 18 slots); polls the BE every 4s for live progress + per-slot
// status. Close button is disabled while running so operator doesn't
// accidentally lose visibility — but they CAN close (server work
// continues; wizard reload picks up results regardless).
function FanOutAndProposeModal({ state, onClose }) {
  const { phase, total, processed, results, error } = state
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded shadow-xl border border-[#e5e5e5] max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e5e5e5]">
          <span className="text-[12px] font-semibold">✨ Generate content for all planned slots</span>
          {phase === 'running' && <span className="text-[10px] text-muted">{processed}/{total} done ({pct}%)</span>}
          {phase === 'done' && <span className="text-[10px] text-[#15803d]">✓ {total} slot{total === 1 ? '' : 's'} processed</span>}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-[10px] text-muted bg-transparent border-none cursor-pointer"
          >{phase === 'running' ? '— Hide (server continues)' : '✕ Close'}</button>
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-3">
          {phase === 'running' && (
            <>
              <div className="bg-[#fafafa] border border-[#e5e5e5] rounded p-2 space-y-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-[#e5e5e5] rounded overflow-hidden">
                    <div className="h-full bg-[#6C5CE7] transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] text-muted">{pct}%</span>
                </div>
                <div className="text-[10px] text-muted">
                  Processing {total} slot{total === 1 ? '' : 's'} sequentially. Each: WP draft + Propose (two-phase generation). ~60-90s per slot. Total estimated: ~{Math.ceil(total * 1.5)} minutes.
                </div>
              </div>
            </>
          )}

          {phase === 'error' && (
            <div className="text-[11px] text-[#c0392b] py-4">⚠ {error}</div>
          )}

          {Array.isArray(results) && results.length > 0 && (
            <table className="w-full text-[10px] border-collapse">
              <thead className="text-[9px] text-muted uppercase tracking-wide">
                <tr className="border-b border-[#e5e5e5]">
                  <th className="text-left py-1 pr-2 font-normal">Slot</th>
                  <th className="text-left py-1 pr-2 font-normal">Outcome</th>
                  <th className="text-left py-1 pr-2 font-normal">Detail</th>
                </tr>
              </thead>
              <tbody>
                {results.map(s => (
                  <tr key={s.slot_id} className="border-b border-[#f0f0f0]">
                    <td className="py-1 pr-2">
                      <div className="font-medium truncate max-w-[180px]" title={s.label}>{s.label}</div>
                      <div className="text-[8px] text-muted font-mono">{s.slot_key}</div>
                    </td>
                    <td className="py-1 pr-2">
                      {s.status === 'scaffolded_and_proposed' && <span className="text-[#15803d]">✓ scaffolded + proposed</span>}
                      {s.status === 'scaffolded_propose_failed' && <span className="text-[#d97706]">⚠ scaffolded, propose failed</span>}
                      {s.status === 'failed' && <span className="text-[#c0392b]">✗ failed</span>}
                    </td>
                    <td className="py-1 pr-2 text-[9px] text-muted">
                      {s.landing_page_id && `lp #${s.landing_page_id}`}
                      {s.version_id && ` · version #${s.version_id}`}
                      {s.propose_error && <span className="text-[#c0392b]"> · propose: {s.propose_error}</span>}
                      {s.error && <span className="text-[#c0392b]"> · {s.error}</span>}
                      {s.elapsed_ms && ` · ${(s.elapsed_ms/1000).toFixed(0)}s`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center gap-2 px-3 py-2 border-t border-[#e5e5e5]">
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer"
          >{phase === 'done' ? 'Done' : phase === 'running' ? 'Hide (server continues)' : 'Close'}</button>
        </div>
      </div>
    </div>
  )
}

function RefreshCompetitorsModal({ state, onClose }) {
  const { phase, mode, runAnalysis, result, error } = state
  const modeLabel = mode === 'missing' ? 'Import missing'
    : mode === 'stale' ? 'Refresh stale (>7 days)'
    : 'Refresh all'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded shadow-xl border border-[#e5e5e5] max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e5e5e5]">
          <span className="text-[12px] font-semibold">🔄 {modeLabel}</span>
          {phase === 'running' && <span className="text-[10px] text-muted">working…</span>}
          {phase === 'result' && result && (
            <span className="text-[10px] text-muted">
              {result.scraped}/{result.total} scraped
              {runAnalysis && result.analyzed > 0 && `, ${result.analyzed} analyzed`}
              {' · '}{result.elapsed_seconds}s
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            disabled={phase === 'running'}
            className="text-[10px] text-muted bg-transparent border-none cursor-pointer disabled:opacity-30"
          >✕ Close</button>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {phase === 'running' && (
            <div className="text-[11px] text-muted py-12 text-center space-y-2">
              <div className="italic">Playwright is scraping competitor pages…</div>
              {runAnalysis && (
                <div className="text-[10px]">After scraping, Claude Haiku will run a 5-dim gap analysis on each one. This can take 2-5 minutes for a full sitemap.</div>
              )}
              <div className="text-[10px] text-muted">Don't close this tab — the request is in flight.</div>
            </div>
          )}

          {phase === 'error' && (
            <div className="text-[11px] text-[#c0392b] py-4">⚠ {error}</div>
          )}

          {phase === 'result' && result && (
            <div className="space-y-2">
              {result.message && (
                <div className="text-[10px] text-muted italic">{result.message}</div>
              )}
              <div className="grid grid-cols-4 gap-2">
                <ResultStat label="Scraped" value={result.scraped} tone="green" />
                <ResultStat label="Scrape failed" value={result.scrape_failed} tone={result.scrape_failed > 0 ? 'red' : 'neutral'} />
                {runAnalysis && <ResultStat label="Analyzed" value={result.analyzed} tone="green" />}
                {runAnalysis && <ResultStat label="Analysis failed" value={result.analysis_failed} tone={result.analysis_failed > 0 ? 'red' : 'neutral'} />}
              </div>
              {Array.isArray(result.slots) && result.slots.length > 0 && (
                <table className="w-full text-[10px] border-collapse">
                  <thead className="text-[9px] text-muted uppercase tracking-wide">
                    <tr className="border-b border-[#e5e5e5]">
                      <th className="text-left py-1 pr-2 font-normal">Slot</th>
                      <th className="text-left py-1 pr-2 font-normal">Scrape</th>
                      {runAnalysis && <th className="text-left py-1 pr-2 font-normal">Analysis</th>}
                      <th className="text-left py-1 pr-2 font-normal">Competitor URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.slots.map(s => (
                      <tr key={s.slot_id} className="border-b border-[#f0f0f0]">
                        <td className="py-1 pr-2">
                          <div className="font-medium truncate max-w-[180px]" title={s.label}>{s.label}</div>
                          <div className="text-[8px] text-muted font-mono">{s.slot_key}</div>
                        </td>
                        <td className="py-1 pr-2">
                          {s.scrape_status === 'ok'
                            ? <span className="text-[#15803d]">✓</span>
                            : <span className="text-[#c0392b]" title={s.scrape_error}>⚠ {s.scrape_error || 'failed'}</span>}
                        </td>
                        {runAnalysis && (
                          <td className="py-1 pr-2">
                            {s.analysis_status === 'ok'
                              ? <span className="text-[#15803d]">✓</span>
                              : s.analysis_status === 'failed'
                                ? <span className="text-[#c0392b]" title={s.analysis_error}>⚠</span>
                                : <span className="text-muted">—</span>}
                          </td>
                        )}
                        <td className="py-1 pr-2">
                          <a
                            href={s.competitor_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#6C5CE7] underline truncate inline-block max-w-[240px]"
                            title={s.competitor_url}
                          >{(s.competitor_url || '').replace(/^https?:\/\//, '')}</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-3 py-2 border-t border-[#e5e5e5]">
          <div className="flex-1" />
          <button
            onClick={onClose}
            disabled={phase === 'running'}
            className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-30"
          >{phase === 'running' ? 'Working…' : 'Done'}</button>
        </div>
      </div>
    </div>
  )
}

// Modal for the 🪄 Generate initial sitemap flow. Three phases:
//   - 'parsing': Claude Haiku is parsing the saved brief.
//   - 'preview': parsed { tiers, pages } shown read-only; operator
//     either confirms ('Run') or cancels.
//   - 'result': per-slot outcomes after propagation (imported_wp /
//     scraped / planned / failed counts + table).
//   - 'error': hard failure (no brief saved, parse threw, etc.).
function PropagateModal({ state, existingSlotKeys, onClose, onRun }) {
  const { phase, parsed, propagating, result, error } = state
  // 'add-only' default — safer for progressive sitemap expansion.
  // 'refresh-existing' overwrites existing slot metadata with the
  // brief's values (may clobber manual edits + applied gap analysis).
  const [refreshExisting, setRefreshExisting] = useState(false)

  // Bucket parsed pages into 'new' (slot_key not in DB) vs 'existing'
  // so the operator sees the impact before clicking Run.
  const existingSet = existingSlotKeys instanceof Set ? existingSlotKeys : new Set()
  const newPages = Array.isArray(parsed?.pages) ? parsed.pages.filter(p => !existingSet.has(p.slot_key)) : []
  const existingPages = Array.isArray(parsed?.pages) ? parsed.pages.filter(p => existingSet.has(p.slot_key)) : []
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded shadow-xl border border-[#e5e5e5] max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e5e5e5]">
          <span className="text-[12px] font-semibold">🪄 Generate initial sitemap</span>
          {phase === 'parsing' && <span className="text-[10px] text-muted">parsing brief…</span>}
          {phase === 'preview' && parsed && (
            <span className="text-[10px] text-muted">
              parsed: {parsed.tiers?.length || 0} tier(s), {parsed.pages?.length || 0} page(s)
            </span>
          )}
          {phase === 'result' && result?.summary && (
            <span className="text-[10px] text-muted">
              done — {result.summary.imported_wp} WP, {result.summary.scraped} scraped, {result.summary.planned} planned, {result.summary.failed} failed
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="text-[10px] text-muted bg-transparent border-none cursor-pointer"
          >✕ Close</button>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {phase === 'parsing' && (
            <div className="text-[11px] text-muted italic py-12 text-center">
              Claude is reading your sitemap strategy brief and pulling out the structured tier + page plan…
            </div>
          )}

          {phase === 'error' && (
            <div className="text-[11px] text-[#c0392b] py-4">
              ⚠ {error || 'Unknown error'}
            </div>
          )}

          {phase === 'preview' && parsed && (
            <div className="space-y-3">
              <div className="text-[10px] text-muted">
                Review what Claude pulled from your brief below. Click <b>Run propagation</b> to process the new pages — check each against your WordPress install + source domain, import/scrape what exists, leave the rest planned.
              </div>

              {/* Progressive-add banner: show new-vs-existing breakdown
                  so the operator knows EXACTLY what's about to happen.
                  Most useful on the 2nd+ run when they've added pages
                  to an existing brief. */}
              {existingSlotKeys && existingSlotKeys.size > 0 && (
                <div className="bg-[#f5f3ff] border border-[#6C5CE7]/30 rounded p-2 text-[10px] space-y-1">
                  <div className="font-medium">
                    📊 Plan: <span className="text-[#16a34a]">{newPages.length} new</span>
                    {' · '}
                    <span className="text-muted">{existingPages.length} already in your sitemap</span>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={refreshExisting}
                      onChange={e => setRefreshExisting(e.target.checked)}
                    />
                    <span>
                      Also refresh existing slots from this brief
                      <span className="text-muted"> — overwrites manual hint edits, applied gap analysis, and other operator changes. Off = safer (add-only mode).</span>
                    </span>
                  </label>
                </div>
              )}

              <div>
                <div className="text-[10px] font-medium mb-1">Tiers ({parsed.tiers?.length || 0})</div>
                <div className="space-y-1">
                  {(parsed.tiers || []).map(t => (
                    <div key={t.tier} className="text-[10px] bg-[#fafafa] border border-[#f0f0f0] rounded px-2 py-1">
                      <span className="font-medium">Tier {t.tier}: {t.label}</span>
                      {t.subtitle && <div className="text-[9px] text-muted">{t.subtitle}</div>}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10px] font-medium mb-1">Pages ({parsed.pages?.length || 0})</div>
                <table className="w-full text-[10px] border-collapse">
                  <thead className="text-[9px] text-muted uppercase tracking-wide">
                    <tr className="border-b border-[#e5e5e5]">
                      <th className="text-left py-1 pr-2 font-normal">Slot</th>
                      <th className="text-left py-1 pr-2 font-normal">URL slug</th>
                      <th className="text-left py-1 pr-2 font-normal">Tier</th>
                      <th className="text-left py-1 pr-2 font-normal">Brief says exists?</th>
                      <th className="text-left py-1 pr-2 font-normal">Competitor</th>
                      <th className="text-left py-1 pr-2 font-normal">Keywords</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(parsed.pages || []).map(p => {
                      const compUrl = (p.competitor_url || '').trim()
                      const hasComp = compUrl && /^https?:\/\//i.test(compUrl)
                      return (
                        <tr key={p.slot_key} className="border-b border-[#f0f0f0]">
                          <td className="py-1 pr-2">
                            <div className="font-medium">{p.label}</div>
                            <div className="text-[8px] text-muted font-mono">{p.slot_key}</div>
                          </td>
                          <td className="py-1 pr-2 font-mono text-[9px]">{p.url_slug || '—'}</td>
                          <td className="py-1 pr-2">{p.tier}</td>
                          <td className="py-1 pr-2">
                            <ExistsPill v={p.exists_at_source} />
                          </td>
                          <td className="py-1 pr-2 text-[9px]">
                            {hasComp ? (
                              <a
                                href={compUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#6C5CE7] underline truncate inline-block max-w-[180px]"
                                title={compUrl}
                              >{compUrl.replace(/^https?:\/\//, '')}</a>
                            ) : (
                              <span className="text-muted italic">uncontested</span>
                            )}
                          </td>
                          <td className="py-1 pr-2 text-[9px] text-muted">
                            {(p.target_keywords || []).slice(0, 3).join(', ')}
                            {(p.target_keywords || []).length > 3 && ` +${p.target_keywords.length - 3}`}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {error && <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>}
            </div>
          )}

          {phase === 'result' && result && (
            <div className="space-y-2">
              <div className="grid grid-cols-5 gap-2">
                <ResultStat label="WP imported" value={result.summary.imported_wp} tone="green" />
                <ResultStat label="Scraped" value={result.summary.scraped} tone="green" />
                <ResultStat label="Planned" value={result.summary.planned} tone="neutral" />
                <ResultStat label="Skipped (existing)" value={result.summary.skipped_existing || 0} tone="neutral" />
                <ResultStat label="Failed" value={result.summary.failed} tone={result.summary.failed > 0 ? 'red' : 'neutral'} />
              </div>
              <table className="w-full text-[10px] border-collapse">
                <thead className="text-[9px] text-muted uppercase tracking-wide">
                  <tr className="border-b border-[#e5e5e5]">
                    <th className="text-left py-1 pr-2 font-normal">Slot</th>
                    <th className="text-left py-1 pr-2 font-normal">Outcome</th>
                    <th className="text-left py-1 pr-2 font-normal">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {result.pages.map(p => (
                    <tr key={p.slot_key} className="border-b border-[#f0f0f0]">
                      <td className="py-1 pr-2">
                        <div className="font-medium">{p.label}</div>
                        <div className="text-[8px] text-muted font-mono">{p.url_slug}</div>
                      </td>
                      <td className="py-1 pr-2">
                        <OutcomePill status={p.status} />
                      </td>
                      <td className="py-1 pr-2 text-[9px] text-muted">
                        {p.status === 'imported_wp' && `→ landing_page #${p.landing_page_id}${p.keywords_added ? ` · +${p.keywords_added} keywords` : ''}`}
                        {p.status === 'scraped' && `→ landing_page #${p.landing_page_id} (${(p.scrape_bytes / 1024).toFixed(1)}KB)${p.keywords_added ? ` · +${p.keywords_added} keywords` : ''}`}
                        {p.status === 'planned' && 'Not found anywhere — click Create WP draft on the slot to materialize'}
                        {p.status === 'already_linked' && `→ landing_page #${p.landing_page_id} (existing)`}
                        {p.status === 'skipped_existing' && `Already in your sitemap — left untouched (add-only mode preserves operator edits)`}
                        {p.status === 'failed' && <span className="text-[#c0392b]">{p.error}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-3 py-2 border-t border-[#e5e5e5]">
          <div className="flex-1" />
          {phase === 'preview' && (
            <>
              <button
                onClick={onClose}
                disabled={propagating}
                className="text-[10px] py-1 px-2 bg-white border border-[#e5e5e5] text-muted rounded cursor-pointer"
              >Cancel</button>
              <button
                onClick={() => onRun(refreshExisting ? 'refresh-existing' : 'add-only')}
                disabled={propagating || !parsed?.pages?.length}
                className="text-[10px] py-1 px-2 bg-[#16a34a] text-white border-none rounded cursor-pointer disabled:opacity-50"
                title={refreshExisting
                  ? 'Refresh ALL slots (existing + new) from this brief — overwrites operator edits on existing ones'
                  : 'Process only NEW slot_keys; existing slots stay untouched. Preserves operator edits.'}
              >{propagating
                ? 'Propagating…'
                : refreshExisting
                  ? `🚀 Run (refresh all ${parsed?.pages?.length || 0} pages)`
                  : `🚀 Run (${newPages.length} new${existingPages.length > 0 ? `, ${existingPages.length} skipped` : ''})`}</button>
            </>
          )}
          {(phase === 'result' || phase === 'error') && (
            <button
              onClick={onClose}
              className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer"
            >Done</button>
          )}
        </div>
      </div>
    </div>
  )
}

function ExistsPill({ v }) {
  const tone = v === 'yes' ? 'bg-[#dcfce7] text-[#15803d] border-[#16a34a]/40'
    : v === 'no' ? 'bg-[#f0f0f0] text-muted border-[#d4d4d8]'
    : 'bg-[#fef9c3] text-[#854d0e] border-[#ca8a04]/40'
  return (
    <span className={`text-[9px] py-0.5 px-1.5 rounded border ${tone} font-mono`}>{v || 'unsure'}</span>
  )
}

function OutcomePill({ status }) {
  const map = {
    imported_wp: { tone: 'bg-[#dcfce7] text-[#15803d] border-[#16a34a]/40', label: '✓ WP imported' },
    scraped: { tone: 'bg-[#dcfce7] text-[#15803d] border-[#16a34a]/40', label: '✓ scraped' },
    already_linked: { tone: 'bg-[#dbeafe] text-[#1e40af] border-[#3b82f6]/40', label: '↻ already linked' },
    skipped_existing: { tone: 'bg-[#f5f3ff] text-[#5b21b6] border-[#6C5CE7]/40', label: '⏭ skipped (existing)' },
    planned: { tone: 'bg-[#f0f0f0] text-muted border-[#d4d4d8]', label: '○ planned' },
    failed: { tone: 'bg-[#fee2e2] text-[#991b1b] border-[#dc2626]/40', label: '⚠ failed' },
  }
  const m = map[status] || { tone: 'bg-[#f0f0f0] text-muted border-[#d4d4d8]', label: status }
  return <span className={`text-[9px] py-0.5 px-1.5 rounded border ${m.tone} font-mono whitespace-nowrap`}>{m.label}</span>
}

function ResultStat({ label, value, tone }) {
  const colors = tone === 'green' ? 'bg-[#f0fdf4] border-[#16a34a]/30 text-[#15803d]'
    : tone === 'red' ? 'bg-[#fef2f2] border-[#dc2626]/30 text-[#991b1b]'
    : 'bg-[#fafafa] border-[#e5e5e5] text-ink'
  return (
    <div className={`border rounded p-2 ${colors}`}>
      <div className="text-[14px] font-semibold">{value}</div>
      <div className="text-[9px] text-muted uppercase tracking-wide">{label}</div>
    </div>
  )
}

// Tenant-wide sitemap strategy brief. Free-form prose — typically
// pasted from a claude.ai brainstorm where the operator thought
// through tiers, slot rationale, internal-linking topology, and
// topical-authority strategy. Auto-prepended to every audit +
// propose call (alongside the per-page strategy_hint) so each page
// generation knows how it fits the larger plan.
//
// Distinct from editorial_policy (hard rules) and per-page
// strategy_hint (this-page intent). Sits between them in priority.
function SiteIndexHintEditor() {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [text, setText] = useState('')
  const [original, setOriginal] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)

  const load = async () => {
    try {
      const r = await api.getSiteIndexHint()
      const v = r?.site_index_hint || ''
      setText(v); setOriginal(v); setLoaded(true)
    } catch (e) {
      setErr(e?.message || String(e))
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
    setBusy(true); setErr(null); setSaved(false)
    try {
      await api.setSiteIndexHint(text)
      setOriginal(text)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const isDirty = loaded && text !== original
  const charCount = text.length

  return (
    <details open={open} className="border border-[#e5e5e5] rounded bg-white">
      <summary
        onClick={(e) => { e.preventDefault(); handleToggle() }}
        className="cursor-pointer py-2 px-3 flex items-center gap-2"
      >
        <span className="text-[11px] font-medium">📋 Sitemap strategy brief</span>
        <span className="text-[9px] text-muted">
          Overall plan for the site — tiers, slot rationale, internal-linking topology. Paste your claude.ai brainstorm here. Injected into every audit + propose call.
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
          {!loaded && !err && (
            <div className="text-[10px] text-muted italic">Loading…</div>
          )}
          {err && (
            <div className="text-[10px] text-[#c0392b]">⚠ {err}</div>
          )}
          {loaded && (
            <>
              <div className="text-[10px] text-muted">
                Free-form prose. Sits between <em>editorial_policy</em> (hard rules) and per-page <em>strategy_hint</em> in priority. Tells the rewrite how THIS page fits the wider plan — don't drift into territory owned by a sibling page, respect the planned topology.
              </div>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={14}
                spellCheck={false}
                className="w-full text-[11px] font-mono border border-[#e5e5e5] rounded p-2 outline-none focus:border-[#6C5CE7] resize-y"
                placeholder="e.g. SITE STRATEGY: Tier 1 = top-of-funnel category hubs (one per service line). Tier 2 = case-study + service-depth pages, internally linking up to tier 1. Tier 3 = supporting blog posts that link laterally to tier 2 + up to tier 1. INTERNAL LINKING: every tier 3 must link to its parent tier 2 within the first 300 words. TOPICAL AUTHORITY: focus on Milwaukee + Wisconsin queries; deprioritize national..."
              />
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-muted">{charCount.toLocaleString()} chars</span>
                {saved && <span className="text-[9px] text-[#16a34a]">✓ Saved</span>}
                <span className="flex-1" />
                <button
                  onClick={save}
                  disabled={busy || !isDirty}
                  className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
                >{busy ? 'Saving…' : 'Save brief'}</button>
              </div>
            </>
          )}
        </div>
      )}
    </details>
  )
}

// Tenant-curated voice anchor pages. Operator pastes URLs (one per
// line) of existing pages on the tenant's site that represent the
// brand voice / who they are. Save scrapes them via Playwright and
// stores excerpts. Every propose call thereafter injects the
// excerpts into the system prompt as BACKGROUND context (not a
// style cage — better-sounding copy still wins).
//
// Lives at the wizard header level (below the sitemap strategy
// brief) because it's tenant-wide config, not per-slot.
function VoiceAnchorsEditor() {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [text, setText] = useState('') // textarea — one URL per line
  const [anchors, setAnchors] = useState([]) // server state for status pills
  const [original, setOriginal] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)

  const flashMsg = (m) => { setMsg(m); setTimeout(() => setMsg(null), 3000) }

  const anchorsToText = (list) => (list || []).map(a => a.url).join('\n')

  const load = async () => {
    try {
      const r = await api.getVoiceAnchors()
      const list = r?.anchors || []
      setAnchors(list)
      const t = anchorsToText(list)
      setText(t); setOriginal(t); setLoaded(true)
    } catch (e) {
      setErr(e?.message || String(e))
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
    setBusy(true); setErr(null)
    try {
      const urls = text.split(/\n+/).map(s => s.trim()).filter(Boolean)
      const r = await api.saveVoiceAnchors(urls)
      setAnchors(r?.anchors || [])
      const t = anchorsToText(r?.anchors || [])
      setText(t); setOriginal(t)
      flashMsg(`Saved & scraped ${urls.length} anchor(s)`)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true); setErr(null)
    try {
      const r = await api.refreshVoiceAnchors()
      setAnchors(r?.anchors || [])
      flashMsg(`Refreshed — ${r.scraped} ok, ${r.failed} failed`)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setRefreshing(false)
    }
  }

  const isDirty = loaded && text.trim() !== original.trim()
  const okCount = anchors.filter(a => a.fetch_status === 'ok').length
  const failedCount = anchors.filter(a => a.fetch_status === 'failed').length
  const pendingCount = anchors.filter(a => !a.fetch_status || a.fetch_status === 'pending').length

  return (
    <details open={open} className="border border-[#e5e5e5] rounded bg-white">
      <summary
        onClick={(e) => { e.preventDefault(); handleToggle() }}
        className="cursor-pointer py-2 px-3 flex items-center gap-2"
      >
        <span className="text-[11px] font-medium">🎙️ Voice anchor pages</span>
        <span className="text-[9px] text-muted">
          Existing pages on this tenant's site — background context for content generation (not a style cage)
        </span>
        <span className="flex-1" />
        {loaded && (
          <span className="text-[9px] text-muted">
            {anchors.length} anchor{anchors.length === 1 ? '' : 's'}
            {failedCount > 0 && <span className="text-[#c0392b]"> · {failedCount} failed</span>}
            {pendingCount > 0 && <span className="text-[#d97706]"> · {pendingCount} pending</span>}
          </span>
        )}
        <span className="text-[10px] text-muted">{open ? '▾' : '▸'}</span>
      </summary>
      {open && (
        <div className="p-3 pt-0 space-y-2">
          {!loaded && !err && (
            <div className="text-[10px] text-muted italic">Loading…</div>
          )}
          {err && <div className="text-[10px] text-[#c0392b]">⚠ {err}</div>}
          {loaded && (
            <>
              <div className="text-[10px] text-muted">
                One URL per line. Pages from your tenant's existing site that represent the brand voice + who you are. Excerpts get injected into every content-generation prompt as background — Claude reads them to understand the tenant, but better-sounding copy still wins. Not a style cage.
              </div>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={Math.max(6, (text.match(/\n/g) || []).length + 1)}
                spellCheck={false}
                className="w-full text-[10px] font-mono border border-[#e5e5e5] rounded p-2 outline-none focus:border-[#6C5CE7] resize-y"
                placeholder="https://www.poppyandthyme.com/make-and-take&#10;https://www.poppyandthyme.com/make-and-take-parties&#10;..."
              />
              {anchors.length > 0 && (
                <div className="space-y-0.5">
                  {anchors.map(a => (
                    <div key={a.id} className="flex items-center gap-2 text-[10px]">
                      <AnchorStatusPill status={a.fetch_status} />
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#6C5CE7] underline truncate flex-1 min-w-0"
                        title={a.url}
                      >{a.url.replace(/^https?:\/\//, '')}</a>
                      {a.title && (
                        <span className="text-[9px] text-muted truncate max-w-[200px]" title={a.title}>· {a.title}</span>
                      )}
                      {a.fetch_status === 'failed' && a.fetch_error && (
                        <span className="text-[9px] text-[#c0392b]" title={a.fetch_error}>⚠</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 pt-1 border-t border-[#f0f0f0]">
                {msg && <span className="text-[9px] text-[#16a34a]">✓ {msg}</span>}
                <span className="flex-1" />
                <button
                  onClick={refresh}
                  disabled={refreshing || isDirty || anchors.length === 0}
                  className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer disabled:opacity-50"
                  title="Re-scrape all anchors (catches voice drift when the site updates). Disabled while there are unsaved changes."
                >{refreshing ? 'Refreshing…' : '🔄 Refresh all'}</button>
                <button
                  onClick={save}
                  disabled={busy || !isDirty}
                  className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
                  title="Save the URL list and scrape any new entries"
                >{busy ? 'Saving & scraping…' : 'Save & scrape'}</button>
              </div>
            </>
          )}
        </div>
      )}
    </details>
  )
}

// Cross-page internal-link orchestration panel. Single Claude
// Haiku call across all managed landing pages produces a hub/spoke
// Phase 2 (multi-platform): site audit + strategic sitemap panel.
// Three-step workflow:
//   1. 🔍 Audit site → fetches sitemap.xml + extracts per-page
//      signals. Works for ANY platform (WordPress, Square Online,
//      Squarespace, Wix). Result cached on tenants.last_site_audit.
//   2. 🎯 Generate strategic sitemap → Claude Haiku classifies
//      each intent in the brief against the audit (enhance / fix /
//      create). Cached on tenants.last_strategic_sitemap.
//   3. 📥 Apply to plan → upserts slots into landing_page_plan
//      with their audit_class + audit_finding. Existing slots get
//      reclassified; new ones inserted.
function StrategicSitemapPanel({ onApplied }) {
  const [audit, setAudit] = useState(null)
  const [auditGeneratedAt, setAuditGeneratedAt] = useState(null)
  const [auditBusy, setAuditBusy] = useState(false)
  const [auditError, setAuditError] = useState(null)

  // Non-destructive "classify existing slots" state. This is the
  // primary path for tenants who already have a working sitemap.
  const [classifyBusy, setClassifyBusy] = useState(false)
  const [classifyError, setClassifyError] = useState(null)
  const [classifyResult, setClassifyResult] = useState(null)

  const [sitemap, setSitemap] = useState(null)
  const [sitemapGeneratedAt, setSitemapGeneratedAt] = useState(null)
  const [sitemapBusy, setSitemapBusy] = useState(false)
  const [sitemapError, setSitemapError] = useState(null)

  const [brief, setBrief] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState(null)
  const [applyError, setApplyError] = useState(null)

  // Load cached audit + sitemap on mount.
  useEffect(() => {
    let cancelled = false
    api.getSiteAudit().then(r => {
      if (cancelled) return
      setAudit(r?.audit || null)
      setAuditGeneratedAt(r?.generated_at || null)
    }).catch(() => {})
    api.getStrategicSitemap().then(r => {
      if (cancelled) return
      setSitemap(r?.sitemap || null)
      setSitemapGeneratedAt(r?.generated_at || null)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Non-destructive classification of existing slots against the
  // cached audit. Only updates audit_class / matched_url /
  // audit_priority / audit_finding — slot content untouched.
  const runClassifyExisting = async () => {
    if (classifyBusy) return
    if (!audit || audit.total_urls === 0) {
      setClassifyError('Run the site audit first — classification needs the cached audit to match URLs against.')
      return
    }
    setClassifyBusy(true); setClassifyError(null); setClassifyResult(null)
    try {
      const r = await api.classifyExistingSlots()
      setClassifyResult(r)
      if (typeof onApplied === 'function') await onApplied()
    } catch (e) {
      setClassifyError(e?.message || String(e))
    } finally {
      setClassifyBusy(false)
    }
  }

  const runAudit = async () => {
    if (auditBusy) return
    setAuditBusy(true); setAuditError(null)
    try {
      const r = await api.runSiteAudit({})
      setAudit(r?.audit || null)
      setAuditGeneratedAt(r?.generated_at || null)
    } catch (e) {
      setAuditError(e?.message || String(e))
    } finally {
      setAuditBusy(false)
    }
  }

  const runSitemap = async () => {
    if (sitemapBusy) return
    if (!brief.trim()) { setSitemapError('Paste the strategic brief into the textarea first.'); return }
    setSitemapBusy(true); setSitemapError(null); setApplyResult(null); setApplyError(null)
    try {
      const r = await api.generateStrategicSitemap({ brief })
      setSitemap(r?.sitemap || null)
      setSitemapGeneratedAt(r?.generated_at || null)
    } catch (e) {
      setSitemapError(e?.message || String(e))
    } finally {
      setSitemapBusy(false)
    }
  }

  const applyToPlan = async () => {
    if (applying || !sitemap?.slots?.length) return
    if (!confirm(`Apply ${sitemap.slots.length} slot(s) to the sitemap plan?\n\nUpsert by slot_key — existing slots get reclassified (audit_class + matched_url + priority updated); new slots inserted. Enhance/Fix slots auto-link to imported landing_pages by URL match.\n\nContinue?`)) return
    setApplying(true); setApplyError(null); setApplyResult(null)
    try {
      const r = await api.applyStrategicSitemap(sitemap.slots)
      setApplyResult(r)
      if (typeof onApplied === 'function') await onApplied()
    } catch (e) {
      setApplyError(e?.message || String(e))
    } finally {
      setApplying(false)
    }
  }

  const auditCounts = (() => {
    if (!audit) return null
    const pages = audit.pages || []
    return {
      total: pages.length,
      with_title: pages.filter(p => p.title).length,
      with_meta: pages.filter(p => p.meta_description).length,
      with_h1: pages.filter(p => p.h1).length,
      with_jsonld: pages.filter(p => Array.isArray(p.jsonld) && p.jsonld.length > 0).length,
      in_nav: pages.filter(p => p.in_main_nav).length,
      errored: pages.filter(p => p.error).length,
    }
  })()

  const slotCounts = (() => {
    if (!sitemap?.slots) return null
    return {
      total: sitemap.slots.length,
      enhance: sitemap.slots.filter(s => s.audit_class === 'enhance').length,
      fix: sitemap.slots.filter(s => s.audit_class === 'fix').length,
      create: sitemap.slots.filter(s => s.audit_class === 'create').length,
    }
  })()

  return (
    <details className="border border-[#2D9A5E]/40 rounded bg-[#f0fdf4]">
      <summary className="cursor-pointer py-2 px-3 flex items-center gap-2">
        <span className="text-[11px] font-medium text-[#15803d]">🎯 Strategic sitemap (audit + generate + apply)</span>
        <span className="text-[9px] text-muted">
          ({slotCounts ? `${slotCounts.total} slots: ${slotCounts.enhance}E/${slotCounts.fix}F/${slotCounts.create}C` : audit ? `${audit.total_urls} pages audited, no sitemap yet` : 'not run yet'})
        </span>
        <span className="text-[9px] text-muted">— platform-agnostic site audit + Claude-driven A/B/C classification</span>
        <span className="flex-1" />
      </summary>
      <div className="p-3 pt-0 space-y-2 text-[10px]">
        {/* Step 1 — audit */}
        <div className="bg-white border border-[#2D9A5E]/30 rounded p-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[10px]">Step 1 · 🔍 Site audit</span>
            <span className="text-[9px] text-muted">Fetches sitemap.xml + per-URL title/meta/H1/H2/JSON-LD. Works on WordPress, Square Online, Squarespace, Wix.</span>
            <span className="flex-1" />
            <button
              onClick={runAudit}
              disabled={auditBusy}
              className="text-[10px] py-1 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50"
            >{auditBusy ? 'Auditing…' : (audit ? '🔁 Re-run audit' : '🔍 Run audit')}</button>
          </div>
          {auditError && <div className="text-[10px] text-[#c0392b] bg-[#fef2f2] border border-[#c0392b]/30 rounded p-2">⚠ {auditError}</div>}
          {audit && auditCounts && (
            <div className="text-[9px] text-muted">
              {audit.error
                ? <span className="text-[#c0392b]">⚠ {audit.error}</span>
                : <>
                    Sitemap: <a href={audit.sitemap_url} target="_blank" rel="noopener noreferrer" className="text-[#6C5CE7] underline">{audit.sitemap_url}</a>
                    {' · '}
                    {auditCounts.total} pages
                    {auditCounts.errored > 0 && <span className="text-[#c0392b]"> · {auditCounts.errored} errored</span>}
                    {' · '}
                    {auditCounts.with_meta}/{auditCounts.total} have meta
                    {' · '}
                    {auditCounts.with_h1}/{auditCounts.total} have H1
                    {' · '}
                    {auditCounts.with_jsonld}/{auditCounts.total} have JSON-LD
                    {' · '}
                    {auditCounts.in_nav} in nav
                    {auditGeneratedAt && <> · last run {new Date(auditGeneratedAt).toLocaleString()}</>}
                  </>
              }
            </div>
          )}
        </div>

        {/* Step 2 — primary, non-destructive: classify existing slots */}
        <div className="bg-white border border-[#2D9A5E]/30 rounded p-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[10px]">Step 2 · 🎯 Classify existing slots</span>
            <span className="text-[9px] text-muted">Match every existing slot to its audited URL + set audit_class (enhance / fix / create). Non-destructive — no slot content overwrites, no Claude.</span>
            <span className="flex-1" />
            <button
              onClick={runClassifyExisting}
              disabled={classifyBusy || !audit}
              className="text-[10px] py-1 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50"
              title={!audit ? 'Run the audit first so we have URLs to match against.' : 'Match each existing slot (by its linked landing_page URL) to the audited page. Classify as enhance (page exists + meta OK), fix (page exists + meta broken), or create (no match). Updates only audit_class + matched_url + audit_priority + audit_finding — slot content stays as-is.'}
            >{classifyBusy ? 'Classifying…' : '🎯 Classify existing slots'}</button>
          </div>
          {classifyError && <div className="text-[10px] text-[#c0392b] bg-[#fef2f2] border border-[#c0392b]/30 rounded p-2">⚠ {classifyError}</div>}
          {classifyResult && (
            <div className="space-y-1">
              <div className="text-[10px] text-[#15803d] bg-[#f0fdf4] border border-[#15803d]/30 rounded p-2">
                ✓ Classified {classifyResult.summary.total} slot{classifyResult.summary.total === 1 ? '' : 's'}: <span className="text-[#16a34a] font-medium">{classifyResult.summary.enhance} enhance</span> · <span className="text-[#d97706] font-medium">{classifyResult.summary.fix} fix</span> · <span className="text-[#6C5CE7] font-medium">{classifyResult.summary.create} create</span>
                {classifyResult.summary.linked_but_unmatched > 0 && (
                  <> · <span className="text-muted">{classifyResult.summary.linked_but_unmatched} linked but unmatched (page in DB, not in sitemap.xml)</span></>
                )}
                {classifyResult.touched > 0 && <> · updated {classifyResult.touched}, {classifyResult.unchanged} already-current</>}
              </div>
              {/* Per-slot finding preview, collapsed */}
              <details>
                <summary className="cursor-pointer text-[10px] text-muted underline">Show per-slot details ({classifyResult.classifications.length})</summary>
                <div className="bg-[#fafafa] border border-[#e5e5e5] rounded mt-1 max-h-[300px] overflow-auto">
                  {classifyResult.classifications.map((c, i) => {
                    const classColor = c.audit_class === 'enhance' ? 'bg-[#dcfce7] text-[#15803d] border-[#16a34a]/40'
                      : c.audit_class === 'fix' ? 'bg-[#fef3c7] text-[#92400e] border-[#d97706]/40'
                      : 'bg-[#e0e7ff] text-[#3730a3] border-[#6366f1]/40'
                    return (
                      <div key={i} className="px-2 py-1.5 border-b border-[#f0f0f0] last:border-0 text-[10px]">
                        <div className="flex items-center gap-2">
                          <span className={`text-[8px] py-0.5 px-1 rounded border font-mono ${classColor}`}>{c.audit_class}</span>
                          <span className="font-mono text-[9px] text-muted">{c.slot_key}</span>
                          {c.matched_url && (
                            <a href={c.matched_url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-[#6C5CE7] underline truncate">{c.matched_url}</a>
                          )}
                          {c.audit_priority && <span className="text-[9px] font-mono">{c.audit_priority.toUpperCase()}</span>}
                          {!c.changed && <span className="text-[9px] text-muted">(no change)</span>}
                        </div>
                        {c.audit_finding?.broken_reasons?.length > 0 && (
                          <div className="text-[9px] text-[#92400e] mt-0.5">Broken: {c.audit_finding.broken_reasons.join('; ')}</div>
                        )}
                        {c.audit_finding?.skipped_reason && (
                          <div className="text-[9px] text-muted italic mt-0.5">{c.audit_finding.skipped_reason}</div>
                        )}
                        {c.audit_finding?.suggested_action && c.changed && (
                          <div className="text-[9px] text-muted mt-0.5">→ {c.audit_finding.suggested_action}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </details>
            </div>
          )}
        </div>

        {/* Step 3 — advanced/optional: generate full sitemap from brief.
            For new tenants (no existing slots) OR when an operator
            wants to regenerate from scratch. Hidden by default since
            it can overwrite operator-edited slot content. */}
        <details className="bg-white border border-[#e5e5e5] rounded">
          <summary className="cursor-pointer py-1.5 px-2 text-[10px] flex items-center gap-2">
            <span className="font-medium">🆕 Advanced · Generate full sitemap from a brief (Claude)</span>
            <span className="text-[9px] text-muted">For NEW tenants or full re-generation. Overwrites slot content for matching slot_keys — use with caution.</span>
          </summary>
          <div className="p-2 space-y-1.5">
            <textarea
              value={brief}
              onChange={e => setBrief(e.target.value)}
              placeholder="Paste your strategic brief here (audience, goals, target keywords, locations served, intents). The brief can come from claude.ai's research output or be written manually."
              rows={6}
              className="w-full text-[10px] border border-[#e5e5e5] rounded p-1.5 bg-white resize-y font-sans"
            />
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-muted">Brief: {brief.length} chars</span>
              <span className="flex-1" />
              <button
                onClick={runSitemap}
                disabled={sitemapBusy || !brief.trim()}
                className="text-[10px] py-1 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50"
                title={!audit ? 'Recommended to run Site Audit first so existing-page matches are detected.' : 'Generate full strategic sitemap from the brief + audit. Each intent gets classified enhance/fix/create. ~15-30s.'}
              >{sitemapBusy ? 'Generating…' : (sitemap ? '🔁 Re-generate' : '🆕 Generate from brief')}</button>
            </div>
            {sitemapError && <div className="text-[10px] text-[#c0392b] bg-[#fef2f2] border border-[#c0392b]/30 rounded p-2">⚠ {sitemapError}</div>}
            {sitemap && (
              <div className="space-y-1">
                <div className="text-[9px] text-muted">
                  {slotCounts.total} slots: <span className="text-[#16a34a] font-medium">{slotCounts.enhance} enhance</span> · <span className="text-[#d97706] font-medium">{slotCounts.fix} fix</span> · <span className="text-[#6C5CE7] font-medium">{slotCounts.create} create</span>
                  {sitemapGeneratedAt && <> · generated {new Date(sitemapGeneratedAt).toLocaleString()}</>}
                </div>
                {sitemap.summary && <div className="text-[10px] italic text-ink bg-[#fafafa] border border-[#e5e5e5] rounded p-1.5">{sitemap.summary}</div>}
              </div>
            )}

            {sitemap?.slots?.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-[#e5e5e5]">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-muted font-medium">⚠ Applies generated content over existing slots with the same slot_key (label, hint, tier, keywords all get replaced).</span>
                  <span className="flex-1" />
                  <button
                    onClick={applyToPlan}
                    disabled={applying}
                    className="text-[10px] py-1 px-2 bg-[#c0392b] text-white border-none rounded cursor-pointer disabled:opacity-50"
                  >{applying ? 'Applying…' : `📥 Apply ${slotCounts.total} (overwrites)`}</button>
                </div>
                {applyError && <div className="text-[10px] text-[#c0392b] bg-[#fef2f2] border border-[#c0392b]/30 rounded p-2">⚠ {applyError}</div>}
                {applyResult && (
                  <div className="text-[10px] text-[#15803d] bg-[#f0fdf4] border border-[#15803d]/30 rounded p-2">
                    ✓ Applied. Inserted {applyResult.inserted} new slot{applyResult.inserted === 1 ? '' : 's'}, updated {applyResult.updated}, linked {applyResult.linked_landing_pages} to existing landing_pages.
                  </div>
                )}
              </div>
            )}

            {sitemap?.slots?.length > 0 && (
              <div className="bg-[#fafafa] border border-[#e5e5e5] rounded max-h-[300px] overflow-auto">
                <div className="grid grid-cols-[24px_1fr_120px_60px_60px] gap-1 px-2 py-1 bg-[#fafafa] border-b border-[#e5e5e5] text-[9px] font-medium uppercase tracking-wide text-muted sticky top-0">
                  <span>Tier</span>
                  <span>Label</span>
                  <span>Class</span>
                  <span className="text-right">Pri</span>
                  <span className="text-right">Conf</span>
                </div>
                {sitemap.slots.map((s, i) => {
                  const classColor = s.audit_class === 'enhance' ? 'bg-[#dcfce7] text-[#15803d] border-[#16a34a]/40'
                    : s.audit_class === 'fix' ? 'bg-[#fef3c7] text-[#92400e] border-[#d97706]/40'
                    : 'bg-[#e0e7ff] text-[#3730a3] border-[#6366f1]/40'
                  return (
                    <div key={i} className="grid grid-cols-[24px_1fr_120px_60px_60px] gap-1 px-2 py-1 border-b border-[#f0f0f0] last:border-0 text-[10px] items-center">
                      <span className="font-mono">T{s.tier}</span>
                      <span className="truncate">
                        <span className="font-medium">{s.label}</span>
                        <div className="text-[8px] text-muted truncate">{s.slot_key} · /{s.target_url_slug}</div>
                      </span>
                      <span className={`text-[8px] py-0.5 px-1 rounded border font-mono justify-self-start ${classColor}`}>{s.audit_class}</span>
                      <span className="text-right text-[9px] font-mono">{s.priority?.toUpperCase()}</span>
                      <span className="text-right text-[9px] text-muted">{s.match_confidence || '—'}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </details>

      </div>
    </details>
  )
}

// link plan; operator picks which edges to merge into each source
// page's strategy_hint. Result is cached on tenants.last_internal_
// link_plan so reopening the wizard shows the matrix without
// re-running Claude. Collapsed by default — bulk feature, not
// per-edit workflow.
function InternalLinkPlanPanel({ slots }) {
  const [plan, setPlan] = useState(null)
  const [generatedAt, setGeneratedAt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [filterMode, setFilterMode] = useState('all') // all | not-applied | type-topical | type-authority | type-support
  const [filterTarget, setFilterTarget] = useState('') // landing_page_id (as string) or ''

  useEffect(() => {
    let cancelled = false
    api.getInternalLinkPlan().then(r => {
      if (cancelled) return
      setPlan(r?.plan || null)
      setGeneratedAt(r?.generated_at || null)
      // Seed selected with not-yet-applied edges so the operator's
      // most common action ("apply everything I haven't applied
      // yet") is one click away.
      const seedKeys = (r?.plan?.edges || [])
        .filter(e => !e.applied)
        .map(e => `${e.from_page_id}->${e.to_page_id}`)
      setSelected(new Set(seedKeys))
    }).catch(() => { /* 404 fine — never run yet */ })
    return () => { cancelled = true }
  }, [])

  // Page id → label/url lookup from the wizard's slot list. Some
  // pages may not be in the slot list (rare — manually imported
  // without a slot) so we fall back to "page #N" in the UI.
  const pageLookup = useMemo(() => {
    const m = new Map()
    for (const s of (slots || [])) {
      if (s.landing_page_id) {
        m.set(s.landing_page_id, { label: s.label, url: s.landing_page_url || null })
      }
    }
    return m
  }, [slots])

  const generate = async () => {
    if (busy) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      const r = await api.generateInternalLinkPlan()
      setPlan(r?.plan || null)
      setGeneratedAt(r?.generated_at || null)
      const seedKeys = (r?.plan?.edges || [])
        .filter(e => !e.applied)
        .map(e => `${e.from_page_id}->${e.to_page_id}`)
      setSelected(new Set(seedKeys))
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (key) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const visibleEdges = useMemo(() => {
    if (!plan) return []
    let edges = plan.edges || []
    if (filterMode === 'not-applied') edges = edges.filter(e => !e.applied)
    if (filterMode === 'type-topical') edges = edges.filter(e => e.link_type === 'topical')
    if (filterMode === 'type-authority') edges = edges.filter(e => e.link_type === 'authority')
    if (filterMode === 'type-support') edges = edges.filter(e => e.link_type === 'support')
    if (filterTarget) {
      const tid = Number(filterTarget)
      edges = edges.filter(e => e.to_page_id === tid || e.from_page_id === tid)
    }
    return edges
  }, [plan, filterMode, filterTarget])

  const selectAllVisible = () => {
    setSelected(new Set(visibleEdges.map(e => `${e.from_page_id}->${e.to_page_id}`)))
  }
  const selectNone = () => setSelected(new Set())

  const apply = async () => {
    if (applying) return
    if (selected.size === 0) { setError('Select at least one edge to apply.'); return }
    if (!confirm(
      `Apply ${selected.size} link edge(s) to the source pages' strategy hints?\n\n` +
      `For each affected SOURCE page, the selected links get merged into landing_pages.strategy_hint as an idempotent "## Suggested internal links" block. ` +
      `Every subsequent ✏️ Apply suggestions / ✨ Generate from scratch / 🎯 Re-propose call for that source page will see the link directives and weave them into the body.\n\n` +
      `Idempotent — re-applying replaces the prior block rather than stacking.\n\n` +
      `Continue?`
    )) return
    setApplying(true); setError(null); setSuccess(null)
    try {
      const r = await api.applyInternalLinkPlan(Array.from(selected))
      setSuccess(`Applied ${r.applied_edges} link(s) across ${r.updated_source_pages} source page(s). Re-generate a proposal on those pages to weave the links in.`)
      // Refresh plan so the "applied" flag reflects.
      const fresh = await api.getInternalLinkPlan().catch(() => null)
      if (fresh?.plan) {
        setPlan(fresh.plan)
        setGeneratedAt(fresh.generated_at)
      }
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setApplying(false)
    }
  }

  const totalEdges = (plan?.edges || []).length
  const appliedCount = (plan?.edges || []).filter(e => e.applied).length
  const linkTypeCounts = useMemo(() => {
    const c = { topical: 0, authority: 0, support: 0 }
    for (const e of plan?.edges || []) c[e.link_type] = (c[e.link_type] || 0) + 1
    return c
  }, [plan])

  return (
    <details className="border border-[#6C5CE7]/40 rounded bg-[#fafbff]">
      <summary className="cursor-pointer py-2 px-3 flex items-center gap-2">
        <span className="text-[11px] font-medium text-[#6C5CE7]">🔗 Internal-link plan</span>
        <span className="text-[9px] text-muted">
          ({plan ? `${totalEdges} edges, ${appliedCount} applied` : 'not generated yet'})
        </span>
        <span className="text-[9px] text-muted">
          — cross-page hub/spoke link orchestration. Single Claude call decides which managed page should link to which, with what anchor.
        </span>
        <span className="flex-1" />
      </summary>
      <div className="p-3 pt-0 space-y-2 text-[10px]">
        <div className="flex items-center gap-2">
          <button
            onClick={generate}
            disabled={busy || applying}
            className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
            title="One Claude Haiku call across ALL managed landing pages. Returns recommended incoming/outgoing links per page with anchor text + reason + link type (topical / authority / support). ~10-30s. Overwrites prior plan."
          >{busy ? 'Generating…' : (plan ? '🔁 Re-generate plan' : '🔍 Generate plan')}</button>
          {generatedAt && (
            <span className="text-[9px] text-muted">
              Last generated {new Date(generatedAt).toLocaleString()}
              {plan?.page_count ? ` over ${plan.page_count} pages` : ''}
            </span>
          )}
        </div>

        {error && <div className="text-[10px] text-[#c0392b] bg-[#fef2f2] border border-[#c0392b]/30 rounded p-2">⚠ {error}</div>}
        {success && <div className="text-[10px] text-[#15803d] bg-[#f0fdf4] border border-[#15803d]/30 rounded p-2">✓ {success}</div>}

        {!plan && !busy && !error && (
          <div className="text-[10px] text-muted italic">
            No plan yet. Click 🔍 Generate to have Claude propose a coherent hub/spoke link graph across the {(slots || []).filter(s => s.landing_page_id).length} managed page(s) in this sitemap. Then check the edges you want to apply — each one gets merged into the source page's strategy hint, and the next propose call for that page will weave the link in.
          </div>
        )}

        {plan && (
          <>
            <div className="text-[10px] bg-white border border-[#e5e5e5] rounded p-2 italic">{plan.summary}</div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[9px] text-muted">Filter:</span>
              <select
                value={filterMode}
                onChange={e => setFilterMode(e.target.value)}
                className="text-[9px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
              >
                <option value="all">All edges ({totalEdges})</option>
                <option value="not-applied">Not applied yet ({totalEdges - appliedCount})</option>
                <option value="type-topical">Topical ({linkTypeCounts.topical})</option>
                <option value="type-authority">Authority ({linkTypeCounts.authority})</option>
                <option value="type-support">Support ({linkTypeCounts.support})</option>
              </select>
              <select
                value={filterTarget}
                onChange={e => setFilterTarget(e.target.value)}
                className="text-[9px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white max-w-[260px]"
              >
                <option value="">— filter by page —</option>
                {Array.from(pageLookup.entries()).map(([id, p]) => (
                  <option key={id} value={id}>{p.label || `page #${id}`}</option>
                ))}
              </select>
              <span className="flex-1" />
              <button
                onClick={selectAllVisible}
                className="text-[9px] py-0.5 px-1.5 bg-white border border-[#e5e5e5] text-ink rounded cursor-pointer"
              >Select all visible</button>
              <button
                onClick={selectNone}
                className="text-[9px] py-0.5 px-1.5 bg-white border border-[#e5e5e5] text-ink rounded cursor-pointer"
              >Clear</button>
              <span className="text-[9px] text-muted">{selected.size} selected</span>
              <button
                onClick={apply}
                disabled={applying || selected.size === 0}
                className="text-[10px] py-1 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50"
                title="Merge each selected edge into the SOURCE page's strategy_hint as a '## Suggested internal links' block. Idempotent — replaces any prior block. The next propose call on those source pages will weave the links in."
              >{applying ? 'Applying…' : `✨ Apply ${selected.size > 0 ? selected.size + ' ' : ''}to hints`}</button>
            </div>

            <div className="bg-white border border-[#e5e5e5] rounded overflow-hidden">
              <div className="grid grid-cols-[24px_1fr_1fr_1fr_70px] gap-1 px-2 py-1 bg-[#fafafa] border-b border-[#e5e5e5] text-[9px] font-medium uppercase tracking-wide text-muted">
                <span></span>
                <span>From (source — gets the link)</span>
                <span>→ To (target — destination)</span>
                <span>Anchor + reason</span>
                <span className="text-right">Type</span>
              </div>
              {visibleEdges.length === 0 && (
                <div className="text-[9px] text-muted italic p-2">No edges match the current filter.</div>
              )}
              {visibleEdges.map(e => {
                const key = `${e.from_page_id}->${e.to_page_id}`
                const isSel = selected.has(key)
                const fromP = pageLookup.get(e.from_page_id) || { label: `page #${e.from_page_id}` }
                const toP = pageLookup.get(e.to_page_id) || { label: `page #${e.to_page_id}` }
                const typeColor = e.link_type === 'authority' ? 'bg-[#fef3c7] text-[#92400e] border-[#d97706]/40'
                  : e.link_type === 'support' ? 'bg-[#e0e7ff] text-[#3730a3] border-[#6366f1]/40'
                  : 'bg-[#dcfce7] text-[#15803d] border-[#16a34a]/40'
                return (
                  <div
                    key={key}
                    className={`grid grid-cols-[24px_1fr_1fr_1fr_70px] gap-1 px-2 py-1.5 border-b border-[#f0f0f0] last:border-0 ${e.applied ? 'bg-[#f0fdf4]' : ''}`}
                  >
                    <label className="cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggle(key)}
                      />
                    </label>
                    <div className="text-[10px] min-w-0">
                      <div className="font-medium truncate">{fromP.label}</div>
                      <div className="text-[8px] text-muted truncate">#{e.from_page_id}{fromP.url ? ` · ${fromP.url}` : ''}</div>
                    </div>
                    <div className="text-[10px] min-w-0">
                      <div className="font-medium truncate">{toP.label}</div>
                      <div className="text-[8px] text-muted truncate">#{e.to_page_id}{toP.url ? ` · ${toP.url}` : ''}</div>
                    </div>
                    <div className="text-[10px] min-w-0">
                      <div className="font-mono bg-[#fafafa] border border-[#e5e5e5] rounded px-1 py-0.5 inline-block max-w-full truncate">{e.anchor}</div>
                      <div className="text-[9px] text-muted mt-0.5">{e.reason}</div>
                    </div>
                    <div className="text-right">
                      <span className={`text-[8px] py-0.5 px-1 rounded border font-mono ${typeColor}`}>{e.link_type}</span>
                      {e.applied && <div className="text-[8px] text-[#15803d] mt-0.5">✓ applied</div>}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="text-[9px] text-muted italic">
              "Apply to hints" only updates strategy_hint on the SOURCE page. The link itself shows up in the body the NEXT time you run ✏️ Apply suggestions / ✨ Generate from scratch / 🎯 Re-propose on that page. For bulk re-propose, use the per-slot or fan-out actions.
            </div>
          </>
        )}
      </div>
    </details>
  )
}

function AnchorStatusPill({ status }) {
  const map = {
    ok: { tone: 'bg-[#dcfce7] text-[#15803d] border-[#16a34a]/40', label: 'ok' },
    failed: { tone: 'bg-[#fee2e2] text-[#991b1b] border-[#dc2626]/40', label: 'failed' },
    pending: { tone: 'bg-[#fef3c7] text-[#92400e] border-[#d97706]/40', label: 'pending' },
  }
  const m = map[status] || map.pending
  return <span className={`text-[8px] py-0.5 px-1 rounded border font-mono whitespace-nowrap ${m.tone}`}>{m.label}</span>
}

// Per-slot optimization checklist UI. Three components:
//
//   ChecklistDotRow      — tight inline row of 6 colored dots used
//                          beneath each slot row in the wizard grid.
//                          Compact; hover tooltip gives detail per
//                          dimension. Doesn't block layout.
//
//   ChecklistTotalsStrip — portfolio-level summary at the top of
//                          the wizard. Pass/warn/fail counts across
//                          all dimensions of all slots.
//
//   ChecklistCard        — full per-slot panel inside the SlotEditor.
//                          Shows each dimension with status, score
//                          (if relevant), and finding count.

const DIM_ORDER = ["seo", "aeo", "geo", "eeat", "schema", "faq"];
const DIM_LABEL = { seo: "SEO", aeo: "AEO", geo: "GEO", eeat: "E-E-A-T", schema: "Schema", faq: "FAQ" };

// Status → visual treatment. Aligned with audit panel color scheme
// elsewhere in the app: green for pass, amber for warn, red for fail,
// gray for unchecked, very faded gray for n/a (not relevant).
const STATUS_STYLE = {
  pass:      { dot: "bg-[#16a34a]",            text: "text-[#15803d]", label: "✓" },
  warn:      { dot: "bg-[#d97706]",            text: "text-[#92400e]", label: "⚠" },
  fail:      { dot: "bg-[#dc2626]",            text: "text-[#991b1b]", label: "✗" },
  unchecked: { dot: "bg-[#d4d4d8]",            text: "text-muted",     label: "○" },
  "n/a":     { dot: "bg-transparent border border-[#e5e5e5]", text: "text-muted/60", label: "—" },
};

function dimTooltip(dim, d) {
  const dimLabel = DIM_LABEL[dim] || dim;
  if (d.status === "n/a") return `${dimLabel}: not relevant for this slot`;
  if (d.status === "unchecked") {
    if (dim === "schema") return `${dimLabel}: no schema detected yet`;
    if (dim === "faq") return `${dimLabel}: no FAQ detected yet`;
    return `${dimLabel}: not audited yet — run audit on this page`;
  }
  const parts = [`${dimLabel}: ${d.status}`];
  if (typeof d.score === "number") parts.push(`score ${d.score}/100`);
  if (typeof d.finding_count === "number" && d.finding_count > 0) parts.push(`${d.finding_count} finding${d.finding_count === 1 ? "" : "s"}`);
  if (dim === "schema" && typeof d.count === "number") parts.push(`${d.count} schema block${d.count === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function ChecklistDotRow({ checklist }) {
  if (!checklist?.dimensions) return null;
  return (
    <div className="flex items-center gap-1 pl-[2px]" title="Click to open slot for full optimization status">
      {DIM_ORDER.map(dim => {
        const d = checklist.dimensions[dim];
        if (!d) return null;
        const style = STATUS_STYLE[d.status] || STATUS_STYLE.unchecked;
        return (
          <span
            key={dim}
            title={dimTooltip(dim, d)}
            className="flex items-center gap-0.5"
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${style.dot}`} />
            <span className="text-[7px] text-muted uppercase tracking-wide">{DIM_LABEL[dim]}</span>
          </span>
        );
      })}
    </div>
  );
}

function ChecklistTotalsStrip({ totals }) {
  const total = (totals.pass || 0) + (totals.warn || 0) + (totals.fail || 0) + (totals.unchecked || 0);
  if (total === 0) return null;
  return (
    <div className="flex items-center gap-3 text-[10px] bg-[#fafafa] border border-[#e5e5e5] rounded px-3 py-1.5">
      <span className="text-[9px] uppercase tracking-wide text-muted font-medium">Portfolio optimization</span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-2 h-2 rounded-full bg-[#16a34a]" />
        <span className="font-medium">{totals.pass || 0}</span>
        <span className="text-muted">pass</span>
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-2 h-2 rounded-full bg-[#d97706]" />
        <span className="font-medium">{totals.warn || 0}</span>
        <span className="text-muted">warn</span>
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-2 h-2 rounded-full bg-[#dc2626]" />
        <span className="font-medium">{totals.fail || 0}</span>
        <span className="text-muted">fail</span>
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-2 h-2 rounded-full bg-[#d4d4d8]" />
        <span className="font-medium">{totals.unchecked || 0}</span>
        <span className="text-muted">unchecked</span>
      </span>
      {totals.na > 0 && (
        <span className="flex items-center gap-1 text-muted/70">
          <span className="font-medium">{totals.na}</span>
          <span>n/a</span>
        </span>
      )}
      <span className="flex-1" />
      <span className="text-[9px] text-muted">across {DIM_ORDER.length} dimensions × all slots</span>
    </div>
  )
}

function ChecklistCard({ checklist }) {
  if (!checklist?.dimensions) return null;
  if (!checklist.has_landing_page) {
    return (
      <div className="bg-[#fafafa] border border-[#e5e5e5] rounded p-2 text-[10px] text-muted italic">
        Optimization checklist appears once this slot has a landing page (Create WP draft, or link an existing imported page).
      </div>
    );
  }
  return (
    <div className="bg-[#fafafa] border border-[#e5e5e5] rounded p-2 space-y-1">
      <div className="text-[10px] font-medium">📋 Optimization checklist</div>
      <div className="grid grid-cols-3 gap-1">
        {DIM_ORDER.map(dim => {
          const d = checklist.dimensions[dim];
          if (!d) return null;
          const style = STATUS_STYLE[d.status] || STATUS_STYLE.unchecked;
          const isRelevant = d.relevant !== false;
          return (
            <div
              key={dim}
              className={`flex items-center gap-1.5 text-[10px] px-1.5 py-1 rounded border ${isRelevant ? 'bg-white border-[#e5e5e5]' : 'bg-transparent border-transparent'}`}
              title={dimTooltip(dim, d)}
            >
              <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
              <span className={`font-medium ${!isRelevant ? 'text-muted/60' : ''}`}>{DIM_LABEL[dim]}</span>
              {typeof d.score === "number" && (
                <span className="text-[9px] text-muted ml-auto">{d.score}</span>
              )}
              {dim === "schema" && typeof d.count === "number" && d.count > 0 && (
                <span className="text-[9px] text-muted ml-auto">{d.count}</span>
              )}
              {d.status === "n/a" && (
                <span className="text-[8px] text-muted/60 ml-auto italic">n/a</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="text-[8px] text-muted">
        SEO + Schema always shown · AEO/GEO/E-E-A-T/FAQ shown when relevance heuristics match (URL, label, page hint signals). Score from latest audit; run audit to refresh.
      </div>
    </div>
  );
}

// Danger zone — irreversible reset of all sitemap data for the
// current tenant. Hidden in a collapsed <details> at the bottom
// of the wizard. Click expands, shows what'll be deleted, requires
// typing the tenant slug to confirm.
function DangerZone({ onReset }) {
  const slug = api.tenantSlug ? api.tenantSlug() : ''
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [alsoClearBrief, setAlsoClearBrief] = useState(false)
  const [alsoClearVoiceAnchors, setAlsoClearVoiceAnchors] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [lastResult, setLastResult] = useState(null)

  const canConfirm = typed.trim() === slug && !busy

  const submit = async () => {
    if (!canConfirm) return
    if (!confirm(`This will permanently delete all sitemap data for "${slug}". Continue?`)) return
    setBusy(true); setErr(null); setLastResult(null)
    try {
      const r = await api.resetSitemapData({
        confirm_slug: slug,
        also_clear_brief: alsoClearBrief,
        also_clear_voice_anchors: alsoClearVoiceAnchors,
      })
      setLastResult(r)
      setTyped('')
      setAlsoClearBrief(false)
      setAlsoClearVoiceAnchors(false)
      if (typeof onReset === 'function') await onReset()
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className="border border-[#dc2626]/30 rounded bg-[#fef2f2]">
      <summary className="cursor-pointer py-2 px-3 flex items-center gap-2">
        <span className="text-[11px] font-semibold text-[#991b1b]">⚠ Danger zone</span>
        <span className="text-[9px] text-[#c0392b]">Reset all sitemap data for this tenant — irreversible</span>
        <span className="flex-1" />
        <span className="text-[10px] text-muted">{open ? '▾' : '▸'}</span>
      </summary>
      {open && (
        <div className="p-3 pt-0 space-y-2 text-[10px]">
          <div className="text-[#991b1b]">
            Clicking <b>Reset sitemap data</b> permanently deletes the following for tenant <code>{slug}</code>:
          </div>
          <ul className="list-disc pl-5 text-[10px] text-ink space-y-0.5">
            <li>All sitemap slots (<code>landing_page_plan</code>) + tier metadata</li>
            <li>All landing pages created via the wizard + their versions, audits, images, AI citations</li>
            <li>All competitor page scrapes + gap analyses for this tenant</li>
            <li>All auto-populated keywords (<code>tenant_keywords</code>)</li>
          </ul>
          <div className="text-[10px] text-muted">
            <b>Preserved</b>: tenant credentials (wp_*, target_url, etc.), <code>editorial_policy</code>, <code>partner_domains</code>, manually-imported landing pages NOT linked to any slot.
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={alsoClearBrief} onChange={e => setAlsoClearBrief(e.target.checked)} />
            <span>Also clear the saved 📋 Sitemap strategy brief (tenants.site_index_hint)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={alsoClearVoiceAnchors} onChange={e => setAlsoClearVoiceAnchors(e.target.checked)} />
            <span>Also delete 🎙️ Voice anchor pages (operator-curated voice references)</span>
          </label>
          <div className="pt-1 border-t border-[#dc2626]/20 space-y-1.5">
            <label className="block">
              <span className="text-[10px]">Type the tenant slug <code>{slug}</code> to confirm:</span>
              <input
                type="text"
                value={typed}
                onChange={e => setTyped(e.target.value)}
                placeholder={slug}
                className="block w-full text-[10px] font-mono border border-[#dc2626]/40 rounded p-1.5 mt-1 bg-white"
                autoComplete="off"
              />
            </label>
            <button
              onClick={submit}
              disabled={!canConfirm}
              className="text-[10px] py-1 px-2 bg-[#dc2626] text-white border-none rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >{busy ? 'Deleting…' : '🗑 Reset sitemap data'}</button>
          </div>
          {err && <div className="text-[#c0392b]">⚠ {err}</div>}
          {lastResult && (
            <div className="bg-[#f0fdf4] border border-[#16a34a]/30 rounded p-2 text-[#15803d]">
              <div className="font-medium">✓ Reset complete</div>
              <div className="text-[9px] text-muted mt-1">
                Deleted: {Object.entries(lastResult.deleted || {}).filter(([, v]) => v && v !== 0).map(([k, v]) => `${k}=${v}`).join(', ') || 'nothing (was already empty)'}
              </div>
            </div>
          )}
        </div>
      )}
    </details>
  )
}

function StatusPill({ status }) {
  const tone = status === 'live' ? 'bg-[#dcfce7] text-[#15803d] border-[#16a34a]/40'
    : status === 'draft' ? 'bg-[#fef9c3] text-[#854d0e] border-[#ca8a04]/40'
    : 'bg-[#f0f0f0] text-muted border-[#d4d4d8]'
  const label = status === 'live' ? '● live'
    : status === 'draft' ? '◐ draft'
    : '○ planned'
  return (
    <span className={`text-[9px] py-0.5 px-1.5 rounded border ${tone} font-mono whitespace-nowrap`}>
      {label}
    </span>
  )
}

function SlotEditor({ slot, tiers, checklist, onSaved, onCancel, onDeleted, onCreatedWp, platform = 'wordpress', tenantTargetUrl = null }) {
  const isEcommerce = platform === 'ecommerce'
  const isNew = !slot
  const [label, setLabel] = useState(slot?.label || '')
  const [slotKey, setSlotKey] = useState(slot?.slot_key || '')
  const [tier, setTier] = useState(slot?.tier || 1)
  const [templateKind, setTemplateKind] = useState(slot?.template_kind || '')
  const [rationale, setRationale] = useState(slot?.rationale || '')
  const [extraHint, setExtraHint] = useState(slot?.extra_strategy_hint || '')
  // URL slug — surfaced as a top-level field so operators can fix
  // generic brief-generated slugs (e.g. /birthday-parties) into
  // long-tail SEO-friendly ones (/kids-birthday-party-venues-menomonee-falls)
  // without diving into the Template variables JSON pane.
  // Persisted inside template_variables.url_slug — we merge on save.
  const [urlSlug, setUrlSlug] = useState(
    (slot?.template_variables?.url_slug || '').toString()
  )
  const [varsRaw, setVarsRaw] = useState(
    slot?.template_variables ? JSON.stringify(slot.template_variables, null, 2) : '{}'
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState(null)

  // Per-action busy / message state for create-wp + delete actions.
  const [creatingWp, setCreatingWp] = useState(false)
  // Generate Schema action (page-level, runs on the latest version).
  const [genSchemaBusy, setGenSchemaBusy] = useState(false)
  const [genSchemaMsg, setGenSchemaMsg] = useState(null)
  const [createResult, setCreateResult] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Track whether the slot's landing_page has schema_types selected
  // + at least one image. Used to nag the operator before they
  // navigate away or commit a save without configuring these
  // important inputs. We refetch fresh inside checkConfigGate()
  // right before the prompt so a config change made via the
  // SchemaSuggesterPanel or LandingImagesPanel below shows up
  // immediately without needing to wire change callbacks back up.
  // hasConfig() returns { hasSchema, hasImage, missing[] } where
  // missing is the list shown in the confirm dialog.
  const hasConfig = async () => {
    if (!slot?.landing_page_id) {
      // Pre-WP slots can't have schema/images yet — nothing to gate.
      return { hasSchema: true, hasImage: true, missing: [] }
    }
    const [schemaResp, imagesResp] = await Promise.all([
      api.getLandingPageSchemaTypes(slot.landing_page_id).catch(() => null),
      api.listLandingImages(slot.landing_page_id).catch(() => null),
    ])
    const types = Array.isArray(schemaResp?.schema_types) ? schemaResp.schema_types : []
    const images = Array.isArray(imagesResp?.images) ? imagesResp.images : []
    const hasSchema = types.length > 0
    const hasImage = images.length > 0
    const missing = []
    if (!hasSchema) missing.push('schema types (allowlist)')
    if (!hasImage) missing.push('images (at least one)')
    return { hasSchema, hasImage, missing }
  }

  // Returns true if the operator chose to proceed anyway (or
  // there's nothing missing); false if they cancelled. The action
  // label appears in the prompt so the operator knows what they're
  // about to do.
  const checkConfigGate = async (actionLabel) => {
    const { missing } = await hasConfig()
    if (missing.length === 0) return true
    const lines = [
      `Heads-up: this slot is missing important configuration before "${actionLabel}":`,
      '',
      ...missing.map(m => `  • ${m}`),
      '',
      'These inputs shape the schema generator + propose body + deploy output. Skipping them now means the next generation runs without that guidance and you may need to redo work later.',
      '',
      'Click OK to continue anyway, or Cancel to go back and configure these first.',
    ]
    return confirm(lines.join('\n'))
  }

  const save = async () => {
    if (saving) return
    // Gate Save on planned-or-better slots that have a landing_page
    // attached but no schema / images configured yet. The prompt is
    // dismissible — operator can still save and come back to set
    // these later — but the friction stops "click Save and forget"
    // from quietly skipping these inputs.
    if (slot?.landing_page_id) {
      const proceed = await checkConfigGate('save this slot')
      if (!proceed) return
    }
    setSaving(true); setErr(null); setSaved(false)
    try {
      let parsedVars = {}
      try {
        parsedVars = JSON.parse(varsRaw || '{}')
      } catch {
        throw new Error('template_variables is not valid JSON')
      }
      // Slug normalization: strip leading slash, lowercase, strip
      // trailing slash. Merge into parsedVars so the persisted JSON
      // stays authoritative for the BE — but with the operator-edited
      // top-level field winning when both are touched.
      const cleanSlug = (urlSlug || '').toString().trim()
        .replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase()
      if (cleanSlug) {
        parsedVars.url_slug = cleanSlug
        // Re-sync the visible JSON so the Template variables pane
        // shows the latest url_slug even if the operator didn't open it.
        setVarsRaw(JSON.stringify(parsedVars, null, 2))
      } else if (parsedVars.url_slug) {
        // Operator cleared the field — remove from JSON too.
        delete parsedVars.url_slug
        setVarsRaw(JSON.stringify(parsedVars, null, 2))
      }
      if (isNew) {
        if (!slotKey.trim()) throw new Error('slot_key required for new slot')
        if (!label.trim()) throw new Error('label required')
        await api.upsertSitemapSlot({
          slot_key: slotKey.trim(),
          label: label.trim(),
          tier: Number(tier) || 1,
          template_kind: templateKind.trim() || null,
          rationale: rationale.trim() || null,
          extra_strategy_hint: extraHint.trim() || null,
          template_variables: parsedVars,
        })
      } else {
        await api.updateSitemapSlot(slot.id, {
          label: label.trim(),
          tier: Number(tier) || 1,
          template_kind: templateKind.trim() || null,
          rationale: rationale.trim() || null,
          extra_strategy_hint: extraHint.trim() || null,
          template_variables: parsedVars,
        })
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      if (typeof onSaved === 'function') await onSaved()
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const createWp = async () => {
    if (creatingWp || isNew) return
    if (!confirm(`Create a WordPress draft page for "${label}" now?\n\nThis will POST to WP and create a draft post + landing_page row + initial imported version. The slot will move from 'planned' to 'draft'.`)) return
    setCreatingWp(true); setErr(null); setCreateResult(null)
    try {
      const r = await api.createWpPageForSlot(slot.id)
      setCreateResult(r)
      if (typeof onCreatedWp === 'function') await onCreatedWp()
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setCreatingWp(false)
    }
  }

  // Combo: scaffold the WP draft AND kick off Propose in one click.
  // Returns immediately with the new landing_page_id; the propose
  // call runs in the background (~60-90s). Operator can then jump
  // to the Pages workspace to watch it complete.
  const createWpAndPropose = async () => {
    if (creatingWp || isNew) return
    const intro = isEcommerce
      ? `Create page record AND generate content for "${label}" in one click?\n\nEcommerce mode — NO WordPress draft is created. Instead:\n  1. A landing_page row is created with canonical URL = ${tenantTargetUrl || '(tenant.target_url)'} + slug.\n  2. Propose runs (two-phase: initial → AI self-review → revise).\n  3. Open the Pages workspace + use the Square packet to copy content into your live site.\n\nReady in ~60-90s. Uses the slot's strategy hint + voice anchors + competitive gap analysis + editorial policy.`
      : `Create WP draft AND generate content for "${label}" in one click?\n\nThis scaffolds the WP draft + immediately kicks off Propose (two-phase generation: initial draft → AI self-review → revise). The page will go from 'planned' to 'draft' with real content in ~60-90s. You can switch to the Pages workspace to watch it complete.\n\nUses the slot's strategy hint + voice anchors + competitive gap analysis + editorial policy.`
    if (!confirm(intro)) return
    setCreatingWp(true); setErr(null); setCreateResult(null)
    try {
      const r = await api.createAndProposeForSlot(slot.id)
      setCreateResult({ ...r, combo: true })
      if (typeof onCreatedWp === 'function') await onCreatedWp()
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setCreatingWp(false)
    }
  }

  const remove = async () => {
    if (deleting || isNew) return
    if (!confirm(`Soft-delete slot "${slot.label}"?\n\nThe row stays in the database (audit trail) but disappears from the wizard. Re-creating a slot with the same slot_key will restore it.`)) return
    setDeleting(true); setErr(null)
    try {
      await api.deleteSitemapSlot(slot.id)
      if (typeof onDeleted === 'function') await onDeleted()
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="bg-white border border-[#e5e5e5] rounded p-3 space-y-2 text-[10px]">
      <div className="flex items-center gap-2">
        <div className="font-medium text-[11px] flex-1">
          {isNew ? '+ New slot' : `Editing: ${slot.label}`}
        </div>
        {!isNew && <StatusPill status={slot.status} />}
        {!isNew && slot.landing_page_url && (
          <a
            href={slot.landing_page_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] text-[#6C5CE7] underline"
            title="Open the live WP page in a new tab"
          >↗ live page</a>
        )}
      </div>

      {!isNew && checklist && <ChecklistCard checklist={checklist} />}

      <div>
        <label className="block text-muted mb-0.5">Slot key {isNew && <span className="text-[#c0392b]">*</span>}</label>
        <input
          type="text"
          value={slotKey}
          onChange={e => setSlotKey(e.target.value)}
          disabled={!isNew}
          className="w-full text-[10px] border border-[#e5e5e5] rounded p-1.5 bg-white disabled:bg-[#fafafa] disabled:text-muted font-mono"
          placeholder="e.g. service_ai_smb"
        />
        {isNew && <div className="text-[8px] text-muted mt-0.5">Stable identifier. Snake_case. Used to detect dupes when reseeding.</div>}
      </div>

      <div>
        <label className="block text-muted mb-0.5">Label {isNew && <span className="text-[#c0392b]">*</span>}</label>
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white"
          placeholder="e.g. /services/ai/ or 'AI for Small Business'"
        />
      </div>

      <div>
        <label className="block text-muted mb-0.5">URL slug</label>
        <input
          type="text"
          value={urlSlug}
          onChange={e => setUrlSlug(e.target.value)}
          className="w-full text-[10px] font-mono border border-[#e5e5e5] rounded p-1.5 bg-white"
          placeholder="kids-birthday-party-venues-menomonee-falls"
        />
        <div className="text-[8px] text-muted mt-0.5">
          Long-tail beats generic. <code>/kids-birthday-party-venues-menomonee-falls</code> outranks <code>/birthday-parties</code>. Include buyer intent + service + geographic modifier when each word earns the click. No leading slash; lowercase-dashed.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-muted mb-0.5">Tier</label>
          <select
            value={String(tier)}
            onChange={e => setTier(Number(e.target.value))}
            className="w-full text-[10px] border border-[#e5e5e5] rounded p-1.5 bg-white"
          >
            {tiers.map(t => (
              <option key={t.tier} value={String(t.tier)}>{t.label || `Tier ${t.tier}`}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-muted mb-0.5">Template kind</label>
          <input
            type="text"
            value={templateKind}
            onChange={e => setTemplateKind(e.target.value)}
            className="w-full text-[10px] border border-[#e5e5e5] rounded p-1.5 bg-white font-mono"
            placeholder="e.g. service_page — or leave empty for freeform (placeholder body, propose fills it in)"
          />
        </div>
      </div>

      <div>
        <label className="block text-muted mb-0.5">Why this page exists (rationale)</label>
        <textarea
          value={rationale}
          onChange={e => setRationale(e.target.value)}
          rows={2}
          className="w-full text-[10px] border border-[#e5e5e5] rounded p-1.5 bg-white resize-y"
          placeholder="Operator-readable rationale — why this slot is in the plan. Surfaces in the slot list to help future-you understand the strategy."
        />
      </div>

      <div>
        <label className="block text-muted mb-0.5">Page hint (strategy)</label>
        <textarea
          value={extraHint}
          onChange={e => setExtraHint(e.target.value)}
          rows={4}
          className="w-full text-[10px] border border-[#e5e5e5] rounded p-1.5 bg-white resize-y"
          placeholder="Per-slot strategy hint applied at scaffold time. Becomes the seed for landing_pages.strategy_hint when the WP page is created. Examples: 'rank for AI consulting Milwaukee', 'voice: senior, plain-language, no jargon', 'must mention 5 case studies'."
        />
        <div className="text-[8px] text-muted mt-0.5">
          Same canonical field as the Pages workspace's "🎯 Page hint" — edits here are mirrored to the linked page (and vice versa). AI-revision blocks (gap analysis, link plan) append to this same hint. Pre-WP slots store this on the slot row as a seed; once the WP page exists, edits flow through to <code>landing_pages.strategy_hint</code>.
        </div>

        {/* Divergence card — only renders when the linked page's
            strategy_hint differs from this slot's. Operator can
            explicitly load the page hint here OR merge both. */}
        {!isNew && slot?.landing_page_id && (slot.landing_page_strategy_hint || '').trim() !== (extraHint || '').trim() && (slot.landing_page_strategy_hint || '').trim().length > 0 && (
          <details className="mt-2 bg-white border border-[#6C5CE7]/40 rounded">
            <summary className="cursor-pointer py-1.5 px-2 text-[10px] flex items-center gap-2">
              <span className="font-medium text-[#6C5CE7]">📋 Linked page hint differs</span>
              <span className="text-[8px] text-muted">
                ({(slot.landing_page_strategy_hint || '').length} chars on page · {(extraHint || '').length} chars here)
              </span>
              <span className="flex-1" />
              <span className="text-[8px] text-[#6C5CE7]">click to compare + copy →</span>
            </summary>
            <div className="p-2 space-y-1.5 border-t border-[#6C5CE7]/20">
              <div className="text-[8px] text-muted italic">
                The linked landing_page has a different page hint than this slot. AI-revision blocks (gap analysis, link plan applies) get appended on the PAGE side. Use one of the buttons below if you want to bring page content over.
              </div>
              <div className="bg-[#fafafa] border border-[#e5e5e5] rounded p-1.5 max-h-[180px] overflow-auto">
                <div className="text-[8px] uppercase font-medium text-muted mb-1">Page hint (read-only):</div>
                <pre className="whitespace-pre-wrap text-[10px] font-sans">{slot.landing_page_strategy_hint || '(empty)'}</pre>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    if (!confirm('Replace the slot hint textarea with the page\'s hint? Unsaved edits will be lost. Click Save afterwards to commit.')) return
                    setExtraHint(slot.landing_page_strategy_hint || '')
                  }}
                  className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer"
                >📥 Load page hint here</button>
                <button
                  onClick={() => {
                    const merged = `${(slot.landing_page_strategy_hint || '').trim()}\n\n${(extraHint || '').trim()}`.trim()
                    setExtraHint(merged)
                  }}
                  className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer"
                >⇄ Merge page + slot</button>
              </div>
            </div>
          </details>
        )}
      </div>

      {!isNew && slot?.id && (
        <CompetitorBlock
          slotId={slot.id}
          initialUrl={slot.competitor_url || ''}
          onHintMerged={(newHint) => setExtraHint(newHint)}
        />
      )}

      {!isNew && slot?.landing_page_id && (
        <SchemaSuggesterPanel landingPageId={slot.landing_page_id} />
      )}

      {!isNew && slot?.landing_page_id && (
        <LandingImagesPanel landingPageId={slot.landing_page_id} />
      )}

      <details>
        <summary className="cursor-pointer text-muted">Template variables (JSON)</summary>
        <textarea
          value={varsRaw}
          onChange={e => setVarsRaw(e.target.value)}
          rows={5}
          className="w-full text-[9px] font-mono border border-[#e5e5e5] rounded p-1.5 bg-[#fafafa] resize-y mt-1"
          placeholder='{ "service_short": "AI", "audience_short": "SMB" }'
        />
        <div className="text-[8px] text-muted mt-0.5">Substituted into the template's title / slug / body / strategy_hint at scaffold time.</div>
      </details>

      {err && <div className="text-[#c0392b]">⚠ {err}</div>}
      {createResult && (
        <div className="bg-[#f0fdf4] border border-[#16a34a]/30 rounded p-2 text-[#15803d]">
          ✓ Created WP page #{createResult.wp_post_id} (landing #{createResult.landing_page_id}).
          {createResult.wp_link && <> <a href={createResult.wp_link} target="_blank" rel="noopener noreferrer" className="underline">Open ↗</a></>}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1 border-t border-[#e5e5e5]">
        <button
          onClick={save}
          disabled={saving}
          className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
        >{saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}</button>

        {isNew ? (
          <button
            onClick={onCancel}
            className="text-[10px] py-1 px-2 bg-white border border-[#e5e5e5] text-muted rounded cursor-pointer"
          >Cancel</button>
        ) : (
          <>
            {slot.status === 'planned' && (
              <>
                <button
                  onClick={createWpAndPropose}
                  disabled={creatingWp}
                  className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
                  title={isEcommerce
                    ? `Ecommerce mode — creates a landing_page row (URL = ${tenantTargetUrl || 'tenant.target_url'} + slug) + runs Propose. NO WordPress draft is created. Use the Square packet to copy content into your live site.`
                    : "One-click: scaffold WP draft + immediately generate real content via Propose (two-phase: initial → AI self-review → revise). Uses the slot's strategy hint + voice anchors + competitive gap analysis + editorial policy. Ready in ~60-90s."
                  }
                >{creatingWp ? 'Working…' : (isEcommerce ? '✨ Create page + Generate content' : '✨ Create + Generate content')}</button>
                <button
                  onClick={createWp}
                  disabled={creatingWp}
                  className="text-[10px] py-1 px-2 bg-white border border-[#2D9A5E] text-[#2D9A5E] rounded cursor-pointer disabled:opacity-50"
                  title={isEcommerce
                    ? "Ecommerce mode — creates the landing_page row with a placeholder body (no WP draft). Run Propose later from the Pages workspace."
                    : "Scaffold only — WP draft with placeholder body, no content generation. Use when you want to manually run Propose on the Pages workspace later (e.g. after editing the hint or images first)."
                  }
                >{creatingWp ? '…' : (isEcommerce ? '🚀 Create page only' : '🚀 Create WP draft only')}</button>
              </>
            )}
            {slot.landing_page_id && (
              <>
                <button
                  onClick={async () => {
                    if (genSchemaBusy) return
                    setGenSchemaBusy(true); setGenSchemaMsg(null)
                    try {
                      const r = await api.generateLandingPageSchemaLatest(slot.landing_page_id)
                      const n = Array.isArray(r?.blocks) ? r.blocks.length : 0
                      setGenSchemaMsg({ tone: 'ok', text: `✓ ${n} schema block${n === 1 ? '' : 's'} generated` })
                    } catch (e) {
                      setGenSchemaMsg({ tone: 'err', text: e?.message || String(e) })
                    } finally {
                      setGenSchemaBusy(false)
                    }
                  }}
                  disabled={genSchemaBusy}
                  className="text-[10px] py-1 px-2 bg-white border border-[#9333ea] text-[#9333ea] rounded cursor-pointer disabled:opacity-50"
                  title="Runs the Schema.org JSON-LD generator on the latest version. Saves blocks to the version row; the Square packet (ecommerce) or Yoast/deploy path (WP) reads from there. Includes vocab validation + bidirectional-relationship normalization."
                >{genSchemaBusy ? 'Generating…' : '🏷️ Generate schema'}</button>
                <button
                  onClick={async () => {
                    // Same gate as Save — schema + images on the linked
                    // landing_page should be configured BEFORE jumping
                    // into the per-page workspace where it's tempting to
                    // start editing content without these inputs in
                    // place. Operator can still proceed (the prompt is
                    // not blocking) but the friction prevents quietly
                    // skipping these.
                    const proceed = await checkConfigGate('open this slot in the Pages workspace')
                    if (!proceed) return
                    window.location.href = `/content-studio?go=landing&id=${slot.landing_page_id}`
                  }}
                  className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer"
                  title="Jump to the per-page workspace for this slot's landing page. Prompts first if schema types or images aren't configured yet — these inputs shape every propose call."
                >Open in Pages →</button>
              </>
            )}
            <div className="flex-1" />
            <button
              onClick={remove}
              disabled={deleting}
              className="text-[10px] py-1 px-2 bg-white border border-[#c0392b] text-[#c0392b] rounded cursor-pointer disabled:opacity-50"
            >{deleting ? 'Deleting…' : '🗑 Delete slot'}</button>
          </>
        )}
      </div>
      {genSchemaMsg && (
        <div className={`text-[10px] mt-1 ${genSchemaMsg.tone === 'ok' ? 'text-[#16a34a]' : 'text-[#c0392b]'}`}>
          {genSchemaMsg.text}
        </div>
      )}
    </div>
  )
}

// Per-slot competitor tracking: paste competitor URL, click Import
// to Playwright-scrape their page, click Run gap analysis for a
// 5-dim SEO/E-E-A-T/GEO/AEO/content comparison via Claude Haiku,
// then click Apply to hint to weave the findings into this slot's
// page_hint so every future propose call factors in what the
// competitor does better.
//
// Auto-loads the slot's existing competitor data on mount so the
// operator sees state on slot switch without an extra click.
function CompetitorBlock({ slotId, initialUrl, onHintMerged }) {
  const [url, setUrl] = useState(initialUrl || '')
  const [savedUrl, setSavedUrl] = useState(initialUrl || '')
  const [competitor, setCompetitor] = useState(null) // { url, title, body_excerpt, headings_meta, last_fetched_at, audit_result, ... }
  const [savingUrl, setSavingUrl] = useState(false)
  const [importing, setImporting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)

  // Load existing competitor data on mount / slot change.
  useEffect(() => {
    let cancelled = false
    api.getSlotCompetitor(slotId).then(r => {
      if (cancelled) return
      setCompetitor(r?.competitor || null)
      const savedFromServer = r?.slot?.competitor_url || ''
      setSavedUrl(savedFromServer)
      setUrl(savedFromServer)
    }).catch(() => { /* non-fatal; treat as no competitor */ })
    return () => { cancelled = true }
  }, [slotId])

  const isDirty = url.trim() !== savedUrl.trim()

  const flashMsg = (m) => { setMsg(m); setTimeout(() => setMsg(null), 3000) }

  const saveUrl = async () => {
    if (savingUrl) return
    setSavingUrl(true); setErr(null)
    try {
      await api.updateSitemapSlot(slotId, { competitor_url: url.trim() || null })
      setSavedUrl(url.trim())
      flashMsg('URL saved')
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setSavingUrl(false)
    }
  }

  const runImport = async () => {
    if (importing) return
    setImporting(true); setErr(null)
    try {
      const r = await api.importSlotCompetitor(slotId, { url: url.trim() })
      setCompetitor(c => ({ ...c, ...r.competitor }))
      setSavedUrl(url.trim()) // server saved it too if it differed
      flashMsg('Imported')
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setImporting(false)
    }
  }

  const runAnalysis = async () => {
    if (analyzing) return
    setAnalyzing(true); setErr(null)
    try {
      const r = await api.runSlotGapAnalysis(slotId)
      setCompetitor(c => ({ ...(c || {}), audit_result: r.findings }))
      flashMsg('Gap analysis complete')
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setAnalyzing(false)
    }
  }

  const applyToHint = async () => {
    if (applying) return
    if (!confirm('Merge the gap-analysis findings into this slot\'s page hint? Re-applying replaces any previous gap-analysis block.')) return
    setApplying(true); setErr(null)
    try {
      const r = await api.applyGapToHint(slotId)
      if (typeof onHintMerged === 'function' && r?.extra_strategy_hint) {
        onHintMerged(r.extra_strategy_hint)
      }
      flashMsg(r?.also_updated_landing_page
        ? 'Applied — slot hint + linked landing_page hint updated'
        : 'Applied to slot hint')
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setApplying(false)
    }
  }

  const findings = competitor?.audit_result || null
  const lastFetched = competitor?.last_fetched_at
    ? new Date(competitor.last_fetched_at).toLocaleString()
    : null

  return (
    <div className="border border-[#e5e5e5] rounded bg-[#fafafa] p-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium">⚔️ Competitor benchmark</span>
        <span className="text-[9px] text-muted">Track ONE competitor page for this slot. Import it, gap-analyze, fold the findings into the page hint.</span>
      </div>

      <div className="flex items-center gap-1">
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://competitor.com/their-equivalent-page"
          className="flex-1 min-w-0 text-[10px] border border-[#e5e5e5] rounded p-1.5 bg-white font-mono"
        />
        {savedUrl && (
          <a
            href={savedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded no-underline flex-shrink-0"
            title="Open competitor page in a new tab"
          >↗ Open</a>
        )}
        {isDirty && (
          <button
            onClick={saveUrl}
            disabled={savingUrl}
            className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 flex-shrink-0"
          >{savingUrl ? 'Saving…' : 'Save URL'}</button>
        )}
        <button
          onClick={runImport}
          disabled={importing || !url.trim()}
          className="text-[10px] py-1 px-2 bg-[#16a34a] text-white border-none rounded cursor-pointer disabled:opacity-50 flex-shrink-0"
          title="Playwright-scrape the competitor page and store its content for gap analysis"
        >{importing ? 'Importing…' : (competitor ? '🔄 Re-import' : '📥 Import')}</button>
      </div>

      {competitor && competitor.fetch_status === 'ok' && (
        <div className="bg-white border border-[#e5e5e5] rounded p-2 space-y-1 text-[10px]">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate flex-1 min-w-0" title={competitor.title || ''}>{competitor.title || '(no title)'}</span>
            <span className="text-[8px] text-muted flex-shrink-0">{lastFetched}</span>
          </div>
          {competitor.meta_description && (
            <div className="text-[9px] text-muted">{competitor.meta_description}</div>
          )}
          {Array.isArray(competitor.headings_meta) && competitor.headings_meta.length > 0 && (
            <div className="text-[9px] text-muted">
              {competitor.headings_meta.length} heading{competitor.headings_meta.length === 1 ? '' : 's'} extracted
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={runAnalysis}
              disabled={analyzing}
              className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
              title="Run a 5-dim SEO + E-E-A-T + GEO + AEO + content comparison via Claude Haiku"
            >{analyzing ? 'Analyzing…' : (findings ? '🔁 Re-run gap analysis' : '🔍 Run gap analysis')}</button>
            {findings && (
              <button
                onClick={applyToHint}
                disabled={applying}
                className="text-[10px] py-1 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50"
                title="Merge findings into the slot's page hint (idempotent — replaces any prior gap-analysis block)"
              >{applying ? 'Applying…' : '✨ Apply to page hint'}</button>
            )}
          </div>
        </div>
      )}

      {competitor && competitor.fetch_status === 'failed' && (
        <div className="bg-[#fef2f2] border border-[#dc2626]/30 rounded p-2 text-[10px] text-[#991b1b]">
          Last import failed: {competitor.fetch_error || 'unknown'}{competitor.http_status ? ` (HTTP ${competitor.http_status})` : ''}
        </div>
      )}

      {findings && (
        <GapFindings findings={findings} />
      )}

      {msg && <div className="text-[9px] text-[#16a34a]">✓ {msg}</div>}
      {err && <div className="text-[10px] text-[#c0392b]">⚠ {err}</div>}
    </div>
  )
}

// Landing-page image manager. Lives inside the SlotEditor (only
// rendered when slot.landing_page_id is set — pre-fan-out slots
// don't have a landing_page row to attach images to yet, so the
// operator must click 🚀 Create WP draft first).
//
// Shows a grid of current images with delete + role toggles.
// "Add image" opens the picker modal with three tabs:
//   1. 📤 Upload from computer
//   2. 🎨 Pexels (free stock)
//   3. 🌐 From a URL (scrape an existing tenant page)
//
// All three converge on the same landing_page_images row + Supabase
// storage. SEO filename defaults to a slug from alt-text/original
// filename; operator can edit on each image's row.
// Per-page schema_types suggester. Click → Claude Haiku analyzes
// the page context (slot intent, label, URL, tier, current body,
// competitor schemas) and recommends an allowlist. Operator
// reviews per-type reasoning + clicks Apply to commit. Preserves
// the editorial-judgment design of the schema_types field —
// suggestions are NEVER auto-applied.
function SchemaSuggesterPanel({ landingPageId }) {
  const [current, setCurrent] = useState(null) // [] | null
  const [suggestion, setSuggestion] = useState(null) // null | { suggested_types, summary, per_type_reasoning, rejected_types }
  const [suggesting, setSuggesting] = useState(false)
  const [applying, setApplying] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)

  const flashMsg = (m) => { setMsg(m); setTimeout(() => setMsg(null), 3000) }

  // Load existing schema_types on mount so operator sees what's set.
  useEffect(() => {
    let cancelled = false
    api.getLandingPageSchemaTypes(landingPageId)
      .then(r => { if (!cancelled) setCurrent(r?.schema_types || []) })
      .catch(() => { if (!cancelled) setCurrent([]) })
    return () => { cancelled = true }
  }, [landingPageId])

  const runSuggest = async () => {
    if (suggesting) return
    setSuggesting(true); setErr(null); setSuggestion(null)
    try {
      const r = await api.suggestLandingPageSchemaTypes(landingPageId)
      setSuggestion(r?.suggestion || null)
    } catch (e) { setErr(e?.message || String(e)) }
    finally { setSuggesting(false) }
  }

  const applySuggested = async () => {
    if (applying || !suggestion?.suggested_types) return
    const types = suggestion.suggested_types
    if (!confirm(`Set this page's schema_types allowlist to: ${types.join(', ')}?\n\nThis restricts the schema generator + deploy-time filter to ONLY emit these types. Any other schema blocks Claude generates will be stripped.\n\nYou can edit or clear this anytime from the per-page workspace.`)) return
    setApplying(true); setErr(null)
    try {
      await api.setLandingPageSchemaTypes(landingPageId, types)
      setCurrent(types)
      flashMsg(`Applied — page will only emit: ${types.join(', ')}`)
    } catch (e) { setErr(e?.message || String(e)) }
    finally { setApplying(false) }
  }

  return (
    <div className="border border-[#e5e5e5] rounded bg-[#fafafa] p-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium">🎯 Schema types</span>
        {Array.isArray(current) && current.length > 0 ? (
          <span className="text-[9px] text-muted">Allowlisted: <code>{current.join(', ')}</code></span>
        ) : (
          <span className="text-[9px] text-muted">No allowlist set — Claude's judgment + template defaults apply</span>
        )}
        <span className="flex-1" />
        <button
          onClick={runSuggest}
          disabled={suggesting}
          className="text-[10px] py-1 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
          title="Claude Haiku analyzes the page (label, intent, body, competitor schemas) and recommends a focused schema_types allowlist. You review + apply."
        >{suggesting ? 'Suggesting…' : (suggestion ? '🔁 Re-suggest' : '🎯 Suggest schemas')}</button>
      </div>

      {err && <div className="text-[10px] text-[#c0392b]">⚠ {err}</div>}
      {msg && <div className="text-[10px] text-[#16a34a]">✓ {msg}</div>}

      {suggestion && (
        <div className="bg-white border border-[#e5e5e5] rounded p-2 space-y-2 text-[10px]">
          {suggestion.summary && (
            <div className="text-[10px] text-ink italic">{suggestion.summary}</div>
          )}
          <div>
            <div className="text-[9px] uppercase tracking-wide text-muted font-medium mb-1">Recommended types ({suggestion.suggested_types?.length || 0})</div>
            <div className="flex flex-wrap gap-1">
              {(suggestion.suggested_types || []).map(t => (
                <span key={t} className="text-[10px] py-0.5 px-1.5 rounded border bg-[#dcfce7] text-[#15803d] border-[#16a34a]/40 font-mono">{t}</span>
              ))}
            </div>
          </div>

          {Array.isArray(suggestion.per_type_reasoning) && suggestion.per_type_reasoning.length > 0 && (
            <details>
              <summary className="cursor-pointer text-[9px] uppercase tracking-wide text-muted font-medium">Per-type reasoning</summary>
              <ul className="space-y-1 pt-1">
                {suggestion.per_type_reasoning.map((r, i) => (
                  <li key={i} className="text-[10px]">
                    <code className="text-[9px] bg-[#f0f0f0] px-1">{r.type}</code> — {r.why}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {Array.isArray(suggestion.rejected_types) && suggestion.rejected_types.length > 0 && (
            <details>
              <summary className="cursor-pointer text-[9px] uppercase tracking-wide text-muted font-medium">Considered but rejected ({suggestion.rejected_types.length})</summary>
              <ul className="space-y-1 pt-1">
                {suggestion.rejected_types.map((r, i) => (
                  <li key={i} className="text-[10px] text-muted">
                    <code className="text-[9px] bg-[#f0f0f0] px-1">{r.type}</code> — {r.why_not}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex items-center gap-2 pt-1 border-t border-[#f0f0f0]">
            <span className="flex-1" />
            <button
              onClick={applySuggested}
              disabled={applying || !suggestion.suggested_types?.length}
              className="text-[10px] py-1 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50"
              title="Save these types as the page's schema_types allowlist. Editorial decision — review the per-type reasoning first."
            >{applying ? 'Applying…' : '✓ Apply allowlist'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

