// Campaign fan-out modal: paste a multi-video brief → N draft jobs.
//
// Standalone modal, NOT scoped to the jobs lifecycle. The created
// jobs end up as ordinary draft rows in the global jobs list with
// a campaign_id pointer for traceability — there's no
// campaign → jobs hierarchy in the UI.

import { useState } from 'react'
import * as api from '../api'

export default function CampaignBuilderModal({ onClose, onCreated }) {
  const [text, setText] = useState('')
  const [phase, setPhase] = useState('paste') // 'paste' | 'previewing' | 'preview' | 'creating'
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)

  const runPreview = async () => {
    const trimmed = text.trim()
    if (!trimmed) { setError('Paste a campaign brief first.'); return }
    setError(null); setPhase('previewing')
    try {
      const r = await api.previewCampaign(trimmed)
      setPreview(r)
      setPhase('preview')
    } catch (e) {
      setError(e?.message || String(e))
      setPhase('paste')
    }
  }

  const commit = async () => {
    if (phase === 'creating') return
    setError(null); setPhase('creating')
    try {
      const r = await api.createCampaign(text.trim())
      if (typeof onCreated === 'function') await onCreated(r)
    } catch (e) {
      setError(e?.message || String(e))
      setPhase('preview')
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-2"
      onClick={() => phase !== 'creating' && onClose && onClose()}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white rounded shadow-xl border border-border w-full max-w-[760px] max-h-[88vh] flex flex-col"
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <span className="text-[12px] font-semibold">✨ Build jobs from campaign brief</span>
          <span className="text-[10px] text-muted flex-1">Paste a multi-video brief. We parse it into one draft job per video.</span>
          <button
            onClick={() => onClose && onClose()}
            disabled={phase === 'creating'}
            className="text-[11px] py-0.5 px-2 bg-white border border-border rounded cursor-pointer disabled:opacity-50"
          >Close</button>
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-2">
          {phase === 'paste' || phase === 'previewing' ? (
            <>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Paste the full campaign brief here. Include the overarching theme + each job block (we look for 'JOB N:' headings or '═══' separators)."
                disabled={phase === 'previewing'}
                className="w-full min-h-[320px] text-[11px] font-mono border border-border rounded p-2 outline-none focus:border-[#6C5CE7] resize-y"
              />
              {error && <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted">{text.length.toLocaleString()} chars · {text.length > 80000 ? '⚠ too long (max 80k)' : 'cap is 80k chars'}</span>
                <span className="flex-1" />
                <button
                  onClick={runPreview}
                  disabled={phase === 'previewing' || !text.trim() || text.length > 80000}
                  className="text-[11px] py-1 px-2.5 border border-[#6C5CE7] text-[#6C5CE7] rounded bg-white cursor-pointer hover:bg-[#f3f0ff] disabled:opacity-40"
                >{phase === 'previewing' ? 'Parsing…' : '🔍 Preview parsed jobs'}</button>
              </div>
            </>
          ) : (
            <>
              {preview?.campaign?.campaign_title && (
                <div className="bg-[#fafbff] border border-[#6C5CE7]/30 rounded p-2">
                  <div className="text-[11px] font-semibold">{preview.campaign.campaign_title}</div>
                  {preview.campaign.campaign_tagline && (
                    <div className="text-[10px] text-muted italic mt-0.5">{preview.campaign.campaign_tagline}</div>
                  )}
                </div>
              )}
              <div className="text-[10px] text-muted">
                Parsed <b>{preview?.jobs?.length || 0}</b> video{(preview?.jobs?.length || 0) === 1 ? '' : 's'} in {preview?.parse_ms || 0}ms.
                Each will be created as a standalone draft job (no campaign → job hierarchy in the UI). Hint_text wraps overlays, voiceover script, and hashtags so Producer + downstream tools see the full brief.
              </div>
              <div className="space-y-1.5">
                {(preview?.jobs || []).map((j, i) => (
                  <div key={i} className="border border-border rounded p-2 bg-[#fafafa]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono py-0.5 px-1 bg-[#e0e7ff] text-[#3730a3] rounded">JOB {i + 1}</span>
                      <span className="text-[11px] font-semibold">{j.job_name}</span>
                      {j.theme_tagline && <span className="text-[10px] italic text-muted">— {j.theme_tagline}</span>}
                    </div>
                    {j.about && (
                      <div className="text-[10px] text-ink mt-1 line-clamp-3">{j.about}</div>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap text-[9px] text-muted">
                      <span>{(j.angles || []).length} angles</span>
                      <span>·</span>
                      <span>{(j.voiceover_segments || []).length} VO beats</span>
                      <span>·</span>
                      <span>{(j.hashtags || []).length} hashtags</span>
                      {(j.overlays?.opening || j.overlays?.middle || j.overlays?.closing) && (
                        <>
                          <span>·</span>
                          <span>3-slot overlays</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {error && <div className="text-[10px] text-[#c0392b]">⚠ {error}</div>}
            </>
          )}
        </div>

        {phase === 'preview' && (
          <div className="flex items-center gap-2 px-3 py-2 border-t border-border">
            <button
              onClick={() => { setPhase('paste'); setPreview(null) }}
              disabled={phase === 'creating'}
              className="text-[11px] py-1 px-2.5 border border-border rounded bg-white cursor-pointer disabled:opacity-50"
            >← Back to brief</button>
            <span className="flex-1" />
            <button
              onClick={commit}
              disabled={phase === 'creating' || !(preview?.jobs?.length)}
              className="text-[11px] py-1 px-3 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-50"
            >{phase === 'creating' ? 'Creating jobs…' : `✓ Create ${preview?.jobs?.length || 0} job${(preview?.jobs?.length || 0) === 1 ? '' : 's'}`}</button>
          </div>
        )}
      </div>
    </div>
  )
}
