import { useEffect, useRef, useState } from 'react'
import * as api from '../../api'

/**
 * VoiceoverPanelV2 — zero video players. Drives the shared FinalPreview
 * <video> via the ref exposed by FinalPreviewV2.getVideo().
 *
 * Phase 3 scope — minimal but functional:
 *   - Record mic tab: records while the shared video plays muted.
 *   - AI voice tab: text → ElevenLabs TTS → single audio blob.
 *   - Paste-script tab: accepts a pasted script, applies to AI tab input.
 *   - Mix vs Replace (original audio volume slider in mix mode).
 *   - Play button controls the shared video; voiceover audio plays in sync.
 *
 * Deferred to later sub-phases:
 *   - Timed segments with drag-reorder
 *   - Review / Suggest-from-video / Bundle advanced tools
 *   - Per-segment speed / regenerate / preview
 *
 * For those, link back to ?real=1.
 */
export default function VoiceoverPanelV2({ previewRef, settings }) {
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
  const audioElRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const recordedChunksRef = useRef([])

  const hasElevenLabs = !!settings?.elevenlabs_configured

  // Load voices list once.
  useEffect(() => {
    if (!hasElevenLabs) return
    api.listElevenLabsVoices?.()
      .then(r => setVoices(Array.isArray(r?.voices) ? r.voices : []))
      .catch(() => {})
  }, [hasElevenLabs])

  // Keep the audio element's src in sync with the blob.
  useEffect(() => {
    if (audioBlob && !audioUrl) {
      setAudioUrl(URL.createObjectURL(audioBlob))
    }
    return () => {
      if (audioUrl && !audioBlob) try { URL.revokeObjectURL(audioUrl) } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBlob])

  // Sync: when the shared video plays, start the voiceover audio at
  // the same output-timeline offset. When it pauses, pause audio.
  useEffect(() => {
    const video = previewRef?.current?.getVideo?.()
    if (!video || !audioEl() || !audioUrl) return
    const onPlay = () => {
      const audio = audioEl()
      if (!audio) return
      try {
        audio.currentTime = Math.max(0, video.currentTime)
        audio.volume = 1.0
        const p = audio.play()
        if (p && p.catch) p.catch(() => {})
      } catch {}
      // Mix mode: dim the video's own audio.
      if (mixMode === 'mix') {
        try { video.volume = origVolume / 100 } catch {}
      } else {
        try { video.muted = true } catch {}
      }
    }
    const onPause = () => {
      const audio = audioEl()
      if (!audio) return
      try { audio.pause() } catch {}
    }
    const onSeek = () => {
      const audio = audioEl()
      if (!audio) return
      try { audio.currentTime = Math.max(0, video.currentTime) } catch {}
    }
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('seeking', onSeek)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeking', onSeek)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl, mixMode, origVolume, previewRef])

  const audioEl = () => audioElRef.current

  const generate = async () => {
    if (!text.trim() || !voiceId) return
    setGenerating(true)
    try {
      const r = await api.textToSpeech(text.trim(), voiceId, {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        use_speaker_boost: true,
        speed: 1.0,
      })
      if (r?.error) throw new Error(r.error)
      const byteChars = atob(r.audio_base64)
      const bytes = new Uint8Array(byteChars.length)
      for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
      const blob = new Blob([bytes], { type: r.media_type || 'audio/mpeg' })
      if (audioUrl) try { URL.revokeObjectURL(audioUrl) } catch {}
      setAudioBlob(blob)
      setAudioUrl(URL.createObjectURL(blob))
    } catch (e) {
      alert('TTS failed: ' + e.message)
    }
    setGenerating(false)
  }

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
        setAudioBlob(blob)
        setAudioUrl(URL.createObjectURL(blob))
        stream.getTracks().forEach(t => t.stop())
      }
      mediaRecorderRef.current = mr
      mr.start()
      setRecording(true)
      // Start the video muted while recording.
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
  }

  const discard = () => {
    if (audioUrl) try { URL.revokeObjectURL(audioUrl) } catch {}
    setAudioBlob(null)
    setAudioUrl(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-[12px] font-medium flex-1">Voiceover</div>
        {audioUrl && (
          <button
            onClick={() => {
              const v = previewRef?.current?.getVideo?.()
              if (!v) return
              try { v.currentTime = 0; v.play() } catch {}
            }}
            className="text-[10px] py-1 px-2.5 bg-[#2D9A5E] text-white border-none rounded cursor-pointer"
          >▶ Play with video</button>
        )}
      </div>

      <div className="flex items-center gap-1 bg-[#f8f7f3] rounded-lg p-0.5">
        {[
          { key: 'ai', label: 'AI voice', enabled: hasElevenLabs },
          { key: 'record', label: 'Record', enabled: true },
          { key: 'paste', label: 'Paste script', enabled: true },
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
            placeholder="Type what the voiceover should say…"
            rows={5}
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y min-h-[100px]"
          />
          <button
            onClick={generate}
            disabled={generating || !text.trim() || !voiceId}
            className="w-full py-2 bg-[#6C5CE7] text-white text-[11px] font-medium border-none rounded cursor-pointer disabled:opacity-50"
          >{generating ? 'Generating…' : 'Generate voice'}</button>
        </div>
      )}

      {tab === 'record' && (
        <div className="space-y-2 text-center py-3">
          <div className="text-[36px]">🎤</div>
          <div className="text-[11px] text-muted">
            {recording ? 'Recording… video above plays muted.' : 'Tap to start. Video above plays muted while you narrate.'}
          </div>
          {!recording ? (
            <button
              onClick={startRecording}
              className="py-2 px-6 bg-[#c0392b] text-white text-[11px] font-medium border-none rounded cursor-pointer"
            >● Start recording</button>
          ) : (
            <button
              onClick={stopRecording}
              className="py-2 px-6 bg-[#c0392b] text-white text-[11px] font-medium border-none rounded cursor-pointer animate-pulse"
            >■ Stop recording</button>
          )}
        </div>
      )}

      {tab === 'paste' && (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Paste your script here. Timestamps like [0:00] are preserved for when segments are wired in a later phase."
            rows={6}
            className="w-full text-[11px] border border-[#e5e5e5] rounded p-2 bg-white resize-y min-h-[140px] font-mono"
          />
          <button
            onClick={() => setTab('ai')}
            className="w-full py-1.5 bg-white border border-[#6C5CE7] text-[#6C5CE7] text-[11px] font-medium rounded cursor-pointer"
          >Use in AI tab →</button>
        </div>
      )}

      {audioUrl && (
        <div className="border-t border-[#e5e5e5] pt-2 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#2D9A5E] font-medium">Voiceover ready</span>
            <audio ref={audioElRef} src={audioUrl} controls preload="metadata" className="h-7 flex-1 min-w-[140px] max-w-[280px]" style={{ maxHeight: 28 }} />
            <button
              onClick={discard}
              className="text-[10px] py-1 px-2 border border-[#c0392b] text-[#c0392b] rounded bg-white cursor-pointer"
            >Discard</button>
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

      <div className="border-t border-[#e5e5e5] pt-2 text-[9px] text-muted italic">
        Timed segments, review, and suggest-from-video ship in a later sub-phase. For those, use <a href="/?real=1" className="text-[#6C5CE7]">the real app</a>.
      </div>
    </div>
  )
}
