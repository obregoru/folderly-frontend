import { useState, useRef, useEffect } from 'react'
import * as api from '../api'

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
export default function VoiceoverRecorder({ videoFiles, mergedVideoBase64, settings, onResult, onSettingsChange, jobId, restoredVoiceover }) {
  // restoredVoiceover = { settings: {...}, audioBlob, audioUrl } from job restore
  const rv = restoredVoiceover || {}
  const rvs = rv.settings || {}

  // --- Recording state ---
  const [recording, setRecording] = useState(false)
  const [audioUrl, setAudioUrl] = useState(rv.audioUrl || null)
  const [audioBlob, setAudioBlob] = useState(rv.audioBlob || null)
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
      const r = await api.generateVoiceoverHook({
        hint: hookHint.trim() || null,
        category: hookCategoryName || null,
        includeBody: hookIncludeBody,
        count: 4,
      })
      const opts = Array.isArray(r?.options) ? r.options : []
      if (!opts.length) { alert('No hooks generated — try a different hint.'); setHookLoading(false); return }
      setHookOptions(opts)
      setHookIdx(0)
      // Just store options — user clicks "Insert" to put one in the textarea
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
  useEffect(() => { localStorage.setItem('posty_tts_stability', ttsStability) }, [ttsStability])
  useEffect(() => { localStorage.setItem('posty_tts_similarity', ttsSimilarity) }, [ttsSimilarity])
  useEffect(() => { localStorage.setItem('posty_tts_style', ttsStyle) }, [ttsStyle])
  useEffect(() => { localStorage.setItem('posty_tts_boost', ttsSpeakerBoost) }, [ttsSpeakerBoost])

  // Track whether audio was restored (not newly generated) for dimming Generate button
  const [audioIsRestored, setAudioIsRestored] = useState(!!rv.audioBlob)

  // Audio mix mode — restored from job first, then localStorage
  const [voMixMode, setVoMixMode] = useState(() => rvs.mode || localStorage.getItem('posty_vo_mode') || 'mix')
  const [voOrigVolume, setVoOrigVolume] = useState(() => rvs.originalVolume ?? (Number(localStorage.getItem('posty_vo_orig_vol')) || 0.3))
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
    if (s.mode) setVoMixMode(s.mode)
    if (s.originalVolume != null) setVoOrigVolume(s.originalVolume)
    if (Array.isArray(s.segments) && s.segments.length > 0) {
      // Rehydrate segment list. Audio blobs aren't persisted, so each row
      // starts without audio — the user clicks "Generate voices" to recreate.
      setSegments(s.segments.map(seg => ({
        id: seg.id || `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text: seg.text || '',
        voiceId: seg.voiceId || '',
        startTime: Number(seg.startTime) || 0,
        stability: seg.stability,
        similarity: seg.similarity,
        style: seg.style,
        speakerBoost: seg.speakerBoost,
        blob: null, audioUrl: null, generating: false,
      })))
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
    }
  }, [voMixMode, voOrigVolume, videoFiles])

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
    blob: null, audioUrl: null, generating: false,
  }])
  const removeSegment = (id) => setSegments(segs => {
    const gone = segs.find(s => s.id === id)
    if (gone?.audioUrl) { try { URL.revokeObjectURL(gone.audioUrl) } catch {} }
    return segs.filter(s => s.id !== id)
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
      })
      if (r.error) throw new Error(r.error)
      const bc = atob(r.audio_base64)
      const bytes = new Uint8Array(bc.length)
      for (let i = 0; i < bc.length; i++) bytes[i] = bc.charCodeAt(i)
      const blob = new Blob([bytes], { type: r.media_type || 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      return { blob, audioUrl: url }
    } catch (err) {
      console.error('[segment TTS]', err)
      throw err
    }
  }
  // Single "Generate all voices" action: loops through segments that don't
  // already have audio (or whose text changed) and runs TTS for each.
  const [generatingAll, setGeneratingAll] = useState(false)
  const generateAllSegments = async () => {
    const pending = segments.filter(s => s.text?.trim() && !s.blob)
    if (pending.length === 0) {
      alert('Nothing to generate — all segments already have audio.')
      return
    }
    setGeneratingAll(true)
    try {
      // Mark all pending as generating so the user sees progress
      setSegments(segs => segs.map(s => pending.find(p => p.id === s.id) ? { ...s, generating: true } : s))
      for (const seg of pending) {
        try {
          const result = await generateOneSegmentTTS(seg)
          if (result) updateSegment(seg.id, { blob: result.blob, audioUrl: result.audioUrl, generating: false })
        } catch (err) {
          updateSegment(seg.id, { generating: false })
          alert(`Failed on segment at ${seg.startTime}s: ${err.message}`)
          break // stop on first error so user can fix
        }
      }
    } finally {
      setGeneratingAll(false)
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
  }, [segments])
  // Called every timeupdate tick to fire any segment whose start time has arrived
  const maybeFireSegments = (videoTimeFromTrimStart) => {
    for (const s of segments) {
      const audio = segAudioMapRef.current.get(s.id)
      if (!audio) continue
      if (segFiredRef.current.has(s.id)) continue
      if (videoTimeFromTrimStart >= (Number(s.startTime) || 0)) {
        segFiredRef.current.add(s.id)
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
  // Stash segment blobs on each video item for the preview/publish pipeline
  useEffect(() => {
    const ready = segments.filter(s => s.blob).map(s => ({
      blob: s.blob, startTime: Number(s.startTime) || 0, volume: 1,
    }))
    for (const vf of videoFiles) {
      if (ready.length) vf._voiceoverSegments = ready
      else delete vf._voiceoverSegments
    }
    try { window.dispatchEvent(new CustomEvent('posty-voiceover-change')) } catch {}
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
        // Persist segment metadata (no blobs — those are regenerated after resume)
        segments: segments.map(s => ({
          id: s.id, text: s.text, voiceId: s.voiceId,
          startTime: s.startTime,
          stability: s.stability, similarity: s.similarity, style: s.style, speakerBoost: s.speakerBoost,
        })),
      })
    }
  }, [voMixMode, voOrigVolume, ttsText, selectedVoice, ttsStability, ttsSimilarity, ttsStyle, ttsSpeakerBoost, segments])

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

  // Video source for the recording monitor. Recompute when videoFiles changes.
  const monitorItem = videoFiles[0] || null
  const [monitorSrc, setMonitorSrc] = useState(null)
  const monitorFileRef = useRef(null)
  useEffect(() => {
    const file = monitorItem?.file
    if (file === monitorFileRef.current && monitorSrc) return
    monitorFileRef.current = file
    if (monitorSrc && monitorSrc.startsWith('blob:')) URL.revokeObjectURL(monitorSrc)
    if (file instanceof Blob || file instanceof File) {
      setMonitorSrc(URL.createObjectURL(file))
    } else if (monitorItem?._uploadKey && monitorItem?._tenantSlug) {
      // Restored file — stream from server
      setMonitorSrc(`${import.meta.env.VITE_API_URL || ''}/api/t/${monitorItem._tenantSlug}/upload/serve?key=${encodeURIComponent(monitorItem._uploadKey)}`)
    } else {
      setMonitorSrc(null)
    }
    setMonitorDuration(0)
    // Clear stale voiceover when the source video changes
    if (audioUrl) {
      setAudioBlob(null)
      URL.revokeObjectURL(audioUrl)
      setAudioUrl(null)
      for (const vf of videoFiles) delete vf._voiceoverBlob
      try { window.dispatchEvent(new CustomEvent('posty-voiceover-change')) } catch {}
    }
  }, [monitorItem?.id])
  const monitorTrimStart = monitorItem?._trimStart || 0
  const monitorTrimEnd = monitorItem?._trimEnd ?? null

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
        // Check if preview audio is still playing
        if (!recording && audioPreviewRef.current?.paused) {
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
  const generateTTS = async () => {
    // Either the primary has text, or timed segments need audio — if neither,
    // there's nothing to do. This lets users with only segments (no primary
    // text) still use the big Generate button.
    const pendingSegs = segments.filter(s => s.text?.trim() && !s.blob)
    if (!ttsText.trim() && pendingSegs.length === 0) return
    setTtsLoading(true)
    try {
      const api = await import('../api')
      // 1) Generate the primary voiceover if it has text
      if (ttsText.trim()) {
        const r = await api.textToSpeech(ttsText.trim(), selectedVoice || undefined, {
          stability: ttsStability,
          similarity_boost: ttsSimilarity,
          style: ttsStyle,
          use_speaker_boost: ttsSpeakerBoost,
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
      // 2) Also generate any pending timed segments so a single click covers
      //    "regenerate everything". Resume of a draft leaves segments without
      //    blobs — this makes the top button re-fill them without an extra
      //    second click on the timed-segments Generate button.
      if (pendingSegs.length > 0) {
        setGeneratingAll(true)
        setSegments(segs => segs.map(s => pendingSegs.find(p => p.id === s.id) ? { ...s, generating: true } : s))
        for (const seg of pendingSegs) {
          try {
            const result = await generateOneSegmentTTS(seg)
            if (result) updateSegment(seg.id, { blob: result.blob, audioUrl: result.audioUrl, generating: false })
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
                // Sync voiceover audio (primary)
                if (audioUrl && audioPreviewRef.current) {
                  const outputTime = Math.max(0, (v.currentTime || 0) - start)
                  try { audioPreviewRef.current.currentTime = outputTime } catch {}
                  audioPreviewRef.current.play().catch(() => {})
                  setPreviewing(true)
                }
                // Reset segment fired-state so they can trigger this playthrough.
                // If we're resuming mid-video, mark any already-past segments as fired
                // (we can't rewind an audio to the middle of a TTS clip gracefully).
                const outputT = Math.max(0, (v.currentTime || 0) - start)
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
                  // Fire any timed segments whose startTime has now arrived
                  const outputT = Math.max(0, v.currentTime - start)
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
            {!recording && audioUrl && (
              <div className="absolute top-2 left-2 text-[9px] text-white bg-[#2D9A5E]/80 rounded-full px-2 py-0.5">
                With voiceover
              </div>
            )}
            {!recording && !audioUrl && (
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
          <textarea
            ref={ttsRef}
            rows={3}
            value={ttsText}
            onChange={e => setTtsText(e.target.value)}
            placeholder="Type what the voiceover should say... or insert an AI hook above. Edit freely — nothing is sent to ElevenLabs until you click Generate voice."
            className="w-full text-[11px] border border-border rounded py-1 px-2 bg-white resize-none"
          />
          <div className="flex items-center gap-2 flex-wrap">
            {(() => {
              const pendingSegCount = segments.filter(s => s.text?.trim() && !s.blob).length
              const totalPending = (ttsText.trim() ? 1 : 0) + pendingSegCount
              const label = ttsLoading
                ? 'Generating...'
                : audioIsRestored && audioBlob && pendingSegCount === 0
                  ? 'Voice loaded ✓'
                  : pendingSegCount > 0
                    ? `Generate voice${totalPending > 1 ? 's' : ''} (${totalPending})`
                    : 'Generate voice'
              return (
                <button
                  onClick={() => { setAudioIsRestored(false); generateTTS() }}
                  disabled={ttsLoading || (!ttsText.trim() && pendingSegCount === 0)}
                  className={`text-[10px] py-1 px-2.5 border-none rounded cursor-pointer disabled:opacity-50 ${audioIsRestored && audioBlob && pendingSegCount === 0 ? 'bg-[#2D9A5E] text-white' : 'bg-[#6C5CE7] text-white'}`}
                  title={pendingSegCount > 0 ? `Generates the primary voice + ${pendingSegCount} timed segment${pendingSegCount > 1 ? 's' : ''}` : ''}
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

      {/* Discard + mix settings */}
      {audioUrl && (
        <div className="border-t border-border pt-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#2D9A5E] font-medium">Voiceover ready</span>
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
          {segments.map((seg) => {
            const hasAudio = !!seg.blob
            return (
              <div key={seg.id} className="border border-border rounded p-1.5 bg-cream/30 space-y-1">
                <div className="flex items-center gap-1 flex-wrap">
                  <label className="text-[9px] text-muted">At:</label>
                  <input
                    type="number" min={0} step={0.5}
                    value={seg.startTime}
                    onChange={e => updateSegment(seg.id, { startTime: Number(e.target.value) || 0 })}
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
                    <span className="text-[9px] text-[#2D9A5E]" title="Audio ready">● ready</span>
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
              </div>
            )
          })}
          {segments.length > 1 && (() => {
            // Warn if any segment overlaps with the next (approximate — we
            // don't know exact durations without decoding, so check text length)
            const sorted = [...segments].sort((a, b) => a.startTime - b.startTime)
            const overlaps = []
            for (let i = 0; i < sorted.length - 1; i++) {
              // Rough: assume ~0.15s per character for TTS speech
              const est = Math.max(1, (sorted[i].text || '').length * 0.15)
              if (sorted[i].startTime + est > sorted[i + 1].startTime) overlaps.push(i)
            }
            if (!overlaps.length) return null
            return <p className="text-[9px] text-[#c0392b]">⚠ Some segments may overlap — consider spacing them further apart.</p>
          })()}
          {/* Single Generate-all action below the list — clearer than per-row buttons */}
          {segments.length > 0 && (() => {
            const pendingCount = segments.filter(s => s.text?.trim() && !s.blob).length
            const readyCount = segments.filter(s => s.blob).length
            return (
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={generateAllSegments}
                  disabled={generatingAll || pendingCount === 0}
                  className={`text-[10px] py-1 px-2.5 border-none rounded cursor-pointer disabled:opacity-50 ${pendingCount === 0 ? 'bg-[#2D9A5E] text-white' : 'bg-[#6C5CE7] text-white'}`}
                  title={pendingCount === 0 ? 'All segments already generated' : `Generate ${pendingCount} segment${pendingCount > 1 ? 's' : ''} — each is a separate ElevenLabs call`}
                >
                  {generatingAll ? 'Generating…' : pendingCount === 0 ? `All ${readyCount} ready ✓` : `Generate voices (${pendingCount})`}
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
