import { useEffect, useState } from 'react'
import * as api from '../../api'

/**
 * ScheduleV2 — real scheduled posts. Three views (List / Week / Month),
 * matches the mockup shape. Uses the existing /schedule endpoint which
 * supports from/to date-range + status filter.
 *
 * Phase 5 scope:
 *   - Fetch scheduled posts (status=scheduled, next 30 days by default)
 *   - List view groups by date (same as mockup)
 *   - Tap row shows quick actions (Cancel, Edit caption, Retry if failed)
 *
 * Week + Month grid views come in a sub-phase (copy from mockup, wire to
 * real data). For now List view gives the core bird's-eye.
 */

const DAY_LABELS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const MONTH_DAY_LABELS = ['S', 'S', 'M', 'T', 'W', 'T', 'F']

function startOfWeek(date) {
  const d = new Date(date)
  const daysBack = (d.getDay() + 1) % 7
  d.setDate(d.getDate() - daysBack)
  d.setHours(0, 0, 0, 0)
  return d
}
function yyyymmdd(d) {
  const m = d.getMonth() + 1
  return `${d.getFullYear()}-${String(m).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export default function ScheduleV2() {
  const [view, setView] = useState('list')
  const [anchor, setAnchor] = useState(new Date())
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingUuid, setEditingUuid] = useState(null)
  const [editingCaption, setEditingCaption] = useState('')

  const reload = () => {
    setLoading(true); setError(null)
    // 60-day window centered on anchor
    const from = new Date(anchor); from.setDate(from.getDate() - 30)
    const to = new Date(anchor); to.setDate(to.getDate() + 30)
    api.getScheduledPosts({
      status: 'pending',
      from: from.toISOString(),
      to: to.toISOString(),
      limit: 200,
    })
      .then(r => {
        const rows = Array.isArray(r) ? r : (r?.posts || r?.rows || [])
        setPosts(rows)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, [anchor])

  const byDate = posts.reduce((acc, p) => {
    const date = p.scheduled_at ? p.scheduled_at.slice(0, 10) : 'unknown'
    if (!acc[date]) acc[date] = []
    acc[date].push(p)
    return acc
  }, {})

  const cancel = async (uuid) => {
    if (!confirm('Cancel this scheduled post?')) return
    try {
      await api.cancelScheduledPost(uuid)
      reload()
    } catch (e) { alert('Cancel failed: ' + e.message) }
  }

  const startEdit = (p) => {
    setEditingUuid(p.uuid)
    setEditingCaption(p.caption || '')
  }
  const commitEdit = async (p) => {
    try {
      await api.updateScheduledPost(p.uuid, { caption: editingCaption })
      setEditingUuid(null)
      reload()
    } catch (e) { alert('Save failed: ' + e.message) }
  }

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

      {loading && <div className="text-[11px] text-muted italic text-center py-4">Loading…</div>}
      {error && <div className="text-[11px] text-[#c0392b] text-center py-4">Error: {error}</div>}

      {!loading && !error && (
        <>
          <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
            <span className="bg-[#6C5CE7]/10 text-[#6C5CE7] rounded-full px-2 py-0.5">
              {posts.length} scheduled
            </span>
          </div>

          {view === 'list' && (
            <ListView
              byDate={byDate}
              editingUuid={editingUuid}
              editingCaption={editingCaption}
              setEditingCaption={setEditingCaption}
              startEdit={startEdit}
              commitEdit={commitEdit}
              cancelEdit={() => setEditingUuid(null)}
              onCancel={cancel}
            />
          )}
          {view === 'week' && <WeekView byDate={byDate} anchor={anchor} setAnchor={setAnchor} />}
          {view === 'month' && <MonthView byDate={byDate} anchor={anchor} setAnchor={setAnchor} />}
        </>
      )}
    </div>
  )
}

function ListView({ byDate, editingUuid, editingCaption, setEditingCaption, startEdit, commitEdit, cancelEdit, onCancel }) {
  const dates = Object.keys(byDate).sort()
  if (dates.length === 0) {
    return <div className="text-[11px] text-muted italic text-center py-8 bg-white border border-[#e5e5e5] rounded-lg">No scheduled posts in this window.</div>
  }
  return (
    <div className="space-y-2">
      {dates.map(d => {
        const dayPosts = byDate[d].sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''))
        const label = new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
        return (
          <div key={d}>
            <div className="text-[10px] font-medium text-muted uppercase tracking-wide px-1 pb-1">{label}</div>
            <div className="space-y-1">
              {dayPosts.map(p => {
                const time = p.scheduled_at ? new Date(p.scheduled_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—'
                const isEditing = editingUuid === p.uuid
                return (
                  <div key={p.uuid} className="bg-white border border-[#e5e5e5] rounded p-2 text-[10px]">
                    <div className="flex items-center gap-2">
                      <div className="w-1 h-10 rounded-full flex-shrink-0 bg-[#6C5CE7]" />
                      <div className="font-mono text-muted w-12 flex-shrink-0">{time}</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{p.job_name || p.title || '(no title)'}</div>
                        <div className="text-[9px] text-muted">{p.platform}</div>
                      </div>
                    </div>
                    {isEditing ? (
                      <div className="mt-2 space-y-1">
                        <textarea
                          value={editingCaption}
                          onChange={e => setEditingCaption(e.target.value)}
                          rows={3}
                          className="w-full text-[10px] border border-[#e5e5e5] rounded p-1 bg-white resize-y"
                        />
                        <div className="flex gap-1.5">
                          <button onClick={() => commitEdit(p)} className="text-[9px] py-0.5 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer">Save</button>
                          <button onClick={cancelEdit} className="text-[9px] py-0.5 px-2 bg-white border border-[#e5e5e5] rounded cursor-pointer">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        <button onClick={() => startEdit(p)} className="text-[9px] text-muted bg-white border border-[#e5e5e5] rounded py-0.5 px-1.5 cursor-pointer">Edit caption</button>
                        <button onClick={() => onCancel(p.uuid)} className="text-[9px] text-[#c0392b] bg-white border border-[#c0392b] rounded py-0.5 px-1.5 cursor-pointer ml-auto">Cancel</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function WeekView({ byDate, anchor, setAnchor }) {
  const start = startOfWeek(anchor)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i); return d
  })
  const weekEnd = new Date(start); weekEnd.setDate(start.getDate() + 6)
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
          const isToday = key === yyyymmdd(new Date())
          return (
            <div key={key} className={`bg-white border border-[#e5e5e5] rounded p-1 min-h-[120px] ${isToday ? 'border-[#6C5CE7] bg-[#f3f0ff]' : ''}`}>
              <div className="text-center pb-1 border-b border-[#e5e5e5] mb-1">
                <div className="text-[8px] text-muted font-medium">{DAY_LABELS[i]}</div>
                <div className={`text-[11px] font-bold ${isToday ? 'text-[#6C5CE7]' : 'text-ink'}`}>{d.getDate()}</div>
              </div>
              <div className="space-y-0.5">
                {posts.map(p => {
                  const time = p.scheduled_at ? new Date(p.scheduled_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''
                  return (
                    <div
                      key={p.uuid}
                      className="text-[8px] rounded px-1 py-0.5 overflow-hidden bg-[#6C5CE7]/10 border-l-2 border-[#6C5CE7]"
                      title={`${time} · ${p.platform} · ${p.job_name || p.title || ''}`}
                    >
                      <div className="font-mono text-muted">{time}</div>
                      <div className="truncate font-medium">{p.platform}</div>
                    </div>
                  )
                })}
                {posts.length === 0 && <div className="text-[8px] text-muted text-center pt-2 italic">—</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MonthView({ byDate, anchor, setAnchor }) {
  const m = monthStart(anchor)
  const gridStart = startOfWeek(m)
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d
  })
  const monthLabel = m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const prev = () => { const d = new Date(anchor); d.setMonth(d.getMonth() - 1); setAnchor(d) }
  const next = () => { const d = new Date(anchor); d.setMonth(d.getMonth() + 1); setAnchor(d) }
  const [sel, setSel] = useState(null)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button onClick={prev} className="text-[11px] py-1 px-2 border border-[#e5e5e5] rounded bg-white cursor-pointer">←</button>
        <div className="text-[12px] font-medium text-center flex-1">{monthLabel}</div>
        <button onClick={next} className="text-[11px] py-1 px-2 border border-[#e5e5e5] rounded bg-white cursor-pointer">→</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {MONTH_DAY_LABELS.map((l, i) => (
          <div key={i} className="text-center text-[9px] text-muted font-medium py-1">{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d, i) => {
          const key = yyyymmdd(d)
          const posts = byDate[key] || []
          const inMonth = d.getMonth() === m.getMonth()
          const isToday = key === yyyymmdd(new Date())
          return (
            <button
              key={i}
              onClick={() => setSel(posts.length > 0 ? key : null)}
              className={`aspect-square border rounded flex flex-col items-center justify-center bg-white cursor-pointer ${inMonth ? 'border-[#e5e5e5]' : 'border-transparent opacity-40'} ${isToday ? 'border-[#6C5CE7] bg-[#f3f0ff]' : ''}`}
            >
              <div className={`text-[11px] ${isToday ? 'text-[#6C5CE7] font-bold' : 'text-ink'}`}>{d.getDate()}</div>
              {posts.length > 0 && (
                <div className="flex gap-0.5 mt-0.5">
                  {posts.slice(0, 3).map((_, j) => (
                    <span key={j} className="w-1 h-1 rounded-full bg-[#6C5CE7]" />
                  ))}
                  {posts.length > 3 && <span className="text-[7px] text-muted">+{posts.length - 3}</span>}
                </div>
              )}
            </button>
          )
        })}
      </div>
      {sel && byDate[sel] && (
        <div className="border-t border-[#e5e5e5] pt-2 space-y-1">
          <div className="text-[10px] font-medium text-muted uppercase tracking-wide">
            {new Date(sel).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </div>
          {byDate[sel].map(p => (
            <div key={p.uuid} className="flex items-center gap-2 bg-white border border-[#e5e5e5] rounded p-2 text-[10px]">
              <div className="w-1 h-10 rounded-full flex-shrink-0 bg-[#6C5CE7]" />
              <div className="text-[11px] font-mono text-muted w-12 flex-shrink-0">
                {p.scheduled_at ? new Date(p.scheduled_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{p.job_name || p.title || '(no title)'}</div>
                <div className="text-[9px] text-muted">{p.platform}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
