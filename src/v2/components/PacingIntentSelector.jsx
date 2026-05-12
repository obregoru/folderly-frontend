// Operator-chosen pacing intent shown above the first-2s + full-video
// analyzer surfaces. Picking one re-weights BOTH analyzers on the
// next run so an educational/walkthrough piece doesn't get penalized
// for "no aggressive hook" and a slow-burn doesn't get hammered on
// scrollRiskPenalty. Self-fetches via api.getJob to stay lean on
// parent props — the panel just passes draftId.

import { useEffect, useState } from 'react'
import * as api from '../../api'

const OPTIONS = [
  {
    key: null,
    label: 'Auto',
    hint: 'Server picks one from the video duration. Default — works for most drafts.',
    icon: '⚙️',
  },
  {
    key: 'hook_driven',
    label: 'Hook-driven',
    hint: 'Scroll-stop optimized. First 0.5s must hook.',
    icon: '🎣',
  },
  {
    key: 'balanced',
    label: 'Balanced',
    hint: 'Moderate pacing — some setup time before the hook lands.',
    icon: '⚖️',
  },
  {
    key: 'slow_burn',
    label: 'Slow burn',
    hint: 'Atmospheric / narrative pacing. Builds gradually. Will NOT be penalized for slow openings.',
    icon: '🌅',
  },
  {
    key: 'educational',
    label: 'Educational',
    hint: 'Tutorial / walkthrough. Clarity beats curiosity. Topic statement > hook.',
    icon: '🎓',
  },
]

export default function PacingIntentSelector({ draftId }) {
  // null in state = "auto" (operator hasn't chosen). Distinct from
  // 'hook_driven' (operator picked hook explicitly).
  const [chosen, setChosen] = useState(null)
  const [resolved, setResolved] = useState(null) // server's auto-pick when chosen=null
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!draftId) return
    let cancelled = false
    api.getJob(draftId).then(job => {
      if (cancelled) return
      setChosen(job?.pacing_intent || null)
      setResolved(job?.pacing_intent_resolved || null)
      setLoaded(true)
    }).catch(() => setLoaded(true))
    return () => { cancelled = true }
  }, [draftId])

  const pick = async (next) => {
    setChosen(next)
    setSaving(true)
    setErr(null)
    try {
      await api.setJobPacingIntent(draftId, next)
      // Re-fetch the resolved field so "Auto (Slow burn)" reflects
      // the BE's bucket choice. Cheap — same payload as panel load.
      try {
        const j = await api.getJob(draftId)
        setResolved(j?.pacing_intent_resolved || null)
      } catch {}
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) {
    return <div className="text-[10px] text-muted italic py-1">Loading pacing intent…</div>
  }

  const isAuto = !chosen
  const resolvedLabel = OPTIONS.find(o => o.key === resolved)?.label || resolved || '—'

  return (
    <div className="bg-[#f8f7f3] border border-[#e5e5e5] rounded p-2 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[11px] font-medium">🎚 Analysis pacing intent</div>
        {saving && <span className="text-[9px] text-muted italic">saving…</span>}
        {err && <span className="text-[9px] text-[#c0392b]">{err}</span>}
        {isAuto && resolved && (
          <span
            className="text-[9px] py-0.5 px-1.5 rounded border bg-white border-[#e5e5e5] text-muted ml-auto"
            title="Server auto-picked this from video duration — pick one explicitly to override"
          >Auto → {resolvedLabel}</span>
        )}
      </div>
      <div className="text-[10px] text-muted">
        Re-weights both the first-2s and full-video analyzers. Pick the lens that matches what you're actually making — saves you from "make the hook punchier" suggestions on slow-burn content.
      </div>
      <div className="flex flex-wrap gap-1">
        {OPTIONS.map(opt => {
          const active = chosen === opt.key || (opt.key === null && isAuto)
          return (
            <button
              key={opt.key || 'auto'}
              type="button"
              onClick={() => pick(opt.key)}
              disabled={saving}
              title={opt.hint}
              className={`text-[10px] py-1 px-2 border rounded cursor-pointer flex items-center gap-1 ${
                active
                  ? 'bg-[#6C5CE7] border-[#6C5CE7] text-white'
                  : 'bg-white border-[#e5e5e5] text-ink hover:border-[#6C5CE7]/40'
              }`}
            >
              <span className="leading-none">{opt.icon}</span>
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
