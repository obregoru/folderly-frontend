import { useEffect, useMemo, useState } from 'react'
import * as api from '../../api'

/**
 * HistoryV2 — past posts (posted / failed / cancelled). Filters by
 * status + platform, shows posted_at time + platform, engagement /
 * link snippet from post_result when available, retry for failed.
 *
 * Uses the same /schedule endpoint ScheduleV2 uses — just filtered by
 * non-scheduled statuses. status=all + client-side split keeps the fetch
 * count low; 90-day lookback window by default.
 */

const STATUS_TABS = [
  { key: 'all',       label: 'All' },
  { key: 'posted',    label: 'Posted' },
  { key: 'failed',    label: 'Failed' },
  { key: 'cancelled', label: 'Cancelled' },
]

const PLATFORMS = ['all', 'tiktok', 'instagram', 'instagram_story', 'facebook', 'facebook_story', 'youtube', 'blog', 'google_business']

function postUrlFromResult(p) {
  const r = p?.post_result
  if (!r || typeof r !== 'object') return null
  return r.permalink || r.url || r.link || r.post_url || r.video_url || null
}
function engagementFromResult(p) {
  const r = p?.post_result
  if (!r || typeof r !== 'object') return null
  const parts = []
  if (r.likes != null) parts.push(`${r.likes} likes`)
  if (r.comments != null) parts.push(`${r.comments} comments`)
  if (r.views != null) parts.push(`${r.views} views`)
  return parts.length ? parts.join(' · ') : null
}

export default function HistoryV2() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [platformFilter, setPlatformFilter] = useState('all')
  const [days, setDays] = useState(90)
  const [retrying, setRetrying] = useState(null)

  const reload = () => {
    setLoading(true); setError(null)
    const to = new Date()
    const from = new Date(); from.setDate(from.getDate() - days)
    // status=completed returns posted+cancelled. We want failed too, so fetch each bucket.
    Promise.all([
      api.getScheduledPosts({ status: 'posted',    from: from.toISOString(), to: to.toISOString(), limit: 200 }),
      api.getScheduledPosts({ status: 'failed',    from: from.toISOString(), to: to.toISOString(), limit: 200 }),
      api.getScheduledPosts({ status: 'cancelled', from: from.toISOString(), to: to.toISOString(), limit: 200 }),
    ])
      .then(([posted, failed, cancelled]) => {
        const extract = r => Array.isArray(r) ? r : (r?.posts || r?.rows || [])
        const all = [...extract(posted), ...extract(failed), ...extract(cancelled)]
        all.sort((a, b) => {
          const aa = a.posted_at || a.scheduled_at || ''
          const bb = b.posted_at || b.scheduled_at || ''
          return bb.localeCompare(aa)
        })
        setPosts(all)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [days])

  const filtered = useMemo(() => posts.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    if (platformFilter !== 'all' && p.platform !== platformFilter) return false
    return true
  }), [posts, statusFilter, platformFilter])

  const counts = useMemo(() => ({
    all:       posts.length,
    posted:    posts.filter(p => p.status === 'posted').length,
    failed:    posts.filter(p => p.status === 'failed').length,
    cancelled: posts.filter(p => p.status === 'cancelled').length,
  }), [posts])

  const retry = async (p) => {
    setRetrying(p.uuid)
    try {
      const soon = new Date(Date.now() + 60_000).toISOString()
      await api.retryScheduledPost(p.uuid, soon)
      reload()
    } catch (e) { alert('Retry failed: ' + e.message) }
    finally { setRetrying(null) }
  }

  const remove = async (p) => {
    if (!confirm('Delete this from history? (removes the row permanently)')) return
    try { await api.deleteScheduledPost(p.uuid); reload() }
    catch (e) { alert('Delete failed: ' + e.message) }
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="text-[14px] font-medium flex-1">History</h1>
        <select
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          className="text-[10px] border border-[#e5e5e5] rounded py-1 px-2 bg-white"
        >
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={180}>Last 6 months</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      <div className="flex items-center gap-0.5 bg-white rounded-md p-0.5 border border-[#e5e5e5] overflow-x-auto">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setStatusFilter(t.key)}
            className={`text-[10px] py-1 px-2.5 rounded border-none cursor-pointer whitespace-nowrap ${statusFilter === t.key ? 'bg-[#6C5CE7] text-white' : 'bg-transparent text-muted'}`}
          >
            {t.label} <span className="opacity-60">({counts[t.key] || 0})</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {PLATFORMS.map(p => (
          <button
            key={p}
            onClick={() => setPlatformFilter(p)}
            className={`text-[9px] py-0.5 px-2 rounded-full border cursor-pointer ${platformFilter === p ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]' : 'bg-white text-muted border-[#e5e5e5]'}`}
          >{p === 'all' ? 'All platforms' : p}</button>
        ))}
      </div>

      {loading && <div className="text-[11px] text-muted italic text-center py-4">Loading…</div>}
      {error && <div className="text-[11px] text-[#c0392b] text-center py-4">Error: {error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div className="text-[11px] text-muted italic text-center py-8 bg-white border border-[#e5e5e5] rounded-lg">
          No posts match this filter.
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-1.5">
          {filtered.map(p => <HistoryRow key={p.uuid} p={p} onRetry={retry} onDelete={remove} retrying={retrying === p.uuid} />)}
        </div>
      )}
    </div>
  )
}

function HistoryRow({ p, onRetry, onDelete, retrying }) {
  const when = p.posted_at || p.scheduled_at
  const whenLabel = when ? new Date(when).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
  const url = postUrlFromResult(p)
  const eng = engagementFromResult(p)
  const statusColor = {
    posted:    { dot: 'bg-[#2D9A5E]', text: 'text-[#2D9A5E]', bg: 'bg-[#f0faf4]' },
    failed:    { dot: 'bg-[#c0392b]', text: 'text-[#c0392b]', bg: 'bg-[#fdf2f1]' },
    cancelled: { dot: 'bg-[#b7b7b7]', text: 'text-muted',     bg: 'bg-white'     },
    pending:   { dot: 'bg-[#6C5CE7]', text: 'text-[#6C5CE7]', bg: 'bg-white'     },
  }[p.status] || { dot: 'bg-muted', text: 'text-muted', bg: 'bg-white' }

  return (
    <div className={`border border-[#e5e5e5] rounded p-2 text-[10px] ${statusColor.bg}`}>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{p.job_name || p.title || '(untitled)'}</div>
          <div className="text-[9px] text-muted flex items-center gap-1.5 flex-wrap">
            <span className="uppercase">{p.platform}</span>
            <span>·</span>
            <span>{whenLabel}</span>
            <span>·</span>
            <span className={statusColor.text}>{p.status}</span>
          </div>
        </div>
      </div>

      {p.caption && (
        <div className="mt-1.5 text-[10px] text-muted line-clamp-2 pl-4">
          {p.caption.slice(0, 140)}{p.caption.length > 140 ? '…' : ''}
        </div>
      )}

      {eng && (
        <div className="mt-1 pl-4 text-[9px] text-[#2D9A5E] font-medium">{eng}</div>
      )}

      {p.status === 'failed' && p.error_message && (
        <div className="mt-1 pl-4 text-[9px] text-[#c0392b] italic">{p.error_message.slice(0, 160)}</div>
      )}

      <div className="flex gap-1 mt-1.5 flex-wrap pl-4">
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="text-[9px] text-[#6C5CE7] bg-white border border-[#6C5CE7] rounded py-0.5 px-1.5 no-underline">
            View post →
          </a>
        )}
        {p.status === 'failed' && (
          <button
            onClick={() => onRetry(p)}
            disabled={retrying}
            className="text-[9px] bg-[#6C5CE7] text-white border-none rounded py-0.5 px-1.5 cursor-pointer disabled:opacity-50"
          >{retrying ? 'Retrying…' : 'Retry in 1 min'}</button>
        )}
        <button
          onClick={() => onDelete(p)}
          className="text-[9px] text-muted bg-white border border-[#e5e5e5] rounded py-0.5 px-1.5 cursor-pointer ml-auto"
        >Delete row</button>
      </div>
    </div>
  )
}
