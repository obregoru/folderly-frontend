import { useState } from 'react'
import { sampleChannels } from '../mockData'

/**
 * Per-channel destinations + scheduling. Each channel inherits the
 * default video + overlays + voiceover + caption by default; opt-in
 * customization per platform. Scheduling uses AI-suggested best times
 * (derived from per-channel audience analytics) or a manual date/time.
 *
 * Existing functionality preserved (just restyled):
 *   - Enable/disable per channel
 *   - Per-channel caption/text overrides
 *   - Schedule with best-time suggestions
 *   - Calendar view (daily / weekly / monthly) of scheduled / posted /
 *     failed posts
 *   - Edit caption before a scheduled post fires
 */
export default function ChannelsPanel() {
  const [channels, setChannels] = useState(
    sampleChannels.map(c => ({
      ...c,
      scheduled: null, // { date, time, caption } when scheduled
      status: 'draft', // draft | scheduled | posted | failed
    }))
  )
  const [schedulingKey, setSchedulingKey] = useState(null)
  const [showCalendar, setShowCalendar] = useState(false)

  const toggle = (key) => setChannels(prev => prev.map(c => c.key === key ? { ...c, enabled: !c.enabled } : c))
  const customize = (key) => setChannels(prev => prev.map(c => c.key === key ? { ...c, customized: !c.customized } : c))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">Destinations & scheduling</div>
        <button
          onClick={() => setShowCalendar(s => !s)}
          className="text-[10px] py-1 px-2.5 border border-[#6C5CE7] text-[#6C5CE7] rounded bg-white cursor-pointer"
        >📅 Calendar</button>
      </div>

      {showCalendar && <CalendarView onClose={() => setShowCalendar(false)} />}

      <div className="text-[10px] text-muted">
        Each channel inherits the shared video + captions + voiceover by default.
        Tap <b>Customize</b> to override just that platform.
      </div>

      <div className="space-y-1.5">
        {channels.map(c => (
          <div
            key={c.key}
            className={`border rounded-lg p-2.5 ${c.enabled ? 'border-[#2D9A5E]/30 bg-[#f0faf4]' : 'border-[#e5e5e5] bg-white'}`}
          >
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-[#6C5CE7]/10 flex items-center justify-center text-[9px] font-bold text-[#6C5CE7] flex-shrink-0">
                {c.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium">{c.label}</div>
                <div className="text-[9px] text-muted flex items-center gap-1 flex-wrap">
                  {c.customized ? (
                    <span className="text-[#6C5CE7]">● Customized</span>
                  ) : (
                    <span>Same as default</span>
                  )}
                  {c.scheduled && (
                    <>
                      <span>·</span>
                      <span className="text-[#6C5CE7]">📅 {c.scheduled.date} at {c.scheduled.time}</span>
                    </>
                  )}
                  {c.status === 'posted' && <span className="text-[#2D9A5E]">· ✓ Posted</span>}
                  {c.status === 'failed' && <span className="text-[#c0392b]">· ✕ Failed</span>}
                </div>
              </div>
              <label className="relative inline-block w-10 h-6 cursor-pointer flex-shrink-0">
                <input type="checkbox" checked={c.enabled} onChange={() => toggle(c.key)} className="sr-only peer" />
                <span className="absolute inset-0 bg-[#e5e5e5] rounded-full peer-checked:bg-[#2D9A5E] transition-colors" />
                <span className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
              </label>
            </div>

            {c.enabled && (
              <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-[#e5e5e5] flex-wrap">
                <button
                  onClick={() => customize(c.key)}
                  className={`text-[10px] py-1 px-2 rounded border cursor-pointer ${c.customized ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]' : 'bg-white text-[#6C5CE7] border-[#6C5CE7]'}`}
                >{c.customized ? 'Remove custom' : 'Customize'}</button>
                {c.customized && (
                  <button className="text-[10px] text-muted bg-white border border-[#e5e5e5] rounded py-1 px-2 cursor-pointer">
                    Edit {c.label} overlay / caption →
                  </button>
                )}
                <button
                  onClick={() => setSchedulingKey(c.key === schedulingKey ? null : c.key)}
                  className={`text-[10px] py-1 px-2 rounded border cursor-pointer ml-auto ${c.scheduled ? 'bg-white text-[#6C5CE7] border-[#6C5CE7]' : 'bg-[#6C5CE7] text-white border-[#6C5CE7]'}`}
                >{c.scheduled ? '📅 Edit schedule' : '📅 Schedule'}</button>
              </div>
            )}

            {schedulingKey === c.key && (
              <ScheduleBlock
                channel={c}
                onSchedule={(date, time) => {
                  setChannels(prev => prev.map(x => x.key === c.key ? { ...x, scheduled: { date, time }, status: 'scheduled' } : x))
                  setSchedulingKey(null)
                }}
                onUnschedule={() => {
                  setChannels(prev => prev.map(x => x.key === c.key ? { ...x, scheduled: null, status: 'draft' } : x))
                  setSchedulingKey(null)
                }}
                onClose={() => setSchedulingKey(null)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// Inline scheduler: AI-suggested best times from channel audience data +
// manual date/time + last-minute caption edit.
function ScheduleBlock({ channel, onSchedule, onUnschedule, onClose }) {
  const today = new Date()
  const yyyymmdd = d => d.toISOString().slice(0, 10)
  const [date, setDate] = useState(channel.scheduled?.date || yyyymmdd(today))
  const [time, setTime] = useState(channel.scheduled?.time || '18:00')
  const [caption, setCaption] = useState('')

  // Fake best-time suggestions (in real app: per-channel audience analytics).
  const bestTimes = [
    { day: 'Today', time: '18:00', label: 'Top engagement window' },
    { day: 'Tomorrow', time: '12:15', label: 'Lunch peak' },
    { day: 'Sat', time: '10:30', label: 'Weekend morning spike' },
    { day: 'Sun', time: '20:00', label: 'Sunday night peak' },
  ]

  return (
    <div className="mt-2 pt-2 border-t border-[#e5e5e5] space-y-2 bg-[#f8f7f3] -mx-2.5 -mb-2.5 px-2.5 pb-2.5 rounded-b-lg">
      <div className="text-[10px] font-medium">Best times for {channel.label} (AI-suggested)</div>
      <div className="flex gap-1 flex-wrap">
        {bestTimes.map((bt, i) => (
          <button
            key={i}
            onClick={() => {
              // Normalize to yyyy-mm-dd for mock
              const d = new Date()
              if (bt.day === 'Tomorrow') d.setDate(d.getDate() + 1)
              if (bt.day === 'Sat') d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7))
              if (bt.day === 'Sun') d.setDate(d.getDate() + ((0 - d.getDay() + 7) % 7 || 7))
              setDate(yyyymmdd(d))
              setTime(bt.time)
            }}
            className="text-[9px] py-1 px-2 bg-white border border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer"
          >{bt.day} {bt.time} <span className="text-muted">· {bt.label}</span></button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 text-[10px]">
        <label className="text-muted">Date:</label>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
        />
        <label className="text-muted">Time:</label>
        <input
          type="time"
          value={time}
          onChange={e => setTime(e.target.value)}
          className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
        />
      </div>

      <div>
        <label className="text-[9px] text-muted">Caption (edit before schedule — optional)</label>
        <textarea
          value={caption}
          onChange={e => setCaption(e.target.value)}
          placeholder="Leave blank to use the default caption from Post text tab"
          rows={2}
          className="w-full text-[10px] border border-[#e5e5e5] rounded p-1.5 bg-white resize-y"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onSchedule(date, time)}
          className="text-[10px] py-1.5 px-3 bg-[#2D9A5E] text-white border-none rounded cursor-pointer font-medium"
        >Schedule</button>
        {channel.scheduled && (
          <button
            onClick={onUnschedule}
            className="text-[10px] py-1.5 px-3 text-[#c0392b] bg-white border border-[#c0392b] rounded cursor-pointer"
          >Unschedule</button>
        )}
        <button
          onClick={onClose}
          className="text-[10px] text-muted bg-transparent border-none cursor-pointer ml-auto"
        >Cancel</button>
      </div>
    </div>
  )
}

// Calendar view — daily / weekly / monthly toggle. Shows scheduled,
// posted, failed posts. Tap a row to edit the caption before it fires.
function CalendarView({ onClose }) {
  const [scope, setScope] = useState('week')

  const sampleScheduled = [
    { id: 'p-1', date: 'Today', time: '18:00', channel: 'TikTok', name: 'Birthday reel', status: 'scheduled' },
    { id: 'p-2', date: 'Tomorrow', time: '12:15', channel: 'Instagram', name: 'Birthday reel', status: 'scheduled' },
    { id: 'p-3', date: 'Wed Apr 17', time: '09:00', channel: 'YouTube', name: 'Workshop behind-scenes', status: 'posted' },
    { id: 'p-4', date: 'Wed Apr 17', time: '18:30', channel: 'Facebook', name: 'Workshop behind-scenes', status: 'failed' },
  ]

  return (
    <div className="border border-[#6C5CE7]/30 rounded-lg bg-[#f8f7f3] p-2 space-y-2">
      <div className="flex items-center gap-1">
        <div className="text-[11px] font-medium flex-1">Scheduled posts</div>
        <div className="flex items-center gap-0.5 bg-white rounded-md p-0.5">
          {['day', 'week', 'month'].map(s => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`text-[9px] py-0.5 px-2 rounded border-none cursor-pointer ${scope === s ? 'bg-[#6C5CE7] text-white' : 'bg-transparent text-muted'}`}
            >{s}</button>
          ))}
        </div>
        <button onClick={onClose} className="text-[12px] text-muted bg-transparent border-none cursor-pointer px-1">✕</button>
      </div>

      <div className="space-y-1">
        {sampleScheduled.map(p => (
          <div
            key={p.id}
            className={`flex items-center gap-2 bg-white border rounded p-1.5 text-[10px] ${p.status === 'failed' ? 'border-[#c0392b]/40' : 'border-[#e5e5e5]'}`}
          >
            <div className="w-1 h-8 rounded-full flex-shrink-0" style={{
              background: p.status === 'posted' ? '#2D9A5E' : p.status === 'failed' ? '#c0392b' : '#6C5CE7',
            }} />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{p.name}</div>
              <div className="text-[9px] text-muted">{p.channel} · {p.date} {p.time}</div>
            </div>
            <span className={`text-[9px] ${p.status === 'posted' ? 'text-[#2D9A5E]' : p.status === 'failed' ? 'text-[#c0392b]' : 'text-[#6C5CE7]'}`}>
              {p.status === 'posted' && '✓ Posted'}
              {p.status === 'failed' && '✕ Failed'}
              {p.status === 'scheduled' && '📅 Scheduled'}
            </span>
            {p.status !== 'posted' && (
              <button className="text-[9px] text-[#6C5CE7] bg-white border border-[#e5e5e5] rounded py-0.5 px-1.5 cursor-pointer">Edit</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
