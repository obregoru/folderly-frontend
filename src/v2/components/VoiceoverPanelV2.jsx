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

  // Restore segments on draft load — wait one tick so jobSync has run
  useEffect(() => {
    if (!draftId) { setSegLoaded(true); return }
    api.getJob(draftId).then(job => {
      const segs = Array.isArray(job?.voiceover_settings?.segments) ? job.voiceover_settings.segments : []
      setSegments(segs.map(s => ({
        id: s.id,
        text: s.text || '',
        startTime: Number(s.startTime) || 0,
        voiceId: s.voiceId || voiceId,
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

  // Persist segments (debounced by jobSync) whenever they change meaningfully
  useEffect(() => {
    if (!segLoaded || !jobSync?.saveVoiceoverSettings) return
    const clean = segments.map(s => ({
      id: s.id, text: s.text, startTime: Number(s.startTime) || 0,
      voiceId: s.voiceId || null, speed: Number(s.speed) || 1.0,
      audioKey: s.audioKey || null, duration: Number(s.duration) || null,
    }))
    jobSync.saveVoiceoverSettings({ segments: clean })
  }, [segments, segLoaded, jobSync])

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
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' })
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

  // --- Segments ---
  const nextSegId = () => `seg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const addSegment = () => {
    const lastStart = segments.reduce((m, s) => Math.max(m, Number(s.startTime) || 0), 0)
    setSegments(prev => [...prev, {
      id: nextSegId(),
      text: '',
      startTime: Math.max(1, Math.round(lastStart + 5)),
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
          const saveRes = await api.saveVoiceoverSegment(r.audio_base64, draftId, seg.id, r.media_type || 'audio/mpeg')
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
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' })
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
    const a = new Audio(seg.audioUrl)
    try { a.play().catch(() => {}) } catch {}
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
            <audio ref={audioElRef} src={audioUrl} controls preload="metadata" data-posty-primary-voice className="h-7 flex-1 min-w-[140px] max-w-[280px]" style={{ maxHeight: 28 }} />
            <button onClick={discard} className="text-[10px] py-1 px-2 border border-[#c0392b] text-[#c0392b] rounded bg-white cursor-pointer">Discard</button>
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

      <div className="border-t border-[#e5e5e5] pt-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-[12px] font-medium flex-1">Timed segments</div>
          <span className="text-[9px] text-muted">{segments.length} · {segments.filter(s => s.audioUrl).length} ready</span>
        </div>
        <div className="text-[10px] text-muted">
          Each segment fires on top of the primary at its start time. Order is by start time.
        </div>

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

function SegmentRow({ seg, voices, defaultVoiceId, onChange, onGenerate, onPlay, onRemove }) {
  const hasAudio = !!seg.audioUrl
  const speed = Number(seg.speed) || 1.0
  const estSec = wordsToSeconds(seg.text, speed)
  return (
    <div className={`border rounded p-2 space-y-1.5 ${hasAudio ? 'border-[#2D9A5E]/30 bg-[#f0faf4]' : 'border-[#e5e5e5] bg-white'}`}>
      <div className="flex items-center gap-1.5 text-[10px]">
        <label className="text-muted">@</label>
        <input
          type="text"
          inputMode="decimal"
          value={seg.startTime}
          onChange={e => onChange({ startTime: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })}
          className="w-14 text-[10px] border border-[#e5e5e5] rounded py-0.5 px-1 bg-white"
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
