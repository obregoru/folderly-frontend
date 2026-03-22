import { useState, useEffect, useRef, useCallback } from 'react'
import * as api from '../api'
import { getWeekStart, formatWeekRange, isCurrentWeek, getWeekSaturation } from '../lib/weekSlots'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PLATFORM_COLORS = { facebook: '#1877F2', instagram: '#E1306C', twitter: '#000', tiktok: '#2D9A5E', google: '#4285F4', youtube: '#FF0000', pinterest: '#E60023', blog: '#21759B' }
const PLATFORM_LABELS = { facebook: 'Facebook', instagram: 'Instagram', twitter: 'X', tiktok: 'TikTok', google: 'Google', youtube: 'YouTube', pinterest: 'Pinterest', blog: 'WordPress' }

function WeekCard({ week, selected, isCurrent, maxPerPlatform, onClick }) {
  const total = week.total_scheduled + week.total_posted
  const maxTotal = maxPerPlatform || 10
  const fillPct = Math.min(100, (total / maxTotal) * 100)
  const fillColor = total === 0 ? '#ddd' : fillPct >= 100 ? '#c0392b' : fillPct >= 70 ? '#e67e22' : '#2D9A5E'

  return (
    <button
      onClick={onClick}
      className={`week-card ${selected ? 'selected' : ''} ${isCurrent ? 'current' : ''}`}
    >
      <div className="text-[9px] font-medium text-ink leading-tight">
        {new Date(week.week_start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </div>
      <div className="text-[8px] text-muted leading-tight">
        {new Date(new Date(week.week_start).getTime() + 6 * 86400000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </div>
      <div className="week-fill" style={{ '--fill-color': fillColor, width: `${Math.max(fillPct, 8)}%` }} />
      <div className="text-[8px] text-muted mt-0.5">{total} post{total !== 1 ? 's' : ''}</div>
      {isCurrent && <div className="text-[7px] text-sage font-medium">This week</div>}
    </button>
  )
}

function MonthJump({ onSelect, onClose }) {
  const now = new Date()
  const months = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    months.push(d)
  }
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {months.map((d, i) => (
        <button key={i} onClick={() => onSelect(d)} className="text-[10px] py-1 px-2 border border-border rounded bg-white hover:bg-[#f3f0ff] hover:border-[#6C5CE7] cursor-pointer font-sans">
          {MONTHS[d.getMonth()]} {d.getFullYear() !== now.getFullYear() ? d.getFullYear() : ''}
        </button>
      ))}
      <button onClick={onClose} className="text-[10px] text-muted hover:underline ml-1">Cancel</button>
    </div>
  )
}

function PlatDot({ platform }) {
  return <span className="inline-block w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: PLATFORM_COLORS[platform] || '#999' }} />
}

function WeekDetail({ weekStart, onSelect }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const from = new Date(weekStart)
    const to = new Date(from); to.setDate(to.getDate() + 7)
    api.getScheduledPosts({ from: from.toISOString(), to: to.toISOString(), limit: 100 })
      .then(data => { setPosts(data.posts || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [weekStart])

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + i); return d
  })

  const isToday = (d) => {
    const now = new Date()
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  }

  if (loading) return <div className="text-[10px] text-muted text-center py-2">Loading...</div>

  return (
    <div className="mt-1.5 border-t border-border pt-1.5">
      {days.map((day, i) => {
        const dayPosts = posts.filter(p => {
          const pd = new Date(p.scheduled_at)
          return pd.getFullYear() === day.getFullYear() && pd.getMonth() === day.getMonth() && pd.getDate() === day.getDate()
        }).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))

        return (
          <div key={i} className={`py-1 ${i < 6 ? 'border-b border-border/30' : ''} ${isToday(day) ? 'bg-[#faf8ff]' : ''}`}>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-medium min-w-[32px] ${isToday(day) ? 'text-[#6C5CE7]' : 'text-ink'}`}>
                {DAY_NAMES[day.getDay()]}
              </span>
              <span className="text-[9px] text-muted min-w-[38px]">
                {day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
              {dayPosts.length === 0 ? (
                <span className="text-[9px] text-border">—</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {dayPosts.map(p => (
                    <div key={p.uuid} className="flex items-center gap-0.5">
                      <PlatDot platform={p.platform} />
                      <span className="text-[8px]" style={{ color: PLATFORM_COLORS[p.platform] }}>
                        {new Date(p.scheduled_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
      <button
        onClick={() => onSelect(new Date(weekStart))}
        className="mt-1.5 w-full text-[10px] py-1 border border-[#6C5CE7] rounded-sm bg-[#f3f0ff] text-[#6C5CE7] cursor-pointer font-sans hover:bg-[#6C5CE7] hover:text-white"
      >
        Plan content for this week
      </button>
    </div>
  )
}

export default function WeekPlanner({ settings, targetWeek, onWeekSelect }) {
  const [expanded, setExpanded] = useState(false)
  const [showMonthJump, setShowMonthJump] = useState(false)
  const [weekData, setWeekData] = useState([])
  const [loading, setLoading] = useState(false)
  const [viewStart, setViewStart] = useState(() => getWeekStart(new Date()))
  const [detailWeek, setDetailWeek] = useState(null) // week_start string for detail view
  const stripRef = useRef(null)

  const schedule = settings?.posting_schedule?.schedule || []
  const maxPerPlatform = schedule.reduce((sum, p) => sum + (p.slots?.length || 0), 0) || 10

  const loadWeeks = useCallback(async (from) => {
    setLoading(true)
    try {
      const data = await api.getWeekSummary(from.toISOString().slice(0, 10), 8)
      setWeekData(data.weeks || [])
    } catch (err) {
      console.error('Week summary error:', err)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (expanded) loadWeeks(viewStart)
  }, [expanded, viewStart, loadWeeks])

  const handleExpand = () => {
    if (expanded) {
      setExpanded(false)
      setShowMonthJump(false)
      setDetailWeek(null)
    } else {
      setExpanded(true)
    }
  }

  const handleWeekClick = (week) => {
    // Toggle detail view for this week
    if (detailWeek === week.week_start) {
      setDetailWeek(null)
    } else {
      setDetailWeek(week.week_start)
    }
  }

  const handleSelectWeek = (ws) => {
    onWeekSelect(ws)
    setExpanded(false)
    setDetailWeek(null)
    setShowMonthJump(false)
  }

  const handleClear = (e) => {
    e.stopPropagation()
    onWeekSelect(null)
    setExpanded(false)
    setDetailWeek(null)
  }

  const handleMonthSelect = (monthDate) => {
    const ws = getWeekStart(monthDate)
    setViewStart(ws)
    setShowMonthJump(false)
    setDetailWeek(null)
  }

  const handleNav = (dir) => {
    const next = new Date(viewStart)
    next.setDate(next.getDate() + dir * 7 * 4)
    setViewStart(next)
    setDetailWeek(null)
  }

  // Summary for pill display
  const currentWeekStart = getWeekStart(new Date())
  const currentWeekData = weekData.find(w => new Date(w.week_start).getTime() === currentWeekStart.getTime())
  const currentTotal = currentWeekData ? currentWeekData.total_scheduled + currentWeekData.total_posted : 0

  // Saturation for selected week
  const selectedWeekData = targetWeek ? weekData.find(w => new Date(w.week_start).getTime() === getWeekStart(targetWeek).getTime()) : null
  const saturation = selectedWeekData ? getWeekSaturation(selectedWeekData, schedule) : []
  const fullPlatforms = saturation.filter(s => s.status === 'full' || s.status === 'over')

  return (
    <div className="mb-2">
      {/* Pill */}
      <button
        onClick={handleExpand}
        className="w-full flex items-center justify-between py-2 px-3 bg-[#f3f0ff] border border-[#e0dbf5] rounded-sm cursor-pointer font-sans text-left min-h-[44px]"
      >
        {targetWeek ? (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="text-[11px] text-[#6C5CE7] font-medium">Planning for:</span>
            <span className="text-[11px] text-ink font-medium truncate">{formatWeekRange(getWeekStart(targetWeek))}</span>
            {fullPlatforms.length > 0 && (
              <span className="text-[9px] text-[#e67e22] truncate">{fullPlatforms.map(f => f.platform).join(', ')} full</span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted">Weekly planner</span>
            {currentTotal > 0 && <span className="text-[10px] text-sage">{currentTotal} this week</span>}
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {targetWeek && (
            <span onClick={handleClear} className="text-[10px] text-[#c0392b] hover:underline">&times; clear</span>
          )}
          <span className="text-muted text-[10px]">{expanded ? '▾' : '▸'}</span>
        </div>
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="mt-1.5 border border-border rounded-sm bg-white p-2">
          {/* Navigation + month jump */}
          <div className="flex items-center justify-between mb-1.5">
            <button onClick={() => handleNav(-1)} className="text-muted hover:text-ink text-sm bg-transparent border-none cursor-pointer px-1">‹</button>
            <button
              onClick={() => setShowMonthJump(!showMonthJump)}
              className="text-[10px] text-[#6C5CE7] hover:underline font-medium"
            >
              {showMonthJump ? 'Pick a week' : 'Jump to month...'}
            </button>
            <button onClick={() => handleNav(1)} className="text-muted hover:text-ink text-sm bg-transparent border-none cursor-pointer px-1">›</button>
          </div>

          {showMonthJump ? (
            <MonthJump onSelect={handleMonthSelect} onClose={() => setShowMonthJump(false)} />
          ) : (
            <>
              {loading ? (
                <div className="text-[10px] text-muted text-center py-3">Loading...</div>
              ) : (
                <div className="week-strip" ref={stripRef}>
                  {weekData.map((week) => (
                    <WeekCard
                      key={week.week_start}
                      week={week}
                      selected={detailWeek === week.week_start}
                      isCurrent={isCurrentWeek(week.week_start)}
                      maxPerPlatform={maxPerPlatform}
                      onClick={() => handleWeekClick(week)}
                    />
                  ))}
                </div>
              )}

              {/* Week detail view — shows days/times/networks */}
              {detailWeek && (
                <WeekDetail weekStart={detailWeek} onSelect={handleSelectWeek} />
              )}

              {/* Saturation for selected planning week */}
              {targetWeek && saturation.length > 0 && !detailWeek && (
                <div className="mt-1.5 pt-1.5 border-t border-border">
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {saturation.map(s => (
                      <span key={s.platKey} className={`text-[9px] ${s.status === 'over' ? 'text-[#c0392b] font-medium' : s.status === 'full' ? 'text-[#e67e22]' : 'text-muted'}`}>
                        {s.platform}: {s.current}/{s.max}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
