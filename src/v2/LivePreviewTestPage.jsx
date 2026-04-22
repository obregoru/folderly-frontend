// Dev-only test page for the LivePreviewPlayer component.
// Activated via `?preview-test=1` in the URL. Takes merged video +
// segment audio URLs from query string so we can point at a real
// Supabase-hosted job without committing credentials.
//
// Usage:
//   ?preview-test=1
//     &video=<merged_video_url>
//     &audio=<segment_audio_url>      (repeatable)
//     &text=<caption_text>            (matches each audio in order)
//
// If no params are provided, mounts with a dummy black video + silent
// audio so Player's mount/resolve path still exercises without
// needing live assets.

import { useState, useMemo } from 'react'
import LivePreviewPlayer from './components/LivePreviewPlayer'

export default function LivePreviewTestPage() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const videoParam = params?.get('video') || ''
  const audioParams = params ? params.getAll('audio') : []
  const textParams = params ? params.getAll('text') : []

  const [videoUrl, setVideoUrl] = useState(videoParam)
  const [audioList, setAudioList] = useState(() =>
    audioParams.map((src, i) => ({
      src,
      startMs: i * 3000,     // placeholder — 3s spacing between segments
      durationMs: 3000,
    }))
  )
  const [textList, setTextList] = useState(() =>
    textParams.length > 0 ? textParams : ['Hello preview', 'Second segment', 'Third segment']
  )

  // Cues: one per text item. Minimal caption style so the mount just
  // exercises the graph — not a polished preview.
  const cues = useMemo(() => textList.map((text, i) => {
    const startMs = i * 3000
    const words = String(text || '').trim().split(/\s+/).filter(Boolean)
    return {
      startMs,
      endMs: startMs + 2500,
      text,
      wordTimings: words.map((w, j) => ({
        wordIndex: j,
        word: w,
        startMs: startMs + j * 350,
        endMs: startMs + (j + 1) * 350,
      })),
      captionStyle: {
        baseFontColor: '#ffffff',
        activeWordColor: '#facc15',
        activeWordScalePulse: { peakScale: 1.12, attackMs: 80, releaseMs: 140 },
      },
      fadeInMs: 0,
      fadeOutMs: 0,
    }
  }), [textList])

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 540, margin: '0 auto' }}>
      <h1 style={{ fontSize: 18, marginBottom: 12 }}>LivePreviewPlayer — dev test page</h1>
      <p style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>
        Paste a Supabase merged-video URL + up to 6 segment audio URLs below.
        Without a video URL, the player renders an empty black stage with captions.
      </p>

      <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 600 }}>Merged video URL</label>
        <input
          type="text"
          value={videoUrl}
          onChange={e => setVideoUrl(e.target.value)}
          placeholder="https://...supabase.co/.../merged.mp4"
          style={{ padding: '6px 8px', fontSize: 11, border: '1px solid #ccc', borderRadius: 4 }}
        />
      </div>

      {audioList.map((a, i) => (
        <div key={i} style={{ display: 'grid', gap: 6, marginBottom: 6, gridTemplateColumns: '1fr 60px 60px', alignItems: 'center' }}>
          <input
            type="text"
            value={a.src}
            onChange={e => setAudioList(prev => prev.map((x, j) => j === i ? { ...x, src: e.target.value } : x))}
            placeholder={`segment ${i + 1} audio URL`}
            style={{ padding: '6px 8px', fontSize: 11, border: '1px solid #ccc', borderRadius: 4 }}
          />
          <input
            type="number"
            value={a.startMs}
            onChange={e => setAudioList(prev => prev.map((x, j) => j === i ? { ...x, startMs: Number(e.target.value) } : x))}
            style={{ padding: '4px', fontSize: 10, border: '1px solid #ccc', borderRadius: 4 }}
            title="startMs"
          />
          <input
            type="number"
            value={a.durationMs}
            onChange={e => setAudioList(prev => prev.map((x, j) => j === i ? { ...x, durationMs: Number(e.target.value) } : x))}
            style={{ padding: '4px', fontSize: 10, border: '1px solid #ccc', borderRadius: 4 }}
            title="durationMs"
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button
          onClick={() => setAudioList(prev => [...prev, { src: '', startMs: prev.length * 3000, durationMs: 3000 }])}
          style={{ fontSize: 11, padding: '4px 8px', border: '1px solid #666', background: 'white', borderRadius: 4, cursor: 'pointer' }}
        >+ add segment</button>
        {audioList.length > 0 && (
          <button
            onClick={() => setAudioList(prev => prev.slice(0, -1))}
            style={{ fontSize: 11, padding: '4px 8px', border: '1px solid #666', background: 'white', borderRadius: 4, cursor: 'pointer' }}
          >− remove last</button>
        )}
      </div>

      <div style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
        <label style={{ fontSize: 11, fontWeight: 600 }}>Caption texts (one per line, one per segment)</label>
        <textarea
          value={textList.join('\n')}
          onChange={e => setTextList(e.target.value.split('\n'))}
          rows={Math.max(3, textList.length + 1)}
          style={{ padding: '6px 8px', fontSize: 11, border: '1px solid #ccc', borderRadius: 4, fontFamily: 'monospace' }}
        />
      </div>

      <LivePreviewPlayer
        mergedVideoUrl={videoUrl}
        segmentAudioUrls={audioList.filter(a => a.src)}
        cues={cues}
        onReady={(info) => console.log('[preview-test] player ready', info)}
      />

      <pre style={{ marginTop: 16, fontSize: 10, background: '#f4f4f4', padding: 8, borderRadius: 4, overflow: 'auto', maxHeight: 240 }}>
        cues = {JSON.stringify(cues, null, 2)}
      </pre>
    </div>
  )
}
