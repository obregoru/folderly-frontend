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
  const [activity, setActivity] = useState([])
  const [activityLoading, setActivityLoading] = useState(false)

  const reloadIndexCount = async () => {
    try {
      const idx = await api.getContentIndex()
      setIndexCount(Array.isArray(idx?.items) ? idx.items.length : 0)
    } catch { /* keep prior count */ }
  }

  const reloadActivity = async () => {
    setActivityLoading(true)
    try {
      const r = await api.getActivity(40)
      setActivity(Array.isArray(r?.items) ? r.items : [])
    } catch { /* keep prior */ } finally {
      setActivityLoading(false)
    }
  }

  const handleRefreshIndex = async (forceReembed = false) => {
    setRefreshing(true)
    setRefreshSummary(null)
    setError(null)
    try {
      const summary = await api.refreshContentIndex({ forceReembed })
      setRefreshSummary(summary)
      await reloadIndexCount()
      await reloadActivity()
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.getContentConfig().catch(() => null),
      api.getContentIndex().catch(() => ({ items: [] })),
      api.getActivity(40).catch(() => ({ items: [] })),
    ])
      .then(([c, idx, act]) => {
        if (cancelled) return
        setConfig(c)
        setIndexCount(Array.isArray(idx?.items) ? idx.items.length : 0)
        setActivity(Array.isArray(act?.items) ? act.items : [])
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
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => handleRefreshIndex(false)}
              disabled={refreshing}
              className="text-[11px] py-1 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium whitespace-nowrap"
            >
              {refreshing ? 'Indexing…' : '🔄 Refresh index'}
            </button>
            <button
              type="button"
              onClick={() => handleRefreshIndex(true)}
              disabled={refreshing}
              className="text-[10px] py-0.5 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer disabled:opacity-50 font-medium whitespace-nowrap"
              title="Re-embed every indexed post regardless of modified_at. Use after switching embedding providers or when prior embedding calls failed."
            >
              ↻ Force re-embed all
            </button>
          </div>
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

      <RecentActivityPanel
        items={activity}
        loading={activityLoading}
        onRefresh={reloadActivity}
      />

      <div className="text-[10px] text-muted italic">
        Coming next: Topic Ideation tool, full article drafts, SEO publish surface.
      </div>
    </div>
  )
}

// ── Recent activity panel ─────────────────────────────────────────
// Shows the last ~40 lifecycle events for the tenant. Server pre-renders
// summary text, so this just maps eventType → icon + tone and lets the
// caller click through to the related draft when present.
const EVENT_TONE = {
  topics_ideated:           { icon: '💡', tone: 'text-[#6C5CE7]' },
  topics_accepted:          { icon: '✓',  tone: 'text-[#2D9A5E]' },
  article_generated:        { icon: '✍️', tone: 'text-[#2D9A5E]' },
  article_regenerated:      { icon: '↻',  tone: 'text-[#6C5CE7]' },
  draft_scheduled:          { icon: '📅', tone: 'text-[#3b82f6]' },
  draft_unscheduled:        { icon: '⏸',  tone: 'text-muted' },
  draft_published:          { icon: '🚀', tone: 'text-[#0a4d2c]' },
  draft_unpublished:        { icon: '↩',  tone: 'text-[#d97706]' },
  draft_flagged:            { icon: '⚠',  tone: 'text-[#d97706]' },
  publish_failed:           { icon: '✕',  tone: 'text-[#c0392b]' },
  publish_retry_scheduled:  { icon: '⏱',  tone: 'text-[#d97706]' },
  publish_retry_exhausted:  { icon: '✕',  tone: 'text-[#c0392b]' },
  image_attached:           { icon: '🖼',  tone: 'text-muted' },
  index_refreshed:          { icon: '🔄', tone: 'text-muted' },
  config_updated:           { icon: '⚙',  tone: 'text-muted' },
}

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return ''
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

function RecentActivityPanel({ items, loading, onRefresh }) {
  return (
    <div className="bg-white border border-[#e5e5e5] rounded p-3">
      <div className="flex items-center mb-1.5">
        <h3 className="text-[12px] font-medium flex-1">Recent activity</h3>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="text-[10px] py-0.5 px-2 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer disabled:opacity-50"
          title="Reload activity feed"
        >{loading ? '…' : '↻'}</button>
      </div>
      {items.length === 0 ? (
        <div className="text-[10px] text-muted italic">
          No activity yet. Events will appear as you ideate, generate, schedule, and publish.
        </div>
      ) : (
        <ul className="space-y-1">
          {items.map(it => {
            const t = EVENT_TONE[it.event_type] || { icon: '•', tone: 'text-muted' }
            return (
              <li key={it.id} className="flex items-start gap-2 text-[11px] border-b border-[#f5f5f5] last:border-b-0 py-1">
                <span className={`${t.tone} text-[12px] leading-tight w-4 text-center flex-shrink-0`}>{t.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-ink truncate" title={it.summary}>{it.summary}</div>
                  {it.blog_post_title && (
                    <div className="text-[9px] text-muted font-mono truncate">/{it.blog_post_slug || ''}</div>
                  )}
                </div>
                <span className="text-[9px] text-muted font-mono flex-shrink-0" title={new Date(it.created_at).toLocaleString()}>
                  {timeAgo(it.created_at)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
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
