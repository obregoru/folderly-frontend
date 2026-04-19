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
  const [generating, setGenerating] = useState(false)
  const [recording, setRecording] = useState(false)
  const [mixMode, setMixMode] = useState('mix')
  const [origVolume, setOrigVolume] = useState(30)

  // Timed segments: rehydrated from job.voiceover_settings.segments
  const [segments, setSegments] = useState([])
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
        audioKey: s.audioKey || null,
        audioUrl: s.audioUrl || null,
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
      voiceId: s.voiceId || null, audioKey: s.audioKey || null,
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
      const r = await api.textToSpeech(text.trim(), voiceId, { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1.0 })
      if (r?.error) throw new Error(r.error)
      const bytes = base64ToBytes(r.audio_base64)
      const blob = new Blob([bytes], { type: r.media_type || 'audio/mpeg' })
      if (audioUrl) try { URL.revokeObjectURL(audioUrl) } catch {}
      setAudioBlob(blob); setAudioUrl(URL.createObjectURL(blob))
      primaryFiredRef.current = false
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
      mr.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' })
        if (audioUrl) try { URL.revokeObjectURL(audioUrl) } catch {}
        setAudioBlob(blob); setAudioUrl(URL.createObjectURL(blob))
        stream.getTracks().forEach(t => t.stop())
        primaryFiredRef.current = false
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
    setAudioBlob(null); setAudioUrl(null); primaryFiredRef.current = false
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
      audioKey: null, audioUrl: null, generating: false,
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
      const r = await api.textToSpeech(seg.text.trim(), seg.voiceId, { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1.0 })
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

      updateSegment(seg.id, { audioUrl: url, audioKey, generating: false })
    } catch (e) {
      updateSegment(seg.id, { generating: false })
      alert(`Segment generate failed: ${e.message}`)
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
      mr.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' })
        if (audioUrl) try { URL.revokeObjectURL(audioUrl) } catch {}
        setAudioBlob(blob); setAudioUrl(URL.createObjectURL(blob))
        stream.getTracks().forEach(t => t.stop())
        primaryFiredRef.current = false
        setTeleprompterOn(false) // auto-dismiss
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

  // Build a closed-captions timeline from a script and attach it to the
  // job as overlay_settings.caption_timeline. Each script line becomes one
  // timed caption cue (start/end = next line's start or +3s), rendered as
  // subtitle-style text in FinalPreviewV2. Separate concept from the
  // three-block opening/middle/closing overlay text, which is unchanged.
  const applyScriptAsCaptions = (raw) => {
    const parsed = parseScript(raw)
    const all = [
      ...(parsed.primary ? [{ startTime: 0, text: parsed.primary }] : []),
      ...parsed.segments,
    ]
      .filter(x => x.text && x.text.trim())
      .sort((a, b) => a.startTime - b.startTime)
    if (all.length === 0) { alert('Nothing to apply — parse a script first.'); return }

    const video = previewRef?.current?.getVideo?.()
    const videoDur = Number(video?.duration) || 0
    const timeline = all.map((cue, i) => {
      const next = all[i + 1]
      const end = next ? next.startTime : (videoDur > cue.startTime ? videoDur : cue.startTime + 3)
      return { startTime: Number(cue.startTime) || 0, endTime: end, text: cue.text }
    })

    // Merge into the job's existing overlay_settings so we don't clobber
    // the three-block overlay text. Read current, mutate caption_timeline.
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
        const r = await api.textToSpeech(parsed.primary, voiceId, { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1.0 })
        if (r?.error) throw new Error(r.error)
        const bytes = base64ToBytes(r.audio_base64)
        const blob = new Blob([bytes], { type: r.media_type || 'audio/mpeg' })
        if (audioUrl) try { URL.revokeObjectURL(audioUrl) } catch {}
        setAudioBlob(blob); setAudioUrl(URL.createObjectURL(blob))
        primaryFiredRef.current = false
      }

      // 2. Replace segments with the parsed list
      const newSegs = parsed.segments.map(p => ({
        id: nextSegId(),
        text: p.text,
        startTime: p.startTime,
        voiceId,
        audioKey: null, audioUrl: null, generating: false,
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
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Type what the voiceover should say (plays from t=0)…"
            rows={5}
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y min-h-[100px]"
          />
          <button
            onClick={generate}
            disabled={generating || !text.trim() || !voiceId}
            className="w-full py-2 bg-[#6C5CE7] text-white text-[11px] font-medium border-none rounded cursor-pointer disabled:opacity-50"
          >{generating ? 'Generating…' : 'Generate primary voice'}</button>
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
            <audio ref={audioElRef} src={audioUrl} controls preload="metadata" className="h-7 flex-1 min-w-[140px] max-w-[280px]" style={{ maxHeight: 28 }} />
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

        <div className="flex gap-1.5">
          <button
            onClick={addSegment}
            disabled={!hasElevenLabs}
            className="flex-1 text-[10px] py-1.5 border border-[#6C5CE7] text-[#6C5CE7] bg-white rounded cursor-pointer disabled:opacity-40"
          >+ Add segment</button>
          {segments.some(s => s.text?.trim() && !s.audioUrl) && (
            <button
              onClick={generateAllMissing}
              className="flex-1 text-[10px] py-1.5 bg-[#6C5CE7] text-white border-none rounded cursor-pointer"
            >Generate all missing</button>
          )}
        </div>
      </div>
    </div>
  )
}

function SegmentRow({ seg, voices, defaultVoiceId, onChange, onGenerate, onPlay, onRemove }) {
  const hasAudio = !!seg.audioUrl
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
          onChange={e => onChange({ voiceId: e.target.value, audioUrl: null, audioKey: null })}
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
        onChange={e => onChange({ text: e.target.value, audioUrl: null, audioKey: null })}
        placeholder="What should this voice say at that time?"
        rows={2}
        className="w-full text-[11px] border border-[#e5e5e5] rounded p-1.5 bg-white resize-y"
      />
      <div className="flex items-center gap-1.5 text-[10px]">
        <button
          onClick={onGenerate}
          disabled={!seg.text?.trim() || !(seg.voiceId || defaultVoiceId) || seg.generating}
          className="text-[10px] py-0.5 px-2 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
        >{seg.generating ? 'Generating…' : (hasAudio ? 'Regenerate' : 'Generate')}</button>
        {hasAudio && (
          <button onClick={onPlay} className="text-[10px] py-0.5 px-2 border border-[#2D9A5E] text-[#2D9A5E] bg-white rounded cursor-pointer">▶ Test</button>
        )}
        {hasAudio && seg.audioKey && <span className="text-[8px] text-muted ml-auto italic">persisted</span>}
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
