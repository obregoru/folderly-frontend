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

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const r = await api.getSitemapPlan()
      setPlan({
        slots: Array.isArray(r?.slots) ? r.slots : [],
        tiers: Array.isArray(r?.tiers) ? r.tiers : [],
      })
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

      <SiteIndexHintEditor />

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
                      <th className="text-left py-1 pr-2 font-normal">Keywords</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(parsed.pages || []).map(p => (
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
                        <td className="py-1 pr-2 text-[9px] text-muted">
                          {(p.target_keywords || []).slice(0, 3).join(', ')}
                          {(p.target_keywords || []).length > 3 && ` +${p.target_keywords.length - 3}`}
                        </td>
                      </tr>
                    ))}
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

function SlotEditor({ slot, tiers, onSaved, onCancel, onDeleted, onCreatedWp }) {
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
            placeholder="e.g. service_page (or empty = freeform)"
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
                disabled={creatingWp || !templateKind.trim()}
                className="text-[10px] py-1 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50"
                title={templateKind.trim()
                  ? 'Materialize this slot: create a WP draft + landing_page row + initial imported version. Slot moves to draft status.'
                  : 'Set a template_kind first — required to scaffold the WP page.'}
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
