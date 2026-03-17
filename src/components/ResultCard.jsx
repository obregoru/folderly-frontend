import { useState, useEffect, useCallback } from 'react'
import { allTags } from '../lib/parse'
import CropStrip from './CropStrip'

const PLATFORMS = [
  { key: 'tiktok', label: 'TikTok', color: '#2D9A5E' },
  { key: 'instagram', label: 'Instagram', color: '#B5318A' },
  { key: 'facebook', label: 'Facebook', color: '#1877F2' },
  { key: 'twitter', label: 'X', color: '#000000' },
  { key: 'google', label: 'Google', color: '#4285F4' },
  { key: 'blog', label: 'Blog', color: '#E67E22' },
]

function getText(cap) {
  if (!cap) return ''
  return typeof cap === 'object' ? (cap.text || '') : cap
}

function getId(cap) {
  if (!cap) return null
  return typeof cap === 'object' ? cap.id : null
}

function getScore(cap) {
  if (!cap || typeof cap !== 'object') return null
  return cap.ai_score || null
}

export default function ResultCard({ item, folderCtx, onRegen, onUpdateCaption, onRefine, apiUrl }) {
  // Find which platforms have captions
  const available = item.captions
    ? PLATFORMS.filter(p => item.captions[p.key])
    : []

  const [tab, setTab] = useState('')

  // Set tab when captions arrive or change
  useEffect(() => {
    if (available.length > 0) {
      setTab(prev => {
        // Keep current tab if still valid
        if (prev && available.some(p => p.key === prev)) return prev
        return available[0].key
      })
    }
  }, [item.captions])

  // Tags
  const tags = [...new Set([
    ...(folderCtx ? allTags(folderCtx.parsed) : []),
    ...allTags(item.parsed)
  ])]

  // Thumbnail src
  const thumbSrc = item.isImg
    ? URL.createObjectURL(item.file)
    : (item.uploadResult?.thumbnail_path
      ? (item.uploadResult.thumbnail_path.startsWith('http') ? item.uploadResult.thumbnail_path : `/uploads/${item.uploadResult.thumbnail_path}`)
      : null)

  return (
    <div className="bg-white border border-border rounded mb-2.5">
      {/* Header */}
      <div className="flex items-center gap-2.5 py-2.5 px-3.5 border-b border-border bg-cream">
        {thumbSrc ? (
          <img src={thumbSrc} className="w-9 h-9 rounded-sm object-cover flex-shrink-0" />
        ) : (
          <div className="w-9 h-9 rounded-sm bg-ink flex items-center justify-center text-white text-[13px] flex-shrink-0">▶</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate" title={item.file.name}>{item.file.name}</div>
          {tags.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-0.5">
              {tags.map(t => <span key={t} className="inline-block bg-sage-light text-sage border border-[#C2D4C9] rounded-full px-[7px] text-[10px]">{t}</span>)}
            </div>
          )}
        </div>
      </div>

      {/* Dedup warning */}
      {item.previouslyUsed && (
        <div className="py-2 px-3.5 text-[11px] bg-[#FFF3CD] text-[#856404] mx-3.5 mt-2 rounded-sm">
          This photo was previously used. Captions generated anyway.
        </div>
      )}

      {/* Loading */}
      {item.status === 'loading' && (
        <div className="py-3 px-3.5">
          <div className="skel" style={{ width: '86%' }} />
          <div className="skel" style={{ width: '70%' }} />
          <div className="skel" style={{ width: '78%' }} />
        </div>
      )}

      {/* Error */}
      {item.status === 'error' && (
        <div className="py-3 px-3.5 text-xs text-[#A32D2D]">{item.errMsg || 'Error generating captions.'}</div>
      )}

      {/* Caption tabs + content */}
      {available.length > 0 && (
        <>
          <div className="flex border-b border-border">
            {available.map(p => (
              <button
                key={p.key}
                onClick={() => setTab(p.key)}
                className="flex-1 py-2 px-1 text-[11px] font-medium text-center cursor-pointer border-none bg-transparent font-sans"
                style={{
                  color: tab === p.key ? p.color : '#7A756F',
                  borderBottom: tab === p.key ? `2px solid ${p.color}` : '2px solid transparent'
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {available.map(p => {
            if (tab !== p.key) return null
            const cap = item.captions[p.key]
            return (
              <div key={p.key} className="py-3 px-3.5">
                <CaptionEditor
                  text={getText(cap)}
                  captionId={getId(cap)}
                  score={getScore(cap)}
                  onSave={(newText) => onUpdateCaption(p.key, newText, getId(cap))}
                  onRegen={onRegen}
                  onRefine={(val) => onRefine(val, p.key, getId(cap))}
                />
              </div>
            )
          })}
        </>
      )}

      <CropStrip item={item} apiUrl={apiUrl} />
    </div>
  )
}

function CaptionEditor({ text, captionId, score, onSave, onRegen, onRefine }) {
  const [value, setValue] = useState(text)
  const [saved, setSaved] = useState(false)

  // Sync when text prop changes (e.g. after refine/regen)
  useEffect(() => { setValue(text) }, [text])

  const handleBlur = () => {
    if (value !== text) {
      onSave(value)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }
  }

  const scoreLabel = score?.score >= 0
    ? (score.score <= 30 ? 'Human' : score.score <= 60 ? 'Mixed' : 'AI-like')
    : null

  return (
    <>
      <textarea
        className="w-full text-xs leading-relaxed whitespace-pre-wrap text-ink border border-transparent rounded-sm py-1.5 px-2 font-sans resize-y min-h-[60px] bg-transparent transition-all hover:border-border focus:outline-none focus:border-sage focus:bg-white"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={handleBlur}
        rows={Math.max(3, Math.ceil(value.length / 60))}
      />
      <div className="flex justify-end gap-1.5 mt-2 items-center flex-wrap">
        <button onClick={onRegen} className="text-[11px] py-1 px-2.5 border border-border rounded-sm bg-white cursor-pointer font-sans hover:bg-cream">Regenerate</button>
        <button onClick={() => navigator.clipboard.writeText(value)} className="text-[11px] py-1 px-2.5 border border-border rounded-sm bg-white cursor-pointer font-sans hover:bg-cream">Copy</button>
        <button onClick={() => onRefine(value)} className="text-[11px] py-1 px-2.5 border border-border rounded-sm bg-white cursor-pointer font-sans hover:bg-cream">Refine</button>
        {saved && <span className="text-[10px] text-sage">Saved</span>}
        {scoreLabel && (
          <span
            className={`text-[10px] py-0.5 px-2 rounded-xl font-semibold border ${
              score.score <= 30 ? 'bg-[#e8efe9] text-[#3a6b42] border-[#3a6b42]' :
              score.score <= 60 ? 'bg-[#fef3cd] text-[#856404] border-[#856404]' :
              'bg-[#fdeaea] text-[#c0392b] border-[#c0392b]'
            }`}
            title={score.reason}
          >
            {scoreLabel} {score.score}%
          </span>
        )}
      </div>
    </>
  )
}
