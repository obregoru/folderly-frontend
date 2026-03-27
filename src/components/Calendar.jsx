import { useState, useEffect } from 'react'
import * as api from '../api'

const PLAT_COLORS = {
  facebook: '#1877F2', facebook_story: '#4267B2', facebook_reel: '#1877F2',
  instagram: '#E1306C', instagram_story: '#833AB4',
  twitter: '#000', tiktok: '#000', google: '#4285F4',
  youtube: '#FF0000', pinterest: '#E60023', blog: '#21759B',
}
const PLAT_SHORT = {
  facebook: 'FB', facebook_story: 'FBs', facebook_reel: 'FBr',
  instagram: 'IG', instagram_story: 'IGs',
  twitter: 'X', tiktok: 'TT', google: 'GBP',
  youtube: 'YT', pinterest: 'Pin', blog: 'Blog',
}
const STATUS_COLORS = { posted: '#2D9A5E', pending: '#6C5CE7', failed: '#c0392b', cancelled: '#999' }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getMonthDays(year, month) {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const days = []
  // Pad start
  for (let i = 0; i < first.getDay(); i++) {
    const d = new Date(year, month, -first.getDay() + i + 1)
    days.push({ date: d, outside: true })
  }
  for (let d = 1; d <= last.getDate(); d++) {
    days.push({ date: new Date(year, month, d), outside: false })
  }
  // Pad end
  while (days.length % 7 !== 0) {
    const d = new Date(year, month + 1, days.length - last.getDate() - first.getDay() + 1)
    days.push({ date: d, outside: true })
  }
  return days
}

function fmt(d) { return d.toISOString().slice(0, 10) }
function fmtTime(d) { return new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }

export default function Calendar() {
  const [view, setView] = useState('month') // month, week, day
  const [current, setCurrent] = useState(new Date())
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(null) // selected date for detail
  const [backfilling, setBackfilling] = useState(false)

  const year = current.getFullYear()
  const month = current.getMonth()

  useEffect(() => {
    let start, end
    if (view === 'month') {
      start = new Date(year, month, 1)
      end = new Date(year, month + 1, 1)
    } else if (view === 'week') {
      const day = current.getDay()
      start = new Date(current); start.setDate(current.getDate() - day); start.setHours(0,0,0,0)
      end = new Date(start); end.setDate(start.getDate() + 7)
    } else {
      start = new Date(current); start.setHours(0,0,0,0)
      end = new Date(start); end.setDate(start.getDate() + 1)
    }
    api.getCalendar(start.toISOString(), end.toISOString()).then(setData).catch(() => {})
  }, [current, view])

  const postsForDate = (dateStr) => {
    if (!data?.scheduled) return []
    return data.scheduled.filter(p => fmt(new Date(p.scheduled_at)) === dateStr)
  }

  const handleBackfill = async () => {
    setBackfilling(true)
    try {
      const r = await api.backfillJobNames()
      alert(`Updated ${r.updated} of ${r.total} posts with AI-generated names.`)
      // Refresh
      setCurrent(new Date(current))
    } catch (e) { alert('Failed: ' + e.message) }
    setBackfilling(false)
  }

  const nav = (dir) => {
    const d = new Date(current)
    if (view === 'month') d.setMonth(d.getMonth() + dir)
    else if (view === 'week') d.setDate(d.getDate() + dir * 7)
    else d.setDate(d.getDate() + dir)
    setCurrent(d)
  }

  const monthDays = getMonthDays(year, month)
  const today = fmt(new Date())

  return (
    <div className="bg-white border border-border rounded p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button onClick={() => nav(-1)} className="text-[12px] px-1.5 py-0.5 border border-border rounded cursor-pointer bg-white hover:bg-cream">&lt;</button>
          <span className="text-[13px] font-medium text-ink min-w-[140px] text-center">
            {view === 'month' && current.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            {view === 'week' && (() => {
              const start = new Date(current); start.setDate(current.getDate() - current.getDay())
              const end = new Date(start); end.setDate(start.getDate() + 6)
              return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
            })()}
            {view === 'day' && current.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
          <button onClick={() => nav(1)} className="text-[12px] px-1.5 py-0.5 border border-border rounded cursor-pointer bg-white hover:bg-cream">&gt;</button>
          <button onClick={() => setCurrent(new Date())} className="text-[10px] px-1.5 py-0.5 border border-border rounded cursor-pointer bg-white hover:bg-cream">Today</button>
        </div>
        <div className="flex gap-1">
          {['day', 'week', 'month'].map(v => (
            <button key={v} onClick={() => setView(v)} className={`text-[10px] px-2 py-0.5 rounded cursor-pointer border ${view === v ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]' : 'bg-white text-muted border-border hover:bg-cream'}`}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Backfill button */}
      {data?.scheduled?.some(p => !p.job_name) && (
        <button onClick={handleBackfill} disabled={backfilling} className="text-[9px] text-[#6C5CE7] hover:underline mb-2 disabled:opacity-50">
          {backfilling ? 'Generating names...' : 'Generate names for unnamed posts'}
        </button>
      )}

      {/* Month view */}
      {view === 'month' && (
        <div>
          <div className="grid grid-cols-7 gap-0">
            {DAYS.map(d => <div key={d} className="text-[9px] text-muted text-center py-1 font-medium">{d}</div>)}
            {monthDays.map((d, i) => {
              const dateStr = fmt(d.date)
              const posts = postsForDate(dateStr)
              const isToday = dateStr === today
              const isSelected = selected === dateStr
              return (
                <div
                  key={i}
                  onClick={() => { setSelected(dateStr); if (posts.length > 0) setView('day'); setCurrent(d.date) }}
                  className={`min-h-[48px] border border-border/50 p-0.5 cursor-pointer hover:bg-cream/50 ${d.outside ? 'bg-[#fafafa]' : 'bg-white'} ${isToday ? 'ring-1 ring-[#6C5CE7]' : ''} ${isSelected ? 'bg-[#f3f0ff]' : ''}`}
                >
                  <div className={`text-[10px] ${d.outside ? 'text-[#ccc]' : isToday ? 'text-[#6C5CE7] font-bold' : 'text-ink'}`}>
                    {d.date.getDate()}
                  </div>
                  {posts.length > 0 && (
                    <div className="flex flex-wrap gap-[2px] mt-0.5">
                      {posts.slice(0, 4).map((p, j) => (
                        <div key={j} className="w-[6px] h-[6px] rounded-full" style={{ background: STATUS_COLORS[p.status] || PLAT_COLORS[p.platform] || '#999' }} title={`${PLAT_SHORT[p.platform] || p.platform} - ${p.job_name || 'unnamed'} (${p.status})`} />
                      ))}
                      {posts.length > 4 && <span className="text-[7px] text-muted">+{posts.length - 4}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Week view */}
      {view === 'week' && (() => {
        const start = new Date(current); start.setDate(current.getDate() - current.getDay()); start.setHours(0,0,0,0)
        const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
        return (
          <div className="grid grid-cols-7 gap-1">
            {weekDays.map((d, i) => {
              const dateStr = fmt(d)
              const posts = postsForDate(dateStr)
              const isToday = dateStr === today
              return (
                <div key={i} className={`min-h-[100px] border border-border rounded p-1 ${isToday ? 'ring-1 ring-[#6C5CE7]' : ''}`}>
                  <div className={`text-[10px] font-medium mb-1 ${isToday ? 'text-[#6C5CE7]' : 'text-ink'}`}>
                    {DAYS[d.getDay()]} {d.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {posts.map((p, j) => (
                      <div key={j} className="flex items-center gap-1 text-[8px] leading-tight" title={p.caption?.substring(0, 100)}>
                        <span className="w-[5px] h-[5px] rounded-full flex-shrink-0" style={{ background: PLAT_COLORS[p.platform] || '#999' }} />
                        <span className="text-[8px] font-medium" style={{ color: PLAT_COLORS[p.platform] }}>{PLAT_SHORT[p.platform]}</span>
                        <span className="text-muted truncate">{p.job_name || fmtTime(p.scheduled_at)}</span>
                        <span className="w-[5px] h-[5px] rounded-full flex-shrink-0 ml-auto" style={{ background: STATUS_COLORS[p.status] }} />
                      </div>
                    ))}
                    {posts.length === 0 && <span className="text-[8px] text-[#ddd]">-</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* Day view */}
      {view === 'day' && (() => {
        const dateStr = fmt(current)
        const posts = postsForDate(dateStr)
        return (
          <div>
            {posts.length === 0 && <p className="text-[11px] text-muted text-center py-4">No posts scheduled for this day</p>}
            <div className="space-y-1.5">
              {posts.map((p, i) => (
                <div key={i} className="flex items-start gap-2 p-2 border border-border rounded bg-[#fafafa]">
                  <div className="flex flex-col items-center gap-0.5 min-w-[40px]">
                    <span className="text-[10px] font-medium" style={{ color: PLAT_COLORS[p.platform] }}>{PLAT_SHORT[p.platform]}</span>
                    <span className="w-[8px] h-[8px] rounded-full" style={{ background: STATUS_COLORS[p.status] }} />
                    <span className="text-[8px] text-muted">{p.status}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-ink">{p.job_name || 'Unnamed post'}</span>
                      <span className="text-[10px] text-muted">{fmtTime(p.scheduled_at)}</span>
                    </div>
                    <p className="text-[10px] text-muted mt-0.5 line-clamp-2">{p.caption?.substring(0, 150)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border">
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1">
            <div className="w-[6px] h-[6px] rounded-full" style={{ background: color }} />
            <span className="text-[8px] text-muted capitalize">{status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
