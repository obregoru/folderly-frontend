import { useState } from 'react'

/**
 * History screen — past posts across all drafts/channels. Status,
 * analytics if available, link to the live post. Filter by channel,
 * status, date range.
 */

const SAMPLE_HISTORY = [
  { id: 'h-1', date: '2026-04-17', time: '20:15', channel: 'TikTok',    draft: 'Workshop behind-scenes', status: 'posted',  url: 'https://tiktok.com/…', views: '12.3K', likes: '892', comments: 47, thumb: 'https://picsum.photos/seed/h1/60/80' },
  { id: 'h-2', date: '2026-04-17', time: '20:15', channel: 'Instagram', draft: 'Workshop behind-scenes', status: 'posted',  url: 'https://instagram.com/…', views: '4.1K', likes: '321', comments: 22, thumb: 'https://picsum.photos/seed/h2/60/80' },
  { id: 'h-3', date: '2026-04-17', time: '09:00', channel: 'YouTube',   draft: 'Intro to perfume notes', status: 'posted',  url: 'https://youtube.com/…', views: '856', likes: '47', comments: 3, thumb: 'https://picsum.photos/seed/h3/60/80' },
  { id: 'h-4', date: '2026-04-16', time: '18:30', channel: 'Facebook',  draft: 'Date night post', status: 'failed', error: 'Access token expired — reconnect Facebook',     thumb: 'https://picsum.photos/seed/h4/60/80' },
  { id: 'h-5', date: '2026-04-15', time: '12:00', channel: 'GBP',       draft: 'Hours update',    status: 'posted',  url: 'https://business.google.com/…',    thumb: null },
  { id: 'h-6', date: '2026-04-14', time: '17:00', channel: 'TikTok',    draft: 'Girls night teaser', status: 'posted', url: 'https://tiktok.com/…', views: '28.7K', likes: '2.1K', comments: 114, thumb: 'https://picsum.photos/seed/h6/60/80' },
]

const CHANNEL_FILTERS = ['All', 'TikTok', 'Instagram', 'Facebook', 'YouTube', 'GBP', 'Blog']
const STATUS_FILTERS = ['All', 'Posted', 'Failed']

export default function HistoryScreen() {
  const [channelFilter, setChannelFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')

  const filtered = SAMPLE_HISTORY.filter(p => {
    if (channelFilter !== 'All' && p.channel !== channelFilter) return false
    if (statusFilter === 'Posted' && p.status !== 'posted') return false
    if (statusFilter === 'Failed' && p.status !== 'failed') return false
    return true
  })

  const postedCount = SAMPLE_HISTORY.filter(p => p.status === 'posted').length
  const failedCount = SAMPLE_HISTORY.filter(p => p.status === 'failed').length

  return (
    <div className="p-3 space-y-3">
      <h1 className="text-[14px] font-medium">History</h1>

      {/* Summary */}
      <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
        <span className="bg-[#2D9A5E]/10 text-[#2D9A5E] rounded-full px-2 py-0.5">
          {postedCount} posted
        </span>
        <span className="bg-[#c0392b]/10 text-[#c0392b] rounded-full px-2 py-0.5">
          {failedCount} failed
        </span>
      </div>

      {/* Filters */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1 overflow-x-auto">
          {CHANNEL_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setChannelFilter(f)}
              className={`text-[9px] py-1 px-2 rounded border whitespace-nowrap cursor-pointer ${channelFilter === f ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]' : 'bg-white text-muted border-[#e5e5e5]'}`}
            >{f}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`text-[9px] py-1 px-2 rounded border cursor-pointer ${statusFilter === f ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]' : 'bg-white text-muted border-[#e5e5e5]'}`}
            >{f}</button>
          ))}
        </div>
      </div>

      {/* Posts */}
      <div className="space-y-1.5">
        {filtered.length === 0 && (
          <div className="text-[11px] text-muted italic text-center py-8">No posts match the filter.</div>
        )}
        {filtered.map(p => (
          <div
            key={p.id}
            className={`flex items-start gap-2 bg-white border rounded p-2 text-[10px] ${p.status === 'failed' ? 'border-[#c0392b]/40' : 'border-[#e5e5e5]'}`}
          >
            {p.thumb ? (
              <img src={p.thumb} alt="" className="w-10 h-14 object-cover rounded flex-shrink-0" />
            ) : (
              <div className="w-10 h-14 bg-[#e5e5e5] rounded flex-shrink-0 flex items-center justify-center text-[9px] text-muted">—</div>
            )}
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate text-[11px]">{p.draft}</div>
              <div className="text-[9px] text-muted flex items-center gap-1 flex-wrap">
                <span>{p.channel}</span>
                <span>·</span>
                <span>{p.date} {p.time}</span>
              </div>
              {p.status === 'posted' && p.views && (
                <div className="text-[9px] text-muted mt-0.5">
                  👁 {p.views} · ❤ {p.likes} · 💬 {p.comments}
                </div>
              )}
              {p.status === 'failed' && p.error && (
                <div className="text-[9px] text-[#c0392b] mt-0.5">⚠ {p.error}</div>
              )}
              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                {p.url && (
                  <a href={p.url} target="_blank" rel="noopener" onClick={e => e.preventDefault()} className="text-[9px] text-[#6C5CE7] bg-white border border-[#e5e5e5] rounded py-0.5 px-1.5">View live ↗</a>
                )}
                {p.status === 'failed' && (
                  <button className="text-[9px] text-[#2D9A5E] bg-white border border-[#2D9A5E] rounded py-0.5 px-1.5 cursor-pointer">Retry</button>
                )}
                <button className="text-[9px] text-muted bg-white border border-[#e5e5e5] rounded py-0.5 px-1.5 cursor-pointer">Duplicate →</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
