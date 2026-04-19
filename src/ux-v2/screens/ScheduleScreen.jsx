import { useState } from 'react'

/**
 * Schedule screen — cross-draft, cross-channel view of what's scheduled.
 * Three view modes:
 *   - List  : agenda-by-date (existing)
 *   - Week  : Sat→Fri grid, posts arranged by day (matches the existing
 *             app's Calendar weekly view)
 *   - Month : traditional calendar grid, dots per day indicate count
 */

const SAMPLE_SCHEDULED = [
  { id: 'p-1', date: '2026-04-18', time: '18:00', channel: 'TikTok',    draft: 'Poppy & Thyme birthday reel', status: 'scheduled' },
  { id: 'p-2', date: '2026-04-18', time: '19:30', channel: 'Instagram', draft: 'Poppy & Thyme birthday reel', status: 'scheduled' },
  { id: 'p-3', date: '2026-04-19', time: '12:15', channel: 'Facebook',  draft: 'Workshop behind-scenes',       status: 'scheduled' },
  { id: 'p-4', date: '2026-04-19', time: '20:00', channel: 'YouTube',   draft: 'Workshop behind-scenes',       status: 'scheduled' },
  { id: 'p-5', date: '2026-04-20', time: '10:30', channel: 'TikTok',    draft: 'Perfume party sizzle',          status: 'scheduled' },
  { id: 'p-6', date: '2026-04-20', time: '17:00', channel: 'Instagram', draft: 'Perfume party sizzle',          status: 'scheduled' },
  { id: 'p-7', date: '2026-04-21', time: '12:00', channel: 'GBP',       draft: 'Hours update',                  status: 'scheduled' },
  { id: 'p-8', date: '2026-04-22', time: '18:00', channel: 'TikTok',    draft: 'Scent of the week',             status: 'scheduled' },
  { id: 'p-9', date: '2026-04-24', time: '10:00', channel: 'Instagram', draft: 'Saturday open house',           status: 'scheduled' },
]

const DAY_LABELS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const MONTH_DAY_LABELS = ['S', 'S', 'M', 'T', 'W', 'T', 'F'] // compact
// Real app may start week on Sunday — mirror that if user prefers via setting
// For mockup: start on Saturday as user requested.

function startOfWeek(date) {
  const d = new Date(date)
  // Saturday = 6 in getDay(). Back up to the most recent Saturday.
  const daysBack = (d.getDay() + 1) % 7 // Sat→0, Sun→1, ..., Fri→6
  d.setDate(d.getDate() - daysBack)
  d.setHours(0, 0, 0, 0)
  return d
}

function yyyymmdd(d) {
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${d.getFullYear()}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`
}

function monthStart(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1)
  return d
}

export default function ScheduleScreen() {
  const [view, setView] = useState('list') // 'list' | 'week' | 'month'
  const [anchor, setAnchor] = useState(new Date('2026-04-18'))

  // Group posts by date-string
  const byDate = SAMPLE_SCHEDULED.reduce((acc, p) => {
    if (!acc[p.date]) acc[p.date] = []
    acc[p.date].push(p)
    return acc
  }, {})

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="text-[14px] font-medium flex-1">Schedule</h1>
        <div className="flex items-center gap-0.5 bg-white rounded-md p-0.5 border border-[#e5e5e5]">
          {[
            { key: 'list',  label: 'List' },
            { key: 'week',  label: 'Week' },
            { key: 'month', label: 'Month' },
          ].map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`text-[9px] py-1 px-2.5 rounded border-none cursor-pointer ${view === v.key ? 'bg-[#6C5CE7] text-white' : 'bg-transparent text-muted'}`}
            >{v.label}</button>
          ))}
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
        <span className="bg-[#6C5CE7]/10 text-[#6C5CE7] rounded-full px-2 py-0.5">
          {SAMPLE_SCHEDULED.length} scheduled
        </span>
        <span className="bg-[#2D9A5E]/10 text-[#2D9A5E] rounded-full px-2 py-0.5">
          0 posted today
        </span>
        <span className="bg-[#c0392b]/10 text-[#c0392b] rounded-full px-2 py-0.5">
          0 failed
        </span>
      </div>

      {view === 'list' && <ListView byDate={byDate} />}
      {view === 'week' && <WeekView byDate={byDate} anchor={anchor} setAnchor={setAnchor} />}
      {view === 'month' && <MonthView byDate={byDate} anchor={anchor} setAnchor={setAnchor} />}

      <div className="text-[10px] text-muted italic text-center py-2">
        Tap a post to edit caption, reschedule, or unschedule before it fires.
      </div>
    </div>
  )
}

function statusDotColor(status) {
  return status === 'posted' ? '#2D9A5E' : status === 'failed' ? '#c0392b' : '#6C5CE7'
}

// --- List view: agenda, grouped by date ------------------------------------
function ListView({ byDate }) {
  const dates = Object.keys(byDate).sort()
  return (
    <div className="space-y-2">
      {dates.map(d => {
        const posts = byDate[d]
        const label = new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
        return (
          <div key={d}>
            <div className="text-[10px] font-medium text-muted uppercase tracking-wide px-1 pb-1">{label}</div>
            <div className="space-y-1">
              {posts.map(p => (
                <div key={p.id} className="flex items-center gap-2 bg-white border border-[#e5e5e5] rounded p-2 text-[10px] cursor-pointer active:bg-[#f8f7f3]">
                  <div className="w-1 h-10 rounded-full flex-shrink-0" style={{ background: statusDotColor(p.status) }} />
                  <div className="text-[11px] font-mono text-muted w-12 flex-shrink-0">{p.time}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.draft}</div>
                    <div className="text-[9px] text-muted">{p.channel}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// --- Week view: Sat→Fri columns with posts stacked under each day ----------
function WeekView({ byDate, anchor, setAnchor }) {
  const start = startOfWeek(anchor)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
  const weekEnd = new Date(start)
  weekEnd.setDate(start.getDate() + 6)

  const prev = () => { const d = new Date(anchor); d.setDate(d.getDate() - 7); setAnchor(d) }
  const next = () => { const d = new Date(anchor); d.setDate(d.getDate() + 7); setAnchor(d) }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button onClick={prev} className="text-[11px] py-1 px-2 border border-[#e5e5e5] rounded bg-white cursor-pointer">←</button>
        <div className="text-[11px] font-medium text-center flex-1">
          {start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </div>
        <button onClick={next} className="text-[11px] py-1 px-2 border border-[#e5e5e5] rounded bg-white cursor-pointer">→</button>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d, i) => {
          const key = yyyymmdd(d)
          const posts = byDate[key] || []
          const isToday = key === yyyymmdd(new Date('2026-04-18')) // fake "today" for mockup
          return (
            <div key={key} className={`bg-white border border-[#e5e5e5] rounded p-1 min-h-[120px] ${isToday ? 'border-[#6C5CE7] bg-[#f3f0ff]' : ''}`}>
              <div className="text-center pb-1 border-b border-[#e5e5e5] mb-1">
                <div className="text-[8px] text-muted font-medium">{DAY_LABELS[i]}</div>
                <div className={`text-[11px] font-bold ${isToday ? 'text-[#6C5CE7]' : 'text-ink'}`}>{d.getDate()}</div>
              </div>
              <div className="space-y-0.5">
                {posts.map(p => (
                  <div
                    key={p.id}
                    className="text-[8px] rounded px-1 py-0.5 overflow-hidden"
                    style={{ background: statusDotColor(p.status) + '20', borderLeft: `2px solid ${statusDotColor(p.status)}` }}
                    title={`${p.time} · ${p.channel} · ${p.draft}`}
                  >
                    <div className="font-mono text-muted">{p.time.slice(0, 5)}</div>
                    <div className="truncate font-medium">{p.channel}</div>
                  </div>
                ))}
                {posts.length === 0 && <div className="text-[8px] text-muted text-center pt-2 italic">—</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// --- Month view: 6-week grid, post count badge per day ---------------------
function MonthView({ byDate, anchor, setAnchor }) {
  const m = monthStart(anchor)
  // Find the Saturday-of-or-before the first of the month
  const gridStart = startOfWeek(m)
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d
  })
  const monthLabel = m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const prev = () => { const d = new Date(anchor); d.setMonth(d.getMonth() - 1); setAnchor(d) }
  const next = () => { const d = new Date(anchor); d.setMonth(d.getMonth() + 1); setAnchor(d) }

  const [selectedDay, setSelectedDay] = useState(null)
  const selectedPosts = selectedDay ? (byDate[selectedDay] || []) : null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button onClick={prev} className="text-[11px] py-1 px-2 border border-[#e5e5e5] rounded bg-white cursor-pointer">←</button>
        <div className="text-[12px] font-medium text-center flex-1">{monthLabel}</div>
        <button onClick={next} className="text-[11px] py-1 px-2 border border-[#e5e5e5] rounded bg-white cursor-pointer">→</button>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 gap-0.5">
        {MONTH_DAY_LABELS.map((l, i) => (
          <div key={i} className="text-center text-[9px] text-muted font-medium py-1">{l}</div>
        ))}
      </div>

      {/* Date grid */}
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d, i) => {
          const key = yyyymmdd(d)
          const posts = byDate[key] || []
          const inMonth = d.getMonth() === m.getMonth()
          const isToday = key === yyyymmdd(new Date('2026-04-18'))
          return (
            <button
              key={i}
              onClick={() => setSelectedDay(posts.length > 0 ? key : null)}
              className={`aspect-square border rounded flex flex-col items-center justify-center bg-white cursor-pointer ${inMonth ? 'border-[#e5e5e5]' : 'border-transparent opacity-40'} ${isToday ? 'border-[#6C5CE7] bg-[#f3f0ff]' : ''}`}
            >
              <div className={`text-[11px] ${isToday ? 'text-[#6C5CE7] font-bold' : 'text-ink'}`}>{d.getDate()}</div>
              {posts.length > 0 && (
                <div className="flex gap-0.5 mt-0.5">
                  {posts.slice(0, 3).map((p, j) => (
                    <span key={j} className="w-1 h-1 rounded-full" style={{ background: statusDotColor(p.status) }} />
                  ))}
                  {posts.length > 3 && <span className="text-[7px] text-muted">+{posts.length - 3}</span>}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Selected day details */}
      {selectedPosts && selectedPosts.length > 0 && (
        <div className="border-t border-[#e5e5e5] pt-2 space-y-1">
          <div className="text-[10px] font-medium text-muted uppercase tracking-wide">
            {new Date(selectedDay).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </div>
          {selectedPosts.map(p => (
            <div key={p.id} className="flex items-center gap-2 bg-white border border-[#e5e5e5] rounded p-2 text-[10px]">
              <div className="w-1 h-10 rounded-full flex-shrink-0" style={{ background: statusDotColor(p.status) }} />
              <div className="text-[11px] font-mono text-muted w-12 flex-shrink-0">{p.time}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{p.draft}</div>
                <div className="text-[9px] text-muted">{p.channel}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
