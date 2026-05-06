// V3 Phase 1 — topic ideation screen.
//
// Three-panel flow:
//   1. Compose: pick template + write prompt + click Generate
//   2. Review: 8 candidate cards with multi-select checkboxes
//   3. History: list of past ideation runs the user can re-open
//
// Past-run re-open path lets the user accept additional candidates
// from a previous run without re-paying for another Claude call.

import { useEffect, useState } from 'react'
import * as api from '../api'

const TEMPLATE_OPTIONS = [
  { key: 'experience_feature', label: 'Experience feature' },
  { key: 'regional_roundup',   label: 'Regional roundup' },
  { key: 'trend_piece',        label: 'Trend piece' },
  { key: 'seasonal_roundup',   label: 'Seasonal roundup' },
  { key: 'shop_owner_ideas',   label: 'Ideas for shop owners' },
]

export default function TopicIdeation() {
  const [config, setConfig] = useState(null)
  const [enabledTemplates, setEnabledTemplates] = useState([])
  const [template, setTemplate] = useState('')
  const [promptText, setPromptText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)

  // Current ideation run (either freshly generated or loaded from history).
  const [activeRun, setActiveRun] = useState(null)
  const [selectedIndices, setSelectedIndices] = useState(new Set())
  const [accepting, setAccepting] = useState(false)
  const [acceptedDrafts, setAcceptedDrafts] = useState([])

  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)

  // Load tenant config (to check which templates are enabled) +
  // history of past runs on mount.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.getContentConfig().catch(() => null),
      api.listTopics().catch(() => ({ items: [] })),
    ]).then(([c, h]) => {
      if (cancelled) return
      setConfig(c)
      const enabled = Array.isArray(c?.enabled_templates) ? c.enabled_templates : []
      setEnabledTemplates(enabled)
      if (enabled.length > 0 && !template) setTemplate(enabled[0])
      setHistory(Array.isArray(h?.items) ? h.items : [])
      setHistoryLoading(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleGenerate = async () => {
    if (!template || !promptText.trim()) return
    setGenerating(true)
    setError(null)
    setActiveRun(null)
    setSelectedIndices(new Set())
    setAcceptedDrafts([])
    try {
      const result = await api.ideateTopics({ template, promptText })
      setActiveRun(result)
      // Refresh history list so the new run appears.
      api.listTopics().then(h => setHistory(Array.isArray(h?.items) ? h.items : []))
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setGenerating(false)
    }
  }

  const handleAccept = async () => {
    if (!activeRun || selectedIndices.size === 0) return
    setAccepting(true)
    setError(null)
    try {
      const indices = Array.from(selectedIndices).sort((a, b) => a - b)
      const result = await api.acceptTopics(activeRun.topic_id, indices)
      setAcceptedDrafts(result.drafts || [])
      // Update activeRun.accepted_indices so the UI reflects which
      // candidates are now drafts.
      setActiveRun(prev => prev ? { ...prev, accepted_indices: result.accepted_indices } : prev)
      setSelectedIndices(new Set())
      // Refresh history to update the chip on this run.
      api.listTopics().then(h => setHistory(Array.isArray(h?.items) ? h.items : []))
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setAccepting(false)
    }
  }

  const openPastRun = async (id) => {
    setError(null)
    setActiveRun(null)
    setSelectedIndices(new Set())
    setAcceptedDrafts([])
    try {
      const run = await api.getTopic(id)
      // Normalize shape — getTopic returns the row directly, not the
      // { topic_id, candidates, ... } shape that ideate returns.
      setActiveRun({
        topic_id: run.id,
        template: run.template,
        prompt_text: run.prompt_text,
        candidates: run.candidates || [],
        accepted_indices: run.accepted_indices || [],
        metadata: run.metadata,
        created_at: run.created_at,
      })
      // Pre-fill the prompt + template fields so the user can re-run
      // with edits if they want.
      setTemplate(run.template)
      setPromptText(run.prompt_text)
    } catch (e) {
      setError(e?.message || String(e))
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Compose ──────────────────────────────────────────── */}
      <div className="bg-white border border-[#e5e5e5] rounded p-3">
        <h2 className="text-[14px] font-bold mb-2">Generate topic ideas</h2>
        {enabledTemplates.length === 0 ? (
          <div className="text-[11px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2">
            No templates enabled. Open <b>Config</b> and enable at least one content template to use ideation.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
              <div>
                <label className="text-[10px] font-medium block mb-0.5">Template</label>
                <select
                  value={template}
                  onChange={e => setTemplate(e.target.value)}
                  className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5"
                >
                  {TEMPLATE_OPTIONS.filter(t => enabledTemplates.includes(t.key)).map(t => (
                    <option key={t.key} value={t.key}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <label className="text-[10px] font-medium block mb-0.5">Your prompt</label>
            <textarea
              value={promptText}
              onChange={e => setPromptText(e.target.value)}
              placeholder={`e.g. "Find 4 make-and-take projects a small business can offer during shop hop week. Easy ones to skip: candles, soap, perfume, ceramics, painting. Look at makeandtakes.com for ideas a store could host but are not in the easy list."`}
              rows={5}
              className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 resize-y"
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating || !template || !promptText.trim()}
                className="text-[11px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
              >
                {generating ? 'Generating…' : '✨ Generate 8 topics'}
              </button>
              <span className="text-[10px] text-muted italic">Uses Claude + web search · ~10–30s</span>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2 text-[11px] text-[#c0392b]">
          {error}
        </div>
      )}

      {/* ── Active run / candidates ────────────────────────────── */}
      {activeRun && (
        <div className="bg-white border border-[#e5e5e5] rounded p-3 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <h3 className="text-[12px] font-medium">
                {activeRun.candidates.length} candidates ·{' '}
                <span className="text-muted">{TEMPLATE_OPTIONS.find(t => t.key === activeRun.template)?.label || activeRun.template}</span>
              </h3>
              {activeRun.metadata && (
                <div className="text-[9px] text-muted">
                  {activeRun.metadata.model} · {activeRun.metadata.duration_ms}ms ·
                  in: {activeRun.metadata.tokens_in} · out: {activeRun.metadata.tokens_out}
                  {activeRun.metadata.web_search_uses ? ` · ${activeRun.metadata.web_search_uses} web search${activeRun.metadata.web_search_uses === 1 ? '' : 'es'}` : ''}
                </div>
              )}
            </div>
            <div className="text-right">
              <button
                type="button"
                onClick={handleAccept}
                disabled={accepting || selectedIndices.size === 0}
                className="text-[11px] py-1.5 px-3 bg-[#2D9A5E] text-white border-none rounded cursor-pointer disabled:opacity-40 font-medium whitespace-nowrap"
              >
                {accepting ? 'Creating drafts…' : `✓ Accept ${selectedIndices.size} → drafts`}
              </button>
            </div>
          </div>

          {acceptedDrafts.length > 0 && (
            <div className="bg-[#f0faf4] border border-[#2D9A5E]/30 rounded p-2 text-[11px] text-[#0a4d2c]">
              ✓ Created {acceptedDrafts.length} draft{acceptedDrafts.length === 1 ? '' : 's'}:
              <ul className="mt-1 ml-2 list-disc list-inside">
                {acceptedDrafts.map(d => <li key={d.id}>{d.title} <span className="text-muted">/{d.slug}</span></li>)}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {activeRun.candidates.map((c, i) => {
              const accepted = (activeRun.accepted_indices || []).includes(i)
              const selected = selectedIndices.has(i)
              return (
                <label
                  key={i}
                  className={`block border rounded p-2 cursor-pointer transition ${
                    accepted
                      ? 'border-[#2D9A5E] bg-[#f0faf4] cursor-default'
                      : selected
                        ? 'border-[#6C5CE7] bg-[#f3f0ff]'
                        : 'border-[#e5e5e5] bg-white hover:border-[#6C5CE7]/50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      disabled={accepted}
                      checked={selected || accepted}
                      onChange={e => {
                        if (accepted) return
                        setSelectedIndices(prev => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(i); else next.delete(i)
                          return next
                        })
                      }}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[10px] text-muted font-mono">#{i + 1}</span>
                        {accepted && <span className="text-[9px] bg-[#2D9A5E] text-white rounded px-1 py-0.5 leading-none">DRAFTED</span>}
                      </div>
                      <div className="text-[12px] font-medium text-ink leading-tight">{c.title}</div>
                      <div className="text-[10px] text-muted mt-0.5 italic">{c.audience_hook}</div>
                      <div className="text-[10px] text-ink mt-1">{c.angle}</div>
                      {Array.isArray(c.suggested_categories) && c.suggested_categories.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.suggested_categories.map((cat, j) => (
                            <span
                              key={j}
                              className="text-[9px] bg-[#f3f0ff] text-[#6C5CE7] rounded px-1.5 py-0.5"
                              title="WP category suggestion (editable on the draft)"
                            >{cat}</span>
                          ))}
                        </div>
                      )}
                      {Array.isArray(c.suggested_h2s) && c.suggested_h2s.length > 0 && (
                        <details className="mt-1">
                          <summary className="text-[9px] text-muted cursor-pointer">Suggested H2s ({c.suggested_h2s.length})</summary>
                          <ul className="mt-0.5 ml-3 list-disc list-inside text-[10px] text-muted">
                            {c.suggested_h2s.map((h, j) => <li key={j}>{h}</li>)}
                          </ul>
                        </details>
                      )}
                      {c.rationale && (
                        <details className="mt-1">
                          <summary className="text-[9px] text-muted cursor-pointer">Why this fits</summary>
                          <div className="text-[10px] text-muted mt-0.5">{c.rationale}</div>
                        </details>
                      )}
                    </div>
                  </div>
                </label>
              )
            })}
          </div>
        </div>
      )}

      {/* ── History ──────────────────────────────────────────── */}
      <div className="bg-white border border-[#e5e5e5] rounded p-3">
        <h3 className="text-[12px] font-medium mb-2">Past ideation runs</h3>
        {historyLoading ? (
          <div className="text-[10px] text-muted">Loading…</div>
        ) : history.length === 0 ? (
          <div className="text-[10px] text-muted italic">No runs yet — generate your first one above.</div>
        ) : (
          <ul className="space-y-1">
            {history.map(h => {
              const candidates = Array.isArray(h.candidates) ? h.candidates.length : 0
              const accepted = Array.isArray(h.accepted_indices) ? h.accepted_indices.length : 0
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => openPastRun(h.id)}
                    className="w-full text-left flex items-start gap-2 p-2 border border-[#e5e5e5] rounded hover:border-[#6C5CE7]/50 cursor-pointer bg-white"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-muted">
                        {new Date(h.created_at).toLocaleString()} · <span className="font-medium">{TEMPLATE_OPTIONS.find(t => t.key === h.template)?.label || h.template}</span>
                      </div>
                      <div className="text-[11px] text-ink truncate">{h.prompt_text}</div>
                    </div>
                    <div className="text-[10px] whitespace-nowrap">
                      {accepted}/{candidates} accepted
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
