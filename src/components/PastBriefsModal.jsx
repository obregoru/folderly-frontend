// Past campaign briefs viewer.
//
// Read-only counterpart to CampaignBuilderModal — lists briefs the
// operator has pasted before, shows the full source_text on click,
// and links out to the draft jobs each brief spawned. Useful when
// the operator wants to re-read what they handed the producer, or
// jump back to a job they generated from a brief weeks ago.
//
// Renders in two phases:
//   1. List view: titles + tagline + date + job_count, paginated
//      newest-first
//   2. Detail view: full source_text in a monospace pre + linked
//      job-name pills that route to the editor
//
// No delete / edit — same minimal-surface philosophy the rest of
// the campaign feature follows.

import { useEffect, useState } from 'react'
import * as api from '../api'

export default function PastBriefsModal({ onClose, onJumpToDraft }) {
  const [briefs, setBriefs] = useState(null)   // null = loading, [] = empty
  const [listErr, setListErr] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [detail, setDetail] = useState(null)   // { campaign, jobs }
  const [detailErr, setDetailErr] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.listCampaigns(200)
      .then(r => { if (!cancelled) setBriefs(r) })
      .catch(e => { if (!cancelled) setListErr(e?.message || String(e)) })
    return () => { cancelled = true }
  }, [])

  const openBrief = async (id) => {
    setOpenId(id); setDetail(null); setDetailErr(null); setDetailLoading(true)
    try {
      const r = await api.getCampaign(id)
      setDetail(r)
    } catch (e) {
      setDetailErr(e?.message || String(e))
    } finally {
      setDetailLoading(false)
    }
  }

  const closeBrief = () => {
    setOpenId(null); setDetail(null); setDetailErr(null)
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 p-3 border-b border-[#e5e5e5]">
          <div className="text-[14px] font-bold flex-1">
            {openId ? '📄 Brief' : '📚 Past campaign briefs'}
          </div>
          {openId && (
            <button
              type="button"
              onClick={closeBrief}
              className="text-[11px] text-muted bg-white border border-[#e5e5e5] rounded py-1 px-2 cursor-pointer"
            >← Back to list</button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-[14px] text-muted bg-transparent border-none cursor-pointer px-2"
            aria-label="Close"
          >✕</button>
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-2">
          {/* LIST VIEW */}
          {!openId && (
            <>
              {listErr && (
                <div className="text-[11px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2">
                  Failed to load past briefs: {listErr}
                </div>
              )}
              {briefs === null && !listErr && (
                <div className="text-[11px] text-muted italic p-4 text-center">Loading…</div>
              )}
              {briefs?.length === 0 && (
                <div className="text-[11px] text-muted italic p-6 text-center">
                  No past briefs yet. Click ✨ Brief on the drafts header to paste one and fan it out into draft jobs.
                </div>
              )}
              {briefs?.length > 0 && (
                <ul className="space-y-1">
                  {briefs.map(b => (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => openBrief(b.id)}
                        className="w-full text-left bg-white border border-[#e5e5e5] hover:border-[#2D9A5E]/50 hover:bg-[#f0faf4] rounded p-2 cursor-pointer"
                      >
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <div className="text-[12px] font-medium flex-1 truncate">
                            {b.title || '(untitled brief)'}
                          </div>
                          <div className="text-[9px] text-muted whitespace-nowrap">
                            {b.created_at ? new Date(b.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                          </div>
                        </div>
                        {b.tagline && (
                          <div className="text-[10px] text-muted truncate mt-0.5">{b.tagline}</div>
                        )}
                        <div className="text-[9px] text-[#2D9A5E] mt-1">
                          {b.job_count} draft job{b.job_count === 1 ? '' : 's'}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* DETAIL VIEW */}
          {openId && (
            <>
              {detailErr && (
                <div className="text-[11px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2">
                  Failed to load brief: {detailErr}
                </div>
              )}
              {detailLoading && !detail && (
                <div className="text-[11px] text-muted italic p-4 text-center">Loading…</div>
              )}
              {detail?.campaign && (
                <div className="space-y-2">
                  <div>
                    <div className="text-[14px] font-bold">{detail.campaign.title || '(untitled brief)'}</div>
                    {detail.campaign.tagline && (
                      <div className="text-[11px] text-muted mt-0.5">{detail.campaign.tagline}</div>
                    )}
                    <div className="text-[9px] text-muted mt-1">
                      Pasted {detail.campaign.created_at ? new Date(detail.campaign.created_at).toLocaleString() : '—'}
                    </div>
                  </div>

                  {Array.isArray(detail.jobs) && detail.jobs.length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted font-medium uppercase tracking-wide mb-1">
                        Jobs created from this brief
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {detail.jobs.map(j => (
                          <button
                            key={j.id}
                            type="button"
                            onClick={() => {
                              if (onJumpToDraft) {
                                onJumpToDraft(j.id)
                                onClose?.()
                              }
                            }}
                            className="text-[10px] py-0.5 px-1.5 bg-white border border-[#6C5CE7]/30 hover:border-[#6C5CE7] text-[#6C5CE7] rounded cursor-pointer"
                            title={`Open draft "${j.job_name || j.id}"`}
                          >📄 {j.job_name || j.id.slice(0, 8)}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="text-[10px] text-muted font-medium uppercase tracking-wide mb-1 flex items-center gap-2">
                      <span>Source brief</span>
                      <button
                        type="button"
                        onClick={() => {
                          try { navigator.clipboard.writeText(detail.campaign.source_text || '') } catch {}
                        }}
                        className="text-[9px] text-[#6C5CE7] bg-white border border-[#6C5CE7]/30 rounded py-0.5 px-1.5 cursor-pointer"
                        title="Copy the full brief to clipboard"
                      >Copy</button>
                    </div>
                    <pre className="text-[10px] font-mono bg-[#fafafa] border border-[#e5e5e5] rounded p-2 whitespace-pre-wrap break-words max-h-[400px] overflow-auto">
                      {detail.campaign.source_text || '(empty)'}
                    </pre>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
