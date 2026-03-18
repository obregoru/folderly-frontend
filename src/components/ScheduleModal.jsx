import { useState, useEffect } from 'react'
import * as api from '../api'

const PLATFORM_LABELS = { facebook: 'Facebook', instagram: 'Instagram', twitter: 'X', blog: 'WordPress', google: 'Google' }
const PLATFORM_COLORS = { facebook: '#1877F2', instagram: '#E1306C', twitter: '#000', blog: '#21759B', google: '#4285F4' }
const STATUS_STYLES = {
  pending: { bg: '#f3f0ff', text: '#6C5CE7', label: 'Pending' },
  posted: { bg: '#e8efe9', text: '#2D9A5E', label: 'Posted' },
  failed: { bg: '#fdeaea', text: '#c0392b', label: 'Failed' },
  cancelled: { bg: '#f5f5f5', text: '#999', label: 'Cancelled' },
}

// Group posts by their scheduled_at time (rounded to the minute)
function groupByTime(posts) {
  const groups = {}
  for (const p of posts) {
    // Round to the minute for grouping (posts scheduled together have the same time)
    const key = new Date(p.scheduled_at).toISOString().slice(0, 16)
    if (!groups[key]) groups[key] = []
    groups[key].push(p)
  }
  // Sort by time
  return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]))
}

function summarizeGroup(posts) {
  const platforms = [...new Set(posts.map(p => PLATFORM_LABELS[p.platform] || p.platform))]
  const statuses = [...new Set(posts.map(p => p.status))]
  let statusSummary = ''
  if (statuses.length === 1) {
    statusSummary = STATUS_STYLES[statuses[0]]?.label || statuses[0]
  } else {
    const pending = posts.filter(p => p.status === 'pending').length
    const posted = posts.filter(p => p.status === 'posted').length
    const failed = posts.filter(p => p.status === 'failed').length
    const parts = []
    if (posted) parts.push(`${posted} posted`)
    if (pending) parts.push(`${pending} pending`)
    if (failed) parts.push(`${failed} failed`)
    statusSummary = parts.join(', ')
  }
  return { platforms, statusSummary, statuses }
}

export default function ScheduleModal({ onClose }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [expandedTime, setExpandedTime] = useState(null)

  const load = async () => {
    try {
      const data = await api.getScheduledPosts()
      if (Array.isArray(data)) setPosts(data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleCancel = async (uuid) => {
    try { await api.cancelScheduledPost(uuid); load() } catch (err) { alert(err.message) }
  }

  const handleRetry = async (uuid) => {
    try { await api.retryScheduledPost(uuid); load() } catch (err) { alert(err.message) }
  }

  const handleDelete = async (uuid) => {
    try { await api.deleteScheduledPost(uuid); load() } catch {}
  }

  const handleCancelGroup = async (groupPosts) => {
    for (const p of groupPosts.filter(p => p.status === 'pending')) {
      try { await api.cancelScheduledPost(p.uuid) } catch {}
    }
    load()
  }

  const filtered = filter === 'all' ? posts : posts.filter(p => p.status === filter)
  const groups = groupByTime(filtered)

  const counts = {
    all: posts.length,
    pending: posts.filter(p => p.status === 'pending').length,
    posted: posts.filter(p => p.status === 'posted').length,
    failed: posts.filter(p => p.status === 'failed').length,
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[60px] bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-[600px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h2 className="text-sm font-medium text-ink">Scheduled Posts</h2>
          <button onClick={onClose} className="text-muted hover:text-ink text-lg leading-none bg-transparent border-none cursor-pointer">&times;</button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 px-5 py-2 border-b border-border bg-[#fafafa]">
          {['all', 'pending', 'posted', 'failed'].map(f => (
            <button
              key={f}
              onClick={() => { setFilter(f); setExpandedTime(null) }}
              className={`text-[11px] py-1 px-2.5 rounded-full border font-sans cursor-pointer capitalize ${
                filter === f ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]' : 'bg-white text-muted border-border hover:bg-[#f3f0ff]'
              }`}
            >
              {f} ({counts[f] || 0})
            </button>
          ))}
          <button onClick={load} className="text-[10px] text-muted hover:underline ml-auto">Refresh</button>
        </div>

        {/* Grouped list */}
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="text-xs text-muted py-4 text-center">Loading...</div>}

          {!loading && groups.length === 0 && (
            <div className="text-xs text-muted py-8 text-center">
              {filter === 'all' ? 'No scheduled posts yet' : `No ${filter} posts`}
            </div>
          )}

          {groups.map(([timeKey, groupPosts]) => {
            const date = new Date(timeKey)
            const { platforms, statusSummary, statuses } = summarizeGroup(groupPosts)
            const isExpanded = expandedTime === timeKey
            const hasPending = groupPosts.some(p => p.status === 'pending')
            const primaryStatus = statuses.length === 1 ? statuses[0] : (hasPending ? 'pending' : 'posted')
            const st = STATUS_STYLES[primaryStatus] || STATUS_STYLES.pending

            // Get first image from the group for preview
            const previewImg = groupPosts.find(p => p.image_url)?.image_url

            return (
              <div key={timeKey} className="border-b border-border last:border-none">
                {/* Group header -- clickable */}
                <button
                  onClick={() => setExpandedTime(isExpanded ? null : timeKey)}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-[#fafafa] cursor-pointer bg-transparent border-none font-sans text-left"
                >
                  {previewImg ? (
                    <img src={previewImg} className="w-10 h-10 rounded object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-[#f3f0ff] flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] text-[#6C5CE7]">{groupPosts.length}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-ink">
                        {date.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                      <span className="text-[10px] py-0.5 px-1.5 rounded-full font-medium" style={{ background: st.bg, color: st.text }}>
                        {statusSummary}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted mt-0.5">
                      {groupPosts.length} post{groupPosts.length !== 1 ? 's' : ''} — {platforms.join(', ')}
                    </div>
                  </div>
                  <span className="text-muted text-xs flex-shrink-0">{isExpanded ? '▾' : '▸'}</span>
                </button>

                {/* Expanded: individual posts */}
                {isExpanded && (
                  <div className="px-5 pb-3 bg-[#fafafa]">
                    {hasPending && groupPosts.filter(p => p.status === 'pending').length > 1 && (
                      <div className="mb-2">
                        <button
                          onClick={() => handleCancelGroup(groupPosts)}
                          className="text-[10px] text-red-500 hover:underline"
                        >Cancel all in this group</button>
                      </div>
                    )}
                    {groupPosts.map(p => {
                      const pst = STATUS_STYLES[p.status] || STATUS_STYLES.pending
                      return (
                        <div key={p.uuid} className="flex gap-2.5 py-2 border-b border-border/50 last:border-none">
                          {p.image_url ? (
                            <img src={p.image_url} className="w-12 h-12 rounded object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-12 h-12 rounded bg-white flex items-center justify-center flex-shrink-0 border border-border">
                              <span className="text-[9px] text-muted">Text</span>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-[11px] font-medium" style={{ color: PLATFORM_COLORS[p.platform] }}>
                                {PLATFORM_LABELS[p.platform] || p.platform}
                              </span>
                              <span className="text-[9px] py-0.5 px-1 rounded-full" style={{ background: pst.bg, color: pst.text }}>
                                {pst.label}
                              </span>
                            </div>
                            {p.title && <div className="text-[10px] font-medium text-ink truncate">{p.title}</div>}
                            <div className="text-[10px] text-muted truncate" title={p.caption}>
                              {p.caption.slice(0, 100)}{p.caption.length > 100 ? '...' : ''}
                            </div>
                            {p.error_message && (
                              <div className="text-[10px] text-[#c0392b] mt-0.5 truncate" title={p.error_message}>{p.error_message}</div>
                            )}
                            <div className="flex gap-2 mt-1">
                              {p.status === 'pending' && (
                                <button onClick={() => handleCancel(p.uuid)} className="text-[10px] text-red-500 hover:underline">Cancel</button>
                              )}
                              {p.status === 'failed' && (
                                <button onClick={() => handleRetry(p.uuid)} className="text-[10px] text-[#6C5CE7] hover:underline">Retry</button>
                              )}
                              {(p.status === 'posted' || p.status === 'failed' || p.status === 'cancelled') && (
                                <button onClick={() => handleDelete(p.uuid)} className="text-[10px] text-muted hover:underline">Remove</button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
