// Inline diagnostic of every audio track render-final will mix into
// the exported video. Mirrors the BE mix logic (social-post.js):
//   - primary at t=0 from job.voiceover_audio_key
//   - each segment with an audioKey at its startTime
//   - the synthetic __primary__ segment is excluded from the segment
//     mix path (the row labelled "primary" comes from voiceover_audio_key)
//
// Hidden until the user presses "Download final" once. Listens for
// the 'posty-render-final-fired' event the DownloadFinalButton emits,
// then fetches fresh job state and renders the table inline below the
// button. Auto-refreshes every time Download is pressed.

import { useEffect, useMemo, useState } from 'react'
import * as api from '../../api'

export default function AudioMixLog({ draftId }) {
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(false)
  // Hidden by default — only appears after the first Download press.
  // Stays visible afterwards so the user can read it without having
  // to re-trigger.
  const [shown, setShown] = useState(false)
  const [lastFiredAt, setLastFiredAt] = useState(null)

  useEffect(() => {
    if (!draftId) return
    const onRender = () => {
      setShown(true)
      setLoading(true)
      setLastFiredAt(new Date())
      api.getJob(draftId)
        .then(j => { setJob(j); setLoading(false) })
        .catch(() => setLoading(false))
    }
    window.addEventListener('posty-render-final-fired', onRender)
    return () => window.removeEventListener('posty-render-final-fired', onRender)
  }, [draftId])

  const tracks = useMemo(() => {
    if (!job) return []
    const rows = []
    if (job.voiceover_audio_key || job.voiceover_audio_url) {
      const primarySeg = (job.voiceover_settings?.segments || []).find(s => s?.id === '__primary__')
      rows.push({
        kind: 'primary',
        number: 1,
        id: '__primary__',
        startTime: 0,
        duration: Number(primarySeg?.duration) || null,
        text: primarySeg?.text || '',
        audioKey: job.voiceover_audio_key || '(public URL only)',
        warn: null,
      })
    }
    const segs = Array.isArray(job.voiceover_settings?.segments) ? job.voiceover_settings.segments : []
    const ordered = segs
      .filter(s => s && s.id !== '__primary__')
      .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0))
    ordered.forEach((s, i) => {
      rows.push({
        kind: 'segment',
        number: i + 2,
        id: s.id,
        startTime: Number(s.startTime) || 0,
        duration: Number(s.duration) || null,
        text: s.text || '',
        audioKey: s.audioKey || null,
        warn: s.audioKey ? null : 'no audio — will NOT mix',
      })
    })
    return rows
  }, [job])

  if (!shown) return null

  const fmtTime = (t) => t == null ? '?' : `${Number(t).toFixed(1)}s`
  const shortKey = (k) => !k ? '—' : (k.length > 36 ? `…${k.slice(-36)}` : k)

  return (
    <div className="bg-[#fafafa] border border-[#e5e5e5] rounded p-2 space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-[11px] font-medium flex-1">🔍 Audio mix log</div>
        {lastFiredAt && (
          <div className="text-[9px] text-muted">
            captured {lastFiredAt.toLocaleTimeString()}
          </div>
        )}
        <button
          onClick={() => setShown(false)}
          className="text-[9px] py-0.5 px-1.5 border border-[#e5e5e5] rounded bg-white cursor-pointer text-muted"
          title="Hide the log — press Download again to bring it back"
        >×</button>
      </div>
      <div className="text-[9px] text-muted">
        Every audio track render-final mixed into the export, in time order. Mirrors the backend mix logic — anything in red has no audio and was skipped.
      </div>
      {loading && <div className="text-[10px] text-muted">Loading…</div>}
      {!loading && tracks.length === 0 && (
        <div className="text-[10px] text-muted italic">No audio tracks.</div>
      )}
      {!loading && tracks.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] font-mono">
            <thead className="text-[9px] uppercase text-muted">
              <tr>
                <th className="text-left py-1 pr-2">#</th>
                <th className="text-left py-1 pr-2">kind</th>
                <th className="text-left py-1 pr-2">id</th>
                <th className="text-right py-1 pr-2">start</th>
                <th className="text-right py-1 pr-2">dur</th>
                <th className="text-left py-1 pr-2">text</th>
                <th className="text-left py-1 pr-2">audio</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((t, i) => (
                <tr key={i} className={`border-t border-[#e5e5e5] ${t.warn ? 'bg-[#fdf2f1]' : ''}`}>
                  <td className="py-1 pr-2">{t.number}</td>
                  <td className="py-1 pr-2">{t.kind}</td>
                  <td className="py-1 pr-2 truncate max-w-[120px]" title={t.id}>{t.id}</td>
                  <td className="py-1 pr-2 text-right">{fmtTime(t.startTime)}</td>
                  <td className="py-1 pr-2 text-right">{fmtTime(t.duration)}</td>
                  <td className="py-1 pr-2 text-[10px] font-sans truncate max-w-[200px]" title={t.text}>
                    {t.text || <span className="text-muted italic">—</span>}
                  </td>
                  <td className="py-1 pr-2 truncate max-w-[200px]" title={t.audioKey || ''}>
                    {t.audioKey ? shortKey(t.audioKey) : <span className="text-[#c0392b]">{t.warn}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
