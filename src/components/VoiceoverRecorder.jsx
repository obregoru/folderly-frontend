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
export default function VoiceoverRecorder({ videoFiles, mergedVideoBase64, settings, onResult }) {
  // --- Recording state ---
  const [recording, setRecording] = useState(false)
  const [audioUrl, setAudioUrl] = useState(null)
  const [audioBlob, setAudioBlob] = useState(null)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  // Video monitor — plays muted during recording so you can narrate to picture
  const monitorRef = useRef(null)
  const audioPreviewRef = useRef(null)
  const [recordTime, setRecordTime] = useState(0)
  const recordTimerRef = useRef(null)
  const [monitorDuration, setMonitorDuration] = useState(0)

  // --- TTS state ---
  const [ttsText, setTtsText] = useState('')
  const [ttsLoading, setTtsLoading] = useState(false)
  const [voices, setVoices] = useState([])
  const [selectedVoice, setSelectedVoice] = useState(() => localStorage.getItem('posty_tts_voice') || settings?.elevenlabs_voice_id || '')
  const [voicesLoaded, setVoicesLoaded] = useState(false)
  // ElevenLabs voice settings — persisted to localStorage
  const [ttsStability, setTtsStability] = useState(() => Number(localStorage.getItem('posty_tts_stability')) || 0.5)
  const [ttsSimilarity, setTtsSimilarity] = useState(() => Number(localStorage.getItem('posty_tts_similarity')) || 0.75)
  const [ttsStyle, setTtsStyle] = useState(() => Number(localStorage.getItem('posty_tts_style')) || 0)
  const [ttsSpeakerBoost, setTtsSpeakerBoost] = useState(() => localStorage.getItem('posty_tts_boost') !== 'false')
  useEffect(() => { localStorage.setItem('posty_tts_stability', ttsStability) }, [ttsStability])
  useEffect(() => { localStorage.setItem('posty_tts_similarity', ttsSimilarity) }, [ttsSimilarity])
  useEffect(() => { localStorage.setItem('posty_tts_style', ttsStyle) }, [ttsStyle])
  useEffect(() => { localStorage.setItem('posty_tts_boost', ttsSpeakerBoost) }, [ttsSpeakerBoost])

  // Mix settings are used by CaptionEditor's Generate Preview, not here.
  // Keeping state minimal — voiceover audio is stashed on item._voiceoverBlob.

  const hasElevenLabs = !!settings?.elevenlabs_configured
  const [tab, setTab] = useState('record') // record | tts

  // Video source for the recording monitor. Prefer merged video URL, else first video file.
  const monitorItem = videoFiles[0] || null
  const [monitorSrc] = useState(() => {
    if (monitorItem?.file) return URL.createObjectURL(monitorItem.file)
    return null
  })
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
              className="w-full max-h-[220px] object-contain"
              onLoadedMetadata={e => setMonitorDuration(e.target.duration)}
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
          {/* Audio element for synced preview playback. NOT display:none because
              iOS Safari won't allow play() on hidden media elements even from a
              user gesture. Instead we make it tiny and transparent. */}
          {audioUrl && (
            <audio
              ref={audioPreviewRef}
              src={audioUrl}
              controls
              playsInline
              onPause={() => { try { monitorRef.current?.pause() } catch {}; setPreviewing(false) }}
              onEnded={() => { try { monitorRef.current?.pause() } catch {}; setPreviewing(false) }}
              onPlay={() => {
                const v = monitorRef.current
                if (v) {
                  try { v.currentTime = monitorTrimStart + (audioPreviewRef.current?.currentTime || 0) } catch {}
                  v.muted = true
                  v.play().catch(() => {})
                }
                setPreviewing(true)
              }}
              onSeeked={(e) => {
                const v = monitorRef.current
                if (v) try { v.currentTime = monitorTrimStart + (e.target.currentTime || 0) } catch {}
              }}
              className="w-full h-8 mt-1"
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
              onClick={generateTTS}
              disabled={ttsLoading || !ttsText.trim()}
              className="text-[10px] py-1 px-2.5 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
            >{ttsLoading ? 'Generating...' : 'Generate voice'}</button>
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

      {/* Info — voiceover is applied via Generate Preview in the overlay editor */}
      {audioUrl && (
        <p className="text-[9px] text-muted border-t border-border pt-2">
          Voiceover will be included when you click <strong>Generate Preview</strong> in the overlay editor below. The preview will have trim + overlays + this voiceover mixed in.
        </p>
      )}
      </div>}
    </div>
  )
}
