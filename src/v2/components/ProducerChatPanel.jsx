// Producer Chat — an in-app conversation with Claude scoped to ONE
// draft. The system prompt (built server-side) injects brand,
// location, video clips, current voiceover/overlay state, and the
// available ElevenLabs voices, so every reply is grounded in the
// real draft. Streaming via fetch/ReadableStream — tokens paint as
// they arrive.
//
// Two flows in one panel:
//   1. Chat — type a message, Claude streams a reply, repeat. Reset
//      button starts a fresh thread (and forgets prior context for
//      the next turn — past turns stay in the AI log for reference).
//   2. Paste — drop text from ChatGPT / Gemini / etc into the
//      textarea, click Process, and the BE extracts structured
//      fields (primary VO line, timed segments, overlays, post
//      caption, hashtags). Each extracted field gets a checkbox so
//      the user can review and Apply only what they want.

import { useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../../api'

export default function ProducerChatPanel({ draftId, jobSync }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [err, setErr] = useState(null)
  const abortRef = useRef(null)
  const scrollRef = useRef(null)

  // Paste-import state. parsed = the structured fields the BE
  // extracted from the pasted text; the user reviews + Applies.
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [importing, setImporting] = useState(false)
  const [parsed, setParsed] = useState(null)
  const [applying, setApplying] = useState(false)
  const [applyErr, setApplyErr] = useState(null)
  const [applyMsg, setApplyMsg] = useState(null)

  // Hydrate prior chat turns on draft change. Each ai_log row =
  // one user→assistant turn, flattened back into the messages shape.
  useEffect(() => {
    if (!draftId) return
    let cancelled = false
    setHistoryLoaded(false)
    api.producerHistory(draftId).then(r => {
      if (cancelled) return
      setMessages(Array.isArray(r?.messages) ? r.messages : [])
      setHistoryLoaded(true)
    })
    return () => { cancelled = true }
  }, [draftId])

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, streamText])

  const send = async () => {
    const text = input.trim()
    if (!text || streaming) return
    setErr(null)
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setStreaming(true)
    setStreamText('')
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const { fullText, error } = await api.producerChat(draftId, {
        messages: next,
        signal: ctrl.signal,
        onChunk: (_, full) => setStreamText(full),
      })
      if (error) setErr(error)
      // Commit the streamed text as a real assistant message so the
      // next turn carries it as history.
      setMessages(prev => [...prev, { role: 'assistant', content: fullText || '' }])
      setStreamText('')
    } catch (e) {
      if (e?.name !== 'AbortError') setErr(e?.message || String(e))
      setStreamText('')
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  const stop = () => {
    if (abortRef.current) {
      try { abortRef.current.abort() } catch {}
    }
  }

  const reset = () => {
    if (streaming) return
    if (messages.length > 0 && !window.confirm('Start a new conversation? The current thread will stay in the AI log for reference but the producer won\'t see it on the next turn.')) {
      return
    }
    setMessages([])
    setStreamText('')
    setErr(null)
  }

  const onPaste = async () => {
    const text = pasteText.trim()
    if (!text) return
    setImporting(true)
    setParsed(null)
    setApplyErr(null)
    setApplyMsg(null)
    try {
      const r = await api.producerImport(draftId, text)
      setParsed(r)
    } catch (e) {
      setApplyErr(e?.message || String(e))
    } finally {
      setImporting(false)
    }
  }

  // Track which extracted fields the user wants to apply. Default ON
  // for every field present so the typical case is "click Apply".
  const [applyChoices, setApplyChoices] = useState({})
  useEffect(() => {
    if (!parsed) { setApplyChoices({}); return }
    setApplyChoices({
      primary: typeof parsed.primary === 'string' && parsed.primary.trim().length > 0,
      segments: Array.isArray(parsed.segments) && parsed.segments.length > 0,
      openingOverlay: !!parsed.overlays?.opening,
      middleOverlay: !!parsed.overlays?.middle,
      closingOverlay: !!parsed.overlays?.closing,
      platformCaption: !!parsed.platformCaption,
      hashtags: Array.isArray(parsed.hashtags) && parsed.hashtags.length > 0,
    })
  }, [parsed])

  // Apply selected fields. Voiceover writes go through jobSync so the
  // existing debounce / cache stay consistent. Overlays use the
  // overlay-change event the panels listen for. Platform caption +
  // hashtags are passed up to the parent if a setter was given;
  // otherwise we copy them to clipboard so the user can paste manually.
  const applySelection = async () => {
    if (!parsed) return
    setApplying(true); setApplyErr(null); setApplyMsg(null)
    try {
      const summary = []
      // 1. Voiceover (primary + segments). Delegate to jobSync's
      //    voiceover_settings save so the existing format
      //    (segments[].id, audioKey:null on primary, etc.) stays clean.
      const wantsVo = applyChoices.primary || applyChoices.segments
      if (wantsVo && jobSync?.saveVoiceoverSettings) {
        const cur = await api.getJob(draftId).catch(() => ({}))
        const existing = Array.isArray(cur?.voiceover_settings?.segments) ? cur.voiceover_settings.segments : []
        // Replace the synthetic primary entry's text if applicable —
        // audio re-generation is left to the user (this only changes
        // text + segment scaffolding).
        let nextSegs = [...existing]
        if (applyChoices.primary && parsed.primary) {
          const idx = nextSegs.findIndex(s => s?.id === '__primary__')
          if (idx >= 0) {
            nextSegs[idx] = { ...nextSegs[idx], text: parsed.primary, audioKey: null }
          } else {
            nextSegs.unshift({ id: '__primary__', text: parsed.primary, startTime: 0, audioKey: null, duration: null })
          }
        }
        if (applyChoices.segments && Array.isArray(parsed.segments)) {
          // Drop any existing non-primary segments so the imported
          // timeline replaces the old one cleanly. User can re-run
          // generate-segment audio after applying.
          nextSegs = nextSegs.filter(s => s?.id === '__primary__')
          for (const s of parsed.segments) {
            if (!s?.text) continue
            nextSegs.push({
              id: `seg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
              text: String(s.text),
              startTime: Number(s.startTime) || 0,
              audioKey: null,
              duration: null,
            })
          }
        }
        jobSync.saveVoiceoverSettings({ segments: nextSegs })
        if (applyChoices.primary) summary.push('primary VO text')
        if (applyChoices.segments) summary.push(`${parsed.segments.length} segment text(s)`)
      }

      // 2. Overlays — patch only the chosen fields, dispatch the
      //    same posty-overlay-change event the OverlaysPanelV2 uses
      //    so the in-editor preview updates immediately.
      const overlayPatch = {}
      if (applyChoices.openingOverlay && parsed.overlays?.opening) overlayPatch.openingText = parsed.overlays.opening
      if (applyChoices.middleOverlay && parsed.overlays?.middle) overlayPatch.middleText = parsed.overlays.middle
      if (applyChoices.closingOverlay && parsed.overlays?.closing) overlayPatch.closingText = parsed.overlays.closing
      if (Object.keys(overlayPatch).length > 0) {
        const existing = (typeof window !== 'undefined' && window._postyOverlays) || {}
        const next = { ...existing, ...overlayPatch }
        try {
          if (typeof window !== 'undefined') {
            window._postyOverlays = next
            window.dispatchEvent(new CustomEvent('posty-overlay-change', { detail: next }))
          }
        } catch {}
        jobSync?.saveOverlaySettings?.(next)
        summary.push(`${Object.keys(overlayPatch).length} overlay field(s)`)
      }

      // 3. Platform caption + hashtags — no shared state hook to
      //    plug into reliably across all panels yet, so copy to
      //    clipboard so the user can paste into the active platform's
      //    caption box. Better than silently dropping the data.
      if (applyChoices.platformCaption && parsed.platformCaption) {
        await navigator.clipboard.writeText(parsed.platformCaption).catch(() => {})
        summary.push('caption (copied to clipboard)')
      }
      if (applyChoices.hashtags && Array.isArray(parsed.hashtags) && parsed.hashtags.length > 0) {
        const tags = parsed.hashtags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ')
        await navigator.clipboard.writeText(tags).catch(() => {})
        summary.push('hashtags (copied to clipboard)')
      }

      setApplyMsg(summary.length ? `✓ Applied: ${summary.join(', ')}` : 'Nothing selected to apply.')
    } catch (e) {
      setApplyErr(e?.message || String(e))
    } finally {
      setApplying(false)
    }
  }

  const showStreamingBubble = streaming && (streamText || true)
  const empty = !streaming && messages.length === 0 && historyLoaded

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">🎬 Producer Chat</div>
        <button
          onClick={reset}
          disabled={streaming || messages.length === 0}
          className="text-[10px] py-1 px-2 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer disabled:opacity-50"
          title="Start a new conversation. Old turns stay in the 🤖 AI log."
        >New</button>
      </div>

      <div className="text-[10px] text-muted">
        Ask for hooks, voiceover scripts with timings, on-screen text, captions, or posting strategy. The producer auto-knows your brand, this video's clips, and your current draft state.
      </div>

      <div
        ref={scrollRef}
        className="border border-[#e5e5e5] rounded bg-[#fafafa] p-2 space-y-2 max-h-[40vh] overflow-y-auto"
        style={{ minHeight: 180 }}
      >
        {empty && (
          <div className="text-[10px] text-muted italic text-center py-6">
            Start with something like<br />
            <span className="font-mono text-[10px] text-[#6C5CE7]">
              "give me 3 scroll-stopping hooks for this video"
            </span><br />
            or<br />
            <span className="font-mono text-[10px] text-[#6C5CE7]">
              "write a voiceover script with timings"
            </span>
          </div>
        )}
        {messages.map((m, i) => <ChatBubble key={i} role={m.role} content={m.content} />)}
        {showStreamingBubble && <ChatBubble role="assistant" content={streamText || '…'} streaming />}
        {err && <div className="text-[10px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-1.5">{err}</div>}
      </div>

      <div className="flex gap-1.5">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send() }
          }}
          placeholder="Ask the producer… (Cmd-Enter to send)"
          rows={2}
          className="flex-1 text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y min-h-[44px]"
          disabled={streaming}
        />
        {streaming ? (
          <button
            onClick={stop}
            className="text-[11px] py-1.5 px-3 border border-[#c0392b] text-[#c0392b] bg-white rounded cursor-pointer self-stretch"
          >Stop</button>
        ) : (
          <button
            onClick={send}
            disabled={!input.trim()}
            className="text-[11px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50 self-stretch"
          >Send</button>
        )}
      </div>

      {/* Grade content — score a hook / voiceover line / caption with
          structured feedback (strengths, weaknesses, AI-detection
          score à la ZeroGPT, viral potential, concrete rewrites).
          Quick-pick from the current draft state OR paste any text. */}
      <GradePanel draftId={draftId} />

      {/* Paste-from-external-AI flow. Collapsed by default — most
          users will type into the chat directly. The reveal toggle
          shows the textarea + Process action; the parsed fields
          appear inline below for review + Apply. */}
      <div className="border-t border-[#e5e5e5] pt-2 space-y-1.5">
        <button
          type="button"
          onClick={() => setPasteOpen(v => !v)}
          className="w-full flex items-center gap-2 text-[10px] py-1 px-2 border border-[#6C5CE7]/30 bg-[#f3f0ff] rounded cursor-pointer"
        >
          <span className="text-[12px]">📥</span>
          <span className="font-medium text-[#6C5CE7] flex-1 text-left">Paste from another AI (ChatGPT, Gemini…)</span>
          <span className="text-muted">{pasteOpen ? '▾' : '▸'}</span>
        </button>
        {pasteOpen && (
          <div className="space-y-1.5">
            <div className="text-[9px] text-muted">
              Paste the AI's full response here and click Process. We'll extract the script, overlays, caption, and hashtags so you can review and apply only what you want.
            </div>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder="Paste here…"
              rows={4}
              className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y"
            />
            <div className="flex gap-1.5">
              <button
                onClick={onPaste}
                disabled={!pasteText.trim() || importing}
                className="flex-1 text-[10px] py-1.5 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
              >{importing ? 'Processing…' : 'Process'}</button>
              {parsed && (
                <button
                  onClick={() => { setParsed(null); setPasteText(''); setApplyErr(null); setApplyMsg(null) }}
                  className="text-[10px] py-1.5 px-3 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
                >Clear</button>
              )}
            </div>
            {parsed && (
              <ParsedReview
                parsed={parsed}
                choices={applyChoices}
                setChoices={setApplyChoices}
                applying={applying}
                applyErr={applyErr}
                applyMsg={applyMsg}
                onApply={applySelection}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ChatBubble({ role, content, streaming }) {
  const isUser = role === 'user'
  return (
    <div className={`text-[11px] rounded-lg px-2.5 py-1.5 max-w-[88%] ${
      isUser
        ? 'ml-auto bg-[#6C5CE7] text-white'
        : 'mr-auto bg-white border border-[#e5e5e5] text-ink'
    }`}>
      <div className="whitespace-pre-wrap font-sans leading-snug">{content}{streaming && <span className="inline-block w-1.5 h-3 bg-current ml-0.5 animate-pulse" />}</div>
      {!isUser && content && !streaming && (
        <button
          onClick={() => navigator.clipboard.writeText(content).catch(() => {})}
          className="mt-1 text-[9px] text-muted bg-transparent border-none cursor-pointer underline"
        >copy</button>
      )}
    </div>
  )
}

function ParsedReview({ parsed, choices, setChoices, applying, applyErr, applyMsg, onApply }) {
  const has = (k) => k in choices
  const toggle = (k) => setChoices(c => ({ ...c, [k]: !c[k] }))
  const fields = []
  if (typeof parsed.primary === 'string' && parsed.primary.trim()) {
    fields.push({ key: 'primary', label: 'Primary VO line', value: parsed.primary })
  }
  if (Array.isArray(parsed.segments) && parsed.segments.length > 0) {
    const preview = parsed.segments
      .map(s => `[${formatStartTime(s.startTime)}] ${s.text}`)
      .join('\n')
    fields.push({ key: 'segments', label: `${parsed.segments.length} timed segment(s)`, value: preview })
  }
  if (parsed.overlays?.opening) fields.push({ key: 'openingOverlay', label: 'Opening overlay', value: parsed.overlays.opening })
  if (parsed.overlays?.middle) fields.push({ key: 'middleOverlay', label: 'Middle overlay', value: parsed.overlays.middle })
  if (parsed.overlays?.closing) fields.push({ key: 'closingOverlay', label: 'Closing overlay', value: parsed.overlays.closing })
  if (parsed.platformCaption) fields.push({ key: 'platformCaption', label: 'Post caption', value: parsed.platformCaption })
  if (Array.isArray(parsed.hashtags) && parsed.hashtags.length > 0) {
    fields.push({ key: 'hashtags', label: 'Hashtags', value: parsed.hashtags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ') })
  }

  return (
    <div className="bg-white border border-[#e5e5e5] rounded p-2 space-y-1.5 mt-1">
      <div className="text-[10px] font-medium">Extracted — review and apply</div>
      {fields.length === 0 && (
        <div className="text-[10px] text-muted italic">Nothing structured was found in the paste.</div>
      )}
      {fields.map(f => (
        <label
          key={f.key}
          className={`flex items-start gap-2 text-[10px] border rounded p-1.5 cursor-pointer ${
            has(f.key) && choices[f.key] ? 'border-[#2D9A5E]/40 bg-[#f0faf4]' : 'border-[#e5e5e5] bg-[#fafafa]'
          }`}
        >
          <input
            type="checkbox"
            checked={!!choices[f.key]}
            onChange={() => toggle(f.key)}
            className="mt-0.5"
          />
          <div className="flex-1 min-w-0">
            <div className="font-medium">{f.label}</div>
            <div className="font-mono text-[10px] text-muted whitespace-pre-wrap break-words">{f.value}</div>
          </div>
        </label>
      ))}
      <button
        onClick={onApply}
        disabled={applying || fields.length === 0}
        className="w-full text-[11px] py-1.5 bg-[#2D9A5E] text-white border-none rounded cursor-pointer font-medium disabled:opacity-50"
      >{applying ? 'Applying…' : 'Apply to draft'}</button>
      {applyMsg && <div className="text-[10px] text-[#2D9A5E]">{applyMsg}</div>}
      {applyErr && <div className="text-[10px] text-[#c0392b]">{applyErr}</div>}
    </div>
  )
}

function formatStartTime(t) {
  const n = Number(t) || 0
  const m = Math.floor(n / 60)
  const s = n - m * 60
  const dec = Math.abs(s - Math.floor(s)) > 0.05 ? s.toFixed(1).slice(1) : ''
  return `${m}:${String(Math.floor(s)).padStart(2, '0')}${dec}`
}

// Grade content card. Pulls candidate snippets (current opening
// overlay, current primary VO line) from the live job state so the
// user can grade with one click; also accepts an arbitrary paste so
// they can score a hook before committing it. The result renders as
// stacked sub-cards (overall + AI detection + viral potential +
// strengths + weaknesses + concrete suggestions).
function GradePanel({ draftId }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [kind, setKind] = useState('hook')
  const [target, setTarget] = useState('tiktok')
  // Hook channel — overlay text vs spoken VO vs both. Determines
  // whether the critic uses read time (5 wps) or speak time (2.5 wps).
  const [mode, setMode] = useState('onScreen')
  // Window the hook must fit within; defaults to 2s for hooks.
  const [windowSec, setWindowSec] = useState(2.0)
  const [grading, setGrading] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState(null)

  // Pull snippets from the live job whenever the panel opens so the
  // quick-pick buttons reflect the user's current state. Re-fetches
  // each open so a fresh save is reflected without a panel reload.
  const [picks, setPicks] = useState({ opening: null, primary: null, closing: null })
  useEffect(() => {
    if (!open || !draftId) return
    let cancelled = false
    api.getJob(draftId).then(j => {
      if (cancelled) return
      const overlay = j?.overlay_settings || {}
      const segs = Array.isArray(j?.voiceover_settings?.segments) ? j.voiceover_settings.segments : []
      const primarySeg = segs.find(s => s?.id === '__primary__')
      setPicks({
        opening: (overlay.openingText || '').trim() || null,
        primary: (primarySeg?.text || '').trim() || null,
        closing: (overlay.closingText || '').trim() || null,
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [open, draftId])

  const grade = async (sourceText, sourceKind = kind, sourceMode = mode) => {
    const t = (sourceText ?? text).trim()
    if (!t) { setErr('Pick or paste something to grade first.'); return }
    setGrading(true); setErr(null); setResult(null)
    try {
      const r = await api.producerGrade(draftId, { text: t, kind: sourceKind, target, mode: sourceMode, windowSec })
      setResult({ ...r, gradedText: t, gradedMode: sourceMode })
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setGrading(false)
    }
  }

  return (
    <div className="border border-[#f59e0b]/30 bg-[#fef3c7]/40 rounded p-2 space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 text-[10px] cursor-pointer bg-transparent border-none"
      >
        <span className="text-[12px]">🎯</span>
        <span className="font-medium text-[#b45309] flex-1 text-left">Grade hook / VO / caption</span>
        <span className="text-muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="space-y-1.5">
          <div className="text-[9px] text-muted">
            Honest score (0-10), AI-detection probability (ZeroGPT-style), viral potential, plus concrete rewrites. Pick from your current draft or paste any text.
          </div>

          {/* Target network + content kind selectors. Network changes
              how viral signals are weighted (TikTok vs Reels vs
              Shorts have different rhythms); kind tells the critic
              what conventions to apply (hook vs VO line vs post
              caption). */}
          <div className="flex items-center gap-1.5 text-[10px]">
            <label className="text-muted">Kind</label>
            <select value={kind} onChange={e => setKind(e.target.value)} className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white">
              <option value="hook">Hook</option>
              <option value="voiceover">Voiceover line</option>
              <option value="caption">Post caption</option>
            </select>
            <label className="text-muted ml-1">Target</label>
            <select value={target} onChange={e => setTarget(e.target.value)} className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white">
              <option value="tiktok">TikTok</option>
              <option value="reels">IG Reels</option>
              <option value="shorts">YT Shorts</option>
              <option value="generic">Generic</option>
            </select>
          </div>

          {/* Hook channel + window — gates which timing budget
              applies. onScreen = overlay (read time, 5 wps); spoken
              = VO (speak time, 2.5 wps); both = whichever is longer
              gates the hook. */}
          <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
            <label className="text-muted">Channel</label>
            <select value={mode} onChange={e => setMode(e.target.value)} className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white">
              <option value="onScreen">On-screen overlay (read)</option>
              <option value="spoken">Spoken voiceover (speak)</option>
              <option value="both">Both (text + VO)</option>
            </select>
            <label className="text-muted ml-1">Window</label>
            <input
              type="number" min={0.5} max={6} step={0.5}
              value={windowSec}
              onChange={e => setWindowSec(Number(e.target.value) || 2.0)}
              className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white w-12"
              title="Display window in seconds the hook must fit within"
            />
            <span className="text-muted">s</span>
          </div>

          {/* Quick-pick buttons — each grades a snippet from the
              live draft state with one click. Each button picks the
              right kind+mode combo so the critic uses the correct
              timing budget without the user having to remember. */}
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => { if (picks.opening) { setText(picks.opening); grade(picks.opening, 'hook', 'onScreen') } }}
              disabled={grading || !picks.opening}
              className="text-[10px] py-1 px-2 border border-[#6C5CE7]/50 text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-50"
              title={picks.opening ? `Grade as overlay hook (read time): "${picks.opening.slice(0, 80)}"` : 'No opening overlay set'}
            >Opening overlay</button>
            <button
              onClick={() => { if (picks.primary) { setText(picks.primary); grade(picks.primary, 'voiceover', 'spoken') } }}
              disabled={grading || !picks.primary}
              className="text-[10px] py-1 px-2 border border-[#6C5CE7]/50 text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-50"
              title={picks.primary ? `Grade primary VO (speak time): "${picks.primary.slice(0, 80)}"` : 'No primary voiceover'}
            >Primary VO</button>
            <button
              onClick={() => { if (picks.closing) { setText(picks.closing); grade(picks.closing, 'caption', 'onScreen') } }}
              disabled={grading || !picks.closing}
              className="text-[10px] py-1 px-2 border border-[#6C5CE7]/50 text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-50"
              title={picks.closing ? `Grade as caption: "${picks.closing.slice(0, 80)}"` : 'No closing overlay'}
            >Closing</button>
          </div>

          {/* Custom text fallback — paste any candidate hook to grade
              before committing. */}
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Or paste any text to grade…"
            rows={2}
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white resize-y"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => grade()}
              disabled={grading || !text.trim()}
              className="flex-1 text-[10px] py-1.5 bg-[#f59e0b] text-white border-none rounded cursor-pointer disabled:opacity-50 font-medium"
            >{grading ? 'Grading…' : '🎯 Grade'}</button>
            {result && (
              <button
                onClick={() => { setResult(null); setErr(null) }}
                className="text-[10px] py-1.5 px-3 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
              >Clear</button>
            )}
          </div>
          {err && <div className="text-[10px] text-[#c0392b]">{err}</div>}
          {result && <GradeResult result={result} />}
        </div>
      )}
    </div>
  )
}

function GradeResult({ result }) {
  const overall = Number(result.overall) || 0
  const aiScore = Number(result?.aiDetection?.score) || 0
  const viralScore = Number(result?.viralPotential?.score) || 0
  // Color the overall score: red <4, amber 4-6, green ≥7.
  const overallColor = overall >= 7 ? '#2D9A5E' : overall >= 4 ? '#d97706' : '#c0392b'
  // Color AI detection: low = good (clearly human), high = bad.
  const aiColor = aiScore < 25 ? '#2D9A5E' : aiScore < 60 ? '#d97706' : '#c0392b'
  // Color viral: high = good.
  const viralColor = viralScore >= 70 ? '#2D9A5E' : viralScore >= 40 ? '#d97706' : '#c0392b'

  // Hook timing breakdown — useful when the rewrite suggestion is too
  // long for the channel. Read time = words/5; speak time = words/2.5.
  const wc = Number(result?.wordCount) || 0
  const readTime = Number(result?.readTimeSec) || 0
  const speakTime = Number(result?.speakTimeSec) || 0
  const fits = result?.fitsWindow !== false
  const channelLabel = result.gradedMode === 'spoken' ? 'spoken VO'
    : result.gradedMode === 'both' ? 'overlay + VO'
    : 'on-screen overlay'

  return (
    <div className="bg-white border border-[#e5e5e5] rounded p-2 space-y-2 mt-1">
      <div className="text-[10px] text-muted italic break-words">"{result.gradedText?.slice(0, 200)}{result.gradedText?.length > 200 ? '…' : ''}"</div>

      {wc > 0 && (
        <div className="text-[10px] flex items-center gap-2 flex-wrap bg-[#fafafa] border border-[#e5e5e5] rounded px-2 py-1">
          <span className="text-muted">Channel:</span>
          <span className="font-medium">{channelLabel}</span>
          <span className="text-muted">·</span>
          <span><span className="font-mono">{wc}</span> words</span>
          {result.gradedMode !== 'spoken' && readTime > 0 && (
            <>
              <span className="text-muted">·</span>
              <span>read <span className="font-mono">{readTime.toFixed(2)}s</span></span>
            </>
          )}
          {result.gradedMode !== 'onScreen' && speakTime > 0 && (
            <>
              <span className="text-muted">·</span>
              <span>speak <span className="font-mono">{speakTime.toFixed(2)}s</span></span>
            </>
          )}
          <span className={`ml-auto font-medium ${fits ? 'text-[#2D9A5E]' : 'text-[#c0392b]'}`}>
            {fits ? '✓ fits window' : '⚠ too long for window'}
          </span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5">
        <ScoreCard label="Overall" value={overall} suffix="/10" color={overallColor} />
        <ScoreCard label="AI detection" value={aiScore} suffix="%" color={aiColor} subLabel={result?.aiDetection?.label} />
        <ScoreCard label="Viral" value={viralScore} suffix="%" color={viralColor} subLabel={result?.viralPotential?.label} />
      </div>

      {Array.isArray(result.strengths) && result.strengths.length > 0 && (
        <Section title="✅ Strengths" items={result.strengths} accent="#2D9A5E" />
      )}
      {Array.isArray(result.weaknesses) && result.weaknesses.length > 0 && (
        <Section title="⚠️ Weaknesses" items={result.weaknesses} accent="#c0392b" />
      )}
      {Array.isArray(result?.aiDetection?.reasons) && result.aiDetection.reasons.length > 0 && (
        <Section title="🤖 AI tells" items={result.aiDetection.reasons} accent="#6C5CE7" />
      )}
      {Array.isArray(result?.viralPotential?.reasons) && result.viralPotential.reasons.length > 0 && (
        <Section title="📈 Viral signals" items={result.viralPotential.reasons} accent="#d97706" />
      )}
      {Array.isArray(result.suggestions) && result.suggestions.length > 0 && (
        <Section title="✏️ Suggested rewrites" items={result.suggestions} accent="#6C5CE7" />
      )}
    </div>
  )
}

function ScoreCard({ label, value, suffix, color, subLabel }) {
  return (
    <div className="border rounded p-1.5 text-center" style={{ borderColor: color + '66', background: color + '0d' }}>
      <div className="text-[8px] uppercase tracking-wide text-muted">{label}</div>
      <div className="font-mono font-medium leading-none mt-0.5" style={{ color, fontSize: 18 }}>
        {Math.round(value)}<span className="text-[9px]">{suffix}</span>
      </div>
      {subLabel && <div className="text-[9px] mt-0.5" style={{ color }}>{subLabel}</div>}
    </div>
  )
}

function Section({ title, items, accent }) {
  return (
    <div>
      <div className="text-[10px] font-medium mb-0.5" style={{ color: accent }}>{title}</div>
      <ul className="text-[10px] space-y-0.5 list-disc pl-4">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  )
}
