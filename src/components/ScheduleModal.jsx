import { useState, useEffect, useCallback } from 'react'
import * as api from '../api'

const PLATFORM_LABELS = { facebook: 'Facebook', instagram: 'Instagram', twitter: 'X', blog: 'WordPress', google: 'Google', tiktok: 'TikTok', youtube: 'YouTube', pinterest: 'Pinterest' }
const PLATFORM_COLORS = { facebook: '#1877F2', instagram: '#E1306C', twitter: '#000', blog: '#21759B', google: '#4285F4', tiktok: '#2D9A5E', youtube: '#FF0000', pinterest: '#E60023' }
const STATUS_STYLES = {
  pending: { bg: '#f3f0ff', text: '#6C5CE7', label: 'Pending' },
  posted: { bg: '#e8efe9', text: '#2D9A5E', label: 'Posted' },
  failed: { bg: '#fdeaea', text: '#c0392b', label: 'Failed' },
  cancelled: { bg: '#f5f5f5', text: '#999', label: 'Cancelled' },
}

const VIEWS = ['day', 'week', 'month']
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FILTERS = ['all', 'pending', 'posted', 'failed']

function getDayRange(date) {
  const from = new Date(date); from.setHours(0, 0, 0, 0)
  const to = new Date(from); to.setDate(to.getDate() + 1)
  return { from, to }
}

function getWeekRange(date) {
  const d = new Date(date)
  const day = d.getDay()
  const from = new Date(d); from.setDate(d.getDate() - day); from.setHours(0, 0, 0, 0)
  const to = new Date(from); to.setDate(from.getDate() + 7)
  return { from, to }
}

function getMonthRange(date) {
  const from = new Date(date.getFullYear(), date.getMonth(), 1)
  const to = new Date(date.getFullYear(), date.getMonth() + 1, 1)
  return { from, to }
}

function formatRange(view, anchor) {
  if (view === 'day') return anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  if (view === 'week') {
    const { from, to } = getWeekRange(anchor)
    const toDay = new Date(to); toDay.setDate(toDay.getDate() - 1)
    return `${from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} — ${toDay.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
  }
  return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isToday(date) { return isSameDay(date, new Date()) }

// Platform dot
function PlatDot({ platform, size = 6 }) {
  return <span className="inline-block rounded-full flex-shrink-0" style={{ width: size, height: size, background: PLATFORM_COLORS[platform] || '#999' }} title={PLATFORM_LABELS[platform] || platform} />
}

// Media type helpers
function getMediaType(post) {
  if (!post.media_type && !post.image_url) return 'text'
  const mt = post.media_type || ''
  if (mt.startsWith('video/')) return 'video'
  if (post.platform === 'youtube' || post.platform === 'youtube_shorts') return 'short'
  return 'image'
}
const MEDIA_BADGES = {
  image: { label: 'Image', bg: '#e8efe9', text: '#2D9A5E' },
  video: { label: 'Video', bg: '#fff3cd', text: '#856404' },
  short: { label: 'Short', bg: '#fdeaea', text: '#FF0000' },
  text: { label: 'Text', bg: '#f5f5f5', text: '#999' },
}

// Lightbox for viewing scheduled media
function MediaLightbox({ url, mediaType, onClose }) {
  const isVideo = mediaType?.startsWith('video/')
  return (
    <div className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative max-w-[90vw] max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-ink text-lg flex items-center justify-center shadow cursor-pointer border-none z-10">&times;</button>
        {isVideo ? (
          <video src={url} controls autoPlay playsInline className="max-w-full max-h-[80vh] rounded" />
        ) : (
          <img src={url} className="max-w-full max-h-[80vh] rounded object-contain" />
        )}
      </div>
    </div>
  )
}

// Single post row — tap to expand and see full details
function PostRow({ post, onCancel, onRetry, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const [showMedia, setShowMedia] = useState(false)
  const st = STATUS_STYLES[post.status] || STATUS_STYLES.pending
  const time = new Date(post.scheduled_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const fullDate = new Date(post.scheduled_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const mType = getMediaType(post)
  const mBadge = MEDIA_BADGES[mType]
  const isStory = post.platform?.includes('story')

  return (
    <div className="border-b border-border/30 last:border-none">
      {/* Media lightbox */}
      {showMedia && post.image_url && (
        <MediaLightbox url={post.image_url} mediaType={post.media_type || ''} onClose={() => setShowMedia(false)} />
      )}
      {showMedia && !post.image_url && (
        <div className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4" onClick={() => setShowMedia(false)}>
          <div className="bg-white rounded p-6 text-center" onClick={e => e.stopPropagation()}>
            <p className="text-sm text-muted">No media preview available</p>
            <button onClick={() => setShowMedia(false)} className="mt-2 text-[10px] text-sage hover:underline">Close</button>
          </div>
        </div>
      )}

      {/* Compact row — tap to expand */}
      <div className="flex items-start gap-2 py-1.5 cursor-pointer hover:bg-[#fafafa]" onClick={() => setExpanded(!expanded)}>
        <span className="text-[10px] text-muted min-w-[52px] pt-0.5">{time}</span>
        <PlatDot platform={post.platform?.replace('_story', '')} size={8} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] font-medium" style={{ color: PLATFORM_COLORS[post.platform?.replace('_story', '')] }}>
              {PLATFORM_LABELS[post.platform?.replace('_story', '')] || post.platform}
            </span>
            {isStory && <span className="text-[8px] py-0.5 px-1 rounded-full bg-[#f3e8ff] text-[#9333ea]">Story</span>}
            <span className="text-[8px] py-0.5 px-1 rounded-full" style={{ background: mBadge.bg, color: mBadge.text }}>{mBadge.label}</span>
            <span className="text-[8px] py-0.5 px-1 rounded-full" style={{ background: st.bg, color: st.text }}>{st.label}</span>
          </div>
          <div className="text-[9px] text-muted truncate">{post.caption?.slice(0, 80)}</div>
        </div>
        <span className="text-[9px] text-muted flex-shrink-0 pt-0.5">{expanded ? '▾' : '▸'}</span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="pb-2 pl-[60px] pr-2">
          {/* Media preview — click to open lightbox */}
          {post.image_url && (
            <div
              onClick={(e) => { e.stopPropagation(); setShowMedia(true) }}
              className="relative cursor-pointer group mb-1.5 inline-block"
            >
              {mType === 'video' || mType === 'short' ? (
                <div className="relative">
                  <img src={post.image_url} className="max-w-[200px] h-auto rounded object-cover group-hover:opacity-80" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="w-10 h-10 rounded-full bg-black/60 text-white text-lg flex items-center justify-center">▶</span>
                  </div>
                </div>
              ) : (
                <img src={post.image_url} className="max-w-[200px] h-auto rounded object-cover group-hover:opacity-80" />
              )}
              <span className="text-[8px] text-muted mt-0.5 block">Tap to view full size</span>
            </div>
          )}

          {/* Full details */}
          <div className="text-[10px] text-ink mb-1">
            <span className="font-medium" style={{ color: PLATFORM_COLORS[post.platform?.replace('_story', '')] }}>
              {PLATFORM_LABELS[post.platform?.replace('_story', '')] || post.platform}
            </span>
            {isStory && <span className="text-[9px] text-[#9333ea] ml-1">(Story)</span>}
            <span className="text-[9px] text-muted ml-1">({mBadge.label})</span>
          </div>
          <div className="text-[10px] text-muted mb-1">{fullDate}</div>

          {post.title && <div className="text-[10px] font-medium text-ink mb-0.5">{post.title}</div>}

          {/* Full caption */}
          <div className="text-[10px] text-ink whitespace-pre-wrap leading-relaxed bg-white border border-border rounded p-2 mb-1.5 max-h-[150px] overflow-y-auto">
            {post.caption}
          </div>

          {post.error_message && (
            <div className="text-[10px] text-[#c0392b] bg-[#fdeaea] rounded p-1.5 mb-1.5">{post.error_message}</div>
          )}

          {/* Actions */}
          <div className="flex gap-2 items-center flex-wrap">
            <button
              onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(post.caption); }}
              className="text-[9px] py-0.5 px-2 border border-border rounded bg-white hover:bg-cream cursor-pointer"
            >Copy caption</button>
            <button
              onClick={(e) => { e.stopPropagation(); setShowMedia(true) }}
              className="text-[9px] py-0.5 px-2 border border-border rounded bg-white hover:bg-cream cursor-pointer"
            >{mType === 'video' || mType === 'short' ? 'Play video' : 'View media'}</button>
            {post.status === 'pending' && (
              <button onClick={(e) => { e.stopPropagation(); if (confirm('Remove this scheduled post?')) onDelete(post.uuid) }} className="text-[9px] py-0.5 px-2 border border-[#c0392b] rounded text-[#c0392b] bg-white hover:bg-[#fdeaea] cursor-pointer">Remove</button>
            )}
            {post.status === 'failed' && (
              <>
                <button onClick={(e) => { e.stopPropagation(); onRetry(post.uuid) }} className="text-[9px] py-0.5 px-2 border border-[#6C5CE7] rounded text-[#6C5CE7] bg-white hover:bg-[#f3f0ff] cursor-pointer">Retry</button>
                <button onClick={(e) => { e.stopPropagation(); onDelete(post.uuid) }} className="text-[9px] py-0.5 px-2 border border-border rounded text-muted bg-white hover:bg-cream cursor-pointer">Remove</button>
              </>
            )}
            {(post.status === 'posted' || post.status === 'cancelled') && (
              <button onClick={(e) => { e.stopPropagation(); onDelete(post.uuid) }} className="text-[9px] py-0.5 px-2 border border-border rounded text-muted bg-white hover:bg-cream cursor-pointer">Remove</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Day View: timeline for a single day ──
function DayView({ posts, onCancel, onRetry, onDelete }) {
  const sorted = [...posts].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
  if (sorted.length === 0) return <div className="text-xs text-muted py-8 text-center">No posts scheduled</div>
  return (
    <div className="px-4 py-2">
      {sorted.map(p => <PostRow key={p.uuid} post={p} onCancel={onCancel} onRetry={onRetry} onDelete={onDelete} />)}
    </div>
  )
}

// ── Week View: 7-column grid ──
function WeekView({ posts, anchor, onDayClick, onCancel, onRetry, onDelete }) {
  const { from } = getWeekRange(anchor)
  const [selectedDay, setSelectedDay] = useState(null)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(from); d.setDate(d.getDate() + i); return d
  })

  const postsByDay = days.map(d =>
    posts.filter(p => isSameDay(new Date(p.scheduled_at), d))
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
  )

  const handleDayClick = (day, dayPosts) => {
    if (dayPosts.length === 0) return
    setSelectedDay(selectedDay && isSameDay(selectedDay, day) ? null : day)
  }

  return (
    <div>
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-border">
        {days.map((d, i) => (
          <div key={i} className={`text-center py-1.5 text-[10px] border-r border-border last:border-r-0 ${isToday(d) ? 'bg-[#f3f0ff]' : ''}`}>
            <div className="text-muted">{DAY_NAMES[d.getDay()]}</div>
            <div className={`font-medium ${isToday(d) ? 'text-[#6C5CE7]' : 'text-ink'}`}>{d.getDate()}</div>
          </div>
        ))}
      </div>
      {/* Day cells */}
      <div className="grid grid-cols-7 min-h-[120px]">
        {days.map((d, i) => {
          const dayPosts = postsByDay[i]
          const isSelected = selectedDay && isSameDay(selectedDay, d)
          return (
            <div
              key={i}
              onClick={() => handleDayClick(d, dayPosts)}
              className={`border-r border-border last:border-r-0 p-1 min-h-[100px] cursor-pointer hover:bg-[#fafafa] ${isToday(d) ? 'bg-[#faf8ff]' : ''} ${isSelected ? 'bg-[#f3f0ff]' : ''}`}
            >
              {dayPosts.map(p => (
                <div key={p.uuid} className="flex items-center gap-0.5 mb-0.5">
                  <PlatDot platform={p.platform} />
                  <span className="text-[8px] text-muted truncate">
                    {new Date(p.scheduled_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
              ))}
              {dayPosts.length === 0 && <div className="text-[8px] text-border text-center mt-6">—</div>}
            </div>
          )
        })}
      </div>
      {/* Expanded day detail */}
      {selectedDay && (
        <div className="border-t border-border bg-[#fafafa] px-3 py-2">
          <div className="text-[10px] font-medium text-ink mb-1">
            {selectedDay.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </div>
          {postsByDay[days.findIndex(d => isSameDay(d, selectedDay))]?.map(p => (
            <PostRow key={p.uuid} post={p} onCancel={onCancel} onRetry={onRetry} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Month View: calendar grid ──
function MonthView({ posts, anchor, onCancel, onRetry, onDelete }) {
  const [selectedDay, setSelectedDay] = useState(null)
  const year = anchor.getFullYear(), month = anchor.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  // Build calendar cells: leading blanks + actual days
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))

  const getPostsForDay = (d) => d ? posts.filter(p => isSameDay(new Date(p.scheduled_at), d)).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)) : []

  return (
    <div>
      {/* Day headers */}
      <div className="grid grid-cols-7">
        {DAY_NAMES.map(n => (
          <div key={n} className="text-center text-[9px] text-muted py-1 border-b border-border">{n}</div>
        ))}
      </div>
      {/* Calendar cells */}
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const dayPosts = getPostsForDay(d)
          const isSelected = d && selectedDay && isSameDay(selectedDay, d)
          return (
            <div
              key={i}
              onClick={() => d && dayPosts.length > 0 && setSelectedDay(isSelected ? null : d)}
              className={`border-b border-r border-border min-h-[48px] md:min-h-[56px] p-0.5 ${d ? 'cursor-pointer hover:bg-[#fafafa]' : 'bg-[#fafafa]'} ${d && isToday(d) ? 'bg-[#faf8ff]' : ''} ${isSelected ? 'bg-[#f3f0ff]' : ''}`}
            >
              {d && (
                <>
                  <div className={`text-[9px] ${isToday(d) ? 'text-[#6C5CE7] font-medium' : 'text-muted'}`}>{d.getDate()}</div>
                  <div className="flex flex-wrap gap-px mt-px">
                    {dayPosts.slice(0, 5).map(p => <PlatDot key={p.uuid} platform={p.platform} />)}
                    {dayPosts.length > 5 && <span className="text-[7px] text-muted">+{dayPosts.length - 5}</span>}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
      {/* Selected day detail */}
      {selectedDay && (
        <div className="border-t border-border bg-[#fafafa] px-3 py-2">
          <div className="text-[10px] font-medium text-ink mb-1">
            {selectedDay.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </div>
          {getPostsForDay(selectedDay).map(p => (
            <PostRow key={p.uuid} post={p} onCancel={onCancel} onRetry={onRetry} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function ScheduleModal({ onClose }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState('week')
  const [anchor, setAnchor] = useState(new Date())
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const LIMIT = 100

  const load = useCallback(async () => {
    setLoading(true)
    const params = { page, limit: LIMIT, status: filter }
    if (view === 'day') {
      const r = getDayRange(anchor)
      params.from = r.from.toISOString()
      params.to = r.to.toISOString()
    } else if (view === 'week') {
      const r = getWeekRange(anchor)
      params.from = r.from.toISOString()
      params.to = r.to.toISOString()
    } else {
      const r = getMonthRange(anchor)
      params.from = r.from.toISOString()
      params.to = r.to.toISOString()
    }
    try {
      const data = await api.getScheduledPosts(params)
      setPosts(data.posts || [])
      setTotal(data.total || 0)
      setPages(data.pages || 1)
    } catch {}
    setLoading(false)
  }, [filter, view, anchor, page])

  useEffect(() => { load() }, [load])

  const navigate = (dir) => {
    const d = new Date(anchor)
    if (view === 'day') d.setDate(d.getDate() + dir)
    else if (view === 'week') d.setDate(d.getDate() + dir * 7)
    else d.setMonth(d.getMonth() + dir)
    setAnchor(d)
    setPage(1)
  }

  const goToday = () => { setAnchor(new Date()); setPage(1) }

  const handleCancel = async (uuid) => { try { await api.cancelScheduledPost(uuid); load() } catch (err) { alert(err.message) } }
  const handleRetry = async (uuid) => { try { await api.retryScheduledPost(uuid); load() } catch (err) { alert(err.message) } }
  const handleDelete = async (uuid) => { try { await api.deleteScheduledPost(uuid); load() } catch {} }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20px] md:pt-[40px] bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-[720px] max-h-[90vh] flex flex-col mx-2" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <h2 className="text-sm font-medium text-ink">Schedule</h2>
          <button onClick={onClose} className="text-muted hover:text-ink text-lg leading-none bg-transparent border-none cursor-pointer">&times;</button>
        </div>

        {/* View toggle + nav */}
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-[#fafafa]">
          <div className="flex gap-1">
            {VIEWS.map(v => (
              <button
                key={v}
                onClick={() => { setView(v); setPage(1) }}
                className={`text-[10px] py-0.5 px-2 rounded border font-sans cursor-pointer capitalize ${
                  view === v ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-border'
                }`}
              >{v}</button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => navigate(-1)} className="text-muted hover:text-ink text-sm bg-transparent border-none cursor-pointer px-1">‹</button>
            <span className="text-[10px] text-ink font-medium min-w-[100px] md:min-w-[160px] text-center truncate">{formatRange(view, anchor)}</span>
            <button onClick={() => navigate(1)} className="text-muted hover:text-ink text-sm bg-transparent border-none cursor-pointer px-1">›</button>
            <button onClick={goToday} className="text-[9px] text-[#6C5CE7] hover:underline">Today</button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-muted">{total}</span>
            <button onClick={load} className="text-[9px] text-muted hover:underline">Refresh</button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-1 px-4 py-1 border-b border-border">
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(1) }}
              className={`text-[9px] py-0.5 px-1.5 rounded-full border font-sans cursor-pointer capitalize ${
                filter === f ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]' : 'bg-white text-muted border-border'
              }`}
            >{f}</button>
          ))}
        </div>

        {/* Calendar content */}
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="text-xs text-muted py-8 text-center">Loading...</div>}
          {!loading && view === 'day' && <DayView posts={posts} onCancel={handleCancel} onRetry={handleRetry} onDelete={handleDelete} />}
          {!loading && view === 'week' && <WeekView posts={posts} anchor={anchor} onCancel={handleCancel} onRetry={handleRetry} onDelete={handleDelete} />}
          {!loading && view === 'month' && <MonthView posts={posts} anchor={anchor} onCancel={handleCancel} onRetry={handleRetry} onDelete={handleDelete} />}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-2 px-4 py-1.5 border-t border-border bg-[#fafafa]">
          {Object.entries(PLATFORM_COLORS).filter(([k]) => PLATFORM_LABELS[k]).map(([k, color]) => (
            <div key={k} className="flex items-center gap-1">
              <span className="inline-block w-[6px] h-[6px] rounded-full" style={{ background: color }} />
              <span className="text-[8px] text-muted">{PLATFORM_LABELS[k]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
