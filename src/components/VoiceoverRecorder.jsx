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
  // We use a separate state + RAF so the bar animates smoothly.
  const [monitorTime, setMonitorTime] = useState(0)
  useEffect(() => {
    if (!recording) return
    let raf
    const tick = () => {
      const v = monitorRef.current
      if (v) {
        setMonitorTime(v.currentTime)
        // Auto-stop at trimEnd
        const end = monitorTrimEnd ?? v.duration
        if (v.currentTime >= end - 0.05) {
          stopRecording()
          return
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [recording, monitorTrimEnd])

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

  return (
    <div className="bg-white border border-[#2D9A5E]/30 rounded-sm p-3 space-y-2">
      <div className="text-[11px] font-medium text-ink">Voiceover</div>

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

      {/* Record tab */}
      {tab === 'record' && (
        <div className="space-y-2">
          {/* Video monitor — muted playback so you can narrate to what you see */}
          {monitorSrc && (
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
              {!recording && !audioUrl && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <span className="text-white text-[11px] bg-black/60 rounded-full px-3 py-1">Press record — video will play muted while you narrate</span>
                </div>
              )}
            </div>
          )}
          {/* Playhead bar showing recording position relative to video duration */}
          {monitorSrc && monitorDuration > 0 && (
            <div className="relative h-2 bg-[#e5e5e5] rounded overflow-hidden">
              {/* Trimmed region highlight */}
              <div
                className="absolute top-0 bottom-0 bg-[#2D9A5E]/20"
                style={{
                  left: `${(monitorTrimStart / monitorDuration) * 100}%`,
                  width: `${(((monitorTrimEnd ?? monitorDuration) - monitorTrimStart) / monitorDuration) * 100}%`,
                }}
              />
              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-[#c0392b]"
                style={{ left: `${((recording ? monitorTime : monitorTrimStart) / monitorDuration) * 100}%` }}
              />
            </div>
          )}
          <div className="flex items-center gap-2">
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
          </div>
        </div>
      )}

      {/* TTS tab */}
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
          </div>
        </div>
      )}

      {/* Audio preview */}
      {audioUrl && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-muted font-medium">Audio preview:</div>
          <audio src={audioUrl} controls className="w-full h-8" />
          <button
            onClick={() => { setAudioBlob(null); if (audioUrl) URL.revokeObjectURL(audioUrl); setAudioUrl(null) }}
            className="text-[9px] text-muted hover:underline bg-transparent border-none cursor-pointer"
          >Discard recording</button>
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
    </div>
  )
}
