import { useEffect, useState } from 'react'
import * as api from '../../api'
import AiLogRow from './AiLogRow'

/**
 * Per-draft AI interaction log. Shows every Anthropic call made for this
 * specific job — auto-name, caption generations, voiceover script
 * suggestions, etc. — so the user can see what the AI produced for
 * THIS draft and compare / reuse / paste into another model.
 */
export default function JobAiLogModal({ draftId, open, onClose }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [endpointFilter, setEndpointFilter] = useState('')

  const load = async () => {
    if (!draftId) return
    setLoading(true); setErr(null)
    try {
      const r = await api.getAiLog({ limit: 100, job_uuid: draftId, endpoint: endpointFilter || undefined })
      if (Array.isArray(r)) setRows(r)
      else if (r?.error) throw new Error(r.error)
    } catch (e) { setErr(e.message || String(e)) }
    finally { setLoading(false) }
  }
  useEffect(() => { if (open) load() /* eslint-disable-next-line */ }, [open, draftId, endpointFilter])

  if (!open) return null

  const endpoints = Array.from(new Set(rows.map(r => r.endpoint))).sort()

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-start justify-center p-4" onClick={onClose}>
      <div
        className="bg-white w-full max-w-[560px] max-h-[88vh] rounded-lg overflow-hidden flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e5e5e5]">
          <div className="text-[12px] font-medium flex-1">AI activity for this draft</div>
          <button onClick={onClose} className="text-[14px] text-muted bg-transparent border-none cursor-pointer px-1">✕</button>
        </div>

        <div className="p-3 space-y-2 overflow-y-auto flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={load}
              disabled={loading}
              className="text-[10px] py-1 px-2 border border-[#e5e5e5] rounded bg-white cursor-pointer disabled:opacity-50"
            >{loading ? 'Loading…' : 'Refresh'}</button>
            <select
              value={endpointFilter}
              onChange={e => setEndpointFilter(e.target.value)}
              className="text-[10px] border border-[#e5e5e5] rounded py-1 px-1.5 bg-white flex-1"
            >
              <option value="">All endpoints</option>
              {endpoints.map(ep => <option key={ep} value={ep}>{ep}</option>)}
            </select>
          </div>

          {err && <div className="text-[10px] text-[#c0392b]">{err}</div>}

          {!loading && rows.length === 0 && (
            <div className="text-[10px] text-muted italic py-6 text-center">
              No AI calls yet for this draft.
              <br />
              Trigger one by auto-naming, generating captions, or running any AI action — it'll appear here.
            </div>
          )}

          <div className="space-y-1">
            {rows.map(r => <AiLogRow key={r.uuid} row={r} />)}
          </div>
        </div>
      </div>
    </div>
  )
}
