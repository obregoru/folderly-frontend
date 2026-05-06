// V3 Phase 6 — schedule calendar view.
//
// Visualizes the next N weeks of cadence slots with scheduled /
// published posts attached. Lets the operator see at-a-glance:
//   - Which slots are filled vs empty
//   - When the next publish fires
//   - Which posts are flagged / failed (so they can be addressed
//     before the slot comes up)
//
// The BE's /content/schedule endpoint does the slot math + post
// joining; this screen just renders. Refreshes on tab open.

import { useEffect, useState } from 'react'
import * as api from '../api'

const STATUS_TONE = {
  scheduled: { color: '#3b82f6', label: 'Scheduled' },
  published: { color: '#0a4d2c', label: 'Published' },
  flagged:   { color: '#d97706', label: 'Flagged' },
  failed:    { color: '#c0392b', label: 'Failed' },
  ready:     { color: '#94a3b8', label: 'Ready' },
}

export default function Schedule() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [weeks, setWeeks] = useState(4)

  const reload = async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.getSchedule(weeks)
      setData(r)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { reload() }, [weeks])

  if (loading) return <div className="text-[12px] text-muted">Loading schedule…</div>
  if (error) return <div className="text-[12px] text-[#c0392b]">{error}</div>
  if (!data) return null

  const { posts = [], upcoming_slots: upcomingSlots = [], blog_schedule: blogSchedule } = data

  // Build a unified, sorted timeline of slot events:
  //   - Upcoming cadence slots (always rendered, even if empty)
  //   - Posts that don't sit on a cadence slot (e.g. user manually
  //     scheduled at an off-cadence time)
  // Posts are matched to slots within ±5 minutes.
  const slotEntries = upcomingSlots.map(iso => {
    const slotMs = new Date(iso).getTime()
    const matched = posts.find(p => {
      const t = p.scheduled_for ? new Date(p.scheduled_for).getTime() : null
      return t != null && Math.abs(t - slotMs) <= 5 * 60 * 1000
    })
    return { type: 'slot', when: iso, post: matched || null }
  })
  // Posts that landed off-cadence (manual scheduling / past published)
  const matchedSlotPostIds = new Set(slotEntries.filter(e => e.post).map(e => e.post.id))
  const offCadence = posts
    .filter(p => !matchedSlotPostIds.has(p.id))
    .map(p => ({
      type: 'off_cadence',
      when: p.scheduled_for || p.published_at,
      post: p,
    }))
  const timeline = [...slotEntries, ...offCadence]
    .filter(e => e.when)
    .sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime())

  // Group by week-of-year for the calendar columns.
  const weeksMap = new Map()
  for (const entry of timeline) {
    const d = new Date(entry.when)
    // Anchor to the Monday of the week so all entries in the same
    // ISO week land in one column.
    const day = d.getDay() // 0=Sun, 1=Mon
    const monday = new Date(d)
    monday.setDate(d.getDate() - ((day + 6) % 7))
    monday.setHours(0, 0, 0, 0)
    const key = monday.toISOString().slice(0, 10)
    if (!weeksMap.has(key)) weeksMap.set(key, { mondayDate: new Date(monday), entries: [] })
    weeksMap.get(key).entries.push(entry)
  }
  const weekKeys = [...weeksMap.keys()].sort()

  return (
    <div className="space-y-3">
      <div className="bg-white border border-[#e5e5e5] rounded p-3">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <h2 className="text-[14px] font-bold mb-1">Publishing schedule</h2>
            <p className="text-[10px] text-muted">
              Next {weeks} week{weeks === 1 ? '' : 's'} of cadence slots. Empty slots show where the auto-scheduler will drop the next 'ready' draft. Off-cadence posts are surfaced too so you can spot manual scheduling.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-muted">Show:</label>
            <select
              value={weeks}
              onChange={e => setWeeks(Number(e.target.value))}
              className="text-[10px] py-1 px-1.5 border border-[#e5e5e5] rounded bg-white cursor-pointer"
            >
              <option value="2">2 weeks</option>
              <option value="4">4 weeks</option>
              <option value="6">6 weeks</option>
              <option value="8">8 weeks</option>
              <option value="12">12 weeks</option>
            </select>
            <button
              type="button"
              onClick={reload}
              className="text-[10px] py-1 px-2 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
            >↻</button>
          </div>
        </div>
        {!blogSchedule && (
          <div className="mt-2 text-[10px] text-[#d97706] bg-[#fff7e6] border border-[#f5a623]/30 rounded p-2">
            ⚠ No blog schedule configured. Open <b>Config → Blog schedule</b> to set up a cadence (days + time + timezone). Without it, drafts stay 'ready' indefinitely until manually scheduled or published.
          </div>
        )}
      </div>

      {/* Calendar grid */}
      {weekKeys.length === 0 ? (
        <div className="bg-white border border-[#e5e5e5] rounded p-3 text-[11px] text-muted italic">
          No slots in the visible window. Check that <b>Config → Blog schedule</b> has at least one day + time configured.
        </div>
      ) : (
        <div className="space-y-3">
          {weekKeys.map(weekKey => {
            const wk = weeksMap.get(weekKey)
            return (
              <div key={weekKey} className="bg-white border border-[#e5e5e5] rounded p-3">
                <div className="text-[10px] text-muted uppercase tracking-wide mb-1.5">
                  Week of {wk.mondayDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                <ul className="space-y-1.5">
                  {wk.entries.map((entry, i) => {
                    const when = new Date(entry.when)
                    const isPast = when.getTime() < Date.now()
                    return (
                      <li
                        key={i}
                        className={`border rounded p-2 flex items-start gap-2 ${
                          entry.post
                            ? 'border-[#e5e5e5] bg-white'
                            : 'border-dashed border-[#e5e5e5] bg-[#fafafa]'
                        }`}
                      >
                        {/* Date column */}
                        <div className="flex-shrink-0 w-20 text-center">
                          <div className="text-[9px] uppercase text-muted">
                            {when.toLocaleDateString(undefined, { weekday: 'short' })}
                          </div>
                          <div className="text-[14px] font-bold leading-tight">
                            {when.getDate()}
                          </div>
                          <div className="text-[9px] text-muted">
                            {when.toLocaleDateString(undefined, { month: 'short' })}
                          </div>
                          <div className="text-[10px] font-mono mt-0.5">
                            {when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                          </div>
                        </div>

                        {/* Slot content */}
                        <div className="flex-1 min-w-0">
                          {entry.type === 'off_cadence' && (
                            <div className="text-[9px] text-[#d97706] mb-0.5">⚠ off-cadence</div>
                          )}
                          {entry.post ? (
                            <SlotPostCard post={entry.post} isPast={isPast} />
                          ) : (
                            <div className="text-[11px] text-muted italic">
                              {isPast ? 'Slot passed (no draft)' : 'Empty — next ready draft fills this slot'}
                            </div>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SlotPostCard({ post, isPast }) {
  const tone = STATUS_TONE[post.status] || STATUS_TONE.ready
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
        <span
          className="text-[9px] uppercase tracking-wide rounded px-1.5 py-0.5"
          style={{ background: `${tone.color}20`, color: tone.color }}
        >{tone.label}</span>
        <span className="text-[9px] text-muted">{post.template}</span>
        {typeof post.zerogpt_score === 'number' && (
          <span className={`text-[9px] font-mono ${
            post.zerogpt_score >= 60 ? 'text-[#c0392b]' : post.zerogpt_score >= 30 ? 'text-[#d97706]' : 'text-[#2D9A5E]'
          }`}>{post.zerogpt_score.toFixed(0)}% AI</span>
        )}
        {typeof post.drift_score === 'number' && (
          <span className={`text-[9px] font-mono ${
            post.drift_score >= 8 ? 'text-[#2D9A5E]' : post.drift_score >= 6 ? 'text-[#d97706]' : 'text-[#c0392b]'
          }`}>drift {post.drift_score.toFixed(1)}</span>
        )}
      </div>
      <div className="text-[12px] font-medium text-ink truncate" title={post.title}>{post.title}</div>
      <div className="text-[9px] text-muted truncate font-mono">/{post.slug}</div>
      {post.wp_post_url && (
        <a
          href={post.wp_post_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[9px] text-[#6C5CE7] underline truncate inline-block"
        >View on WP →</a>
      )}
    </div>
  )
}
