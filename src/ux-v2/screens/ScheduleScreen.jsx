import { useState } from 'react'

/**
 * Schedule screen — cross-draft, cross-channel view of what's scheduled.
 * Complements the per-channel scheduler in Channels panel (which only
 * shows the current draft). This is the bird's-eye view.
 *
 * Day / week / month scopes. Tap a post to edit the caption, reschedule,
 * or unschedule.
 */

const SAMPLE_SCHEDULED = [
  { id: 'p-1', date: '2026-04-18', time: '18:00', channel: 'TikTok',    draft: 'Poppy & Thyme birthday reel', status: 'scheduled' },
  { id: 'p-2', date: '2026-04-18', time: '19:30', channel: 'Instagram', draft: 'Poppy & Thyme birthday reel', status: 'scheduled' },
  { id: 'p-3', date: '2026-04-19', time: '12:15', channel: 'Facebook',  draft: 'Workshop behind-scenes',       status: 'scheduled' },
  { id: 'p-4', date: '2026-04-19', time: '20:00', channel: 'YouTube',   draft: 'Workshop behind-scenes',       status: 'scheduled' },
  { id: 'p-5', date: '2026-04-20', time: '10:30', channel: 'TikTok',    draft: 'Perfume party sizzle',          status: 'scheduled' },
  { id: 'p-6', date: '2026-04-20', time: '17:00', channel: 'Instagram', draft: 'Perfume party sizzle',          status: 'scheduled' },
  { id: 'p-7', date: '2026-04-21', time: '12:00', channel: 'GBP',       draft: 'Hours update',                  status: 'scheduled' },
]

export default function ScheduleScreen() {
  const [scope, setScope] = useState('week')
  const [selectedDate, setSelectedDate] = useState(null)

  // Group by date for week view
  const byDate = SAMPLE_SCHEDULED.reduce((acc, p) => {
    if (!acc[p.date]) acc[p.date] = []
    acc[p.date].push(p)
    return acc
  }, {})

  const dates = Object.keys(byDate).sort()

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="text-[14px] font-medium flex-1">Schedule</h1>
        <div className="flex items-center gap-0.5 bg-white rounded-md p-0.5 border border-[#e5e5e5]">
          {['day', 'week', 'month'].map(s => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`text-[9px] py-1 px-2.5 rounded border-none cursor-pointer ${scope === s ? 'bg-[#6C5CE7] text-white' : 'bg-transparent text-muted'}`}
            >{s}</button>
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

      {/* Grouped by date */}
      <div className="space-y-2">
        {dates.map(d => {
          const dayPosts = byDate[d]
          const dayLabel = new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
          return (
            <div key={d}>
              <div className="text-[10px] font-medium text-muted uppercase tracking-wide px-1 pb-1">{dayLabel}</div>
              <div className="space-y-1">
                {dayPosts.map(p => (
                  <div
                    key={p.id}
                    onClick={() => setSelectedDate(selectedDate === p.id ? null : p.id)}
                    className="flex items-center gap-2 bg-white border border-[#e5e5e5] rounded p-2 text-[10px] cursor-pointer active:bg-[#f8f7f3]"
                  >
                    <div
                      className="w-1 h-10 rounded-full flex-shrink-0"
                      style={{ background: p.status === 'posted' ? '#2D9A5E' : p.status === 'failed' ? '#c0392b' : '#6C5CE7' }}
                    />
                    <div className="text-[11px] font-mono text-muted w-12 flex-shrink-0">{p.time}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.draft}</div>
                      <div className="text-[9px] text-muted">{p.channel}</div>
                    </div>
                    <span className={`text-[9px] whitespace-nowrap ${p.status === 'posted' ? 'text-[#2D9A5E]' : p.status === 'failed' ? 'text-[#c0392b]' : 'text-[#6C5CE7]'}`}>
                      {p.status === 'posted' && '✓ Posted'}
                      {p.status === 'failed' && '✕ Failed'}
                      {p.status === 'scheduled' && '📅'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="text-[10px] text-muted italic text-center py-2">
        Tap a post to edit the caption, reschedule, or unschedule before it fires.
      </div>
    </div>
  )
}
