import { useState, useRef, useEffect } from 'react'

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
  const [selectedVoice, setSelectedVoice] = useState(settings?.elevenlabs_voice_id || '')
  const [voicesLoaded, setVoicesLoaded] = useState(false)

  // --- Mix state ---
  const [mixMode, setMixMode] = useState('mix') // mix | replace
  const [originalVolume, setOriginalVolume] = useState(0.3)
  const [applying, setApplying] = useState(false)
  const [resultUrl, setResultUrl] = useState(null)
  const resultBlobRef = useRef(null)

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

  // Load voices when TTS tab is selected
  useEffect(() => {
    if (tab !== 'tts' || !hasElevenLabs || voicesLoaded) return
    import('../api').then(api => api.getVoices()).then(r => {
      if (r.voices) setVoices(r.voices)
      setVoicesLoaded(true)
    }).catch(() => setVoicesLoaded(true))
  }, [tab, hasElevenLabs, voicesLoaded])

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
      const r = await api.textToSpeech(ttsText.trim(), selectedVoice || undefined)
      if (r.error) throw new Error(r.error)
      const byteChars = atob(r.audio_base64)
      const bytes = new Uint8Array(byteChars.length)
      for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
      const blob = new Blob([bytes], { type: r.media_type || 'audio/mpeg' })
      setAudioBlob(blob)
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      setAudioUrl(URL.createObjectURL(blob))
    } catch (err) {
      alert('TTS failed: ' + err.message)
    }
    setTtsLoading(false)
  }

  // --- Apply voiceover to video ---
  const applyVoiceover = async () => {
    if (!audioBlob) return
    setApplying(true)
    try {
      const api = await import('../api')
      // Read audio as base64
      const audioB64 = await new Promise((resolve, reject) => {
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
        r.readAsArrayBuffer(audioBlob)
      })

      // Pick video source: merged > first uploaded video
      let videoB64
      if (mergedVideoBase64) {
        videoB64 = mergedVideoBase64
      } else if (videoFiles.length > 0) {
        const file = videoFiles[0].file
        videoB64 = await new Promise((resolve, reject) => {
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
          r.readAsArrayBuffer(file)
        })
      } else {
        throw new Error('No video to apply voiceover to')
      }

      const result = await api.addVoiceover(videoB64, audioB64, mixMode, originalVolume, 1.0)
      if (result.error) throw new Error(result.error)

      const byteChars = atob(result.video_base64)
      const bytes = new Uint8Array(byteChars.length)
      for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'video/mp4' })
      resultBlobRef.current = blob
      if (resultUrl) URL.revokeObjectURL(resultUrl)
      const url = URL.createObjectURL(blob)
      setResultUrl(url)
      if (onResult) onResult({ blob, url, base64: result.video_base64 })
    } catch (err) {
      alert('Voiceover failed: ' + err.message)
    }
    setApplying(false)
  }

  const handleSave = async () => {
    const blob = resultBlobRef.current
    if (!blob) return
    const filename = 'voiceover-video.mp4'
    try {
      const file = new File([blob], filename, { type: 'video/mp4' })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename })
        return
      }
    } catch (e) { if (e.name === 'AbortError') return }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

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
            {/* Play/pause button overlay when audio is recorded (preview mode) */}
            {!recording && audioUrl && (
              <button
                type="button"
                onClick={() => {
                  const a = audioPreviewRef.current
                  if (!a) return
                  if (a.paused) {
                    const v = monitorRef.current
                    if (v) {
                      try { v.currentTime = monitorTrimStart + (a.currentTime || 0) } catch {}
                      v.muted = true
                      v.play().catch(() => {})
                    }
                    a.play().catch(() => {})
                    setPreviewing(true)
                  } else {
                    a.pause()
                    try { monitorRef.current?.pause() } catch {}
                    setPreviewing(false)
                  }
                }}
                className="absolute inset-0 flex items-center justify-center bg-transparent border-none cursor-pointer"
              >
                <span className="text-white text-[24px] bg-black/50 rounded-full w-10 h-10 flex items-center justify-center">
                  {audioPreviewRef.current?.paused !== false ? '\u25B6' : '\u23F8'}
                </span>
              </button>
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
          {/* Hidden audio element for synced preview playback */}
          {audioUrl && (
            <audio
              ref={audioPreviewRef}
              src={audioUrl}
              onPause={() => { try { monitorRef.current?.pause() } catch {} }}
              onEnded={() => { try { monitorRef.current?.pause() } catch {} }}
              onSeeked={(e) => {
                const v = monitorRef.current
                if (v) try { v.currentTime = monitorTrimStart + (e.target.currentTime || 0) } catch {}
              }}
              style={{ display: 'none' }}
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
              onClick={() => { setAudioBlob(null); if (audioUrl) URL.revokeObjectURL(audioUrl); setAudioUrl(null) }}
              className="text-[9px] text-muted hover:underline bg-transparent border-none cursor-pointer"
            >Discard</button>
          )}
        </div>
      )}

      {/* TTS tab controls */}
      {tab === 'tts' && hasElevenLabs && (
        <div className="space-y-2">
          <textarea
            rows={2}
            value={ttsText}
            onChange={e => setTtsText(e.target.value)}
            placeholder="Type what the voiceover should say..."
            className="w-full text-[11px] border border-border rounded py-1 px-2 bg-white resize-none"
          />
          <div className="flex items-center gap-2 flex-wrap">
            {voices.length > 0 && (
              <select
                value={selectedVoice}
                onChange={e => setSelectedVoice(e.target.value)}
                className="text-[10px] border border-border rounded py-0.5 px-1.5 bg-white"
              >
                {voices.map(v => (
                  <option key={v.voice_id} value={v.voice_id}>{v.name}</option>
                ))}
              </select>
            )}
            <button
              onClick={generateTTS}
              disabled={ttsLoading || !ttsText.trim()}
              className="text-[10px] py-1 px-2.5 bg-[#6C5CE7] text-white border-none rounded cursor-pointer disabled:opacity-50"
            >{ttsLoading ? 'Generating...' : 'Generate voice'}</button>
            {audioUrl && !recording && (
              <button
                onClick={() => { setAudioBlob(null); if (audioUrl) URL.revokeObjectURL(audioUrl); setAudioUrl(null) }}
                className="text-[9px] text-muted hover:underline bg-transparent border-none cursor-pointer"
              >Discard</button>
            )}
          </div>
        </div>
      )}

      {/* Apply to video */}
      {audioUrl && (videoFiles.length > 0 || mergedVideoBase64) && (
        <div className="border-t border-border pt-2 space-y-1.5">
          <div className="flex items-center gap-3 text-[10px]">
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="vo-mode" value="mix" checked={mixMode === 'mix'} onChange={() => setMixMode('mix')} />
              Mix with original audio
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="vo-mode" value="replace" checked={mixMode === 'replace'} onChange={() => setMixMode('replace')} />
              Replace original audio
            </label>
          </div>
          {mixMode === 'mix' && (
            <div className="flex items-center gap-2 text-[10px]">
              <label className="text-muted">Original volume:</label>
              <input
                type="range" min={0} max={1} step={0.05} value={originalVolume}
                onChange={e => setOriginalVolume(Number(e.target.value))}
                className="flex-1 accent-[#2D9A5E]"
              />
              <span className="text-muted w-8 text-right">{Math.round(originalVolume * 100)}%</span>
            </div>
          )}
          <button
            onClick={applyVoiceover}
            disabled={applying}
            className="w-full text-[11px] py-2 border border-[#2D9A5E] rounded bg-[#2D9A5E] text-white cursor-pointer font-sans font-medium hover:bg-[#248a50] disabled:opacity-50"
          >
            {applying ? 'Applying voiceover...' : `Apply to ${mergedVideoBase64 ? 'merged video' : videoFiles[0]?.file?.name || 'video'}`}
          </button>
        </div>
      )}

      {/* Result preview */}
      {resultUrl && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium text-ink">Result with voiceover:</div>
          <div className="relative rounded border border-border overflow-hidden bg-black" style={{ maxHeight: 300 }}>
            <video src={resultUrl} controls playsInline className="w-full max-h-[300px] object-contain" />
          </div>
          <button
            onClick={handleSave}
            className="w-full text-[10px] py-1.5 border border-[#2D9A5E] text-[#2D9A5E] rounded bg-white cursor-pointer font-sans hover:bg-[#f0faf4]"
          >Save video with voiceover</button>
        </div>
      )}
      </div>}
    </div>
  )
}
