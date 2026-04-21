import { useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../../api'

/**
 * VoiceoverPanelV2 — drives the shared FinalPreview <video> via
 * previewRef.getVideo(). Primary voice (single clip, starts at t=0) + any
 * number of timed segments that fire at their startTime during playback.
 *
 * Segments persist via jobSync.saveVoiceoverSettings({ segments }) and
 * restore on draft resume (backend injects audioUrl for each saved audioKey).
 *
 * Deferred: Review / Suggest-from-video / Bundle into single audio track.
 */
export default function VoiceoverPanelV2({ previewRef, settings, jobSync, draftId }) {
  const [tab, setTab] = useState('ai')
  const [voiceId, setVoiceId] = useState(() => settings?.elevenlabs_voice_id || '')
  const [voices, setVoices] = useState([])
  const [text, setText] = useState('')
  const [audioBlob, setAudioBlob] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)
  const [primarySpeed, setPrimarySpeed] = useState(1.0)
  const [primaryDuration, setPrimaryDuration] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [recording, setRecording] = useState(false)
  const [mixMode, setMixMode] = useState('mix')
  const [origVolume, setOrigVolume] = useState(30)
  const [videoDuration, setVideoDuration] = useState(null)

  // Timed segments: rehydrated from job.voiceover_settings.segments
  const [segments, setSegments] = useState([])
  // Write-from-content flow state
  const [scriptMode, setScriptMode] = useState('complement')
  const [scriptLen, setScriptLen] = useState('medium')
  const [writingScript, setWritingScript] = useState(false)
  const [scriptErr, setScriptErr] = useState(null)
  const [segLoaded, setSegLoaded] = useState(false)

  const audioElRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const recordedChunksRef = useRef([])
  // Map<segmentId, HTMLAudioElement> — pool of preloaded segment audios
  const segAudioMapRef = useRef(new Map())
  // Set<segmentId> — which segments already fired during the current play
  const segFiredRef = useRef(new Set())
  // Primary-fired guard (so mid-play seeks don't re-fire it indefinitely)
  const primaryFiredRef = useRef(false)

  const hasElevenLabs = !!settings?.elevenlabs_configured
  const audioEl = () => audioElRef.current

  useEffect(() => {
    if (!hasElevenLabs) return
    api.getVoices?.()
      .then(r => setVoices(Array.isArray(r?.voices) ? r.voices : []))
      .catch(() => {})
  }, [hasElevenLabs])

  // Restore segments + default voice on draft load.
  useEffect(() => {
    if (!draftId) { setSegLoaded(true); return }
    api.getJob(draftId).then(job => {
      const vo = job?.voiceover_settings || {}
      // Per-job voice choice overrides the tenant default. Falls back to
      // the settings value so existing drafts without a saved choice
      // keep the same behavior they had before.
      if (vo.voiceId) setVoiceId(vo.voiceId)
      const segs = Array.isArray(vo.segments) ? vo.segments : []
      const nextDefault = vo.voiceId || voiceId
      setSegments(segs.map(s => ({
        id: s.id,
        text: s.text || '',
        startTime: Number(s.startTime) || 0,
        voiceId: s.voiceId || nextDefault,
        speed: Number(s.speed) || 1.0,
        audioKey: s.audioKey || null,
        audioUrl: s.audioUrl || null,
        duration: Number(s.duration) || null,
        generating: false,
      })))
      setSegLoaded(true)
    }).catch(() => setSegLoaded(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId])

  // Persist segments + the default voice whenever either changes.
  useEffect(() => {
    if (!segLoaded || !jobSync?.saveVoiceoverSettings) return
    const clean = segments.map(s => ({
      id: s.id, text: s.text, startTime: Number(s.startTime) || 0,
      voiceId: s.voiceId || null, speed: Number(s.speed) || 1.0,
      audioKey: s.audioKey || null, duration: Number(s.duration) || null,
    }))
    jobSync.saveVoiceoverSettings({ segments: clean, voiceId: voiceId || null })
  }, [segments, voiceId, segLoaded, jobSync])

  // Keep primary audio URL in sync with its blob
  useEffect(() => {
    if (audioBlob && !audioUrl) setAudioUrl(URL.createObjectURL(audioBlob))
    return () => { if (audioUrl && !audioBlob) try { URL.revokeObjectURL(audioUrl) } catch {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBlob])

  // Keep the segment audio pool in sync with the segments array
  useEffect(() => {
    const map = segAudioMapRef.current
    const liveIds = new Set(segments.map(s => s.id))
    for (const [id, a] of map) {
      if (!liveIds.has(id)) { try { a.pause() } catch {}; map.delete(id) }
    }
    for (const s of segments) {
      const existing = map.get(s.id)
      const wantedSrc = s.audioUrl || ''
      if (wantedSrc && (!existing || existing.src !== wantedSrc)) {
        if (existing) try { existing.pause() } catch {}
        const a = new Audio(wantedSrc)
        a.preload = 'auto'
        map.set(s.id, a)
      } else if (!wantedSrc && existing) {
        try { existing.pause() } catch {}
        map.delete(s.id)
      }
    }
  }, [segments])

  // Track preview video duration so we can compare VO length against it.
  useEffect(() => {
    let cancelled = false
    let attachedVideo = null
    let onRead = null
    const attach = () => {
      if (cancelled) return
      const v = previewRef?.current?.getVideo?.()
      if (!v) { requestAnimationFrame(attach); return }
      attachedVideo = v
      onRead = () => {
        const d = Number(v.duration)
        setVideoDuration(Number.isFinite(d) && d > 0 ? d : null)
      }
      onRead()
      v.addEventListener('loadedmetadata', onRead)
      v.addEventListener('durationchange', onRead)
    }
    attach()
    return () => {
      cancelled = true
      if (attachedVideo && onRead) {
        attachedVideo.removeEventListener('loadedmetadata', onRead)
        attachedVideo.removeEventListener('durationchange', onRead)
      }
    }
  }, [previewRef])

  // Wire playback sync: primary audio + segment firing on timeupdate
  useEffect(() => {
    const video = previewRef?.current?.getVideo?.()
    if (!video) return

    const resetAll = () => {
      primaryFiredRef.current = false
      segFiredRef.current.clear()
      for (const a of segAudioMapRef.current.values()) {
        try { a.pause(); a.currentTime = 0 } catch {}
      }
      const primary = audioEl()
      if (primary) try { primary.pause(); primary.currentTime = 0 } catch {}
    }

    const onPlay = () => {
      // Primary fires immediately when video starts (t >= 0)
      const primary = audioEl()
      if (primary && audioUrl && !primaryFiredRef.current) {
        try {
          primary.currentTime = Math.max(0, video.currentTime)
          primary.volume = 1.0
          const p = primary.play()
          if (p && p.catch) p.catch(() => {})
          primaryFiredRef.current = true
        } catch {}
      }
      // Dim / mute video track based on mix mode (only if we have any VO)
      const hasVo = !!audioUrl || segments.some(s => s.audioUrl)
      if (hasVo) {
        if (mixMode === 'mix') { try { video.volume = origVolume / 100; video.muted = false } catch {} }
        else                   { try { video.muted = true } catch {} }
      }
    }
    const onPause = () => {
      const primary = audioEl()
      if (primary) try { primary.pause() } catch {}
      for (const a of segAudioMapRef.current.values()) try { a.pause() } catch {}
    }
    const onSeek = () => {
      const t = video.currentTime
      const primary = audioEl()
      if (primary) try { primary.currentTime = Math.max(0, t) } catch {}
      // Segments whose startTime is AFTER current time should refire later
      for (const s of segments) {
        if ((Number(s.startTime) || 0) > t) segFiredRef.current.delete(s.id)
      }
      // Segments already past: mark fired and stop
      for (const s of segments) {
        if ((Number(s.startTime) || 0) <= t) segFiredRef.current.add(s.id)
      }
    }
    const onTimeUpdate = () => {
      const t = video.currentTime
      for (const s of segments) {
        if (segFiredRef.current.has(s.id)) continue
        const start = Number(s.startTime) || 0
        if (t >= start) {
          const a = segAudioMapRef.current.get(s.id)
          if (!a) continue
          segFiredRef.current.add(s.id)
          try { a.currentTime = 0; a.play().catch(() => {}) } catch {}
        }
      }
    }
    const onEnded = () => resetAll()

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('seeking', onSeek)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('ended', onEnded)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeking', onSeek)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('ended', onEnded)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl, mixMode, origVolume, segments, previewRef])

  // --- Primary voice TTS ---
  const generate = async () => {
    if (!text.trim() || !voiceId) return
    setGenerating(true)
    try {
      const r = await api.textToSpeech(text.trim(), voiceId, { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: Number(primarySpeed) || 1.0 })
      if (r?.error) throw new Error(r.error)
      const bytes = base64ToBytes(r.audio_base64)
      const blob = new Blob([bytes], { type: r.media_type || 'audio/mpeg' })
      if (audioUrl) try { URL.revokeObjectURL(audioUrl) } catch {}
      const url = URL.createObjectURL(blob)
      setAudioBlob(blob); setAudioUrl(url)
      primaryFiredRef.current = false
      const dur = await readAudioDuration(url)
      setPrimaryDuration(dur)
    } catch (e) {
      alert('TTS failed: ' + e.message)
    }
    setGenerating(false)
  }

  // --- Mic recording (primary) ---
  const startRecording = async () => {
    const video = previewRef?.current?.getVideo?.()
    if (!video) { alert('No video to narrate over — merge or upload first.'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      recordedChunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) recordedChunksRef.current.push(e.data) }
      mr.onstop = async () => {
        // Use the recorder's actual mimeType — hardcoding 'audio/webm'
        // when Safari records audio/mp4 (or Chrome records
        // audio/webm;codecs=opus) produces a blob whose declared type
        // doesn't match its bytes and <audio> refuses to play it.
        const mime = mr.mimeType || 'audio/webm'
        const blob = new Blob(recordedChunksRef.current, { type: mime })
        if (audioUrl) try { URL.revokeObjectURL(audioUrl) } catch {}
        const url = URL.createObjectURL(blob)
        setAudioBlob(blob); setAudioUrl(url)
        stream.getTracks().forEach(t => t.stop())
        primaryFiredRef.current = false
        const dur = await readAudioDuration(url)
        setPrimaryDuration(dur)
      }
      mediaRecorderRef.current = mr
      mr.start()
      setRecording(true)
      try { video.currentTime = 0; video.muted = true; video.play() } catch {}
    } catch (e) {
      alert('Mic access denied or unavailable: ' + e.message)
    }
  }
  const stopRecording = () => {
    const video = previewRef?.current?.getVideo?.()
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (video) try { video.pause(); video.muted = false } catch {}
    setRecording(false)
    setTeleprompterOn(false)
  }
  const discard = () => {
    if (audioUrl) try { URL.revokeObjectURL(audioUrl) } catch {}
    setAudioBlob(null); setAudioUrl(null); setPrimaryDuration(null); primaryFiredRef.current = false
  }

  // Transcribe a recorded primary voice via ElevenLabs Scribe → turn
  // it into a full voiceover segment (text + word_timings) so the
  // Remotion caption pipeline (active-word highlight, reveals, etc.)
  // works with user-recorded voice.
  const [transcribing, setTranscribing] = useState(false)
  const [transcribeErr, setTranscribeErr] = useState(null)
  const transcribeRecording = async () => {
    if (!audioBlob || !draftId) return
    setTranscribing(true); setTranscribeErr(null)
    try {
      // blob → base64 (same pattern used by DownloadFinalButton for
      // the primary voice → base64 upload).
      const buf = new Uint8Array(await audioBlob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
      const audioBase64 = btoa(bin)
      const mediaType = audioBlob.type || 'audio/webm'
      const stt = await api.speechToText({ audioBase64, mediaType })
      if (!stt?.word_timings?.length) throw new Error('No words detected')

      // Build a new segment at t=0 with the transcribed text. The
      // recorded audio itself is what plays during its window, so we
      // send the audio bytes to /save-voiceover-segment along with
      // word_timings so a single PUT persists both.
      const segId = nextSegId()
      const duration = await readAudioDuration(audioUrl)
      const newSeg = {
        id: segId,
        text: stt.text || '',
        startTime: 0,
        voiceId: 'recorded',
        speed: 1.0,
        audioKey: null,
        audioUrl,
        duration,
        generating: false,
      }

      const saveRes = await api.saveVoiceoverSegment(
        audioBase64, draftId, segId, mediaType, stt.word_timings
      )
      if (saveRes?.audio_key) newSeg.audioKey = saveRes.audio_key

      setSegments(prev => [...prev, newSeg])
      // Clear the primary so the user doesn't see the same audio
      // in two places. They can re-record if they want a new one.
      setAudioBlob(null); setAudioUrl(null); setPrimaryDuration(null)
      primaryFiredRef.current = false
    } catch (e) {
      setTranscribeErr(e.message || String(e))
    } finally {
      setTranscribing(false)
    }
  }

  // --- Segments ---
  const nextSegId = () => `seg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const addSegment = () => {
    const lastStart = segments.reduce((m, s) => Math.max(m, Number(s.startTime) || 0), 0)
    setSegments(prev => [...prev, {
      id: nextSegId(),
      text: '',
      startTime: Math.max(1, Number((lastStart + 5).toFixed(2))),
      voiceId: voiceId || '',
      speed: 1.0,
      audioKey: null, audioUrl: null, duration: null, generating: false,
    }])
  }
  const updateSegment = (id, patch) => {
    setSegments(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }
  const removeSegment = (id) => {
    setSegments(prev => prev.filter(s => s.id !== id))
    const map = segAudioMapRef.current
    const a = map.get(id); if (a) { try { a.pause() } catch {}; map.delete(id) }
  }

  const generateSegment = async (seg) => {
    if (!seg.text?.trim() || !seg.voiceId) return
    updateSegment(seg.id, { generating: true })
    try {
      const segSpeed = Number(seg.speed) || 1.0
      const r = await api.textToSpeech(seg.text.trim(), seg.voiceId, { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: segSpeed })
      if (r?.error) throw new Error(r.error)
      const bytes = base64ToBytes(r.audio_base64)
      const blob = new Blob([bytes], { type: r.media_type || 'audio/mpeg' })
      const url = URL.createObjectURL(blob)

      let audioKey = null
      if (draftId) {
        try {
          // r.word_timings comes from ElevenLabs' with-timestamps response
          // (Phase 1.2). Legacy TTS responses lack the field; the save
          // endpoint tolerates null and skips writing word_timings rows.
          const saveRes = await api.saveVoiceoverSegment(
            r.audio_base64, draftId, seg.id, r.media_type || 'audio/mpeg', r.word_timings
          )
          if (saveRes?.audio_key) audioKey = saveRes.audio_key
        } catch (e) { console.warn('[segment persist] failed:', e.message) }
      }

      const duration = await readAudioDuration(url)
      updateSegment(seg.id, { audioUrl: url, audioKey, duration, generating: false })
    } catch (e) {
      updateSegment(seg.id, { generating: false })
      alert(`Segment generate failed: ${e.message}`)
    }
  }
  // Write a VO script from the draft's hints + generated captions + visuals.
  // Populates the primary text + replaces any existing timed segments with
  // the AI's new ones. The user then edits freely + hits "Generate primary
  // voice" / "Generate all missing" to produce audio.
  const writeScriptFromContent = async () => {
    if (!draftId) { setScriptErr('Open a draft first.'); return }
    setScriptErr(null); setWritingScript(true)
    try {
      // Pass the playing video's duration so the backend constrains the
      // script length (speaking rate × duration) — keeps the VO from
      // running past the end of the video.
      const vidEl = previewRef?.current?.getVideo?.()
      const videoDurationS = Number.isFinite(vidEl?.duration) ? vidEl.duration : null
      const r = await api.generateVoiceoverScript({
        jobUuid: draftId,
        mode: scriptMode,
        segmentLength: scriptLen,
        videoDurationS,
      })
      if (r?.error) throw new Error(r.error)
      if (typeof r?.primary !== 'string') throw new Error('AI returned no primary')
      setText(r.primary)
      const segs = Array.isArray(r.segments) ? r.segments : []
      setSegments(segs.map(s => ({
        id: nextSegId(),
        text: s.text || '',
        startTime: Number(s.startTime) || 0,
        voiceId: voiceId || '',
        speed: 1.0,
        audioKey: null, audioUrl: null, duration: null, generating: false,
      })))
    } catch (e) {
      setScriptErr(e.message || String(e))
    } finally {
      setWritingScript(false)
    }
  }

  const generateAllMissing = async () => {
    const pending = segments.filter(s => s.text?.trim() && !s.audioUrl)
    for (const s of pending) await generateSegment(s)
  }

  // ---- Teleprompter + script-driven record -----------------------------
  // Lifted here so the Script tab and the Record tab share one parsed script.
  const [teleprompterOn, setTeleprompterOn] = useState(false)
  const [teleprompterScript, setTeleprompterScript] = useState(null) // { primary, segments }

  // Broadcast to FinalPreviewV2 so it renders teleprompter text over video.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const payload = teleprompterOn && teleprompterScript ? teleprompterScript : null
    window._postyTeleprompter = payload
    try { window.dispatchEvent(new CustomEvent('posty-teleprompter-change', { detail: payload })) } catch {}
  }, [teleprompterOn, teleprompterScript])

  const startTeleprompterRecording = async () => {
    const video = previewRef?.current?.getVideo?.()
    if (!video) { alert('No video to narrate over — merge or upload first.'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      recordedChunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) recordedChunksRef.current.push(e.data) }
      mr.onstop = async () => {
        const mime = mr.mimeType || 'audio/webm'
        const blob = new Blob(recordedChunksRef.current, { type: mime })
        if (audioUrl) try { URL.revokeObjectURL(audioUrl) } catch {}
        const url = URL.createObjectURL(blob)
        setAudioBlob(blob); setAudioUrl(url)
        stream.getTracks().forEach(t => t.stop())
        primaryFiredRef.current = false
        setTeleprompterOn(false) // auto-dismiss
        const dur = await readAudioDuration(url)
        setPrimaryDuration(dur)
      }
      mediaRecorderRef.current = mr
      mr.start()
      setRecording(true)
      setTeleprompterOn(true)
      try { video.currentTime = 0; video.muted = true; video.play() } catch {}
    } catch (e) {
      alert('Mic access denied or unavailable: ' + e.message)
    }
  }

  // Persist a caption_timeline (array of {startTime,endTime,text}) under
  // overlay_settings.caption_timeline. Shared by every "apply as closed
  // captions" action, whatever the source. Broadcasts so FinalPreviewV2
  // re-renders immediately.
  const persistCaptionTimeline = (timeline, sourceLabel) => {
    if (!timeline || timeline.length === 0) {
      alert(`Nothing to apply — ${sourceLabel}.`); return
    }
    const existing = (typeof window !== 'undefined' && window._postyOverlays) || {}
    const next = { ...existing, caption_timeline: timeline }
    jobSync?.saveOverlaySettings?.(next)
    try {
      if (typeof window !== 'undefined') {
        window._postyOverlays = next
        window.dispatchEvent(new CustomEvent('posty-overlay-change', { detail: next }))
        window._postyCaptions = timeline
        window.dispatchEvent(new CustomEvent('posty-captions-change', { detail: timeline }))
      }
    } catch {}
    alert(`Applied ${timeline.length} closed-caption line${timeline.length === 1 ? '' : 's'} to the video.`)
  }

  // Build a caption_timeline from an array of { startTime, text } cues —
  // end time is the next cue's start or video duration or +3s fallback.
  const buildCaptionTimeline = (cues) => {
    const video = previewRef?.current?.getVideo?.()
    const videoDur = Number(video?.duration) || 0
    const sorted = [...cues]
      .filter(x => x?.text && String(x.text).trim())
      .map(x => ({ startTime: Number(x.startTime) || 0, text: String(x.text).trim() }))
      .sort((a, b) => a.startTime - b.startTime)
    return sorted.map((cue, i) => {
      const nxt = sorted[i + 1]
      const end = nxt ? nxt.startTime : (videoDur > cue.startTime ? videoDur : cue.startTime + 3)
      return { startTime: cue.startTime, endTime: end, text: cue.text }
    })
  }

  // Captions from a pasted script (Script tab).
  const applyScriptAsCaptions = (raw) => {
    const parsed = parseScript(raw)
    const cues = [
      ...(parsed.primary ? [{ startTime: 0, text: parsed.primary }] : []),
      ...parsed.segments,
    ]
    persistCaptionTimeline(buildCaptionTimeline(cues), 'parse a script first')
  }

  // Captions from the current voiceover segments + primary text (AI tab).
  // Mirrors the existing segment startTimes — whatever the user generated
  // audio for is what shows on screen.
  const applySegmentsAsCaptions = () => {
    const cues = [
      ...(text && text.trim() ? [{ startTime: 0, text }] : []),
      ...segments.map(s => ({ startTime: Number(s.startTime) || 0, text: s.text })),
    ]
    persistCaptionTimeline(buildCaptionTimeline(cues), 'add at least one segment first')
  }

  // Parse a pasted script into primary + timed segments, then generate all
  // the audio end-to-end. Replaces any existing segments so the script is
  // the single source of truth.
  const [runningScript, setRunningScript] = useState(false)
  const generateFromScript = async () => {
    const parsed = parseScript(text)
    if (!parsed.primary && parsed.segments.length === 0) {
      alert('Nothing parseable — expected lines like [0:00]Your text here.')
      return
    }
    if (!voiceId) { alert('Pick a voice first.'); return }
    setRunningScript(true)
    try {
      // 1. Primary: update the AI tab text + generate audio
      if (parsed.primary) {
        setText(parsed.primary)
        const r = await api.textToSpeech(parsed.primary, voiceId, { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: Number(primarySpeed) || 1.0 })
        if (r?.error) throw new Error(r.error)
        const bytes = base64ToBytes(r.audio_base64)
        const blob = new Blob([bytes], { type: r.media_type || 'audio/mpeg' })
        if (audioUrl) try { URL.revokeObjectURL(audioUrl) } catch {}
        const pUrl = URL.createObjectURL(blob)
        setAudioBlob(blob); setAudioUrl(pUrl)
        primaryFiredRef.current = false
        const pDur = await readAudioDuration(pUrl)
        setPrimaryDuration(pDur)
      }

      // 2. Replace segments with the parsed list
      const newSegs = parsed.segments.map(p => ({
        id: nextSegId(),
        text: p.text,
        startTime: p.startTime,
        voiceId,
        speed: 1.0,
        audioKey: null, audioUrl: null, duration: null, generating: false,
      }))
      setSegments(newSegs)

      // 3. Generate audio for every new segment (updateSegment reads from
      // current state via functional setter, so freshly added segs are found)
      for (const s of newSegs) await generateSegment(s)

      // Show the primary voice UI if it was the paste tab
      setTab('ai')
    } catch (e) {
      alert('Generate from script failed: ' + e.message)
    } finally {
      setRunningScript(false)
    }
  }

  const playSegment = (seg) => {
    if (!seg.audioUrl) return
    // Prefer the already-preloaded audio element from segAudioMapRef —
    // it has preload="auto" and is more likely to be ready than a
    // freshly-constructed Audio(). Fall back to a new Audio + load()
    // if the pool doesn't have one yet (shouldn't happen post-effect).
    const preloaded = segAudioMapRef.current.get(seg.id)
    const a = preloaded || new Audio(seg.audioUrl)
    try {
      a.currentTime = 0
      if (!preloaded) { try { a.load() } catch {} }
      const p = a.play()
      if (p && p.catch) p.catch(err => console.warn('[playSegment] play failed:', err?.message || err))
    } catch (err) {
      console.warn('[playSegment] sync error:', err?.message || err)
    }
  }

  const sortedSegments = useMemo(
    () => [...segments].sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0)),
    [segments]
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">Voiceover</div>
        {(audioUrl || segments.some(s => s.audioUrl)) && (
          <button
            onClick={() => {
              const v = previewRef?.current?.getVideo?.()
              if (!v) return
              try { v.currentTime = 0; primaryFiredRef.current = false; segFiredRef.current.clear(); v.play() } catch {}
            }}
            className="text-[10px] py-1 px-2.5 bg-[#2D9A5E] text-white border-none rounded cursor-pointer"
          >▶ Play with video</button>
        )}
      </div>

      <div className="flex items-center gap-1 bg-[#f8f7f3] rounded-lg p-0.5">
        {[
          { key: 'ai',     label: 'AI voice',    enabled: hasElevenLabs },
          { key: 'record', label: 'Record',      enabled: true },
          { key: 'paste',  label: 'Paste script', enabled: true },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => t.enabled && setTab(t.key)}
            disabled={!t.enabled}
            title={!t.enabled ? 'Add ElevenLabs API key in Settings' : ''}
            className={`flex-1 text-[10px] py-1.5 rounded-md border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${tab === t.key ? 'bg-white text-ink shadow-sm font-medium' : 'bg-transparent text-muted'}`}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'ai' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px]">
            <label className="text-muted">Voice:</label>
            <select
              value={voiceId}
              onChange={e => setVoiceId(e.target.value)}
              className="text-[10px] border border-[#e5e5e5] rounded py-1 px-1.5 bg-white flex-1"
            >
              <option value="">{voices.length === 0 ? 'Loading…' : 'Pick a voice'}</option>
              {voices.map(v => (
                <option key={v.voice_id} value={v.voice_id}>{v.name}{v.category ? ` (${v.category})` : ''}</option>
              ))}
            </select>
          </div>

          {/* Write-from-content helper: pulls hints + generated captions +
              visuals and writes a VO script you can edit. */}
          <div className="bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded p-2 space-y-1.5">
            <div className="text-[11px] font-medium">Write script from content</div>
            <div className="text-[10px] text-muted">
              AI uses this draft's hints + already-generated captions + video visuals to write a voiceover script you can edit or record over. Type your own below if you'd rather start from scratch.
            </div>
            <div className="flex items-center gap-1.5 text-[10px]">
              <label className="text-muted">Angle:</label>
              <select value={scriptMode} onChange={e => setScriptMode(e.target.value)} className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white">
                <option value="complement">Complement captions</option>
                <option value="contrarian">Different angle</option>
              </select>
              <label className="text-muted ml-1">Length:</label>
              <select value={scriptLen} onChange={e => setScriptLen(e.target.value)} className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white">
                <option value="short">Short</option>
                <option value="medium">Medium</option>
                <option value="long">Long</option>
              </select>
            </div>
            <button
              onClick={writeScriptFromContent}
              disabled={writingScript}
              className="w-full py-1.5 bg-[#6C5CE7] text-white text-[10px] font-medium border-none rounded cursor-pointer disabled:opacity-50"
            >{writingScript ? 'Writing…' : '✨ Write VO script from content'}</button>
            {scriptErr && <div className="text-[10px] text-[#c0392b]">{scriptErr}</div>}
          </div>

          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setPrimaryDuration(null) }}
            placeholder="Type what the voiceover should say (plays from t=0), or click Write script from content above."
            rows={5}
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y min-h-[100px]"
          />
          <div className="flex items-center gap-2 text-[10px]">
            <label className="text-muted">Speed:</label>
            <input
              type="range" min={0.7} max={1.2} step={0.05}
              value={primarySpeed}
              onChange={e => {
                setPrimarySpeed(Number(e.target.value))
                // Speed changed → old audio no longer matches; invalidate so
                // "Generate primary voice" re-runs.
                if (audioUrl) try { URL.revokeObjectURL(audioUrl) } catch {}
                setAudioBlob(null); setAudioUrl(null); setPrimaryDuration(null)
                primaryFiredRef.current = false
              }}
              className="flex-1"
            />
            <span className="font-mono text-muted w-10 text-right">{primarySpeed.toFixed(2)}x</span>
            <span
              className="font-mono text-[9px] rounded px-1.5 py-0.5 border"
              style={{ background: '#f3f0ff', color: '#6C5CE7', borderColor: '#6C5CE766' }}
              title="Estimated speech length at current speed (before you click Generate)"
            >
              {primaryDuration != null ? `actual ${formatSec(primaryDuration)}` : `est ~${formatSec(wordsToSeconds(text, primarySpeed))}`}
            </span>
          </div>
          <button
            onClick={generate}
            disabled={generating || !text.trim() || !voiceId}
            className="w-full py-2 bg-[#6C5CE7] text-white text-[11px] font-medium border-none rounded cursor-pointer disabled:opacity-50"
          >{generating ? 'Generating…' : 'Generate primary voice (TTS)'}</button>
        </div>
      )}

      {tab === 'record' && (
        <div className="space-y-2 py-3">
          <div className="text-[36px] text-center">🎤</div>
          <div className="text-[11px] text-muted text-center">
            {recording
              ? (teleprompterOn ? 'Recording… read the teleprompter above.' : 'Recording… video above plays muted.')
              : 'Tap to start. Video above plays muted while you narrate.'}
          </div>

          {teleprompterScript && !recording && (
            <label className="flex items-center justify-center gap-2 text-[10px] bg-white border border-[#e5e5e5] rounded p-2 cursor-pointer">
              <input type="checkbox" checked={teleprompterOn} onChange={e => setTeleprompterOn(e.target.checked)} />
              <span>Show teleprompter from parsed script ({(teleprompterScript.segments?.length || 0) + (teleprompterScript.primary ? 1 : 0)} lines)</span>
            </label>
          )}

          <div className="flex flex-col items-center gap-1.5">
            {!recording ? (
              <>
                <button
                  onClick={startRecording}
                  className="py-2 px-6 bg-[#c0392b] text-white text-[11px] font-medium border-none rounded cursor-pointer"
                >● Start recording</button>
                {teleprompterScript && (
                  <button
                    onClick={startTeleprompterRecording}
                    className="py-1.5 px-4 bg-[#6C5CE7] text-white text-[10px] font-medium border-none rounded cursor-pointer"
                  >▶ Record with teleprompter</button>
                )}
              </>
            ) : (
              <button
                onClick={stopRecording}
                className="py-2 px-6 bg-[#c0392b] text-white text-[11px] font-medium border-none rounded cursor-pointer animate-pulse"
              >■ Stop recording</button>
            )}
          </div>
        </div>
      )}

      {tab === 'paste' && (
        <ScriptTab
          text={text} setText={setText}
          voiceId={voiceId} hasElevenLabs={hasElevenLabs}
          runningScript={runningScript}
          onGenerateAll={generateFromScript}
          onRecordWithTeleprompter={() => {
            const parsed = parseScript(text)
            if (!parsed.primary && parsed.segments.length === 0) {
              alert('Parse the script first — expected lines like [0:00]Your text.')
              return
            }
            setTeleprompterScript({ primary: parsed.primary, segments: parsed.segments })
            setTab('record')
            // Auto-start a teleprompter recording after a short delay so the
            // user can see the teleprompter overlay before it begins.
            setTimeout(() => startTeleprompterRecording(), 400)
          }}
          onApplyAsCaptions={() => applyScriptAsCaptions(text)}
        />
      )}

      {audioUrl && (
        <div className="border-t border-[#e5e5e5] pt-2 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#2D9A5E] font-medium">Primary ready</span>
            {/* key={audioUrl} forces a full remount when the blob URL swaps
                (e.g. AI voice → user recording). Without it React only
                updates the src attribute, and most browsers leave the
                element bound to the old (already-revoked) blob URL so the
                play button silently does nothing. preload="auto" makes
                sure the newly-set blob actually buffers before the user
                hits play. */}
            <audio key={audioUrl} ref={audioElRef} src={audioUrl} controls preload="auto" data-posty-primary-voice className="h-7 flex-1 min-w-[140px] max-w-[280px]" style={{ maxHeight: 28 }} />
            <button onClick={discard} className="text-[10px] py-1 px-2 border border-[#c0392b] text-[#c0392b] rounded bg-white cursor-pointer">Discard</button>
          </div>

          {/* Transcribe-to-captions. Converts the primary recording into
              a timed segment so the Remotion caption pipeline can
              highlight each word as it's spoken. */}
          <div className="bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded p-2 space-y-1.5">
            <div className="text-[10px] font-medium">📝 Turn recording into synced captions</div>
            <div className="text-[10px] text-muted">
              Sends audio to ElevenLabs Scribe for speech-to-text + word timings, then creates a segment so each word highlights with the voice.
            </div>
            <button
              type="button"
              onClick={transcribeRecording}
              disabled={transcribing || !draftId}
              className="w-full py-1.5 bg-[#6C5CE7] text-white text-[10px] font-medium border-none rounded cursor-pointer disabled:opacity-50"
            >{transcribing ? 'Transcribing…' : '🎙️ → 📝 Transcribe recording'}</button>
            {transcribeErr && <div className="text-[9px] text-[#c0392b]">{transcribeErr}</div>}
          </div>
          <div className="flex items-center gap-3 text-[10px]">
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" checked={mixMode === 'replace'} onChange={() => setMixMode('replace')} />
              Replace original
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" checked={mixMode === 'mix'} onChange={() => setMixMode('mix')} />
              Mix
            </label>
          </div>
          {mixMode === 'mix' && (
            <div className="flex items-center gap-2 text-[10px]">
              <label className="text-muted">Original volume</label>
              <input type="range" min={0} max={100} value={origVolume} onChange={e => setOrigVolume(Number(e.target.value))} className="flex-1" />
              <span className="w-8 text-right">{origVolume}%</span>
            </div>
          )}
        </div>
      )}

      {/* Job-level default caption style. Foldable section — edits
          jobs.default_caption_style, which every segment inherits
          unless it has its own row. Kept outside of SegmentRow so it
          doesn't live under any one segment; lazy-loaded so the font
          picker isn't pulled until a user opens it. */}
      {draftId && (
        <DefaultCaptionStyleFold draftId={draftId} />
      )}

      {/* Full-video caption preview. The in-editor preview above uses
          DOM overlays for captions (static), so animations/reveals/
          active-word effects only appear in the Remotion final pass.
          This button runs that final pass and plays the result
          inline — same pipeline as Download, just no download. */}
      {draftId && (
        <CaptionedPreviewFold draftId={draftId} hasSegments={segments.length > 0 || !!audioUrl} />
      )}

      <div className="border-t border-[#e5e5e5] pt-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-[12px] font-medium flex-1">Timed segments</div>
          <span className="text-[9px] text-muted">{segments.length} · {segments.filter(s => s.audioUrl).length} ready</span>
        </div>
        <div className="text-[10px] text-muted">
          Each segment fires on top of the primary at its start time. Order is by start time.
        </div>

        {/* Phase 7.2 — segment transition. Only meaningful with 2+
            segments, so hidden otherwise. Applies to the final
            rendered video — the in-editor preview still plays as
            separate tracks. */}
        {draftId && segments.length >= 2 && (
          <SegmentTransitionControl draftId={draftId} />
        )}

        {(() => {
          // Summary: estimate uses words/sec when audio isn't generated, actual
          // duration otherwise. Longest arm wins: the voiceover ends at
          // max(primaryEnd, each segment's end). Overlaps still count as time
          // the audio is playing; we don't double-add them.
          const primaryEst = primaryDuration ?? wordsToSeconds(text, primarySpeed)
          const primaryActual = primaryDuration
          let maxEstEnd = primaryEst
          let maxActualEnd = primaryActual ?? 0
          let anyActual = primaryActual != null
          for (const s of segments) {
            const sText = s.text || ''
            const start = Number(s.startTime) || 0
            const est = s.duration ?? wordsToSeconds(sText, s.speed)
            maxEstEnd = Math.max(maxEstEnd, start + (est || 0))
            if (s.duration != null) { anyActual = true; maxActualEnd = Math.max(maxActualEnd, start + s.duration) }
          }
          const over = videoDuration != null && maxEstEnd > videoDuration + 0.2
          return (
            <div
              className={`rounded px-2 py-1 text-[10px] flex items-center gap-2 flex-wrap border ${over ? 'bg-[#fdf2f1] border-[#c0392b]/30 text-[#c0392b]' : 'bg-[#fafafa] border-[#e5e5e5] text-ink'}`}
              title="Total voiceover length (end of the last-playing clip). Must be ≤ video length or the VO will run past the end."
            >
              <span className="font-medium">Estimated {formatSec(maxEstEnd)}</span>
              {anyActual && <span>· Generated {formatSec(maxActualEnd)}</span>}
              <span className="ml-auto">Video {videoDuration != null ? formatSec(videoDuration) : '—'}</span>
              {over && <span className="w-full text-[9px]">⚠ Voiceover runs past the video. Speed up a segment or trim text.</span>}
            </div>
          )
        })()}

        {sortedSegments.map(seg => (
          <SegmentRow
            key={seg.id}
            seg={seg}
            voices={voices}
            defaultVoiceId={voiceId}
            draftId={draftId}
            onChange={patch => updateSegment(seg.id, patch)}
            onGenerate={() => generateSegment(seg)}
            onPlay={() => playSegment(seg)}
            onRemove={() => removeSegment(seg.id)}
          />
        ))}

        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={addSegment}
            disabled={!hasElevenLabs}
            className="flex-1 min-w-[100px] text-[10px] py-1.5 border border-[#6C5CE7] text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-40"
          >+ Add segment</button>
          {segments.some(s => s.text?.trim() && !s.audioUrl) && (
            <button
              onClick={generateAllMissing}
              className="flex-1 min-w-[100px] text-[10px] py-1.5 bg-[#6C5CE7] text-white border-none rounded cursor-pointer"
            >Generate all missing</button>
          )}
        </div>
        {(segments.some(s => s.text?.trim()) || (text && text.trim())) && (
          <button
            onClick={applySegmentsAsCaptions}
            className="w-full text-[10px] py-1.5 border border-[#2D9A5E] text-[#2D9A5E] bg-white rounded cursor-pointer"
            title="Writes every segment's text to overlay_settings.caption_timeline at the same start times — rendered as YouTube-style subtitles in the preview."
          >📝 Use segments as closed captions</button>
        )}
      </div>
    </div>
  )
}

function SegmentRow({ seg, voices, defaultVoiceId, draftId, onChange, onGenerate, onPlay, onRemove }) {
  const hasAudio = !!seg.audioUrl
  const speed = Number(seg.speed) || 1.0
  const estSec = wordsToSeconds(seg.text, speed)

  // Phase 7.1 — emoji injection state. We don't auto-apply the
  // enriched text; we show it as a preview so the user can accept or
  // edit. Clicking "Apply" writes it to the segment (invalidating any
  // existing audio because the text changed).
  const [enriching, setEnriching] = useState(false)
  const [enrichErr, setEnrichErr] = useState(null)
  const enrichWithEmoji = async () => {
    if (!seg.text?.trim() || !draftId) return
    setEnriching(true); setEnrichErr(null)
    try {
      const r = await api.enrichSegmentText(draftId, seg.id)
      if (r?.enriched && r.enriched !== seg.text) {
        // Replace text + invalidate audio (text changed so TTS needs
        // to re-run next time). Word timings are orphaned until re-
        // generation; harmless because the renderer gracefully falls
        // back when timings don't match the text.
        onChange({ text: r.enriched, audioUrl: null, audioKey: null, duration: null })
      }
    } catch (e) {
      setEnrichErr(e.message || String(e))
    } finally {
      setEnriching(false)
    }
  }

  // Keep a local string draft so the user can type "1.4" naturally. If
  // we derive the displayed value from the numeric prop, typing "1."
  // gets coerced to Number(1) and the trailing dot disappears before
  // the user can finish typing. Commit to the numeric segment state
  // on blur or Enter.
  const [startDraft, setStartDraft] = useState(() => String(seg.startTime ?? 0))
  // Sync when the segment is reordered/auto-updated externally.
  useEffect(() => { setStartDraft(String(seg.startTime ?? 0)) }, [seg.startTime])
  const commitStart = () => {
    const n = parseFloat(startDraft)
    onChange({ startTime: Number.isFinite(n) && n >= 0 ? n : 0 })
  }

  // Phase 4.5 — collapsible caption-style editor lives inline with each
  // segment so users can style only the segments they care about. We
  // lazy-load the component so the font picker + its fonts aren't
  // pulled until a user actually opens the editor.
  const [styleOpen, setStyleOpen] = useState(false)
  const [CaptionStyleEditor, setCaptionStyleEditor] = useState(null)
  useEffect(() => {
    if (!styleOpen || CaptionStyleEditor) return
    import('../../components/fonts/CaptionStyleEditor').then(m => setCaptionStyleEditor(() => m.default))
  }, [styleOpen, CaptionStyleEditor])

  // Current caption-style state for THIS segment, summarized for the
  // button pill. 'override': has its own row, show preset name / "custom".
  // 'inherit': no row, shows the job-default preset name (if any).
  // null: neither row nor default set. Fetched on mount + refreshed
  // when the editor closes so the pill reflects saves made in-session.
  const [segStyleState, setSegStyleState] = useState(null)
  useEffect(() => {
    if (!hasAudio || !draftId) return
    let cancelled = false
    if (styleOpen) return
    ;(async () => {
      try {
        const [segRes, defRes, mod] = await Promise.all([
          api.getCaptionStyle(draftId, seg.id).catch(() => ({ caption_style: null })),
          api.getJobDefaultCaptionStyle(draftId).catch(() => ({ caption_style: null })),
          import('../../lib/captionPresets/catalog'),
        ])
        if (cancelled) return
        const segCs = segRes?.caption_style || null
        const defCs = defRes?.caption_style || null
        if (segCs) {
          const p = findPresetByConfig(segCs, mod.CAPTION_PRESETS)
          setSegStyleState({ kind: 'override', name: p?.displayName || 'custom', emoji: p?.thumbnailEmoji })
        } else if (defCs) {
          const p = findPresetByConfig(defCs, mod.CAPTION_PRESETS)
          setSegStyleState({ kind: 'inherit', name: p?.displayName || 'custom', emoji: p?.thumbnailEmoji })
        } else {
          setSegStyleState(null)
        }
      } catch { /* swallow — pill just won't show */ }
    })()
    return () => { cancelled = true }
  }, [hasAudio, draftId, seg.id, styleOpen])

  return (
    <div className={`border rounded p-2 space-y-1.5 ${hasAudio ? 'border-[#2D9A5E]/30 bg-[#f0faf4]' : 'border-[#e5e5e5] bg-white'}`}>
      <div className="flex items-center gap-1.5 text-[10px]">
        <label className="text-muted">@</label>
        <input
          type="text"
          inputMode="decimal"
          value={startDraft}
          onChange={e => setStartDraft(e.target.value.replace(/[^0-9.]/g, ''))}
          onBlur={commitStart}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
          className="w-14 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
          title="Start time in seconds (decimals OK, e.g. 1.4)"
        />
        <span className="text-muted">s</span>
        <select
          value={seg.voiceId || defaultVoiceId || ''}
          onChange={e => onChange({ voiceId: e.target.value, audioUrl: null, audioKey: null, duration: null })}
          className="text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white flex-1 min-w-0"
        >
          <option value="">Voice…</option>
          {voices.map(v => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
        </select>
        <button
          onClick={onRemove}
          className="text-[10px] py-0.5 px-1.5 border border-[#c0392b]/30 text-[#c0392b] bg-white rounded cursor-pointer"
          title="Remove"
        >✕</button>
      </div>
      <textarea
        value={seg.text}
        onChange={e => onChange({ text: e.target.value, audioUrl: null, audioKey: null, duration: null })}
        placeholder="What should this voice say at that time?"
        rows={2}
        className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white resize-y"
      />
      <div className="flex items-center gap-1.5 text-[10px]">
        <label className="text-muted">Speed</label>
        <input
          type="range" min={0.7} max={1.2} step={0.05}
          value={speed}
          onChange={e => onChange({ speed: Number(e.target.value), audioUrl: null, audioKey: null, duration: null })}
          className="flex-1"
          title="0.7x slower · 1.0x normal · 1.2x faster. Regenerate to apply."
        />
        <span className="font-mono text-muted w-10 text-right">{speed.toFixed(2)}x</span>
      </div>
      <div className="flex items-center gap-1.5 text-[10px]">
        <button
          onClick={onGenerate}
          disabled={!seg.text?.trim() || !(seg.voiceId || defaultVoiceId) || seg.generating}
          className="text-[10px] py-0.5 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
        >{seg.generating ? 'Generating…' : (hasAudio ? 'Regenerate' : 'Generate')}</button>
        {hasAudio && (
          <button onClick={onPlay} className="text-[10px] py-0.5 px-2 border border-[#2D9A5E] text-[#2D9A5E] bg-white rounded cursor-pointer">▶ Test</button>
        )}
        {/* Phase 7.1 — emoji injection. Idempotent: if the text
            already contains emoji, the backend returns noop:true and
            nothing changes. Applying invalidates existing audio so
            Generate needs to run again. */}
        {draftId && seg.text?.trim() && (
          <button
            onClick={enrichWithEmoji}
            disabled={enriching}
            className="text-[10px] py-0.5 px-2 border border-[#f59e0b]/50 text-[#d97706] bg-white rounded cursor-pointer disabled:opacity-50"
            title="AI adds tasteful emoji at sentence boundaries. Invalidates existing audio."
          >{enriching ? '…' : '✨ +emoji'}</button>
        )}
        <span
          className="font-mono text-[9px] rounded px-1.5 py-0.5 border ml-auto"
          style={{
            background: hasAudio ? '#f0faf4' : '#f3f0ff',
            color: hasAudio ? '#2D9A5E' : '#6C5CE7',
            borderColor: (hasAudio ? '#2D9A5E' : '#6C5CE7') + '66',
          }}
          title={hasAudio ? 'Actual generated audio length' : 'Estimated speech length at current speed (2.3 words/sec × speed)'}
        >
          {seg.duration != null ? formatSec(seg.duration) : `~${formatSec(estSec)}`}
        </span>
        {hasAudio && seg.audioKey && <span className="text-[8px] text-muted italic">persisted</span>}
      </div>
      {enrichErr && <div className="text-[9px] text-[#c0392b]">Emoji enrich failed: {enrichErr}</div>}

      {/* Phase 4.5 — Caption style editor entry point. Only shown for
          segments that have audio (meaningless to style a not-yet-
          generated segment) and when we have a draftId to key the
          saved row on. */}
      {hasAudio && draftId && (
        <>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setStyleOpen(v => !v)}
              className="text-[10px] py-0.5 px-2 border border-[#6C5CE7]/40 text-[#6C5CE7] bg-white rounded cursor-pointer"
              title="Choose fonts + colors for the rendered caption"
            >{styleOpen ? '✕ close caption style' : '🎨 caption style'}</button>
            {/* State pill — shows applied preset, "inherit: <default>",
                or "custom" so the user sees current state without
                opening the editor. Purple for override, green for
                inherit. Matches the editor-header pill semantics. */}
            {!styleOpen && segStyleState && (
              <span
                className={`text-[9px] py-0.5 px-1.5 rounded border flex items-center gap-1 ${
                  segStyleState.kind === 'override'
                    ? 'bg-[#6C5CE7]/10 border-[#6C5CE7]/40 text-[#6C5CE7]'
                    : 'bg-[#2D9A5E]/10 border-[#2D9A5E]/40 text-[#2D9A5E]'
                }`}
                title={
                  segStyleState.kind === 'override'
                    ? 'This segment overrides the job default.'
                    : 'No per-segment override — rendering with the job default.'
                }
              >
                {segStyleState.emoji && <span className="text-[10px] leading-none">{segStyleState.emoji}</span>}
                {segStyleState.kind === 'inherit' ? `default: ${segStyleState.name}` : segStyleState.name}
              </span>
            )}
          </div>
          {styleOpen && CaptionStyleEditor && (
            <CaptionStyleEditor
              jobUuid={draftId}
              segmentId={seg.id}
              onClose={() => setStyleOpen(false)}
            />
          )}
        </>
      )}
    </div>
  )
}

function base64ToBytes(b64) {
  const byteChars = atob(b64)
  const bytes = new Uint8Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
  return bytes
}

// Detached <audio> element → resolves with the file's duration in seconds.
function readAudioDuration(url) {
  return new Promise(resolve => {
    try {
      const a = new Audio()
      a.preload = 'metadata'
      const done = () => {
        const d = Number(a.duration)
        resolve(Number.isFinite(d) && d > 0 ? d : null)
      }
      a.addEventListener('loadedmetadata', done, { once: true })
      a.addEventListener('error', () => resolve(null), { once: true })
      a.src = url
    } catch { resolve(null) }
  })
}

// Rough speaking-rate estimate: 2.3 words/sec at 1.0x, scaled by speed.
function wordsToSeconds(txt, speed = 1.0) {
  const s = String(txt || '').trim()
  if (!s) return 0
  const words = s.split(/\s+/).length
  const rate = 2.3 * (Number(speed) || 1.0)
  return words / rate
}

function formatSec(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return '—'
  return `${v.toFixed(1)}s`
}

// --- Script tab -----------------------------------------------------------
// One pasted script drives three outputs: AI voice (primary + segments),
// human recording with teleprompter, and on-screen captions (overlays).
// Job-level default caption style — foldable panel that mounts
// CaptionStyleEditor in 'default' mode. Lazy-loaded so the font
// picker + ~50 Google Fonts aren't pulled when the panel stays
// closed. Mirrors the lazy-load pattern used per-segment in
// SegmentRow below.
function DefaultCaptionStyleFold({ draftId }) {
  const [open, setOpen] = useState(false)
  const [CaptionStyleEditor, setCaptionStyleEditor] = useState(null)
  // Full caption_style config for the job default — used to drive the
  // closed-state preview below the fold toggle, so users see WHAT the
  // default actually looks like (font / color / preset name) without
  // opening the editor.
  const [defaultCs, setDefaultCs] = useState(null)
  const [defaultPreset, setDefaultPreset] = useState(null) // { name, emoji } | null
  // Bumped by the editor's onClose to force a re-fetch after the user
  // saves. Tracking closed-transitions via a counter rather than a
  // boolean is simpler than threading "did anything change".
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!open || CaptionStyleEditor) return
    import('../../components/fonts/CaptionStyleEditor').then(m => setCaptionStyleEditor(() => m.default))
  }, [open, CaptionStyleEditor])

  useEffect(() => {
    if (!draftId) return
    let cancelled = false
    Promise.all([
      api.getJobDefaultCaptionStyle(draftId).catch(() => ({ caption_style: null })),
      import('../../lib/captionPresets/catalog'),
    ]).then(([r, mod]) => {
      if (cancelled) return
      const cs = r?.caption_style || null
      setDefaultCs(cs)
      if (!cs) { setDefaultPreset(null); return }
      const matched = findPresetByConfig(cs, mod.CAPTION_PRESETS)
      setDefaultPreset(matched ? { name: matched.displayName, emoji: matched.thumbnailEmoji } : null)
    })
    return () => { cancelled = true }
  }, [draftId, reloadKey])

  return (
    <div className="border-t border-[#e5e5e5] pt-3 space-y-2">
      <button
        type="button"
        onClick={() => {
          // Closing via the outer toggle → refetch on next render so
          // any in-editor saves show up in the closed-state preview.
          if (open) setReloadKey(k => k + 1)
          setOpen(v => !v)
        }}
        className="w-full flex items-center gap-2 bg-[#f3f0ff] border border-[#6C5CE7]/30 rounded p-2 cursor-pointer hover:border-[#6C5CE7]/60"
        title="Style that applies to every segment unless the segment has its own custom style"
      >
        <span className="text-[14px] leading-none">🎨</span>
        <span className="text-[11px] font-medium text-left">Default caption style</span>
        <div className="flex-1" />
        <span className="text-[11px] text-muted">{open ? '▾' : '▸'}</span>
      </button>

      {/* Always-visible current-state row. When a default is set, show a
          styled sample ("The quick brown fox") rendered in the actual
          default font/color with a pill noting whether it matches a
          named preset. When no default is set, show a nudge. Hidden
          while the editor fold is open so the editor's own header is
          authoritative. */}
      {!open && (
        defaultCs ? (
          <div className="flex items-center gap-2 bg-white border border-[#e5e5e5] rounded px-2 py-1.5">
            <span
              className="text-[13px] flex-1 truncate"
              style={{
                fontFamily: `'${defaultCs.base_font_family || 'Inter'}', system-ui, sans-serif`,
                color: defaultCs.base_font_color || '#111827',
                fontWeight: 700,
                // Show outline color as a drop shadow so the sample is
                // legible on white even when the text color is light.
                textShadow: defaultCs.active_word_outline_config?.color
                  ? `0 0 2px ${defaultCs.active_word_outline_config.color}`
                  : undefined,
              }}
            >The quick brown fox</span>
            {defaultPreset ? (
              <span
                className="text-[10px] py-0.5 px-1.5 rounded border bg-[#6C5CE7]/10 border-[#6C5CE7]/40 text-[#6C5CE7] flex items-center gap-1 shrink-0"
                title={`Matches the "${defaultPreset.name}" preset`}
              >
                {defaultPreset.emoji && <span className="text-[11px] leading-none">{defaultPreset.emoji}</span>}
                {defaultPreset.name}
              </span>
            ) : (
              <span
                className="text-[9px] py-0.5 px-1.5 rounded border bg-[#fafafa] border-[#e5e5e5] text-muted shrink-0"
                title="Custom — doesn't match any preset"
              >custom</span>
            )}
          </div>
        ) : (
          <div className="text-[10px] text-muted italic px-2 py-1">
            No default set. Every segment renders with its own style (or the app's minimal fallback).
          </div>
        )
      )}

      {open && CaptionStyleEditor && (
        <CaptionStyleEditor
          mode="default"
          jobUuid={draftId}
          onClose={() => { setOpen(false); setReloadKey(k => k + 1) }}
        />
      )}
      {open && !CaptionStyleEditor && (
        <div className="text-[10px] text-muted italic text-center py-2">Loading…</div>
      )}
    </div>
  )
}

// Full-video captioned preview — runs /post/render-final so the user
// sees actual Remotion animations/reveals/active-word effects, which
// the DOM preview above can't show (it only paints static overlay
// text). Same endpoint as Download Final Video; we just skip the
// save/share handoff and play inline.
//
// Render takes 30–60s on Railway, so we cache the URL client-side and
// only re-render when the user explicitly hits "Re-render" after
// tweaking styles.
function CaptionedPreviewFold({ draftId, hasSegments }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState('idle') // idle | rendering | ready | error
  const [previewUrl, setPreviewUrl] = useState(null)
  const [err, setErr] = useState(null)

  const renderPreview = async () => {
    setState('rendering'); setErr(null)
    try {
      // Same primary-voice base64 pickup as DownloadFinalButton — so
      // an in-session-recorded primary voice gets included in the
      // preview without needing a separate persist step.
      let primaryBase64 = null
      try {
        const primaryEl = document.querySelector('audio[data-posty-primary-voice]')
        if (primaryEl?.src) {
          const r = await fetch(primaryEl.src)
          const b = await r.blob()
          const buf = new Uint8Array(await b.arrayBuffer())
          let bin = ''
          for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
          primaryBase64 = btoa(bin)
        }
      } catch { /* server-side primary still works if persisted */ }

      const r = await api.renderFinal({ jobUuid: draftId, primaryAudioBase64: primaryBase64 })
      if (!r?.final_url) throw new Error('Server returned no final URL')
      setPreviewUrl(r.final_url)
      setState('ready')
    } catch (e) {
      setErr(e.message || String(e))
      setState('error')
    }
  }

  return (
    <div className="border-t border-[#e5e5e5] pt-3 space-y-2">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 bg-[#fff7ed] border border-[#f59e0b]/30 rounded p-2 cursor-pointer hover:border-[#f59e0b]/60"
        title="Render the full video with captions, animations, reveals — exactly what Download produces"
      >
        <span className="text-[14px] leading-none">🎬</span>
        <span className="text-[11px] font-medium text-left">Preview captioned video</span>
        <div className="flex-1" />
        {state === 'ready' && !open && (
          <span className="text-[9px] py-0.5 px-1.5 rounded border bg-[#f0faf4] border-[#2D9A5E]/40 text-[#2D9A5E] shrink-0">
            rendered
          </span>
        )}
        <span className="text-[11px] text-muted">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="space-y-2">
          {!hasSegments && state === 'idle' && (
            <div className="text-[10px] text-muted italic px-2 py-1">
              Generate or record a voiceover first — there's nothing to caption yet.
            </div>
          )}

          {state === 'idle' && hasSegments && (
            <button
              type="button"
              onClick={renderPreview}
              className="w-full py-2 bg-[#f59e0b] text-white text-[11px] font-medium border-none rounded cursor-pointer"
            >▶ Render preview (30–60 s)</button>
          )}

          {state === 'rendering' && (
            <div className="bg-black text-white/80 text-[10px] rounded p-3 text-center">
              <div className="animate-pulse">Rendering…</div>
              <div className="text-[9px] text-white/50 mt-1">
                Full pipeline: merge → voiceover mix → Remotion caption pass
              </div>
            </div>
          )}

          {state === 'ready' && previewUrl && (
            <>
              <video
                key={previewUrl}
                src={previewUrl}
                controls
                playsInline
                className="w-full aspect-[9/16] max-h-[60vh] bg-black rounded object-contain mx-auto"
              />
              <button
                type="button"
                onClick={renderPreview}
                className="w-full py-1.5 bg-white border border-[#f59e0b] text-[#f59e0b] text-[10px] font-medium rounded cursor-pointer"
                title="Re-render after tweaking caption styles or segments"
              >↻ Re-render preview</button>
            </>
          )}

          {state === 'error' && (
            <div className="text-[10px] text-[#c0392b] bg-[#fdf2f1] border border-[#c0392b]/30 rounded p-2">
              Render failed: {err}
              <button
                type="button"
                onClick={renderPreview}
                className="ml-2 text-[10px] underline cursor-pointer"
              >retry</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Deep-compare a caption_styles-shaped config against each preset's
// config. Returns the matching preset or null. Duplicates the same
// matcher logic used by CaptionStyleEditor's findMatchingPresetId so
// the fold button can identify presets without importing the editor.
function findPresetByConfig(cs, presets) {
  if (!cs) return null
  const norm = (v) => v == null ? null : JSON.stringify(sortedKeys(v))
  const scalarFields = ['base_font_family', 'base_font_color', 'active_word_color', 'active_word_font_family']
  const jsonFields = [
    'active_word_outline_config', 'active_word_scale_pulse',
    'layout_config',
    'entry_animation', 'exit_animation', 'reveal_config',
    'continuous_motion',
  ]
  for (const preset of presets) {
    const c = preset.config
    let match = true
    for (const f of scalarFields) if ((cs[f] || null) !== (c[f] || null)) { match = false; break }
    if (!match) continue
    for (const f of jsonFields) if (norm(cs[f]) !== norm(c[f])) { match = false; break }
    if (match) return preset
  }
  return null
}
function sortedKeys(v) {
  if (Array.isArray(v)) return v.map(sortedKeys)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = sortedKeys(v[k])
    return out
  }
  return v
}

// Phase 7.2 — transition between adjacent voiceover segments. Read-
// write against /jobs/:id/segment-transition. Debounces the save on
// slider change so every keypress doesn't hit the API.
function SegmentTransitionControl({ draftId }) {
  const [type, setType] = useState('cut')
  const [ms, setMs] = useState(400)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!draftId) return
    let cancelled = false
    api.getSegmentTransition(draftId).then(r => {
      if (cancelled) return
      const t = r?.transition
      if (t?.type === 'crossfade') {
        setType('crossfade')
        setMs(Number(t.crossfadeMs) || 400)
      } else {
        setType('cut')
      }
    }).finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [draftId])

  // Debounce saves while the slider drags.
  useEffect(() => {
    if (!loaded || !draftId) return
    const handle = setTimeout(() => {
      setSaving(true)
      const body = type === 'crossfade' ? { type: 'crossfade', crossfadeMs: ms } : { type: 'cut' }
      api.saveSegmentTransition(draftId, body).catch(() => {}).finally(() => setSaving(false))
    }, 350)
    return () => clearTimeout(handle)
  }, [type, ms, loaded, draftId])

  return (
    <div className="bg-[#f8f7f3] border border-[#e5e5e5] rounded p-2 space-y-1.5">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="font-medium flex-1">Segment transition</span>
        {saving && <span className="text-[9px] text-muted italic">saving…</span>}
      </div>
      <div className="flex items-center gap-3 text-[10px]">
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="radio" checked={type === 'cut'} onChange={() => setType('cut')} />
          Hard cut
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="radio" checked={type === 'crossfade'} onChange={() => setType('crossfade')} />
          Crossfade
        </label>
      </div>
      {type === 'crossfade' && (
        <div className="flex items-center gap-2 text-[10px]">
          <label className="text-muted">Duration</label>
          <input
            type="range" min={100} max={1200} step={50}
            value={ms}
            onChange={e => setMs(Number(e.target.value))}
            className="flex-1"
          />
          <span className="font-mono text-muted w-12 text-right">{ms}ms</span>
        </div>
      )}
      <div className="text-[9px] text-muted">
        Applies to the final rendered video — adjacent segments fade
        their audio and captions in/out over the chosen duration.
      </div>
    </div>
  )
}

function ScriptTab({ text, setText, voiceId, hasElevenLabs, runningScript, onGenerateAll, onRecordWithTeleprompter, onApplyAsCaptions }) {
  const parsed = parseScript(text)
  const lineCount = (parsed.primary ? 1 : 0) + parsed.segments.length
  const hasParsed = lineCount > 0
  const canAi = hasElevenLabs && !!voiceId

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={`One script, three outputs. Example:\n\n[0:00]Everyone else bought theirs. You made yours.\n[0:02]Your whole crew was there for it.\n[0:04]That's what sticks.`}
        rows={6}
        className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y min-h-[140px] font-mono"
      />

      <div className="flex items-center gap-2 text-[10px] text-muted">
        {hasParsed ? (
          <span>
            Detected <span className="text-ink font-medium">{lineCount}</span> line{lineCount === 1 ? '' : 's'}
            {parsed.primary ? ' (1 primary' : ''}
            {parsed.segments.length > 0 ? `${parsed.primary ? ' + ' : ' ('}${parsed.segments.length} timed segment${parsed.segments.length === 1 ? '' : 's'}` : (parsed.primary ? '' : '')}
            {parsed.primary || parsed.segments.length ? ')' : ''}
          </span>
        ) : (
          <span>No timestamps detected yet — use <code>[m:ss]</code> format.</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-1.5">
        <button
          onClick={onGenerateAll}
          disabled={!canAi || !hasParsed || runningScript}
          className="w-full py-2 bg-[#6C5CE7] text-white text-[11px] font-medium border-none rounded cursor-pointer disabled:opacity-50"
          title={!canAi ? 'Pick a voice in the AI tab first' : ''}
        >{runningScript ? 'Generating audio…' : `Generate AI voice from script${hasParsed ? ` (${lineCount} clip${lineCount === 1 ? '' : 's'})` : ''}`}</button>

        <button
          onClick={onRecordWithTeleprompter}
          disabled={!hasParsed || runningScript}
          className="w-full py-2 bg-white border border-[#c0392b] text-[#c0392b] text-[11px] font-medium rounded cursor-pointer disabled:opacity-50"
        >● Record with teleprompter</button>

        <button
          onClick={onApplyAsCaptions}
          disabled={!hasParsed || runningScript}
          className="w-full py-2 bg-white border border-[#2D9A5E] text-[#2D9A5E] text-[11px] font-medium rounded cursor-pointer disabled:opacity-50"
        >📝 Apply as closed captions</button>
      </div>

      <div className="text-[9px] text-muted italic pt-1">
        One script, three independent outputs. AI voice generates each line's audio. Teleprompter shows lines on screen to read while you record your own audio. Closed captions render subtitle-style text timed to each line — separate from the opening/middle/closing overlay blocks.
      </div>
    </div>
  )
}

// Parse a timestamped script like:
//   [0:00]First line
//   [0:02]Second line
// Returns { primary, segments } — the [0:00] block (or text before the first
// timestamp) is the primary voice; every other timestamp becomes a segment.
// If there are no timestamps at all, the entire input is treated as primary.
export function parseScript(raw) {
  const text = String(raw || '')
  if (!text.trim()) return { primary: '', segments: [] }
  const re = /\[(\d{1,2}):(\d{2})\]\s*/g
  const hits = []
  let m
  while ((m = re.exec(text)) !== null) {
    hits.push({
      index: m.index,
      end: m.index + m[0].length,
      time: parseInt(m[1], 10) * 60 + parseInt(m[2], 10),
    })
  }
  if (hits.length === 0) return { primary: text.trim(), segments: [] }

  // Text before the first timestamp (if any) is implicit primary
  const implicitPrimary = text.slice(0, hits[0].index).trim()

  const blocks = hits.map((h, i) => {
    const textEnd = i + 1 < hits.length ? hits[i + 1].index : text.length
    return { startTime: h.time, text: text.slice(h.end, textEnd).trim() }
  }).filter(b => b.text)

  // If there's a [0:00] block, it's primary. Else the pre-timestamp text is.
  const zeroIdx = blocks.findIndex(b => b.startTime === 0)
  let primary = implicitPrimary
  let segBlocks = [...blocks]
  if (zeroIdx >= 0) {
    primary = blocks[zeroIdx].text
    segBlocks = blocks.filter((_, i) => i !== zeroIdx)
  }
  // Anything still at startTime 0 after removing the primary collapses into
  // the primary so we don't schedule duplicate audio at t=0.
  const zeros = segBlocks.filter(b => b.startTime === 0)
  if (zeros.length > 0) {
    primary = [primary, ...zeros.map(z => z.text)].filter(Boolean).join(' ')
    segBlocks = segBlocks.filter(b => b.startTime > 0)
  }

  return { primary, segments: segBlocks }
}
