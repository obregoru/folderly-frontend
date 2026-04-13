import { useState, useRef, useEffect } from 'react'

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
  // Stash on items so ResultCard can read during preview/post
  useEffect(() => {
    for (const vf of videoFiles) {
      vf._voiceoverMode = voMixMode
      vf._voiceoverOrigVol = voOrigVolume
    }
  }, [voMixMode, voOrigVolume, videoFiles])

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
      })
    }
  }, [voMixMode, voOrigVolume, ttsText, selectedVoice, ttsStability, ttsSimilarity, ttsStyle, ttsSpeakerBoost])

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
  const [tab, setTab] = useState('record') // record | tts

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
    if (!ttsText.trim()) return
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
      const byteChars = atob(r.audio_base64)
      const bytes = new Uint8Array(byteChars.length)
      for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
      const blob = new Blob([bytes], { type: r.media_type || 'audio/mpeg' })
      setAudioBlob(blob)
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      setAudioUrl(URL.createObjectURL(blob))
      // Stash on video items so CaptionEditor can include it in previews
      for (const vf of videoFiles) vf._voiceoverBlob = blob
      try { window.dispatchEvent(new CustomEvent('posty-voiceover-change')) } catch {}
      // Save to job storage for persistence
      persistAudio(blob)
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
                // Sync voiceover audio
                if (audioUrl && audioPreviewRef.current) {
                  const outputTime = Math.max(0, (v.currentTime || 0) - start)
                  try { audioPreviewRef.current.currentTime = outputTime } catch {}
                  audioPreviewRef.current.play().catch(() => {})
                  setPreviewing(true)
                }
              }}
              onPause={() => {
                if (audioPreviewRef.current) try { audioPreviewRef.current.pause() } catch {}
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
                // Sync voiceover audio
                if (audioUrl && audioPreviewRef.current) {
                  const outputTime = Math.max(0, (v.currentTime || 0) - start)
                  try { audioPreviewRef.current.currentTime = Math.min(outputTime, audioPreviewRef.current.duration || 999) } catch {}
                }
              }}
              onTimeUpdate={e => {
                const v = e.target
                // Enforce trim bounds — clamp to [trimStart, trimEnd]
                const start = monitorTrimStart
                const end = monitorTrimEnd ?? (v.duration || Infinity)
                if (v.currentTime >= end - 0.03) {
                  try { v.currentTime = start; v.pause() } catch {}
                  if (audioPreviewRef.current) try { audioPreviewRef.current.pause(); audioPreviewRef.current.currentTime = 0 } catch {}
                  setPreviewing(false)
                } else if (v.currentTime < start - 0.05) {
                  try { v.currentTime = start } catch {}
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
          <textarea
            rows={2}
            value={ttsText}
            onChange={e => setTtsText(e.target.value)}
            placeholder="Type what the voiceover should say..."
            className="w-full text-[11px] border border-border rounded py-1 px-2 bg-white resize-none"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => { setAudioIsRestored(false); generateTTS() }}
              disabled={ttsLoading || !ttsText.trim()}
              className={`text-[10px] py-1 px-2.5 border-none rounded cursor-pointer disabled:opacity-50 ${audioIsRestored && audioBlob ? 'bg-[#2D9A5E] text-white' : 'bg-[#6C5CE7] text-white'}`}
            >{ttsLoading ? 'Generating...' : audioIsRestored && audioBlob ? 'Voice loaded ✓' : 'Generate voice'}</button>
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
      </div>}
    </div>
  )
}
