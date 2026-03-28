import { useState } from 'react'
import * as api from '../api'

const STYLES = [
  { value: 'shorten', label: 'Shorten it' },
  { value: 'descriptive', label: 'More descriptive' },
  { value: 'simplify', label: 'Simplify it' },
  { value: 'persuasive', label: 'Make persuasive' },
  { value: 'assertive', label: 'Make assertive' },
  { value: 'friendly', label: 'Make friendly' },
  { value: 'witty', label: 'Make witty' },
  { value: 'confident', label: 'Sound confident' },
  { value: 'casual', label: 'More casual' },
  { value: 'professional', label: 'Sound professional' },
  { value: 'empathetic', label: 'Make empathetic' },
  { value: 'human', label: 'Make more human' },
]

export default function RefineModal({ ctx, onClose, onAccept }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const originalText = ctx.textarea || ''

  const runRefine = async (style) => {
    setLoading(true)
    setResult(null)
    try {
      const d = await api.refine(originalText, style, ctx.platform)
      setResult(d)
    } catch (e) {
      setResult({ text: 'Error: ' + e.message, ai_score: null })
    }
    setLoading(false)
  }

  const handleAccept = () => {
    if (result?.text) {
      onAccept(result.text, ctx.platform, ctx.captionId, ctx.item)
    }
  }

  const handleCopy = () => {
    if (result?.text) navigator.clipboard.writeText(result.text)
  }

  const score = result?.ai_score
  const scoreLabel = score && score.score >= 0
    ? (score.score <= 30 ? 'Human' : score.score <= 60 ? 'Mixed' : 'AI-like')
    : null
  const scoreClass = score && score.score >= 0
    ? (score.score <= 30 ? 'bg-[#e8efe9] text-[#3a6b42] border-[#3a6b42]' : score.score <= 60 ? 'bg-[#fef3cd] text-[#856404] border-[#856404]' : 'bg-[#fdeaea] text-[#c0392b] border-[#c0392b]')
    : ''

  return (
    <div className="fixed inset-0 bg-black/45 z-[200] flex items-center justify-center" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded w-[560px] max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between py-3.5 px-4.5 border-b border-border">
          <div className="font-serif text-[17px]">Refine content</div>
          <button className="text-xl bg-transparent border-none cursor-pointer text-muted" onClick={onClose}>×</button>
        </div>
        <div className="overflow-y-auto p-4">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted mb-1">Original</div>
          <div className="text-xs leading-relaxed whitespace-pre-wrap py-2.5 px-3 rounded-sm bg-cream text-muted border border-border min-h-[50px]">{originalText}</div>

          <div className="my-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted mb-1">Pick a style</div>
            <div className="flex flex-wrap gap-[5px]">
              {STYLES.map(s => (
                <button
                  key={s.value}
                  onClick={() => runRefine(s.value)}
                  disabled={loading}
                  className={`text-[11px] py-[5px] px-3 border border-border rounded-full bg-white text-ink cursor-pointer font-sans transition-all hover:border-sage hover:text-sage ${loading ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {loading && <div className="py-3 text-xs text-muted">Rewriting...</div>}

          {result && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted">Refined</div>
                {scoreLabel && (
                  <span className={`inline-flex items-center text-[10px] py-0.5 px-2 rounded-xl font-semibold border ${scoreClass}`} title={score?.reason}>
                    {scoreLabel} {score.score}%
                  </span>
                )}
              </div>
              <div className="text-xs leading-relaxed whitespace-pre-wrap py-2.5 px-3 rounded-sm bg-white text-ink border border-sage min-h-[50px]">{result.text}</div>
              <div className="flex gap-1.5 mt-2.5">
                <button onClick={handleAccept} className="text-[11px] py-1 px-2.5 bg-sage text-white border border-sage rounded-sm cursor-pointer font-sans">Accept</button>
                <button onClick={handleCopy} className="text-[11px] py-1 px-2.5 border border-border rounded-sm bg-white cursor-pointer font-sans">Copy</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
