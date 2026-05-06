// Phase 0 placeholder dashboard. Real content (drafts list, topic
// ideation entry point, schedule view) lands in Phase 1+.

import { useEffect, useState } from 'react'
import * as api from '../api'

export default function ContentStudioDashboard() {
  const [config, setConfig] = useState(null)
  const [indexCount, setIndexCount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshSummary, setRefreshSummary] = useState(null)

  const reloadIndexCount = async () => {
    try {
      const idx = await api.getContentIndex()
      setIndexCount(Array.isArray(idx?.items) ? idx.items.length : 0)
    } catch { /* keep prior count */ }
  }

  const handleRefreshIndex = async () => {
    setRefreshing(true)
    setRefreshSummary(null)
    setError(null)
    try {
      const summary = await api.refreshContentIndex()
      setRefreshSummary(summary)
      await reloadIndexCount()
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([api.getContentConfig().catch(() => null), api.getContentIndex().catch(() => ({ items: [] }))])
      .then(([c, idx]) => {
        if (cancelled) return
        setConfig(c)
        setIndexCount(Array.isArray(idx?.items) ? idx.items.length : 0)
      })
      .catch(e => { if (!cancelled) setError(e?.message || String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className="text-[12px] text-muted">Loading…</div>
  if (error) return <div className="text-[12px] text-[#c0392b]">{error}</div>

  const configured = !!config?.configured
  const enabledTemplates = Array.isArray(config?.enabled_templates) ? config.enabled_templates : []
  const promoted = config?.promoted_business

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[#e5e5e5] rounded p-4">
        <h2 className="text-[14px] font-bold mb-2">Welcome to Content Studio</h2>
        <p className="text-[11px] text-muted leading-relaxed">
          V3 generates blog content per tenant — topic ideation, full article generation, SEO-aware publishing, and auto-scheduling. Phase 0 is what you see today: tenant configuration + a stubbed indexer. Topic ideation, drafts, and publishing land in subsequent phases.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          label="Config status"
          value={configured ? 'Saved' : 'Not configured'}
          tone={configured ? 'good' : 'warn'}
          hint={configured ? null : 'Open Config to set audience locks + promoted business.'}
        />
        <StatCard
          label="Templates enabled"
          value={enabledTemplates.length === 0 ? 'None yet' : enabledTemplates.join(', ')}
          tone={enabledTemplates.length === 0 ? 'warn' : 'good'}
        />
        <StatCard
          label="Indexed posts"
          value={indexCount == null ? '—' : String(indexCount)}
          tone={indexCount > 0 ? 'good' : 'muted'}
          hint={indexCount === 0 ? 'No posts indexed yet (indexer wires up next).' : null}
        />
      </div>

      <div className="bg-white border border-[#e5e5e5] rounded p-3">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <h3 className="text-[12px] font-medium">WordPress indexer</h3>
            <p className="text-[10px] text-muted leading-snug">
              Pull the most recent posts from your WP site, embed them, and store them as internal-link candidates.
              Runs daily automatically; click below to trigger now.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefreshIndex}
            disabled={refreshing}
            className="text-[11px] py-1 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium whitespace-nowrap"
          >
            {refreshing ? 'Indexing…' : '🔄 Refresh index'}
          </button>
        </div>
        {refreshSummary && (
          <div className="mt-2 text-[10px] bg-[#fafafa] border border-[#e5e5e5] rounded p-2 font-mono">
            {refreshSummary.skipped && (
              <div className="text-[#d97706]">Skipped: {refreshSummary.reason}</div>
            )}
            {!refreshSummary.skipped && (
              <>
                <div>posts seen: <b>{refreshSummary.posts_seen}</b></div>
                <div>upserted: <b>{refreshSummary.upserts}</b></div>
                <div>skipped (thin): {refreshSummary.skipped_thin}</div>
                <div>soft-deleted: {refreshSummary.soft_deleted}</div>
                <div>
                  embeddings: <b>{refreshSummary.embeddings_succeeded}/{refreshSummary.embeddings_attempted}</b>
                  {refreshSummary.embeddings_attempted > 0 && refreshSummary.embeddings_succeeded === 0 && (
                    <span className="text-[#d97706] ml-2">— check OPENAI_API_KEY</span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {promoted && (
        <div className="bg-white border border-[#e5e5e5] rounded p-3">
          <h3 className="text-[12px] font-medium mb-1">Promoted business</h3>
          <div className="text-[11px] text-ink">{promoted.name}</div>
          {promoted.origin_address && (
            <div className="text-[10px] text-muted">{promoted.origin_address}</div>
          )}
          {Array.isArray(promoted.owned_categories) && promoted.owned_categories.length > 0 && (
            <div className="text-[10px] text-muted mt-1">
              Owned categories: {promoted.owned_categories.join(', ')}
            </div>
          )}
        </div>
      )}

      <div className="text-[10px] text-muted italic">
        Coming next: Topic Ideation tool, full article drafts, SEO publish surface.
      </div>
    </div>
  )
}

function StatCard({ label, value, tone, hint }) {
  const toneClass = tone === 'good' ? 'text-[#2D9A5E]' : tone === 'warn' ? 'text-[#d97706]' : 'text-muted'
  return (
    <div className="bg-white border border-[#e5e5e5] rounded p-3">
      <div className="text-[9px] uppercase tracking-wide text-muted mb-1">{label}</div>
      <div className={`text-[13px] font-medium ${toneClass}`}>{value}</div>
      {hint && <div className="text-[9px] text-muted mt-1">{hint}</div>}
    </div>
  )
}
