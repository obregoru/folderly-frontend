import { useState, useRef, useEffect } from 'react'
import * as api from '../api'
import { parseVoiceoverScript, exportVoiceoverScript, buildScriptPrompt } from '../lib/voiceoverScript'

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
export default function VoiceoverRecorder({ videoFiles, mergedVideoBase64, settings, onResult, onSettingsChange, onFlushSave, jobId, restoredVoiceover }) {
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
  // Optional delay before the primary voiceover starts. Default 0 keeps
  // the old behavior (plays at t=0) so nothing regresses for existing jobs.
  const [primaryStartTime, setPrimaryStartTime] = useState(() => Number(rvs.primaryStartTime) || 0)
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
    // Older drafts (no primaryStartTime) default to 0 — unchanged behavior.
    if (s.primaryStartTime != null) setPrimaryStartTime(Number(s.primaryStartTime) || 0)
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
      return { blob, audioUrl: url, audioKey }
    } catch (err) {
      console.error('[segment TTS]', err)
      throw err
    }
  }
  // Single "Generate all voices" action: loops through segments that don't
  // already have audio (or whose text changed) and runs TTS for each.
  const [generatingAll, setGeneratingAll] = useState(false)
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
          if (result) updateSegment(seg.id, { blob: result.blob, audioUrl: result.audioUrl, audioKey: result.audioKey || null, generating: false })
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
        primaryStartTime,
        // Persist segment metadata + audio key so blobs come back on resume
        segments: segments.map(s => ({
          id: s.id, text: s.text, voiceId: s.voiceId,
          startTime: s.startTime,
          stability: s.stability, similarity: s.similarity, style: s.style, speakerBoost: s.speakerBoost,
          audioKey: s.audioKey || null,
        })),
      })
    }
  }, [voMixMode, voOrigVolume, ttsText, selectedVoice, ttsStability, ttsSimilarity, ttsStyle, ttsSpeakerBoost, segments, primaryStartTime])

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
    // First line at t ≤ 0.5s becomes the primary; everything else becomes a segment.
    const first = parsed[0]
    if (first.startTime <= 0.5) {
      setTtsText(first.text)
      setPrimaryStartTime(0)
      const rest = parsed.slice(1)
      setSegments(rest.map(s => ({
        id: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        text: s.text,
        voiceId: selectedVoice,
        startTime: s.startTime,
        stability: ttsStability, similarity: ttsSimilarity, style: ttsStyle, speakerBoost: ttsSpeakerBoost,
        blob: null, audioUrl: null, audioKey: null, generating: false,
      })))
    } else {
      // No primary — user pasted all timed segments. Set primary delay so
      // the first one fires at the expected time.
      setTtsText('')
      setPrimaryStartTime(0)
      setSegments(parsed.map(s => ({
        id: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        text: s.text,
        voiceId: selectedVoice,
        startTime: s.startTime,
        stability: ttsStability, similarity: ttsSimilarity, style: ttsStyle, speakerBoost: ttsSpeakerBoost,
        blob: null, audioUrl: null, audioKey: null, generating: false,
      })))
    }
    setScriptModalOpen(null)
    setPasteInput('')
  }

  const exportCurrentScript = async () => {
    const payload = exportVoiceoverScript({
      primaryText: ttsText,
      primaryStartTime,
      segments: segments.map(s => ({ text: s.text, startTime: s.startTime })),
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

  const reviewCurrentScript = async () => {
    const items = exportVoiceoverScript({
      primaryText: ttsText,
      primaryStartTime,
      segments: segments.map(s => ({ text: s.text, startTime: s.startTime })),
    })
    if (!items) { alert('Nothing to review — write something first.'); return }
    setReviewing(true)
    setReviewResult(null)
    setScriptModalOpen('review')
    try {
      const script = parseVoiceoverScript(items) // canonical round-trip
      const r = await api.reviewVoiceoverScript({
        script,
        videoHint: settings?._lastHint || null,
        duration: monitorDuration || null,
      })
      if (r.error) throw new Error(r.error)
      setReviewResult(r)
    } catch (e) {
      setReviewResult({ error: e.message })
    }
    setReviewing(false)
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
            if (result) updateSegment(seg.id, { blob: result.blob, audioUrl: result.audioUrl, audioKey: result.audioKey || null, generating: false })
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
                primaryFiredRef.current = false
                if (audioUrl && audioPreviewRef.current) {
                  try { audioPreviewRef.current.pause(); audioPreviewRef.current.currentTime = 0 } catch {}
                  if (outputT >= pStart - 0.01) {
                    // Already past the primary's start — play immediately
                    try { audioPreviewRef.current.currentTime = Math.max(0, outputT - pStart) } catch {}
                    audioPreviewRef.current.play().catch(() => {})
                    primaryFiredRef.current = true
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
                  if (audioUrl && audioPreviewRef.current && !primaryFiredRef.current && outputT >= pStart) {
                    primaryFiredRef.current = true
                    try { audioPreviewRef.current.currentTime = 0; audioPreviewRef.current.play().catch(() => {}) } catch {}
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
            <button
              type="button"
              onClick={copyScriptPrompt}
              className="py-0.5 px-2 text-[#6C5CE7] hover:underline bg-transparent border-none cursor-pointer"
              title="Copy a ready-to-paste prompt for ChatGPT/Claude that produces a compatible script"
            >Get ChatGPT prompt</button>
          </div>
          <textarea
            ref={ttsRef}
            rows={3}
            value={ttsText}
            onChange={e => setTtsText(e.target.value)}
            placeholder="Type what the voiceover should say... or insert an AI hook above. Edit freely — nothing is sent to ElevenLabs until you click Generate voice."
            className="w-full text-[11px] border border-border rounded py-1 px-2 bg-white resize-none"
          />
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
          {scriptModalOpen === 'review' && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3" onClick={() => setScriptModalOpen(null)}>
              <div className="bg-white rounded-sm p-4 max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-2" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-medium">⚡ Script review</h3>
                  <button onClick={() => setScriptModalOpen(null)} className="text-muted bg-transparent border-none cursor-pointer text-lg leading-none">×</button>
                </div>
                {reviewing && <p className="text-[11px] text-muted">Analyzing hookworthiness…</p>}
                {!reviewing && reviewResult?.error && (
                  <p className="text-[11px] text-[#c0392b]">Error: {reviewResult.error}</p>
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
                  </>
                )}
                <div className="pt-1">
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
