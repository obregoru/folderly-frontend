import { useState, useRef, useEffect } from 'react'
import * as api from '../api'
import { parseVoiceoverScript, exportVoiceoverScript, buildScriptPrompt } from '../lib/voiceoverScript'
import { captureVideoFrames, dataUrlToBase64 } from '../lib/videoFrames'

// Read a Blob or File as base64
const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => {
    const bytes = new Uint8Array(r.result)
    let binary = ''
    const chunk = 8192
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
    }
    resolve(btoa(binary))
  }
  r.onerror = reject
  r.readAsArrayBuffer(blob)
})
const fileToBase64 = blobToBase64

// Format the Suggest-from-video result as plain text for chat review.
// Includes scene_context, payoff_extracted, and every candidate with
// rationale / scores / segments / overlays. Output is designed to be
// pasted into ChatGPT/Claude for critique.
function formatSuggestResultForChat(r) {
  if (!r || typeof r !== 'object') return ''
  const lines = []
  const fmtTs = (t) => {
    const secs = Number(t) || 0
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }
  lines.push('# VOICEOVER SUGGESTION — FULL OUTPUT')
  lines.push('')
  if (r.scene_context && typeof r.scene_context === 'object') {
    const sc = r.scene_context
    lines.push('## SCENE CONTEXT')
    if (sc.group_type) lines.push(`- Group type: ${sc.group_type}${sc.group_size_count != null ? ` (${sc.group_size_count} ${sc.group_size_count === 1 ? 'person' : 'people'})` : ''}`)
    if (sc.age_range) lines.push(`- Age range: ${sc.age_range}`)
    if (sc.energy) lines.push(`- Energy: ${sc.energy}`)
    if (sc.audience) lines.push(`- Audience tone: ${sc.audience}${sc.audience_was_overridden ? ' (operator override)' : ''}`)
    if (Array.isArray(sc.occasion_signals) && sc.occasion_signals.length > 0) {
      lines.push(`- Occasion signals: ${sc.occasion_signals.join(', ')}`)
    }
    lines.push('')
  }
  const pe = r.payoff_extracted
  if (pe && typeof pe === 'object') {
    lines.push('## PAYOFF ANGLES CLAUDE EXTRACTED')
    if (pe.emotional_payoff) lines.push(`- Emotional payoff: ${pe.emotional_payoff}`)
    if (pe.unique_differentiator) lines.push(`- Differentiator: ${pe.unique_differentiator}`)
    if (pe.surprising_claim) lines.push(`- Surprising claim: ${pe.surprising_claim}`)
    if (pe.identity_angle) lines.push(`- Identity angle: ${pe.identity_angle}`)
    lines.push('')
  }
  const cands = Array.isArray(r.candidates) && r.candidates.length > 0
    ? r.candidates
    : (Array.isArray(r.segments) && r.segments.length > 0
      ? [{ variant: 'single', mode: r.mode, segments: r.segments, overlays: r.overlays, rationale: r.rationale, scores: null }]
      : [])
  const winnerIdx = Number.isInteger(r.winner_index) ? r.winner_index : 0
  lines.push(`## CANDIDATES (${cands.length}) — winner: #${winnerIdx + 1} (${cands[winnerIdx]?.variant || '—'})`)
  lines.push('')
  cands.forEach((c, i) => {
    const isWin = i === winnerIdx
    lines.push(`### Candidate #${i + 1} — variant: ${c.variant || 'unknown'}${isWin ? ' ★ WINNER' : ''}`)
    if (c.mode) lines.push(`- Mode: ${c.mode}`)
    if (c.dominant_payoff) lines.push(`- Dominant payoff: ${c.dominant_payoff}`)
    if (c.cta_mode) lines.push(`- CTA mode: ${c.cta_mode}`)
    if (c.rationale) lines.push(`- Rationale: ${c.rationale}`)
    if (c.scores && typeof c.scores === 'object') {
      lines.push(`- Scores: hook ${c.scores.hook_strength}/25 · payoff ${c.scores.payoff_clarity}/20 · non-redundancy ${c.scores.non_redundancy}/15 · timing ${c.scores.timing_fit}/15 · tiktok-native ${c.scores.tiktok_native}/15 · tts-natural ${c.scores.tts_naturalness}/10 → TOTAL ${c.scores.total}/100`)
    }
    if (Array.isArray(c.segments) && c.segments.length > 0) {
      lines.push('- Segments:')
      for (const s of c.segments) {
        lines.push(`    [${fmtTs(s.startTime)}] ${s.text}`)
      }
    }
    if (c.overlays && typeof c.overlays === 'object') {
      const o = c.overlays
      const overlayBits = []
      if (o.opening) overlayBits.push(`OPENING: "${o.opening}"`)
      if (o.middle) overlayBits.push(`MIDDLE${o.middleStartTime != null ? ` @ ${fmtTs(o.middleStartTime)}` : ''}: "${o.middle}"`)
      if (o.closing) overlayBits.push(`CLOSING: "${o.closing}"`)
      if (overlayBits.length > 0) {
        lines.push('- On-screen captions:')
        overlayBits.forEach(b => lines.push(`    ${b}`))
      }
    }
    lines.push('')
  })
  return lines.join('\n').trim()
}

// Small helper: elapsed-seconds timer, used in the Suggest modal so the
// user sees time progressing while Claude is thinking. Resets when the
// component remounts (via key prop).
function SuggestElapsed() {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setSecs(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return <div className="text-[9px] text-[#6C5CE7] mt-0.5">Elapsed: {secs}s</div>
}

/**
 * Voiceover recorder + ElevenLabs TTS. Renders below the video trim/merge
 * section. Two modes:
 *   1. Record from device microphone
 *   2. Generate via ElevenLabs text-to-speech (if API key configured)
 *
 * Once audio is captured (either way), the user picks a source video
 * (from uploads or the merged result) and clicks "Apply" to mix the
 * voiceover onto the video server-side.
 */
export default function VoiceoverRecorder({ videoFiles, mergedVideoBase64, settings, onResult, onSettingsChange, onFlushSave, jobId, restoredVoiceover, hookMode = null, activePlatforms = [] }) {
  // restoredVoiceover = { settings: {...}, audioBlob, audioUrl } from job restore
  const rv = restoredVoiceover || {}
  const rvs = rv.settings || {}

  // --- Recording state ---
  const [recording, setRecording] = useState(false)
  const [audioUrl, setAudioUrl] = useState(rv.audioUrl || null)
  const [audioBlob, setAudioBlob] = useState(rv.audioBlob || null)
  const [audioDuration, setAudioDuration] = useState(0)
  // Auto-measure whenever the primary blob changes so we always have a
  // real duration (not an estimate) for overlap detection + AI review.
  useEffect(() => {
    let cancelled = false
    if (!audioBlob) { setAudioDuration(0); return }
    ;(async () => {
      const d = await measureAudioDuration(audioBlob)
      if (!cancelled) setAudioDuration(d)
    })()
    return () => { cancelled = true }
  }, [audioBlob])
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  // Video monitor — plays muted during recording so you can narrate to picture
  const monitorRef = useRef(null)
  const audioPreviewRef = useRef(null)
  const [recordTime, setRecordTime] = useState(0)
  const recordTimerRef = useRef(null)
  const [monitorDuration, setMonitorDuration] = useState(0)

  // --- TTS state ---
  const [ttsText, setTtsText] = useState(rvs.ttsText || '')
  const [ttsLoading, setTtsLoading] = useState(false)

  // --- Hook generator state (populates ttsText) ---
  const hookCategories = Array.isArray(settings?.hook_categories) ? settings.hook_categories : []
  const [hookCategoryName, setHookCategoryName] = useState('')
  const [hookHint, setHookHint] = useState('')
  const [hookOptions, setHookOptions] = useState([]) // string[]
  const [hookIdx, setHookIdx] = useState(0)
  const [hookLoading, setHookLoading] = useState(false)
  const [hookIncludeBody, setHookIncludeBody] = useState(false)
  const ttsRef = useRef(null)
  // Insert text into the textarea — at the cursor if focused, else prepend.
  // Never sends to ElevenLabs; user edits then clicks "Generate voice".
  const insertIntoTts = (text) => {
    if (!text) return
    const ta = ttsRef.current
    const current = ttsText || ''
    let next
    if (ta && document.activeElement === ta) {
      const start = ta.selectionStart ?? 0
      const end = ta.selectionEnd ?? 0
      next = current.slice(0, start) + text + current.slice(end)
      setTtsText(next)
      // Restore caret right after the inserted text
      requestAnimationFrame(() => {
        try { ta.focus(); ta.setSelectionRange(start + text.length, start + text.length) } catch {}
      })
    } else {
      // Prepend to the start with a space if there's existing text
      next = current.trim() ? `${text} ${current}` : text
      setTtsText(next)
    }
  }
  const generateHook = async () => {
    setHookLoading(true)
    try {
      // Capture a small frame set from the current video so the hook
      // generator can see the scene and apply the same rules as
      // Suggest-from-video. Silently fall back to text-only if capture fails
      // (e.g. no video loaded) — the endpoint still works without frames.
      let frames = null
      try {
        const captured = await captureCoverageFrames()
        const withData = (Array.isArray(captured) ? captured : []).filter(f => f && f.dataUrl)
        if (withData.length > 0) {
          frames = withData.slice(0, 6).map(f => ({
            startTime: f.startTime,
            label: f.label,
            image_base64: dataUrlToBase64(f.dataUrl),
          }))
        }
      } catch (e) {
        console.warn('[generateHook] frame capture skipped:', e.message)
      }
      const r = await api.generateVoiceoverHook({
        hint: hookHint.trim() || null,
        category: hookCategoryName || null,
        includeBody: hookIncludeBody,
        count: 4,
        frames,
        audienceOverride,
      })
      const opts = Array.isArray(r?.options) ? r.options : []
      if (!opts.length) { alert('No hooks generated — try a different hint.'); setHookLoading(false); return }
      setHookOptions(opts)
      setHookIdx(0)
      if (r?.used_vision) console.log(`[generateHook] vision mode (${r.frames_count} frames)`)
    } catch (err) {
      alert('Hook generation failed: ' + err.message)
    }
    setHookLoading(false)
  }
  const cycleHook = () => {
    if (!hookOptions.length) return
    setHookIdx((hookIdx + 1) % hookOptions.length)
  }
  const [voices, setVoices] = useState([])
  const [selectedVoice, setSelectedVoice] = useState(() => rvs.voiceId || localStorage.getItem('posty_tts_voice') || settings?.elevenlabs_voice_id || '')
  const [voicesLoaded, setVoicesLoaded] = useState(false)
  // ElevenLabs voice settings — restored from job first, then localStorage
  const [ttsStability, setTtsStability] = useState(() => rvs.stability ?? (Number(localStorage.getItem('posty_tts_stability')) || 0.5))
  const [ttsSimilarity, setTtsSimilarity] = useState(() => rvs.similarity ?? (Number(localStorage.getItem('posty_tts_similarity')) || 0.75))
  const [ttsStyle, setTtsStyle] = useState(() => rvs.style ?? (Number(localStorage.getItem('posty_tts_style')) || 0))
  const [ttsSpeakerBoost, setTtsSpeakerBoost] = useState(() => rvs.speakerBoost ?? (localStorage.getItem('posty_tts_boost') !== 'false'))
  // Speech speed multiplier. 1.0 = natural pace. TikTok/Reels hooks often
  // land harder at 1.05–1.15 because the first second is scroll-stop
  // territory. ElevenLabs supports 0.7–1.2 on compatible voices.
  const [ttsSpeed, setTtsSpeed] = useState(() => rvs.speed ?? (Number(localStorage.getItem('posty_tts_speed')) || 1.0))
  useEffect(() => { localStorage.setItem('posty_tts_stability', ttsStability) }, [ttsStability])
  useEffect(() => { localStorage.setItem('posty_tts_similarity', ttsSimilarity) }, [ttsSimilarity])
  useEffect(() => { localStorage.setItem('posty_tts_style', ttsStyle) }, [ttsStyle])
  useEffect(() => { localStorage.setItem('posty_tts_boost', ttsSpeakerBoost) }, [ttsSpeakerBoost])
  useEffect(() => { localStorage.setItem('posty_tts_speed', String(ttsSpeed)) }, [ttsSpeed])

  // Track whether audio was restored (not newly generated) for dimming Generate button
  const [audioIsRestored, setAudioIsRestored] = useState(!!rv.audioBlob)

  // Audio mix mode — restored from job first, then localStorage
  const [voMixMode, setVoMixMode] = useState(() => rvs.mode || localStorage.getItem('posty_vo_mode') || 'mix')
  const [voOrigVolume, setVoOrigVolume] = useState(() => rvs.originalVolume ?? (Number(localStorage.getItem('posty_vo_orig_vol')) || 0.3))
  // Snapshot of the most recent Review result persisted with the job
  // (voiceover_settings.lastReview). Declared up here so the save-settings
  // effect below can include it in its deps without hitting a TDZ error.
  const [savedReview, setSavedReview] = useState(() => rvs.lastReview || null)
  // Optional delay before the primary voiceover starts. Default 0 keeps
  // the old behavior (plays at t=0) so nothing regresses for existing jobs.
  const [primaryStartTime, setPrimaryStartTime] = useState(() => Number(rvs.primaryStartTime) || 0)
  // Script tightness preset — guides AI suggestions / reviews.
  // short = punchy TikTok (3-6 words), medium = natural phrase (6-12),
  // long = full sentence (12-20). Declared here (not later) so the
  // save-settings effect can include it in its deps without a TDZ error.
  const [segmentLength, setSegmentLength] = useState(() => rvs.segmentLength || 'short')
  useEffect(() => { localStorage.setItem('posty_vo_mode', voMixMode) }, [voMixMode])
  useEffect(() => { localStorage.setItem('posty_vo_orig_vol', voOrigVolume) }, [voOrigVolume])
  // When restoredVoiceover changes (draft resume), update all state from it
  useEffect(() => {
    if (!restoredVoiceover) return
    const s = restoredVoiceover.settings || {}
    if (s.ttsText) setTtsText(s.ttsText)
    if (s.voiceId) setSelectedVoice(s.voiceId)
    if (s.stability != null) setTtsStability(s.stability)
    if (s.similarity != null) setTtsSimilarity(s.similarity)
    if (s.style != null) setTtsStyle(s.style)
    if (s.speakerBoost != null) setTtsSpeakerBoost(s.speakerBoost)
    if (s.speed != null) setTtsSpeed(Number(s.speed) || 1.0)
    if (s.lastReview && s.lastReview.result) setSavedReview(s.lastReview)
    if (s.mode) setVoMixMode(s.mode)
    if (s.originalVolume != null) setVoOrigVolume(s.originalVolume)
    // Older drafts (no primaryStartTime) default to 0 — unchanged behavior.
    if (s.primaryStartTime != null) setPrimaryStartTime(Number(s.primaryStartTime) || 0)
    if (s.segmentLength) setSegmentLength(s.segmentLength)
    if (Array.isArray(s.segments) && s.segments.length > 0) {
      // Rehydrate segment list with metadata. If a segment has a saved
      // audioKey + public URL (from Supabase), fetch the bytes and populate
      // the blob so playback works immediately — no "Generate voices" click
      // required unless the text was changed after save.
      const restored = s.segments.map(seg => ({
        id: seg.id || `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text: seg.text || '',
        voiceId: seg.voiceId || '',
        startTime: Number(seg.startTime) || 0,
        stability: seg.stability,
        similarity: seg.similarity,
        style: seg.style,
        speakerBoost: seg.speakerBoost,
        speed: seg.speed != null ? Number(seg.speed) : 1.0,
        audioKey: seg.audioKey || null,
        blob: null, audioUrl: null, generating: false,
      }))
      setSegments(restored)
      // Async: fetch persisted audio in parallel and update each segment as
      // the blob arrives. Failures fall back to empty (user can regenerate).
      for (const seg of restored) {
        const remoteUrl = seg.audioKey && s.segments.find(x => x.id === seg.id)?.audioUrl
        if (!remoteUrl) continue
        ;(async () => {
          try {
            const resp = await fetch(remoteUrl)
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
            const blob = await resp.blob()
            const localUrl = URL.createObjectURL(blob)
            updateSegment(seg.id, { blob, audioUrl: localUrl })
          } catch (e) {
            console.warn(`[segment restore] ${seg.id} fetch failed:`, e.message)
          }
        })()
      }
    }
    if (restoredVoiceover.audioBlob) {
      setAudioBlob(restoredVoiceover.audioBlob)
      setAudioUrl(restoredVoiceover.audioUrl || URL.createObjectURL(restoredVoiceover.audioBlob))
      setAudioIsRestored(true)
    }
  }, [restoredVoiceover])

  // Stash on items so ResultCard can read during preview/post
  useEffect(() => {
    for (const vf of videoFiles) {
      vf._voiceoverMode = voMixMode
      vf._voiceoverOrigVol = voOrigVolume
      vf._voiceoverPrimaryStart = Number(primaryStartTime) || 0
    }
  }, [voMixMode, voOrigVolume, videoFiles, primaryStartTime])

  // Sync item._voiceoverBlob with the primary text. If the user clears the
  // primary textarea but the audio blob is still around, the preview/export
  // would play phantom audio the user can't see or edit.
  // Rule: primary audio only applies when there's primary text.
  // Only fire the change event when the actual values change — the
  // videoFiles prop gets a new array identity on every parent render,
  // which was dispatching the event constantly and resetting segment
  // audio pools (breaking preview playback).
  const lastPrimarySyncRef = useRef({ blob: null, text: '' })
  useEffect(() => {
    for (const vf of videoFiles) {
      if (audioBlob && ttsText.trim()) vf._voiceoverBlob = audioBlob
      else delete vf._voiceoverBlob
    }
    const prev = lastPrimarySyncRef.current
    if (prev.blob !== audioBlob || prev.text !== ttsText) {
      lastPrimarySyncRef.current = { blob: audioBlob, text: ttsText }
      try { window.dispatchEvent(new CustomEvent('posty-voiceover-change')) } catch {}
    }
  }, [audioBlob, ttsText, videoFiles])

  // --- Additional timed segments (multi-voiceover) ---
  // Each segment is an optional TTS clip placed at a specific startTime on top
  // of the primary recording/TTS. Blobs live in-memory during the session;
  // on job restore only the metadata (text + startTime + voice) comes back
  // so the user can re-generate audio with one click.
  const [segments, setSegments] = useState(() => Array.isArray(rvs.segments) ? rvs.segments.map(s => ({ ...s })) : [])
  const updateSegment = (id, patch) => setSegments(segs => segs.map(s => s.id === id ? { ...s, ...patch } : s))
  const addSegment = () => setSegments(segs => [...segs, {
    id: `seg-${Date.now()}`, text: '', voiceId: selectedVoice || '',
    startTime: Math.max(1, Math.round((segs[segs.length - 1]?.startTime || 0) + 5)),
    stability: ttsStability, similarity: ttsSimilarity, style: ttsStyle, speakerBoost: ttsSpeakerBoost,
    speed: 1.0,
    blob: null, audioUrl: null, generating: false,
  }])
  const removeSegment = (id) => setSegments(segs => {
    const gone = segs.find(s => s.id === id)
    if (gone?.audioUrl) { try { URL.revokeObjectURL(gone.audioUrl) } catch {} }
    return segs.filter(s => s.id !== id)
  })
  // Measure an audio blob's duration by loading it into an off-DOM
  // Audio element. Returns seconds (0 on failure). Used to track real
  // segment lengths so the AI can detect overruns and we can flag
  // overlaps in the UI.
  const measureAudioDuration = (blob) => new Promise((resolve) => {
    if (!blob) return resolve(0)
    const url = URL.createObjectURL(blob)
    const a = new Audio()
    const finish = (d) => { try { URL.revokeObjectURL(url) } catch {}; resolve(d) }
    const timer = setTimeout(() => finish(0), 4000)
    a.preload = 'metadata'
    a.onloadedmetadata = () => { clearTimeout(timer); finish(Number(a.duration) || 0) }
    a.onerror = () => { clearTimeout(timer); finish(0) }
    a.src = url
  })

  // Generate TTS for one segment (used by the bulk "Generate all" button below)
  const generateOneSegmentTTS = async (seg) => {
    if (!seg.text?.trim()) return null
    try {
      const r = await api.textToSpeech(seg.text.trim(), seg.voiceId || selectedVoice, {
        stability: seg.stability ?? ttsStability,
        similarity_boost: seg.similarity ?? ttsSimilarity,
        style: seg.style ?? ttsStyle,
        use_speaker_boost: seg.speakerBoost ?? ttsSpeakerBoost,
        // Per-segment speed — independent of the primary voiceover speed.
        // Defaults to 1.0 (natural) rather than ttsSpeed so a fast primary
        // hook doesn't force subsequent segments to also be fast.
        speed: seg.speed ?? 1.0,
      })
      if (r.error) throw new Error(r.error)
      const bc = atob(r.audio_base64)
      const bytes = new Uint8Array(bc.length)
      for (let i = 0; i < bc.length; i++) bytes[i] = bc.charCodeAt(i)
      const blob = new Blob([bytes], { type: r.media_type || 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      // Persist to Supabase so the segment survives draft resume.
      let audioKey = null
      if (jobId) {
        try {
          console.log(`[segment TTS] uploading ${seg.id} to storage (job ${jobId})...`)
          const res = await api.saveVoiceoverSegment(r.audio_base64, jobId, seg.id, r.media_type || 'audio/mpeg')
          if (res?.audio_key) {
            audioKey = res.audio_key
            console.log(`[segment TTS] ${seg.id} persisted as ${audioKey}`)
          } else {
            console.warn(`[segment TTS] ${seg.id} persist returned no audio_key:`, res)
          }
        } catch (e) {
          console.warn('[segment TTS] persist failed (segment still works in memory):', e.message)
        }
      } else {
        console.warn(`[segment TTS] no jobId — segment ${seg.id} will not persist`)
      }
      const duration = await measureAudioDuration(blob)
      return { blob, audioUrl: url, audioKey, duration }
    } catch (err) {
      console.error('[segment TTS]', err)
      throw err
    }
  }
  // Single "Generate all voices" action: loops through segments that don't
  // already have audio (or whose text changed) and runs TTS for each.
  const [generatingAll, setGeneratingAll] = useState(false)
  // Regenerate a single segment's TTS without touching any others. Useful
  // when the user only tweaked one segment's text, voice, or speed and
  // doesn't want to burn ElevenLabs calls on segments that are already
  // fine. Marks just this segment as generating while running.
  const regenerateOneSegment = async (segId) => {
    const seg = segments.find(s => s.id === segId)
    if (!seg || !seg.text?.trim()) return
    updateSegment(segId, { generating: true })
    try {
      const result = await generateOneSegmentTTS(seg)
      if (result) updateSegment(segId, { blob: result.blob, audioUrl: result.audioUrl, audioKey: result.audioKey || null, duration: result.duration || 0, generating: false })
      else updateSegment(segId, { generating: false })
    } catch (err) {
      updateSegment(segId, { generating: false })
      alert(`Segment regenerate failed: ${err.message}`)
    }
    // Flush the new audioKey so a refresh doesn't lose it
    if (onFlushSave) setTimeout(() => { onFlushSave().catch(() => {}) }, 50)
  }

  const generateAllSegments = async () => {
    // Regenerates every clip with text — primary + all segments.
    const pending = segments.filter(s => s.text?.trim())
    const primaryHasText = !!ttsText.trim()
    if (pending.length === 0 && !primaryHasText) {
      alert('Nothing to generate — add some text first.')
      return
    }
    setGeneratingAll(true)
    try {
      // Mark all segments-with-text as generating so the user sees progress
      setSegments(segs => segs.map(s => pending.find(p => p.id === s.id) ? { ...s, generating: true } : s))
      // First: primary voiceover if it has text
      if (primaryHasText) {
        setTtsLoading(true)
        try {
          const api = await import('../api')
          const r = await api.textToSpeech(ttsText.trim(), selectedVoice || undefined, {
            stability: ttsStability,
            similarity_boost: ttsSimilarity,
            style: ttsStyle,
            use_speaker_boost: ttsSpeakerBoost,
            speed: ttsSpeed,
          })
          if (r.error) throw new Error(r.error)
          const bc = atob(r.audio_base64)
          const bytes = new Uint8Array(bc.length)
          for (let i = 0; i < bc.length; i++) bytes[i] = bc.charCodeAt(i)
          const blob = new Blob([bytes], { type: r.media_type || 'audio/mpeg' })
          setAudioBlob(blob)
          if (audioUrl) URL.revokeObjectURL(audioUrl)
          setAudioUrl(URL.createObjectURL(blob))
          for (const vf of videoFiles) vf._voiceoverBlob = blob
          try { window.dispatchEvent(new CustomEvent('posty-voiceover-change')) } catch {}
          persistAudio(blob)
        } catch (e) {
          alert('Primary voiceover TTS failed: ' + e.message)
        } finally {
          setTtsLoading(false)
        }
      }
      // Then: each pending timed segment
      for (const seg of pending) {
        try {
          const result = await generateOneSegmentTTS(seg)
          if (result) updateSegment(seg.id, { blob: result.blob, audioUrl: result.audioUrl, audioKey: result.audioKey || null, duration: result.duration || 0, generating: false })
        } catch (err) {
          updateSegment(seg.id, { generating: false })
          alert(`Failed on segment at ${seg.startTime}s: ${err.message}`)
          break // stop on first error so user can fix
        }
      }
    } finally {
      setGeneratingAll(false)
      // Wait one tick so the segment state updates are flushed into the
      // pending save payload, then push it to the server immediately.
      // Without this, fresh audio keys sit in the 800ms debounce window
      // and are lost if the user refreshes.
      if (onFlushSave) setTimeout(() => { onFlushSave().catch(e => console.warn('[flushSave] failed:', e.message)) }, 50)
    }
  }
  // Audio elements for segment playback during the synced preview.
  // Keyed by segment id so we can reuse across timeupdate ticks without re-triggering.
  const segAudioMapRef = useRef(new Map())
  const segFiredRef = useRef(new Set()) // ids that have started playing this cycle
  // Rebuild/invalidate Audio elements whenever the segment list or its audio changes
  useEffect(() => {
    const map = segAudioMapRef.current
    const current = new Set(segments.map(s => s.id))
    // Remove stale audios
    for (const [id, a] of map) {
      if (!current.has(id)) { try { a.pause() } catch {}; map.delete(id) }
    }
    // Add/refresh audio for each segment that has a blob url
    for (const s of segments) {
      const existing = map.get(s.id)
      if (s.audioUrl && (!existing || existing.src !== s.audioUrl)) {
        if (existing) { try { existing.pause() } catch {} }
        const a = new Audio(s.audioUrl)
        a.preload = 'auto'
        map.set(s.id, a)
      } else if (!s.audioUrl && existing) {
        try { existing.pause() } catch {}
        map.delete(s.id)
      }
    }
    const mappedCount = Array.from(map.values()).length
    console.log(`[VoiceoverRecorder] segment audio pool: ${mappedCount} ready, ${segments.length} total`)
    // Dump the full map so we can see which text/startTime maps to which URL
    for (const s of segments) {
      const a = map.get(s.id)
      console.log(`  seg ${s.id} @ ${s.startTime}s text="${(s.text || '').slice(0, 30)}" url=${(a?.src || s.audioUrl || '').slice(-60)}`)
    }
  }, [segments])
  // "missing" warnings use a separate set so play/seek resets don't re-spam
  const segWarnedRef = useRef(new Set())
  // Tracks whether the primary voiceover has been fired this playthrough
  const primaryFiredRef = useRef(false)
  // Called every timeupdate tick to fire any segment whose start time has arrived
  const maybeFireSegments = (videoTimeFromTrimStart) => {
    for (const s of segments) {
      const audio = segAudioMapRef.current.get(s.id)
      if (!audio) {
        if (!segWarnedRef.current.has(s.id)) {
          console.log(`[VoiceoverRecorder] segment ${s.id} at ${s.startTime}s has no audio yet — click Generate voices`)
          segWarnedRef.current.add(s.id)
        }
        continue
      }
      if (segFiredRef.current.has(s.id)) continue
      if (videoTimeFromTrimStart >= (Number(s.startTime) || 0)) {
        segFiredRef.current.add(s.id)
        console.log(`[VoiceoverRecorder] firing ${s.id} at ${s.startTime}s, src=${audio.src?.slice(-80)}, stateText="${(s.text || '').slice(0, 40)}"`)
        try { audio.currentTime = 0; audio.play().catch(err => console.warn('[seg play]', err)) } catch (e) { console.warn('[seg play]', e) }
      }
    }
  }
  const resetSegmentPlayback = () => {
    segFiredRef.current.clear()
    for (const a of segAudioMapRef.current.values()) {
      try { a.pause(); a.currentTime = 0 } catch {}
    }
  }
  // Play a single segment's audio — returns the promise so we can surface errors
  const segTestAudioRef = useRef(null)
  const playSegment = (id) => {
    const seg = segments.find(s => s.id === id)
    if (!seg?.audioUrl) return
    console.log(`[VoiceoverRecorder] ▶ test ${id} text="${(seg.text || '').slice(0, 40)}" url=${seg.audioUrl.slice(-60)}`)
    try {
      // Stop any currently playing test
      if (segTestAudioRef.current) { try { segTestAudioRef.current.pause() } catch {} }
      const a = new Audio(seg.audioUrl)
      segTestAudioRef.current = a
      a.play().catch(err => {
        console.warn('[segment test] play rejected:', err)
        alert('Browser blocked audio playback — try clicking Test again or check sound output.')
      })
    } catch (err) {
      console.error('[segment test]', err)
    }
  }
  // Stash segment blobs on each video item for the preview/publish pipeline.
  // Dispatch the change event only when the READY-segments signature
  // actually changes — not on every videoFiles reference bump (parent
  // re-renders would otherwise spam the event, resetting the audio
  // pools in the preview listener and breaking playback).
  const lastSegSyncRef = useRef('')
  useEffect(() => {
    const ready = segments.filter(s => s.blob).map(s => ({
      blob: s.blob, startTime: Number(s.startTime) || 0, volume: 1,
    }))
    for (const vf of videoFiles) {
      if (ready.length) vf._voiceoverSegments = ready
      else delete vf._voiceoverSegments
    }
    // Signature = ordered list of (id|startTime) for segments with audio.
    // Blobs aren't directly stringifiable but identity changes =
    // different blob URLs which our consumers already handle.
    const sig = segments.map(s => `${s.id}:${s.blob ? 'Y' : 'N'}:${s.startTime}`).join('|')
    if (sig !== lastSegSyncRef.current) {
      lastSegSyncRef.current = sig
      try { window.dispatchEvent(new CustomEvent('posty-voiceover-change')) } catch {}
    }
  }, [segments, videoFiles])

  // Auto-save voiceover settings to job when they change
  useEffect(() => {
    if (onSettingsChange) {
      onSettingsChange({
        mode: voMixMode,
        originalVolume: voOrigVolume,
        ttsText,
        voiceId: selectedVoice,
        stability: ttsStability,
        similarity: ttsSimilarity,
        style: ttsStyle,
        speakerBoost: ttsSpeakerBoost,
        speed: ttsSpeed,
        duration: audioDuration || null,
        primaryStartTime,
        segmentLength,
        lastReview: savedReview,
        // Persist segment metadata + audio key so blobs come back on resume
        segments: segments.map(s => ({
          id: s.id, text: s.text, voiceId: s.voiceId,
          startTime: s.startTime,
          stability: s.stability, similarity: s.similarity, style: s.style, speakerBoost: s.speakerBoost,
          speed: s.speed != null ? s.speed : null,
          duration: s.duration || null,
          audioKey: s.audioKey || null,
        })),
      })
    }
  }, [voMixMode, voOrigVolume, ttsText, selectedVoice, ttsStability, ttsSimilarity, ttsStyle, ttsSpeakerBoost, ttsSpeed, segments, primaryStartTime, savedReview, segmentLength])

  // Clear "restored" flag when TTS settings change so Generate button un-dims
  const ttsSettingsKeyRef = useRef(`${rvs.ttsText}|${rvs.voiceId}|${rvs.stability}|${rvs.similarity}|${rvs.style}|${rvs.speakerBoost}`)
  useEffect(() => {
    const current = `${ttsText}|${selectedVoice}|${ttsStability}|${ttsSimilarity}|${ttsStyle}|${ttsSpeakerBoost}`
    if (current !== ttsSettingsKeyRef.current) setAudioIsRestored(false)
  }, [ttsText, selectedVoice, ttsStability, ttsSimilarity, ttsStyle, ttsSpeakerBoost])

  // Save voiceover audio blob to job storage (Supabase)
  const persistAudio = async (blob) => {
    if (!jobId || !blob) return
    try {
      const b64 = await blobToBase64(blob)
      const api = await import('../api')
      await api.saveVoiceover(b64, jobId, blob.type || 'audio/webm')
    } catch (e) {
      console.warn('[voiceover] persist failed:', e.message)
    }
  }

  const hasElevenLabs = !!settings?.elevenlabs_configured
  // Default tab: if the restored voiceover looks like an ElevenLabs clip
  // (has tts text, a voice id, or saved segments), start on the AI voice tab
  // so the user sees what was previously generated — not an empty mic UI.
  const looksLikeTts = !!(rvs.ttsText || rvs.voiceId || (Array.isArray(rvs.segments) && rvs.segments.length > 0))
  const [tab, setTab] = useState(looksLikeTts ? 'tts' : 'record') // record | tts
  // When restoredVoiceover arrives later (draft resume), re-evaluate the tab
  useEffect(() => {
    const s = restoredVoiceover?.settings
    if (!s) return
    if (s.ttsText || s.voiceId || (Array.isArray(s.segments) && s.segments.length > 0)) {
      setTab('tts')
    }
  }, [restoredVoiceover])

  // Video source for the voiceover monitor. Priority order:
  //   1. Freshly-merged video (user just hit Merge / Re-merge) — no trim,
  //      plays from 0 to its natural end since the merge is already the
  //      final composition.
  //   2. First video file (restored draft or single-clip flow) with its
  //      trim bounds applied during playback.
  const [monitorSrc, setMonitorSrc] = useState(null)
  const [mergedMonitorActive, setMergedMonitorActive] = useState(false)
  const monitorFileRef = useRef(null)
  const monitorItem = videoFiles[0] || null

  // Watch for a fresh merge (posty-voiceover-change isn't fired by Merge,
  // but window._postyMergedVideo is updated). Re-evaluate on mount and on
  // video files change, plus listen for a custom merged event.
  useEffect(() => {
    const refresh = () => {
      const mergedUrl = (typeof window !== 'undefined' && window._postyMergedVideo?.url) || null
      const file = monitorItem?.file
      // Prefer the latest merge when it's available
      if (mergedUrl) {
        if (monitorSrc === mergedUrl) return
        if (monitorSrc && monitorSrc.startsWith('blob:') && !mergedMonitorActive) URL.revokeObjectURL(monitorSrc)
        setMonitorSrc(mergedUrl)
        setMergedMonitorActive(true)
        setMonitorDuration(0)
        return
      }
      if (file === monitorFileRef.current && monitorSrc && !mergedMonitorActive) return
      monitorFileRef.current = file
      if (monitorSrc && monitorSrc.startsWith('blob:') && !mergedMonitorActive) URL.revokeObjectURL(monitorSrc)
      if (file instanceof Blob || file instanceof File) {
        setMonitorSrc(URL.createObjectURL(file))
      } else if (monitorItem?._uploadKey && monitorItem?._tenantSlug) {
        setMonitorSrc(`${import.meta.env.VITE_API_URL || ''}/api/t/${monitorItem._tenantSlug}/upload/serve?key=${encodeURIComponent(monitorItem._uploadKey)}`)
      } else {
        setMonitorSrc(null)
      }
      setMergedMonitorActive(false)
      setMonitorDuration(0)
    }
    refresh()
    const onMerge = () => refresh()
    window.addEventListener('posty-merge-change', onMerge)
    return () => window.removeEventListener('posty-merge-change', onMerge)
  }, [monitorItem?.id])
  // Use no trim bounds when the monitor is playing the merged video — the
  // merge output is already the finished composition.
  const monitorTrimStart = mergedMonitorActive ? 0 : (monitorItem?._trimStart || 0)
  const monitorTrimEnd = mergedMonitorActive ? null : (monitorItem?._trimEnd ?? null)

  // Load voices as soon as ElevenLabs is configured (don't wait for tab switch)
  useEffect(() => {
    if (!hasElevenLabs || voicesLoaded) return
    import('../api').then(api => api.getVoices()).then(r => {
      if (r.voices && r.voices.length > 0) {
        setVoices(r.voices)
        // Auto-select the first voice if none is set
        if (!selectedVoice) { setSelectedVoice(r.voices[0].voice_id); localStorage.setItem('posty_tts_voice', r.voices[0].voice_id) }
      }
      setVoicesLoaded(true)
    }).catch(() => setVoicesLoaded(true))
  }, [hasElevenLabs, voicesLoaded])

  // --- Mic recording (synced with muted video monitor) ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4' })
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: mr.mimeType })
        setAudioBlob(blob)
        if (audioUrl) URL.revokeObjectURL(audioUrl)
        setAudioUrl(URL.createObjectURL(blob))
        // Stash on video items so CaptionEditor can include it in previews
        for (const vf of videoFiles) vf._voiceoverBlob = blob
        try { window.dispatchEvent(new CustomEvent('posty-voiceover-change')) } catch {}
        // Save to job storage for persistence
        persistAudio(blob)
        // Pause the monitor
        try { monitorRef.current?.pause() } catch {}
        clearInterval(recordTimerRef.current)
      }
      mediaRecorderRef.current = mr

      // Start the muted video monitor in sync with the recording.
      // Seek to trimStart so the video starts at the right spot.
      const v = monitorRef.current
      if (v) {
        v.muted = true
        try { v.currentTime = monitorTrimStart } catch {}
        v.play().catch(() => {})
      }

      // Recording timer
      setRecordTime(0)
      const startTs = Date.now()
      recordTimerRef.current = setInterval(() => {
        setRecordTime((Date.now() - startTs) / 1000)
      }, 100)

      mr.start()
      setRecording(true)
    } catch (err) {
      alert('Microphone access denied: ' + err.message)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop()
      setRecording(false)
      clearInterval(recordTimerRef.current)
    }
  }

  // Track the monitor video's currentTime for the playhead bar.
  // Runs during recording AND during preview playback (when audio is playing).
  const [monitorTime, setMonitorTime] = useState(0)
  const [previewing, setPreviewing] = useState(false)
  useEffect(() => {
    if (!recording && !previewing) return
    let raf
    const tick = () => {
      const v = monitorRef.current
      if (v) {
        setMonitorTime(v.currentTime)
        // Auto-stop recording at trimEnd
        if (recording) {
          const end = monitorTrimEnd ?? v.duration
          if (v.currentTime >= end - 0.05) {
            stopRecording()
            return
          }
        }
        // Track as long as the VIDEO is playing, not the audio. AI voiceovers
        // are often shorter than the clip — the video should keep playing
        // (with original audio or silence) after the voiceover ends.
        if (!recording && v.paused && v.currentTime > 0) {
          setPreviewing(false)
          return
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [recording, previewing, monitorTrimEnd])

  // --- TTS ---
  // --- Script import / export / review state ---
  const [scriptModalOpen, setScriptModalOpen] = useState(null) // null | 'paste' | 'review'
  const [pasteInput, setPasteInput] = useState('')
  const [pastePreview, setPastePreview] = useState([])
  const [reviewing, setReviewing] = useState(false)
  const [reviewResult, setReviewResult] = useState(null)
  // Re-parse on every keystroke so the user sees what'll actually be applied
  useEffect(() => { setPastePreview(parseVoiceoverScript(pasteInput)) }, [pasteInput])

  const applyPastedScript = () => {
    const parsed = pastePreview
    if (parsed.length === 0) return
    // ALWAYS promote the first line to primary (regardless of its startTime).
    // Reason: the in-panel preview relies on the primary voiceover to
    // drive playback; segment-only drafts don't play cleanly yet.
    // primaryStartTime preserves whatever delay the first line had.
    const first = parsed[0]
    setTtsText(first.text)
    setPrimaryStartTime(Number(first.startTime) || 0)
    const rest = parsed.slice(1)
    setSegments(rest.map(s => ({
      id: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      text: s.text,
      voiceId: selectedVoice,
      startTime: s.startTime,
      stability: ttsStability, similarity: ttsSimilarity, style: ttsStyle, speakerBoost: ttsSpeakerBoost,
      speed: 1.0,
      blob: null, audioUrl: null, audioKey: null, generating: false,
    })))
    setScriptModalOpen(null)
    setPasteInput('')
  }

  // Pull on-screen caption context off the first video item so exports
  // and reviews know what's visible — helps the LLM write a voiceover
  // that complements the captions rather than duplicating them.
  // Also includes project-level context: brand, business type, hook
  // mode, enabled platforms, and the per-platform caption text the user
  // is about to post. This is everything needed for a holistic review.
  const overlayCtx = () => {
    const os = (monitorItem?._overlaySettings) || {}
    const captions = monitorItem?.captions && typeof monitorItem.captions === 'object' ? monitorItem.captions : null
    return {
      overlayOpening: os.openingText || null,
      overlayMiddle: os.middleText || null,
      overlayClosing: os.closingText || null,
      middleStartTime: os.middleStartTime ?? null,
      videoDuration: monitorDuration || null,
      hookMode,
      platforms: Array.isArray(activePlatforms) ? activePlatforms : [],
      platformCaptions: captions,
      brandName: settings?.name || null,
      businessType: settings?.business_type || null,
      location: settings?.location || null,
    }
  }

  const exportCurrentScript = async () => {
    const payload = exportVoiceoverScript({
      primaryText: ttsText,
      primaryStartTime,
      primaryDuration: audioDuration,
      segments: segments.map(s => ({ text: s.text, startTime: s.startTime, duration: s.duration || 0 })),
      ...overlayCtx(),
    })
    if (!payload) { alert('Nothing to export — write something first.'); return }
    try {
      await navigator.clipboard.writeText(payload)
      alert('Script copied to clipboard.\n\nPaste it into ChatGPT / Claude / notes to save or revise.')
    } catch {
      // Fallback: show in a prompt the user can copy from
      window.prompt('Copy this script:', payload)
    }
  }

  const reviewCurrentScript = async (opts = {}) => {
    const ctx = overlayCtx()
    const items = exportVoiceoverScript({
      primaryText: ttsText,
      primaryStartTime,
      primaryDuration: audioDuration,
      segments: segments.map(s => ({ text: s.text, startTime: s.startTime, duration: s.duration || 0 })),
      ...ctx,
    })
    if (!items) { alert('Nothing to review — write something first.'); return }
    setReviewing(true)
    setReviewResult(null)
    setScriptModalOpen('review')
    try {
      const script = parseVoiceoverScript(items) // canonical round-trip
      // Capture frames from the merged video. For each segment we grab:
      //   - startTime   (what the viewer sees the instant the voice begins — often
      //                  a transition)
      //   - startTime + ~1.2s (past the transition — usually the subject)
      // Plus two overall bookends: t=0 (opening) and t=duration-0.5 (closing).
      // Gives Claude a narrative arc rather than just transition frames.
      const videoSrc = (typeof window !== 'undefined' && window._postyMergedVideo?.url) || monitorSrc || null
      let frames = []
      if (videoSrc && script.length > 0) {
        try {
          setReviewResult({ progress: 'Capturing video frames…' })
          const dur = monitorDuration || null
          // Build timestamp list with labels. Cap at 10 frames total to
          // keep Claude vision cost predictable (~16K tokens of images).
          const spec = []
          spec.push({ label: 'opening', at: 0 })
          for (const s of script) {
            const t = Number(s.startTime) || 0
            spec.push({ label: `seg ${t.toFixed(1)}s · start`, at: t })
            // Offset by ~1.2s for a "past the transition" mid-shot, but only if
            // there's room before the next segment (or video end).
            const nextT = script
              .map(x => Number(x.startTime) || 0)
              .filter(x => x > t)
              .sort((a, b) => a - b)[0]
            const cap = nextT != null ? Math.min(nextT - 0.2, t + 1.5) : (dur ? dur - 0.3 : t + 1.5)
            const midT = t + 1.2
            if (cap > t + 0.4) spec.push({ label: `seg ${t.toFixed(1)}s · mid`, at: Math.min(midT, cap) })
          }
          if (dur && dur > 1) spec.push({ label: 'closing', at: Math.max(0, dur - 0.5) })
          // Dedupe (within 0.3s) and cap total
          const dedup = []
          for (const s of spec) {
            if (!dedup.some(d => Math.abs(d.at - s.at) < 0.3)) dedup.push(s)
          }
          const picks = dedup.slice(0, 10)
          const shots = await captureVideoFrames(videoSrc, picks.map(p => p.at), { width: 480, quality: 0.72 })
          frames = shots.map((s, i) => ({ startTime: s.startTime, dataUrl: s.dataUrl, label: picks[i].label }))
        } catch (e) { console.warn('[review] frame capture failed:', e.message) }
      }
      setReviewResult({ progress: 'Sending to Claude…' })
      const r = await api.reviewVoiceoverScript({
        script,
        videoHint: settings?._lastHint || null,
        duration: monitorDuration || null,
        overlayOpening: ctx.overlayOpening,
        overlayMiddle: ctx.overlayMiddle,
        overlayClosing: ctx.overlayClosing,
        hookMode: ctx.hookMode,
        platforms: ctx.platforms,
        platformCaptions: ctx.platformCaptions,
        // Strip data: prefix before sending; keep dataUrls in frames[] for UI
        frames: frames.filter(f => f.dataUrl).map(f => ({
          startTime: f.startTime,
          label: f.label || null,
          image_base64: dataUrlToBase64(f.dataUrl),
        })),
        segmentLength,
        shortenToFit: !!opts.shortenToFit,
      })
      if (r.error) throw new Error(r.error)
      r._frames = frames // keep locally for thumbnail display
      setReviewResult(r)
      // Persist so the user can reopen without re-spending tokens
      const snap = { result: r, reviewedAt: new Date().toISOString(), signature: items }
      setSavedReview(snap)
    } catch (e) {
      setReviewResult({ error: e.message })
    }
    setReviewing(false)
  }

  // Reopen the most recent saved review without hitting the API again.
  // Flagged stale in the modal if the current script no longer matches.
  const viewSavedReview = () => {
    if (!savedReview?.result) return
    setReviewResult(savedReview.result)
    setScriptModalOpen('review')
  }

  // Apply the revised script that Claude proposed during review. Overwrites
  // current primary + all segments, clearing audio blobs (user regenerates
  // voices after reviewing the new text).
  const applyRevisedScript = () => {
    const revised = Array.isArray(reviewResult?.revised_script) ? reviewResult.revised_script : []
    if (revised.length === 0) return
    // ALWAYS promote the first line to primary so the in-panel preview
    // plays correctly. primaryStartTime preserves the AI's intended delay.
    const first = revised[0]
    setTtsText(String(first.text || '').trim())
    setPrimaryStartTime(Number(first.startTime) || 0)
    setAudioBlob(null)
    if (audioUrl) { try { URL.revokeObjectURL(audioUrl) } catch {}; setAudioUrl(null) }
    for (const vf of videoFiles) delete vf._voiceoverBlob
    const rest = revised.slice(1)
    setSegments(rest.map(s => ({
      id: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      text: String(s.text || '').trim(),
      voiceId: selectedVoice,
      startTime: Number(s.startTime) || 0,
      stability: ttsStability, similarity: ttsSimilarity, style: ttsStyle, speakerBoost: ttsSpeakerBoost,
      speed: 1.0,
      blob: null, audioUrl: null, audioKey: null, generating: false,
    })))
    try { window.dispatchEvent(new CustomEvent('posty-voiceover-change')) } catch {}
    setScriptModalOpen(null)
    setReviewResult(null)
  }

  // Capture a chronological set of frames covering the full video so
  // Claude can "see" the clip from start to end. Used by Suggest
  // segments and Download bundle. Even distribution (every ~2s), capped
  // at 10 frames, offset from exact cut boundaries to avoid transitions.
  const captureCoverageFrames = async () => {
    const videoSrc = (typeof window !== 'undefined' && window._postyMergedVideo?.url) || monitorSrc || null
    if (!videoSrc) return []
    const dur = monitorDuration || 15
    const count = Math.max(5, Math.min(10, Math.ceil(dur / 2)))
    const step = dur / count
    const picks = []
    for (let i = 0; i < count; i++) {
      const t = Math.min(dur - 0.3, Math.max(0.3, i * step + step / 2))
      const label = i === 0 ? 'opening' : (i === count - 1 ? 'closing' : `mid ${t.toFixed(1)}s`)
      picks.push({ at: t, label })
    }
    const shots = await captureVideoFrames(videoSrc, picks.map(p => p.at), { width: 480, quality: 0.72 })
    return shots.map((s, i) => ({ startTime: s.startTime, label: picks[i].label, dataUrl: s.dataUrl }))
  }

  // --- Suggest segments from video (vision-based) ---
  const [suggesting, setSuggesting] = useState(false)
  const [suggestResult, setSuggestResult] = useState(null)
  const [suggestStyle, setSuggestStyle] = useState('')
  // Operator audience override for the Suggest endpoint. "auto" = let
  // Claude read the frames; any other value forces a specific tone
  // register regardless of what the frames look like.
  const [audienceOverride, setAudienceOverride] = useState('auto')
  // AI now returns 3 candidates (payoff / identity / proof) with scores;
  // the user picks which one to apply. Defaults to winner_index.
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState(0)
  const suggestSegmentsFromVideo = async () => {
    setSuggesting(true)
    setSuggestResult(null)
    setScriptModalOpen('suggest')
    try {
      const ctx = overlayCtx()
      setSuggestResult({ progress: 'Capturing video frames…' })
      const frames = await captureCoverageFrames()
      if (!frames.length || !frames.some(f => f.dataUrl)) {
        throw new Error('No video frames captured. Try generating/merging a video first.')
      }
      setSuggestResult({ progress: 'Asking Claude to write segments from the visuals…', _frames: frames })
      const r = await api.voiceoverFromVideo({
        frames: frames.filter(f => f.dataUrl).map(f => ({
          startTime: f.startTime, label: f.label,
          image_base64: dataUrlToBase64(f.dataUrl),
        })),
        videoHint: settings?._lastHint || null,
        duration: ctx.videoDuration,
        hookMode: ctx.hookMode,
        platforms: ctx.platforms,
        overlayOpening: ctx.overlayOpening,
        overlayMiddle: ctx.overlayMiddle,
        overlayClosing: ctx.overlayClosing,
        style: suggestStyle || null,
        segmentLength,
        audienceOverride,
      })
      if (r.error) throw new Error(r.error)
      r._frames = frames
      setSuggestResult(r)
      // Default selection to the winner the backend ranked highest
      if (Array.isArray(r.candidates) && r.candidates.length > 0) {
        const w = Number.isInteger(r.winner_index) ? r.winner_index : 0
        setSelectedCandidateIdx(Math.max(0, Math.min(r.candidates.length - 1, w)))
      } else {
        setSelectedCandidateIdx(0)
      }
    } catch (e) {
      setSuggestResult({ error: e.message })
    }
    setSuggesting(false)
  }
  const applySuggestedSegments = () => {
    // When candidates[] exists, use the user-selected candidate; else fall
    // back to legacy top-level segments.
    const cands = Array.isArray(suggestResult?.candidates) ? suggestResult.candidates : null
    const chosen = cands && cands[selectedCandidateIdx] ? cands[selectedCandidateIdx] : suggestResult
    const arr = Array.isArray(chosen?.segments) ? chosen.segments : []
    if (arr.length === 0) return
    // ALWAYS promote the first line to primary — preview playback relies
    // on a primary voiceover to drive audio sync. primaryStartTime keeps
    // the AI's intended delay.
    const first = arr[0]
    setTtsText(String(first.text || '').trim())
    setPrimaryStartTime(Number(first.startTime) || 0)
    setAudioBlob(null)
    if (audioUrl) { try { URL.revokeObjectURL(audioUrl) } catch {}; setAudioUrl(null) }
    for (const vf of videoFiles) delete vf._voiceoverBlob
    const rest = arr.slice(1)
    setSegments(rest.map(s => ({
      id: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      text: String(s.text || '').trim(),
      voiceId: selectedVoice,
      startTime: Number(s.startTime) || 0,
      stability: ttsStability, similarity: ttsSimilarity, style: ttsStyle, speakerBoost: ttsSpeakerBoost,
      speed: 1.0,
      blob: null, audioUrl: null, audioKey: null, generating: false,
    })))
    try { window.dispatchEvent(new CustomEvent('posty-voiceover-change')) } catch {}
    // Apply proposed on-screen captions (opening/middle/closing) to the
    // monitorItem + notify ResultCard so its textareas pick them up. These
    // are the burned-in scroll-stoppers — different from the spoken voiceover.
    const o = chosen?.overlays
    if (o && monitorItem) {
      monitorItem._overlaySettings = {
        ...(monitorItem._overlaySettings || {}),
        ...(o.opening ? { openingText: o.opening } : {}),
        ...(o.middle ? { middleText: o.middle } : {}),
        ...(o.middleStartTime != null ? { middleStartTime: Number(o.middleStartTime) || 0 } : {}),
        ...(o.closing ? { closingText: o.closing } : {}),
      }
      try {
        window.dispatchEvent(new CustomEvent('posty-overlays-suggested', {
          detail: {
            itemId: monitorItem.id,
            opening: o.opening || null,
            middle: o.middle || null,
            middleStartTime: o.middleStartTime != null ? Number(o.middleStartTime) || 0 : null,
            closing: o.closing || null,
          },
        }))
      } catch {}
    }
    setScriptModalOpen(null)
    setSuggestResult(null)
  }

  // --- Download review bundle (script + frames + prompt for other AI) ---
  const [bundling, setBundling] = useState(false)
  const downloadReviewBundle = async () => {
    setBundling(true)
    try {
      const JSZipMod = (await import('jszip')).default
      const zip = new JSZipMod()
      const ctx = overlayCtx()
      // 1) script.txt — full export w/ header, voiceover, platform captions
      const script = exportVoiceoverScript({
        primaryText: ttsText,
        primaryStartTime,
        primaryDuration: audioDuration,
        segments: segments.map(s => ({ text: s.text, startTime: s.startTime, duration: s.duration || 0 })),
        ...ctx,
      })
      zip.file('script.txt', script || '# (empty)')
      // 2) prompt.txt — ready-to-paste instructions for ChatGPT / Gemini
      zip.file('prompt.txt', [
        'Below is a short-form video voiceover project. Please review end-to-end and suggest improvements.',
        '',
        'What to evaluate:',
        '1. Does the voiceover script land a scroll-stopping hook in the first 1-2 seconds?',
        '2. Do the segment timings match what is happening in the video frames (see frames/ folder)?',
        '3. Does the voiceover complement the on-screen captions (do not repeat them)?',
        '4. Do the per-platform captions (below in script.txt) feel native to each platform (TikTok vs Reels vs Blog)?',
        '5. Suggest 3-6 revised voiceover segments in the same [m:ss] text format as script.txt, anchored to the frames.',
        '',
        'Format your response:',
        '- Score (0-100)',
        '- Verdict (one sentence)',
        '- Issues (bullet list)',
        '- Revised voiceover script (timestamped lines)',
      ].join('\n'))
      // 3) frames/ — JPEGs at segment times for the vision model
      setSuggestResult({ progress: 'Capturing frames for bundle…' })
      // Prefer captured frames from the last review/suggest if available, else recapture coverage set
      let frames = (reviewResult?._frames || suggestResult?._frames || null)
      if (!frames || frames.length === 0) frames = await captureCoverageFrames()
      const framesFolder = zip.folder('frames')
      frames.forEach((f, i) => {
        if (!f.dataUrl) return
        const b64 = dataUrlToBase64(f.dataUrl)
        if (!b64) return
        const tsStr = String(Number(f.startTime || 0).toFixed(1)).replace('.', 's')
        const safe = String(f.label || `frame-${i}`).replace(/[^\w-]+/g, '-').slice(0, 24)
        framesFolder.file(`${String(i).padStart(2, '0')}_${tsStr}_${safe}.jpg`, b64, { base64: true })
      })
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const brandSlug = (settings?.name || 'posty').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'posty'
      a.download = `${brandSlug}-voiceover-bundle.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (e) {
      alert('Download failed: ' + (e?.message || e))
    } finally {
      setBundling(false)
      // clear the transient progress if we stomped it
      setSuggestResult(prev => (prev && prev.progress && !prev.segments) ? null : prev)
    }
  }

  const copyScriptPrompt = async () => {
    const prompt = buildScriptPrompt({
      businessType: settings?.business_type || null,
      location: settings?.location || null,
      videoHint: settings?._lastHint || null,
      duration: monitorDuration ? Math.ceil(monitorDuration) : null,
    })
    try {
      await navigator.clipboard.writeText(prompt)
      alert('Prompt copied. Paste it into ChatGPT / Claude, then paste the result back via "Paste script".')
    } catch {
      window.prompt('Copy this prompt:', prompt)
    }
  }

  const generateTTS = async () => {
    // Regenerates EVERY voice clip that has text — primary + each segment
    // with text. Meant as a one-click "make it all fresh" action. Matches
    // the N count shown in the button.
    const segsToGen = segments.filter(s => s.text?.trim())
    const primaryHasText = !!ttsText.trim()
    if (!primaryHasText && segsToGen.length === 0) return
    setTtsLoading(true)
    try {
      const api = await import('../api')
      // 1) Generate the primary voiceover if it has text
      if (primaryHasText) {
        const r = await api.textToSpeech(ttsText.trim(), selectedVoice || undefined, {
          stability: ttsStability,
          similarity_boost: ttsSimilarity,
          style: ttsStyle,
          use_speaker_boost: ttsSpeakerBoost,
          speed: ttsSpeed,
        })
        if (r.error) throw new Error(r.error)
        const byteChars = atob(r.audio_base64)
        const bytes = new Uint8Array(byteChars.length)
        for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
        const blob = new Blob([bytes], { type: r.media_type || 'audio/mpeg' })
        setAudioBlob(blob)
        if (audioUrl) URL.revokeObjectURL(audioUrl)
        setAudioUrl(URL.createObjectURL(blob))
        for (const vf of videoFiles) vf._voiceoverBlob = blob
        try { window.dispatchEvent(new CustomEvent('posty-voiceover-change')) } catch {}
        persistAudio(blob)
      }
      // 2) Regenerate every timed segment that has text
      if (segsToGen.length > 0) {
        setGeneratingAll(true)
        setSegments(segs => segs.map(s => segsToGen.find(p => p.id === s.id) ? { ...s, generating: true } : s))
        for (const seg of segsToGen) {
          try {
            const result = await generateOneSegmentTTS(seg)
            if (result) updateSegment(seg.id, { blob: result.blob, audioUrl: result.audioUrl, audioKey: result.audioKey || null, duration: result.duration || 0, generating: false })
          } catch (err) {
            updateSegment(seg.id, { generating: false })
            alert(`Segment at ${seg.startTime}s failed: ${err.message}`)
            break
          }
        }
        setGeneratingAll(false)
      }
    } catch (err) {
      alert('TTS failed: ' + err.message)
    }
    setTtsLoading(false)
    // Flush pending save so segment audioKeys persist immediately rather than
    // sitting in the 800ms debounce (where a refresh would lose them).
    if (onFlushSave) setTimeout(() => { onFlushSave().catch(e => console.warn('[flushSave] failed:', e.message)) }, 50)
  }

  // No separate "Apply" button — the voiceover audio is stashed on each
  // video item (item._voiceoverBlob) and automatically mixed in when the
  // user clicks "Generate Preview" in the overlay editor. This avoids
  // sending the raw multi-MB video file from mobile (which crashes iOS).

  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-white border border-[#2D9A5E]/30 rounded-sm p-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-[11px] font-medium text-ink bg-transparent border-none cursor-pointer p-0"
      >
        <span>Voiceover {audioUrl ? '(recorded)' : ''}</span>
        <span className="text-muted text-[10px]">{expanded ? '▲ collapse' : '▼ expand'}</span>
      </button>

      {!expanded ? null : <div className="mt-2 space-y-2">

      {/* Tab switcher */}
      <div className="flex gap-2 text-[10px]">
        <button
          onClick={() => setTab('record')}
          className={`py-1 px-2.5 rounded border cursor-pointer ${tab === 'record' ? 'bg-[#2D9A5E] text-white border-[#2D9A5E]' : 'bg-white text-muted border-border'}`}
        >Record mic</button>
        <button
          onClick={() => setTab('tts')}
          disabled={!hasElevenLabs}
          title={!hasElevenLabs ? 'Add ElevenLabs API key in Settings' : ''}
          className={`py-1 px-2.5 rounded border cursor-pointer disabled:opacity-40 ${tab === 'tts' ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]' : 'bg-white text-muted border-border'}`}
        >AI voice (ElevenLabs)</button>
      </div>

      {/* Single video monitor — used for:
          1. Muted playback during recording (narrate to picture)
          2. Synced preview with recorded/generated audio
          Hidden audio element drives playback in preview mode. */}
      {monitorSrc && (
        <div className="space-y-1.5">
          <div className="relative rounded border border-border overflow-hidden bg-black" style={{ maxHeight: 220 }}>
            <video
              ref={monitorRef}
              src={monitorSrc}
              muted
              playsInline
              preload="auto"
              controls={!!audioUrl && !recording}
              className="w-full max-h-[220px] object-contain"
              onLoadedMetadata={e => {
                setMonitorDuration(e.target.duration)
                // Seek to trim start so the video shows the trimmed portion
                try { e.target.currentTime = monitorTrimStart } catch {}
              }}
              onPlay={() => {
                const v = monitorRef.current
                if (!v) return
                const start = monitorTrimStart
                const end = monitorTrimEnd ?? (v.duration || Infinity)
                // Clamp to trim range on play
                if (v.currentTime < start || v.currentTime >= end - 0.05) {
                  try { v.currentTime = start } catch {}
                }
                // Sync voiceover audio (primary). Respect the primary start
                // delay — play only when video reaches that time.
                const outputT = Math.max(0, (v.currentTime || 0) - start)
                const pStart = Number(primaryStartTime) || 0
                // Reset fire state. The flag is only set true via the audio
                // element's 'playing' event (wired below), so if play() is
                // rejected (autoplay policy, codec not ready), onTimeUpdate
                // will retry on the next tick instead of silently failing.
                primaryFiredRef.current = false
                if (audioUrl && audioPreviewRef.current) {
                  try { audioPreviewRef.current.pause(); audioPreviewRef.current.currentTime = 0 } catch {}
                  if (outputT >= pStart - 0.01) {
                    try { audioPreviewRef.current.currentTime = Math.max(0, outputT - pStart) } catch {}
                    const p = audioPreviewRef.current.play()
                    if (p && typeof p.catch === 'function') p.catch(() => {})
                  }
                }
                // Reset segment fired-state so they can trigger this playthrough.
                segFiredRef.current.clear()
                for (const s of segments) {
                  if ((Number(s.startTime) || 0) < outputT) segFiredRef.current.add(s.id)
                }
                setPreviewing(true)
              }}
              onPause={() => {
                if (audioPreviewRef.current) try { audioPreviewRef.current.pause() } catch {}
                for (const a of segAudioMapRef.current.values()) { try { a.pause() } catch {} }
                setPreviewing(false)
              }}
              onSeeked={() => {
                const v = monitorRef.current
                if (!v) return
                const start = monitorTrimStart
                const end = monitorTrimEnd ?? (v.duration || Infinity)
                // Clamp seek to trim range
                if (v.currentTime < start) try { v.currentTime = start } catch {}
                else if (v.currentTime >= end) try { v.currentTime = Math.max(start, end - 0.1) } catch {}
                // Sync voiceover audio (primary)
                if (audioUrl && audioPreviewRef.current) {
                  const outputTime = Math.max(0, (v.currentTime || 0) - start)
                  try { audioPreviewRef.current.currentTime = Math.min(outputTime, audioPreviewRef.current.duration || 999) } catch {}
                }
                // Re-evaluate segment fired-state after seek: anything before
                // the new position is marked fired (suppressed), anything after is fresh.
                const outputT = Math.max(0, (v.currentTime || 0) - start)
                segFiredRef.current.clear()
                for (const s of segments) {
                  if ((Number(s.startTime) || 0) < outputT - 0.05) segFiredRef.current.add(s.id)
                }
                // Pause any currently-playing segment so it doesn't continue out of context
                for (const a of segAudioMapRef.current.values()) { try { a.pause(); a.currentTime = 0 } catch {} }
              }}
              onTimeUpdate={e => {
                const v = e.target
                // Enforce trim bounds — clamp to [trimStart, trimEnd]
                const start = monitorTrimStart
                const end = monitorTrimEnd ?? (v.duration || Infinity)
                if (v.currentTime >= end - 0.03) {
                  try { v.currentTime = start; v.pause() } catch {}
                  if (audioPreviewRef.current) try { audioPreviewRef.current.pause(); audioPreviewRef.current.currentTime = 0 } catch {}
                  resetSegmentPlayback()
                  setPreviewing(false)
                } else if (v.currentTime < start - 0.05) {
                  try { v.currentTime = start } catch {}
                } else {
                  const outputT = Math.max(0, v.currentTime - start)
                  // Fire the primary voiceover when its start time arrives
                  const pStart = Number(primaryStartTime) || 0
                  // Retry the primary audio only if it hasn't fired yet this
                  // playthrough. primaryFiredRef flips true on the audio's
                  // 'playing' event (see onPlaying handler below), so once
                  // playback really started we stop retrying — otherwise the
                  // post-ended state (.paused=true, .ended=true) would loop
                  // the voiceover for the rest of the video.
                  if (
                    audioUrl &&
                    audioPreviewRef.current &&
                    outputT >= pStart &&
                    !primaryFiredRef.current &&
                    audioPreviewRef.current.paused &&
                    !audioPreviewRef.current.ended
                  ) {
                    try {
                      audioPreviewRef.current.currentTime = Math.max(0, outputT - pStart)
                      const p = audioPreviewRef.current.play()
                      if (p && typeof p.catch === 'function') p.catch(() => {})
                    } catch {}
                  }
                  // Fire any timed segments whose startTime has now arrived
                  maybeFireSegments(outputT)
                }
              }}
            />
            {/* Recording overlay badge */}
            {recording && (
              <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-[#c0392b] text-white text-[10px] font-medium rounded-full px-2 py-0.5">
                <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                REC {recordTime.toFixed(1)}s
              </div>
            )}
            {/* "Has audio" badge when previewing */}
            {!recording && (audioUrl || segments.some(s => s.blob)) && (
              <div className="absolute top-2 left-2 text-[9px] text-white bg-[#2D9A5E]/80 rounded-full px-2 py-0.5">
                With voiceover
              </div>
            )}
            {/* "Press record" hint — only shows on the mic-recording tab when
                no primary audio exists yet. Irrelevant on the AI voice tab or
                once any voiceover (primary or a segment) has been generated. */}
            {!recording && !audioUrl && tab === 'record' && !segments.some(s => s.blob) && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <span className="text-white text-[11px] bg-black/60 rounded-full px-3 py-1">Press record — video will play muted while you narrate</span>
              </div>
            )}
            {/* "Playing" indicator when audio is playing synced with video */}
            {!recording && audioUrl && previewing && (
              <div className="absolute top-2 right-2 text-[9px] text-white bg-[#2D9A5E]/80 rounded-full px-2 py-0.5 pointer-events-none">
                Playing with voiceover
              </div>
            )}
          </div>
          {/* Playhead bar */}
          {monitorDuration > 0 && (
            <div className="relative h-2 bg-[#e5e5e5] rounded overflow-hidden">
              <div
                className="absolute top-0 bottom-0 bg-[#2D9A5E]/20"
                style={{
                  left: `${(monitorTrimStart / monitorDuration) * 100}%`,
                  width: `${(((monitorTrimEnd ?? monitorDuration) - monitorTrimStart) / monitorDuration) * 100}%`,
                }}
              />
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-[#c0392b]"
                style={{ left: `${(((recording || previewing) ? monitorTime : monitorTrimStart) / monitorDuration) * 100}%` }}
              />
            </div>
          )}
          {/* Hidden audio companion — plays voiceover synced with the video.
              iOS requires the element to be in the DOM and not display:none,
              so we make it 1px tall and transparent. The video controls drive
              play/pause/seek and the audio follows. */}
          {audioUrl && (
            <audio
              ref={audioPreviewRef}
              src={audioUrl}
              playsInline
              preload="auto"
              onPlaying={() => { primaryFiredRef.current = true }}
              onPause={() => { /* user or code pause — leave fired state alone */ }}
              onEnded={() => {
                // Audio finished but video may still be playing — that's fine,
                // the rest of the video plays with just original audio (muted
                // in this monitor, but will have it in the final render).
              }}
              style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
            />
          )}
        </div>
      )}

      {/* Record tab controls */}
      {tab === 'record' && (
        <div className="flex items-center gap-2 flex-wrap">
          {!recording ? (
            <button
              onClick={startRecording}
              className="text-[11px] py-1.5 px-3 bg-[#c0392b] text-white rounded border-none cursor-pointer font-sans"
            >{audioUrl ? 'Re-record' : 'Start recording'}</button>
          ) : (
            <button
              onClick={stopRecording}
              className="text-[11px] py-1.5 px-3 bg-[#c0392b] text-white rounded border-none cursor-pointer font-sans animate-pulse"
            >Stop recording</button>
          )}
          {recording && (
            <span className="text-[10px] text-muted">
              {recordTime.toFixed(1)}s / {((monitorTrimEnd ?? monitorDuration) - monitorTrimStart).toFixed(1)}s
            </span>
          )}
          {audioUrl && !recording && (
            <button
              onClick={() => { setAudioBlob(null); if (audioUrl) URL.revokeObjectURL(audioUrl); setAudioUrl(null); for (const vf of videoFiles) delete vf._voiceoverBlob; try { window.dispatchEvent(new CustomEvent('posty-voiceover-change')) } catch {} }}
              className="text-[9px] text-muted hover:underline bg-transparent border-none cursor-pointer"
            >Discard</button>
          )}
        </div>
      )}

      {/* TTS tab controls */}
      {tab === 'tts' && hasElevenLabs && (
        <div className="space-y-2">
          {/* Voice picker */}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[10px] text-muted">Voice:</label>
            {voices.length > 0 ? (
              <select
                value={selectedVoice}
                onChange={e => { setSelectedVoice(e.target.value); localStorage.setItem('posty_tts_voice', e.target.value) }}
                className="text-[10px] border border-border rounded py-1 px-1.5 bg-white flex-1 min-w-[120px]"
              >
                {voices.map(v => (
                  <option key={v.voice_id} value={v.voice_id}>{v.name}{v.category ? ` (${v.category})` : ''}</option>
                ))}
              </select>
            ) : (
              <span className="text-[10px] text-muted">{voicesLoaded ? 'No voices found' : 'Loading voices...'}</span>
            )}
            {/* Preview voice button */}
            {selectedVoice && voices.length > 0 && (() => {
              const v = voices.find(v => v.voice_id === selectedVoice)
              if (!v?.preview_url) return null
              return (
                <button
                  type="button"
                  onClick={() => {
                    const a = new Audio(v.preview_url)
                    a.play().catch(() => {})
                  }}
                  className="text-[9px] text-[#6C5CE7] hover:underline bg-transparent border-none cursor-pointer"
                  title="Listen to a sample of this voice"
                >Preview</button>
              )
            })()}
          </div>
          {/* Script length preset — guides AI Suggest/Review so TikTok-style
              punchy lines are the default, not wordy blog narration. */}
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[10px] text-muted">Length:</label>
            <select
              value={segmentLength}
              onChange={e => setSegmentLength(e.target.value)}
              className="text-[10px] border border-border rounded py-1 px-1.5 bg-white"
              title="Guides AI Suggest/Review: Short = punchy TikTok (3-6 words). Medium = natural phrase. Long = full sentence."
            >
              <option value="short">Short (punchy, 3-6 words)</option>
              <option value="medium">Medium (6-12 words)</option>
              <option value="long">Long (12-20 words)</option>
            </select>
            <span className="text-[9px] text-muted">used by AI Suggest / Review</span>
          </div>
          {/* Voice settings — matches ElevenLabs GUI sliders */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
            <div className="flex items-center gap-1">
              <label className="text-muted w-14">Stability</label>
              <input type="range" min={0} max={1} step={0.01} value={ttsStability} onChange={e => setTtsStability(Number(e.target.value))} className="flex-1 accent-[#6C5CE7]" />
              <span className="text-muted w-8 text-right">{Math.round(ttsStability * 100)}%</span>
            </div>
            <div className="flex items-center gap-1">
              <label className="text-muted w-14">Clarity</label>
              <input type="range" min={0} max={1} step={0.01} value={ttsSimilarity} onChange={e => setTtsSimilarity(Number(e.target.value))} className="flex-1 accent-[#6C5CE7]" />
              <span className="text-muted w-8 text-right">{Math.round(ttsSimilarity * 100)}%</span>
            </div>
            <div className="flex items-center gap-1">
              <label className="text-muted w-14">Style</label>
              <input type="range" min={0} max={1} step={0.01} value={ttsStyle} onChange={e => setTtsStyle(Number(e.target.value))} className="flex-1 accent-[#6C5CE7]" />
              <span className="text-muted w-8 text-right">{Math.round(ttsStyle * 100)}%</span>
            </div>
            <div className="flex items-center gap-1">
              <label className="text-muted w-14">Boost</label>
              <input type="checkbox" checked={ttsSpeakerBoost} onChange={e => setTtsSpeakerBoost(e.target.checked)} className="accent-[#6C5CE7]" />
              <span className="text-muted">Speaker boost</span>
            </div>
            <div className="flex items-center gap-1 col-span-2">
              <label className="text-muted w-14" title="Speech speed. 1.0 = natural. Bump to 1.05–1.15 for punchier TikTok/Reels hooks (the first second matters).">Speed</label>
              <input type="range" min={0.7} max={1.2} step={0.01} value={ttsSpeed} onChange={e => setTtsSpeed(Number(e.target.value))} className="flex-1 accent-[#6C5CE7]" />
              <span className="text-muted w-10 text-right">{ttsSpeed.toFixed(2)}x</span>
            </div>
          </div>
          {/* AI hook helper — generates options you can review & insert into the
              voiceover text. Nothing auto-fills, nothing auto-sends to ElevenLabs. */}
          <div className="border border-border rounded p-1.5 bg-cream/30 space-y-1">
            <div className="flex items-center gap-1 flex-wrap">
              <label className="text-[10px] text-muted">Hook style:</label>
              <select
                value={hookCategoryName}
                onChange={e => setHookCategoryName(e.target.value)}
                className="text-[10px] border border-border rounded py-0.5 px-1 bg-white flex-1 min-w-[100px]"
              >
                <option value="">— pick a style —</option>
                {hookCategories.map(c => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              <label className="text-[10px] text-muted flex items-center gap-1">
                <input type="checkbox" checked={hookIncludeBody} onChange={e => setHookIncludeBody(e.target.checked)} className="accent-[#6C5CE7]" />
                + body
              </label>
              <button
                type="button"
                onClick={generateHook}
                disabled={hookLoading || (!hookCategoryName && !hookHint.trim())}
                className="text-[10px] py-0.5 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
                title="Generate hook options — nothing is sent to ElevenLabs yet"
              >{hookLoading ? 'Thinking…' : 'Generate hooks'}</button>
            </div>
            <input
              value={hookHint}
              onChange={e => setHookHint(e.target.value)}
              placeholder="What's in this video? (helps the AI write a relevant hook)"
              className="w-full text-[10px] border border-border rounded py-0.5 px-1.5 bg-white"
            />
            {hookOptions.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-border/60">
                <div className="flex items-center gap-1 text-[10px] text-muted">
                  <span>Option {hookIdx + 1} of {hookOptions.length}</span>
                  {hookOptions.length > 1 && (
                    <button type="button" onClick={cycleHook} className="text-[#6C5CE7] hover:underline bg-transparent border-none cursor-pointer p-0">Next ›</button>
                  )}
                  <span className="ml-auto text-muted/70">Review, then insert</span>
                </div>
                <div className="text-[11px] bg-white border border-border rounded p-1.5 italic text-foreground/90">
                  "{hookOptions[hookIdx]}"
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <button
                    type="button"
                    onClick={() => insertIntoTts(hookOptions[hookIdx])}
                    className="text-[10px] py-0.5 px-2 bg-[#2D9A5E] text-white border-none rounded cursor-pointer"
                    title="Insert at cursor (or prepend if textarea isn't focused)"
                  >Insert into voiceover</button>
                  <button
                    type="button"
                    onClick={() => { setTtsText(hookOptions[hookIdx]); requestAnimationFrame(() => ttsRef.current?.focus()) }}
                    className="text-[10px] py-0.5 px-2 bg-white text-[#6C5CE7] border border-[#6C5CE7] rounded cursor-pointer"
                    title="Replace the entire voiceover text with this option"
                  >Replace</button>
                </div>
              </div>
            )}
          </div>
          {/* Script import / export / review toolbar */}
          <div className="flex items-center gap-1 flex-wrap text-[10px]">
            <button
              type="button"
              onClick={() => { setPasteInput(''); setScriptModalOpen('paste') }}
              className="py-0.5 px-2 bg-white text-[#6C5CE7] border border-[#6C5CE7] rounded cursor-pointer hover:bg-[#f3f0ff]"
              title="Paste a timestamped script — auto-fills primary + timed segments"
            >📋 Paste script</button>
            <button
              type="button"
              onClick={exportCurrentScript}
              className="py-0.5 px-2 bg-white text-muted border border-border rounded cursor-pointer hover:bg-cream"
              title="Copy the current script (primary + all segments) to the clipboard"
            >Export</button>
            <button
              type="button"
              onClick={reviewCurrentScript}
              disabled={reviewing}
              className="py-0.5 px-2 bg-white text-[#2D9A5E] border border-[#2D9A5E] rounded cursor-pointer hover:bg-[#f0faf4] disabled:opacity-50"
              title="Ask Claude if the current script is hookworthy. No changes made."
            >{reviewing ? 'Reviewing…' : '⚡ Review'}</button>
            {savedReview?.result && (
              <button
                type="button"
                onClick={viewSavedReview}
                className="py-0.5 px-2 bg-white text-muted border border-border rounded cursor-pointer hover:bg-cream"
                title={`Last reviewed ${savedReview.reviewedAt ? new Date(savedReview.reviewedAt).toLocaleString() : ''} — saved with the draft`}
              >View last review ({savedReview.result.score ?? '–'})</button>
            )}
            <button
              type="button"
              onClick={copyScriptPrompt}
              className="py-0.5 px-2 text-[#6C5CE7] hover:underline bg-transparent border-none cursor-pointer"
              title="Copy a ready-to-paste prompt for ChatGPT/Claude that produces a compatible script"
            >Get ChatGPT prompt</button>
            <button
              type="button"
              onClick={suggestSegmentsFromVideo}
              disabled={suggesting}
              className="py-0.5 px-2 bg-white text-[#6C5CE7] border border-[#6C5CE7] rounded cursor-pointer hover:bg-[#f3f0ff] disabled:opacity-50"
              title="Claude looks at the video frames and writes segments anchored to what's on screen"
            >{suggesting ? '…' : '🎬 Suggest from video'}</button>
            <button
              type="button"
              onClick={downloadReviewBundle}
              disabled={bundling}
              className="py-0.5 px-2 bg-white text-muted border border-border rounded cursor-pointer hover:bg-cream disabled:opacity-50"
              title="Download a .zip with script.txt + frames/ + prompt.txt for ChatGPT/Gemini"
            >{bundling ? 'Zipping…' : '📦 Bundle for other AI'}</button>
          </div>
          <textarea
            ref={ttsRef}
            rows={3}
            value={ttsText}
            onChange={e => setTtsText(e.target.value)}
            placeholder="Type what the voiceover should say... or insert an AI hook above. Edit freely — nothing is sent to ElevenLabs until you click Generate voice."
            className="w-full text-[11px] border border-border rounded py-1 px-2 bg-white resize-none"
          />
          {/* Phantom-audio warning: audio exists but text is empty. The new
              sync effect already suppresses it from preview/export, but the
              user needs a way to either recover or permanently discard it. */}
          {!ttsText.trim() && audioUrl && (
            <div className="text-[10px] bg-[#fff3cd] text-[#664d03] border border-[#ffe69c] rounded px-2 py-1.5 space-y-1.5">
              <p>⚠ A primary voiceover audio exists but the text isn't saved with the draft. Play it to hear what it says, then either retype the text and Regenerate, or discard it.</p>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const a = new Audio(audioUrl)
                      a.play().catch(err => alert('Playback blocked: ' + err.message))
                    } catch (e) { alert('Play failed: ' + e.message) }
                  }}
                  className="text-[10px] py-1 px-2.5 bg-white text-[#6C5CE7] border border-[#6C5CE7] rounded cursor-pointer"
                >▶ Play orphaned audio</button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm('Permanently discard this primary voiceover audio?')) return
                    setAudioBlob(null)
                    if (audioUrl) { try { URL.revokeObjectURL(audioUrl) } catch {} }
                    setAudioUrl(null)
                    for (const vf of videoFiles) delete vf._voiceoverBlob
                    try { window.dispatchEvent(new CustomEvent('posty-voiceover-change')) } catch {}
                    // Clear the storage link on the backend so the orphan
                    // doesn't come back on the next draft resume.
                    console.log('[discard] jobId=', jobId)
                    if (!jobId) {
                      alert('This draft has no saved job id yet — save it first, then try Discard again.')
                      return
                    }
                    try {
                      const r = await api.updateJob(jobId, { clear_voiceover_audio: true })
                      console.log('[discard] server response:', r)
                      if (r && r.error) throw new Error(r.error)
                      if (onFlushSave) await onFlushSave().catch(() => {})
                      alert('Orphan audio discarded. Saved to the server.')
                    } catch (e) {
                      console.error('[discard] failed to clear on server:', e)
                      alert('Discard saved locally but failed on server: ' + e.message + '\n\nIt may come back on reload.')
                    }
                  }}
                  className="text-[10px] py-1 px-2.5 bg-[#c0392b] text-white border-none rounded cursor-pointer"
                >Discard</button>
              </div>
            </div>
          )}
          {/* Paste-script modal */}
          {scriptModalOpen === 'paste' && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3" onClick={() => setScriptModalOpen(null)}>
              <div className="bg-white rounded-sm p-4 max-w-xl w-full max-h-[90vh] overflow-y-auto space-y-2" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-medium">Paste voiceover script</h3>
                  <button onClick={() => setScriptModalOpen(null)} className="text-muted bg-transparent border-none cursor-pointer text-lg leading-none">×</button>
                </div>
                <p className="text-[10px] text-muted">Accepts <code className="bg-cream px-1 rounded">[0:00] line</code>, <code className="bg-cream px-1 rounded">0:05 line</code>, JSON, or SRT. Timestamped from ChatGPT/Claude works directly.</p>
                <textarea
                  autoFocus
                  rows={10}
                  value={pasteInput}
                  onChange={e => setPasteInput(e.target.value)}
                  placeholder={`[0:00] Welcome to Poppy & Thyme\n[0:04] First, pick your signature scent\n[0:09] Then blend your own`}
                  className="w-full text-[11px] border border-border rounded py-1.5 px-2 bg-white font-mono"
                />
                {pastePreview.length > 0 && (
                  <div className="border border-border rounded p-2 bg-cream/40">
                    <div className="text-[10px] font-medium text-ink mb-1">Preview — {pastePreview.length} line{pastePreview.length > 1 ? 's' : ''}</div>
                    <ul className="space-y-0.5 text-[10px]">
                      {pastePreview.map((p, i) => (
                        <li key={i}>
                          <span className="text-[#6C5CE7] font-mono mr-1">[{String(Math.floor(p.startTime / 60)).padStart(1, '0')}:{String(Math.floor(p.startTime % 60)).padStart(2, '0')}]</span>
                          <span className="text-ink">{p.text}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[9px] text-muted mt-1">
                      First line @ ≤0.5s becomes the primary voiceover; rest become timed segments.
                    </p>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={applyPastedScript}
                    disabled={pastePreview.length === 0}
                    className="text-[11px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
                  >Apply {pastePreview.length > 0 ? `(${pastePreview.length})` : ''}</button>
                  <button onClick={() => setScriptModalOpen(null)} className="text-[11px] py-1.5 px-3 border border-border rounded bg-white cursor-pointer">Cancel</button>
                  <span className="text-[9px] text-muted">Replaces current primary + all segments. Regenerate voices after.</span>
                </div>
              </div>
            </div>
          )}
          {/* Review-result modal */}
          {/* Suggest-segments-from-video modal */}
          {scriptModalOpen === 'suggest' && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3" onClick={() => setScriptModalOpen(null)}>
              <div className="bg-white rounded-sm p-4 max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-2" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-medium">🎬 Suggest segments from video</h3>
                  <button onClick={() => setScriptModalOpen(null)} className="text-muted bg-transparent border-none cursor-pointer text-lg leading-none">×</button>
                </div>
                {suggesting && (
                  <div className="bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded p-3 flex items-start gap-2">
                    {/* Spinner — visible motion so the user knows it's not frozen.
                        Claude vision + 3 candidates can take 15-25s. */}
                    <svg className="w-4 h-4 text-[#6C5CE7] flex-shrink-0 mt-0.5 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-ink font-medium">
                        {suggestResult?.progress || 'Working…'}
                      </div>
                      <div className="text-[9px] text-muted mt-0.5">
                        Reading video frames · extracting payoff · writing 3 candidate scripts. Usually 15–25 seconds.
                      </div>
                      {/* Elapsed timer so the user can tell time is passing even
                          when the server is working quietly. */}
                      <SuggestElapsed key={suggesting ? 'on' : 'off'} />
                    </div>
                  </div>
                )}
                {!suggesting && suggestResult?.error && (
                  <p className="text-[11px] text-[#c0392b]">Error: {suggestResult.error}</p>
                )}
                {/* Captured frames thumbnails */}
                {Array.isArray(suggestResult?._frames) && suggestResult._frames.some(f => f.dataUrl) && (
                  <div className="border-t border-border pt-1.5">
                    <div className="text-[10px] font-medium text-ink mb-1">Frames Claude saw</div>
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {suggestResult._frames.map((f, i) => f.dataUrl ? (
                        <div key={i} className="flex-shrink-0 text-center">
                          <img src={f.dataUrl} alt={f.label || `frame ${i}`} className="w-[70px] h-[110px] object-cover rounded border border-border" />
                          <div className="text-[8px] text-muted mt-0.5 w-[70px] truncate" title={f.label || ''}>{f.label || `${f.startTime?.toFixed(1)}s`}</div>
                        </div>
                      ) : null)}
                    </div>
                  </div>
                )}
                {!suggesting && suggestResult && (Array.isArray(suggestResult.candidates) ? suggestResult.candidates.length > 0 : Array.isArray(suggestResult.segments) && suggestResult.segments.length > 0) && (() => {
                  // Prefer the ranked candidates list, fall back to legacy shape.
                  const cands = Array.isArray(suggestResult.candidates) && suggestResult.candidates.length > 0
                    ? suggestResult.candidates
                    : [{
                        variant: 'single',
                        mode: suggestResult.mode,
                        segments: suggestResult.segments,
                        overlays: suggestResult.overlays,
                        rationale: suggestResult.rationale,
                        scores: null,
                      }]
                  const safeIdx = Math.min(cands.length - 1, Math.max(0, selectedCandidateIdx))
                  const chosen = cands[safeIdx]
                  const winnerIdx = Number.isInteger(suggestResult.winner_index) ? suggestResult.winner_index : 0
                  const pe = suggestResult.payoff_extracted
                  return (
                    <>
                      {/* Scene context — shows who Claude thinks is in the video so
                          the user can catch mismatches (e.g. "two people" when it's
                          a teen group of 5) BEFORE reading the scripts. */}
                      {suggestResult.scene_context && typeof suggestResult.scene_context === 'object' && (
                        <div className="border-t border-border pt-1.5">
                          <div className="text-[10px] font-medium text-[#6C5CE7] mb-1">Claude sees in the video</div>
                          <div className="bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded p-2 text-[10px] text-ink">
                            <div>
                              <b>{suggestResult.scene_context.group_type || '—'}</b>
                              {suggestResult.scene_context.group_size_count != null && (
                                <> ({suggestResult.scene_context.group_size_count} {suggestResult.scene_context.group_size_count === 1 ? 'person' : 'people'})</>
                              )}
                              {suggestResult.scene_context.age_range && <> · {suggestResult.scene_context.age_range}</>}
                              {suggestResult.scene_context.energy && <> · {suggestResult.scene_context.energy}</>}
                            </div>
                            {suggestResult.scene_context.audience && (
                              <div className="mt-0.5">
                                <span className="text-muted">Audience tone: </span>
                                <b className="text-[#6C5CE7]">{suggestResult.scene_context.audience}</b>
                                {suggestResult.scene_context.audience_was_overridden && (
                                  <span className="text-muted italic"> · operator override</span>
                                )}
                              </div>
                            )}
                            {Array.isArray(suggestResult.scene_context.occasion_signals) && suggestResult.scene_context.occasion_signals.length > 0 && (
                              <div className="text-muted mt-0.5">
                                Occasion signals: {suggestResult.scene_context.occasion_signals.join(', ')}
                              </div>
                            )}
                            <div className="text-[9px] text-muted mt-1 italic">
                              If this is wrong, pick an audience from the dropdown below and regenerate.
                            </div>
                          </div>
                        </div>
                      )}
                      {/* Payoff extraction — gives the user transparency into what
                          angles Claude pulled from the business insights */}
                      {pe && typeof pe === 'object' && (pe.emotional_payoff || pe.unique_differentiator || pe.surprising_claim || pe.identity_angle) && (
                        <div className="border-t border-border pt-1.5">
                          <div className="text-[10px] font-medium text-[#2D9A5E] mb-1">Payoff angles Claude extracted</div>
                          <div className="bg-[#f0fdf4] border border-[#2D9A5E]/30 rounded p-2 space-y-0.5 text-[10px]">
                            {pe.emotional_payoff && <div><span className="text-[#2D9A5E] font-medium">Emotional payoff:</span> {pe.emotional_payoff}</div>}
                            {pe.unique_differentiator && <div><span className="text-[#2D9A5E] font-medium">Differentiator:</span> {pe.unique_differentiator}</div>}
                            {pe.surprising_claim && <div><span className="text-[#2D9A5E] font-medium">Surprising claim:</span> {pe.surprising_claim}</div>}
                            {pe.identity_angle && <div><span className="text-[#2D9A5E] font-medium">Identity angle:</span> {pe.identity_angle}</div>}
                          </div>
                        </div>
                      )}
                      {/* Candidate tabs — click to preview each variant */}
                      {cands.length > 1 && (
                        <div className="border-t border-border pt-1.5">
                          <div className="text-[10px] font-medium text-[#6C5CE7] mb-1">Pick a variant ({cands.length} candidates, ranked)</div>
                          <div className="flex gap-1 flex-wrap">
                            {cands.map((c, i) => {
                              const active = i === safeIdx
                              const isWinner = i === winnerIdx
                              return (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => setSelectedCandidateIdx(i)}
                                  className={`text-[10px] py-1 px-2 rounded border ${active ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]' : 'bg-white text-ink border-border'} cursor-pointer`}
                                  title={c.rationale || ''}
                                >
                                  <span className="uppercase tracking-wide">{c.variant || `#${i + 1}`}</span>
                                  {c.scores?.total != null && <span className="ml-1 font-mono">{c.scores.total}/100</span>}
                                  {isWinner && <span className="ml-1">★</span>}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      {chosen?.rationale && (
                        <p className="text-[11px] text-ink italic bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded p-2">Hook angle: {chosen.rationale}</p>
                      )}
                      {/* Rubric scores for the selected candidate */}
                      {chosen?.scores && typeof chosen.scores === 'object' && (
                        <div className="border-t border-border pt-1 grid grid-cols-3 gap-x-2 gap-y-0.5 text-[9px] text-muted">
                          <div>Hook: <b className="text-ink">{chosen.scores.hook_strength}/25</b></div>
                          <div>Payoff: <b className="text-ink">{chosen.scores.payoff_clarity}/20</b></div>
                          <div>Non-redundant: <b className="text-ink">{chosen.scores.non_redundancy}/15</b></div>
                          <div>Timing: <b className="text-ink">{chosen.scores.timing_fit}/15</b></div>
                          <div>TikTok-native: <b className="text-ink">{chosen.scores.tiktok_native}/15</b></div>
                          <div>TTS natural: <b className="text-ink">{chosen.scores.tts_naturalness}/10</b></div>
                        </div>
                      )}
                      <div className="flex gap-3 flex-wrap text-[9px] text-muted">
                        {chosen?.dominant_payoff && (
                          <div>
                            Dominant payoff: <b className="text-ink">{chosen.dominant_payoff}</b>
                            {chosen.dominant_payoff === 'longevity' && <span className="ml-1">(still using it after)</span>}
                            {chosen.dominant_payoff === 'identity' && <span className="ml-1">(you made yours)</span>}
                            {chosen.dominant_payoff === 'social' && <span className="ml-1">(group moment)</span>}
                            {chosen.dominant_payoff === 'memory' && <span className="ml-1">(smell of the day)</span>}
                          </div>
                        )}
                        {chosen?.cta_mode && (
                          <div>
                            CTA: <b className="text-ink">{String(chosen.cta_mode).replace(/_/g, ' ')}</b>
                            {chosen.cta_mode === 'creative_first' && <span className="ml-1">(URL in caption, not VO)</span>}
                            {chosen.cta_mode === 'caption_carries_cta' && <span className="ml-1">(caption carries URL)</span>}
                            {chosen.cta_mode === 'soft_cta' && <span className="ml-1">(brand surfaces gently)</span>}
                            {chosen.cta_mode === 'hard_cta' && <span className="ml-1">(direct URL in VO)</span>}
                          </div>
                        )}
                      </div>
                      <div className="border-t border-border pt-1.5">
                        <div className="text-[10px] font-medium text-[#6C5CE7] mb-1">
                          {chosen?.mode === 'continuous' || (chosen?.segments || []).length === 1
                            ? 'Proposed voiceover (continuous — single track over full video)'
                            : `Proposed segments (${(chosen?.segments || []).length}, timed)`}
                        </div>
                        <div className="bg-cream border border-border rounded p-2 space-y-0.5 max-h-[200px] overflow-y-auto">
                          {(chosen?.segments || []).map((s, i) => (
                            <div key={i} className="text-[10px]">
                              <span className="text-[#6C5CE7] font-mono mr-1">[{String(Math.floor((Number(s.startTime) || 0) / 60)).padStart(1, '0')}:{String(Math.floor((Number(s.startTime) || 0) % 60)).padStart(2, '0')}]</span>
                              <span className="text-ink">{s.text}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {chosen?.overlays && (chosen.overlays.opening || chosen.overlays.middle || chosen.overlays.closing) && (
                        <div className="border-t border-border pt-1.5">
                          <div className="text-[10px] font-medium text-[#d97706] mb-1">On-screen captions (scroll-stoppers)</div>
                          <div className="bg-[#fef3c7] border border-[#d97706]/40 rounded p-2 space-y-1">
                            {chosen.overlays.opening && (
                              <div className="text-[10px]">
                                <span className="text-[#92400e] font-medium mr-1">OPENING:</span>
                                <span className="text-ink font-bold">{chosen.overlays.opening}</span>
                              </div>
                            )}
                            {chosen.overlays.middle && (
                              <div className="text-[10px]">
                                <span className="text-[#92400e] font-medium mr-1">
                                  MIDDLE{chosen.overlays.middleStartTime != null ? ` @ ${Number(chosen.overlays.middleStartTime).toFixed(1)}s` : ''}:
                                </span>
                                <span className="text-ink font-bold">{chosen.overlays.middle}</span>
                              </div>
                            )}
                            {chosen.overlays.closing && (
                              <div className="text-[10px]">
                                <span className="text-[#92400e] font-medium mr-1">CLOSING:</span>
                                <span className="text-ink font-bold">{chosen.overlays.closing}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )
                })()}
                {/* Style + length + audience inputs for next run. The audience
                    override skips auto-detection and forces a tone register. */}
                <div className="pt-1 flex items-center gap-2 flex-wrap">
                  <label className="text-[10px] text-muted">Audience:</label>
                  <select
                    value={audienceOverride}
                    onChange={e => setAudienceOverride(e.target.value)}
                    className="text-[10px] border border-border rounded py-1 px-1.5 bg-white"
                    title="Auto = let Claude read the frames. Any other value forces that audience's tone register regardless of frames."
                  >
                    <option value="auto">Auto-detect</option>
                    <option value="teens">Teens / friend group</option>
                    <option value="young_adults">Young adults (girls' night)</option>
                    <option value="date_night">Date night</option>
                    <option value="kids_birthday">Kids birthday</option>
                    <option value="adults">Adults (creative outing)</option>
                    <option value="solo">Solo / personal</option>
                    <option value="mixed">Mixed / universal</option>
                  </select>
                  <label className="text-[10px] text-muted">Length:</label>
                  <select
                    value={segmentLength}
                    onChange={e => setSegmentLength(e.target.value)}
                    className="text-[10px] border border-border rounded py-1 px-1.5 bg-white"
                    title="Short = punchy TikTok lines. Medium = natural phrase. Long = fuller sentence."
                  >
                    <option value="short">Short (punchy)</option>
                    <option value="medium">Medium</option>
                    <option value="long">Long</option>
                  </select>
                  <input
                    type="text"
                    value={suggestStyle}
                    onChange={e => setSuggestStyle(e.target.value)}
                    placeholder="Optional style: playful, dramatic, educational…"
                    className="flex-1 min-w-[140px] text-[10px] border border-border rounded py-1 px-1.5 bg-white"
                  />
                  <button
                    type="button"
                    onClick={suggestSegmentsFromVideo}
                    disabled={suggesting}
                    className="text-[10px] py-1 px-2.5 bg-white text-[#6C5CE7] border border-[#6C5CE7] rounded cursor-pointer disabled:opacity-50"
                  >Regenerate</button>
                </div>
                <div className="pt-1 flex items-center gap-2">
                  {!suggesting && (Array.isArray(suggestResult?.candidates)
                    ? suggestResult.candidates.length > 0
                    : Array.isArray(suggestResult?.segments) && suggestResult.segments.length > 0) && (
                    <>
                      <button
                        onClick={() => {
                          if (!confirm("Replace your current script with the selected candidate?\n\nClears existing audio — click Generate voices after.")) return
                          applySuggestedSegments()
                        }}
                        className="text-[11px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer"
                      >Apply selected variant</button>
                      <button
                        onClick={async () => {
                          const text = formatSuggestResultForChat(suggestResult)
                          try {
                            await navigator.clipboard.writeText(text)
                            alert(`Copied ${text.length.toLocaleString()} characters — paste into ChatGPT / Claude for review.`)
                          } catch {
                            window.prompt('Copy this for chat review:', text)
                          }
                        }}
                        className="text-[11px] py-1.5 px-3 bg-white text-[#6C5CE7] border border-[#6C5CE7] rounded cursor-pointer"
                        title="Copy payoff angles + all 3 variants + scores + segments + overlays to clipboard so you can paste into ChatGPT/Claude for critique."
                      >📋 Copy for chat review</button>
                    </>
                  )}
                  <button onClick={() => setScriptModalOpen(null)} className="text-[10px] py-1 px-3 border border-border rounded bg-white cursor-pointer">Close</button>
                </div>
              </div>
            </div>
          )}
          {scriptModalOpen === 'review' && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3" onClick={() => setScriptModalOpen(null)}>
              <div className="bg-white rounded-sm p-4 max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-2" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-medium">⚡ Script review</h3>
                  <button onClick={() => setScriptModalOpen(null)} className="text-muted bg-transparent border-none cursor-pointer text-lg leading-none">×</button>
                </div>
                {/* Stale banner — shows when the viewed review was saved for
                    a different script than the user currently has. */}
                {!reviewing && savedReview && reviewResult === savedReview.result && (() => {
                  const currentSig = exportVoiceoverScript({
                    primaryText: ttsText,
                    primaryStartTime,
                    primaryDuration: audioDuration,
                    segments: segments.map(s => ({ text: s.text, startTime: s.startTime, duration: s.duration || 0 })),
                    ...overlayCtx(),
                  })
                  const isStale = savedReview.signature && currentSig !== savedReview.signature
                  return (
                    <div className={`text-[10px] rounded px-2 py-1.5 ${isStale ? 'bg-[#fff3cd] text-[#664d03] border border-[#ffe69c]' : 'bg-cream text-muted border border-border'}`}>
                      {isStale
                        ? `⚠ Saved review — the script has changed since. Click ⚡ Review to re-analyze.`
                        : `Saved review${savedReview.reviewedAt ? ` · ${new Date(savedReview.reviewedAt).toLocaleString()}` : ''}`}
                    </div>
                  )
                })()}
                {reviewing && <p className="text-[11px] text-muted">{reviewResult?.progress || 'Analyzing hookworthiness…'}</p>}
                {!reviewing && reviewResult?.error && (
                  <p className="text-[11px] text-[#c0392b]">Error: {reviewResult.error}</p>
                )}
                {/* Captured frames — shown whenever available, so the user can
                    see what Claude was looking at. Useful for spot-checking
                    whether the timing pulled a transition frame vs the subject. */}
                {!reviewing && Array.isArray(reviewResult?._frames) && reviewResult._frames.some(f => f.dataUrl) && (
                  <div className="border-t border-border pt-1.5">
                    <div className="text-[10px] font-medium text-ink mb-1">Frames Claude saw</div>
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {reviewResult._frames.map((f, i) => f.dataUrl ? (
                        <div key={i} className="flex-shrink-0 text-center">
                          <img src={f.dataUrl} alt={f.label || `frame ${i}`} className="w-[70px] h-[110px] object-cover rounded border border-border" />
                          <div className="text-[8px] text-muted mt-0.5 w-[70px] truncate" title={f.label || ''}>{f.label || `${f.startTime?.toFixed(1)}s`}</div>
                        </div>
                      ) : null)}
                    </div>
                  </div>
                )}
                {!reviewing && reviewResult && !reviewResult.error && (
                  <>
                    <div className="flex items-center gap-2">
                      <span className={`text-[20px] font-bold ${reviewResult.score >= 80 ? 'text-[#2D9A5E]' : reviewResult.score >= 60 ? 'text-[#d97706]' : 'text-[#c0392b]'}`}>{reviewResult.score}</span>
                      <span className="text-[10px] text-muted">/100 hookworthiness</span>
                    </div>
                    {reviewResult.verdict && <p className="text-[11px] text-ink italic">{reviewResult.verdict}</p>}
                    {reviewResult.hook_strength && (
                      <div className="text-[10px]"><span className="font-medium text-ink">Hook:</span> <span className="text-muted">{reviewResult.hook_strength}</span></div>
                    )}
                    {reviewResult.pacing && (
                      <div className="text-[10px]"><span className="font-medium text-ink">Pacing:</span> <span className="text-muted">{reviewResult.pacing}</span></div>
                    )}
                    {reviewResult.payoff && (
                      <div className="text-[10px]"><span className="font-medium text-ink">Payoff:</span> <span className="text-muted">{reviewResult.payoff}</span></div>
                    )}
                    {Array.isArray(reviewResult.issues) && reviewResult.issues.length > 0 && (
                      <div className="border-t border-border pt-1.5">
                        <div className="text-[10px] font-medium text-[#c0392b] mb-0.5">Issues</div>
                        <ul className="text-[10px] text-ink list-disc pl-4 space-y-0.5">
                          {reviewResult.issues.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {Array.isArray(reviewResult.suggestions) && reviewResult.suggestions.length > 0 && (
                      <div className="border-t border-border pt-1.5">
                        <div className="text-[10px] font-medium text-[#2D9A5E] mb-0.5">Suggestions</div>
                        <ul className="text-[10px] text-ink list-disc pl-4 space-y-0.5">
                          {reviewResult.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {Array.isArray(reviewResult.revised_script) && reviewResult.revised_script.length > 0 && (
                      <div className="border-t border-border pt-1.5 mt-1">
                        <div className="text-[10px] font-medium text-[#6C5CE7] mb-1">Proposed rewrite</div>
                        <div className="bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded p-2 space-y-0.5 max-h-[180px] overflow-y-auto">
                          {reviewResult.revised_script.map((s, i) => (
                            <div key={i} className="text-[10px]">
                              <span className="text-[#6C5CE7] font-mono mr-1">[{String(Math.floor((Number(s.startTime) || 0) / 60)).padStart(1, '0')}:{String(Math.floor((Number(s.startTime) || 0) % 60)).padStart(2, '0')}]</span>
                              <span className="text-ink">{s.text}</span>
                            </div>
                          ))}
                        </div>
                        <p className="text-[9px] text-muted mt-1">
                          Applying replaces your current primary + timed segments and clears audio. You'll need to regenerate voices after.
                        </p>
                      </div>
                    )}
                  </>
                )}
                <div className="pt-1 flex items-center gap-2">
                  {!reviewing && Array.isArray(reviewResult?.revised_script) && reviewResult.revised_script.length > 0 && (
                    <button
                      onClick={() => {
                        if (!confirm('Replace your current script with Claude\'s rewrite?\n\nThis clears existing audio so you\'ll need to click Generate voices after.')) return
                        applyRevisedScript()
                      }}
                      className="text-[11px] py-1.5 px-3 bg-[#6C5CE7] text-white border-none rounded cursor-pointer"
                    >Apply rewrite</button>
                  )}
                  <button onClick={() => setScriptModalOpen(null)} className="text-[10px] py-1 px-3 border border-border rounded bg-white cursor-pointer">Close</button>
                </div>
              </div>
            </div>
          )}
          {/* Start-time for the primary voiceover. Defaults to 0 so existing
              drafts without this field keep playing at t=0 (no regression). */}
          <div className="flex items-center gap-2 text-[10px]">
            <label className="text-muted">Starts at:</label>
            <input
              type="text" inputMode="decimal"
              value={primaryStartTime === '' ? '' : String(primaryStartTime)}
              onChange={e => {
                const cleaned = e.target.value.replace(/[^0-9.]/g, '')
                if (cleaned === '') { setPrimaryStartTime(0); return }
                const parsed = parseFloat(cleaned)
                setPrimaryStartTime(isNaN(parsed) ? 0 : parsed)
              }}
              className="text-[10px] border border-border rounded py-0.5 px-1.5 bg-white w-16"
            />
            <span className="text-muted">s into the video</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(() => {
              // Count every voice "clip" that has text — primary + each
              // segment with text. The button always regenerates the full
              // batch, so the count matches what ElevenLabs will actually
              // be called for.
              const segCount = segments.filter(s => s.text?.trim()).length
              const primaryHasText = !!ttsText.trim()
              const total = (primaryHasText ? 1 : 0) + segCount
              const hasAnyAudio = !!audioBlob || segments.some(s => s.blob)
              const allReady = total > 0 && audioBlob && segments.every(s => !s.text?.trim() || s.blob)
              const label = ttsLoading
                ? 'Generating...'
                : allReady
                  ? 'Voice loaded ✓'
                  : total > 1
                    ? `Generate voices (${total})`
                    : 'Generate voice'
              return (
                <button
                  onClick={() => { setAudioIsRestored(false); generateTTS() }}
                  disabled={ttsLoading || total === 0}
                  className={`text-[10px] py-1 px-2.5 border-none rounded cursor-pointer disabled:opacity-50 ${allReady ? 'bg-[#2D9A5E] text-white' : 'bg-[#6C5CE7] text-white'}`}
                  title={total > 1 ? `Regenerates the primary voice + ${segCount} timed segment${segCount > 1 ? 's' : ''}` : ''}
                >{label}</button>
              )
            })()}
            {ttsText.trim() && (
              <span className="text-[9px] text-muted">~{ttsText.trim().length} characters</span>
            )}
            {audioUrl && !recording && (
              <button
                onClick={() => { setAudioBlob(null); if (audioUrl) URL.revokeObjectURL(audioUrl); setAudioUrl(null); for (const vf of videoFiles) delete vf._voiceoverBlob; try { window.dispatchEvent(new CustomEvent('posty-voiceover-change')) } catch {} }}
                className="text-[9px] text-muted hover:underline bg-transparent border-none cursor-pointer"
              >Discard</button>
            )}
          </div>
        </div>
      )}

      {/* Audio-over-video warning: shows when total voiceover end exceeds
          video duration so the user can fix before the audio gets cut. */}
      {(() => {
        if (!monitorDuration || monitorDuration < 1) return null
        const pEnd = audioBlob && audioDuration > 0 ? (Number(primaryStartTime) || 0) + audioDuration : 0
        const segEnd = segments.reduce((m, s) => {
          if (!s.blob || !s.duration) return m
          const end = (Number(s.startTime) || 0) + s.duration
          return end > m ? end : m
        }, 0)
        const audioEnd = Math.max(pEnd, segEnd)
        const overrun = audioEnd - monitorDuration
        if (overrun < 0.25) return null
        const fitSpeedRaw = audioEnd / monitorDuration
        const fitSpeed = Math.min(1.2, Math.max(1.05, Number(fitSpeedRaw.toFixed(2))))
        const canFitBySpeed = fitSpeedRaw <= 1.2
        return (
          <div className="border-t border-border pt-2">
            <div className="border border-[#d97706] bg-[#fef3c7] rounded p-2 space-y-1.5">
              <div className="text-[11px] text-[#92400e] font-medium">
                Voiceover is {audioEnd.toFixed(1)}s — video is {monitorDuration.toFixed(1)}s.
                Audio will cut off by {overrun.toFixed(1)}s.
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  disabled={ttsLoading || !canFitBySpeed}
                  title={canFitBySpeed
                    ? `Sets TTS speed to ${fitSpeed}x and regenerates — keeps every word, just talks faster.`
                    : `Can't fit with speed alone — would need ${fitSpeedRaw.toFixed(2)}x (max is 1.2x). Use Shorten instead.`}
                  onClick={async () => {
                    if (!confirm(`Speed up voice to ${fitSpeed}x to fit video? This regenerates the primary voice${segments.some(s => s.blob) ? ' and all segments' : ''}.`)) return
                    setTtsSpeed(fitSpeed)
                    setSegments(segs => segs.map(s => ({ ...s, speed: fitSpeed, blob: null, audioUrl: null })))
                    setAudioIsRestored(false)
                    // Defer generateTTS by one tick so setTtsSpeed has taken effect
                    setTimeout(() => generateTTS(), 0)
                  }}
                  className="text-[10px] py-1 px-2.5 bg-[#d97706] text-white border-none rounded cursor-pointer disabled:opacity-40"
                >Speed up to {canFitBySpeed ? `${fitSpeed}x` : `${fitSpeedRaw.toFixed(2)}x (too fast)`} to fit</button>
                <button
                  type="button"
                  disabled={reviewing}
                  title="Asks Claude to rewrite the script tighter to fit within the video duration. You'll review the proposed rewrite before applying."
                  onClick={() => { setSegmentLength('short'); reviewCurrentScript({ shortenToFit: true }) }}
                  className="text-[10px] py-1 px-2.5 bg-white text-[#d97706] border border-[#d97706] rounded cursor-pointer disabled:opacity-40"
                >Shorten script with AI</button>
                <span className="text-[9px] text-[#92400e] ml-auto">
                  Or extend video with a freeze frame at render time (automatic).
                </span>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Discard + mix settings */}
      {audioUrl && (
        <div className="border-t border-border pt-2 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-[#2D9A5E] font-medium whitespace-nowrap">
              Primary voice {audioDuration > 0 ? `(${audioDuration.toFixed(1)}s)` : ''}
            </span>
            <audio
              controls
              src={audioUrl}
              preload="metadata"
              className="h-7 flex-1 min-w-[160px] max-w-[320px]"
              style={{ maxHeight: 28 }}
            />
            <button
              onClick={() => { setAudioBlob(null); if (audioUrl) URL.revokeObjectURL(audioUrl); setAudioUrl(null); for (const vf of videoFiles) delete vf._voiceoverBlob; try { window.dispatchEvent(new CustomEvent('posty-voiceover-change')) } catch {} }}
              className="text-[10px] py-1 px-2.5 border border-[#c0392b] text-[#c0392b] rounded bg-white cursor-pointer hover:bg-[#fdeaea] ml-auto"
            >Discard &amp; start over</button>
          </div>
          <div className="flex items-center gap-3 text-[10px]">
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="vo-mix-mode" value="replace" checked={voMixMode === 'replace'} onChange={() => setVoMixMode('replace')} />
              Replace original audio
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="vo-mix-mode" value="mix" checked={voMixMode === 'mix'} onChange={() => setVoMixMode('mix')} />
              Mix with original
            </label>
          </div>
          {voMixMode === 'mix' && (
            <div className="flex items-center gap-2 text-[10px]">
              <label className="text-muted">Original volume:</label>
              <input
                type="range" min={0} max={1} step={0.05} value={voOrigVolume}
                onChange={e => setVoOrigVolume(Number(e.target.value))}
                className="flex-1 accent-[#2D9A5E]"
              />
              <span className="text-muted w-8 text-right">{Math.round(voOrigVolume * 100)}%</span>
            </div>
          )}
          <p className="text-[9px] text-muted">
            {voMixMode === 'replace' ? 'Original audio will be removed — only your voiceover will play.' : `Original audio at ${Math.round(voOrigVolume * 100)}% + voiceover at 100%.`}
            {' '}Applied when you click <strong>Generate Preview</strong> below.
          </p>
        </div>
      )}

      {/* Additional timed segments — hidden by default. Only shows when the
          user clicks "+ Add timed segment" or when restoring a draft that
          already has some. Keeps the common single-voiceover flow simple. */}
      {hasElevenLabs && segments.length === 0 && (
        <div className="border-t border-border pt-2">
          <button
            type="button"
            onClick={addSegment}
            className="text-[10px] text-[#6C5CE7] bg-transparent border-none cursor-pointer p-0 hover:underline"
            title="Add an extra voiceover clip that plays at a specific time on the video"
          >+ Add timed voiceover at another time</button>
        </div>
      )}
      {hasElevenLabs && segments.length > 0 && (
        <div className="border-t border-border pt-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-ink">
              Timed segments <span className="text-muted">({segments.length})</span>
            </span>
            <button
              type="button"
              onClick={addSegment}
              className="text-[10px] py-0.5 px-2 bg-white text-[#6C5CE7] border border-[#6C5CE7] rounded cursor-pointer hover:bg-[#f3f0ff]"
              title="Add another voiceover clip at a different time"
            >+ Add another</button>
          </div>
          {(() => {
            const missingAudio = segments.filter(s => s.text?.trim() && !s.blob).length
            if (missingAudio === 0) return null
            return (
              <div className="text-[11px] bg-[#fff3cd] text-[#664d03] border border-[#ffe69c] rounded px-2 py-2 flex items-center gap-2 flex-wrap">
                <span>⚠ {missingAudio} segment{missingAudio > 1 ? 's have' : ' has'} no audio yet.</span>
                <button
                  type="button"
                  onClick={generateAllSegments}
                  disabled={generatingAll || ttsLoading}
                  className="text-[10px] py-1 px-2.5 bg-[#664d03] text-white border-none rounded cursor-pointer disabled:opacity-50 ml-auto"
                >{generatingAll || ttsLoading ? 'Preparing…' : 'Prepare audio now'}</button>
              </div>
            )
          })()}
          {segments.map((seg) => {
            const hasAudio = !!seg.blob
            return (
              <div key={seg.id} className="border border-border rounded p-1.5 bg-cream/30 space-y-1">
                <div className="flex items-center gap-1 flex-wrap">
                  <label className="text-[9px] text-muted">At:</label>
                  <input
                    type="text" inputMode="decimal"
                    value={seg.startTimeStr ?? String(seg.startTime ?? '')}
                    onChange={e => {
                      const raw = e.target.value
                      // Allow empty, digits, one dot. Parse what we can.
                      const cleaned = raw.replace(/[^0-9.]/g, '')
                      const parsed = cleaned === '' || cleaned === '.' ? 0 : parseFloat(cleaned)
                      updateSegment(seg.id, { startTimeStr: cleaned, startTime: isNaN(parsed) ? 0 : parsed })
                    }}
                    onBlur={e => {
                      // Normalize on blur so saved value is clean
                      const parsed = parseFloat(e.target.value) || 0
                      updateSegment(seg.id, { startTimeStr: String(parsed), startTime: parsed })
                    }}
                    className="text-[10px] border border-border rounded py-0.5 px-1 bg-white w-14"
                  />
                  <span className="text-[9px] text-muted">s</span>
                  {voices.length > 0 && (
                    <select
                      value={seg.voiceId || selectedVoice}
                      onChange={e => updateSegment(seg.id, { voiceId: e.target.value })}
                      className="text-[10px] border border-border rounded py-0.5 px-1 bg-white flex-1 min-w-[100px]"
                      title="Voice for this segment"
                    >
                      {voices.map(v => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
                    </select>
                  )}
                  {/* Status chip + Test + Remove */}
                  {hasAudio && !seg.generating && (
                    <span className="text-[9px] text-[#2D9A5E]" title={seg.duration ? `Audio is ${seg.duration.toFixed(1)}s` : 'Audio ready'}>
                      ● ready{seg.duration ? ` (${seg.duration.toFixed(1)}s)` : ''}
                    </span>
                  )}
                  {seg.generating && (
                    <span className="text-[9px] text-[#6C5CE7]">generating…</span>
                  )}
                  {hasAudio && (
                    <button
                      type="button"
                      onClick={() => playSegment(seg.id)}
                      className="text-[10px] py-0 px-1.5 bg-white text-[#6C5CE7] border border-[#6C5CE7] rounded cursor-pointer"
                      title="Play just this segment"
                    >▶</button>
                  )}
                  {/* Per-row regenerate — re-runs just this segment's TTS
                      without re-sending every other segment to ElevenLabs. */}
                  {seg.text?.trim() && !seg.generating && (
                    <button
                      type="button"
                      onClick={() => regenerateOneSegment(seg.id)}
                      className="text-[10px] py-0 px-1.5 bg-white text-[#6C5CE7] border border-[#6C5CE7] rounded cursor-pointer"
                      title={hasAudio ? 'Regenerate just this segment' : 'Generate just this segment'}
                    >↻</button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeSegment(seg.id)}
                    className="text-[10px] text-[#c0392b] hover:underline bg-transparent border-none cursor-pointer px-1"
                    title="Remove this segment"
                  >×</button>
                </div>
                <textarea
                  rows={2}
                  value={seg.text || ''}
                  onChange={e => {
                    // Clearing blob forces re-generation (text changed = stale audio)
                    const prev = seg.audioUrl
                    if (prev) { try { URL.revokeObjectURL(prev) } catch {} }
                    updateSegment(seg.id, { text: e.target.value, blob: null, audioUrl: null })
                  }}
                  placeholder="What should be spoken at this point?"
                  className="w-full text-[10px] border border-border rounded py-0.5 px-1 bg-white resize-y"
                />
                {/* Per-segment speech speed — independent of every other segment
                    and of the primary voiceover. Changing speed clears the
                    segment's blob so the next Generate reflects the new speed. */}
                <div className="flex items-center gap-1 text-[9px]">
                  <label className="text-muted" title="Speech speed for this segment (0.7x to 1.2x). 1.0 is natural.">Speed</label>
                  <input
                    type="range" min={0.7} max={1.2} step={0.01}
                    value={seg.speed ?? 1.0}
                    onChange={e => {
                      const v = Number(e.target.value) || 1.0
                      const prev = seg.audioUrl
                      if (prev) { try { URL.revokeObjectURL(prev) } catch {} }
                      updateSegment(seg.id, { speed: v, blob: null, audioUrl: null })
                    }}
                    className="flex-1 accent-[#6C5CE7]"
                  />
                  <span className="text-muted w-8 text-right">{(seg.speed ?? 1.0).toFixed(2)}x</span>
                </div>
              </div>
            )
          })}
          {(() => {
            // Overlap check — uses real measured durations when available,
            // falls back to a text-length estimate for segments that haven't
            // been generated yet. Also checks the primary voiceover against
            // the first segment.
            const estimate = (t) => Math.max(1, (t || '').length * 0.08)
            const all = []
            if (ttsText.trim()) {
              all.push({
                label: 'primary',
                startTime: Number(primaryStartTime) || 0,
                duration: audioDuration || estimate(ttsText),
                estimated: !audioDuration,
              })
            }
            for (const s of segments) {
              if (!s.text?.trim()) continue
              all.push({
                label: `at ${Number(s.startTime || 0).toFixed(1)}s`,
                startTime: Number(s.startTime) || 0,
                duration: s.duration || estimate(s.text),
                estimated: !s.duration,
              })
            }
            const sorted = all.sort((a, b) => a.startTime - b.startTime)
            const overlaps = []
            for (let i = 0; i < sorted.length - 1; i++) {
              const endA = sorted[i].startTime + sorted[i].duration
              if (endA > sorted[i + 1].startTime + 0.05) {
                const overlap = (endA - sorted[i + 1].startTime).toFixed(1)
                overlaps.push(`${sorted[i].label} runs ${overlap}s into ${sorted[i + 1].label}`)
              }
            }
            if (!overlaps.length) return null
            const anyEstimated = sorted.some(x => x.estimated)
            return (
              <div className="text-[9px] text-[#c0392b] bg-[#fdeaea] border border-[#f5c6cb] rounded px-2 py-1">
                ⚠ Overlap{overlaps.length > 1 ? 's' : ''}: {overlaps.join('; ')}.
                {anyEstimated && <span className="text-muted"> (estimated from text length — generate voices to measure exactly)</span>}
              </div>
            )
          })()}
          {/* Single Generate-all action below the list — clearer than per-row buttons */}
          {segments.length > 0 && (() => {
            // Same counting rule as the top button — every clip with text.
            const segCount = segments.filter(s => s.text?.trim()).length
            const primaryHasText = !!ttsText.trim()
            const total = (primaryHasText ? 1 : 0) + segCount
            const allReady = total > 0 && (!primaryHasText || audioBlob) && segments.every(s => !s.text?.trim() || s.blob)
            const readyCount = segments.filter(s => s.blob).length
            return (
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={generateAllSegments}
                  disabled={generatingAll || total === 0}
                  className={`text-[10px] py-1 px-2.5 border-none rounded cursor-pointer disabled:opacity-50 ${allReady ? 'bg-[#2D9A5E] text-white' : 'bg-[#6C5CE7] text-white'}`}
                  title={`Regenerates ${primaryHasText ? 'the primary voice + ' : ''}${segCount} timed segment${segCount > 1 ? 's' : ''} — each is a separate ElevenLabs call`}
                >
                  {generatingAll ? 'Generating…' : allReady ? `All ready ✓` : `Generate voices (${total})`}
                </button>
                {readyCount > 0 && (
                  <span className="text-[9px] text-muted">Segments mix into one timeline on preview</span>
                )}
              </div>
            )
          })()}
        </div>
      )}
      </div>}
    </div>
  )
}
