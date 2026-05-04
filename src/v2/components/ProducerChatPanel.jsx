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
import { parseFinalPackage, validateFinalPackage, normalizeFinalPackage } from '../../lib/finalPackage'
import FinalPackageReview from './FinalPackageReview'

export default function ProducerChatPanel({ draftId, jobSync, files }) {
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
  // The same `parsed` slot is reused by the "Apply latest reply"
  // flow — the source (paste vs latest-message) is tracked in
  // parsedSource so the UI can label the review block.
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [importing, setImporting] = useState(false)
  const [parsed, setParsed] = useState(null)
  const [parsedSource, setParsedSource] = useState(null) // 'paste' | 'latest'
  const [applying, setApplying] = useState(false)
  const [applyErr, setApplyErr] = useState(null)
  const [applyMsg, setApplyMsg] = useState(null)
  // True only while the latest-reply extractor is running so the
  // button can show a spinner without confusing the paste flow.
  const [extractingLatest, setExtractingLatest] = useState(false)

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
    setParsedSource(null)
    setApplyErr(null)
    setApplyMsg(null)
    try {
      const r = await api.producerImport(draftId, text)
      setParsed(r)
      setParsedSource('paste')
    } catch (e) {
      setApplyErr(e?.message || String(e))
    } finally {
      setImporting(false)
    }
  }

  // Extract structured fields (overlay text, primary VO, segments,
  // caption, hashtags) from the most recent assistant message. Same
  // server-side parser as the paste flow — we just feed it the chat
  // reply instead of pasted text. One round-trip per click; the
  // producer's prose stays unconstrained.
  const lastAssistant = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant' && messages[i]?.content?.trim()) return messages[i].content
    }
    return null
  })()

  // Pull the strict final-package JSON block out of the latest reply
  // (if present + valid). When found, the panel shows the new
  // "Review & apply" button instead of relying on the best-effort
  // import path. Invalid blocks surface their first error so the user
  // can ask the producer to fix and resend.
  const finalPackage = useMemo(() => {
    if (!lastAssistant) return { pkg: null, errors: null, removed: [] }
    const parsed = parseFinalPackage(lastAssistant)
    if (!parsed) return { pkg: null, errors: null, removed: [] }
    const v = validateFinalPackage(parsed)
    if (!v.ok) return { pkg: null, errors: v.errors, removed: [] }
    // Normalize against current files so the modal can show resolved
    // refs + the removed list (clips not present in the package).
    const n = normalizeFinalPackage(parsed, files || [])
    if (!n.ok) return { pkg: null, errors: n.errors, removed: [] }
    return { pkg: n.resolved, errors: null, removed: n.removed }
  }, [lastAssistant, files])

  const [reviewOpen, setReviewOpen] = useState(false)

  const sendFinalPackageRequest = () => {
    if (streaming) return
    setInput('Generate a final package for this draft.')
  }

  const applyLatestReply = async () => {
    if (!lastAssistant || extractingLatest) return
    setExtractingLatest(true)
    setParsed(null)
    setParsedSource(null)
    setApplyErr(null)
    setApplyMsg(null)
    try {
      const r = await api.producerImport(draftId, lastAssistant)
      setParsed(r)
      setParsedSource('latest')
    } catch (e) {
      setApplyErr(e?.message || String(e))
    } finally {
      setExtractingLatest(false)
    }
  }

  // Open this draft's producer chat in a new browser tab so the
  // user can keep editing in the original window. The popup mode
  // is handled in main.jsx by ?producerPopout=<draftId>.
  const popOut = () => {
    if (!draftId) return
    const url = `${window.location.origin}/?producerPopout=${encodeURIComponent(draftId)}`
    window.open(url, '_blank', 'noopener')
  }

  // Import-from-first-2s. User clicks a platform-specific button →
  // we fetch the most recent saved analysis, format the relevant
  // fields for that platform into a readable message, and send it
  // as a user turn. The producer then responds with whatever
  // tactical advice fits the analysis. Saves the manual copy/paste
  // workflow.
  const [importing2s, setImporting2s] = useState(false)
  const [import2sError, setImport2sError] = useState(null)
  // Full-video import (sister of the per-platform first-2s import).
  // No platform branching — the full review already carries scores
  // for tiktok/reels/shorts so we send the whole report in one go.
  const [importingFull, setImportingFull] = useState(false)
  const [importFullError, setImportFullError] = useState(null)
  const importAnalysisForPlatform = async (platform) => {
    if (!draftId || streaming || importing2s) return
    setImporting2s(true)
    setImport2sError(null)
    try {
      const r = await api.lastFirstTwoSecAnalysis(draftId)
      const analysis = r?.analysis
      if (!analysis) {
        setImport2sError('No first-2s analysis saved yet — run the analyzer first.')
        return
      }
      const text = formatFirst2sAnalysisForPlatform(analysis, platform, r?.analyzedAt)
      // Prefill the input + send. We piggyback on send() so the
      // chat handles the streaming response identically.
      setInput(text)
      // setInput is async — give React a tick to commit before send
      // reads input. Calling send directly would still see the old
      // (empty) input value because closures capture state at render.
      // Inline the send logic with the formatted text instead.
      const next = [...messages, { role: 'user', content: text }]
      setMessages(next)
      setInput('')
      setStreaming(true)
      setStreamText('')
      setErr(null)
      const ctrl = new AbortController()
      abortRef.current = ctrl
      try {
        const { fullText, error } = await api.producerChat(draftId, {
          messages: next,
          signal: ctrl.signal,
          onChunk: (_, full) => setStreamText(full),
        })
        if (error) setErr(error)
        setMessages(prev => [...prev, { role: 'assistant', content: fullText || '' }])
        setStreamText('')
      } catch (e) {
        if (e?.name !== 'AbortError') setErr(e?.message || String(e))
        setStreamText('')
      } finally {
        setStreaming(false)
        abortRef.current = null
      }
    } catch (e) {
      setImport2sError(e?.message || String(e))
    } finally {
      setImporting2s(false)
    }
  }

  // Import the saved full-video review for ONE platform into chat as
  // a user message. Each platform has its own saved row with its own
  // scoring + suggestions, so importing a different platform pulls
  // a different document. The producer can then iterate on that
  // platform's specific feedback in conversation.
  const importFullVideoReview = async (platform) => {
    if (!draftId || streaming || importingFull) return
    setImportingFull(true)
    setImportFullError(null)
    try {
      const r = await api.fullVideoAnalysisLast(draftId, platform)
      const analysis = r?.analysis
      if (!analysis) {
        const labels = { tiktok: 'TikTok', reels: 'Reels', shorts: 'YouTube Shorts' }
        setImportFullError(`No ${labels[platform] || platform} full-video review saved yet — run that platform's analyzer in the 🎞️ Full video tab first.`)
        return
      }
      const text = formatFullVideoAnalysis(analysis, {
        platform,
        analyzedAt: r?.analyzedAt,
        durationSec: r?.duration_sec,
        framesUsed: r?.frames_used,
        sourceKind: r?.source_kind,
      })
      const next = [...messages, { role: 'user', content: text }]
      setMessages(next)
      setInput('')
      setStreaming(true)
      setStreamText('')
      setErr(null)
      const ctrl = new AbortController()
      abortRef.current = ctrl
      try {
        const { fullText, error } = await api.producerChat(draftId, {
          messages: next,
          signal: ctrl.signal,
          onChunk: (_, full) => setStreamText(full),
        })
        if (error) setErr(error)
        setMessages(prev => [...prev, { role: 'assistant', content: fullText || '' }])
        setStreamText('')
      } catch (e) {
        if (e?.name !== 'AbortError') setErr(e?.message || String(e))
        setStreamText('')
      } finally {
        setStreaming(false)
        abortRef.current = null
      }
    } catch (e) {
      setImportFullError(e?.message || String(e))
    } finally {
      setImportingFull(false)
    }
  }

  // Track which extracted fields the user wants to apply. Default ON
  // for every field present so the typical case is "click Apply".
  const [applyChoices, setApplyChoices] = useState({})
  // Per-field status after applySelection runs — { primary: 'ok',
  // openingOverlay: 'error', segments: 'skip', ... }. Surfaces in
  // ParsedReview as a green/red badge next to each checkbox so the
  // user sees exactly what landed and what didn't.
  const [applyStatus, setApplyStatus] = useState({})
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
    setApplying(true); setApplyErr(null); setApplyMsg(null); setApplyStatus({})
    const status = {}
    const mark = (key, s) => { status[key] = s }
    try {
      const summary = []
      // 1. Voiceover (primary + segments). Delegate to jobSync's
      //    voiceover_settings save so the existing format
      //    (segments[].id, audioKey:null on primary, etc.) stays clean.
      const wantsVo = applyChoices.primary || applyChoices.segments
      if (wantsVo && jobSync?.saveVoiceoverSettings) {
        try {
          const cur = await api.getJob(draftId).catch(() => ({}))
          const existing = Array.isArray(cur?.voiceover_settings?.segments) ? cur.voiceover_settings.segments : []
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
          if (applyChoices.primary) { mark('primary', 'ok'); summary.push('primary VO text') }
          if (applyChoices.segments) { mark('segments', 'ok'); summary.push(`${parsed.segments.length} segment text(s)`) }
        } catch (e) {
          if (applyChoices.primary) mark('primary', 'error')
          if (applyChoices.segments) mark('segments', 'error')
        }
      } else {
        if (applyChoices.primary) mark('primary', 'skip')
        if (applyChoices.segments) mark('segments', 'skip')
      }

      // 2. Overlays — patch only the chosen fields. Each slot tracks
      //    its own success so a single overlay save error doesn't
      //    mask the others.
      const overlayPatch = {}
      if (applyChoices.openingOverlay && parsed.overlays?.opening) overlayPatch.openingText = parsed.overlays.opening
      if (applyChoices.middleOverlay && parsed.overlays?.middle) overlayPatch.middleText = parsed.overlays.middle
      if (applyChoices.closingOverlay && parsed.overlays?.closing) overlayPatch.closingText = parsed.overlays.closing
      if (Object.keys(overlayPatch).length > 0) {
        try {
          const existing = (typeof window !== 'undefined' && window._postyOverlays) || {}
          const next = { ...existing, ...overlayPatch }
          if (typeof window !== 'undefined') {
            window._postyOverlays = next
            window.dispatchEvent(new CustomEvent('posty-overlay-change', { detail: next }))
          }
          jobSync?.saveOverlaySettings?.(next)
          if (applyChoices.openingOverlay && parsed.overlays?.opening) mark('openingOverlay', 'ok')
          if (applyChoices.middleOverlay && parsed.overlays?.middle) mark('middleOverlay', 'ok')
          if (applyChoices.closingOverlay && parsed.overlays?.closing) mark('closingOverlay', 'ok')
          summary.push(`${Object.keys(overlayPatch).length} overlay field(s)`)
        } catch (e) {
          if (applyChoices.openingOverlay) mark('openingOverlay', 'error')
          if (applyChoices.middleOverlay) mark('middleOverlay', 'error')
          if (applyChoices.closingOverlay) mark('closingOverlay', 'error')
        }
      }

      // 3. Platform caption + hashtags — clipboard write.
      if (applyChoices.platformCaption && parsed.platformCaption) {
        try {
          await navigator.clipboard.writeText(parsed.platformCaption)
          mark('platformCaption', 'ok'); summary.push('caption (copied to clipboard)')
        } catch { mark('platformCaption', 'error') }
      }
      if (applyChoices.hashtags && Array.isArray(parsed.hashtags) && parsed.hashtags.length > 0) {
        try {
          const tags = parsed.hashtags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ')
          await navigator.clipboard.writeText(tags)
          mark('hashtags', 'ok'); summary.push('hashtags (copied to clipboard)')
        } catch { mark('hashtags', 'error') }
      }

      setApplyStatus(status)
      setApplyMsg(summary.length ? `✓ Applied: ${summary.join(', ')}` : 'Nothing selected to apply.')
    } catch (e) {
      setApplyErr(e?.message || String(e))
      setApplyStatus(status)
    } finally {
      setApplying(false)
    }
  }

  const showStreamingBubble = streaming && (streamText || true)
  const empty = !streaming && messages.length === 0 && historyLoaded
  // Popup window already IS a separate browser tab — hide the
  // pop-out button there to avoid an infinite tab-spawn footgun.
  const isPopout = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('producerPopout') != null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">🎬 Producer Chat</div>
        {!isPopout && (
          <button
            onClick={popOut}
            disabled={!draftId}
            className="text-[10px] py-1 px-2 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-50"
            title="Open this conversation in a new browser tab so you can keep editing"
          >↗ Pop out</button>
        )}
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

      {/* Import-from-first-2s toolbar. Each button pulls the most
          recent saved analysis and posts a platform-specific summary
          to the chat as a user message — saves the copy/paste round
          trip the user was doing manually. */}
      <div className="flex items-center gap-1.5 flex-wrap text-[10px] bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded p-1.5">
        <span className="font-medium text-[#6C5CE7]">📊 Import 2s analysis:</span>
        <button
          onClick={() => importAnalysisForPlatform('tiktok')}
          disabled={!draftId || streaming || importing2s}
          className="text-[10px] py-0.5 px-2 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-50"
          title="Send the TikTok-specific portion of the latest first-2s analysis to the producer for follow-up advice"
        >TikTok</button>
        <button
          onClick={() => importAnalysisForPlatform('reels')}
          disabled={!draftId || streaming || importing2s}
          className="text-[10px] py-0.5 px-2 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-50"
          title="Send the Reels-specific portion of the latest first-2s analysis to the producer"
        >Reels</button>
        <button
          onClick={() => importAnalysisForPlatform('youtubeShorts')}
          disabled={!draftId || streaming || importing2s}
          className="text-[10px] py-0.5 px-2 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-50"
          title="Send the YouTube Shorts-specific portion of the latest first-2s analysis to the producer"
        >Shorts</button>
        {importing2s && <span className="text-[9px] text-muted italic">loading…</span>}
        {import2sError && <span className="text-[9px] text-[#c0392b]">{import2sError}</span>}
      </div>

      {/* Import-from-full-video. Three buttons — each pulls the saved
          per-platform analysis (TikTok / Reels / Shorts have separate
          scoring criteria + saved rows). */}
      <div className="flex items-center gap-1.5 flex-wrap text-[10px] bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded p-1.5">
        <span className="font-medium text-[#6C5CE7]">🎞️ Import full review:</span>
        <button
          onClick={() => importFullVideoReview('tiktok')}
          disabled={!draftId || streaming || importingFull}
          className="text-[10px] py-0.5 px-2 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-50"
          title="Send the saved TikTok full-video review to the producer"
        >🎵 TikTok</button>
        <button
          onClick={() => importFullVideoReview('reels')}
          disabled={!draftId || streaming || importingFull}
          className="text-[10px] py-0.5 px-2 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-50"
          title="Send the saved Reels full-video review to the producer"
        >📸 Reels</button>
        <button
          onClick={() => importFullVideoReview('shorts')}
          disabled={!draftId || streaming || importingFull}
          className="text-[10px] py-0.5 px-2 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-50"
          title="Send the saved YouTube Shorts full-video review to the producer"
        >▶️ Shorts</button>
        {importingFull && <span className="text-[9px] text-muted italic">loading…</span>}
        {importFullError && <span className="text-[9px] text-[#c0392b]">{importFullError}</span>}
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

      {/* Final-package detected — strict JSON block in the reply. New
          path that's atomic + diff-aware, replacing the flaky free-form
          extractor for any reply that emits the contract. The fallback
          "Apply latest reply" button below stays for prose-only replies. */}
      {finalPackage.pkg && (
        <button
          onClick={() => setReviewOpen(true)}
          disabled={streaming}
          className="w-full text-[11px] py-2 px-2 border-2 border-[#6C5CE7] text-white bg-[#6C5CE7] rounded cursor-pointer disabled:opacity-50 font-medium"
          title="Apply the structured final package returned in the latest reply"
        >📦 Final package detected — Review &amp; apply</button>
      )}
      {reviewOpen && finalPackage.pkg && (
        <FinalPackageReview
          pkg={finalPackage.pkg}
          removed={finalPackage.removed}
          files={files}
          draftId={draftId}
          jobSync={jobSync}
          onClose={() => setReviewOpen(false)}
          onApplied={(_results, summary) => {
            // Insert a system-styled assistant message into the chat so
            // the conversation reflects what landed. The user can scroll
            // back later and see exactly which package was applied vs
            // ignored. We DO NOT persist this to the BE chat history —
            // it's a local UI marker only, since the BE history is the
            // raw producer turns.
            if (summary) {
              setMessages(prev => [...prev, { role: 'assistant', content: summary, _localSystemNote: true }])
            }
          }}
        />
      )}
      {finalPackage.errors && (
        <div className="text-[10px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2">
          Final-package block found but invalid: {finalPackage.errors.slice(0, 3).join('; ')}
        </div>
      )}

      {/* Quick prompt — pre-fill the chat input with the final-package
          trigger phrase so the user doesn't need to remember the magic
          words. They can edit/extend before sending. */}
      {!finalPackage.pkg && !streaming && (
        <button
          onClick={sendFinalPackageRequest}
          className="w-full text-[10px] py-1.5 px-2 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer font-medium"
          title="Pre-fills the chat with a request for a structured final package the app can apply atomically"
        >📦 Generate final package</button>
      )}

      {/* Apply-latest-reply — pull the structured fields (primary
          VO, segments, overlays, caption, hashtags) out of the most
          recent producer reply and run them through the same
          review-and-apply flow as the paste-import. The producer's
          prose stays unconstrained; the parse only happens when
          the user clicks. Stays available even when a final-package
          block is detected so the user can choose between the
          strict modal flow (📦) and the per-field checkbox flow (✨). */}
      {lastAssistant && (
        <button
          onClick={applyLatestReply}
          disabled={extractingLatest || streaming}
          className="w-full text-[10px] py-1.5 px-2 border border-[#2D9A5E]/50 text-[#2D9A5E] bg-[#f0faf4] rounded cursor-pointer disabled:opacity-50 font-medium"
          title="Extract overlays / voiceover / caption from the producer's last reply with per-field checkboxes"
        >
          {extractingLatest ? 'Extracting…' : (finalPackage.pkg ? '✨ Apply latest reply (per-field)' : '✨ Apply latest reply to draft (best-effort)')}
        </button>
      )}

      {/* Review block lives at the panel level so it surfaces from
          BOTH sources — the latest-reply button above and the
          paste flow below. The source label inside ParsedReview
          tells the user where the candidates came from. */}
      {parsed && parsedSource === 'latest' && (
        <ParsedReview
          parsed={parsed}
          source="latest"
          choices={applyChoices}
          setChoices={setApplyChoices}
          applying={applying}
          applyErr={applyErr}
          applyMsg={applyMsg}
          applyStatus={applyStatus}
          onApply={applySelection}
          onClear={() => { setParsed(null); setParsedSource(null); setApplyErr(null); setApplyMsg(null); setApplyStatus({}) }}
        />
      )}

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
              {parsed && parsedSource === 'paste' && (
                <button
                  onClick={() => { setParsed(null); setParsedSource(null); setPasteText(''); setApplyErr(null); setApplyMsg(null) }}
                  className="text-[10px] py-1.5 px-3 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
                >Clear</button>
              )}
            </div>
            {parsed && parsedSource === 'paste' && (
              <ParsedReview
                parsed={parsed}
                source="paste"
                choices={applyChoices}
                setChoices={setApplyChoices}
                applying={applying}
                applyErr={applyErr}
                applyMsg={applyMsg}
                onApply={applySelection}
                onClear={() => { setParsed(null); setParsedSource(null); setPasteText(''); setApplyErr(null); setApplyMsg(null) }}
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

function ParsedReview({ parsed, source, choices, setChoices, applying, applyErr, applyMsg, applyStatus, onApply, onClear }) {
  const sourceLabel = source === 'latest'
    ? 'Extracted from latest producer reply'
    : 'Extracted from pasted text'
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
    <div className="bg-white border border-[#2D9A5E]/30 rounded p-2 space-y-1.5 mt-1">
      <div className="flex items-center gap-2">
        <div className="text-[10px] font-medium flex-1">{sourceLabel} — review and apply</div>
        {onClear && (
          <button
            onClick={onClear}
            className="text-[9px] py-0.5 px-1.5 border border-[#e5e5e5] text-muted bg-white rounded cursor-pointer"
          >Clear</button>
        )}
      </div>
      {fields.length === 0 && (
        <div className="text-[10px] text-muted italic">No structured fields detected in the {source === 'latest' ? 'reply' : 'paste'}.</div>
      )}
      {fields.map(f => {
        const status = applyStatus?.[f.key]
        return (
          <label
            key={f.key}
            className={`flex items-start gap-2 text-[10px] border rounded p-1.5 cursor-pointer ${
              status === 'ok' ? 'border-[#2D9A5E] bg-[#f0faf4]'
                : status === 'error' ? 'border-[#c0392b] bg-[#fdf2f1]'
                : has(f.key) && choices[f.key] ? 'border-[#2D9A5E]/40 bg-[#f0faf4]'
                : 'border-[#e5e5e5] bg-[#fafafa]'
            }`}
          >
            <input
              type="checkbox"
              checked={!!choices[f.key]}
              onChange={() => toggle(f.key)}
              className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="font-medium flex items-center gap-1.5">
                <span>{f.label}</span>
                {status === 'ok' && <span className="text-[9px] text-[#2D9A5E] bg-white border border-[#2D9A5E]/40 rounded px-1 py-0.5">✓ applied</span>}
                {status === 'error' && <span className="text-[9px] text-[#c0392b] bg-white border border-[#c0392b]/40 rounded px-1 py-0.5">✕ failed</span>}
                {status === 'skip' && <span className="text-[9px] text-muted bg-white border border-[#e5e5e5] rounded px-1 py-0.5">skipped</span>}
              </div>
              <div className="font-mono text-[10px] text-muted whitespace-pre-wrap break-words">{f.value}</div>
            </div>
          </label>
        )
      })}
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

// Build a human-readable summary of the saved first-2s analysis,
// scoped to ONE platform. Used by the Import 2s analysis buttons in
// the producer chat — clicking a platform sends this text as a user
// message so the producer can comment on it. Includes overall score,
// platform-specific score adjustments, hook channels, time-to-clarity
// /-engagement, and the platform-specific strengths/issues/suggestions.
// All free-form text — the producer doesn't need to parse this; it's
// just context.
function formatFirst2sAnalysisForPlatform(analysis, platform, analyzedAt) {
  const platformLabels = {
    tiktok: 'TikTok',
    reels: 'Instagram Reels',
    youtubeShorts: 'YouTube Shorts',
  }
  const label = platformLabels[platform] || platform
  const platformScore = analysis?.platformScores?.[platform] || null
  const score = analysis?.score || {}
  const lines = []
  lines.push(`These are the results of the first 2 seconds analysis (${label}-focused):`)
  lines.push('')
  if (typeof score.totalScore === 'number') {
    lines.push(`OVERALL: ${score.totalScore}/100 (${score.verdict || '—'})`)
  }
  const cats = score.categoryScores || {}
  if (Object.keys(cats).length) {
    lines.push('Category breakdown:')
    if (typeof cats.contextClarity === 'number')   lines.push(`  - Context clarity:   ${cats.contextClarity}/25`)
    if (typeof cats.visualEngagement === 'number') lines.push(`  - Visual engagement: ${cats.visualEngagement}/25`)
    if (typeof cats.focalClarity === 'number')     lines.push(`  - Focal clarity:     ${cats.focalClarity}/15`)
    if (typeof cats.textEffectiveness === 'number') lines.push(`  - Text effectiveness:${cats.textEffectiveness}/15`)
    if (typeof cats.curiosityGap === 'number')      lines.push(`  - Curiosity gap:     ${cats.curiosityGap}/15`)
    if (typeof cats.scrollRiskPenalty === 'number') lines.push(`  - Scroll risk:       ${cats.scrollRiskPenalty}`)
  }
  // Top-level strengths / issues / suggestions — these apply across
  // every platform. The platform-specific block below ADDS on top.
  if (Array.isArray(score.strengths) && score.strengths.length) {
    lines.push('')
    lines.push('Strengths (cross-platform):')
    for (const s of score.strengths) lines.push(`  - ${s}`)
  }
  if (Array.isArray(score.issues) && score.issues.length) {
    lines.push('')
    lines.push('Issues (cross-platform):')
    for (const s of score.issues) lines.push(`  - ${s}`)
  }
  if (Array.isArray(score.suggestions) && score.suggestions.length) {
    lines.push('')
    lines.push('Suggestions (cross-platform):')
    for (const s of score.suggestions) lines.push(`  - ${s}`)
  }
  // Platform-specific block.
  if (platformScore) {
    lines.push('')
    lines.push(`=== ${label}-specific ===`)
    if (typeof platformScore.adjustedScore === 'number') {
      const adj = typeof platformScore.scoreAdjustment === 'number'
        ? ` (${platformScore.scoreAdjustment > 0 ? '+' : ''}${platformScore.scoreAdjustment} from base)`
        : ''
      lines.push(`Adjusted score: ${platformScore.adjustedScore}/100${adj} — ${platformScore.verdict || '—'}`)
    }
    if (Array.isArray(platformScore.strengths) && platformScore.strengths.length) {
      lines.push(`${label} strengths:`)
      for (const s of platformScore.strengths) lines.push(`  - ${s}`)
    }
    if (Array.isArray(platformScore.issues) && platformScore.issues.length) {
      lines.push(`${label} issues:`)
      for (const s of platformScore.issues) lines.push(`  - ${s}`)
    }
    if (Array.isArray(platformScore.suggestions) && platformScore.suggestions.length) {
      lines.push(`${label} suggestions:`)
      for (const s of platformScore.suggestions) lines.push(`  - ${s}`)
    }
    // Reels saveability / Shorts topicClarity+loopQuality sub-metrics
    // when present.
    if (platform === 'reels' && typeof platformScore.saveability === 'number') {
      lines.push(`Saveability: ${platformScore.saveability}/100`)
    }
    if (platform === 'youtubeShorts') {
      if (typeof platformScore.topicClarity === 'number') lines.push(`Topic clarity: ${platformScore.topicClarity}/100`)
      if (typeof platformScore.loopQuality === 'number')  lines.push(`Loop quality:  ${platformScore.loopQuality}/100`)
    }
  }
  // Hook channels — onScreen vs spoken — useful context for whatever
  // the producer recommends next.
  const hooks = analysis?.hookChannels
  if (hooks) {
    lines.push('')
    lines.push('Hook channels:')
    if (hooks.onScreen?.text) {
      lines.push(`  On-screen: "${hooks.onScreen.text}" (${hooks.onScreen.wordCount || 0} words, read ~${(hooks.onScreen.readTimeSec || 0).toFixed(2)}s${hooks.onScreen.fitsWindow === false ? ', too long for window' : ''})`)
    }
    if (hooks.spoken?.text) {
      lines.push(`  Spoken:    "${hooks.spoken.text}" (${hooks.spoken.wordCount || 0} words, speak ~${(hooks.spoken.speakTimeSec || 0).toFixed(2)}s${hooks.spoken.tooLongForWindow ? ', too long for window' : ''})`)
    }
    if (hooks.redundant === true) lines.push(`  ⚠ overlay text == VO text (redundant — wasted real estate)`)
  }
  if (analysis.timeToClarity) {
    lines.push(`Time to clarity:    ${(analysis.timeToClarity.seconds ?? 0).toFixed(2)}s (${analysis.timeToClarity.rating || '—'})`)
  }
  if (analysis.timeToEngagement) {
    lines.push(`Time to engagement: ${(analysis.timeToEngagement.seconds ?? 0).toFixed(2)}s (${analysis.timeToEngagement.rating || '—'})`)
  }
  if (analyzedAt) {
    lines.push('')
    lines.push(`(analysis from ${new Date(analyzedAt).toLocaleString()})`)
  }
  lines.push('')
  lines.push(`Given this analysis, what changes would you suggest to make this video stronger for ${label}?`)
  return lines.join('\n')
}

// Format ONE platform's saved full-video review as a chat message.
// Each platform has its own scored review + suggestions, so the
// formatter doesn't need to compare across platforms — that's a
// separate import per platform.
function formatFullVideoAnalysis(analysis, meta = {}) {
  const lines = []
  const platformLabels = { tiktok: 'TikTok', reels: 'Instagram Reels', shorts: 'YouTube Shorts' }
  const platformLabel = platformLabels[meta.platform] || meta.platform || 'platform'
  const dur = Number(meta.durationSec) > 0 ? `${Number(meta.durationSec).toFixed(1)}s` : '?'
  lines.push(`These are the results of the ${platformLabel}-specific full-video review (${dur}, ${meta.framesUsed || '?'} frames sampled, source: ${meta.sourceKind || '?'}):`)
  lines.push('')
  if (typeof analysis.overall_score === 'number') {
    lines.push(`${platformLabel.toUpperCase()} OVERALL: ${analysis.overall_score}/10`)
  }
  if (analysis.verdict) {
    lines.push(`Verdict: ${analysis.verdict}`)
  }

  // Twelve dimension scores
  const dims = [
    ['hook_strength',          'Hook strength'],
    ['curiosity_gap',          'Curiosity gap'],
    ['mid_pacing',             'Mid pacing'],
    ['closing_impact',         'Closing impact'],
    ['ending_completion',      'Ending completion'],
    ['vo_visual_sync',         'VO/visual sync'],
    ['caption_legibility',     'Caption legibility'],
    ['overlay_placement',      'Overlay placement'],
    ['overlay_color_contrast', 'Overlay color contrast'],
    ['audio_visual_synergy',   'A/V synergy'],
    ['rewatch_value',          'Rewatch value'],
    ['brand_clarity',          'Brand clarity'],
  ]
  const present = dims.filter(([k]) => typeof analysis[k] === 'number')
  if (present.length) {
    lines.push('')
    lines.push('Dimension scores (1–10):')
    for (const [key, label] of present) {
      lines.push(`  - ${label.padEnd(24)} ${analysis[key]}/10`)
    }
  }

  // Timeline notes — keep concise; producer doesn't need every frame
  // verbatim, but the cadence is useful context.
  if (Array.isArray(analysis.timeline_notes) && analysis.timeline_notes.length > 0) {
    lines.push('')
    lines.push('Frame-by-frame timeline:')
    for (const tn of analysis.timeline_notes) {
      const t = Number(tn.t) >= 0 ? `${Number(tn.t).toFixed(1)}s` : '?'
      lines.push(`  - [${t}] ${tn.note || ''}`)
    }
  }

  if (Array.isArray(analysis.suggestions) && analysis.suggestions.length > 0) {
    lines.push('')
    lines.push('Suggestions from the analyzer:')
    analysis.suggestions.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`))
  }

  if (meta.analyzedAt) {
    lines.push('')
    lines.push(`(Analyzed ${new Date(meta.analyzedAt).toLocaleString()}.)`)
  }
  lines.push('')
  lines.push(`Given this ${platformLabel}-specific review, what concrete changes would you prioritize to improve ${platformLabel} performance? Stay focused on what matters for ${platformLabel}'s audience and algorithm — don't generalize across platforms.`)
  return lines.join('\n')
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
