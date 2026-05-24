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

import { useEffect, useState } from 'react'
import * as api from '../api'

export default function SitemapWizard() {
  const [plan, setPlan] = useState({ slots: [], tiers: [] })
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

  // Step 2: confirmed parsed plan → run propagation. Backend
  // upserts slots, checks WP + source-domain for each, imports or
  // scrapes whatever exists. Modal swaps to 'result' phase to show
  // per-slot outcomes.
  const runPropagation = async () => {
    if (!propagateModal?.parsed) return
    setPropagateModal(m => ({ ...m, propagating: true, error: null }))
    try {
      const r = await api.propagateInitialSitemap(propagateModal.parsed)
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
              onSaved={async () => { await load(); setAdding(false) }}
              onCancel={() => setAdding(false)}
            />
          ) : activeSlot ? (
            <SlotEditor
              key={activeSlot.id}
              slot={activeSlot}
              tiers={tierList}
              checklist={checklistBySlot[activeSlot.id] || null}
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

      {propagateModal && (
        <PropagateModal
          state={propagateModal}
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
function PropagateModal({ state, onClose, onRun }) {
  const { phase, parsed, propagating, result, error } = state
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
                Review what Claude pulled from your brief below. Click <b>Run propagation</b> to: upsert these as slots, check each page against your WordPress install + source domain (<code>tenants.target_url</code>), and import or scrape what already exists. Slots that don't exist anywhere stay 'planned' for future fan-out.
              </div>

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
              <div className="grid grid-cols-4 gap-2">
                <ResultStat label="WP imported" value={result.summary.imported_wp} tone="green" />
                <ResultStat label="Scraped" value={result.summary.scraped} tone="green" />
                <ResultStat label="Planned" value={result.summary.planned} tone="neutral" />
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
                onClick={onRun}
                disabled={propagating || !parsed?.pages?.length}
                className="text-[10px] py-1 px-2 bg-[#16a34a] text-white border-none rounded cursor-pointer disabled:opacity-50"
                title="Upsert slots + check WP/source + import/scrape per page"
              >{propagating ? 'Propagating…' : `🚀 Run propagation (${parsed?.pages?.length || 0} pages)`}</button>
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

function SlotEditor({ slot, tiers, checklist, onSaved, onCancel, onDeleted, onCreatedWp }) {
  const isNew = !slot
  const [label, setLabel] = useState(slot?.label || '')
  const [slotKey, setSlotKey] = useState(slot?.slot_key || '')
  const [tier, setTier] = useState(slot?.tier || 1)
  const [templateKind, setTemplateKind] = useState(slot?.template_kind || '')
  const [rationale, setRationale] = useState(slot?.rationale || '')
  const [extraHint, setExtraHint] = useState(slot?.extra_strategy_hint || '')
  const [varsRaw, setVarsRaw] = useState(
    slot?.template_variables ? JSON.stringify(slot.template_variables, null, 2) : '{}'
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState(null)

  // Per-action busy / message state for create-wp + delete actions.
  const [creatingWp, setCreatingWp] = useState(false)
  const [createResult, setCreateResult] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const save = async () => {
    if (saving) return
    setSaving(true); setErr(null); setSaved(false)
    try {
      let parsedVars = {}
      try {
        parsedVars = JSON.parse(varsRaw || '{}')
      } catch {
        throw new Error('template_variables is not valid JSON')
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
        <div className="text-[8px] text-muted mt-0.5">Used as the SEED — once a real landing_page row exists, that page's own strategy_hint takes over for ongoing edits.</div>
      </div>

      {!isNew && slot?.id && (
        <CompetitorBlock
          slotId={slot.id}
          initialUrl={slot.competitor_url || ''}
          onHintMerged={(newHint) => setExtraHint(newHint)}
        />
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
              <button
                onClick={createWp}
                disabled={creatingWp}
                className="text-[10px] py-1 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50"
                title={templateKind.trim()
                  ? `Materialize this slot using the "${templateKind.trim()}" template: WP draft + landing_page row + initial imported version. Slot moves to draft status.`
                  : 'Materialize this slot as a freeform WP draft (no template). A placeholder body goes up; click Propose on the page workspace to generate real content from the slot hint, voice anchors, and competitive gap analysis.'}
              >{creatingWp ? 'Creating WP draft…' : '🚀 Create WP draft'}</button>
            )}
            {slot.landing_page_id && (
              <a
                href={`/content-studio?go=landing&id=${slot.landing_page_id}`}
                className="text-[10px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer no-underline"
                title="Jump to the per-page workspace for this slot's landing page"
              >Open in Pages →</a>
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

// Render the 5-dim gap analysis findings. Top recommendations are
// always expanded; each dimension is a collapsible <details>.
function GapFindings({ findings }) {
  const dims = [
    { key: 'seo', label: 'SEO' },
    { key: 'eeat', label: 'E-E-A-T' },
    { key: 'geo', label: 'GEO (generative engines)' },
    { key: 'aeo', label: 'AEO (answer engines)' },
    { key: 'content', label: 'Content quality' },
  ]
  return (
    <div className="bg-white border border-[#e5e5e5] rounded p-2 space-y-2 text-[10px]">
      {findings.summary && (
        <div className="text-[10px] text-ink italic">{findings.summary}</div>
      )}
      {Array.isArray(findings.top_recommendations) && findings.top_recommendations.length > 0 && (
        <div className="space-y-1">
          <div className="text-[9px] uppercase tracking-wide text-muted font-medium">Highest-impact moves</div>
          <ul className="space-y-0.5">
            {findings.top_recommendations.map((r, i) => (
              <li key={i} className="text-[10px] pl-2 border-l-2 border-[#6C5CE7]/40">{r}</li>
            ))}
          </ul>
        </div>
      )}
      {dims.map(d => {
        const f = findings[d.key]
        if (!f) return null
        const gaps = (f.gaps_to_close || []).filter(Boolean)
        const strengths = (f.our_strengths || []).filter(Boolean)
        const recs = (f.recommendations || []).filter(Boolean)
        if (gaps.length === 0 && strengths.length === 0 && recs.length === 0) return null
        return (
          <details key={d.key} className="border-t border-[#f0f0f0] pt-1">
            <summary className="cursor-pointer text-[10px] font-medium">
              {d.label}
              <span className="text-[9px] text-muted ml-2">
                {gaps.length} gap{gaps.length === 1 ? '' : 's'}, {recs.length} rec{recs.length === 1 ? '' : 's'}
              </span>
            </summary>
            <div className="pl-2 pt-1 space-y-1.5">
              {gaps.length > 0 && (
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-[#c0392b]/80 font-medium mb-0.5">Gaps to close</div>
                  <ul className="space-y-0.5">
                    {gaps.map((g, i) => <li key={i} className="text-[10px]">• {g}</li>)}
                  </ul>
                </div>
              )}
              {strengths.length > 0 && (
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-[#15803d] font-medium mb-0.5">Our strengths</div>
                  <ul className="space-y-0.5">
                    {strengths.map((s, i) => <li key={i} className="text-[10px]">• {s}</li>)}
                  </ul>
                </div>
              )}
              {recs.length > 0 && (
                <div>
                  <div className="text-[9px] uppercase tracking-wide text-[#6C5CE7] font-medium mb-0.5">Recommendations</div>
                  <ul className="space-y-0.5">
                    {recs.map((r, i) => <li key={i} className="text-[10px]">• {r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </details>
        )
      })}
    </div>
  )
}
