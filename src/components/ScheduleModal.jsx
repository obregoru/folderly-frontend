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

export default function ScheduleModal({ onClose }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // all, pending, posted, failed

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

  const filtered = filter === 'all' ? posts : posts.filter(p => p.status === filter)
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
              onClick={() => setFilter(f)}
              className={`text-[11px] py-1 px-2.5 rounded-full border font-sans cursor-pointer capitalize ${
                filter === f ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]' : 'bg-white text-muted border-border hover:bg-[#f3f0ff]'
              }`}
            >
              {f} ({counts[f] || 0})
            </button>
          ))}
          <button onClick={load} className="text-[10px] text-muted hover:underline ml-auto">Refresh</button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-2">
          {loading && <div className="text-xs text-muted py-4 text-center">Loading...</div>}

          {!loading && filtered.length === 0 && (
            <div className="text-xs text-muted py-8 text-center">
              {filter === 'all' ? 'No scheduled posts yet' : `No ${filter} posts`}
            </div>
          )}

          {filtered.map(p => {
            const st = STATUS_STYLES[p.status] || STATUS_STYLES.pending
            return (
              <div key={p.uuid} className="flex gap-3 py-2.5 border-b border-border last:border-none">
                {/* Thumbnail */}
                {p.image_url ? (
                  <img src={p.image_url} className="w-14 h-14 rounded object-cover flex-shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded bg-[#f5f5f5] flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] text-muted">No img</span>
                  </div>
                )}

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[11px] font-medium" style={{ color: PLATFORM_COLORS[p.platform] }}>
                      {PLATFORM_LABELS[p.platform] || p.platform}
                    </span>
                    <span className="text-[10px] py-0.5 px-1.5 rounded-full font-medium" style={{ background: st.bg, color: st.text }}>
                      {st.label}
                    </span>
                    <span className="text-[10px] text-muted ml-auto">
                      {new Date(p.scheduled_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>

                  {p.title && <div className="text-[11px] font-medium text-ink truncate">{p.title}</div>}
                  <div className="text-[10px] text-muted truncate" title={p.caption}>
                    {p.caption.slice(0, 120)}{p.caption.length > 120 ? '...' : ''}
                  </div>

                  {p.error_message && (
                    <div className="text-[10px] text-[#c0392b] mt-0.5 truncate" title={p.error_message}>
                      {p.error_message}
                    </div>
                  )}

                  {p.posted_at && (
                    <div className="text-[10px] text-muted mt-0.5">
                      Posted {new Date(p.posted_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 mt-1">
                    {p.status === 'pending' && (
                      <button onClick={() => handleCancel(p.uuid)} className="text-[10px] text-red-500 hover:underline">Cancel</button>
                    )}
                    {p.status === 'failed' && (
                      <button onClick={() => handleRetry(p.uuid)} className="text-[10px] text-[#6C5CE7] hover:underline">Retry now</button>
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
      </div>
    </div>
  )
}
