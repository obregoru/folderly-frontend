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
        <div className="space-y-1.5">
          {mixLog.map((r, i) => {
            const isDupePrimary = r.source === 'primary' && doublePrimary
            const isDupeSegId = r.source === 'segment' && segIdCounts.get(r.id) > 1
            const flag = isDupePrimary || isDupeSegId
            return (
              <div
                key={i}
                className={`border rounded p-2 text-[10px] font-mono ${flag ? 'bg-[#fdf2f1] border-[#c0392b]/40' : 'bg-white border-[#e5e5e5]'}`}
              >
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`font-mono rounded px-1.5 py-0.5 text-white ${r.source === 'primary' ? 'bg-[#6C5CE7]' : 'bg-[#2D9A5E]'}`}>
                    #{i + 1}
                  </span>
                  <span className="font-medium">{r.source}</span>
                  <span className="text-muted">via</span>
                  <span>{r.via}</span>
                  {flag && <span className="ml-auto text-[#c0392b] font-bold">⚠ DUPLICATE</span>}
                </div>
                <div className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-0.5 break-all">
                  <span className="text-muted">id:</span>
                  <span>{r.id || <span className="text-muted">—</span>}</span>
                  <span className="text-muted">start:</span>
                  <span>{fmtTime(r.startTime)}</span>
                  <span className="text-muted">size:</span>
                  <span>{fmtBytes(r.bytes)}</span>
                  {(r.fadeInMs || r.fadeOutMs) ? (
                    <>
                      <span className="text-muted">fade:</span>
                      <span>{r.fadeInMs || 0}ms in / {r.fadeOutMs || 0}ms out</span>
                    </>
                  ) : null}
                  <span className="text-muted">audioKey:</span>
                  <span className="text-[#6C5CE7]">{r.audioKey || <span className="text-muted">— (in-memory base64)</span>}</span>
                  {r.text ? (
                    <>
                      <span className="text-muted">text:</span>
                      <span className="font-sans text-[10px]">{r.text}</span>
                    </>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
