// Inline diagnostic of every audio track render-final ACTUALLY mixed
// into the exported video. Driven by the 'posty-render-final-result'
// event fired by DownloadFinalButton — the event detail carries the
// server's mix_log[] (every source pushed into voSegInputs, in order),
// so what you see here is what FFmpeg actually combined into the mp4.
//
// Hidden until the user presses Download once. Refreshes on every
// subsequent press.

import { useEffect, useState } from 'react'

export default function AudioMixLog({ draftId }) {
  const [mixLog, setMixLog] = useState(null)
  const [tookMs, setTookMs] = useState(null)
  const [applied, setApplied] = useState(null)
  const [shown, setShown] = useState(false)
  const [lastFiredAt, setLastFiredAt] = useState(null)

  useEffect(() => {
    if (!draftId) return
    const onResult = (e) => {
      const d = e?.detail
      if (!d || d.draftId !== draftId) return
      setShown(true)
      setMixLog(Array.isArray(d.mixLog) ? d.mixLog : [])
      setTookMs(d.tookMs ?? null)
      setApplied(d.applied || null)
      setLastFiredAt(new Date())
    }
    window.addEventListener('posty-render-final-result', onResult)
    return () => window.removeEventListener('posty-render-final-result', onResult)
  }, [draftId])

  if (!shown) return null

  const fmtTime = (t) => t == null ? '?' : `${Number(t).toFixed(2)}s`
  const fmtBytes = (n) => {
    if (n == null) return '—'
    if (n < 1024) return `${n}B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
    return `${(n / 1024 / 1024).toFixed(2)}MB`
  }
  const shortKey = (k) => !k ? '—' : (k.length > 36 ? `…${k.slice(-36)}` : k)

  // Detect double-mix of primary so we can flag it visually.
  const primaryRows = (mixLog || []).filter(r => r.source === 'primary')
  const segmentRows = (mixLog || []).filter(r => r.source === 'segment')
  const doublePrimary = primaryRows.length > 1
  // Detect duplicate segment IDs (would mean a segment was pushed twice).
  const segIdCounts = new Map()
  for (const r of segmentRows) segIdCounts.set(r.id, (segIdCounts.get(r.id) || 0) + 1)
  const dupSegs = [...segIdCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id)

  return (
    <div className="bg-[#fafafa] border border-[#e5e5e5] rounded p-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[11px] font-medium flex-1">🔍 Audio mix log (server)</div>
        {tookMs != null && <div className="text-[9px] text-muted">took {tookMs}ms</div>}
        {lastFiredAt && (
          <div className="text-[9px] text-muted">at {lastFiredAt.toLocaleTimeString()}</div>
        )}
        <button
          onClick={() => setShown(false)}
          className="text-[9px] py-0.5 px-1.5 border border-[#e5e5e5] rounded bg-white cursor-pointer text-muted"
          title="Hide — press Download again to bring it back"
        >×</button>
      </div>
      <div className="text-[9px] text-muted">
        Every audio source the server pushed into the FFmpeg mix, in order. This is ground truth for the exported mp4.
      </div>

      {(doublePrimary || dupSegs.length > 0) && (
        <div className="bg-[#fdf2f1] border border-[#c0392b]/40 text-[#c0392b] rounded p-2 text-[10px] space-y-0.5">
          {doublePrimary && (
            <div>⚠ Primary mixed <strong>{primaryRows.length}× </strong> — this is the doubled-voice bug. via: {primaryRows.map(r => r.via).join(', ')}</div>
          )}
          {dupSegs.length > 0 && (
            <div>⚠ Duplicate segment id(s): {dupSegs.join(', ')}</div>
          )}
        </div>
      )}

      {applied && (
        <div className="text-[9px] text-muted">
          {applied.voiceover_tracks} voiceover track(s) · captions: {applied.captions} · overlays: {applied.overlays ? 'yes' : 'no'}
        </div>
      )}

      {mixLog && mixLog.length === 0 && (
        <div className="text-[10px] text-muted italic">No audio sources mixed (export was video-only).</div>
      )}

      {mixLog && mixLog.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] font-mono">
            <thead className="text-[9px] uppercase text-muted">
              <tr>
                <th className="text-left py-1 pr-2">#</th>
                <th className="text-left py-1 pr-2">source</th>
                <th className="text-left py-1 pr-2">via</th>
                <th className="text-left py-1 pr-2">id</th>
                <th className="text-right py-1 pr-2">start</th>
                <th className="text-right py-1 pr-2">size</th>
                <th className="text-right py-1 pr-2">fade</th>
                <th className="text-left py-1 pr-2">audio key</th>
                <th className="text-left py-1 pr-2">text</th>
              </tr>
            </thead>
            <tbody>
              {mixLog.map((r, i) => {
                const isDupePrimary = r.source === 'primary' && doublePrimary
                const isDupeSegId = r.source === 'segment' && segIdCounts.get(r.id) > 1
                const flag = isDupePrimary || isDupeSegId
                return (
                  <tr key={i} className={`border-t border-[#e5e5e5] ${flag ? 'bg-[#fdf2f1]' : ''}`}>
                    <td className="py-1 pr-2">{i + 1}</td>
                    <td className="py-1 pr-2">{r.source}</td>
                    <td className="py-1 pr-2">{r.via}</td>
                    <td className="py-1 pr-2 truncate max-w-[140px]" title={r.id}>{r.id}</td>
                    <td className="py-1 pr-2 text-right">{fmtTime(r.startTime)}</td>
                    <td className="py-1 pr-2 text-right">{fmtBytes(r.bytes)}</td>
                    <td className="py-1 pr-2 text-right">
                      {(r.fadeInMs || r.fadeOutMs) ? `${r.fadeInMs || 0}/${r.fadeOutMs || 0}` : '—'}
                    </td>
                    <td className="py-1 pr-2 truncate max-w-[200px]" title={r.audioKey || ''}>
                      {r.audioKey ? shortKey(r.audioKey) : <span className="text-muted">in-memory</span>}
                    </td>
                    <td className="py-1 pr-2 text-[10px] font-sans truncate max-w-[200px]" title={r.text || ''}>
                      {r.text || <span className="text-muted italic">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
